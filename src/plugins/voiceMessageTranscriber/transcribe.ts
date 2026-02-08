/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";
import { createModel, Model } from "vosk-browser";

import { settings } from "./settings";

const Native = VencordNative.pluginHelpers.VoiceMessageTranscriber as PluginNative<typeof import("./native")>;

const SMALL_MODEL_URL = "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";

let modelPromise: Promise<Model> | null = null;
let currentModelUrl: string | null = null;

async function getModel() {
    const selectedModel = settings.store.model;
    const url = selectedModel === "custom" ? settings.store.customModelUrl : SMALL_MODEL_URL;

    if (!url) {
        throw new Error("No model URL provided");
    }

    if (!modelPromise || currentModelUrl !== url) {
        currentModelUrl = url;
        modelPromise = (async () => {
            const model = await createModel(url);
            return model;
        })();
    }
    return modelPromise;
}

export const TranscriptionCache = new Map<string, string>();
const TranscriptionListeners = new Set<(messageId: string, text: string | undefined) => void>();
const activeJobs = new Map<string, () => void>();

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
    notifyListeners(messageId, undefined);
}

export async function transcribeVoiceMessage(messageId: string, audioUrl: string) {
    if (TranscriptionCache.has(messageId)) {
        notifyListeners(messageId, TranscriptionCache.get(messageId)!);
        return;
    }

    if (activeJobs.has(messageId)) return;

    try {
        const abortController = new AbortController();
        let recognizer: any = null;

        const cleanup = () => {
            abortController.abort();
            if (recognizer) {
                recognizer.remove();
                recognizer = null;
            }
            activeJobs.delete(messageId);
        };

        activeJobs.set(messageId, cleanup);

        showToast("Starting transcription...", Toasts.Type.MESSAGE);

        // 1. Fetch Audio
        let audioBlob: Blob;
        if (IS_DISCORD_DESKTOP) {
            const result = await Native.fetchAudioBlob(audioUrl);
            if (result.error) throw new Error(result.error);
            if (!result.data) throw new Error("No data returned from native fetch");
            audioBlob = new Blob([result.data]);
        } else {
            const response = await fetch(audioUrl, { signal: abortController.signal });
            audioBlob = await response.blob();
        }

        if (abortController.signal.aborted) return;

        // 2. Decode Audio
        const audioBuffer = await new OfflineAudioContext(1, 9600000, 16000).decodeAudioData(await audioBlob.arrayBuffer());

        if (abortController.signal.aborted) return;

        // 3. Load Model
        const model = await getModel();

        if (abortController.signal.aborted) return;

        // 4. Create Recognizer
        recognizer = new (model as any).KaldiRecognizer(16000);

        // 5. Process Audio via event-based API
        let onAbort: () => void;
        const text = await new Promise<string>((resolve, reject) => {
            const results: string[] = [];
            let messagesSent = 0;
            let responsesReceived = 0;

            onAbort = () => {
                reject(new Error("Transcription cancelled"));
            };
            abortController.signal.addEventListener("abort", onAbort);

            const maybeResolve = () => {
                if (responsesReceived >= messagesSent) {
                    cleanup();
                    resolve(results.join(" ").trim());
                }
            };
            const emitUpdate = (partial?: string) => {
                const currentText = results.join(" ");
                const fullText = partial ? (currentText + " " + partial).trim() : currentText;
                if (fullText) notifyListeners(messageId, fullText);
            };

            recognizer.on("result", (message: any) => {
                if (message.result?.text) {
                    results.push(message.result.text);
                    emitUpdate();
                }
                responsesReceived++;
                maybeResolve();
            });

            recognizer.on("partialresult", (message: any) => {
                const partial = message.result?.partial;
                if (partial) {
                    emitUpdate(partial);
                }
                responsesReceived++;
                maybeResolve();
            });

            recognizer.on("error", (message: any) => {
                reject(new Error(message.error || "Vosk recognition error"));
            });

            // Feed audio in chunks
            const channelData = audioBuffer.getChannelData(0);
            const chunkSize = 8000;

            for (let i = 0; i < channelData.length && !abortController.signal.aborted; i += chunkSize) {
                const end = Math.min(i + chunkSize, channelData.length);
                const chunk = channelData.subarray(i, end);
                recognizer.acceptWaveformFloat(chunk, 16000);
                messagesSent++;
            }

            if (abortController.signal.aborted) return;

            recognizer.retrieveFinalResult();
            messagesSent++;
        }).finally(() => {
            if (onAbort) abortController.signal.removeEventListener("abort", onAbort);
        });

        if (text) {
            notifyListeners(messageId, text);
            showToast("Transcription complete", Toasts.Type.SUCCESS);
        } else {
            showToast("Could not transcribe audio", Toasts.Type.FAILURE);
        }

    } catch (err: any) {
        if (err.message === "Transcription cancelled") {
            console.log("Transcription cancelled for message", messageId);
            return;
        }
        console.error("Transcription failed", err);
        showToast("Transcription failed: " + err, Toasts.Type.FAILURE);
    } finally {
        activeJobs.delete(messageId);
    }
}
