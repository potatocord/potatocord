/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from "react";
import { Button, Forms, showToast, Toasts } from "@webpack/common";
import { DownloadError, ModelDownloadManager } from "../utils/downloadManager";
import { ASRModel, getHuggingFaceUrl, ModelComponent } from "../models/registry";

const { FormText, FormSection } = Forms;

// ============================================================================
// Type Definitions
// ============================================================================

type DownloadState =
    | { status: "idle" }
    | { status: "downloading"; progress: number; speed: number; eta: number }
    | { status: "verifying" }
    | { status: "complete" }
    | { status: "error"; error: string; canRetry: boolean };

interface ModelDownloadProps {
    model: ASRModel;
    onDownloadComplete?: () => void;
    onDownloadError?: (error: string) => void;
}

// ============================================================================
// Styles
// ============================================================================

const containerStyles: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    backgroundColor: "var(--background-secondary)",
    borderRadius: "8px",
    border: "1px solid var(--background-tertiary)"
};

const progressContainerStyles: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px"
};

const progressBarContainerStyles: React.CSSProperties = {
    width: "100%",
    height: "8px",
    backgroundColor: "var(--background-tertiary)",
    borderRadius: "4px",
    overflow: "hidden"
};

const progressBarFillStyles = (progress: number): React.CSSProperties => ({
    width: `${progress}%`,
    height: "100%",
    backgroundColor: "var(--brand-experiment)",
    borderRadius: "4px",
    transition: "width 0.3s ease"
});

const progressTextStyles: React.CSSProperties = {
    fontSize: "12px",
    color: "var(--text-muted)",
    marginTop: "4px"
};

const statusRowStyles: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "8px"
};

const spinnerStyles: React.CSSProperties = {
    width: "16px",
    height: "16px",
    border: "2px solid var(--background-tertiary)",
    borderTopColor: "var(--brand-experiment)",
    borderRadius: "50%",
    animation: "model-download-spin 1s linear infinite"
};

const checkmarkStyles: React.CSSProperties = {
    color: "var(--status-positive)"
};

const errorStyles: React.CSSProperties = {
    color: "var(--status-danger)"
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format bytes to human-readable MB/s
 */
function formatSpeed(bytesPerSecond: number): string {
    const mbPerSecond = bytesPerSecond / (1024 * 1024);
    return `${mbPerSecond.toFixed(1)} MB/s`;
}

/**
 * Format seconds to human-readable time
 */
function formatETA(seconds: number): string {
    if (seconds < 60) {
        return `${Math.ceil(seconds)}s`;
    } else if (seconds < 3600) {
        const mins = Math.ceil(seconds / 60);
        return `${mins}m`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.ceil((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    }
}

/**
 * Checkmark icon component
 */
function CheckmarkIcon(): JSX.Element {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={checkmarkStyles}>
            <path
                d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
                fill="currentColor"
            />
        </svg>
    );
}

/**
 * Error icon component
 */
function ErrorIcon(): JSX.Element {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={errorStyles}>
            <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
                fill="currentColor"
            />
        </svg>
    );
}

/**
 * Spinner component for loading states
 */
function Spinner(): JSX.Element {
    return (
        <>
            <style>{`
                @keyframes model-download-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
            <div style={spinnerStyles} />
        </>
    );
}

/**
 * Progress bar component
 */
function ProgressBar({ progress }: { progress: number }): JSX.Element {
    return (
        <div style={progressBarContainerStyles}>
            <div style={progressBarFillStyles(progress)} />
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================

export function ModelDownload({ model, onDownloadComplete, onDownloadError }: ModelDownloadProps): JSX.Element {
    const [state, setState] = React.useState<DownloadState>({ status: "idle" });
    const [abortController, setAbortController] = React.useState<AbortController | null>(null);
    const [downloadManager] = React.useState(() => new ModelDownloadManager());

    /**
     * Start downloading the model
     */
    const startDownload = React.useCallback(async () => {
        // Prevent multiple simultaneous downloads
        if (state.status === "downloading" || state.status === "verifying") {
            return;
        }

        const controller = new AbortController();
        setAbortController(controller);
        setState({ status: "downloading", progress: 0, speed: 0, eta: 0 });

        try {
            // Download each component sequentially
            const components = model.components || [];
            let totalBytesDownloaded = 0;
            let totalBytes = components.reduce((sum, c) => sum + c.sizeMB * 1024 * 1024, 0);

            for (const component of components) {
                if (controller.signal.aborted) {
                    throw new DownloadError("Download cancelled", "ABORTED");
                }

                const url = model.hfId
                    ? getHuggingFaceUrl(model, component)
                    : (model.url || "");

                if (!url) {
                    throw new Error(`No download URL available for ${component.filename}`);
                }

                // Start checksum verification phase
                setState({ status: "verifying" });

                const componentData = await downloadManager.downloadModel(
                    `${model.id}-${component.filename}`,
                    url,
                    component.sha256,
                    {
                        signal: controller.signal,
                        onProgress: (progress) => {
                            // Calculate overall progress
                            const componentProgress = progress.loaded;
                            const componentTotal = progress.total;
                            const completedBytes = totalBytesDownloaded + componentProgress;
                            const overallProgress = (completedBytes / totalBytes) * 100;

                            // Calculate speed and ETA
                            const speed = progress.speed;
                            const remainingBytes = totalBytes - completedBytes;
                            const eta = speed > 0 ? remainingBytes / speed : 0;

                            setState({
                                status: "downloading",
                                progress: Math.min(overallProgress, 99),
                                speed,
                                eta
                            });
                        }
                    }
                );

                // Verify the component was downloaded successfully
                if (!componentData || componentData.byteLength === 0) {
                    throw new DownloadError(
                        `Failed to download ${component.filename}: empty data`,
                        "NETWORK_ERROR"
                    );
                }

                totalBytesDownloaded += componentData.byteLength;
            }

            // All components downloaded and verified
            setState({ status: "complete" });
            showToast(`${model.name} downloaded successfully`, Toasts.Type.SUCCESS);
            onDownloadComplete?.();

        } catch (error) {
            if (error instanceof DownloadError && error.code === "ABORTED") {
                // User cancelled, don't show error toast
                setState({ status: "idle" });
                return;
            }

            const errorMessage = error instanceof Error ? error.message : "Download failed";
            const canRetry = !(error instanceof DownloadError && error.code === "CHECKSUM_MISMATCH");

            setState({
                status: "error",
                error: errorMessage,
                canRetry
            });

            showToast(`Download failed: ${errorMessage}`, Toasts.Type.FAILURE);
            onDownloadError?.(errorMessage);
        } finally {
            setAbortController(null);
        }
    }, [model, downloadManager, state.status, onDownloadComplete, onDownloadError]);

    /**
     * Cancel the current download
     */
    const cancelDownload = React.useCallback(() => {
        if (abortController) {
            abortController.abort();
        }
    }, [abortController]);

    /**
     * Retry the download from the beginning
     */
    const retryDownload = React.useCallback(() => {
        // Clear any partial downloads and restart
        const components = model.components || [];
        Promise.all(
            components.map(component =>
                downloadManager.deleteModel(`${model.id}-${component.filename}`)
            )
        )
            .then(() => {
                setState({ status: "idle" });
                // Small delay to ensure state update before restarting
                setTimeout(startDownload, 100);
            })
            .catch((err) => {
                console.error("Failed to clear partial downloads:", err);
                setState({ status: "idle" });
                setTimeout(startDownload, 100);
            });
    }, [model, downloadManager, startDownload]);

    // ============================================================================
    // Render
    // ============================================================================

    return (
        <div style={containerStyles}>
            <FormSection title={`Download ${model.name}`}>
                {model.sizeMB > 0 && (
                    <FormText type="description">
                        Size: {model.sizeMB} MB
                    </FormText>
                )}

                {state.status === "idle" && (
                    <div style={{ marginTop: "12px" }}>
                        <Button onClick={startDownload}>
                            Download Model
                        </Button>
                    </div>
                )}

                {state.status === "downloading" && (
                    <div style={progressContainerStyles}>
                        <ProgressBar progress={state.progress} />
                        <FormText style={progressTextStyles}>
                            {Math.round(state.progress)}% - {formatSpeed(state.speed)} - {formatETA(state.eta)} remaining
                        </FormText>
                        <div style={{ marginTop: "8px" }}>
                            <Button
                                color={Button.Colors.RED}
                                size={Button.Sizes.SMALL}
                                onClick={cancelDownload}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {state.status === "verifying" && (
                    <div style={statusRowStyles}>
                        <Spinner />
                        <FormText>Verifying checksum...</FormText>
                    </div>
                )}

                {state.status === "complete" && (
                    <div style={statusRowStyles}>
                        <CheckmarkIcon />
                        <FormText style={{ color: "var(--status-positive)" }}>
                            Download complete
                        </FormText>
                    </div>
                )}

                {state.status === "error" && (
                    <div>
                        <div style={statusRowStyles}>
                            <ErrorIcon />
                            <FormText style={{ color: "var(--status-danger)" }}>
                                {state.error}
                            </FormText>
                        </div>
                        {state.canRetry && (
                            <div style={{ marginTop: "12px" }}>
                                <Button
                                    color={Button.Colors.BRAND}
                                    onClick={retryDownload}
                                >
                                    Retry
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </FormSection>
        </div>
    );
}
