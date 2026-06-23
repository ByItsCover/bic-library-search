import * as lancedb from "@lancedb/lancedb"
import { normalize } from "../utils";
import { CoverResult } from "../types";
import { constants } from "../constants";
import logger from "../logger";


const vectorSearch = async ( embedding: number[], table: lancedb.Table) => {
    const queryVector = normalize(embedding);

    // Temporary; Todo: Implement more efficient read and write to tables
    await table.checkoutLatest();
    let tableRes: CoverResult[] = await table.search(queryVector)
        .select(["cover_id", "book_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.vector_query_limit)
        .toArray();

    logger.info('Printing vector search results);');
    console.table(tableRes);

    return tableRes;
}

export default vectorSearch;