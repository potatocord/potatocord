/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Margins } from "@utils/margins";
import React, { useEffect, useState } from "react";
import { Button, Forms, Text } from "@webpack/common";

import { ModelDownloadManager } from "../utils/downloadManager";
import { getStorageInfo, StorageInfo } from "../utils/storageService";

const cl = classNameFactory("vc-asr-storage-indicator-");

// ============================================================================
// Types
// ============================================================================

interface CachedModel {
    id: string;
    size: number;
    downloadedAt: Date;
}

interface StorageIndicatorProps {
    downloadManager: ModelDownloadManager;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format bytes to MB string
 */
function formatMB(bytes: number): string {
    return Math.round(bytes / 1024 / 1024).toString();
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    if (bytes === Infinity) return "Unlimited";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    return `${value.toFixed(2)} ${units[i]}`;
}

/**
 * Get model display name from ID
 */
function getModelDisplayName(modelId: string): string {
    // Try to extract readable name from ID
    // Format: typically "modelname-componentname" or just "modelname"
    const parts = modelId.split("-");
    if (parts.length > 1) {
        // Likely a component model, show both parts
        return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" - ");
    }
    return modelId.charAt(0).toUpperCase() + modelId.slice(1);
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Progress bar component showing storage usage
 */
function ProgressBar({
    usedBytes,
    totalBytes,
    warning
}: {
    usedBytes: number;
    totalBytes: number;
    warning: boolean;
}): React.ReactElement {
    const percentage = totalBytes > 0 ? Math.min((usedBytes / totalBytes) * 100, 100) : 0;

    const containerStyles: React.CSSProperties = {
        width: "100%",
        height: "12px",
        backgroundColor: "var(--background-tertiary)",
        borderRadius: "6px",
        overflow: "hidden",
        marginTop: "8px",
    };

    const fillStyles: React.CSSProperties = {
        width: `${percentage}%`,
        height: "100%",
        backgroundColor: warning ? "var(--status-danger)" : "var(--brand-experiment)",
        borderRadius: "6px",
        transition: "width 0.3s ease, background-color 0.3s ease",
    };

    return (
        <div style={containerStyles}>
            <div style={fillStyles} />
        </div>
    );
}

/**
 * Warning banner for high storage usage
 */
function WarningBanner(): React.ReactElement {
    const bannerStyles: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "12px 16px",
        marginTop: "12px",
        backgroundColor: "var(--status-danger-background)",
        border: "1px solid var(--status-danger)",
        borderRadius: "8px",
        color: "var(--status-danger)",
    };

    return (
        <div style={bannerStyles}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
            <span>Storage almost full - delete unused models</span>
        </div>
    );
}

/**
 * Individual model row with delete button
 */
function ModelRow({
    model,
    onDelete,
    isDeleting
}: {
    model: CachedModel;
    onDelete: (id: string) => void;
    isDeleting: boolean;
}): React.ReactElement {
    const rowStyles: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        backgroundColor: "var(--background-secondary)",
        borderRadius: "8px",
        border: "1px solid var(--background-tertiary)",
    };

    const infoStyles: React.CSSProperties = {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    };

    const nameStyles: React.CSSProperties = {
        fontSize: "14px",
        fontWeight: 500,
        color: "var(--text-normal)",
    };

    const metaStyles: React.CSSProperties = {
        fontSize: "12px",
        color: "var(--text-muted)",
    };

    return (
        <div style={rowStyles}>
            <div style={infoStyles}>
                <span style={nameStyles}>{getModelDisplayName(model.id)}</span>
                <span style={metaStyles}>
                    {formatMB(model.size)} MB • Downloaded {model.downloadedAt.toLocaleDateString()}
                </span>
            </div>
            <Button
                size={Button.Sizes.SMALL}
                color={Button.Colors.RED}
                onClick={() => onDelete(model.id)}
                disabled={isDeleting}
            >
                {isDeleting ? "Deleting..." : "Delete"}
            </Button>
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Storage Indicator Component
 *
 * Displays:
 * - Storage quota progress bar (used vs total)
 * - Warning at 90% usage
 * - List of downloaded models with sizes
 * - Delete buttons per model
 * - "Clear All" button with confirmation
 */
export function StorageIndicator({ downloadManager }: StorageIndicatorProps): React.ReactElement {
    // Storage state
    const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
    const [models, setModels] = useState<CachedModel[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
    const [isClearingAll, setIsClearingAll] = useState(false);

    // Derived values
    const usedMB = storageInfo ? Math.round(storageInfo.modelsUsed / 1024 / 1024) : 0;
    const quotaMB = storageInfo ? Math.round(storageInfo.userQuota / 1024 / 1024) : 0;
    const isWarning = storageInfo ? storageInfo.modelsUsed > storageInfo.userQuota * 0.9 : false;
    const hasModels = models.length > 0;

    /**
     * Load storage data
     */
    async function loadStorageData() {
        try {
            setIsLoading(true);

            // Get storage info
            const info = await getStorageInfo(downloadManager);
            setStorageInfo(info);

            // Get cached models
            const cachedModels = await downloadManager.listCachedModels();
            setModels(cachedModels);
        } catch (error) {
            console.error("[StorageIndicator] Failed to load storage data:", error);
        } finally {
            setIsLoading(false);
        }
    }

    // Load data on mount and when downloadManager changes
    useEffect(() => {
        loadStorageData();
    }, [downloadManager]);

    /**
     * Delete a single model
     */
    async function handleDeleteModel(modelId: string) {
        try {
            setDeletingModelId(modelId);
            await downloadManager.deleteModel(modelId);

            // Update local state immediately
            setModels(prev => prev.filter(m => m.id !== modelId));

            // Refresh storage info
            const info = await getStorageInfo(downloadManager);
            setStorageInfo(info);
        } catch (error) {
            console.error(`[StorageIndicator] Failed to delete model ${modelId}:`, error);
        } finally {
            setDeletingModelId(null);
        }
    }

    /**
     * Clear all models with confirmation
     */
    function handleClearAll() {
        if (window.confirm(`Are you sure you want to delete all ${models.length} downloaded models? This action cannot be undone.`)) {
            setIsClearingAll(true);
            downloadManager.clearCache().then(async () => {
                setModels([]);
                const info = await getStorageInfo(downloadManager);
                setStorageInfo(info);
            }).catch(error => {
                console.error("[StorageIndicator] Failed to clear all models:", error);
            }).finally(() => {
                setIsClearingAll(false);
            });
        }
    }

    // Container styles
    const containerStyles: React.CSSProperties = {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "16px",
        backgroundColor: "var(--background-secondary)",
        borderRadius: "12px",
        border: "1px solid var(--background-tertiary)",
    };

    const headerStyles: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    };

    const usageTextStyles: React.CSSProperties = {
        fontSize: "14px",
        color: "var(--text-normal)",
        marginTop: "8px",
    };

    const modelsListStyles: React.CSSProperties = {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginTop: "8px",
    };

    const emptyStateStyles: React.CSSProperties = {
        padding: "24px",
        textAlign: "center",
        color: "var(--text-muted)",
        fontSize: "14px",
    };

    const sectionTitleStyles: React.CSSProperties = {
        fontSize: "12px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "var(--text-muted)",
        marginBottom: "4px",
    };

    if (isLoading) {
        return (
            <div style={containerStyles}>
                <Forms.FormText>Loading storage information...</Forms.FormText>
            </div>
        );
    }

    return (
        <div style={containerStyles}>
            {/* Header */}
            <div style={headerStyles}>
                <Forms.FormTitle tag="h3">Storage Usage</Forms.FormTitle>
                {hasModels && (
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={handleClearAll}
                        disabled={isClearingAll}
                    >
                        {isClearingAll ? "Clearing..." : "Clear All"}
                    </Button>
                )}
            </div>

            {/* Progress Bar */}
            <div>
                <ProgressBar
                    usedBytes={storageInfo?.modelsUsed ?? 0}
                    totalBytes={storageInfo?.userQuota ?? 1}
                    warning={isWarning}
                />
                <div style={usageTextStyles}>
                    <Text variant="text-md/normal">
                        {usedMB} MB / {quotaMB} MB used
                    </Text>
                </div>
            </div>

            {/* Warning Banner */}
            {isWarning && <WarningBanner />}

            {/* Models List */}
            <div>
                <div style={sectionTitleStyles}>Downloaded Models</div>
                {hasModels ? (
                    <div style={modelsListStyles}>
                        {models.map(model => (
                            <ModelRow
                                key={model.id}
                                model={model}
                                onDelete={handleDeleteModel}
                                isDeleting={deletingModelId === model.id}
                            />
                        ))}
                    </div>
                ) : (
                    <div style={emptyStateStyles}>
                        No models downloaded yet.
                    </div>
                )}
            </div>
        </div>
    );
}

export default StorageIndicator;
