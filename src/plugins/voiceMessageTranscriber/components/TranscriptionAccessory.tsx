/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Spinner, Text } from "@webpack/common";
import { useEffect, useState } from "@webpack/common";

import { addTranscriptionListener, cancelTranscription, isTranscriptionInProgress, TranscriptionCache } from "../transcribe";

interface TranscriptionAccessoryProps {
    messageId: string;
}

export function TranscriptionAccessory({ messageId }: TranscriptionAccessoryProps) {
    const [transcription, setTranscription] = useState<string | null>(TranscriptionCache.get(messageId) || null);
    const [isTranscribing, setIsTranscribing] = useState(() => isTranscriptionInProgress(messageId));

    useEffect(() => {
        const unsubscribe = addTranscriptionListener((id, text) => {
            if (id !== messageId) return;

            if (text === undefined) {
                setTranscription(null);
                setIsTranscribing(false);
            } else if (text === "") {
                // Empty string means transcription started but no result yet
                setIsTranscribing(true);
                setTranscription(null);
            } else {
                // Actual transcription text received
                setTranscription(text);
                setIsTranscribing(false);
            }
        });

        return unsubscribe;
    }, [messageId]);

    const handleStop = () => {
        cancelTranscription(messageId);
    };

    if (!isTranscribing && !transcription) {
        return null;
    }

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px",
                backgroundColor: "var(--background-secondary)",
                borderRadius: "4px",
                marginTop: "4px",
            }}
        >
            {isTranscribing && (
                <>
                    <Spinner type="spinning-circle" style={{ width: 16, height: 16 }} />
                    <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                        Transcribing...
                    </Text>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={handleStop}
                    >
                        Stop
                    </Button>
                </>
            )}
            {!isTranscribing && transcription && (
                <Text variant="text-sm/normal">
                    {transcription}
                </Text>
            )}
        </div>
    );
}
