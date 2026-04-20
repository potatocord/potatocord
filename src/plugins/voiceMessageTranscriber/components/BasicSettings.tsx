/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import React, { useEffect, useState } from "react";
import { Button, Forms, Select } from "@webpack/common";

import { ASRBackend, ASRModel, AVAILABLE_MODELS, getDefaultModelForBackend, MODELS_BY_BACKEND } from "../models/registry";
import { defaultDownloadManager, DownloadProgress } from "../utils/downloadManager";
import { detectWebGPU, getStorageQuota } from "../utils/hardwareDetect";

const cl = classNameFactory("vc-asr-basic-settings-");

interface BasicSettingsProps {
    activeBackend: ASRBackend;
    activeModel: string;
    onBackendChange: (backend: ASRBackend) => void;
    onModelChange: (modelId: string) => void;
}

interface ModelOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface StorageStats {
    used: number;
    quota: number;
    available: number;
}

const BACKEND_OPTIONS = [
    { value: "vosk", label: "Vosk (Legacy)" },
    { value: "onnx-webgpu", label: "ONNX Runtime (WebGPU)" },
    { value: "onnx-cpu", label: "ONNX Runtime (CPU)" },
] as const;

function ModelStatus({
    model,
    isDownloaded,
    isDownloading,
    downloadProgress,
    onDownload,
    disabled
}: {
    model: ASRModel;
    isDownloaded: boolean;
    isDownloading: boolean;
    downloadProgress: DownloadProgress | null;
    onDownload: () => void;
    disabled?: boolean;
}) {
    if (isDownloaded) {
        return (
            <div className={cl("model-status", "downloaded")}>
                <Forms.FormText className={Margins.top8}>
                    <span style={{ color: "var(--status-positive)" }}>
                        ✓ Model downloaded ({model.sizeMB} MB)
                    </span>
                </Forms.FormText>
            </div>
        );
    }

    if (isDownloading && downloadProgress) {
        const percentage = Math.round(downloadProgress.percentage);
        return (
            <div className={cl("model-status", "downloading")}>
                <Forms.FormText className={Margins.top8}>
                    Downloading: {percentage}% ({Math.round(downloadProgress.loaded / 1024 / 1024)} / {Math.round(downloadProgress.total / 1024 / 1024)} MB)
                </Forms.FormText>
                <div
                    className={cl("progress-bar")}
                    style={{
                        width: "100%",
                        height: "4px",
                        backgroundColor: "var(--background-modifier-accent)",
                        borderRadius: "2px",
                        marginTop: "8px",
                    }}
                >
                    <div
                        style={{
                            width: `${percentage}%`,
                            height: "100%",
                            backgroundColor: "var(--brand-experiment)",
                            borderRadius: "2px",
                            transition: "width 0.3s ease",
                        }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className={cl("model-status", "not-downloaded")}>
            <Forms.FormText className={Margins.top8}>
                <span style={{ color: "var(--status-warning)" }}>
                    Model not downloaded ({model.sizeMB} MB required)
                </span>
            </Forms.FormText>
            <Button
                className={Margins.top8}
                size={Button.Sizes.SMALL}
                color={Button.Colors.BRAND}
                onClick={onDownload}
                disabled={disabled}
            >
                Download Model
            </Button>
        </div>
    );
}

function StorageIndicator({ stats }: { stats: StorageStats | null }) {
    if (!stats || stats.quota === 0) {
        return (
            <Forms.FormText className={Margins.top8} style={{ color: "var(--text-muted)" }}>
                Storage information unavailable
            </Forms.FormText>
        );
    }

    const usedMB = Math.round(stats.used / 1024 / 1024);
    const totalMB = Math.round(stats.quota / 1024 / 1024);
    const percentage = (stats.used / stats.quota) * 100;

    return (
        <div className={cl("storage-indicator")}>
            <Forms.FormText className={Margins.top8}>
                Storage used: {usedMB} MB / {totalMB} MB ({Math.round(percentage)}%)
            </Forms.FormText>
            <div
                className={cl("storage-bar")}
                style={{
                    width: "100%",
                    height: "4px",
                    backgroundColor: "var(--background-modifier-accent)",
                    borderRadius: "2px",
                    marginTop: "8px",
                }}
            >
                <div
                    style={{
                        width: `${percentage}%`,
                        height: "100%",
                        backgroundColor: percentage > 90 ? "var(--status-danger)" : "var(--status-positive)",
                        borderRadius: "2px",
                        transition: "width 0.3s ease",
                    }}
                />
            </div>
        </div>
    );
}

export function BasicSettings({
    activeBackend,
    activeModel,
    onBackendChange,
    onModelChange,
}: BasicSettingsProps) {
    const [hasWebGPU, setHasWebGPU] = useState<boolean>(false);
    const [webGPUChecked, setWebGPUChecked] = useState<boolean>(false);
    const [downloadedModels, setDownloadedModels] = useState<Set<string>>(new Set());
    const [checkingModels, setCheckingModels] = useState<boolean>(true);
    const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
    const [storageStats, setStorageStats] = useState<StorageStats | null>(null);

    const availableModels = getModelsForBackend(activeBackend, hasWebGPU);
    const hasBackendModels = availableModels.length > 0;
    const currentModel = AVAILABLE_MODELS.find(m => m.id === activeModel) || null;

    useEffect(() => {
        let cancelled = false;

        async function checkWebGPU() {
            const info = await detectWebGPU();
            if (!cancelled) {
                setHasWebGPU(info?.available ?? false);
                setWebGPUChecked(true);
            }
        }

        checkWebGPU();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function checkDownloadedModels() {
            const downloaded = new Set<string>();

            for (const model of AVAILABLE_MODELS) {
                try {
                    if (model.components) {
                        const allDownloaded = await Promise.all(
                            model.components.map(comp =>
                                defaultDownloadManager.hasModel(`${model.id}-${comp.type}`)
                            )
                        );
                        if (allDownloaded.every(Boolean)) {
                            downloaded.add(model.id);
                        }
                    } else {
                        const has = await defaultDownloadManager.hasModel(model.id);
                        if (has) {
                            downloaded.add(model.id);
                        }
                    }
                } catch (err) {
                    console.warn(`[BasicSettings] Failed to check model ${model.id}:`, err);
                }
            }

            if (!cancelled) {
                setDownloadedModels(downloaded);
                setCheckingModels(false);
            }
        }

        checkDownloadedModels();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function fetchStorageStats() {
            try {
                const info = await getStorageQuota();
                if (!cancelled) {
                    setStorageStats({
                        used: info.usage,
                        quota: info.quota,
                        available: info.available,
                    });
                }
            } catch (err) {
                console.warn("[BasicSettings] Failed to get storage stats:", err);
            }
        }

        fetchStorageStats();
        return () => { cancelled = true; };
    }, []);

    function handleBackendChange(value: string) {
        const newBackend = value as ASRBackend;
        onBackendChange(newBackend);

        const models = getModelsForBackend(newBackend, hasWebGPU);
        if (models.length > 0) {
            const defaultModel = getDefaultModelForBackend(newBackend);
            const firstAvailable = models.find(m => !m.requiresWebGPU || hasWebGPU);
            onModelChange((defaultModel?.id ?? firstAvailable?.id) ?? activeModel);
        }
    }

    async function handleDownload() {
        if (!currentModel || downloadingModel) return;

        setDownloadingModel(currentModel.id);
        setDownloadProgress(null);

        try {
            if (currentModel.components) {
                for (const component of currentModel.components) {
                    const componentId = `${currentModel.id}-${component.type}`;
                    const url = currentModel.hfId
                        ? `https://huggingface.co/${currentModel.hfId}/resolve/main/${component.path}`
                        : component.path;

                    await defaultDownloadManager.downloadModel(
                        componentId,
                        url,
                        component.sha256,
                        {
                            onProgress: (progress) => {
                                setDownloadProgress(progress);
                            },
                        }
                    );
                }
            } else if (currentModel.url) {
                await defaultDownloadManager.downloadModel(
                    currentModel.id,
                    currentModel.url,
                    MODEL_CHECKSUMS[currentModel.id] || "",
                    {
                        onProgress: (progress) => {
                            setDownloadProgress(progress);
                        },
                    }
                );
            }

            setDownloadedModels(prev => new Set(prev).add(currentModel.id));
        } catch (err) {
            console.error("[BasicSettings] Failed to download model:", err);
        } finally {
            setDownloadingModel(null);
            setDownloadProgress(null);
        }
    }

    const modelOptions: ModelOption[] = availableModels.map(model => ({
        value: model.id,
        label: `${model.name} (${model.sizeMB} MB)`,
        disabled: model.requiresWebGPU && !hasWebGPU,
    }));

    const isModelDownloaded = currentModel ? downloadedModels.has(currentModel.id) : false;
    const isDownloading = downloadingModel === (currentModel?.id ?? null);

    return (
        <div className={cl("container")}>
            <section className={cl("section")}>
                <Forms.FormTitle>Backend</Forms.FormTitle>
                <Forms.FormText className={Margins.bottom8}>
                    Choose the ASR engine for speech recognition
                </Forms.FormText>
                <Select
                    options={BACKEND_OPTIONS.map(opt => ({
                        label: opt.label,
                        value: opt.value,
                        disabled: opt.value === "onnx-webgpu" && webGPUChecked && !hasWebGPU,
                    }))}
                    placeholder="Select backend"
                    isSelected={v => v === activeBackend}
                    select={handleBackendChange}
                    serialize={v => String(v)}
                    isDisabled={false}
                />
                {activeBackend === "onnx-webgpu" && webGPUChecked && !hasWebGPU && (
                    <Forms.FormText className={Margins.top8} style={{ color: "var(--status-warning)" }}>
                        WebGPU is not available on this device. Falling back to WASM.
                    </Forms.FormText>
                )}
            </section>

            <section className={cl("section", Margins.top20)}>
                <Forms.FormTitle>Model</Forms.FormTitle>
                <Forms.FormText className={Margins.bottom8}>
                    Choose the recognition model for the selected backend
                </Forms.FormText>
                <Select
                    options={modelOptions}
                    placeholder={hasBackendModels ? "Select model" : "No models available for this backend"}
                    isSelected={v => v === activeModel}
                    select={(value) => onModelChange(value)}
                    serialize={v => String(v)}
                    isDisabled={!hasBackendModels || checkingModels}
                />
                {!hasBackendModels && (
                    <Forms.FormText className={Margins.top8} style={{ color: "var(--status-warning)" }}>
                        No models available for the selected backend.
                    </Forms.FormText>
                )}
            </section>

            {currentModel && (
                <section className={cl("section", Margins.top20)}>
                    <Forms.FormTitle>Model Status</Forms.FormTitle>
                    <ModelStatus
                        model={currentModel}
                        isDownloaded={isModelDownloaded}
                        isDownloading={isDownloading}
                        downloadProgress={downloadProgress}
                        onDownload={handleDownload}
                        disabled={downloadingModel !== null}
                    />
                </section>
            )}

            <section className={cl("section", Margins.top20)}>
                <Forms.FormTitle>Storage Usage</Forms.FormTitle>
                <StorageIndicator stats={storageStats} />
            </section>
        </div>
    );
}

function getModelsForBackend(backend: ASRBackend, hasWebGPU: boolean): ASRModel[] {
    const models = MODELS_BY_BACKEND[backend] || [];
    return models.filter(model => !model.requiresWebGPU || hasWebGPU);
}

import { MODEL_CHECKSUMS } from "../models/registry";

export default BasicSettings;
