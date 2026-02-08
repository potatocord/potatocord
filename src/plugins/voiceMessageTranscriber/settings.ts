/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    model: {
        type: OptionType.SELECT,
        description: "Vosk Model used for transcription",
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
        disabled: () => settings.store.model !== "custom",
    }
});
