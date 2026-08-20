import * as lancedb from "@lancedb/lancedb";
import { Connection } from "@lancedb/lancedb";
import { normalize } from "./search";
import { CoverResult, Feedback, FeedbackResult, UserAttributes } from "../types";
import { constants } from "../constants";
import logger from "../logger";


const loadTable = async (table_name: string, dbPromise: Promise<Connection>) => {
    const db = await dbPromise;
    return await db.openTable(table_name);
}

const vectorSearch = async (embeddingPromise: Promise<number[]>, coversTablePromise: Promise<lancedb.Table>) => {
    const embedding = await embeddingPromise;
    const queryVector = normalize(embedding);

    let coversTable: lancedb.Table;
    try {
        coversTable = await coversTablePromise;
    } catch (error) {
        logger.error("covers Table open failed", error as Error);
        return [];
    }

    let tableRes: CoverResult[] = await coversTable.query()
        .nearestTo(queryVector)
        .distanceType(constants.distance_type)
        .select(["cover_id", "book_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.vector_query_limit)
        .toArray();

    logger.info('Printing vector search results);');
    console.table(tableRes);

    return tableRes;
}

const userRatings = async (
    results: CoverResult[], userAttributes: UserAttributes, feedbackTablePromise: Promise<lancedb.Table>
) => {
    const cover_ids = results.map(cover => String(cover.cover_id));
    const uidQuery = `user_id = X'${userAttributes.uid_hex}'`;
    const cidQuery = `cover_id IN (${cover_ids.join(', ')})`;
    const typeQuery = `type = '${Feedback[Feedback.Rating]}'`;

    let feedbackTable: lancedb.Table;
    try {
        feedbackTable = await feedbackTablePromise;
    } catch (error) {
        logger.error("feedback Table open failed", error as Error);
        return results;
    }

    const tableRes: FeedbackResult[] = await feedbackTable.query()
        .where(`(${uidQuery}) AND (${typeQuery}) AND (${cidQuery})`)
        .select(["cover_id", "score"])
        .limit(cover_ids.length)
        .toArray();

    logger.info('Printing user ratings results:');
    console.table(tableRes);

    const ratings_map = new Map(tableRes.map(feedback => [String(feedback.cover_id), feedback.score]));
    const updated_results: CoverResult[] = results.map((cover, ind) => {
        const score = ratings_map.get(String(cover.cover_id));
        return score !== undefined ? {
            ...results[ind],
            rating: Number(score)
        } : results[ind];
    })

    return updated_results;
};

export { loadTable, vectorSearch, userRatings };
