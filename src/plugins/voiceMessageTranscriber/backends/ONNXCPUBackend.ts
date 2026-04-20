/*
 * Potatocord, a Discord client mod
 * Copyright (c) 2026 Potatocord and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    ASRModel,
    getModelById,
    ModelComponent,
    PARAKEET_MODELS,
} from "@plugins/voiceMessageTranscriber/models/registry";
import { buildHuggingFaceUrl,DownloadProgress, ModelDownloadManager } from "@plugins/voiceMessageTranscriber/utils/downloadManager";
import * as ort from "onnxruntime-web";

import {
    ASRBackend,
    DeviceType,
    ModelConfig,
    ProgressCallback,
    Quantization,
    TranscriptionOptions,
    TranscriptionResult,
    TranscriptionSegment,
} from "./types";

interface AudioConfig {
    sampleRate: number;
    nFFT: number;
    hopLength: number;
    nMels: number;
    fMin: number;
    fMax: number;
}

interface TokenizerConfig {
    vocab: Record<string, number>;
    reverseVocab: Record<number, string>;
    blankId: number;
    unkId: number;
    spaceId: number;
}

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
    sampleRate: 16000,
    nFFT: 400,
    hopLength: 160,
    nMels: 80,
    fMin: 0,
    fMax: 8000,
};

const CHUNK_DURATION_SEC = 30;
const MAX_TOKENS_PER_CHUNK = 500;
const BLANK_TOKEN_ID = 0;

export class ONNXCPUBackend implements ASRBackend {
    id = "onnx-cpu" as const;
    name = "ONNX Runtime (CPU)";
    supportedModels: ModelConfig[] = PARAKEET_MODELS as unknown as ModelConfig[];

    private encoder: ort.InferenceSession | null = null;
    private decoder: ort.InferenceSession | null = null;
    private joiner: ort.InferenceSession | null = null;
    private currentModelId: string | null = null;
    private abortController: AbortController | null = null;
    private downloadManager: ModelDownloadManager;
    private tokenizerConfig: TokenizerConfig | null = null;

    constructor() {
        this.downloadManager = new ModelDownloadManager({
            maxRetries: 3,
            retryDelay: 1000,
        });

        ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
        ort.env.wasm.simd = true;
    }

    async initialize(): Promise<void> {
        // ONNX sessions are created during loadModel()
    }

    async loadModel(modelId: string, onProgress?: ProgressCallback): Promise<void> {
        const model = getModelById(modelId);
        if (!model) {
            throw new Error(`Model ${modelId} not found`);
        }

        if (model.backend !== "onnx-cpu") {
            throw new Error(`Model ${modelId} does not support onnx-cpu backend`);
        }

        if (this.currentModelId && this.currentModelId !== modelId) {
            await this.dispose();
        }

        this.abortController = new AbortController();
        const totalComponents = model.components?.length || 0;
        let loadedComponents = 0;

        try {
            if (model.components) {
                for (const component of model.components) {
                    if (this.abortController.signal.aborted) {
                        throw new Error("Model loading aborted");
                    }

                    await this.loadComponent(model, component, onProgress, () => {
                        loadedComponents++;
                        const percent = (loadedComponents / totalComponents) * 100;
                        onProgress?.({
                            percent,
                            message: `Loading ${component.type} (${loadedComponents}/${totalComponents})...`,
                            loadedBytes: 0,
                            totalBytes: 0,
                        });
                    });
                }
            }

            this.currentModelId = modelId;
            this.initializeTokenizer();

            onProgress?.({
                percent: 100,
                message: "Model loaded successfully",
                loadedBytes: model.sizeMB * 1024 * 1024,
                totalBytes: model.sizeMB * 1024 * 1024,
            });
        } catch (error) {
            await this.dispose();
            throw error;
        }
    }

    async transcribe(
        audioData: Float32Array,
        options: TranscriptionOptions
    ): Promise<TranscriptionResult> {
        if (!this.encoder || !this.decoder || !this.joiner) {
            throw new Error("Model not loaded. Call loadModel() first.");
        }

        const startTime = performance.now();
        this.abortController = new AbortController();

        const sampleRate = options.sampleRate || DEFAULT_AUDIO_CONFIG.sampleRate;

        try {
            const chunkSize = CHUNK_DURATION_SEC * sampleRate;
            const numChunks = Math.ceil(audioData.length / chunkSize);

            let allTokens: number[] = [];
            let segments: TranscriptionSegment[] = [];
            let totalConfidence = 0;

            for (let i = 0; i < numChunks; i++) {
                if (this.abortController.signal.aborted) {
                    throw new Error("Transcription aborted");
                }

                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, audioData.length);
                const chunk = audioData.slice(start, end);

                const result = await this.transcribeChunk(chunk, {
                    ...options,
                    sampleRate,
                });

                const timeOffset = i * CHUNK_DURATION_SEC;
                const adjustedSegments = result.segments.map(seg => ({
                    ...seg,
                    start: seg.start + timeOffset,
                    end: seg.end + timeOffset,
                }));

                allTokens = allTokens.concat(result.tokens);
                segments = segments.concat(adjustedSegments);
                totalConfidence += result.confidence;
            }

            const text = this.tokensToText(allTokens);
            const avgConfidence = numChunks > 0 ? totalConfidence / numChunks : 0;
            const processingTime = performance.now() - startTime;

            return {
                text,
                confidence: avgConfidence,
                segments,
                language: options.language || "en",
                processingTime,
                isPartial: false,
            };
        } catch (error) {
            if ((error as Error).message === "Transcription aborted") {
                throw error;
            }
            throw new Error(`Transcription failed: ${error}`);
        }
    }

    abort(): void {
        this.abortController?.abort();
    }

    async dispose(): Promise<void> {
        this.abortController?.abort();

        if (this.encoder) {
            await this.encoder.release();
            this.encoder = null;
        }
        if (this.decoder) {
            await this.decoder.release();
            this.decoder = null;
        }
        if (this.joiner) {
            await this.joiner.release();
            this.joiner = null;
        }

        this.currentModelId = null;
        this.tokenizerConfig = null;
    }

    supportsQuantization(quant: Quantization): boolean {
        return quant === Quantization.INT8;
    }

    supportsDevice(device: DeviceType): boolean {
        return device === DeviceType.CPU;
    }

    async isAvailable(): Promise<boolean> {
        return true;
    }

    private async loadComponent(
        model: ASRModel,
        component: ModelComponent,
        onProgress?: ProgressCallback,
        onComplete?: () => void
    ): Promise<void> {
        const componentId = `${model.id}-${component.type}`;
        const url = buildHuggingFaceUrl(model.hfId!, component.filename);

        let modelData: ArrayBuffer;

        if (await this.downloadManager.hasModel(componentId)) {
            const cached = await this.downloadManager.getModel(componentId);
            if (cached) {
                modelData = cached;
            } else {
                modelData = await this.downloadManager.downloadModel(
                    componentId,
                    url,
                    component.sha256,
                    {
                        onProgress: (progress: DownloadProgress) => {
                            onProgress?.({
                                percent: progress.percentage,
                                message: `Downloading ${component.type}...`,
                                loadedBytes: progress.loaded,
                                totalBytes: progress.total,
                            });
                        },
                        signal: this.abortController?.signal,
                    }
                );
            }
        } else {
            modelData = await this.downloadManager.downloadModel(
                componentId,
                url,
                component.sha256,
                {
                    onProgress: (progress: DownloadProgress) => {
                        onProgress?.({
                            percent: progress.percentage,
                            message: `Downloading ${component.type}...`,
                            loadedBytes: progress.loaded,
                            totalBytes: progress.total,
                        });
                    },
                    signal: this.abortController?.signal,
                }
            );
        }

        const sessionOptions: ort.InferenceSession.SessionOptions = {
            executionProviders: ["wasm"],
            graphOptimizationLevel: "all",
            enableCpuMemArena: true,
        };

        const session = await ort.InferenceSession.create(
            new Uint8Array(modelData),
            sessionOptions
        );

        switch (component.type) {
            case "encoder":
                this.encoder = session;
                break;
            case "decoder":
                this.decoder = session;
                break;
            case "joiner":
                this.joiner = session;
                break;
        }

        onComplete?.();
    }

    private initializeTokenizer(): void {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789 \'".,!?-:;()';
        const vocab: Record<string, number> = {};
        const reverseVocab: Record<number, string> = {};

        vocab["<blank>"] = BLANK_TOKEN_ID;
        reverseVocab[BLANK_TOKEN_ID] = "<blank>";

        vocab["<unk>"] = 1;
        reverseVocab[1] = "<unk>";

        vocab["<space>"] = 2;
        reverseVocab[2] = " ";

        let id = 3;
        for (const char of chars) {
            vocab[char] = id;
            reverseVocab[id] = char;
            id++;
        }

        this.tokenizerConfig = {
            vocab,
            reverseVocab,
            blankId: BLANK_TOKEN_ID,
            unkId: 1,
            spaceId: 2,
        };
    }

    private async transcribeChunk(
        audioChunk: Float32Array,
        options: { sampleRate: number; language?: string }
    ): Promise<{ tokens: number[]; segments: TranscriptionSegment[]; confidence: number }> {
        const melFeatures = this.audioToMelSpectrogram(audioChunk, options.sampleRate);
        const encoderOutput = await this.runEncoder(melFeatures);
        const result = await this.tdtGreedyDecode(encoderOutput);

        return result;
    }

    private audioToMelSpectrogram(audio: Float32Array, sampleRate: number): ort.Tensor {
        const { nFFT, hopLength, nMels, fMin, fMax } = DEFAULT_AUDIO_CONFIG;

        const resampled = sampleRate === 16000 ? audio : this.resampleAudio(audio, sampleRate, 16000);
        const stft = this.computeSTFT(resampled, nFFT, hopLength);
        const melSpec = this.stftToMel(stft, nFFT, nMels, fMin, fMax, 16000);
        const logMel = this.applyLogAndNormalize(melSpec);

        const dims = [1, nMels, logMel.length / nMels];
        return new ort.Tensor("float32", logMel, dims);
    }

    private resampleAudio(audio: Float32Array, fromRate: number, toRate: number): Float32Array {
        const ratio = fromRate / toRate;
        const newLength = Math.ceil(audio.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIdx = i * ratio;
            const idx0 = Math.floor(srcIdx);
            const idx1 = Math.min(idx0 + 1, audio.length - 1);
            const frac = srcIdx - idx0;

            result[i] = audio[idx0] * (1 - frac) + audio[idx1] * frac;
        }

        return result;
    }

    private computeSTFT(audio: Float32Array, nFFT: number, hopLength: number): Float32Array {
        const numFrames = Math.ceil((audio.length - nFFT) / hopLength) + 1;
        const result = new Float32Array(numFrames * (nFFT / 2 + 1));
        const window = this.createHannWindow(nFFT);

        for (let frame = 0; frame < numFrames; frame++) {
            const start = frame * hopLength;
            const frameData = new Float64Array(nFFT);

            for (let i = 0; i < nFFT; i++) {
                if (start + i < audio.length) {
                    frameData[i] = audio[start + i] * window[i];
                }
            }

            const spectrum = this.fftMagnitude(frameData);

            for (let i = 0; i < spectrum.length; i++) {
                result[frame * (nFFT / 2 + 1) + i] = spectrum[i];
            }
        }

        return result;
    }

    private createHannWindow(size: number): Float32Array {
        const window = new Float32Array(size);
        for (let i = 0; i < size; i++) {
            window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
        }
        return window;
    }

    private fftMagnitude(real: Float64Array): Float32Array {
        const n = real.length;
        const result = new Float32Array(n / 2 + 1);

        for (let k = 0; k <= n / 2; k++) {
            let sumReal = 0;
            let sumImag = 0;

            for (let t = 0; t < n; t++) {
                const angle = -(2 * Math.PI * k * t) / n;
                sumReal += real[t] * Math.cos(angle);
                sumImag += real[t] * Math.sin(angle);
            }

            result[k] = Math.sqrt(sumReal * sumReal + sumImag * sumImag);
        }

        return result;
    }

    private stftToMel(
        stft: Float32Array,
        nFFT: number,
        nMels: number,
        fMin: number,
        fMax: number,
        sampleRate: number
    ): Float32Array {
        const numFrames = stft.length / (nFFT / 2 + 1);
        const melFilters = this.createMelFilterbank(nFFT, nMels, fMin, fMax, sampleRate);

        const melSpec = new Float32Array(numFrames * nMels);

        for (let frame = 0; frame < numFrames; frame++) {
            const frameStart = frame * (nFFT / 2 + 1);

            for (let mel = 0; mel < nMels; mel++) {
                let sum = 0;
                for (let bin = 0; bin < nFFT / 2 + 1; bin++) {
                    sum += stft[frameStart + bin] * melFilters[mel * (nFFT / 2 + 1) + bin];
                }
                melSpec[frame * nMels + mel] = sum;
            }
        }

        return melSpec;
    }

    private createMelFilterbank(
        nFFT: number,
        nMels: number,
        fMin: number,
        fMax: number,
        sampleRate: number
    ): Float32Array {
        const numBins = nFFT / 2 + 1;
        const filters = new Float32Array(nMels * numBins);

        const melMin = this.hzToMel(fMin);
        const melMax = this.hzToMel(fMax);
        const melStep = (melMax - melMin) / (nMels + 1);

        const melCenters = new Float32Array(nMels + 2);
        for (let i = 0; i < nMels + 2; i++) {
            melCenters[i] = melMin + i * melStep;
        }

        const freqCenters = melCenters.map(m => this.melToHz(m));
        const binCenters = freqCenters.map(f => Math.floor((nFFT + 1) * f / sampleRate));

        for (let mel = 0; mel < nMels; mel++) {
            const left = binCenters[mel];
            const center = binCenters[mel + 1];
            const right = binCenters[mel + 2];

            for (let bin = left; bin < center; bin++) {
                filters[mel * numBins + bin] = (bin - left) / (center - left);
            }

            for (let bin = center; bin < right; bin++) {
                filters[mel * numBins + bin] = (right - bin) / (right - center);
            }
        }

        return filters;
    }

    private hzToMel(hz: number): number {
        return 2595 * Math.log10(1 + hz / 700);
    }

    private melToHz(mel: number): number {
        return 700 * (Math.pow(10, mel / 2595) - 1);
    }

    private applyLogAndNormalize(melSpec: Float32Array): Float32Array {
        const result = new Float32Array(melSpec.length);

        for (let i = 0; i < melSpec.length; i++) {
            result[i] = Math.log(Math.max(melSpec[i], 1e-10));
        }

        const mean = result.reduce((a, b) => a + b) / result.length;
        const std = Math.sqrt(result.reduce((a, b) => a + (b - mean) ** 2, 0) / result.length);

        for (let i = 0; i < result.length; i++) {
            result[i] = (result[i] - mean) / (std + 1e-8);
        }

        return result;
    }

    private async runEncoder(melFeatures: ort.Tensor): Promise<ort.Tensor> {
        if (!this.encoder) {
            throw new Error("Encoder not loaded");
        }

        const feeds: Record<string, ort.Tensor> = {
            input: melFeatures,
        };

        const results = await this.encoder.run(feeds);
        return results.output || results.encoder_out || results.hidden_states || Object.values(results)[0];
    }

    private async tdtGreedyDecode(encoderOutput: ort.Tensor): Promise<{
        tokens: number[];
        segments: TranscriptionSegment[];
        confidence: number;
    }> {
        if (!this.decoder || !this.joiner) {
            throw new Error("Decoder or joiner not loaded");
        }

        const tokens: number[] = [];
        const encoderFrames = encoderOutput.dims[1];

        const decoderStateSize = 640;
        let decoderState = new Float32Array(decoderStateSize);
        let prevToken = BLANK_TOKEN_ID;

        let encoderFrameIdx = 0;
        let tokenCount = 0;
        let totalScore = 0;

        const segments: TranscriptionSegment[] = [];
        let segmentStartTime = 0;
        let segmentText = "";

        while (encoderFrameIdx < encoderFrames && tokenCount < MAX_TOKENS_PER_CHUNK) {
            if (this.abortController?.signal.aborted) {
                throw new Error("Transcription aborted");
            }

            const encoderFrame = this.getEncoderFrame(encoderOutput, encoderFrameIdx);

            const { tokenLogits, durationLogits, newState } = await this.runDecoder(
                prevToken,
                decoderState
            );

            const jointLogits = await this.runJoiner(encoderFrame, tokenLogits);

            const tokenProbs = this.softmax(jointLogits);
            const predictedToken = this.argmax(tokenProbs);
            const tokenScore = tokenProbs[predictedToken];

            const durationProbs = this.softmax(durationLogits);
            const predictedDuration = Math.min(this.argmax(durationProbs), encoderFrames - encoderFrameIdx - 1);
            const durationScore = durationProbs[predictedDuration];

            totalScore += (tokenScore + durationScore) / 2;

            if (predictedToken === BLANK_TOKEN_ID) {
                encoderFrameIdx += 1;
            } else {
                tokens.push(predictedToken);
                prevToken = predictedToken;
                decoderState = new Float32Array(newState);
                encoderFrameIdx += Math.max(1, predictedDuration + 1);

                const char = this.tokenToChar(predictedToken);
                if (char === " " || char === "." || char === "!" || char === "?") {
                    if (segmentText) {
                        const endTime = (encoderFrameIdx * DEFAULT_AUDIO_CONFIG.hopLength) / 16000;
                        segments.push({
                            id: segments.length,
                            start: segmentStartTime,
                            end: endTime,
                            text: segmentText + char,
                            confidence: tokenScore,
                        });
                        segmentText = "";
                        segmentStartTime = endTime;
                    }
                } else {
                    segmentText += char;
                }

                tokenCount++;
            }
        }

        if (segmentText) {
            const endTime = (encoderFrameIdx * DEFAULT_AUDIO_CONFIG.hopLength) / 16000;
            segments.push({
                id: segments.length,
                start: segmentStartTime,
                end: endTime,
                text: segmentText,
                confidence: totalScore / Math.max(tokenCount, 1),
            });
        }

        const avgConfidence = tokenCount > 0 ? totalScore / tokenCount : 0;

        return { tokens, segments, confidence: avgConfidence };
    }

    private getEncoderFrame(encoderOutput: ort.Tensor, frameIdx: number): ort.Tensor {
        const { dims } = encoderOutput;
        const batch = dims[0];
        const frames = dims[1];
        const hidden = dims[2];

        const data = encoderOutput.data as Float32Array;
        const frameSize = hidden;
        const startIdx = frameIdx * frameSize;

        const frameData = data.slice(startIdx, startIdx + frameSize);
        return new ort.Tensor("float32", frameData, [batch, hidden]);
    }

    private async runDecoder(
        prevToken: number,
        state: Float32Array
    ): Promise<{ tokenLogits: Float32Array; durationLogits: Float32Array; newState: Float32Array }> {
        if (!this.decoder) {
            throw new Error("Decoder not loaded");
        }

        const tokenTensor = new ort.Tensor("int64", new BigInt64Array([BigInt(prevToken)]), [1]);
        const stateTensor = new ort.Tensor("float32", state, [1, state.length]);

        const feeds: Record<string, ort.Tensor> = {
            input: tokenTensor,
            state: stateTensor,
        };

        const results = await this.decoder.run(feeds);

        const tokenLogits = results.token_logits?.data as Float32Array || new Float32Array(0);
        const durationLogits = results.duration_logits?.data as Float32Array || new Float32Array(0);
        const newState = results.new_state?.data as Float32Array || state;

        return { tokenLogits, durationLogits, newState };
    }

    private async runJoiner(encoderOut: ort.Tensor, decoderOut: Float32Array): Promise<Float32Array> {
        if (!this.joiner) {
            throw new Error("Joiner not loaded");
        }

        const decoderTensor = new ort.Tensor("float32", decoderOut, [1, decoderOut.length]);

        const feeds: Record<string, ort.Tensor> = {
            encoder_out: encoderOut,
            decoder_out: decoderTensor,
        };

        const results = await this.joiner.run(feeds);
        const logits = results.logits?.data as Float32Array || Object.values(results)[0].data as Float32Array;

        return logits;
    }

    private softmax(logits: Float32Array): Float32Array {
        const max = Math.max(...logits);
        const exp = logits.map(x => Math.exp(x - max));
        const sum = exp.reduce((a, b) => a + b, 0);
        return exp.map(x => x / sum);
    }

    private argmax(arr: Float32Array | number[]): number {
        let maxIdx = 0;
        let maxVal = arr[0];

        for (let i = 1; i < arr.length; i++) {
            if (arr[i] > maxVal) {
                maxVal = arr[i];
                maxIdx = i;
            }
        }

        return maxIdx;
    }

    private tokenToChar(tokenId: number): string {
        if (!this.tokenizerConfig) {
            return "";
        }

        const char = this.tokenizerConfig.reverseVocab[tokenId];
        if (!char || char === "<blank>" || char === "<unk>") {
            return "";
        }

        return char;
    }

    private tokensToText(tokens: number[]): string {
        if (!this.tokenizerConfig) {
            return "";
        }

        const chars: string[] = [];

        for (const token of tokens) {
            const char = this.tokenToChar(token);
            if (char) {
                chars.push(char);
            }
        }

        return chars.join("").trim();
    }
}

export const onnxCPUBackend = new ONNXCPUBackend();

export default ONNXCPUBackend;
