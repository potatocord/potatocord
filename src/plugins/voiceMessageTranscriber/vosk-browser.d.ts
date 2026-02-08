/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare module "vosk-browser" {
    export interface RecognitionResult {
        result?: Array<{ conf: number; start: number; end: number; word: string; }>;
        text: string;
    }

    export interface PartialResult {
        partial: string;
    }

    export interface ResultEvent {
        result: RecognitionResult;
    }

    export interface PartialResultEvent {
        result: PartialResult;
    }

    export interface ErrorEvent {
        error: string;
    }

    export class KaldiRecognizer extends EventTarget {
        constructor(sampleRate: number, grammar?: string);

        acceptWaveform(data: AudioBuffer): void;
        acceptWaveformFloat(buffer: Float32Array, sampleRate: number): void;
        retrieveFinalResult(): void;
        remove(): void;

        on(event: "result", callback: (message: ResultEvent) => void): void;
        on(event: "partialresult", callback: (message: PartialResultEvent) => void): void;
        on(event: "error", callback: (message: ErrorEvent) => void): void;
    }

    export class Model {
        constructor(path: string);
        KaldiRecognizer: typeof KaldiRecognizer;
    }

    export function createModel(url: string): Promise<Model>;
}
