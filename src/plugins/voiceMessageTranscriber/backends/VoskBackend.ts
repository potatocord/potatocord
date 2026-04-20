/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createModel, KaldiRecognizer, Model } from "vosk-browser";

import {
    ASRBackend,
    DeviceType,
    ModelConfig,
    ProgressCallback,
    Quantization,
    TranscriptionOptions,
    TranscriptionResult,
    TranscriptionSegment,
} from "./types";
import { settings } from "../settings";
import { VOSK_MODELS } from "../models/registry";
const VOSK_SMALL = VOSK_MODELS[0];

// Default Vosk model URL (Small English model)
const SMALL_MODEL_URL = "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";

/**
 * Vosk ASR Backend Implementation
 *
 * Wraps the existing vosk-browser transcription logic into a proper
 * ASRBackend class implementing the standardized interface.
 *
 * @implements {ASRBackend}
 */
export class VoskBackend implements ASRBackend {
    /** Backend identifier */
    id = "vosk";

    /** Human-readable backend name */
    name = "Vosk (Legacy)";

    /** Supported models - maps VOSK_SMALL to ASRBackend ModelConfig format */
    supportedModels: ModelConfig[] = [
        {
            id: VOSK_SMALL.id,
            name: VOSK_SMALL.name,
            backend: "vosk",
            size: VOSK_SMALL.sizeMB * 1024 * 1024, // Convert MB to bytes
            hfUrl: VOSK_SMALL.url || SMALL_MODEL_URL,
            languages: VOSK_SMALL.languages,
            isMultiComponent: false,
            checksum: VOSK_SMALL.components?.[0]?.sha256,
            defaultQuantization: Quantization.FP32,
            supportedQuantizations: [Quantization.FP32],
            description: VOSK_SMALL.description,
            version: VOSK_SMALL.version,
        },
    ];

    /** Current loaded model instance */
    private model: Model | null = null;

    /** Current recognizer instance */
    private recognizer: KaldiRecognizer | null = null;

    /** AbortController for cancelling operations */
    private abortController: AbortController | null = null;

    /** Promise for model loading (cached) */
    private modelPromise: Promise<Model> | null = null;

    /** Currently loaded model URL */
    private currentModelUrl: string | null = null;

    /** Cache for transcription results */
    private transcriptionCache = new Map<string, string>();

    /** Listeners for transcription updates */
    private transcriptionListeners = new Set<(messageId: string, text: string | undefined) => void>();

    /**
     * Initialize the backend.
     * For Vosk, this is lazy - nothing needed upfront.
     */
    async initialize(): Promise<void> {
        // Lazy initialization - model loaded on demand
    }

    /**
     * Load a specific model into memory.
     * Supports customModelUrl setting for backward compatibility.
     *
     * @param modelId - Model identifier (should be 'vosk-small')
     * @param onProgress - Optional progress callback
     */
    async loadModel(modelId: string, onProgress?: ProgressCallback): Promise<void> {
        const selectedModel = settings.store.legacyModel;
        const url = selectedModel === "custom" && settings.store.customModelUrl
            ? settings.store.customModelUrl
            : SMALL_MODEL_URL;

        if (!url) {
            throw new Error("No model URL provided");
        }

        // Report initial progress
        onProgress?.({
            percent: 0,
            message: "Loading Vosk model...",
        });

        if (!this.modelPromise || this.currentModelUrl !== url) {
            this.currentModelUrl = url;
            this.modelPromise = createModel(url);
        }

        this.model = await this.modelPromise;

        onProgress?.({
            percent: 100,
            message: "Vosk model loaded",
        });
    }

    /**
     * Check if this quantization level is supported.
     * Vosk only supports FP32 (full precision).
     *
     * @param quant - Quantization level to check
     * @returns true only for FP32
     */
    supportsQuantization(quant: Quantization): boolean {
        return quant === Quantization.FP32;
    }

    /**
     * Check if this device type is supported.
     * Vosk is CPU-only.
     *
     * @param device - Device type to check
     * @returns true only for CPU
     */
    supportsDevice(device: DeviceType): boolean {
        return device === DeviceType.CPU;
    }

    /**
     * Check if backend is available in current environment.
     * Vosk works everywhere via WASM.
     *
     * @returns Always true
     */
    async isAvailable(): Promise<boolean> {
        return true;
    }

    /**
     * Transcribe audio data to text.
     * Migrates logic from existing transcribeVoiceMessage() in transcribe.ts.
     *
     * @param audioData - Raw PCM audio samples (Float32Array)
     * @param options - Transcription options
     * @returns Promise resolving to transcription result
     */
    async transcribe(audioData: Float32Array, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        const startTime = performance.now();

        // Ensure model is loaded
        if (!this.model) {
            await this.loadModel(VOSK_SMALL.id);
        }

        // Create abort controller for this transcription
        this.abortController = new AbortController();

        // Create recognizer
        this.recognizer = new (this.model as Model).KaldiRecognizer(options.sampleRate || 16000);

        const results: string[] = [];
        let partialResult = "";
        let messagesSent = 0;
        let responsesReceived = 0;

        return new Promise<TranscriptionResult>((resolve, reject) => {
            const onAbort = () => {
                reject(new Error("Transcription cancelled"));
            };
            this.abortController!.signal.addEventListener("abort", onAbort);

            const maybeResolve = () => {
                if (responsesReceived >= messagesSent) {
                    const finalText = results.join(" ").trim();
                    const processingTime = performance.now() - startTime;

                    // Create single segment for Vosk (doesn't provide word-level timing)
                    const segments: TranscriptionSegment[] = finalText
                        ? [{
                            id: 0,
                            start: 0,
                            end: processingTime / 1000,
                            text: finalText,
                            confidence: 1.0,
                        }]
                        : [];

                    resolve({
                        text: finalText,
                        confidence: 1.0,
                        segments,
                        language: options.language || "en",
                        processingTime,
                        isPartial: false,
                    });
                }
            };

            this.recognizer!.on("result", (message) => {
                if (message.result?.text) {
                    results.push(message.result.text);
                }
                responsesReceived++;
                maybeResolve();
            });

            this.recognizer!.on("partialresult", (message) => {
                if (message.result?.partial) {
                    partialResult = message.result.partial;
                }
                responsesReceived++;
                maybeResolve();
            });

            this.recognizer!.on("error", (message) => {
                reject(new Error(message.error || "Vosk recognition error"));
            });

            // Process audio in chunks
            const chunkSize = 8000;
            const sampleRate = options.sampleRate || 16000;

            for (let i = 0; i < audioData.length && !this.abortController!.signal.aborted; i += chunkSize) {
                const end = Math.min(i + chunkSize, audioData.length);
                const chunk = audioData.subarray(i, end);
                this.recognizer!.acceptWaveformFloat(chunk, sampleRate);
                messagesSent++;
            }

            if (this.abortController!.signal.aborted) {
                return;
            }

            // Get final result
            this.recognizer!.retrieveFinalResult();
            messagesSent++;

            // Cleanup listener
            this.abortController!.signal.removeEventListener("abort", onAbort);
        }).finally(() => {
            // Cleanup recognizer
            if (this.recognizer) {
                this.recognizer.remove();
                this.recognizer = null;
            }
        });
    }

    /**
     * Transcribe a voice message from URL.
     * Convenience method that matches existing transcribe.ts API.
     * Maintains backward compatibility with existing code.
     *
     * @param messageId - Unique message identifier for caching
     * @param audioUrl - URL to fetch audio from
     * @returns Promise resolving when transcription completes
     */
    async transcribeVoiceMessage(messageId: string, audioUrl: string): Promise<void> {
        // Check cache first
        if (this.transcriptionCache.has(messageId)) {
            this.notifyListeners(messageId, this.transcriptionCache.get(messageId)!);
            return;
        }

        try {
            // Fetch audio blob
            const response = await fetch(audioUrl, { signal: this.abortController?.signal });
            const audioBlob = await response.blob();

            // Decode audio using OfflineAudioContext
            const audioBuffer = await new OfflineAudioContext(1, 9600000, 16000)
                .decodeAudioData(await audioBlob.arrayBuffer());

            // Get channel data as Float32Array
            const audioData = audioBuffer.getChannelData(0);

            // Transcribe
            const result = await this.transcribe(audioData, { sampleRate: 16000 });

            // Cache and notify
            if (result.text) {
                this.transcriptionCache.set(messageId, result.text);
                this.notifyListeners(messageId, result.text);
            }
        } catch (err) {
            console.error("Transcription failed:", err);
            throw err;
        }
    }

    /**
     * Abort any ongoing transcription or model loading.
     * Uses AbortController pattern from existing implementation.
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        if (this.recognizer) {
            this.recognizer.remove();
            this.recognizer = null;
        }
    }

    /**
     * Dispose of resources and unload models.
     * Called when switching backends or plugin stops.
     */
    async dispose(): Promise<void> {
        this.abort();
        this.model = null;
        this.modelPromise = null;
        this.currentModelUrl = null;
    }

    /**
     * Add a listener for transcription updates.
     * Maintains backward compatibility with existing TranscriptionListeners pattern.
     *
     * @param listener - Callback function for transcription updates
     * @returns Unsubscribe function
     */
    addTranscriptionListener(listener: (messageId: string, text: string | undefined) => void): () => void {
        this.transcriptionListeners.add(listener);
        return () => {
            this.transcriptionListeners.delete(listener);
        };
    }

    /**
     * Notify all listeners of a transcription update.
     *
     * @param messageId - Message identifier
     * @param text - Transcribed text (undefined to clear cache)
     */
    private notifyListeners(messageId: string, text: string | undefined): void {
        if (text === undefined) {
            this.transcriptionCache.delete(messageId);
        } else {
            this.transcriptionCache.set(messageId, text);
        }

        for (const listener of this.transcriptionListeners) {
            listener(messageId, text);
        }
    }

    /**
     * Cancel a specific transcription job.
     * Maintains backward compatibility with existing cancelTranscription() behavior.
     *
     * @param messageId - Message identifier to cancel
     */
    cancelTranscription(messageId: string): void {
        this.transcriptionCache.delete(messageId);
        this.abort();
        this.notifyListeners(messageId, undefined);
    }

    /**
     * Get cached transcription for a message.
     *
     * @param messageId - Message identifier
     * @returns Cached text or undefined
     */
    getCachedTranscription(messageId: string): string | undefined {
        return this.transcriptionCache.get(messageId);
    }

    /**
     * Check if a message has a cached transcription.
     *
     * @param messageId - Message identifier
     * @returns true if cached
     */
    hasCachedTranscription(messageId: string): boolean {
        return this.transcriptionCache.has(messageId);
    }
}

// Export singleton instance for backward compatibility
export const voskBackend = new VoskBackend();
