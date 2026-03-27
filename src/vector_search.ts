import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import * as lancedb from "@lancedb/lancedb"
import { logger } from "./logger";
import {constants} from "./constants";


let table: lancedb.Table | null = null;

async function loadTable() {
    const uri = process.env.DB_URI;
    const db = await lancedb.connect(uri);
    return await db.openTable(constants.db_table_name);
}

export const search = async ({req} : RequestContext) => {
    let tablePromise: Promise<lancedb.Table> | null = null;
    if (table === null) {
        logger.info('Table starting load');
        tablePromise = loadTable();
    }

    const body: {vector: number[]} = await req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    const queryVector = body.vector;

    if (table === null) {
        if (tablePromise === null) {
            throw new Error("TablePromise is null (should never happen)");
        }
        table = await tablePromise;
        table.search(queryVector);
        logger.info('Table loaded');
    }

    let result = await table.search(queryVector)
        .select(["cover_id", "isbn_13", "cover_url", "distance"])
        .limit(constants.query_limit)
        .toArray();
    console.table(result);

    return {
        statusCode: 200,
        body: JSON.stringify({
            covers: result,
        }, (key, value) => {
            typeof value === "bigint" ? Number(value): value
        }),
    };
}
