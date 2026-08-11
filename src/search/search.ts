import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import { S3Client } from "@aws-sdk/client-s3";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient } from "@apollo/client";
import { InferenceSession } from "onnxruntime-node";
import { Gliner } from "gliner/node";
import { PreTrainedTokenizer } from "@huggingface/transformers";
import { embedText, extractNER } from "./model_helper";
import vectorSearch from "./vector_search";
import keywordSearch from "./keyword_search";
import { userRatings } from "./user_query";
import uploadBooks from "./embed";
import { mergeResults } from "../utils";
import { CoverResult, UserAttributes } from "../types";
import { constants } from "../constants";
import logger from "../logger";


const search = async (reqCtx : RequestContext) => {
    const body: {query: string} = await reqCtx.req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    let searchResults: CoverResult[] = [];
    let responseCode = 200;

    const userAttributes = reqCtx.get("user_attributes") as UserAttributes | null;
    const clipSessionPromise = reqCtx.get("clip_session_promise") as Promise<InferenceSession>;
    const clipTokenizerPromise = reqCtx.get("clip_tokenizer_promise") as Promise<PreTrainedTokenizer>;
    const glinerModel = reqCtx.get("gliner_model") as Gliner;
    const glinerInitPromise = reqCtx.get("gliner_init_promise") as Promise<void>;
    const coversTable = reqCtx.get("covers_table") as lancedb.Table | null;
    const feedbackTable = reqCtx.get("feedback_table") as lancedb.Table | null;
    const hardcoverClient = reqCtx.get("hardcover_client") as ApolloClient;
    const s3Client = reqCtx.get("s3_client") as S3Client;

    const nerResPromise = extractNER(body.query, glinerModel, glinerInitPromise);

    if (coversTable === null) {
        logger.info("Cover table has yet to be created. Returning only NER results");
        responseCode = 204;

        searchResults = await keywordSearch(nerResPromise, hardcoverClient);
    } else {
        const embedResPromise = embedText(body.query, clipSessionPromise, clipTokenizerPromise);
        const [vectorResult, keywordResult] = await Promise.all([
            vectorSearch(embedResPromise, coversTable),
            keywordSearch(nerResPromise, hardcoverClient)
        ]);
        const [currentSearchResults, newNerItems] = mergeResults(vectorResult, keywordResult, 0.51, 0.49, 60, constants.results_limit);
        searchResults = currentSearchResults;

        const newUploadTask = uploadBooks(newNerItems, s3Client);
        if (userAttributes !== null && feedbackTable !== null) {
            searchResults = await userRatings(searchResults, userAttributes, feedbackTable);
        }

        await newUploadTask;
    }

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
