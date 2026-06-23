import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { SQSClient } from "@aws-sdk/client-sqs";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { ApolloClient, InMemoryCache } from "@apollo/client";
import * as lancedb from "@lancedb/lancedb";
import { constants } from "./constants";


const lanceMiddleware: Middleware = async ({ reqCtx, next }) => {
    const db = await lancedb.connect(process.env.DB_URI);
    const table = await db.openTable(constants.db_table_name);
    reqCtx.set('lance_table', table);
    await next();
};

const hardcoverMiddleware: Middleware = async ({ reqCtx, next }) => {
    const secretValue = await getSecret(process.env.HARDCOVER_SECRET_NAME);
    const batchLink = new BatchHttpLink({
        uri: constants.hardcover_url,
        headers: {
            authorization: `Bearer ${secretValue}`,
        },
    });
    const client = new ApolloClient({
        link: batchLink,
        cache: new InMemoryCache(),
    });
    reqCtx.set('hardcover_client', client);
    await next();
};

const sqsMiddleware: Middleware = async ({ reqCtx, next }) => {
    const config = {};
    const client = new SQSClient(config);
    reqCtx.set('sqs_client', client);
    await next();
};

export { lanceMiddleware, hardcoverMiddleware, sqsMiddleware };
