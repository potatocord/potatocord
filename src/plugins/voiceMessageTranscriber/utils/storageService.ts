/**
 * Storage Quota Service
 *
 * Manages storage quota for ASR model caching with:
 * - Quota detection via navigator.storage.estimate()
 * - LRU (Least Recently Used) eviction when quota exceeded
 * - User-configurable max cache size (default 2GB)
 * - Event-driven notifications for quota thresholds
 *
 * @module voiceMessageTranscriber/utils/storageService
 */

import { ModelDownloadManager } from './downloadManager';

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Storage information returned by getStorageInfo() */
export interface StorageInfo {
  /** Total quota in bytes (from navigator.storage.estimate()) */
  quota: number;
  /** Used space in bytes (across all origins) */
  usage: number;
  /** Available space in bytes (quota - usage) */
  available: number;
  /** Space used by cached models specifically */
  modelsUsed: number;
  /** User-configured max cache size in bytes */
  userQuota: number;
  /** Whether persistent storage is granted */
  isPersistent: boolean;
}

/** User storage settings */
export interface StorageSettings {
  /** Maximum cache size in MB (default: 2048 = 2GB) */
  maxCacheSizeMB: number;
  /** Whether to request persistent storage */
  requestPersistentStorage: boolean;
}

/** Quota check result */
export interface QuotaCheckResult {
  /** Whether the model can be downloaded */
  canDownload: boolean;
  /** Space needed in bytes (if eviction required) */
  spaceNeeded?: number;
  /** Whether eviction would be needed */
  needsEviction: boolean;
  /** Reason if download cannot proceed */
  reason?: string;
}

/** LRU eviction result */
export interface EvictionResult {
  /** IDs of evicted models */
  evictedIds: string[];
  /** Total bytes freed */
  bytesFreed: number;
  /** Whether the target was fully met */
  success: boolean;
  /** Bytes still needed if partial success */
  bytesStillNeeded?: number;
}

/** Event callback types */
export type QuotaExceededHandler = (info: { requested: number; available: number; userQuota: number }) => void;
export type StorageLowHandler = (info: { usedPercent: number; threshold: number; availableMB: number }) => void;

// ============================================================================
// Default Settings
// ============================================================================

/** Default max cache size: 2GB in MB */
const DEFAULT_MAX_CACHE_SIZE_MB = 2048;

/** Low storage threshold: 90% of quota */
const LOW_STORAGE_THRESHOLD = 0.9;

/** Safety margin: leave 100MB buffer */
const SAFETY_MARGIN_MB = 100;

/** Settings storage key */
const SETTINGS_KEY = 'asr-storage-settings';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when storage quota is exceeded and cannot be satisfied
 * even after LRU eviction
 */
export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public readonly requestedBytes: number,
    public readonly availableBytes: number,
    public readonly userQuotaBytes: number
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Error thrown when persistent storage request fails
 */
export class PersistentStorageError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PersistentStorageError';
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

/** Event listeners registry */
const eventListeners = {
  onQuotaExceeded: new Set<QuotaExceededHandler>(),
  onStorageLow: new Set<StorageLowHandler>(),
};

// ============================================================================
// Settings Management
// ============================================================================

/**
 * Get user storage settings from localStorage
 */
export function getStorageSettings(): StorageSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StorageSettings>;
      return {
        maxCacheSizeMB: parsed.maxCacheSizeMB ?? DEFAULT_MAX_CACHE_SIZE_MB,
        requestPersistentStorage: parsed.requestPersistentStorage ?? false,
      };
    }
  } catch {
    // Fall through to defaults
  }

  return {
    maxCacheSizeMB: DEFAULT_MAX_CACHE_SIZE_MB,
    requestPersistentStorage: false,
  };
}

/**
 * Save user storage settings to localStorage
 */
export function setStorageSettings(settings: Partial<StorageSettings>): void {
  const current = getStorageSettings();
  const updated: StorageSettings = {
    ...current,
    ...settings,
  };

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('[StorageService] Failed to save settings:', error);
  }
}

/**
 * Get max cache size in bytes (convenience function)
 */
export function getMaxCacheSizeBytes(): number {
  const settings = getStorageSettings();
  return settings.maxCacheSizeMB * 1024 * 1024;
}

// ============================================================================
// Storage API Helpers
// ============================================================================

/**
 * Check if Storage API is available
 */
export function isStorageApiAvailable(): boolean {
  return typeof navigator !== 'undefined' &&
         'storage' in navigator &&
         typeof navigator.storage?.estimate === 'function';
}

/**
 * Request persistent storage permission
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }

  try {
    const granted = await navigator.storage.persist();
    if (granted) {
      console.log('[StorageService] Persistent storage granted');
    }
    return granted;
  } catch (error) {
    console.warn('[StorageService] Failed to request persistent storage:', error);
    throw new PersistentStorageError(
      'Failed to request persistent storage',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Check if storage is persistent
 */
export async function isStoragePersistent(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return false;
  }

  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

// ============================================================================
// Core Storage Functions
// ============================================================================

/**
 * Get comprehensive storage information
 *
 * Uses navigator.storage.estimate() for quota detection and combines
 * with local model cache information.
 */
export async function getStorageInfo(downloadManager?: ModelDownloadManager): Promise<StorageInfo> {
  // Default values if API not available
  let quota = Infinity;
  let usage = 0;
  let isPersistent = false;

  if (isStorageApiAvailable()) {
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota !== undefined) {
        quota = estimate.quota;
      }
      if (estimate.usage !== undefined) {
        usage = estimate.usage;
      }
    } catch (error) {
      console.warn('[StorageService] Failed to get storage estimate:', error);
    }
  }

  // Check persistence status
  isPersistent = await isStoragePersistent();

  // Get models-specific usage
  let modelsUsed = 0;
  if (downloadManager) {
    try {
      modelsUsed = await downloadManager.getStorageUsed();
    } catch (error) {
      console.warn('[StorageService] Failed to get models storage:', error);
    }
  }

  // Get user quota
  const userQuota = getMaxCacheSizeBytes();

  // Calculate available (respecting both system quota and user setting)
  const systemAvailable = Math.max(0, quota - usage);
  const userAvailable = Math.max(0, userQuota - modelsUsed);
  const available = Math.min(systemAvailable, userAvailable);

  return {
    quota,
    usage,
    available,
    modelsUsed,
    userQuota,
    isPersistent,
  };
}

/**
 * Check if a model can be downloaded within quota
 *
 * Implements the quota logic:
 * ```
 * if (usedSpace + newModelSize > userQuota) {
 *   // Try to evict least recently used models
 *   const spaceNeeded = (usedSpace + newModelSize) - userQuota;
 *   const evicted = await evictLRU(spaceNeeded);
 *   if (evicted < spaceNeeded) {
 *     throw new QuotaExceededError();
 *   }
 * }
 * ```
 */
export async function checkQuota(
  modelSizeBytes: number,
  downloadManager: ModelDownloadManager
): Promise<QuotaCheckResult> {
  const info = await getStorageInfo(downloadManager);
  const settings = getStorageSettings();

  // Convert to MB for easier comparison
  const modelSizeMB = modelSizeBytes / (1024 * 1024);
  const modelsUsedMB = info.modelsUsed / (1024 * 1024);
  const availableMB = info.available / (1024 * 1024);
  const userQuotaMB = settings.maxCacheSizeMB;

  // Add safety margin
  const requiredSizeMB = modelSizeMB + SAFETY_MARGIN_MB;

  // Check if we have enough space without eviction
  if (modelsUsedMB + requiredSizeMB <= userQuotaMB) {
    // Check if we're approaching the low threshold
    const usedPercent = (modelsUsedMB + requiredSizeMB) / userQuotaMB;
    if (usedPercent >= LOW_STORAGE_THRESHOLD) {
      fireStorageLowEvent({
        usedPercent,
        threshold: LOW_STORAGE_THRESHOLD,
        availableMB,
      });
    }

    return {
      canDownload: true,
      needsEviction: false,
    };
  }

  // Calculate space needed after eviction
  const spaceNeededMB = (modelsUsedMB + requiredSizeMB) - userQuotaMB;
  const spaceNeededBytes = Math.ceil(spaceNeededMB * 1024 * 1024);

  // Check if system quota is the limiting factor
  if (info.quota !== Infinity && modelSizeBytes > info.available) {
    return {
      canDownload: false,
      needsEviction: false,
      reason: `Insufficient system storage: need ${Math.ceil(requiredSizeMB)}MB, have ${Math.floor(availableMB)}MB available`,
    };
  }

  return {
    canDownload: true,
    needsEviction: true,
    spaceNeeded: spaceNeededBytes,
  };
}

/**
 * Evict least recently used models to free up space
 *
 * Sorts models by downloadedAt (oldest first), removes until target size met.
 */
export async function evictLRU(
  targetSizeBytes: number,
  downloadManager: ModelDownloadManager
): Promise<EvictionResult> {
  const evictedIds: string[] = [];
  let bytesFreed = 0;

  try {
    // Get all cached models
    const models = await downloadManager.listCachedModels();

    if (models.length === 0) {
      return {
        evictedIds: [],
        bytesFreed: 0,
        success: false,
        bytesStillNeeded: targetSizeBytes,
      };
    }

    // Sort by downloadedAt (oldest first for LRU)
    const sortedModels = models.sort((a, b) => {
      const dateA = a.downloadedAt instanceof Date ? a.downloadedAt : new Date(a.downloadedAt);
      const dateB = b.downloadedAt instanceof Date ? b.downloadedAt : new Date(b.downloadedAt);
      return dateA.getTime() - dateB.getTime();
    });

    // Evict oldest models until we have enough space
    for (const model of sortedModels) {
      if (bytesFreed >= targetSizeBytes) {
        break;
      }

      try {
        await downloadManager.deleteModel(model.id);
        evictedIds.push(model.id);
        bytesFreed += model.size;

        console.log(`[StorageService] Evicted model ${model.id} (${Math.round(model.size / 1024 / 1024)}MB)`);
      } catch (error) {
        console.warn(`[StorageService] Failed to evict model ${model.id}:`, error);
        // Continue with next model
      }
    }

    const success = bytesFreed >= targetSizeBytes;
    const result: EvictionResult = {
      evictedIds,
      bytesFreed,
      success,
    };

    if (!success) {
      result.bytesStillNeeded = targetSizeBytes - bytesFreed;
    }

    return result;
  } catch (error) {
    console.error('[StorageService] LRU eviction failed:', error);
    return {
      evictedIds,
      bytesFreed,
      success: false,
      bytesStillNeeded: targetSizeBytes - bytesFreed,
    };
  }
}

/**
 * Validate and prepare for model download with automatic eviction
 *
 * This is the high-level function that combines checkQuota and evictLRU.
 * It will automatically evict old models if needed and throws QuotaExceededError
 * if the quota cannot be satisfied.
 */
export async function validateAndPrepareDownload(
  modelSizeBytes: number,
  downloadManager: ModelDownloadManager,
  options: { autoEvict?: boolean } = {}
): Promise<void> {
  const { autoEvict = true } = options;

  const check = await checkQuota(modelSizeBytes, downloadManager);

  if (!check.canDownload) {
    throw new QuotaExceededError(
      check.reason || 'Storage quota exceeded',
      modelSizeBytes,
      0,
      getMaxCacheSizeBytes()
    );
  }

  if (check.needsEviction) {
    if (!autoEvict) {
      throw new QuotaExceededError(
        `Download requires ${Math.ceil((check.spaceNeeded || 0) / 1024 / 1024)}MB of evictions but autoEvict is disabled`,
        modelSizeBytes,
        0,
        getMaxCacheSizeBytes()
      );
    }

    const spaceNeeded = check.spaceNeeded || 0;
    const eviction = await evictLRU(spaceNeeded, downloadManager);

    if (!eviction.success) {
      // Fire quota exceeded event
      const info = await getStorageInfo(downloadManager);
      fireQuotaExceededEvent({
        requested: modelSizeBytes,
        available: info.available,
        userQuota: info.userQuota,
      });

      throw new QuotaExceededError(
        `Cannot free enough space: needed ${Math.ceil(spaceNeeded / 1024 / 1024)}MB, freed ${Math.ceil(eviction.bytesFreed / 1024 / 1024)}MB`,
        modelSizeBytes,
        info.available,
        info.userQuota
      );
    }
  }
}

// ============================================================================
// Event System
// ============================================================================

/**
 * Register a handler for quota exceeded events
 */
export function onQuotaExceeded(handler: QuotaExceededHandler): () => void {
  eventListeners.onQuotaExceeded.add(handler);

  // Return unsubscribe function
  return () => {
    eventListeners.onQuotaExceeded.delete(handler);
  };
}

/**
 * Register a handler for low storage events
 */
export function onStorageLow(handler: StorageLowHandler): () => void {
  eventListeners.onStorageLow.add(handler);

  // Return unsubscribe function
  return () => {
    eventListeners.onStorageLow.delete(handler);
  };
}

/**
 * Fire quota exceeded event
 */
function fireQuotaExceededEvent(info: { requested: number; available: number; userQuota: number }): void {
  console.warn('[StorageService] Quota exceeded:', {
    requestedMB: Math.round(info.requested / 1024 / 1024),
    availableMB: Math.round(info.available / 1024 / 1024),
    userQuotaMB: Math.round(info.userQuota / 1024 / 1024),
  });

  eventListeners.onQuotaExceeded.forEach(handler => {
    try {
      handler(info);
    } catch (error) {
      console.error('[StorageService] Error in quota exceeded handler:', error);
    }
  });
}

/**
 * Fire storage low event
 */
function fireStorageLowEvent(info: { usedPercent: number; threshold: number; availableMB: number }): void {
  console.warn('[StorageService] Storage low:', {
    usedPercent: `${(info.usedPercent * 100).toFixed(1)}%`,
    threshold: `${(info.threshold * 100).toFixed(0)}%`,
    availableMB: Math.round(info.availableMB),
  });

  eventListeners.onStorageLow.forEach(handler => {
    try {
      handler(info);
    } catch (error) {
      console.error('[StorageService] Error in storage low handler:', error);
    }
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes === Infinity) return 'Unlimited';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(2)} ${units[i]}`;
}

/**
 * Get storage summary for UI display
 */
export async function getStorageSummary(downloadManager?: ModelDownloadManager): Promise<{
  total: string;
  used: string;
  available: string;
  modelsUsed: string;
  userQuota: string;
  percentUsed: number;
}> {
  const info = await getStorageInfo(downloadManager);

  const percentUsed = info.userQuota > 0
    ? (info.modelsUsed / info.userQuota) * 100
    : 0;

  return {
    total: formatBytes(info.quota),
    used: formatBytes(info.usage),
    available: formatBytes(info.available),
    modelsUsed: formatBytes(info.modelsUsed),
    userQuota: formatBytes(info.userQuota),
    percentUsed: Math.min(percentUsed, 100),
  };
}

/**
 * Clear all cached models and reset storage
 */
export async function clearAllStorage(downloadManager: ModelDownloadManager): Promise<void> {
  await downloadManager.clearCache();
  console.log('[StorageService] All storage cleared');
}

// ============================================================================
// Storage Service Class (for dependency injection and testing)
// ============================================================================

/**
 * StorageQuotaService - Main service class for storage quota management
 *
 * Provides a class-based interface wrapping the functional API for
 * easier dependency injection and testing.
 */
export class StorageQuotaService {
  private downloadManager: ModelDownloadManager;
  private settings: StorageSettings;

  constructor(downloadManager: ModelDownloadManager) {
    this.downloadManager = downloadManager;
    this.settings = getStorageSettings();
  }

  /**
   * Refresh settings from localStorage
   */
  refreshSettings(): void {
    this.settings = getStorageSettings();
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<StorageSettings>): void {
    setStorageSettings(settings);
    this.settings = getStorageSettings();
  }

  /**
   * Get current settings
   */
  getSettings(): StorageSettings {
    return { ...this.settings };
  }

  /**
   * Get storage information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    return getStorageInfo(this.downloadManager);
  }

  /**
   * Check quota for a model download
   */
  async checkQuota(modelSizeBytes: number): Promise<QuotaCheckResult> {
    return checkQuota(modelSizeBytes, this.downloadManager);
  }

  /**
   * Evict LRU models to free space
   */
  async evictLRU(targetSizeBytes: number): Promise<EvictionResult> {
    return evictLRU(targetSizeBytes, this.downloadManager);
  }

  /**
   * Validate and prepare for download with auto-eviction
   */
  async validateAndPrepareDownload(modelSizeBytes: number, options?: { autoEvict?: boolean }): Promise<void> {
    return validateAndPrepareDownload(modelSizeBytes, this.downloadManager, options);
  }

  /**
   * Get storage summary for UI
   */
  async getStorageSummary(): Promise<ReturnType<typeof getStorageSummary>> {
    return getStorageSummary(this.downloadManager);
  }

  /**
   * Clear all cached storage
   */
  async clearAllStorage(): Promise<void> {
    return clearAllStorage(this.downloadManager);
  }

  /**
   * Request persistent storage
   */
  async requestPersistentStorage(): Promise<boolean> {
    return requestPersistentStorage();
  }

  /**
   * Check if storage is persistent
   */
  async isStoragePersistent(): Promise<boolean> {
    return isStoragePersistent();
  }
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  getStorageInfo,
  checkQuota,
  evictLRU,
  validateAndPrepareDownload,
  getStorageSettings,
  setStorageSettings,
  onQuotaExceeded,
  onStorageLow,
  requestPersistentStorage,
  isStoragePersistent,
  formatBytes,
  getStorageSummary,
  clearAllStorage,
  StorageQuotaService,
  QuotaExceededError,
  PersistentStorageError,
};
