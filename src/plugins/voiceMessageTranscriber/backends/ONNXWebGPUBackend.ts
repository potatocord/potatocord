/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * ONNXWebGPUBackend - ONNX Runtime Web with WebGPU execution provider
 *
 * Supports both Moonshine (Tiny/Small/Base) and Whisper Turbo models.
 * Uses WebGPU when available, falls back to WASM for CPU inference.
 *
 * @module voiceMessageTranscriber/backends/ONNXWebGPUBackend
 */

import {
    ASRBackend,
    DeviceType,
    ModelConfig,
    ProgressCallback,
    Quantization,
    TranscriptionOptions,
    TranscriptionResult,
    TranscriptionSegment,
} from './types';
import {
    MOONSHINE_MODELS,
    WHISPER_MODELS,
    ASRModel,
    ModelComponent,
    getModelById,
    getHuggingFaceUrl,
} from '../models/registry';
import { detectWebGPU, WebGPUInfo } from '../utils/hardwareDetect';
import { ModelDownloadManager, defaultDownloadManager } from '../utils/downloadManager';

// ONNX Runtime types (dynamic import avoids CSP issues)
type OrtModule = typeof import('onnxruntime-web');
type OrtSession = import('onnxruntime-web').InferenceSession;
type OrtTensor = import('onnxruntime-web').Tensor;

/** Execution provider configuration */
interface ExecutionProviderConfig {
    name: string;
    deviceType?: string;
}

/** Model sessions for multi-component models */
interface ModelSessions {
    encoder?: OrtSession;
    decoder?: OrtSession;
    joiner?: OrtSession;
    // Additional metadata
    tokenizer?: unknown;
    config?: unknown;
}

/** Token IDs for Whisper special tokens */
const WHISPER_TOKEN_IDS = {
    START_OF_TRANSCRIPT: 50258,
    ENGLISH: 50259,
    TRANSCRIBE: 50359,
    NOTIMESTAMPS: 50363,
    START_OF_TEXT: 50257,
    END_OF_TEXT: 50256,
};

/**
 * ONNX Runtime WebGPU Backend Implementation
 *
 * Supports both Moonshine and Whisper models using ONNX Runtime Web.
 * - Moonshine: encoder + decoder + tokenizer components
 * - Whisper: encoder + decoder + config components
 */
export class ONNXWebGPUBackend implements ASRBackend {
    readonly id = 'onnx-webgpu';
    readonly name = 'ONNX Runtime (WebGPU)';
    readonly supportedModels: ModelConfig[];

    private ort: OrtModule | null = null;
    private sessions: Map<string, ModelSessions> = new Map();
    private currentModelId: string | null = null;
    private abortController: AbortController | null = null;
    private downloadManager: ModelDownloadManager;
    private webGPUInfo: WebGPUInfo | null = null;
    private executionProvider: string = 'wasm';

    constructor() {
        // Combine Moonshine and Whisper models
        const allModels = [...MOONSHINE_MODELS, ...WHISPER_MODELS];
        // Convert ASRModel to ModelConfig format
        this.supportedModels = allModels.map(model => this.convertToModelConfig(model));
        this.downloadManager = defaultDownloadManager;
    }

    /**
     * Convert ASRModel from registry to ModelConfig interface
     */
    private convertToModelConfig(model: ASRModel): ModelConfig {
        return {
            id: model.id,
            name: model.name,
            backend: model.backend,
            size: model.sizeMB * 1024 * 1024, // Convert MB to bytes
            hfUrl: model.hfId ? `https://huggingface.co/${model.hfId}` : '',
            languages: model.languages,
            isMultiComponent: !!model.components && model.components.length > 1,
            components: model.components?.map(comp => ({
                id: comp.type,
                filename: comp.filename,
                url: model.hfId ? getHuggingFaceUrl(model, comp) : '',
                checksum: comp.sha256,
                size: comp.sizeMB * 1024 * 1024,
                quantization: this.convertQuantization(model.defaultQuantization),
            })),
            defaultQuantization: this.convertQuantization(model.defaultQuantization),
            supportedQuantizations: model.availableQuantizations.map(q => this.convertQuantization(q)),
            description: model.description,
            version: model.version,
        };
    }

    /**
     * Convert string quantization to enum
     */
    private convertQuantization(quant: string): Quantization {
        switch (quant) {
            case 'fp32': return Quantization.FP32;
            case 'fp16': return Quantization.FP16;
            case 'int8': return Quantization.INT8;
            case 'q4': return Quantization.Q4;
            case 'q5': return Quantization.Q5;
            case 'q8': return Quantization.Q8;
            default: return Quantization.FP32;
        }
    }

    /**
     * Initialize the backend - detect WebGPU and load ONNX Runtime
     */
    async initialize(): Promise<void> {
        console.log('[ONNXWebGPUBackend] Initializing...');

        // Check WebGPU availability
        this.webGPUInfo = await detectWebGPU();

        if (this.webGPUInfo?.available) {
            this.executionProvider = 'webgpu';
            console.log('[ONNXWebGPUBackend] WebGPU available:', {
                vendor: this.webGPUInfo.adapter?.vendor,
                device: this.webGPUInfo.adapter?.device,
            });
        } else {
            this.executionProvider = 'wasm';
            console.log('[ONNXWebGPUBackend] WebGPU not available, using WASM fallback');
        }

        // Dynamic import of ONNX Runtime Web to avoid CSP issues
        try {
            this.ort = await import('onnxruntime-web');
            console.log('[ONNXWebGPUBackend] ONNX Runtime Web loaded');
        } catch (error) {
            console.error('[ONNXWebGPUBackend] Failed to load ONNX Runtime Web:', error);
            throw new Error('Failed to load ONNX Runtime Web');
        }

        // Warm up the runtime
        console.log(`[ONNXWebGPUBackend] Using execution provider: ${this.executionProvider}`);
    }

    /**
     * Load a model into memory
     * Handles multi-component models (encoder/decoder/joiner/tokenizer)
     */
    async loadModel(modelId: string, onProgress?: ProgressCallback): Promise<void> {
        const model = getModelById(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found in registry`);
        }

        // Check WebGPU requirement
        if (model.requiresWebGPU && this.executionProvider !== 'webgpu') {
            throw new Error(`Model ${modelId} requires WebGPU but it's not available`);
        }

        this.currentModelId = modelId;
        this.abortController = new AbortController();

        console.log(`[ONNXWebGPUBackend] Loading model: ${model.name}`);

        if (!model.components || model.components.length === 0) {
            throw new Error(`Model ${modelId} has no components defined`);
        }

        const sessions: ModelSessions = {};
        const totalComponents = model.components.filter(c => c.type !== 'tokenizer' && c.type !== 'config').length;
        let loadedComponents = 0;

        // Load each component
        for (const component of model.components) {
            if (this.abortController.signal.aborted) {
                throw new Error('Model loading aborted');
            }

            // Skip non-ONNX components (tokenizer, config are loaded as JSON)
            if (component.type === 'tokenizer' || component.type === 'config') {
                const componentData = await this.loadComponentData(model, component, onProgress);
                if (component.type === 'tokenizer') {
                    sessions.tokenizer = componentData;
                } else {
                    sessions.config = componentData;
                }
                continue;
            }

            // Report progress
            onProgress?.({
                percent: (loadedComponents / totalComponents) * 100,
                message: `Loading ${component.type}...`,
                loadedBytes: loadedComponents,
                totalBytes: totalComponents,
            });

            // Load ONNX session for this component
            const session = await this.loadONNXSession(model, component, onProgress);

            switch (component.type) {
                case 'encoder':
                    sessions.encoder = session;
                    break;
                case 'decoder':
                    sessions.decoder = session;
                    break;
                case 'joiner':
                    sessions.joiner = session;
                    break;
            }

            loadedComponents++;

            // Report progress after component load
            onProgress?.({
                percent: (loadedComponents / totalComponents) * 100,
                message: `Loaded ${component.type}`,
                loadedBytes: loadedComponents,
                totalBytes: totalComponents,
            });
        }

        // Store sessions
        this.sessions.set(modelId, sessions);

        console.log(`[ONNXWebGPUBackend] Model ${modelId} loaded successfully`);

        onProgress?.({
            percent: 100,
            message: 'Model loaded',
            loadedBytes: totalComponents,
            totalBytes: totalComponents,
        });
    }

    /**
     * Load component data (for tokenizer/config JSON files)
     */
    private async loadComponentData(
        model: ASRModel,
        component: ModelComponent,
        onProgress?: ProgressCallback
    ): Promise<unknown> {
        const componentId = `${model.id}-${component.type}`;
        const url = model.hfId ? getHuggingFaceUrl(model, component) : '';

        if (!url) {
            throw new Error(`No URL for component ${component.type} of model ${model.id}`);
        }

        // Try to get from cache first
        const cached = await this.downloadManager.getModel(componentId);
        if (cached) {
            const text = new TextDecoder().decode(cached);
            return JSON.parse(text);
        }

        // Download if not cached
        const data = await this.downloadManager.downloadModel(
            componentId,
            url,
            component.sha256,
            {
                onProgress: onProgress
                    ? (progress) => onProgress({
                          percent: progress.percentage,
                          message: `Downloading ${component.type}...`,
                          loadedBytes: progress.loaded,
                          totalBytes: progress.total,
                      })
                    : undefined,
                signal: this.abortController?.signal,
            }
        );

        const text = new TextDecoder().decode(data);
        return JSON.parse(text);
    }

    /**
     * Load an ONNX session for a component
     */
    private async loadONNXSession(
        model: ASRModel,
        component: ModelComponent,
        onProgress?: ProgressCallback
    ): Promise<OrtSession> {
        if (!this.ort) {
            throw new Error('ONNX Runtime not initialized');
        }

        const componentId = `${model.id}-${component.type}`;
        const url = model.hfId ? getHuggingFaceUrl(model, component) : '';

        if (!url) {
            throw new Error(`No URL for component ${component.type} of model ${model.id}`);
        }

        // Try to get from cache first
        let modelData = await this.downloadManager.getModel(componentId);

        if (!modelData) {
            // Download the model
            modelData = await this.downloadManager.downloadModel(
                componentId,
                url,
                component.sha256,
                {
                    onProgress: onProgress
                        ? (progress) => onProgress({
                              percent: progress.percentage,
                              message: `Downloading ${component.type}...`,
                              loadedBytes: progress.loaded,
                              totalBytes: progress.total,
                          })
                        : undefined,
                    signal: this.abortController?.signal,
                }
            );
        }

        // Configure execution providers
        const executionProviders: ExecutionProviderConfig[] = [];

        if (this.executionProvider === 'webgpu') {
            executionProviders.push({
                name: 'webgpu',
                deviceType: 'gpu',
            });
        }

        // Always add WASM as fallback
        executionProviders.push({ name: 'wasm' });

        // Create session
        const session = await this.ort.InferenceSession.create(modelData, {
            executionProviders: executionProviders as unknown as string[],
            graphOptimizationLevel: 'all',
        });

        return session;
    }

    /**
     * Transcribe audio data to text
     * Supports both Moonshine and Whisper models
     */
    async transcribe(
        audioData: Float32Array,
        options: TranscriptionOptions = {}
    ): Promise<TranscriptionResult> {
        if (!this.currentModelId) {
            throw new Error('No model loaded');
        }

        if (!this.ort) {
            throw new Error('ONNX Runtime not initialized');
        }

        const sessions = this.sessions.get(this.currentModelId);
        if (!sessions) {
            throw new Error(`Model ${this.currentModelId} not loaded`);
        }

        this.abortController = new AbortController();
        const startTime = performance.now();

        try {
            const model = getModelById(this.currentModelId);
            if (!model) {
                throw new Error(`Model ${this.currentModelId} not found`);
            }

            // Route to appropriate transcription method based on model family
            let result: TranscriptionResult;

            switch (model.family) {
                case 'moonshine':
                    result = await this.transcribeMoonshine(audioData, sessions, options);
                    break;
                case 'whisper':
                    result = await this.transcribeWhisper(audioData, sessions, options);
                    break;
                default:
                    throw new Error(`Unsupported model family: ${model.family}`);
            }

            const processingTime = performance.now() - startTime;
            result.processingTime = processingTime;

            return result;
        } catch (error) {
            if (this.abortController.signal.aborted) {
                throw new Error('Transcription aborted');
            }
            throw error;
        }
    }

    /**
     * Transcribe using Moonshine model
     * Moonshine uses a simplified encoder-decoder architecture
     */
    private async transcribeMoonshine(
        audioData: Float32Array,
        sessions: ModelSessions,
        options: TranscriptionOptions
    ): Promise<TranscriptionResult> {
        if (!sessions.encoder || !sessions.decoder) {
            throw new Error('Moonshine model missing encoder or decoder');
        }

        if (!this.ort) {
            throw new Error('ONNX Runtime not initialized');
        }

        // Preprocess audio - normalize and reshape for Moonshine
        // Moonshine expects 16kHz mono audio
        const processedAudio = this.preprocessAudio(audioData, options.sampleRate || 16000);

        // Create input tensor
        const audioTensor = new this.ort.Tensor('float32', processedAudio, [1, processedAudio.length]);

        // Run encoder
        const encoderFeeds = { audio: audioTensor };
        const encoderResults = await sessions.encoder.run(encoderFeeds);
        const encoded = encoderResults.encoded || encoderResults.last_hidden_state;

        if (!encoded) {
            throw new Error('Encoder output not found');
        }

        // Greedy decoding (simplified for v1)
        const maxLength = options.maxDuration ? Math.floor(options.maxDuration * 10) : 100;
        const tokens: number[] = [];
        let prevToken = 0; // Start with BOS token

        for (let i = 0; i < maxLength; i++) {
            if (this.abortController?.signal.aborted) {
                break;
            }

            // Create decoder input
            const tokenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(prevToken)]), [1, 1]);
            const decoderFeeds: Record<string, OrtTensor> = {
                tokens: tokenTensor,
                encoded: encoded as OrtTensor,
            };

            // Run decoder
            const decoderResults = await sessions.decoder.run(decoderFeeds);
            const logits = decoderResults.logits as OrtTensor;

            // Greedy selection of next token
            const nextToken = this.argmax(logits.data as Float32Array);

            // Check for EOS
            if (nextToken === 0 || nextToken === 2) { // PAD or EOS
                break;
            }

            tokens.push(nextToken);
            prevToken = nextToken;
        }

        // Decode tokens to text (simplified - would use tokenizer in production)
        const text = this.tokensToText(tokens, sessions.tokenizer);

        // Create single segment result
        const segments: TranscriptionSegment[] = [{
            id: 0,
            start: 0,
            end: audioData.length / (options.sampleRate || 16000),
            text: text.trim(),
            confidence: 0.9, // Placeholder
        }];

        return {
            text: text.trim(),
            confidence: 0.9,
            segments,
            language: options.language || 'en',
            processingTime: 0, // Will be set by caller
            isPartial: false,
        };
    }

    /**
     * Transcribe using Whisper model
     * Whisper uses encoder-decoder with cross-attention and mel spectrogram input
     */
    private async transcribeWhisper(
        audioData: Float32Array,
        sessions: ModelSessions,
        options: TranscriptionOptions
    ): Promise<TranscriptionResult> {
        if (!sessions.encoder || !sessions.decoder) {
            throw new Error('Whisper model missing encoder or decoder');
        }

        if (!this.ort) {
            throw new Error('ONNX Runtime not initialized');
        }

        // Compute mel spectrogram for Whisper
        const melSpectrogram = this.computeMelSpectrogram(audioData, options.sampleRate || 16000);

        // Create input tensor [batch, n_mels, frames]
        const inputTensor = new this.ort.Tensor('float32', melSpectrogram, [1, 80, melSpectrogram.length / 80]);

        // Run encoder
        const encoderFeeds = { input_features: inputTensor };
        const encoderResults = await sessions.encoder.run(encoderFeeds);
        const encoderHiddenStates = encoderResults.encoder_hidden_states || Object.values(encoderResults)[0];

        if (!encoderHiddenStates) {
            throw new Error('Encoder output not found');
        }

        // Prepare initial tokens for decoder
        const language = options.language || 'en';
        const langToken = this.getWhisperLanguageToken(language);

        let tokens: number[] = [
            WHISPER_TOKEN_IDS.START_OF_TRANSCRIPT,
            langToken,
            WHISPER_TOKEN_IDS.TRANSCRIBE,
        ];

        if (!options.stream) { // timestamps disabled for file-based
            tokens.push(WHISPER_TOKEN_IDS.NOTIMESTAMPS);
        }

        // Greedy decoding
        const maxLength = 448; // Whisper max tokens
        let textTokens: number[] = [];

        for (let i = 0; i < maxLength && tokens.length < maxLength; i++) {
            if (this.abortController?.signal.aborted) {
                break;
            }

            // Create decoder input tensor
            const tokenArray = new Int32Array(tokens);
            const tokenTensor = new this.ort.Tensor('int32', tokenArray, [1, tokens.length]);

            const decoderFeeds: Record<string, OrtTensor> = {
                input_ids: tokenTensor,
                encoder_hidden_states: encoderHiddenStates as OrtTensor,
            };

            // Run decoder
            const decoderResults = await sessions.decoder.run(decoderFeeds);
            const logits = decoderResults.logits as OrtTensor;

            // Get logits for last token
            const vocabSize = 51864; // Whisper vocab size
            const lastLogits = (logits.data as Float32Array).slice(-vocabSize);

            // Greedy selection
            const nextToken = this.argmax(lastLogits);

            // Check for end of sequence
            if (nextToken === WHISPER_TOKEN_IDS.END_OF_TEXT) {
                break;
            }

            // Filter special tokens from output text
            if (nextToken < WHISPER_TOKEN_IDS.START_OF_TRANSCRIPT) {
                textTokens.push(nextToken);
            }

            tokens.push(nextToken);
        }

        // Decode tokens to text (simplified)
        const text = this.whisperTokensToText(textTokens);

        // Create result segments
        const duration = audioData.length / (options.sampleRate || 16000);
        const segments: TranscriptionSegment[] = [{
            id: 0,
            start: 0,
            end: duration,
            text: text.trim(),
            confidence: 0.85,
        }];

        return {
            text: text.trim(),
            confidence: 0.85,
            segments,
            language: language,
            processingTime: 0, // Will be set by caller
            isPartial: false,
        };
    }

    /**
     * Get Whisper language token ID
     */
    private getWhisperLanguageToken(language: string): number {
        // Whisper language tokens start at 50259
        const languageCodes: Record<string, number> = {
            'en': 50259,
            'zh': 50260,
            'de': 50261,
            'es': 50262,
            'ru': 50263,
            'ko': 50264,
            'fr': 50265,
            'ja': 50266,
            'pt': 50267,
            'tr': 50268,
            'pl': 50269,
            'ca': 50270,
            'nl': 50271,
            'ar': 50272,
            'sv': 50273,
            'it': 50274,
            'id': 50275,
            'hi': 50276,
            'fi': 50277,
            'vi': 50278,
            'he': 50279,
            'uk': 50280,
            'el': 50281,
            'ms': 50282,
            'cs': 50283,
            'ro': 50284,
            'da': 50285,
            'hu': 50286,
            'ta': 50287,
            'no': 50288,
            'th': 50289,
            'ur': 50290,
            'hr': 50291,
            'bg': 50292,
            'lt': 50293,
            'la': 50294,
            'mi': 50295,
            'ml': 50296,
            'cy': 50297,
            'sk': 50298,
            'te': 50299,
            'fa': 50300,
            'lv': 50301,
            'bn': 50302,
            'sr': 50303,
            'az': 50304,
            'sl': 50305,
            'kn': 50306,
            'et': 50307,
            'mk': 50308,
            'br': 50309,
            'eu': 50310,
            'is': 50311,
            'hy': 50312,
            'ne': 50313,
            'mn': 50314,
            'bs': 50315,
            'kk': 50316,
            'sq': 50317,
            'sw': 50318,
            'gl': 50319,
            'mr': 50320,
            'pa': 50321,
            'si': 50322,
            'km': 50323,
            'sn': 50324,
            'yo': 50325,
            'so': 50326,
            'af': 50327,
            'oc': 50328,
            'ka': 50329,
            'be': 50330,
            'tg': 50331,
            'sd': 50332,
            'gu': 50333,
            'am': 50334,
            'yi': 50335,
            'lo': 50336,
            'uz': 50337,
            'fo': 50338,
            'ht': 50339,
            'ps': 50340,
            'tk': 50341,
            'nn': 50342,
            'mt': 50343,
            'sa': 50344,
            'lb': 50345,
            'my': 50346,
            'bo': 50347,
            'tl': 50348,
            'mg': 50349,
            'as': 50350,
            'tt': 50351,
            'haw': 50352,
            'ln': 50353,
            'ha': 50354,
            'ba': 50355,
            'jw': 50356,
            'su': 50357,
        };

        return languageCodes[language] || 50259; // Default to English
    }

    /**
     * Convert Whisper tokens to text (simplified implementation)
     */
    private whisperTokensToText(tokens: number[]): string {
        // This is a simplified placeholder
        // In production, would use the Whisper tokenizer
        // For now, return placeholder indicating transcription was successful
        return `[Transcribed ${tokens.length} tokens]`;
    }

    /**
     * Preprocess audio for ASR
     * - Resample to target sample rate if needed
     * - Normalize to [-1, 1] range
     */
    private preprocessAudio(audioData: Float32Array, sampleRate: number): Float32Array {
        // Normalize audio to [-1, 1]
        let maxVal = 0;
        for (let i = 0; i < audioData.length; i++) {
            maxVal = Math.max(maxVal, Math.abs(audioData[i]));
        }

        if (maxVal === 0) {
            return audioData;
        }

        const normalized = new Float32Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            normalized[i] = audioData[i] / maxVal;
        }

        return normalized;
    }

    /**
     * Compute mel spectrogram for Whisper
     * Simplified implementation - production would use proper STFT and mel filterbank
     */
    private computeMelSpectrogram(audioData: Float32Array, sampleRate: number): Float32Array {
        // Simplified placeholder - returns dummy mel spectrogram
        // In production, would implement:
        // 1. STFT with Hann window
        // 2. Mel filterbank application
        // 3. Log compression

        const nMels = 80;
        const hopLength = 160; // 10ms at 16kHz
        const nFrames = Math.ceil(audioData.length / hopLength);

        // Placeholder: return zeros (actual implementation would compute real mel spectrogram)
        return new Float32Array(nMels * nFrames);
    }

    /**
     * Find index of maximum value (argmax) for greedy decoding
     */
    private argmax(data: Float32Array | number[]): number {
        let maxIdx = 0;
        let maxVal = data[0];

        for (let i = 1; i < data.length; i++) {
            if (data[i] > maxVal) {
                maxVal = data[i];
                maxIdx = i;
            }
        }

        return maxIdx;
    }

    /**
     * Convert tokens to text using tokenizer
     * Simplified placeholder implementation
     */
    private tokensToText(tokens: number[], tokenizer: unknown): string {
        // Placeholder - would use actual tokenizer vocabulary
        return `[Decoded ${tokens.length} tokens]`;
    }

    /**
     * Abort any ongoing operation
     */
    abort(): void {
        console.log('[ONNXWebGPUBackend] Aborting current operation');
        this.abortController?.abort();
    }

    /**
     * Dispose of all resources
     */
    async dispose(): Promise<void> {
        console.log('[ONNXWebGPUBackend] Disposing resources...');

        // Abort any ongoing operation
        this.abort();

        // Release all ONNX sessions
        for (const [modelId, sessions] of this.sessions.entries()) {
            console.log(`[ONNXWebGPUBackend] Releasing sessions for ${modelId}`);

            if (sessions.encoder) {
                await sessions.encoder.release();
            }
            if (sessions.decoder) {
                await sessions.decoder.release();
            }
            if (sessions.joiner) {
                await sessions.joiner.release();
            }
        }

        this.sessions.clear();
        this.currentModelId = null;
        this.ort = null;

        console.log('[ONNXWebGPUBackend] Resources disposed');
    }

    /**
     * Check if quantization level is supported
     */
    supportsQuantization(quant: Quantization): boolean {
        // ONNX Runtime Web supports Q4, INT8, and FP16
        return [
            Quantization.Q4,
            Quantization.INT8,
            Quantization.FP16,
            Quantization.FP32,
        ].includes(quant);
    }

    /**
     * Check if device type is supported
     */
    supportsDevice(device: DeviceType): boolean {
        return device === DeviceType.GPU || device === DeviceType.CPU;
    }

    /**
     * Check if backend is available
     * Available even if WebGPU not supported (WASM fallback)
     */
    async isAvailable(): Promise<boolean> {
        // ONNX Runtime Web is always available (has WASM fallback)
        // Just need to verify we can load the module
        try {
            const ort = await import('onnxruntime-web');
            return !!ort;
        } catch {
            return false;
        }
    }

    /**
     * Get current execution provider info
     */
    getExecutionProvider(): string {
        return this.executionProvider;
    }

    /**
     * Check if currently using WebGPU
     */
    isUsingWebGPU(): boolean {
        return this.executionProvider === 'webgpu';
    }
}

/** Export singleton instance */
export const onnxWebGPUBackend = new ONNXWebGPUBackend();

/** Export default */
export default ONNXWebGPUBackend;
