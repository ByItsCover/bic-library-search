import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import { SQSClient } from "@aws-sdk/client-sqs";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient } from "@apollo/client";
import logger from "../logger";
import { constants } from "../constants";
import { CoverResult, NerResult } from "../types";
import { rrfScore } from "../utils";
import vectorSearch from "./vector_search";
import keywordSearch from "./keyword_search";
import { uploadBooks } from "./sqs";


const mergeResults = (
    vector: CoverResult[],
    keyword: CoverResult[],
    nerWeight: number,
    vectorWeight: number,
    k: number,
    limit: number
) => {
    // Map from id to { item, score }
    const bucket = new Map<string, { item: CoverResult; score: number }>();
    const newNerItems: CoverResult[] = [];

    // Add semantic scores
    vector.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, vectorWeight, k);
        const prev = bucket.get(String(item.book_id));
        if (prev !== undefined) {
            prev.score += score;
        } else {
            bucket.set(String(item.book_id), { item, score });
        }
    });

    // Add fuzzy scores
    keyword.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, nerWeight, k);
        const prev = bucket.get(String(item.book_id));
        if (prev !== undefined) {
            prev.score += score;
        } else {
            bucket.set(String(item.book_id), { item, score });
            newNerItems.push(item);
        }
    });

    // Convert to array and sort by score descending
    return [
        [...bucket.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(entry => entry.item),
        newNerItems
    ];
}

const search = async (reqCtx : RequestContext) => {
    const body: {vector: number[], ner: NerResult[]} = await reqCtx.req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    const table = reqCtx.get("lance_table") as lancedb.Table;
    const hardcoverClient = reqCtx.get("hardcover_client") as ApolloClient;
    const sqsClient = reqCtx.get("sqs_client") as SQSClient;

    const [vectorResult, keywordResult] = await Promise.all([
        vectorSearch(body.vector, table),
        keywordSearch(body.ner, hardcoverClient)
    ])
    const [searchResults, newNerItems] = mergeResults(vectorResult, keywordResult, 0.51, 0.49, 60, constants.results_limit);
    await uploadBooks(newNerItems, sqsClient);

    return {
        statusCode: 200,
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
