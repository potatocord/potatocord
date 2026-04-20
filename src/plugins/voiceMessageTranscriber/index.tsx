/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, findGroupChildrenByChildId, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu";
import { Menu } from "@webpack/common";
import definePlugin from "@utils/types";

import { ASRBackend } from "./models/registry";
import { getDefaultModelForBackend } from "./models/registry";
import { migrateSettings } from "./migration";
import { settings } from "./settings";
import { transcribeVoiceMessage } from "./transcribe";

const BACKEND_OPTIONS: { id: ASRBackend; name: string }[] = [
    { id: "vosk", name: "Vosk (Legacy)" },
    { id: "onnx-webgpu", name: "ONNX WebGPU" },
    { id: "onnx-cpu", name: "ONNX CPU" },
];

function getBackendDisplayName(backendId: ASRBackend): string {
    const option = BACKEND_OPTIONS.find(b => b.id === backendId);
    return option?.name || backendId;
}

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }) => {
    // Check if this is a voice message
    const attachment = message.attachments?.[0];
    if (!attachment?.content_type?.startsWith("audio/")) return;

    // Find the group containing "copy-text"
    const group = findGroupChildrenByChildId("copy-text", children);
    if (!group) return;

    // Main transcribe item with backend indicator
    const transcribeItem = (
        <Menu.MenuItem
            id="vc-transcribe-voice"
            label={`Transcribe (${getBackendDisplayName(settings.store.activeBackend)})`}
            action={() => transcribeVoiceMessage(message.id, attachment.url)}
        />
    );

    // Backend switcher submenu
    const switchBackendSubmenu = (
        <Menu.MenuItem
            id="vc-asr-backend"
            label="Switch Backend"
        >
            {BACKEND_OPTIONS.map(backend => (
                <Menu.MenuCheckboxItem
                    key={backend.id}
                    id={`vc-asr-backend-${backend.id}`}
                    checked={settings.store.activeBackend === backend.id}
                    action={() => {
                        settings.store.activeBackend = backend.id;
                        // Auto-select default model for new backend
                        const defaultModel = getDefaultModelForBackend(backend.id);
                        if (defaultModel) {
                            settings.store.activeModel = defaultModel.id;
                        }
                    }}
                >
                    {backend.name}
                </Menu.MenuCheckboxItem>
            ))}
        </Menu.MenuItem>
    );

    // Insert items after "copy-text"
    const copyIndex = group.findIndex(c => c?.props?.id === "copy-text");
    if (copyIndex !== -1) {
        group.splice(copyIndex + 1, 0, transcribeItem, switchBackendSubmenu);
    }
};

export default definePlugin({
    name: "VoiceMessageTranscriber",
    description: "Transcribe voice messages using local ASR models (Vosk, ONNX Runtime)",
    authors: [{
        name: "Potatocord",
        id: 0n,
    }],
    settings,
    contextMenus: {
        "message": messageCtxPatch,
    },
    start() {
        migrateSettings();
        addContextMenuPatch("message", messageCtxPatch);
    },
    stop() {
        removeContextMenuPatch("message", messageCtxPatch);
    },
});
