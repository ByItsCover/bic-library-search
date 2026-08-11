import * as lancedb from "@lancedb/lancedb"
import { normalize } from "../utils";
import { CoverResult } from "../types";
import { constants } from "../constants";
import logger from "../logger";


const vectorSearch = async (embeddingPromise: Promise<number[]>, coversTablePromise: Promise<lancedb.Table>) => {
    console.time('vectorSearch');
    const embedding = await embeddingPromise;
    const queryVector = normalize(embedding);

    console.timeLog("vectorSearch", "Starting covers table load");
    let coversTable: lancedb.Table;
    try {
        coversTable = await coversTablePromise;
    } catch (error) {
        console.error("covers Table open failed", error);
        return [];
    }
    console.timeLog("vectorSearch", "Covers table load complete");

    let tableRes: CoverResult[] = await coversTable.query()
        .nearestTo(queryVector)
        .distanceType(constants.distance_type)
        .select(["cover_id", "book_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.vector_query_limit)
        .toArray();

    logger.info('Printing vector search results);');
    console.table(tableRes);

    console.timeEnd("vectorSearch");
    console.log("Vector search done.");
    return tableRes;
}

export default vectorSearch;