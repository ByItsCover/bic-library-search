import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import { SQSClient } from "@aws-sdk/client-sqs";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient } from "@apollo/client";
import vectorSearch from "./vector_search";
import keywordSearch from "./keyword_search";
import { userRatings } from "./user_query";
import { uploadBooks } from "./sqs";
import { mergeResults } from "../utils";
import { CoverResult, NerResult, UserAttributes } from "../types";
import { constants } from "../constants";
import logger from "../logger";


const search = async (reqCtx : RequestContext) => {
    const body: {vector: number[], ner: NerResult[]} = await reqCtx.req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    let searchResults: CoverResult[] = [];
    let responseCode = 200;

    const userAttributes = reqCtx.get("user_attributes") as UserAttributes | null;
    const coversTable = reqCtx.get("covers_table") as lancedb.Table | null;
    const feedbackTable = reqCtx.get("feedback_table") as lancedb.Table | null;
    const hardcoverClient = reqCtx.get("hardcover_client") as ApolloClient;
    const sqsClient = reqCtx.get("sqs_client") as SQSClient;

    if (coversTable === null) {
        logger.info("Cover table has yet to be created. Returning only NER results");
        responseCode = 204;

        searchResults = await keywordSearch(body.ner, hardcoverClient);
    } else {
        const [vectorResult, keywordResult] = await Promise.all([
            vectorSearch(body.vector, coversTable),
            keywordSearch(body.ner, hardcoverClient)
        ]);
        const [currentSearchResults, newNerItems] = mergeResults(vectorResult, keywordResult, 0.51, 0.49, 60, constants.results_limit);
        searchResults = currentSearchResults;

        const newUploadTask = uploadBooks(newNerItems, sqsClient);
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
