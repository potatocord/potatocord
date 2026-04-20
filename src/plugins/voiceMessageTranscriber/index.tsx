/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Menu } from "@webpack/common";

import { TranscriptionAccessory } from "./components/TranscriptionAccessory";
import { migrateSettings } from "./migration";
import { settings } from "./settings";
import { transcribeVoiceMessage } from "./transcribe";
const IS_VOICE_MESSAGE_FLAG = 1 << 13;

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }) => {
    const isVoiceMessage = (message.flags & IS_VOICE_MESSAGE_FLAG) !== 0;
    const attachment = message.attachments?.[0];
    const isAudioAttachment = attachment?.content_type?.startsWith("audio/") || attachment?.filename?.endsWith(".ogg");

    if (!isVoiceMessage && !isAudioAttachment) return;
    if (!attachment?.url) return;

    // Main transcribe item
    const transcribeItem = (
        <Menu.MenuItem
            id="vc-transcribe-voice"
            label="Transcribe"
            action={() => transcribeVoiceMessage(message.id, attachment.url)}
        />
    );



    const group = findGroupChildrenByChildId("copy-text", children) || findGroupChildrenByChildId("copy-link", children);

    if (group) {
        const copyIndex = group.findIndex(c => c?.props?.id === "copy-text" || c?.props?.id === "copy-link");
        group.splice(copyIndex !== -1 ? copyIndex + 1 : group.length, 0, transcribeItem);
    } else {
        children.push(transcribeItem);
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
    renderMessageAccessory: props => <TranscriptionAccessory messageId={props.message.id} />,
});
