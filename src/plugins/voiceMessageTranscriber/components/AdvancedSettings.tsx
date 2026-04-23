/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Advanced Settings Panel for Voice Message Transcriber
 *
 * Provides power users with control over:
 * - Device preference (CPU/WebGL/WebGPU)
 * - Model quantization levels
 * - Cache management
 * - Network and debugging options
 */

import { Button, Forms, React, Slider, useCallback, useMemo, useState } from "@webpack/common";
import { Switch } from "@components/Switch";
import { Quantization } from "@plugins/voiceMessageTranscriber/backends/types";
import { ASRBackend } from "@plugins/voiceMessageTranscriber/models/registry";

export interface AdvancedASRSettings {
    device: "auto" | "cpu" | "webgl" | "webgpu";
    quantization: "auto" | "q4" | "q8" | "fp16" | "fp32";
    maxCacheSizeMB: number;
    wifiOnlyDownloads: boolean;
    debugLogging: boolean;
}

interface DeviceOption {
    value: AdvancedASRSettings["device"];
    label: string;
    description?: string;
}

interface QuantizationOption {
    value: AdvancedASRSettings["quantization"];
    label: string;
    description?: string;
}

interface AdvancedSettingsProps {
    settings: AdvancedASRSettings & { activeBackend: ASRBackend; activeModel: string };
    onSettingsChange: (settings: Partial<AdvancedASRSettings>) => void;
    onReset: () => void;
}

export const DEFAULT_ADVANCED_SETTINGS: AdvancedASRSettings = {
    device: "auto",
    quantization: "auto",
    maxCacheSizeMB: 1000,
    wifiOnlyDownloads: true,
    debugLogging: false,
};

const MIN_CACHE_SIZE_MB = 500;
const MAX_CACHE_SIZE_MB = 5000;
const CACHE_STEP_MB = 100;

/**
 * Get available device options based on the active backend.
 *
 * - Vosk: CPU-only (no choice)
 * - ONNX-WebGPU: Auto, CPU, WebGL, WebGPU
 * - ONNX-CPU: Auto, CPU
 */
export function getDeviceOptionsForBackend(backend: ASRBackend): DeviceOption[] {
    switch (backend) {
        case "vosk":
            return [
                { value: "auto", label: "Auto", description: "CPU only (Vosk requirement)" },
                { value: "cpu", label: "CPU", description: "Force CPU execution" },
            ];

        case "onnx-webgpu":
            return [
                { value: "auto", label: "Auto", description: "Use best available device" },
                { value: "cpu", label: "CPU", description: "CPU fallback (slower, compatible)" },
                { value: "webgl", label: "WebGL", description: "GPU via WebGL (if WebGPU unavailable)" },
                { value: "webgpu", label: "WebGPU", description: "Modern GPU acceleration (fastest)" },
            ];

        case "onnx-cpu":
            return [
                { value: "auto", label: "Auto", description: "CPU optimized execution" },
                { value: "cpu", label: "CPU", description: "Force CPU execution" },
            ];

        default:
            return [{ value: "auto", label: "Auto" }];
    }
}

/**
 * Get quantization options based on the active model.
 * Different models support different quantization levels.
 */
export function getQuantizationOptionsForModel(
    modelId: string,
    availableQuantizations?: Quantization[]
): QuantizationOption[] {
    const allOptions: QuantizationOption[] = [
        { value: "auto", label: "Auto", description: "Select optimal quantization" },
        { value: "q4", label: "Q4", description: "4-bit (smallest, fastest)" },
        { value: "q8", label: "Q8", description: "8-bit (balanced)" },
        { value: "fp16", label: "FP16", description: "Half precision (higher quality)" },
        { value: "fp32", label: "FP32", description: "Full precision (best quality, largest)" },
    ];

    if (availableQuantizations && availableQuantizations.length > 0) {
        const supported = new Set(availableQuantizations.map(q => q.toLowerCase()));
        return allOptions.filter(opt =>
            opt.value === "auto" || supported.has(opt.value)
        );
    }

    return allOptions;
}

export function isDeviceValidForBackend(device: string, backend: ASRBackend): boolean {
    const options = getDeviceOptionsForBackend(backend);
    return options.some(opt => opt.value === device);
}

export function formatCacheSize(value: number): string {
    if (value >= 1000) {
        return `${(value / 1000).toFixed(1)} GB`;
    }
    return `${value} MB`;
}

function CollapsibleSection({
    title,
    defaultOpen = false,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}): React.ReactElement {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="vc-asr-advanced-section">
            <button
                className="vc-asr-advanced-header"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-controls="advanced-settings-content"
            >
                <span className="vc-asr-advanced-title">{title}</span>
                <span className={`vc-asr-advanced-chevron ${isOpen ? "open" : ""}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </span>
            </button>
            {isOpen && (
                <div id="advanced-settings-content" className="vc-asr-advanced-content">
                    {children}
                </div>
            )}
        </div>
    );
}

function SelectSetting({
    title,
    options,
    value,
    onChange,
    disabled = false,
}: {
    title: string;
    options: DeviceOption[] | QuantizationOption[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}): React.ReactElement {
    const selectedOption = options.find(opt => opt.value === value);

    return (
        <div className="vc-asr-setting vc-asr-select-setting">
            <Forms.FormTitle className="vc-asr-setting-title">{title}</Forms.FormTitle>
            <div className="vc-asr-select-wrapper">
                <select
                    className="vc-asr-select"
                    value={value}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
                    disabled={disabled}
                    aria-label={title}
                >
                    {options.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                {selectedOption?.description && (
                    <Forms.FormText className="vc-asr-setting-description">
                        {selectedOption.description}
                    </Forms.FormText>
                )}
            </div>
        </div>
    );
}

function BooleanSetting({
    title,
    description,
    value,
    onChange,
}: {
    title: string;
    description?: string;
    value: boolean;
    onChange: (value: boolean) => void;
}): React.ReactElement {
    return (
        <div className="vc-asr-setting vc-asr-boolean-setting">
            <div className="vc-asr-boolean-row">
                <div className="vc-asr-boolean-info">
                    <Forms.FormTitle className="vc-asr-setting-title">{title}</Forms.FormTitle>
                    {description && (
                        <Forms.FormText className="vc-asr-setting-description">
                            {description}
                        </Forms.FormText>
                    )}
                </div>
                <Switch
                    checked={value}
                    onChange={onChange}
                />
            </div>
        </div>
    );
}

function SliderSetting({
    title,
    min,
    max,
    step,
    value,
    onChange,
    formatValue,
}: {
    title: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    formatValue: (value: number) => string;
}): React.ReactElement {
    return (
        <div className="vc-asr-setting vc-asr-slider-setting">
            <div className="vc-asr-slider-header">
                <Forms.FormTitle className="vc-asr-setting-title">{title}</Forms.FormTitle>
                <span className="vc-asr-slider-value">{formatValue(value)}</span>
            </div>
            <Slider
                minValue={min}
                maxValue={max}
                keyboardStep={step}
                initialValue={value}
                onValueChange={onChange}
                className="vc-asr-slider"
                aria-label={title}
            />
            <Forms.FormText className="vc-asr-setting-description">
                {formatValue(min)} - {formatValue(max)}
            </Forms.FormText>
        </div>
    );
}

export function AdvancedSettings({
    settings,
    onSettingsChange,
    onReset,
}: AdvancedSettingsProps): React.ReactElement {
    const deviceOptions = useMemo(
        () => getDeviceOptionsForBackend(settings.activeBackend),
        [settings.activeBackend]
    );

    const quantizationOptions = useMemo(
        () => getQuantizationOptionsForModel(settings.activeModel),
        [settings.activeModel]
    );

    const isDeviceDisabled = settings.activeBackend === "vosk";

    const handleDeviceChange = useCallback(
        (device: string) => {
            onSettingsChange({
                device: device as AdvancedASRSettings["device"],
            });
        },
        [onSettingsChange]
    );

    const handleQuantizationChange = useCallback(
        (quantization: string) => {
            onSettingsChange({
                quantization: quantization as AdvancedASRSettings["quantization"],
            });
        },
        [onSettingsChange]
    );

    const handleCacheSizeChange = useCallback(
        (maxCacheSizeMB: number) => {
            onSettingsChange({ maxCacheSizeMB });
        },
        [onSettingsChange]
    );

    const handleWifiToggle = useCallback(
        (wifiOnlyDownloads: boolean) => {
            onSettingsChange({ wifiOnlyDownloads });
        },
        [onSettingsChange]
    );

    const handleDebugToggle = useCallback(
        (debugLogging: boolean) => {
            onSettingsChange({ debugLogging });
        },
        [onSettingsChange]
    );

    const handleReset = useCallback(() => {
        if (confirm("Reset all advanced settings to defaults?")) {
            onReset();
        }
    }, [onReset]);

    return (
        <div className="vc-asr-advanced-settings">
            <CollapsibleSection title="Advanced" defaultOpen={false}>
                <div className="vc-asr-advanced-settings-grid">
                    <SelectSetting
                        title="Device Preference"
                        options={deviceOptions}
                        value={settings.device}
                        onChange={handleDeviceChange}
                        disabled={isDeviceDisabled}
                    />

                    <hr className="vc-asr-setting-divider" />

                    <SelectSetting
                        title="Quantization"
                        options={quantizationOptions}
                        value={settings.quantization}
                        onChange={handleQuantizationChange}
                    />

                    <hr className="vc-asr-setting-divider" />

                    <SliderSetting
                        title="Max Cache Size"
                        min={MIN_CACHE_SIZE_MB}
                        max={MAX_CACHE_SIZE_MB}
                        step={CACHE_STEP_MB}
                        value={settings.maxCacheSizeMB}
                        onChange={handleCacheSizeChange}
                        formatValue={formatCacheSize}
                    />

                    <hr className="vc-asr-setting-divider" />

                    <BooleanSetting
                        title="WiFi-Only Downloads"
                        description="Only download models when connected to WiFi to save mobile data"
                        value={settings.wifiOnlyDownloads}
                        onChange={handleWifiToggle}
                    />

                    <hr className="vc-asr-setting-divider" />

                    <BooleanSetting
                        title="Debug Logging"
                        description="Enable verbose logging for troubleshooting (requires restart)"
                        value={settings.debugLogging}
                        onChange={handleDebugToggle}
                    />

                    <hr className="vc-asr-setting-divider" />

                    <div className="vc-asr-setting vc-asr-reset-setting">
                        <div className="vc-asr-reset-row">
                            <div className="vc-asr-reset-info">
                                <Forms.FormTitle className="vc-asr-setting-title">Reset Settings</Forms.FormTitle>
                                <Forms.FormText className="vc-asr-setting-description">
                                    Restore all advanced settings to their default values
                                </Forms.FormText>
                            </div>
                            <Button
                                color={Button.Colors.RED}
                                size={Button.Sizes.SMALL}
                                onClick={handleReset}
                                className="vc-asr-reset-button"
                            >
                                Reset to Defaults
                            </Button>
                        </div>
                    </div>
                </div>
            </CollapsibleSection>
        </div>
    );
}

export default AdvancedSettings;
