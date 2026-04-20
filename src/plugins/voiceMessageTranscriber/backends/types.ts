/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * ASR Backend Abstraction Layer - Type Definitions
 *
 * This module provides TypeScript interfaces for implementing
 * Automatic Speech Recognition (ASR) backends that can be
 * switched at runtime.
 */

/** Device types for running inference */
export enum DeviceType {
    /** CPU inference (always available) */
    CPU = "cpu",
    /** GPU inference via WebGPU */
    GPU = "gpu",
    /** Neural Processing Unit (NPU) on supported hardware */
    NPU = "npu",
}

/** Model quantization levels for optimizing size vs accuracy */
export enum Quantization {
    /** No quantization, full precision (FP32) */
    FP32 = "fp32",
    /** Half precision (FP16) */
    FP16 = "fp16",
    /** 8-bit quantization */
    INT8 = "int8",
    /** 4-bit quantization (most compressed) */
    Q4 = "q4",
    /** 5-bit quantization */
    Q5 = "q5",
    /** 8-bit per-channel quantization */
    Q8 = "q8",
}

/** Component specification for multi-file models */
export interface ModelComponent {
    /** Component identifier (e.g., 'encoder', 'decoder', 'joiner') */
    id: string;
    /** File name for this component */
    filename: string;
    /** HuggingFace URL or local path */
    url: string;
    /** SHA256 checksum for integrity verification */
    checksum: string;
    /** Size in bytes */
    size: number;
    /** Quantization level for this component */
    quantization: Quantization;
}

/** Configuration for a speech recognition model */
export interface ModelConfig {
    /** Unique model identifier (e.g., 'whisper-turbo-onnx') */
    id: string;
    /** Human-readable model name */
    name: string;
    /** Backend type identifier */
    backend: string;
    /** Total model size in bytes */
    size: number;
    /** HuggingFace model URL or repository path */
    hfUrl: string;
    /** Supported language codes (ISO 639-1, '*' for all) */
    languages: string[];
    /** Whether model uses multiple components (encoder/decoder/joiner) */
    isMultiComponent: boolean;
    /** Model components (if multi-component) */
    components?: ModelComponent[];
    /** Single file checksum (if single-file model) */
    checksum?: string;
    /** Default quantization level */
    defaultQuantization: Quantization;
    /** Supported quantization levels for this model */
    supportedQuantizations: Quantization[];
    /** Model description */
    description?: string;
    /** Model version */
    version?: string;
}

/** Options for transcription requests */
export interface TranscriptionOptions {
    /** Target language code (e.g., 'en', 'auto' for auto-detect) */
    language?: string;
    /** Enable partial results streaming */
    stream?: boolean;
    /** Audio sample rate in Hz (default: 16000) */
    sampleRate?: number;
    /** Maximum duration in seconds */
    maxDuration?: number;
    /** Beam search width for decoding (higher = more accurate but slower) */
    beamSize?: number;
    /** Best-of N sampling for greedy decoding */
    bestOf?: number;
    /** Temperature for sampling (0.0 = deterministic) */
    temperature?: number;
    /** Patience factor for beam search */
    patience?: number;
    /** Length penalty factor */
    lengthPenalty?: number;
    /** Suppress blank outputs at beginning/end */
    suppressBlank?: boolean;
    /** Suppress non-speech tokens */
    suppressTokens?: number[];
    /** Initial prompt text to guide transcription */
    initialPrompt?: string;
    /** Prefix text to prepend to output */
    prefix?: string;
}

/** Individual word or segment with timing information */
export interface TranscriptionSegment {
    /** Segment index */
    id: number;
    /** Start time in seconds */
    start: number;
    /** End time in seconds */
    end: number;
    /** Transcribed text */
    text: string;
    /** Confidence score (0-1) */
    confidence?: number;
    /** Word-level timestamps (if available) */
    words?: Array<{
        word: string;
        start: number;
        end: number;
        confidence?: number;
    }>;
}

/** Result of a transcription operation */
export interface TranscriptionResult {
    /** Complete transcribed text */
    text: string;
    /** Confidence score for entire transcription (0-1) */
    confidence: number;
    /** Segments with timing information */
    segments: TranscriptionSegment[];
    /** Detected language code */
    language: string;
    /** Processing time in milliseconds */
    processingTime: number;
    /** Whether result is partial (streaming) or final */
    isPartial: boolean;
    /** Raw backend-specific output (for debugging) */
    raw?: unknown;
}

/** Progress callback for model loading and transcription */
export type ProgressCallback = (progress: {
    /** Progress percentage (0-100) */
    percent: number;
    /** Current operation description */
    message: string;
    /** Bytes loaded so far (if applicable) */
    loadedBytes?: number;
    /** Total bytes to load (if applicable) */
    totalBytes?: number;
}) => void;

/** ASR Backend interface for implementing speech recognition providers */
export interface ASRBackend {
    /** Backend identifier (e.g., 'onnx-webgpu', 'vosk-browser') */
    id: string;
    /** Human-readable backend name */
    name: string;
    /** Models supported by this backend */
    supportedModels: ModelConfig[];

    /**
     * Initialize the backend (e.g., load runtime, warm up GPU)
     * Called once when backend is selected.
     */
    initialize(): Promise<void>;

    /**
     * Load a specific model into memory
     * @param modelId - Model identifier from supportedModels
     * @param onProgress - Optional progress callback
     */
    loadModel(modelId: string, onProgress?: ProgressCallback): Promise<void>;

    /**
     * Check if this quantization level is supported
     * @param quant - Quantization level to check
     */
    supportsQuantization(quant: Quantization): boolean;

    /**
     * Check if this device type is supported
     * @param device - Device type to check
     */
    supportsDevice(device: DeviceType): boolean;

    /**
     * Check if backend is available in current environment
     * (e.g., WebGPU support, required APIs present)
     */
    isAvailable(): Promise<boolean>;

    /**
     * Transcribe audio data to text
     * @param audioData - Raw PCM audio samples (Float32Array)
     * @param options - Transcription options
     * @returns Promise resolving to transcription result
     */
    transcribe(audioData: Float32Array, options: TranscriptionOptions): Promise<TranscriptionResult>;

    /**
     * Abort any ongoing transcription or model loading
     */
    abort(): void;

    /**
     * Dispose of resources and unload models
     * Called when switching backends or plugin stops.
     */
    dispose?(): Promise<void>;
}

/** Union type of all supported backend implementations */
export type ASRBackendImplementation =
    | ONNXWebGPUBackend
    | VoskBackend
    | TransformersJSBackend
    | MoonshineBackend;

/** Placeholder for ONNX Runtime Web GPU backend */
export type ONNXWebGPUBackend = ASRBackend & {
    id: "onnx-webgpu";
};

/** Vosk browser backend (legacy implementation) */
export type VoskBackend = ASRBackend & {
    id: "vosk";
};

/** Placeholder for Transformers.js backend */
export type TransformersJSBackend = ASRBackend & {
    id: "transformers-js";
};

/** Placeholder for Moonshine ASR backend */
export type MoonshineBackend = ASRBackend & {
    id: "moonshine";
};

/** Backend capability report */
export interface BackendCapabilities {
    /** Backend identifier */
    backendId: string;
    /** Whether backend is available */
    isAvailable: boolean;
    /** Available device types */
    availableDevices: DeviceType[];
    /** Supported quantization levels */
    supportedQuantizations: Quantization[];
    /** Recommended default model */
    recommendedModel?: string;
    /** Error message if not available */
    unavailableReason?: string;
}

/** Model download status */
export interface ModelDownloadStatus {
    /** Model identifier */
    modelId: string;
    /** Download state */
    state: "pending" | "downloading" | "cached" | "error";
    /** Progress percentage (0-100) */
    progress: number;
    /** Bytes downloaded */
    loadedBytes: number;
    /** Total bytes */
    totalBytes: number;
    /** Error message if failed */
    error?: string;
}


