import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import { S3Client } from "@aws-sdk/client-s3";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient } from "@apollo/client";
import { InferenceSession } from "onnxruntime-node";
import { Tokenizer } from "@huggingface/tokenizers";
import { SpanModel } from "../utils/gliner/model";
import { embedText, extractNER } from "./model_helper";
import vectorSearch from "./vector_search";
import keywordSearch from "./keyword_search";
import { userRatings } from "./user_query";
import uploadBooks from "./embed";
import { mergeResults } from "../utils/common";
import { CoverResult, UserAttributes } from "../types";
import { constants } from "../constants";
import logger from "../logger";
import {ClipTokenizer} from "../utils/clip/tokenizer";


const search = async (reqCtx : RequestContext) => {
    const body: {query: string} = await reqCtx.req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    let searchResults: CoverResult[] = [];
    let responseCode = 200;

    const userAttributes = reqCtx.get("user_attributes") as UserAttributes | null;
    const clipSessionPromise = reqCtx.get("clip_session_promise") as Promise<InferenceSession>;
    const clipTokenizerPromise = reqCtx.get("clip_tokenizer_promise") as Promise<ClipTokenizer>;
    const glinerModelPromise = reqCtx.get("gliner_model_promise") as Promise<SpanModel>;
    const coversTablePromise = reqCtx.get("covers_table_promise") as Promise<lancedb.Table>;
    const feedbackTablePromise = reqCtx.get("feedback_table_promise") as Promise<lancedb.Table>;
    const hardcoverClientPromise = reqCtx.get("hardcover_client_promise") as Promise<ApolloClient>;
    const s3Client = reqCtx.get("s3_client") as S3Client;

    const nerResPromise = extractNER(body.query, glinerModelPromise);
    const embedResPromise = embedText(body.query, clipSessionPromise, clipTokenizerPromise);

    const [vectorResult, keywordResult] = await Promise.all([
        vectorSearch(embedResPromise, coversTablePromise),
        keywordSearch(nerResPromise, hardcoverClientPromise)
    ]);
    if (vectorResult.length == 0) {
        responseCode = 204;
    }
    const [currentSearchResults, newNerItems] = mergeResults(vectorResult, keywordResult, 0.51, 0.49, 60, constants.results_limit);
    searchResults = currentSearchResults;

    const newUploadTask = uploadBooks(newNerItems, s3Client);
    if (userAttributes !== null) {
        searchResults = await userRatings(searchResults, userAttributes, feedbackTablePromise);
    }

    await newUploadTask;

    return {
        statusCode: responseCode,
        body: JSON.stringify({
            covers: searchResults.map((res) => ({
                ...res,
                cover_id: Number(res.cover_id),
                book_id: Number(res.book_id),
            })),
        }),
    };
}

export default search;
