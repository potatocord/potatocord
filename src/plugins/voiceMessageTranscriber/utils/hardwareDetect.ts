/**
 * Hardware Detection Utilities
 * 
 * Detects WebGPU support, storage availability, and recommends optimal
 * execution backends for ASR models.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface WebGPUInfo {
  available: boolean;
  adapter?: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
  };
  features: string[];
  limits?: Record<string, number>;
}

export interface StorageInfo {
  quota: number;
  usage: number;
  available: number;
  persisted: boolean;
}

export type DeviceType = 'cpu' | 'webgl' | 'webgpu';
export type BackendType = 'onnx-webgpu' | 'onnx-wasm' | 'transformers-js' | 'whisper-cpp' | 'vosk';

export interface ModelRequirements {
  minStorageMB: number;
  webglRequired?: boolean;
  webgpuRequired?: boolean;
  minRAMMB?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  sizeMB: number;
  requirements: ModelRequirements;
  supportedBackends: BackendType[];
}

export interface EnvironmentInfo {
  isElectron: boolean;
  electronVersion?: string;
  browserName: string;
  browserVersion: string;
  platform: string;
  userAgent: string;
}

// ============================================================================
// Model Configurations (6 ASR Models)
// ============================================================================

export const SUPPORTED_MODELS: Record<string, ModelConfig> = {
  'whisper-turbo': {
    id: 'whisper-turbo',
    name: 'Whisper Large v3 Turbo',
    sizeMB: 1000,
    requirements: {
      minStorageMB: 1500,
      webgpuRequired: false,
      minRAMMB: 2048,
    },
    supportedBackends: ['onnx-webgpu', 'onnx-wasm'],
  },
  'whisper-base': {
    id: 'whisper-base',
    name: 'Whisper Base',
    sizeMB: 150,
    requirements: {
      minStorageMB: 300,
      webgpuRequired: false,
      minRAMMB: 512,
    },
    supportedBackends: ['onnx-webgpu', 'onnx-wasm', 'transformers-js'],
  },
  'moonshine-tiny': {
    id: 'moonshine-tiny',
    name: 'Moonshine Tiny',
    sizeMB: 80,
    requirements: {
      minStorageMB: 200,
      webgpuRequired: false,
      minRAMMB: 512,
    },
    supportedBackends: ['onnx-webgpu', 'onnx-wasm'],
  },
  'moonshine-base': {
    id: 'moonshine-base',
    name: 'Moonshine Base',
    sizeMB: 150,
    requirements: {
      minStorageMB: 300,
      webgpuRequired: false,
      minRAMMB: 768,
    },
    supportedBackends: ['onnx-webgpu', 'onnx-wasm'],
  },
  'parakeet-tdt': {
    id: 'parakeet-tdt',
    name: 'Parakeet TDT',
    sizeMB: 120,
    requirements: {
      minStorageMB: 250,
      webgpuRequired: false,
      minRAMMB: 512,
    },
    supportedBackends: ['onnx-webgpu', 'onnx-wasm'],
  },
  'canary-1b': {
    id: 'canary-1b',
    name: 'Canary 1B',
    sizeMB: 2000,
    requirements: {
      minStorageMB: 3000,
      webgpuRequired: true,
      minRAMMB: 4096,
    },
    supportedBackends: ['onnx-webgpu'],
  },
};

// ============================================================================
// WebGPU Detection
// ============================================================================

/**
 * Detects WebGPU availability and retrieves adapter information.
 * 
 * Based on spike results: Discord Electron 28+ (Chromium 120) supports WebGPU
 * without special flags. navigator.gpu exists natively.
 * 
 * @returns WebGPUInfo with availability and adapter details, or null if unavailable
 */
export async function detectWebGPU(): Promise<WebGPUInfo | null> {
  // Check if WebGPU API exists
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return {
      available: false,
      features: [],
    };
  }

  try {
    // Request adapter with optional power preference
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        available: false,
        features: [],
      };
    }

    // Get adapter info if available (Chrome 120+)
    const adapterInfo = adapter.info;
    const features: string[] = [];
    
    // Collect supported features
    for (const feature of adapter.features) {
      features.push(feature);
    }

      // Get limits
    const limits: Record<string, number> = {};
    const adapterLimits = adapter.limits;
    if (adapterLimits) {
      // Copy known limit properties
      const limitNames = [
        'maxTextureDimension1D',
        'maxTextureDimension2D',
        'maxTextureDimension3D',
        'maxTextureArrayLayers',
        'maxBindGroups',
        'maxBindGroupsPlusVertexBuffers',
        'maxBindingsPerBindGroup',
        'maxDynamicUniformBuffersPerPipelineLayout',
        'maxDynamicStorageBuffersPerPipelineLayout',
        'maxSampledTexturesPerShaderStage',
        'maxSamplersPerShaderStage',
        'maxStorageBuffersPerShaderStage',
        'maxStorageTexturesPerShaderStage',
        'maxUniformBuffersPerShaderStage',
        'maxUniformBufferBindingSize',
        'maxStorageBufferBindingSize',
        'maxVertexBuffers',
        'maxBufferSize',
        'maxVertexAttributes',
        'maxVertexBufferArrayStride',
        'minUniformBufferOffsetAlignment',
        'minStorageBufferOffsetAlignment',
        'maxInterStageShaderVariables',
        'maxColorAttachments',
        'maxColorAttachmentBytesPerSample',
        'maxComputeWorkgroupStorageSize',
        'maxComputeInvocationsPerWorkgroup',
        'maxComputeWorkgroupSizeX',
        'maxComputeWorkgroupSizeY',
        'maxComputeWorkgroupSizeZ',
        'maxComputeWorkgroupsPerDimension',
      ];

      for (const name of limitNames) {
        const value = (adapterLimits as unknown as Record<string, number | undefined>)[name];
        if (value !== undefined) {
          limits[name] = value;
        }
      }
    }

    return {
      available: true,
      adapter: {
        vendor: adapterInfo?.vendor || 'unknown',
        architecture: adapterInfo?.architecture || 'unknown',
        device: adapterInfo?.device || 'unknown',
        description: adapterInfo?.description || 'unknown',
      },
      features,
      limits: Object.keys(limits).length > 0 ? limits : undefined,
    };
  } catch (error) {
    console.warn('[HardwareDetect] WebGPU detection failed:', error);
    return {
      available: false,
      features: [],
    };
  }
}

// ============================================================================
// Storage Quota Detection
// ============================================================================

/**
 * Gets storage quota information using navigator.storage.estimate().
 * 
 * Based on spike results: Chromium quota is ~60% of available disk (temporary)
 * or 20GB+ for persistent. IndexedDB storage can handle 500MB+ writes.
 * 
 * @returns StorageInfo with quota, usage, and available space
 */
export async function getStorageQuota(): Promise<StorageInfo> {
  const defaultInfo: StorageInfo = {
    quota: 0,
    usage: 0,
    available: 0,
    persisted: false,
  };

  if (typeof navigator === 'undefined' || !navigator.storage) {
    return defaultInfo;
  }

  try {
    // Get storage estimate
    const estimate = await navigator.storage.estimate();
    
    if (!estimate) {
      return defaultInfo;
    }

    const quota = estimate.quota || 0;
    const usage = estimate.usage || 0;
    const available = Math.max(0, quota - usage);

    // Check if storage is persisted
    let persisted = false;
    try {
      persisted = await navigator.storage.persisted();
    } catch {
      // persisted() may not be available in all browsers
      persisted = false;
    }

    return {
      quota,
      usage,
      available,
      persisted,
    };
  } catch (error) {
    console.warn('[HardwareDetect] Storage quota detection failed:', error);
    return defaultInfo;
  }
}

/**
 * Requests persistent storage permission.
 * Useful for ensuring models aren't evicted from IndexedDB.
 * 
 * @returns true if persistent storage was granted
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }

  try {
    const persisted = await navigator.storage.persist();
    return persisted;
  } catch (error) {
    console.warn('[HardwareDetect] Failed to request persistent storage:', error);
    return false;
  }
}

// ============================================================================
// Device Recommendation
// ============================================================================

/**
 * Gets the optimal device type for a given backend.
 * 
 * Logic:
 * - onnx-webgpu: Use 'webgpu' when available, fall back to 'webgl' or 'cpu'
 * - onnx-wasm: Use 'cpu' (WebAssembly runs on CPU)
 * - transformers-js: Use 'cpu' or 'webgpu' depending on model
 * - whisper-cpp: Use 'cpu' (native code execution)
 * 
 * @param backend - The backend type to optimize for
 * @returns Recommended device type (cpu, webgl, or webgpu)
 */
export function getOptimalDevice(backend: BackendType): DeviceType {
  // Check WebGPU availability synchronously (using cached detection)
  const hasWebGPU = typeof navigator !== 'undefined' && 
                    'gpu' in navigator &&
                    navigator.gpu !== undefined;

  // Check WebGL availability
  const hasWebGL = (() => {
    if (typeof document === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  })();

  switch (backend) {
    case 'onnx-webgpu':
      // Prefer webgpu, fall back to webgl, then cpu
      if (hasWebGPU) return 'webgpu';
      if (hasWebGL) return 'webgl';
      return 'cpu';

    case 'onnx-wasm':
    case 'whisper-cpp':
      // WASM and native code always run on CPU
      return 'cpu';

    case 'transformers-js':
      // Transformers.js works best with WebGPU for larger models
      if (hasWebGPU) return 'webgpu';
      return 'cpu';

    default:
      return 'cpu';
  }
}

/**
 * Async version that checks actual WebGPU adapter availability.
 * More accurate than sync version but requires await.
 * 
 * @param backend - The backend type to optimize for
 * @returns Promise resolving to recommended device type
 */
export async function getOptimalDeviceAsync(backend: BackendType): Promise<DeviceType> {
  const webgpuInfo = await detectWebGPU();
  const hasWebGPU = webgpuInfo?.available ?? false;

  // Check WebGL availability
  const hasWebGL = (() => {
    if (typeof document === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  })();

  switch (backend) {
    case 'onnx-webgpu':
      if (hasWebGPU) return 'webgpu';
      if (hasWebGL) return 'webgl';
      return 'cpu';

    case 'onnx-wasm':
    case 'whisper-cpp':
      return 'cpu';

    case 'transformers-js':
      if (hasWebGPU) return 'webgpu';
      return 'cpu';

    default:
      return 'cpu';
  }
}

// ============================================================================
// Model Support Detection
// ============================================================================

/**
 * Checks if the current hardware supports a specific model.
 * 
 * Validates:
 * - WebGPU requirement (for webgpu-required models like Canary 1B)
 * - Available storage quota
 * - Minimum RAM (estimated from device memory)
 * 
 * @param model - Model configuration or model ID string
 * @returns true if the model is supported on this hardware
 */
export async function isModelSupported(model: ModelConfig | string): Promise<boolean> {
  // Resolve model config from string ID if needed
  const modelConfig: ModelConfig | undefined = 
    typeof model === 'string' ? SUPPORTED_MODELS[model] : model;

  if (!modelConfig) {
    console.warn(`[HardwareDetect] Unknown model: ${typeof model === 'string' ? model : 'unknown'}`);
    return false;
  }

  const requirements = modelConfig.requirements;

  // Check WebGPU requirement
  if (requirements.webgpuRequired) {
    const webgpuInfo = await detectWebGPU();
    if (!webgpuInfo?.available) {
      return false;
    }
  }

  // Check storage availability
  const storageInfo = await getStorageQuota();
  const minStorageBytes = requirements.minStorageMB * 1024 * 1024;
  if (storageInfo.available < minStorageBytes) {
    return false;
  }

  // Check RAM (if deviceMemory API is available)
  if (requirements.minRAMMB) {
    const deviceMemory = getDeviceMemoryMB();
    if (deviceMemory !== null && deviceMemory < requirements.minRAMMB) {
      return false;
    }
  }

  return true;
}

/**
 * Synchronous version of isModelSupported that uses cached/cheap checks only.
 * Does not check actual WebGPU adapter (only API existence) or storage estimate.
 * 
 * @param model - Model configuration or model ID string
 * @returns true if the model might be supported (fast check)
 */
export function isModelSupportedSync(model: ModelConfig | string): boolean {
  const modelConfig: ModelConfig | undefined = 
    typeof model === 'string' ? SUPPORTED_MODELS[model] : model;

  if (!modelConfig) {
    return false;
  }

  const requirements = modelConfig.requirements;

  // Check WebGPU requirement (cheap sync check)
  if (requirements.webgpuRequired) {
    const hasWebGPU = typeof navigator !== 'undefined' && 
                      'gpu' in navigator &&
                      navigator.gpu !== undefined;
    if (!hasWebGPU) {
      return false;
    }
  }

  // Check RAM if available
  if (requirements.minRAMMB) {
    const deviceMemory = getDeviceMemoryMB();
    if (deviceMemory !== null && deviceMemory < requirements.minRAMMB) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Detects if running in Electron environment (Discord).
 * Uses user agent string analysis.
 * 
 * @returns true if running in Electron
 */
export function isElectron(): boolean {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('electron');
}

/**
 * Gets detailed environment information.
 * 
 * @returns EnvironmentInfo with browser details and platform
 */
export function getEnvironmentInfo(): EnvironmentInfo {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const ua = userAgent.toLowerCase();

  // Detect browser
  let browserName = 'unknown';
  let browserVersion = 'unknown';

  if (ua.includes('edg/')) {
    browserName = 'Edge';
    const match = ua.match(/edg\/([\d.]+)/);
    if (match) browserVersion = match[1];
  } else if (ua.includes('chrome')) {
    browserName = 'Chrome';
    const match = ua.match(/chrome\/([\d.]+)/);
    if (match) browserVersion = match[1];
  } else if (ua.includes('firefox')) {
    browserName = 'Firefox';
    const match = ua.match(/firefox\/([\d.]+)/);
    if (match) browserVersion = match[1];
  } else if (ua.includes('safari')) {
    browserName = 'Safari';
    const match = ua.match(/safari\/([\d.]+)/);
    if (match) browserVersion = match[1];
  }

  // Detect Electron version
  let electronVersion: string | undefined;
  if (ua.includes('electron')) {
    const match = ua.match(/electron\/([\d.]+)/);
    if (match) electronVersion = match[1];
  }

  // Detect platform
  const platform = typeof navigator !== 'undefined' 
    ? navigator.platform || 'unknown'
    : 'unknown';

  return {
    isElectron: isElectron(),
    electronVersion,
    browserName,
    browserVersion,
    platform,
    userAgent,
  };
}

/**
 * Gets estimated device memory in MB.
 * Uses navigator.deviceMemory API if available (Chrome 67+).
 * 
 * @returns Memory in MB or null if unavailable
 */
export function getDeviceMemoryMB(): number | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  // deviceMemory returns values like 0.25, 0.5, 1, 2, 4, 8 (representing GB)
  const memoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (memoryGB !== undefined && memoryGB > 0) {
    return memoryGB * 1024;
  }

  return null;
}

// ============================================================================
// Comprehensive Hardware Report
// ============================================================================

export interface HardwareReport {
  webgpu: WebGPUInfo | null;
  storage: StorageInfo;
  environment: EnvironmentInfo;
  deviceMemoryMB: number | null;
  recommendedBackend: BackendType;
  supportedModels: string[];
}

/**
 * Generates a comprehensive hardware capability report.
 * Useful for debugging and diagnostics.
 * 
 * @returns Promise resolving to complete hardware report
 */
export async function getHardwareReport(): Promise<HardwareReport> {
  const [webgpuInfo, storageInfo] = await Promise.all([
    detectWebGPU(),
    getStorageQuota(),
  ]);

  const environment = getEnvironmentInfo();
  const deviceMemoryMB = getDeviceMemoryMB();

  // Determine recommended backend
  let recommendedBackend: BackendType = 'onnx-wasm'; // Default fallback
  if (webgpuInfo?.available) {
    recommendedBackend = 'onnx-webgpu';
  }

  // Check which models are supported
  const supportedModels: string[] = [];
  for (const [modelId, modelConfig] of Object.entries(SUPPORTED_MODELS)) {
    if (await isModelSupported(modelConfig)) {
      supportedModels.push(modelId);
    }
  }

  return {
    webgpu: webgpuInfo,
    storage: storageInfo,
    environment,
    deviceMemoryMB,
    recommendedBackend,
    supportedModels,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default {
  detectWebGPU,
  getStorageQuota,
  requestPersistentStorage,
  getOptimalDevice,
  getOptimalDeviceAsync,
  isModelSupported,
  isModelSupportedSync,
  isElectron,
  getEnvironmentInfo,
  getDeviceMemoryMB,
  getHardwareReport,
  SUPPORTED_MODELS,
};
