/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import { Menu } from "@webpack/common";
import definePlugin from "@utils/types";

import { ASRBackend } from "./models/registry";
import { getDefaultModelForBackend } from "./models/registry";
import { migrateSettings } from "./migration";
import { settings } from "./settings";
import { transcribeVoiceMessage } from "./transcribe";
import { TranscriptionAccessory } from "./TranscriptionAccessory";

const BACKEND_OPTIONS: { id: ASRBackend; name: string }[] = [
    { id: "vosk", name: "Vosk (Legacy)" },
    { id: "onnx-webgpu", name: "ONNX WebGPU" },
    { id: "onnx-cpu", name: "ONNX CPU" },
];

function getBackendDisplayName(backendId: ASRBackend): string {
    const option = BACKEND_OPTIONS.find(b => b.id === backendId);
    return option?.name || backendId;
}

const IS_VOICE_MESSAGE_FLAG = 1 << 13;

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }) => {
    const isVoiceMessage = (message.flags & IS_VOICE_MESSAGE_FLAG) !== 0;
    const attachment = message.attachments?.[0];
    const isAudioAttachment = attachment?.content_type?.startsWith("audio/") || attachment?.filename?.endsWith(".ogg");
    
    if (!isVoiceMessage && !isAudioAttachment) return;
    if (!attachment?.url) return;

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

    const group = findGroupChildrenByChildId("copy-text", children) || findGroupChildrenByChildId("copy-link", children);
    
    if (group) {
        const copyIndex = group.findIndex(c => c?.props?.id === "copy-text" || c?.props?.id === "copy-link");
        group.splice(copyIndex !== -1 ? copyIndex + 1 : group.length, 0, transcribeItem, switchBackendSubmenu);
    } else {
        children.push(transcribeItem, switchBackendSubmenu);
    }
};

export default definePlugin({
    name: "VoiceMessageTranscriber",
    description: "Transcribe voice messages using local ASR models (Vosk, ONNX Runtime)",
    authors: [Devs.Potatocord],
    settings,
    contextMenus: {
        "message": messageCtxPatch,
    },
    start() {
        migrateSettings();
    },
    renderMessageAccessory: props => <TranscriptionAccessory message={props.message} />,
});
