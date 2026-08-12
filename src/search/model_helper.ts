import { InferenceSession, Tensor } from "onnxruntime-node";
import { SpanModel } from "../utils/gliner/model";
import { ClipTokenizer } from "../utils/clip/tokenizer";
import { NerResult } from "../types";
import { NER_QUERY_LABELS, NER_SEARCH_LABELS, constants } from "../constants";


const embedText = async (text: string, clipSessionPromise: Promise<InferenceSession>, tokenizerPromise: Promise<ClipTokenizer>) => {
    console.time('embedText');
    console.log("Starting tokenizer load");
    const tokenizer = await tokenizerPromise;
    console.timeLog("embedText", "Tokenizer load complete");

    const tokenIds = tokenizer.encode(text);
    console.log("tokenIds:", tokenIds);
    const tokensTensor = new Tensor(constants.tokens_type, tokenIds, [1, tokenIds.length]);
    console.log("tokensTensor:", tokensTensor);

    console.timeLog("embedText", "Starting clip session load");
    const clipSession = await clipSessionPromise;
    console.timeLog("embedText", "Clip session load complete");

    const embedRes = await clipSession.run({"text": tokensTensor});
    console.timeEnd("embedText");
    console.log("Embedding inference done.");
    return Array.prototype.slice.call(embedRes["embeddings"].data);
};

const extractNER = async (text: string, glinerModelTask: Promise<SpanModel>) => {
    console.log("Text:", text);

    console.time('extractNER');
    console.log("Starting gliner load");
    const glinerModel = await glinerModelTask;
    console.timeLog("extractNER", "Gliner initialize complete");

    const nerRes = await glinerModel.inference(
        [text],
        NER_QUERY_LABELS
    );
    console.log("Ner res:", nerRes);
    const nerResults: NerResult[] = nerRes[0].filter(res => NER_SEARCH_LABELS.includes(res.label))
        .map((res) => ({
            label: res.label,
            text: res.spanText,
            score: res.score,
        }));

    console.timeEnd("extractNER");
    console.log("NER inference done.");
    return nerResults;
};

export { embedText, extractNER };
