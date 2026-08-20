import { InferenceSession, Tensor } from "onnxruntime-node";
import { Tokenizer } from "@huggingface/tokenizers";
import { readFile } from "fs/promises";
import { SpanModel } from "./gliner/model";
import { ClipTokenizer } from "./clip/tokenizer";
import { NerResult} from "../types";
import { constants, NER_QUERY_LABELS, NER_SEARCH_LABELS } from "../constants";


const loadTokenizer = async (mainPath: string, configPath: string): Promise<[Tokenizer, any]> => {
    const mainPromise = readFile(mainPath, 'utf-8');
    const configPromise = readFile(configPath, 'utf-8');

    const tokenizerJson = JSON.parse(await mainPromise);
    const tokenizerConfigJson = JSON.parse(await configPromise);
    return [
        new Tokenizer(tokenizerJson, tokenizerConfigJson),
        tokenizerConfigJson
    ];
}

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

export { loadTokenizer, embedText, extractNER };
