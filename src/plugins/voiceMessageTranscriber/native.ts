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

export async function fetchModelContentLength(_: IpcMainInvokeEvent, url: string) {
    try {
        const response = await fetch(url, {
            method: "HEAD",
        });
        if (!response.ok) {
            return { error: `HTTP Error: ${response.status} ${response.statusText}`, status: response.status };
        }
        const contentLength = response.headers.get("content-length");
        if (!contentLength) {
            return { error: "Content-Length header missing" };
        }
        return { contentLength: parseInt(contentLength, 10) };
    } catch (err) {
        return { error: String(err) };
    }
}

export async function fetchModelChunk(_: IpcMainInvokeEvent, url: string, start: number, end: number) {
    try {
        const headers: HeadersInit = {
            "Range": `bytes=${start}-${end}`
        };
        const response = await fetch(url, {
            headers,
        });

        if (!response.ok && response.status !== 206) {
            return { error: `HTTP Error: ${response.status} ${response.statusText}`, status: response.status };
        }

        const arrayBuffer = await response.arrayBuffer();
        return { data: new Uint8Array(arrayBuffer) };
    } catch (err) {
        return { error: String(err) };
    }
}
