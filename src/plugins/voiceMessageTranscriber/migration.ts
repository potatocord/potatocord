/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showToast, Toasts } from "@webpack/common";

const MIGRATION_KEY = "asrMigratedToV2";
const LEGACY_SETTINGS_KEY = "plugins.VoiceMessageTranscriber";

const logger = {
    info: (message: string, meta?: Record<string, unknown>) => {
        console.log(`[VoiceMessageTranscriber Migration] ${message}`, meta ? JSON.stringify(meta) : "");
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
        console.warn(`[VoiceMessageTranscriber Migration] ${message}`, meta ? JSON.stringify(meta) : "");
    },
    error: (message: string, meta?: Record<string, unknown>) => {
        console.error(`[VoiceMessageTranscriber Migration] ${message}`, meta ? JSON.stringify(meta) : "");
    }
};

interface LegacyV1Settings {
    model?: "small" | "custom";
    customModelUrl?: string;
    [key: string]: unknown;
}

function isLegacyV1Format(settings: unknown): settings is LegacyV1Settings {
    if (!settings || typeof settings !== "object") return false;
    const s = settings as Record<string, unknown>;
    return "model" in s && !("activeBackend" in s);
}

export function backupLegacySettings(): void {
    try {
        const currentSettings = DataStore.get(LEGACY_SETTINGS_KEY);
        if (currentSettings) {
            DataStore.set(`${LEGACY_SETTINGS_KEY}.v1-backup`, currentSettings);
            logger.info("Legacy settings backed up", { backupKey: `${LEGACY_SETTINGS_KEY}.v1-backup` });
        }
    } catch (err) {
        logger.error("Failed to backup legacy settings", { error: String(err) });
    }
}

export function migrateSettings(): void {
    try {
        const hasMigrated = DataStore.get(MIGRATION_KEY);
        if (hasMigrated) {
            logger.info("Migration already completed, skipping");
            return;
        }

        const rawSettings = DataStore.get(LEGACY_SETTINGS_KEY);
        
        if (!rawSettings) {
            logger.info("No existing settings found, marking as migrated (fresh install)");
            DataStore.set(MIGRATION_KEY, true);
            return;
        }

        if (!isLegacyV1Format(rawSettings)) {
            logger.info("Settings already in V2 format, marking as migrated");
            DataStore.set(MIGRATION_KEY, true);
            return;
        }

        const oldSettings = rawSettings as LegacyV1Settings;

        backupLegacySettings();

        const newSettings = {
            ...oldSettings,
            activeBackend: "vosk" as const,
            activeModel: oldSettings.model === "custom" ? "vosk-custom" : "vosk-small",
            customModelUrl: oldSettings.customModelUrl || "",
            device: "cpu" as const,
            quantization: "fp32" as const,
            maxCacheSizeMB: 2048,
            wifiOnlyDownloads: false,
            debugLogging: false,
        };

        DataStore.set(LEGACY_SETTINGS_KEY, newSettings);
        DataStore.set(MIGRATION_KEY, true);

        showToast(
            "Voice Transcriber updated! New backends available in settings.",
            Toasts.Type.SUCCESS
        );

        logger.info("ASR settings migrated from v1 to v2", {
            oldModel: oldSettings.model,
            newBackend: newSettings.activeBackend,
            newModel: newSettings.activeModel,
            hasCustomUrl: !!oldSettings.customModelUrl
        });

    } catch (err) {
        logger.error("Migration failed", { error: String(err) });
    }
}

export function rollbackMigration(): void {
    try {
        const backup = DataStore.get(`${LEGACY_SETTINGS_KEY}.v1-backup`);
        if (backup) {
            DataStore.set(LEGACY_SETTINGS_KEY, backup);
            DataStore.set(MIGRATION_KEY, false);
            DataStore.del(`${LEGACY_SETTINGS_KEY}.v1-backup`);
            showToast("Settings rolled back to previous version", Toasts.Type.SUCCESS);
            logger.info("Migration rolled back to V1");
        } else {
            logger.warn("No backup found for rollback");
            showToast("No backup found to rollback", Toasts.Type.FAILURE);
        }
    } catch (err) {
        logger.error("Rollback failed", { error: String(err) });
        showToast("Rollback failed", Toasts.Type.FAILURE);
    }
}

export function getMigrationStatus(): {
    hasMigrated: boolean;
    hasBackup: boolean;
    settingsFormat: "v1" | "v2" | "unknown";
} {
    try {
        const hasMigrated = !!DataStore.get(MIGRATION_KEY);
        const hasBackup = !!DataStore.get(`${LEGACY_SETTINGS_KEY}.v1-backup`);
        const rawSettings = DataStore.get(LEGACY_SETTINGS_KEY);
        
        let settingsFormat: "v1" | "v2" | "unknown" = "unknown";
        if (rawSettings) {
            settingsFormat = isLegacyV1Format(rawSettings) ? "v1" : "v2";
        }

        return { hasMigrated, hasBackup, settingsFormat };
    } catch {
        return { hasMigrated: false, hasBackup: false, settingsFormat: "unknown" };
    }
}

export function forceRemigration(): void {
    try {
        DataStore.set(MIGRATION_KEY, false);
        migrateSettings();
        logger.info("Force re-migration completed");
    } catch (err) {
        logger.error("Force re-migration failed", { error: String(err) });
    }
}
