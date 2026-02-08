/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Message } from "@vencord/discord-types";
import { Parser, useEffect, useState } from "@webpack/common";

import { addTranscriptionListener, cancelTranscription, TranscriptionCache } from "./transcribe";

const cl = classNameFactory("vc-transcribe-");

function Dismiss({ onDismiss }: { onDismiss: () => void; }) {
    return (
        <button
            onClick={onDismiss}
            className={cl("dismiss")}
        >
            Dismiss
        </button>
    );
}

export function TranscriptionAccessory({ message }: { message: Message; }) {
    const [transcription, setTranscription] = useState<string | undefined>(
        TranscriptionCache.get(message.id)
    );

    useEffect(() => {
        const remove = addTranscriptionListener((msgId, text) => {
            if (msgId === message.id) {
                setTranscription(text);
            }
        });
        return remove;
    }, [message.id]);

    if (!transcription) return null;

    return (
        <span className={cl("accessory")}>
            <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="currentColor"
                className={cl("accessory-icon")}
            >
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            {Parser.parse(transcription)}
            <br />
            (transcribed - <Dismiss onDismiss={() => cancelTranscription(message.id)} />)
        </span>
    );
}
