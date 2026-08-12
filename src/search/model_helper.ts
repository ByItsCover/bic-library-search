import { InferenceSession, Tensor } from "onnxruntime-node";
import { SpanModel } from "../utils/gliner/model";
import { ClipTokenizer } from "../utils/clip/tokenizer";
import { NerResult } from "../types";
import { NER_QUERY_LABELS, NER_SEARCH_LABELS, constants } from "../constants";


const embedText = async (
    text: string, clipSessionPromise: Promise<InferenceSession>, tokenizerPromise: Promise<ClipTokenizer>
) => {
    const tokenizer = await tokenizerPromise;
    const tokenIds = tokenizer.encode(text);
    const tokensTensor = new Tensor(constants.tokens_type, tokenIds, [1, tokenIds.length]);

    const clipSession = await clipSessionPromise;
    const embedRes = await clipSession.run({"text": tokensTensor});

    return Array.prototype.slice.call(embedRes["embeddings"].data);
};

const extractNER = async (text: string, glinerModelTask: Promise<SpanModel>) => {
    const glinerModel = await glinerModelTask;
    const nerRes = await glinerModel.inference(
        [text],
        NER_QUERY_LABELS
    );

    const nerResults: NerResult[] = nerRes[0].filter(res => NER_SEARCH_LABELS.includes(res.label))
        .map((res) => ({
            label: res.label,
            text: res.spanText,
            score: res.score,
        }));
    return nerResults;
};

export { embedText, extractNER };
