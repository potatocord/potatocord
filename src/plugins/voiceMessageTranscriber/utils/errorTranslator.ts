/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Error Translation Layer
 *
 * Maps raw backend errors to user-friendly messages with error codes.
 * Ensures users see helpful messages, not stack traces, while
 * developers have full error details in the console.
 *
 * @module voiceMessageTranscriber/utils/errorTranslator
 */

import { showToast, Toasts } from "@webpack/common";

/**
 * Error mapping configuration
 * Each entry contains user-friendly message, optional action, and debug code
 */
const errorMap: Record<string, { message: string; action?: string; code: string }> = {
    // Network errors
    "NetworkError": {
        message: "Failed to download model. Please check your internet connection.",
        action: "Retry",
        code: "ASR-NET-001"
    },
    "TypeError": {
        message: "Network request failed. Please check your internet connection.",
        action: "Retry",
        code: "ASR-NET-002"
    },
    "AbortError": {
        message: "Download was cancelled or timed out. Please try again.",
        action: "Retry",
        code: "ASR-NET-003"
    },
    "FetchError": {
        message: "Failed to fetch data from server. Please check your connection.",
        action: "Retry",
        code: "ASR-NET-004"
    },

    // Storage errors
    "QuotaExceededError": {
        message: "Storage full. Delete unused models in settings.",
        action: "Open Settings",
        code: "ASR-STOR-001"
    },
    "NotFoundError": {
        message: "Stored data not found. The model may need to be re-downloaded.",
        action: "Re-download",
        code: "ASR-STOR-002"
    },
    "DataError": {
        message: "Database operation failed. Try clearing model cache.",
        action: "Clear Cache",
        code: "ASR-STOR-003"
    },

    // Hardware/WebGPU errors
    "WebGPUNotAvailable": {
        message: "WebGPU not available. Using CPU fallback (slower).",
        code: "ASR-HW-001"
    },
    "WebGPUError": {
        message: "WebGPU encountered an error. Switching to CPU mode.",
        action: "Switch Backend",
        code: "ASR-HW-002"
    },
    "WebGLNotSupported": {
        message: "WebGL not supported. Using CPU fallback.",
        code: "ASR-HW-003"
    },

    // Memory errors
    "OutOfMemory": {
        message: "Not enough memory. Try a smaller model or close other applications.",
        action: "View Models",
        code: "ASR-MEM-001"
    },
    "RangeError": {
        message: "Memory limit exceeded. Try a smaller model or restart Discord.",
        action: "View Models",
        code: "ASR-MEM-002"
    },
    "MemoryError": {
        message: "Insufficient memory for model. Close other applications and try again.",
        action: "View Models",
        code: "ASR-MEM-003"
    },

    // ONNX Runtime errors
    "ONNXRuntimeError": {
        message: "Model failed to load. Try re-downloading or using a different model.",
        action: "Re-download",
        code: "ASR-ONNX-001"
    },
    "ONNXError": {
        message: "Inference engine error. Try using a different backend.",
        action: "Switch Backend",
        code: "ASR-ONNX-002"
    },
    "SessionLoadError": {
        message: "Failed to load model session. Model file may be corrupted.",
        action: "Re-download",
        code: "ASR-ONNX-003"
    },

    // Transformers.js errors
    "TransformersJSError": {
        message: "Speech recognition failed. Check audio format and try again.",
        code: "ASR-TRAN-001"
    },
    "PipelineError": {
        message: "Transcription pipeline failed. Try again with a different audio file.",
        code: "ASR-TRAN-002"
    },
    "TokenizerError": {
        message: "Audio processing failed. The audio format may not be supported.",
        code: "ASR-TRAN-003"
    },

    // Model corruption/validation errors
    "ModelCorrupted": {
        message: "Model file appears corrupted. Please re-download.",
        action: "Re-download",
        code: "ASR-CHK-001"
    },
    "ChecksumError": {
        message: "Model checksum failed. File may be corrupted during download.",
        action: "Re-download",
        code: "ASR-CHK-002"
    },
    "ValidationError": {
        message: "Model validation failed. Try downloading the model again.",
        action: "Re-download",
        code: "ASR-CHK-003"
    },

    // Audio processing errors
    "AudioDecodingError": {
        message: "Failed to decode audio. The file format may not be supported.",
        code: "ASR-AUD-001"
    },
    "AudioContextError": {
        message: "Audio processing unavailable. Check your browser audio settings.",
        code: "ASR-AUD-002"
    },
    "NoAudioData": {
        message: "No audio data found. The voice message may be empty or corrupted.",
        code: "ASR-AUD-003"
    },

    // Vosk-specific errors
    "VoskError": {
        message: "Speech recognition engine error. Try restarting transcription.",
        code: "ASR-VOSK-001"
    },
    "RecognizerError": {
        message: "Recognition failed. The audio may be unclear or in an unsupported format.",
        code: "ASR-VOSK-002"
    },

    // Cancellation
    "TranscriptionCancelled": {
        message: "Transcription was cancelled.",
        code: "ASR-CAN-001"
    }
};

/**
 * Translates a raw error into user-friendly format
 *
 * @param error - The error to translate
 * @returns Object containing user message, optional action, error code, and logging flag
 */
export function translateError(error: Error): {
    userMessage: string;
    action?: string;
    code: string;
    shouldLog: boolean;
    originalError: Error;
} {
    // Try to match by error name
    const known = errorMap[error.name];
    if (known) {
        return {
            userMessage: known.message,
            action: known.action,
            code: known.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Try to match by checking error message patterns
    const errorMessage = error.message.toLowerCase();

    // Network pattern matching
    if (errorMessage.includes("network") ||
        errorMessage.includes("fetch") ||
        errorMessage.includes("internet") ||
        errorMessage.includes("connection") ||
        errorMessage.includes("offline")) {
        return {
            userMessage: errorMap.NetworkError.message,
            action: errorMap.NetworkError.action,
            code: errorMap.NetworkError.code,
            shouldLog: false,
            originalError: error
        };
    }

    // WebGPU pattern matching
    if (errorMessage.includes("webgpu") ||
        errorMessage.includes("gpu") && errorMessage.includes("not available")) {
        return {
            userMessage: errorMap.WebGPUNotAvailable.message,
            code: errorMap.WebGPUNotAvailable.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Memory pattern matching
    if (errorMessage.includes("out of memory") ||
        errorMessage.includes("memory") && errorMessage.includes("exhausted") ||
        errorMessage.includes("heap") && errorMessage.includes("out of memory") ||
        errorMessage.includes("allocation")) {
        return {
            userMessage: errorMap.OutOfMemory.message,
            action: errorMap.OutOfMemory.action,
            code: errorMap.OutOfMemory.code,
            shouldLog: false,
            originalError: error
        };
    }

    // ONNX pattern matching
    if (errorMessage.includes("onnx") ||
        errorMessage.includes("ort") ||
        errorMessage.includes("inference session")) {
        return {
            userMessage: errorMap.ONNXRuntimeError.message,
            action: errorMap.ONNXRuntimeError.action,
            code: errorMap.ONNXRuntimeError.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Storage quota pattern matching
    if (errorMessage.includes("quota") ||
        errorMessage.includes("storage") && errorMessage.includes("full") ||
        errorMessage.includes("exceeded") && errorMessage.includes("storage")) {
        return {
            userMessage: errorMap.QuotaExceededError.message,
            action: errorMap.QuotaExceededError.action,
            code: errorMap.QuotaExceededError.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Corruption pattern matching
    if (errorMessage.includes("corrupt") ||
        errorMessage.includes("checksum") ||
        errorMessage.includes("invalid") && errorMessage.includes("model") ||
        errorMessage.includes("validation")) {
        return {
            userMessage: errorMap.ModelCorrupted.message,
            action: errorMap.ModelCorrupted.action,
            code: errorMap.ModelCorrupted.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Audio pattern matching
    if (errorMessage.includes("audio") ||
        errorMessage.includes("decode") ||
        errorMessage.includes("wav") ||
        errorMessage.includes("format")) {
        return {
            userMessage: errorMap.AudioDecodingError.message,
            code: errorMap.AudioDecodingError.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Cancellation pattern matching
    if (errorMessage.includes("cancel") ||
        errorMessage.includes("abort")) {
        return {
            userMessage: errorMap.TranscriptionCancelled.message,
            code: errorMap.TranscriptionCancelled.code,
            shouldLog: false,
            originalError: error
        };
    }

    // Unknown error - should be logged for debugging
    return {
        userMessage: "An unexpected error occurred. Please try again.",
        code: "ASR-UNK-001",
        shouldLog: true,
        originalError: error
    };
}

/**
 * Shows a user-friendly error toast and logs appropriately
 *
 * @param error - The error to display
 * @param context - Optional context string for logging
 */
export function showUserError(error: Error, context?: string): void {
    const translated = translateError(error);

    // Show user-friendly toast
    showToast(translated.userMessage, Toasts.Type.FAILURE);

    // Log action availability for potential UI enhancement
    if (translated.action) {
        console.info(`[ErrorTranslator] Error action available: ${translated.action} (Code: ${translated.code})`);
    }

    // Log based on whether this is a known or unknown error
    if (translated.shouldLog) {
        console.error(
            `[ErrorTranslator] [${translated.code}] Unhandled error${context ? ` in ${context}` : ""}:`,
            error
        );
    } else {
        console.debug(
            `[ErrorTranslator] [${translated.code}] Known error${context ? ` in ${context}` : ""}:`,
            error.message
        );
    }
}

/**
 * Translates an error and returns the result without showing a toast.
 * Useful when you want to handle the display differently.
 *
 * @param error - The error to translate
 * @returns The translated error information
 */
export function getTranslatedError(error: Error): {
    userMessage: string;
    action?: string;
    code: string;
    shouldLog: boolean;
    originalError: Error;
} {
    return translateError(error);
}

/**
 * Checks if an error is a known/expected error type
 *
 * @param error - The error to check
 * @returns True if the error is a known type
 */
export function isKnownError(error: Error): boolean {
    const translated = translateError(error);
    return !translated.shouldLog;
}

/**
 * Creates a new Error with a specific name for known error types.
 * Useful for throwing errors that will be properly translated.
 *
 * @param name - The error name (must exist in errorMap)
 * @param message - Optional custom message
 * @returns A new Error with the specified name
 */
export function createKnownError(name: keyof typeof errorMap, message?: string): Error {
    const error = new Error(message || errorMap[name].message);
    error.name = name;
    return error;
}
