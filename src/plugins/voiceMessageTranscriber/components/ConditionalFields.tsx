/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Conditional Field Disabling Utilities
 *
 * Provides helper functions to disable/hide fields based on selections.
 * Used in settings panels to guide users away from incompatible combinations
 * with clear explanations via tooltips.
 */

import { DeviceType, BackendType } from "../utils/hardwareDetect";

// ============================================================================
// Type Definitions
// ============================================================================

/** Options for device selector */
export interface DeviceOption {
    value: DeviceType;
    label: string;
    disabled?: boolean;
    tooltip?: string;
}

/** Options for backend selector */
export interface BackendOption {
    value: BackendType;
    label: string;
    disabled?: boolean;
    tooltip?: string;
}

/** Options for model selector */
export interface ModelOption {
    value: string;
    label: string;
    disabled?: boolean;
    tooltip?: string;
}

/** Disable reason messages keyed by type-value combinations */
export type DisableReasonKey =
    | `device-${string}`
    | `backend-${string}`
    | `model-${string}`;

// ============================================================================
// Device Disabling Logic
// ============================================================================

/**
 * Determines if a device option should be disabled based on backend selection.
 *
 * Rules:
 * - Vosk backend only supports CPU (WASM execution)
 * - ONNX CPU backend doesn't support GPU device
 * - WebGPU device requires WebGPU-compatible backend
 *
 * @param backend - Currently selected backend
 * @param device - Device type to check
 * @returns true if the device should be disabled
 *
 * @example
 * ```typescript
 * isDeviceDisabled('vosk', 'gpu'); // true (Vosk is CPU-only)
 * isDeviceDisabled('onnx-wasm', 'webgpu'); // true (WASM runs on CPU)
 * ```
 */
export const isDeviceDisabled = (backend: BackendType, device: DeviceType): boolean => {
    // Vosk backend (vosk-browser) uses WASM and only supports CPU
    if (backend === 'vosk' && device !== 'cpu') {
        return true;
    }

    // ONNX WASM backend runs on CPU only
    if (backend === 'onnx-wasm' && device !== 'cpu') {
        return true;
    }

    // ONNX WebGPU backend requires webgpu device or cpu fallback
    if (backend === 'onnx-webgpu' && device === 'webgl') {
        // WebGL is not used with ONNX WebGPU - use webgpu or cpu
        return true;
    }

    // whisper-cpp runs natively on CPU
    if (backend === 'whisper-cpp' && device !== 'cpu') {
        return true;
    }

    return false;
};

// ============================================================================
// Backend Disabling Logic
// ============================================================================

/**
 * Determines if a backend option should be disabled based on hardware availability.
 *
 * Rules:
 * - ONNX WebGPU backend disabled when WebGPU unavailable
 * - Some backends may have platform-specific limitations
 *
 * @param backend - Backend type to check
 * @param hasWebGPU - Whether WebGPU is available in current browser
 * @returns true if the backend should be disabled
 *
 * @example
 * ```typescript
 * isBackendDisabled('onnx-webgpu', false); // true (no WebGPU support)
 * isBackendDisabled('onnx-wasm', false); // false (WASM always available)
 * ```
 */
export const isBackendDisabled = (backend: BackendType, hasWebGPU: boolean): boolean => {
    // ONNX WebGPU requires WebGPU support
    if (backend === 'onnx-webgpu' && !hasWebGPU) {
        return true;
    }

    // Transformers.js can use WebGPU for better performance
    if (backend === 'transformers-js' && !hasWebGPU) {
        // Not strictly disabled but suboptimal - caller decides
        return false;
    }

    return false;
};

/**
 * Check if a backend is suboptimal (not disabled but warned)
 *
 * @param backend - Backend type to check
 * @param hasWebGPU - Whether WebGPU is available
 * @returns true if backend works but isn't optimal
 */
export const isBackendSuboptimal = (backend: BackendType, hasWebGPU: boolean): boolean => {
    // Running non-WebGPU backends when WebGPU is available
    if (hasWebGPU && (backend === 'onnx-wasm' || backend === 'vosk')) {
        return true;
    }
    return false;
};

// ============================================================================
// Model Disabling Logic
// ============================================================================

/**
 * Determines if a model option should be disabled based on download status.
 *
 * Rules:
 * - Undownloaded models are disabled in selector until downloaded
 * - Some models may require specific backends
 *
 * @param modelId - Model identifier
 * @param isDownloaded - Whether model is downloaded and cached
 * @param requiredBackend - Optional: required backend for this model
 * @param currentBackend - Optional: currently selected backend
 * @returns true if the model should be disabled
 *
 * @example
 * ```typescript
 * isModelDisabled('whisper-turbo', false); // true (not downloaded)
 * isModelDisabled('whisper-base', true); // false (available)
 * ```
 */
export const isModelDisabled = (
    modelId: string,
    isDownloaded: boolean,
    requiredBackend?: BackendType,
    currentBackend?: BackendType
): boolean => {
    // Must be downloaded first
    if (!isDownloaded) {
        return true;
    }

    // Check backend compatibility if both provided
    if (requiredBackend && currentBackend && requiredBackend !== currentBackend) {
        return true;
    }

    return false;
};

/**
 * Check if model is compatible with current backend
 *
 * @param modelSupportedBackends - List of backends the model supports
 * @param currentBackend - Currently selected backend
 * @returns true if incompatible
 */
export const isModelIncompatibleWithBackend = (
    modelSupportedBackends: BackendType[],
    currentBackend: BackendType
): boolean => {
    return !modelSupportedBackends.includes(currentBackend);
};

// ============================================================================
// Disable Reason Messages
// ============================================================================

/**
 * Gets a human-readable explanation for why a field is disabled.
 *
 * @param type - Type of field ('device', 'backend', or 'model')
 * @param value - The value that is disabled
 * @param context - Additional context for the message
 * @returns Tooltip message explaining the disable reason
 *
 * @example
 * ```typescript
 * getDisabledReason('device', 'gpu', { backend: 'vosk' });
 * // Returns: 'Vosk only supports CPU execution (WASM)'
 * ```
 */
export const getDisabledReason = (
    type: 'device' | 'backend' | 'model',
    value: string,
    context?: { backend?: BackendType; hasWebGPU?: boolean }
): string => {
    const { backend, hasWebGPU } = context || {};

    // Device disable reasons
    if (type === 'device') {
        if (backend === 'vosk' && value !== 'cpu') {
            return 'Vosk only supports CPU execution (WebAssembly)';
        }
        if (backend === 'onnx-wasm' && value !== 'cpu') {
            return 'ONNX WASM runs on CPU only';
        }
        if (backend === 'whisper-cpp' && value !== 'cpu') {
            return 'Whisper.cpp runs natively on CPU';
        }
        if (value === 'webgpu' && hasWebGPU === false) {
            return 'WebGPU not available in this browser';
        }
        return `${value.toUpperCase()} not available with ${backend} backend`;
    }

    // Backend disable reasons
    if (type === 'backend') {
        if (value === 'onnx-webgpu' && hasWebGPU === false) {
            return 'WebGPU not available in this browser';
        }
        if (value === 'transformers-js') {
            return 'WebGPU recommended for best performance';
        }
        return `${value} backend not available`;
    }

    // Model disable reasons
    if (type === 'model') {
        return 'Model must be downloaded first (see Downloads panel)';
    }

    return 'Not available';
};

/**
 * Gets a warning message for suboptimal configurations (not disabled, but warned)
 *
 * @param type - Type of field
 * @param value - The current value
 * @param context - Additional context
 * @returns Warning message or undefined if no warning
 */
export const getSuboptimalWarning = (
    type: 'device' | 'backend',
    value: string,
    context?: { hasWebGPU?: boolean; hasNPUSupport?: boolean }
): string | undefined => {
    const { hasWebGPU } = context || {};

    if (type === 'backend') {
        if (hasWebGPU && value === 'onnx-wasm') {
            return 'WebGPU available - using WASM for compatibility. Switch to ONNX WebGPU for faster inference.';
        }
        if (hasWebGPU && value === 'vosk') {
            return 'WebGPU available but using Vosk. Consider ONNX WebGPU for better performance.';
        }
    }

    if (type === 'device') {
        if (value === 'cpu' && hasWebGPU) {
            return 'GPU available but using CPU. Select WebGPU for faster inference if supported.';
        }
    }

    return undefined;
};

// ============================================================================
// Option Builders
// ============================================================================

/**
 * Build device options with disabled states and tooltips applied.
 *
 * @param backend - Currently selected backend
 * @param hasWebGPU - Whether WebGPU is available
 * @param baseOptions - Base device options without disabled states
 * @returns Device options with disabled/tooltip properties set
 */
export const buildDeviceOptions = (
    backend: BackendType,
    hasWebGPU: boolean,
    baseOptions: Array<{ value: DeviceType; label: string }>
): DeviceOption[] => {
    return baseOptions.map(opt => {
        const disabled = isDeviceDisabled(backend, opt.value);
        const tooltip = disabled
            ? getDisabledReason('device', opt.value, { backend, hasWebGPU })
            : getSuboptimalWarning('device', opt.value, { hasWebGPU });

        return {
            ...opt,
            disabled,
            tooltip,
        };
    });
};

/**
 * Build backend options with disabled states and tooltips applied.
 *
 * @param hasWebGPU - Whether WebGPU is available
 * @param baseOptions - Base backend options without disabled states
 * @returns Backend options with disabled/tooltip properties set
 */
export const buildBackendOptions = (
    hasWebGPU: boolean,
    baseOptions: Array<{ value: BackendType; label: string }>
): BackendOption[] => {
    return baseOptions.map(opt => {
        const disabled = isBackendDisabled(opt.value, hasWebGPU);
        const tooltip = disabled
            ? getDisabledReason('backend', opt.value, { hasWebGPU })
            : getSuboptimalWarning('backend', opt.value, { hasWebGPU });

        return {
            ...opt,
            disabled,
            tooltip,
        };
    });
};

/**
 * Build model options with disabled states based on download status.
 *
 * @param downloadedModels - Set of downloaded model IDs
 * @param baseOptions - Base model options
 * @param currentBackend - Currently selected backend (for compatibility check)
 * @returns Model options with disabled/tooltip properties set
 */
export const buildModelOptions = (
    downloadedModels: Set<string>,
    baseOptions: Array<{ value: string; label: string; supportedBackends?: BackendType[] }>,
    currentBackend?: BackendType
): ModelOption[] => {
    return baseOptions.map(opt => {
        const isDownloaded = downloadedModels.has(opt.value);
        const requiredBackend = opt.supportedBackends?.[0];
        const disabled = isModelDisabled(
            opt.value,
            isDownloaded,
            requiredBackend,
            currentBackend
        );

        let tooltip: string | undefined;
        if (disabled) {
            if (!isDownloaded) {
                tooltip = getDisabledReason('model', opt.value);
            } else if (currentBackend && opt.supportedBackends) {
                tooltip = `Not compatible with ${currentBackend}. Supports: ${opt.supportedBackends.join(', ')}`;
            }
        }

        return {
            ...opt,
            disabled,
            tooltip,
        };
    });
};

// ============================================================================
// React Component Props Helpers
// ============================================================================

/**
 * Props for conditional field components
 */
export interface ConditionalFieldProps {
    /** Current backend selection */
    backend: BackendType;
    /** Current device selection */
    device: DeviceType;
    /** Whether WebGPU is available */
    hasWebGPU: boolean;
    /** Set of downloaded model IDs */
    downloadedModels: Set<string>;
}

/**
 * Get recommended device for a backend (for auto-selecting compatible options)
 *
 * @param backend - Target backend
 * @param hasWebGPU - Whether WebGPU available
 * @returns Recommended device type
 */
export const getRecommendedDevice = (
    backend: BackendType,
    hasWebGPU: boolean
): DeviceType => {
    switch (backend) {
        case 'onnx-webgpu':
            return hasWebGPU ? 'webgpu' : 'cpu';
        case 'onnx-wasm':
        case 'vosk':
        case 'whisper-cpp':
            return 'cpu';
        case 'transformers-js':
            return hasWebGPU ? 'webgpu' : 'cpu';
        default:
            return 'cpu';
    }
};

/**
 * Check if current device/backend combination is valid
 *
 * @param backend - Current backend
 * @param device - Current device
 * @returns true if combination is valid
 */
export const isValidCombination = (backend: BackendType, device: DeviceType): boolean => {
    return !isDeviceDisabled(backend, device);
};

/**
 * Get validation error message for invalid combinations
 *
 * @param backend - Current backend
 * @param device - Current device
 * @returns Error message or null if valid
 */
export const getValidationError = (
    backend: BackendType,
    device: DeviceType
): string | null => {
    if (isValidCombination(backend, device)) {
        return null;
    }

    return getDisabledReason('device', device, { backend });
};

// ============================================================================
// Exports
// ============================================================================

export default {
    isDeviceDisabled,
    isBackendDisabled,
    isBackendSuboptimal,
    isModelDisabled,
    isModelIncompatibleWithBackend,
    getDisabledReason,
    getSuboptimalWarning,
    buildDeviceOptions,
    buildBackendOptions,
    buildModelOptions,
    getRecommendedDevice,
    isValidCombination,
    getValidationError,
};
