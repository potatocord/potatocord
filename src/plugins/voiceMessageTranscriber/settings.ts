/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { ASRBackend } from "./models/registry";

export interface ASRSettings {
    activeBackend: ASRBackend;
    activeModel: string;
    legacyModel: string;
    customModelUrl: string;
}

export const settings = definePluginSettings({
    activeBackend: {
        type: OptionType.SELECT,
        description: "ASR Backend for speech recognition",
        options: [
            { label: "Vosk (Legacy)", value: "vosk" },
            { label: "ONNX Runtime (WebGPU)", value: "onnx-webgpu" },
            { label: "ONNX Runtime (CPU)", value: "onnx-cpu" },
        ] as const,
        default: "onnx-webgpu",
    },
    activeModel: {
        type: OptionType.STRING,
        description: "Currently selected ASR model ID",
        default: "moonshine-tiny",
    },
    legacyModel: {
        type: OptionType.SELECT,
        description: "Vosk Model used for transcription (legacy setting)",
        options: [
            { label: "Small (Default, ~40MB)", value: "small" },
            { label: "Custom", value: "custom" },
        ] as const,
        default: "small",
    },
    customModelUrl: {
        type: OptionType.STRING,
        description: "URL to a custom Vosk model (tar.gz)",
        placeholder: "https://example.com/vosk-model-en-us.tar.gz",
        default: "",
        disabled: () => settings.store.legacyModel !== "custom",
    }
});

export default settings;
