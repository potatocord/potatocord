/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

export async function fetchAudioBlob(_: IpcMainInvokeEvent, url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return { error: `HTTP Error: ${response.status} ${response.statusText}` };
        }
        const arrayBuffer = await response.arrayBuffer();
        return { data: new Uint8Array(arrayBuffer) };
    } catch (err) {
        return { error: String(err) };
    }
}
