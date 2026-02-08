/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

import { settings } from "./settings";
import { transcribeVoiceMessage } from "./transcribe";
import { TranscriptionAccessory } from "./TranscriptionAccessory";

// Flag for Voice Message: 1 << 13 = 8192
const IS_VOICE_MESSAGE_FLAG = 1 << 13;

function MicrophoneIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
        </svg>
    );
}

const messageCtxPatch: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    // Check if it's a voice message
    const isVoiceMessage = (message.flags & IS_VOICE_MESSAGE_FLAG) !== 0;

    // Also check attachments just in case (some older or different client versions?)
    // But flags should be reliable for modern voice messages.
    if (!isVoiceMessage) return;

    // Find a good place to insert. "copy-text" or similar.
    // Or just append.
    // Translate plugin inserts after copy-text.
    const group = findGroupChildrenByChildId("copy-text", children);

    const item = (
        <Menu.MenuItem
            id="vc-transcribe-voice"
            label="Transcribe Voice Message"
            icon={MicrophoneIcon}
            action={async () => {
                const attachment = message.attachments.find(a => a.content_type?.startsWith("audio/") || a.filename.endsWith(".ogg"));
                if (attachment) {
                    await transcribeVoiceMessage(message.id, attachment.url);
                } else {
                    console.error("No audio attachment found for voice message");
                }
            }}
        />
    );

    if (group) {
        group.splice(group.findIndex(c => c?.props?.id === "copy-text") + 1, 0, item);
    } else {
        children.push(item);
    }
};

export default definePlugin({
    name: "VoiceMessageTranscriber",
    description: "Transcribes voice messages using local speech recognition (Vosk).",
    authors: [Devs.modpotato],
    settings,
    contextMenus: {
        "message": messageCtxPatch
    },
    renderMessageAccessory: props => <TranscriptionAccessory message={props.message} />
});
