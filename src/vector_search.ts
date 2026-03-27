import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import * as lancedb from "@lancedb/lancedb"
import { logger } from "./logger";
import {constants} from "./constants";


let table: lancedb.Table | null = null;

async function loadTable() {
    try {
        const uri = process.env.DB_URI;
        const db = await lancedb.connect(uri);
        return await db.openTable(constants.db_table_name);
    } catch (error) {
        console.error(error);
        logger.error("Bad stuff happened", error as Error);
        throw error;
    }

}

export const search = async ({req} : RequestContext) => {
    let tablePromise: Promise<lancedb.Table> | null = null;
    if (!table) {
        logger.info('Table starting load');
        tablePromise = loadTable();
    }

    const body = await req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));
    logger.info(body);

    if (tablePromise) {
        table = await tablePromise;
        logger.info('Table loaded');
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'Searching Stuff',
        }),
    };
}
