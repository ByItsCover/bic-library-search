import * as lancedb from "@lancedb/lancedb"
import { normalize } from "../utils";
import { CoverResult } from "../types";
import { constants } from "../constants";
import logger from "../logger";


const vectorSearch = async (embeddingPromise: Promise<number[]>, coversTablePromise: Promise<lancedb.Table>) => {
    const embedding = await embeddingPromise;
    const queryVector = normalize(embedding);

    let coversTable: lancedb.Table;
    try {
        coversTable = await coversTablePromise;
    } catch (error) {
        console.error("covers Table open failed", error);
        return [];
    }

    let tableRes: CoverResult[] = await coversTable.search(queryVector)
        .select(["cover_id", "book_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.vector_query_limit)
        .toArray();

    logger.info('Printing vector search results);');
    console.table(tableRes);

    return tableRes;
}

export default vectorSearch;