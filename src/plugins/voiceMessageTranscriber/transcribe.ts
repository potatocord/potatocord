/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import { settings } from "./settings";
import { showUserError } from "./utils/errorTranslator";
import { ASRBackend } from "./backends/types";
import { voskBackend } from "./backends/VoskBackend";
import { onnxWebGPUBackend } from "./backends/ONNXWebGPUBackend";
import { onnxCPUBackend } from "./backends/ONNXCPUBackend";
import { ASRBackend as ASRBackendId } from "./models/registry";

const Native = VencordNative.pluginHelpers.VoiceMessageTranscriber as PluginNative<typeof import("./native")>;

// Backend Registry

const backends: Record<ASRBackendId, ASRBackend> = {
    "vosk": voskBackend,
    "onnx-webgpu": onnxWebGPUBackend,
    "onnx-cpu": onnxCPUBackend,
};

let activeBackendInstance: ASRBackend | null = null;
let currentBackendId: ASRBackendId | null = null;

/**
 * Get the currently active backend based on settings.
 * Implements lazy initialization and backend instance caching.
 * Supports backend switching without page reload.
 */
export async function getActiveBackend(): Promise<ASRBackend> {
    const backendId = settings.store.activeBackend;

    if (currentBackendId !== backendId) {
        if (activeBackendInstance && currentBackendId) {
            try {
                await activeBackendInstance.dispose?.();
            } catch (err) {
                console.warn("[VoiceMessageTranscriber] Error disposing old backend:", err);
            }
        }

        activeBackendInstance = null;
        currentBackendId = backendId;
    }

    if (activeBackendInstance) {
        return activeBackendInstance;
    }

    const backend = backends[backendId];
    if (!backend) {
        throw new Error(`Unknown backend: ${backendId}`);
    }

    const isAvailable = await backend.isAvailable();
    if (!isAvailable) {
        throw new Error(`Backend ${backendId} is not available in this environment`);
    }

    await backend.initialize();
    activeBackendInstance = backend;

    return backend;
}

export async function warmupBackend(): Promise<void> {
    try {
        const backend = await getActiveBackend();
        console.log("[VoiceMessageTranscriber] Backend warmed up:", backend.id);
    } catch (err) {
        console.warn("[VoiceMessageTranscriber] Backend warmup failed:", err);
    }
}

/**
 * Switch to a different backend at runtime.
 * Disposes the current backend and clears the cache.
 */
export async function switchBackend(backendId: ASRBackendId): Promise<void> {
    if (currentBackendId === backendId) {
        return;
    }

    if (activeBackendInstance) {
        try {
            await activeBackendInstance.dispose?.();
        } catch (err) {
            console.warn("[VoiceMessageTranscriber] Error disposing backend during switch:", err);
        }
        activeBackendInstance = null;
    }

    settings.store.activeBackend = backendId;
    currentBackendId = backendId;

    const newBackend = backends[backendId];
    if (!newBackend) {
        throw new Error(`Unknown backend: ${backendId}`);
    }

    await newBackend.initialize();
    activeBackendInstance = newBackend;
}

// Transcription Cache & Listeners

export const TranscriptionCache = new Map<string, string>();
export const TranscriptionInProgress = new Set<string>();
const TranscriptionListeners = new Set<(messageId: string, text: string | undefined) => void>();
const activeJobs = new Map<string, () => void>();

export function isTranscriptionInProgress(messageId: string): boolean {
    return TranscriptionInProgress.has(messageId);
}

export function addTranscriptionListener(listener: (messageId: string, text: string | undefined) => void) {
    TranscriptionListeners.add(listener);
    return () => {
        TranscriptionListeners.delete(listener);
    };
}

function notifyListeners(messageId: string, text: string | undefined) {
    if (text === undefined) {
        TranscriptionCache.delete(messageId);
    } else {
        TranscriptionCache.set(messageId, text);
    }

    for (const listener of TranscriptionListeners) {
        listener(messageId, text);
    }
}

export function cancelTranscription(messageId: string) {
    const cancel = activeJobs.get(messageId);
    if (cancel) {
        cancel();
        activeJobs.delete(messageId);
    }

    TranscriptionInProgress.delete(messageId);

    // Abort the backend to free resources
    if (activeBackendInstance) {
        try {
            activeBackendInstance.abort();
        } catch (err) {
            console.warn("[VoiceMessageTranscriber] Error aborting backend:", err);
        }
    }

    notifyListeners(messageId, undefined);
}

// Audio Fetching & Decoding

async function fetchAudioBlob(audioUrl: string, signal: AbortSignal): Promise<Blob> {
    if (IS_DISCORD_DESKTOP) {
        const result = await Native.fetchAudioBlob(audioUrl);
        if (result.error) throw new Error(result.error);
        if (!result.data) throw new Error("No data returned from native fetch");
        return new Blob([result.data]);
    } else {
        const response = await fetch(audioUrl, { signal });
        return response.blob();
    }
}

async function decodeAudio(audioBlob: Blob): Promise<AudioBuffer> {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const offlineContext = new OfflineAudioContext(1, 9600000, 16000);
    return offlineContext.decodeAudioData(arrayBuffer);
}

function getChannelData(audioBuffer: AudioBuffer): Float32Array {
    return audioBuffer.getChannelData(0);
}

// Main Transcription Function

export async function transcribeVoiceMessage(messageId: string, audioUrl: string) {
    if (TranscriptionCache.has(messageId)) {
        notifyListeners(messageId, TranscriptionCache.get(messageId)!);
        return;
    }

    if (activeJobs.has(messageId)) return;

    const abortController = new AbortController();

    const cleanup = () => {
        abortController.abort();
        activeJobs.delete(messageId);
        TranscriptionInProgress.delete(messageId);
    };

    activeJobs.set(messageId, cleanup);
    TranscriptionInProgress.add(messageId);
    notifyListeners(messageId, "");

    try {
        showToast("Starting transcription...", Toasts.Type.MESSAGE);

        const backend = await getActiveBackend();

        const modelId = settings.store.activeModel;
        await backend.loadModel(modelId, (progress) => {
            if (progress.percent < 100) {
                showToast(`Loading model: ${Math.round(progress.percent)}%`, Toasts.Type.MESSAGE);
            }
        });

        if (abortController.signal.aborted) return;

        const audioBlob = await fetchAudioBlob(audioUrl, abortController.signal);

        if (abortController.signal.aborted) return;

        const audioBuffer = await decodeAudio(audioBlob);

        if (abortController.signal.aborted) return;

        const audioData = getChannelData(audioBuffer);

        const result = await backend.transcribe(audioData, {
            sampleRate: 16000,
            language: settings.store.activeBackend === "vosk" ? "en" : (settings.store.language || "auto"),
        });

        if (abortController.signal.aborted) return;

        TranscriptionInProgress.delete(messageId);

        if (result.text) {
            notifyListeners(messageId, result.text);
            showToast("Transcription complete", Toasts.Type.SUCCESS);
        } else {
            notifyListeners(messageId, undefined);
            showToast("Could not transcribe audio", Toasts.Type.FAILURE);
        }

    } catch (err: any) {
        TranscriptionInProgress.delete(messageId);
        if (err.message === "Transcription cancelled" || abortController.signal.aborted) {
            console.log("Transcription cancelled for message", messageId);
            notifyListeners(messageId, undefined);
            return;
        }
        notifyListeners(messageId, undefined);
        showUserError(err, "transcribeVoiceMessage");
    } finally {
        activeJobs.delete(messageId);
    }
}

// Backward Compatibility Helpers

/** @deprecated Use getActiveBackend() instead */
export async function getVoskModel() {
    if (settings.store.activeBackend !== "vosk") {
        console.warn("[VoiceMessageTranscriber] getVoskModel() called but Vosk is not the active backend");
    }
    await voskBackend.loadModel(settings.store.activeModel);
    return voskBackend;
}

export async function isBackendAvailable(backendId: ASRBackendId): Promise<boolean> {
    const backend = backends[backendId];
    if (!backend) return false;
    return backend.isAvailable();
}

export async function getAvailableBackends(): Promise<ASRBackendId[]> {
    const available: ASRBackendId[] = [];
    for (const id of Object.keys(backends) as ASRBackendId[]) {
        if (await backends[id].isAvailable()) {
            available.push(id);
        }
    }
    return available;
}

export { voskBackend, onnxWebGPUBackend, onnxCPUBackend };
