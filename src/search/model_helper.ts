import { PreTrainedTokenizer } from "@huggingface/transformers";
import { InferenceSession, Tensor } from "onnxruntime-node";
import { Gliner } from "gliner/node";
import { NER_QUERY_LABELS, NER_SEARCH_LABELS } from "../constants";
import {NerResult} from "../types";


const embedText = async (text: string, clipSessionPromise: Promise<InferenceSession>, tokenizerPromise: Promise<PreTrainedTokenizer>) => {
    console.time('embedText');
    console.log("Starting tokenizer load");
    const tokenizer = await tokenizerPromise;
    console.timeLog("embedText", "Tokenizer load complete");

    const tokens = tokenizer(text, {return_tensor: true, padding: 'max_length'});
    const tokensTensor = new Tensor(tokens.input_ids.type, [...tokens.input_ids.data], tokens.input_ids.dims);

    console.timeLog("embedText", "Starting clip session load");
    const clipSession = await clipSessionPromise;
    console.timeEnd("embedText");
    console.log("Clip session load complete");

    const embedRes = await clipSession.run({"text": tokensTensor});
    return Array.prototype.slice.call(embedRes["embeddings"].data);
};

const extractNER = async (text: string, glinerModel: Gliner, initPromise: Promise<void>) => {
    console.log("Text:", text);
    console.log("Gliner model:", glinerModel);

    console.time('extractNER');
    console.log("Starting gliner initialize");
    await initPromise;
    console.timeEnd("extractNER");
    console.log("Gliner initialize complete");

    const nerRes = await glinerModel.inference({
        texts: [text],
        entities: NER_QUERY_LABELS
    });
    console.log("Ner res:", nerRes);
    const nerResults: NerResult[] = nerRes[0].filter(res => NER_SEARCH_LABELS.includes(res.label))
        .map((res) => ({
            label: res.label,
            text: res.spanText,
            score: res.score,
        }));
    return nerResults;
};

export { embedText, extractNER };
