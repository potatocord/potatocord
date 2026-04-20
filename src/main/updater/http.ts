/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { ipcMain } from "electron";
import { writeFile } from "fs/promises";
import { join } from "path";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { serializeErrors, VENCORD_FILES } from "./common";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
const BUILDS_REPO = "potatocord/builds";
const BUILDS_API_BASE = `https://api.github.com/repos/${BUILDS_REPO}`;
const BUILDS_RAW_BASE = `https://raw.githubusercontent.com/${BUILDS_REPO}/main`;

let PendingUpdates = [] as [string, string][];

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

async function calculateGitChanges() {
    const isOutdated = await fetchUpdates();
    if (!isOutdated) return [];

    const data = await githubGet(`/compare/${gitHash}...HEAD`);

    return data.commits.map((c: any) => ({
        // github api only sends the long sha
        hash: c.sha.slice(0, 7),
        author: c.author.login,
        message: c.commit.message.split("\n")[0]
    }));
}

async function fetchUpdates() {
    let data;
    let isFromBuildsRepo = false;

    try {
        data = await githubGet("/releases/latest");
    } catch (err: any) {
        try {
            data = await githubGet("/releases/tags/devbuild");
        } catch (err2: any) {
            // Fallback to builds repo if release is 404
            if (err2.message?.includes("404")) {
                const commit = await fetchJson<any>(`${BUILDS_API_BASE}/commits/main`, {
                    headers: { "User-Agent": VENCORD_USER_AGENT }
                });
                data = {
                    name: `DevBuild ${commit.sha.slice(0, 7)}`,
                    assets: [
                        { name: "potatocord.asar", browser_download_url: `${BUILDS_RAW_BASE}/potatocord.asar` },
                        { name: "patcher.js", browser_download_url: `${BUILDS_RAW_BASE}/patcher.js` },
                        { name: "preload.js", browser_download_url: `${BUILDS_RAW_BASE}/preload.js` },
                        { name: "renderer.js", browser_download_url: `${BUILDS_RAW_BASE}/renderer.js` },
                        { name: "renderer.css", browser_download_url: `${BUILDS_RAW_BASE}/renderer.css` },
                        { name: "vencordDesktopMain.js", browser_download_url: `${BUILDS_RAW_BASE}/vencordDesktopMain.js` },
                        { name: "vencordDesktopPreload.js", browser_download_url: `${BUILDS_RAW_BASE}/vencordDesktopPreload.js` },
                        { name: "vencordDesktopRenderer.js", browser_download_url: `${BUILDS_RAW_BASE}/vencordDesktopRenderer.js` },
                        { name: "vencordDesktopRenderer.css", browser_download_url: `${BUILDS_RAW_BASE}/vencordDesktopRenderer.css` },
                    ]
                };
                isFromBuildsRepo = true;
            } else {
                throw err2;
            }
        }
    }

    const hash = data.name.slice(data.name.lastIndexOf(" ") + 1);
    if (hash === gitHash)
        return false;

    const isAsar = __dirname.includes(".asar");

    PendingUpdates = [];
    data.assets.forEach(({ name, browser_download_url }: any) => {
        if (isAsar) {
            if (name === "potatocord.asar") {
                PendingUpdates.push([name, browser_download_url]);
            }
        } else {
            if (VENCORD_FILES.some(s => name.startsWith(s)) && name !== "potatocord.asar") {
                PendingUpdates.push([name, browser_download_url]);
            }
        }
    });

    return PendingUpdates.length > 0;
}

async function applyUpdates() {
    const isAsar = __dirname.includes(".asar");
    const asarFile = isAsar ? __dirname.substring(0, __dirname.lastIndexOf(".asar") + 5) : null;

    const fileContents = await Promise.all(PendingUpdates.map(async ([name, url]) => {
        const contents = await fetchBuffer(url);
        let targetPath;
        if (isAsar && name === "potatocord.asar") {
            targetPath = asarFile!;
        } else {
            targetPath = join(__dirname, name);
        }
        return [targetPath, contents] as const;
    }));

    const { renameSync, existsSync } = require("fs");

    for (const [filename, contents] of fileContents) {
        if (process.platform === "win32" && filename === asarFile) {
            // Rename existing asar before writing new one to avoid lock
            if (existsSync(filename)) {
                try {
                    renameSync(filename, filename + ".old");
                } catch (e) {
                    console.error("[Vencord] Failed to rename old asar, update might fail", e);
                }
            }
        }
        await writeFile(filename, contents);
    }

    PendingUpdates = [];
    return true;
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
