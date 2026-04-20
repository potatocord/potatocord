/**
 * ModelDownloadManager - IndexedDB-based model download and caching system
 * 
 * Features:
 * - Chunked downloading for large models
 * - Resume capability for interrupted downloads
 * - SHA-256 checksum validation
 * - HuggingFace CDN URL handling with CORS
 */

const DB_NAME = 'ModelCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks for efficient resume

/** IndexedDB schema interface */
interface ModelRecord {
  id: string;
  data: ArrayBuffer;
  checksum: string;
  downloadedAt: Date;
  size: number;
  partial?: boolean;
  totalSize?: number;
  chunks?: number[]; // Array of successfully downloaded chunk indices
}

/** Progress callback data */
export interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
  chunkIndex: number;
  totalChunks: number;
  speed: number; // bytes per second
}

/** Download options */
export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  onResume?: (loadedBytes: number) => void;
  signal?: AbortSignal;
  retryCount?: number;
  retryDelay?: number;
}

/** Model metadata */
export interface ModelInfo {
  id: string;
  url: string;
  checksum: string;
  size: number;
}

/** Custom error types */
export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly code: 'NETWORK_ERROR' | 'CHECKSUM_MISMATCH' | 'STORAGE_FULL' | 'ABORTED' | 'MAX_RETRIES',
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * ModelDownloadManager - Handles downloading and caching ML models in IndexedDB
 */
export class ModelDownloadManager {
  private db: IDBDatabase | null = null;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(options: { maxRetries?: number; retryDelay?: number } = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
  }

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error(`Failed to open database: ${request.error?.message}`));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create models store with id as key
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('downloadedAt', 'downloadedAt', { unique: false });
        }
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Check if a model exists in the cache
   */
  async hasModel(modelId: string): Promise<boolean> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(modelId);

      request.onsuccess = () => {
        const record = request.result as ModelRecord | undefined;
        // Only count as existing if it's not a partial download
        resolve(!!record && !record.partial);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a model from the cache
   * @returns The model data or null if not found
   */
  async getModel(modelId: string): Promise<ArrayBuffer | null> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(modelId);

      request.onsuccess = () => {
        const record = request.result as ModelRecord | undefined;
        if (!record || record.partial) {
          resolve(null);
          return;
        }
        resolve(record.data);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a model from the cache
   */
  async deleteModel(modelId: string): Promise<void> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(modelId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get info about a cached model
   */
  async getModelInfo(modelId: string): Promise<{ size: number; downloadedAt: Date; checksum: string } | null> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(modelId);

      request.onsuccess = () => {
        const record = request.result as ModelRecord | undefined;
        if (!record || record.partial) {
          resolve(null);
          return;
        }
        resolve({
          size: record.size,
          downloadedAt: record.downloadedAt,
          checksum: record.checksum
        });
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Download a model with chunked downloading and resume support
   */
  async downloadModel(
    modelId: string,
    url: string,
    expectedChecksum: string,
    options: DownloadOptions = {}
  ): Promise<ArrayBuffer> {
    await this.init();

    // Check if already exists
    if (await this.hasModel(modelId)) {
      const existing = await this.getModel(modelId);
      if (existing) {
        // Verify checksum
        const checksum = await this.computeSHA256(existing);
        if (checksum === expectedChecksum) {
          return existing;
        }
        // Checksum mismatch, re-download
        await this.deleteModel(modelId);
      }
    }

    // Check for partial download to resume
    const partialInfo = await this.getPartialDownloadInfo(modelId);
    let resumeOffset = 0;
    let chunks: number[] = [];

    if (partialInfo && partialInfo.totalSize) {
      resumeOffset = partialInfo.chunks?.length 
        ? partialInfo.chunks.length * CHUNK_SIZE 
        : 0;
      chunks = partialInfo.chunks || [];
      
      if (resumeOffset > 0 && options.onResume) {
        options.onResume(resumeOffset);
      }
    }

    try {
      const { data, totalSize } = await this.performChunkedDownload(
        modelId,
        url,
        resumeOffset,
        chunks,
        options
      );

      // Validate checksum
      const actualChecksum = await this.computeSHA256(data);
      if (actualChecksum !== expectedChecksum) {
        // Clean up partial download on checksum mismatch
        await this.deleteModel(modelId);
        throw new DownloadError(
          `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
          'CHECKSUM_MISMATCH'
        );
      }

      // Store the complete model
      const record: ModelRecord = {
        id: modelId,
        data,
        checksum: actualChecksum,
        downloadedAt: new Date(),
        size: totalSize
      };

      await this.saveModelRecord(record);

      return data;
    } catch (error) {
      // Clean up partial download on failure
      if (error instanceof DownloadError && error.code === 'ABORTED') {
        // Keep partial for resume, don't delete
        throw error;
      }
      
      // For other errors, clean up partial
      try {
        await this.deleteModel(modelId);
      } catch {
        // Ignore cleanup errors
      }
      
      throw error;
    }
  }

  /**
   * Perform chunked download with resume support
   */
  private async performChunkedDownload(
    modelId: string,
    url: string,
    resumeOffset: number,
    existingChunks: number[],
    options: DownloadOptions
  ): Promise<{ data: ArrayBuffer; totalSize: number }> {
    const { onProgress, signal, retryCount = this.maxRetries, retryDelay = this.retryDelay } = options;
    
    // First, get total size with HEAD request
    const totalSize = await this.getContentLength(url);
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
    const startChunkIndex = Math.floor(resumeOffset / CHUNK_SIZE);

    const chunks: ArrayBuffer[] = [];
    let loadedBytes = resumeOffset;
    let lastProgressTime = Date.now();
    let lastProgressBytes = resumeOffset;

    for (let chunkIndex = startChunkIndex; chunkIndex < totalChunks; chunkIndex++) {
      // Check for abort signal
      if (signal?.aborted) {
        // Save partial progress before aborting
        await this.savePartialProgress(modelId, totalSize, existingChunks.concat(chunks.map((_, i) => startChunkIndex + i)));
        throw new DownloadError('Download aborted by user', 'ABORTED');
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
      
      let chunkData: ArrayBuffer | null = null;
      let attempts = 0;

      while (attempts <= retryCount && !chunkData) {
        try {
          chunkData = await this.fetchChunk(url, start, end, signal);
        } catch (error) {
          attempts++;
          
          if (attempts > retryCount) {
            // Save partial progress before failing
            await this.savePartialProgress(
              modelId, 
              totalSize, 
              existingChunks.concat(chunks.map((_, i) => startChunkIndex + i))
            );
            throw new DownloadError(
              `Failed to download chunk ${chunkIndex} after ${retryCount} retries`,
              'MAX_RETRIES',
              error instanceof Error ? error : undefined
            );
          }

          // Exponential backoff
          await this.delay(retryDelay * Math.pow(2, attempts - 1));
        }
      }

      if (!chunkData) {
        throw new DownloadError(`Failed to download chunk ${chunkIndex}`, 'NETWORK_ERROR');
      }

      chunks.push(chunkData);
      loadedBytes += chunkData.byteLength;

      // Report progress
      if (onProgress) {
        const now = Date.now();
        const timeDelta = now - lastProgressTime;
        const bytesDelta = loadedBytes - lastProgressBytes;
        const speed = timeDelta > 0 ? (bytesDelta / timeDelta) * 1000 : 0;

        onProgress({
          loaded: loadedBytes,
          total: totalSize,
          percentage: (loadedBytes / totalSize) * 100,
          chunkIndex: chunkIndex + 1,
          totalChunks,
          speed
        });

        lastProgressTime = now;
        lastProgressBytes = loadedBytes;
      }
    }

    // Combine all chunks
    const combinedData = this.combineChunks(chunks, totalSize);
    
    return { data: combinedData, totalSize };
  }

  /**
   * Fetch a single chunk with Range header
   */
  private async fetchChunk(
    url: string,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<ArrayBuffer> {
    const headers: HeadersInit = {
      'Range': `bytes=${start}-${end}`
    };

    const response = await fetch(url, {
      headers,
      signal,
      // Enable CORS for HuggingFace CDN
      mode: 'cors',
      credentials: 'omit'
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  /**
   * Get content length from URL
   */
  private async getContentLength(url: string): Promise<number> {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit'
    });

    if (!response.ok) {
      throw new DownloadError(
        `Failed to get content length: HTTP ${response.status}`,
        'NETWORK_ERROR'
      );
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      throw new DownloadError('Content-Length header missing', 'NETWORK_ERROR');
    }

    return parseInt(contentLength, 10);
  }

  /**
   * Combine multiple chunks into a single ArrayBuffer
   */
  private combineChunks(chunks: ArrayBuffer[], totalSize: number): ArrayBuffer {
    const result = new Uint8Array(totalSize);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    return result.buffer;
  }

  /**
   * Get partial download information
   */
  private async getPartialDownloadInfo(modelId: string): Promise<Partial<ModelRecord> | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(modelId);

      request.onsuccess = () => {
        const record = request.result as ModelRecord | undefined;
        if (!record || !record.partial) {
          resolve(null);
          return;
        }
        resolve(record);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save partial download progress
   */
  private async savePartialProgress(
    modelId: string,
    totalSize: number,
    completedChunks: number[]
  ): Promise<void> {
    const record: Partial<ModelRecord> = {
      id: modelId,
      partial: true,
      totalSize,
      chunks: completedChunks,
      downloadedAt: new Date()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save complete model record
   */
  private async saveModelRecord(record: ModelRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      
      request.onerror = () => {
        // Check for quota exceeded error
        if (request.error?.name === 'QuotaExceededError') {
          reject(new DownloadError(
            'Storage quota exceeded. Please free up space and try again.',
            'STORAGE_FULL'
          ));
        } else {
          reject(request.error);
        }
      };
    });
  }

  /**
   * Compute SHA-256 checksum of data
   */
  private async computeSHA256(data: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * List all cached models
   */
  async listCachedModels(): Promise<{ id: string; size: number; downloadedAt: Date }[]> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result as ModelRecord[];
        const models = records
          .filter(r => !r.partial)
          .map(r => ({
            id: r.id,
            size: r.size,
            downloadedAt: r.downloadedAt
          }));
        resolve(models);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all cached models
   */
  async clearCache(): Promise<void> {
    await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get total storage used by cached models
   */
  async getStorageUsed(): Promise<number> {
    const models = await this.listCachedModels();
    return models.reduce((total, model) => total + model.size, 0);
  }
}

/**
 * Build HuggingFace CDN URL for a model file
 */
export function buildHuggingFaceUrl(
  modelId: string,
  fileName: string,
  options: { revision?: string; subfolder?: string } = {}
): string {
  const { revision = 'main', subfolder } = options;
  
  let path = modelId;
  if (subfolder) {
    path += `/${subfolder}`;
  }
  
  return `https://huggingface.co/${modelId}/resolve/${revision}/${subfolder ? subfolder + '/' : ''}${fileName}`;
}

/**
 * Create a download manager instance with default configuration
 */
export function createDownloadManager(options?: { maxRetries?: number; retryDelay?: number }): ModelDownloadManager {
  return new ModelDownloadManager(options);
}

// Export default instance for convenience
export const defaultDownloadManager = new ModelDownloadManager();
