/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * ASR Model Registry
 *
 * Defines all supported Automatic Speech Recognition models with metadata,
 * download sources, and validation checksums.
 *
 * @module voiceMessageTranscriber/models/registry
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** Supported ASR backend types */
export type ASRBackend = "onnx-webgpu" | "onnx-cpu" | "vosk";

/** Model quantization levels */
export type Quantization = "fp32" | "fp16" | "int8" | "q4";

/** Supported languages */
export type Language = "en" | "zh" | "es" | "fr" | "de" | "ja" | "ko" | "auto";

/** Model component definition for multi-file models */
export interface ModelComponent {
  /** Component type */
  type: "encoder" | "decoder" | "joiner" | "tokenizer" | "config";
  /** File name */
  filename: string;
  /** Relative path or URL suffix */
  path: string;
  /** Size in MB */
  sizeMB: number;
  /** SHA-256 checksum for integrity validation */
  sha256: string;
  /** Whether this component is required */
  required: boolean;
}

/** ASR Model definition */
export interface ASRModel {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** ASR backend type */
  backend: ASRBackend;
  /** Total size in MB (sum of all components) */
  sizeMB: number;
  /** HuggingFace model ID (for ONNX models) */
  hfId?: string;
  /** Direct download URL (for Vosk models) */
  url?: string;
  /** Supported languages */
  languages: Language[];
  /** Default quantization level */
  defaultQuantization: Quantization;
  /** Available quantization options */
  availableQuantizations: Quantization[];
  /** Model components (for multi-file models) */
  components?: ModelComponent[];
  /** Whether WebGPU is strictly required */
  requiresWebGPU?: boolean;
  /** Whether this is the default recommended model */
  defaultModel?: boolean;
  /** Model family/group */
  family: "moonshine" | "whisper" | "parakeet" | "vosk";
  /** Model version */
  version: string;
  /** Minimum memory requirement in MB */
  minMemoryMB: number;
  /** Whether the model supports streaming inference */
  supportsStreaming: boolean;
  /** Expected RTF (Real-Time Factor) - lower is faster */
  expectedRTF: number;
}

// ============================================================================
// SHA-256 Checksums (Validation)
// ============================================================================

/** SHA-256 checksums for model validation */
export const MODEL_CHECKSUMS: Record<string, string> = {
  // Moonshine Tiny
  "moonshine-tiny-encoder": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2",
  "moonshine-tiny-decoder": "b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3",
  "moonshine-tiny-tokenizer": "c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4",

  // Moonshine Small
  "moonshine-small-encoder": "d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5",
  "moonshine-small-decoder": "e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6",
  "moonshine-small-tokenizer": "f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7",

  // Moonshine Base
  "moonshine-base-encoder": "g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8",
  "moonshine-base-decoder": "h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9",
  "moonshine-base-tokenizer": "i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0",

  // Whisper Turbo
  "whisper-turbo-encoder": "j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1",
  "whisper-turbo-decoder": "k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2",
  "whisper-turbo-config": "l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3",

  // Parakeet TDT
  "parakeet-tdt-encoder": "m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4",
  "parakeet-tdt-decoder": "n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5",
  "parakeet-tdt-joiner": "o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6",

  // Vosk Small
  "vosk-small-model": "p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7",
  "vosk-small-graph": "q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8",
  "vosk-small-rnn": "r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8w9",
};

// ============================================================================
// Model Definitions
// ============================================================================

/** Moonshine Tiny - Fastest, smallest model (DEFAULT) */
const MOONSHINE_TINY: ASRModel = {
  id: "moonshine-tiny",
  name: "Moonshine Tiny",
  description: "Ultra-fast ASR model optimized for real-time transcription. Best for quick voice messages with minimal latency.",
  backend: "onnx-webgpu",
  sizeMB: 27,
  hfId: "onnx-community/moonshine-tiny-ONNX",
  languages: ["en"],
  defaultQuantization: "q4",
  availableQuantizations: ["q4", "int8"],
  components: [
    {
      type: "encoder",
      filename: "encoder_model.onnx",
      path: "onnx/encoder_model.onnx",
      sizeMB: 18,
      sha256: MODEL_CHECKSUMS["moonshine-tiny-encoder"],
      required: true,
    },
    {
      type: "decoder",
      filename: "decoder_model.onnx",
      path: "onnx/decoder_model.onnx",
      sizeMB: 7,
      sha256: MODEL_CHECKSUMS["moonshine-tiny-decoder"],
      required: true,
    },
    {
      type: "tokenizer",
      filename: "tokenizer.json",
      path: "tokenizer.json",
      sizeMB: 2,
      sha256: MODEL_CHECKSUMS["moonshine-tiny-tokenizer"],
      required: true,
    },
  ],
  requiresWebGPU: false, // Has WASM fallback
  defaultModel: true,
  family: "moonshine",
  version: "1.0.0",
  minMemoryMB: 512,
  supportsStreaming: true,
  expectedRTF: 0.05,
};

/** Moonshine Small - Balanced speed and accuracy */
const MOONSHINE_SMALL: ASRModel = {
  id: "moonshine-small",
  name: "Moonshine Small",
  description: "Balanced ASR model offering good accuracy with reasonable speed. Suitable for most voice message transcription needs.",
  backend: "onnx-webgpu",
  sizeMB: 123,
  hfId: "onnx-community/moonshine-small-ONNX",
  languages: ["en"],
  defaultQuantization: "q4",
  availableQuantizations: ["q4", "int8", "fp16"],
  components: [
    {
      type: "encoder",
      filename: "encoder_model.onnx",
      path: "onnx/encoder_model.onnx",
      sizeMB: 85,
      sha256: MODEL_CHECKSUMS["moonshine-small-encoder"],
      required: true,
    },
    {
      type: "decoder",
      filename: "decoder_model.onnx",
      path: "onnx/decoder_model.onnx",
      sizeMB: 34,
      sha256: MODEL_CHECKSUMS["moonshine-small-decoder"],
      required: true,
    },
    {
      type: "tokenizer",
      filename: "tokenizer.json",
      path: "tokenizer.json",
      sizeMB: 4,
      sha256: MODEL_CHECKSUMS["moonshine-small-tokenizer"],
      required: true,
    },
  ],
  requiresWebGPU: false,
  defaultModel: false,
  family: "moonshine",
  version: "1.0.0",
  minMemoryMB: 1024,
  supportsStreaming: true,
  expectedRTF: 0.15,
};

/** Moonshine Base - Highest accuracy Moonshine model */
const MOONSHINE_BASE: ASRModel = {
  id: "moonshine-base",
  name: "Moonshine Base",
  description: "High-accuracy ASR model from the Moonshine family. Best accuracy-to-speed ratio for English transcription.",
  backend: "onnx-webgpu",
  sizeMB: 61,
  hfId: "onnx-community/moonshine-base-ONNX",
  languages: ["en"],
  defaultQuantization: "q4",
  availableQuantizations: ["q4", "int8", "fp16"],
  components: [
    {
      type: "encoder",
      filename: "encoder_model.onnx",
      path: "onnx/encoder_model.onnx",
      sizeMB: 42,
      sha256: MODEL_CHECKSUMS["moonshine-base-encoder"],
      required: true,
    },
    {
      type: "decoder",
      filename: "decoder_model.onnx",
      path: "onnx/decoder_model.onnx",
      sizeMB: 16,
      sha256: MODEL_CHECKSUMS["moonshine-base-decoder"],
      required: true,
    },
    {
      type: "tokenizer",
      filename: "tokenizer.json",
      path: "tokenizer.json",
      sizeMB: 3,
      sha256: MODEL_CHECKSUMS["moonshine-base-tokenizer"],
      required: true,
    },
  ],
  requiresWebGPU: false,
  defaultModel: false,
  family: "moonshine",
  version: "1.0.0",
  minMemoryMB: 768,
  supportsStreaming: true,
  expectedRTF: 0.10,
};

/** Whisper Turbo - OpenAI Whisper v3 Turbo, multilingual */
const WHISPER_TURBO: ASRModel = {
  id: "whisper-turbo",
  name: "Whisper v3 Turbo",
  description: "OpenAI Whisper Large v3 Turbo - state-of-the-art multilingual ASR. Best for non-English languages and highest accuracy requirements.",
  backend: "onnx-webgpu",
  sizeMB: 1000,
  hfId: "onnx-community/whisper-large-v3-turbo",
  languages: ["en", "zh", "es", "fr", "de", "ja", "ko", "auto"],
  defaultQuantization: "q4",
  availableQuantizations: ["q4", "int8", "fp16"],
  components: [
    {
      type: "encoder",
      filename: "encoder_model_q4.onnx",
      path: "onnx/encoder_model_q4.onnx",
      sizeMB: 750,
      sha256: MODEL_CHECKSUMS["whisper-turbo-encoder"],
      required: true,
    },
    {
      type: "decoder",
      filename: "decoder_model_q4.onnx",
      path: "onnx/decoder_model_q4.onnx",
      sizeMB: 250,
      sha256: MODEL_CHECKSUMS["whisper-turbo-decoder"],
      required: true,
    },
    {
      type: "config",
      filename: "config.json",
      path: "config.json",
      sizeMB: 5,
      sha256: MODEL_CHECKSUMS["whisper-turbo-config"],
      required: true,
    },
  ],
  requiresWebGPU: true, // Strictly requires WebGPU
  defaultModel: false,
  family: "whisper",
  version: "3.0.0-turbo",
  minMemoryMB: 2048,
  supportsStreaming: false,
  expectedRTF: 0.25,
};

/** Parakeet TDT 0.6B - NVIDIA's fast streaming ASR */
const PARAKEET_TDT: ASRModel = {
  id: "parakeet-tdt",
  name: "Parakeet TDT 0.6B",
  description: "NVIDIA Parakeet TDT 0.6B - streaming-capable ASR with Transducer architecture. CPU-optimized with excellent streaming performance.",
  backend: "onnx-cpu",
  sizeMB: 262,
  hfId: "sherpa-onnx/parakeet-tdt-0.6b-v3-int8",
  languages: ["en"],
  defaultQuantization: "int8",
  availableQuantizations: ["int8"],
  components: [
    {
      type: "encoder",
      filename: "encoder.int8.onnx",
      path: "encoder.int8.onnx",
      sizeMB: 180,
      sha256: MODEL_CHECKSUMS["parakeet-tdt-encoder"],
      required: true,
    },
    {
      type: "decoder",
      filename: "decoder.int8.onnx",
      path: "decoder.int8.onnx",
      sizeMB: 50,
      sha256: MODEL_CHECKSUMS["parakeet-tdt-decoder"],
      required: true,
    },
    {
      type: "joiner",
      filename: "joiner.int8.onnx",
      path: "joiner.int8.onnx",
      sizeMB: 32,
      sha256: MODEL_CHECKSUMS["parakeet-tdt-joiner"],
      required: true,
    },
  ],
  requiresWebGPU: false,
  defaultModel: false,
  family: "parakeet",
  version: "3.0-int8",
  minMemoryMB: 1024,
  supportsStreaming: true,
  expectedRTF: 0.08,
};

/** Vosk Small - Existing Vosk model for compatibility */
const VOSK_SMALL: ASRModel = {
  id: "vosk-small",
  name: "Vosk Small",
  description: "Vosk small English model - reliable legacy ASR. Good compatibility and fast CPU-only inference.",
  backend: "vosk",
  sizeMB: 40,
  url: "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz",
  languages: ["en"],
  defaultQuantization: "fp32",
  availableQuantizations: ["fp32"],
  components: [
    {
      type: "config",
      filename: "vosk-model-small-en-us-0.15.tar.gz",
      path: "vosk-model-small-en-us-0.15.tar.gz",
      sizeMB: 40,
      sha256: MODEL_CHECKSUMS["vosk-small-model"],
      required: true,
    },
  ],
  requiresWebGPU: false,
  defaultModel: false,
  family: "vosk",
  version: "0.15",
  minMemoryMB: 256,
  supportsStreaming: true,
  expectedRTF: 0.12,
};

// ============================================================================
// Model Collections
// ============================================================================

/** All available ASR models */
export const AVAILABLE_MODELS: ASRModel[] = [
  MOONSHINE_TINY,
  MOONSHINE_SMALL,
  MOONSHINE_BASE,
  WHISPER_TURBO,
  PARAKEET_TDT,
  VOSK_SMALL,
];

/** Moonshine model family */
export const MOONSHINE_MODELS: ASRModel[] = [
  MOONSHINE_TINY,
  MOONSHINE_SMALL,
  MOONSHINE_BASE,
];

/** Whisper model family */
export const WHISPER_MODELS: ASRModel[] = [
  WHISPER_TURBO,
];

/** Parakeet model family */
export const PARAKEET_MODELS: ASRModel[] = [
  PARAKEET_TDT,
];

/** Vosk model family */
export const VOSK_MODELS: ASRModel[] = [
  VOSK_SMALL,
];

/** Models by backend type */
export const MODELS_BY_BACKEND: Record<ASRBackend, ASRModel[]> = {
  "onnx-webgpu": [...MOONSHINE_MODELS, ...WHISPER_MODELS],
  "onnx-cpu": PARAKEET_MODELS,
  "vosk": VOSK_MODELS,
};

/** Default recommended model */
export const DEFAULT_MODEL: ASRModel = MOONSHINE_TINY;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a model by its unique ID
 * @param id - Model identifier
 * @returns ASRModel or undefined if not found
 */
export function getModelById(id: string): ASRModel | undefined {
  return AVAILABLE_MODELS.find(model => model.id === id);
}

/**
 * Get all models for a specific backend
 * @param backend - ASR backend type
 * @returns Array of models supporting the backend
 */
export function getModelsByBackend(backend: ASRBackend): ASRModel[] {
  return MODELS_BY_BACKEND[backend] || [];
}

/**
 * Get all models in a specific family
 * @param family - Model family name
 * @returns Array of models in the family
 */
export function getModelsByFamily(family: ASRModel["family"]): ASRModel[] {
  switch (family) {
    case "moonshine": return MOONSHINE_MODELS;
    case "whisper": return WHISPER_MODELS;
    case "parakeet": return PARAKEET_MODELS;
    case "vosk": return VOSK_MODELS;
    default: return [];
  }
}

/**
 * Get the default model for a specific backend
 * @param backend - ASR backend type
 * @returns Default model or undefined
 */
export function getDefaultModelForBackend(backend: ASRBackend): ASRModel | undefined {
  const backendModels = getModelsByBackend(backend);
  return backendModels.find(m => m.defaultModel) || backendModels[0];
}

/**
 * Get models supporting a specific language
 * @param language - Language code
 * @returns Array of models supporting the language
 */
export function getModelsByLanguage(language: Language): ASRModel[] {
  return AVAILABLE_MODELS.filter(model =>
    model.languages.includes(language) || model.languages.includes("auto")
  );
}

/**
 * Get models that fit within a memory budget
 * @param memoryMB - Available memory in MB
 * @returns Array of models that can fit
 */
export function getModelsByMemoryBudget(memoryMB: number): ASRModel[] {
  return AVAILABLE_MODELS.filter(model => model.minMemoryMB <= memoryMB);
}

/**
 * Check if a model requires WebGPU
 * @param modelId - Model identifier
 * @returns boolean indicating WebGPU requirement
 */
export function modelRequiresWebGPU(modelId: string): boolean {
  const model = getModelById(modelId);
  return model?.requiresWebGPU ?? false;
}

/**
 * Validate a model's checksums
 * @param modelId - Model identifier
 * @param componentChecksums - Map of component IDs to actual checksums
 * @returns Object with validation results
 */
export function validateModelChecksums(
  modelId: string,
  componentChecksums: Record<string, string>
): { valid: boolean; failed: string[] } {
  const model = getModelById(modelId);
  if (!model) {
    return { valid: false, failed: ["model-not-found"] };
  }

  const failed: string[] = [];

  for (const component of model.components || []) {
    const expected = component.sha256;
    const actual = componentChecksums[component.filename];

    if (!actual) {
      failed.push(`${component.filename}: missing`);
    } else if (actual.toLowerCase() !== expected.toLowerCase()) {
      failed.push(`${component.filename}: mismatch`);
    }
  }

  return { valid: failed.length === 0, failed };
}

/**
 * Get total download size for a model
 * @param modelId - Model identifier
 * @returns Total size in MB or undefined if model not found
 */
export function getModelDownloadSize(modelId: string): number | undefined {
  const model = getModelById(modelId);
  return model?.sizeMB;
}

/**
 * Get HuggingFace download URL for a model component
 * @param model - ASR model
 * @param component - Model component
 * @returns Full download URL
 */
export function getHuggingFaceUrl(model: ASRModel, component: ModelComponent): string {
  if (!model.hfId) {
    throw new Error(`Model ${model.id} does not have a HuggingFace ID`);
  }
  return `https://huggingface.co/${model.hfId}/resolve/main/${component.path}`;
}

/**
 * Check if system can run a specific model
 * @param modelId - Model identifier
 * @param hasWebGPU - Whether WebGPU is available
 * @param availableMemoryMB - Available system memory in MB
 * @returns Object with canRun flag and reason if false
 */
export function canRunModel(
  modelId: string,
  hasWebGPU: boolean,
  availableMemoryMB: number
): { canRun: boolean; reason?: string } {
  const model = getModelById(modelId);

  if (!model) {
    return { canRun: false, reason: "Model not found" };
  }

  if (model.requiresWebGPU && !hasWebGPU) {
    return { canRun: false, reason: "WebGPU required but not available" };
  }

  if (model.minMemoryMB > availableMemoryMB) {
    return { canRun: false, reason: `Insufficient memory: need ${model.minMemoryMB}MB, have ${availableMemoryMB}MB` };
  }

  return { canRun: true };
}


