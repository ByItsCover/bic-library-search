/*
 * Portions of this code are used under the Apache License, Version 2.0.
 * Copyright (c) 2024 Knowledgator
 * Original source: https://github.com/Knowledgator/GLiNER.js/blob/main/src/lib/model.ts
*/

import * as ort from "onnxruntime-node";
import { Tokenizer } from "@huggingface/tokenizers";
import { SpanProcessor, WhitespaceTokenSplitter } from "./processor";
import { SpanDecoder } from "./decoder";
import { IEntityResult, InferenceResultMultiple, ProcessBatch, RawInferenceResult } from "../../types";
import logger from "../../logger";


const loadGliner = async (modelPath: string, tokenizerPromise: Promise<[Tokenizer, any]>) => {
    try {
        logger.info("Creating gliner session");
        const session = await ort.InferenceSession.create(
            modelPath,
            {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'basic',
                interOpNumThreads: 1,
                intraOpNumThreads: 1,
                enableCpuMemArena: false,
            }
        );
        logger.info("Loaded session");
        //const [tokenizer, _] = await tokenizerPromise;
        logger.info("Initializing gliner span model");
        //const model = new SpanModel(session, tokenizer);
        logger.info("Gliner load complete");
        return null;
    } catch (error) {
        logger.error("Load Gliner failed", error as Error);
        throw error;
    }
}

class SpanModel {
    processor: SpanProcessor;
    decoder: SpanDecoder;

    constructor(
        public onnxSession: ort.InferenceSession,
        public tokenizer: Tokenizer,
        public maxWidth: number = 12,
        processor: SpanProcessor | null = null,
        decoder: SpanDecoder | null = null,
    ) {
        const wordSplitter = new WhitespaceTokenSplitter();
        this.processor = processor ?? new SpanProcessor(tokenizer, wordSplitter, maxWidth);
        this.decoder = decoder ?? new SpanDecoder();
    }

    prepareInputs(batch: ProcessBatch): Record<string, ort.Tensor> {
        const batch_size: number = batch.inputsIds.length;
        const num_tokens: number = batch.inputsIds[0].length;
        const num_spans: number = batch.spanIdxs[0].length;

        const createTensor = (data: any[], shape: number[], tensorType: any = "int64"): ort.Tensor => {
            return new ort.Tensor(tensorType, data.flat(Infinity), shape);
        };
        let input_ids: ort.Tensor = createTensor(batch.inputsIds, [batch_size, num_tokens]);
        let attention_mask: ort.Tensor = createTensor(batch.attentionMasks, [batch_size, num_tokens]); // NOTE: why convert to bool but type is not bool?
        let words_mask: ort.Tensor = createTensor(batch.wordsMasks, [batch_size, num_tokens]);
        let text_lengths: ort.Tensor = createTensor(batch.textLengths, [batch_size, 1]);
        let span_idx: ort.Tensor = createTensor(batch.spanIdxs, [batch_size, num_spans, 2]);
        let span_mask: ort.Tensor = createTensor(batch.spanMasks, [batch_size, num_spans], "bool");

        const feeds: Record<string, ort.Tensor> = {
            input_ids: input_ids,
            attention_mask: attention_mask,
            words_mask: words_mask,
            text_lengths: text_lengths,
            span_idx: span_idx,
            span_mask: span_mask,
        };

        return feeds;
    }

    mapRawResultToResponse(rawResult: RawInferenceResult): InferenceResultMultiple {
        const response: InferenceResultMultiple = [];
        for (const individualResult of rawResult) {
            const entityResult: IEntityResult[] = individualResult.map(
                ([spanText, start, end, label, score]) => ({
                    spanText,
                    start,
                    end,
                    label,
                    score,
                }),
            );
            response.push(entityResult);
        }

        return response;
    }

    async inference(
        texts: string[],
        entities: string[],
        flatNer: boolean = false,
        threshold: number = 0.5,
        multiLabel: boolean = false,
    ): Promise<InferenceResultMultiple> {
        let batch = this.processor.prepareBatch(texts, entities);
        let feeds: Record<string, ort.Tensor> = this.prepareInputs(batch);
        const results = await this.onnxSession.run(feeds);
        const modelOutput = results["logits"].data as Float32Array<ArrayBufferLike>;

        const batchSize: number = batch.batchTokens.length;
        const inputLength: number = Math.max(...batch.textLengths);
        const maxWidth: number = this.maxWidth;
        const numEntities: number = entities.length;
        const batchIds: number[] = Array.from({ length: batchSize }, (_, i) => i);
        const decodedSpans: RawInferenceResult = this.decoder.decode(
            batchSize,
            inputLength,
            maxWidth,
            numEntities,
            texts,
            batchIds,
            batch.batchWordsStartIdx,
            batch.batchWordsEndIdx,
            batch.idToClass,
            modelOutput,
            flatNer,
            threshold,
            multiLabel,
        );

        return this.mapRawResultToResponse(decodedSpans);
    }
}

export { loadGliner, SpanModel };
