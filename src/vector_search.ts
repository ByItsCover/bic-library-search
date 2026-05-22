import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import * as lancedb from "@lancedb/lancedb"
import { logger } from "./logger";
import { constants } from "./constants";
import { CoverResult, NerResult } from "./types";


let table: lancedb.Table | null = null;

const loadTable = async () => {
    const uri = process.env.DB_URI;
    const db = await lancedb.connect(uri);
    return await db.openTable(constants.db_table_name);
}

const normalize = (arr: number[]) => {
    const norm = Math.sqrt(arr.reduce((sum, val) => sum + val**2, 0));

    if (norm === 0) return Array<number>(arr.length).fill(0);

    return arr.map(val => val / norm);
}

export const search = async ({req} : RequestContext) => {
    let tablePromise: Promise<lancedb.Table> | null = null;
    if (table === null) {
        logger.info('Table starting load');
        tablePromise = loadTable();
    }

    const body: {vector: number[], ner: NerResult[]} = await req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    const queryVector = normalize(body.vector);

    if (table === null) {
        if (tablePromise === null) {
            throw new Error("TablePromise is null (should never happen)");
        }
        table = await tablePromise;
        table.search(queryVector);
        logger.info('Table loaded');
    }

    let tableRes = await table.search(queryVector)
        .select(["cover_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.query_limit)
        .toArray();
    console.table(tableRes);

    const result = tableRes as CoverResult[];

    return {
        statusCode: 200,
        body: JSON.stringify({
            covers: result.map((res) => ({
                ...res,
                cover_id: Number(res.cover_id),
            })),
        }),
    };
}
