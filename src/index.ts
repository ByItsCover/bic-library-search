import { Router } from '@aws-lambda-powertools/event-handler/http';
import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { SQSClient } from "@aws-sdk/client-sqs";
import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { ApolloClient, InMemoryCache } from "@apollo/client";
import { logger } from "./logger";
import { health } from "./healthcheck";
import { search } from "./vector_search";
import { constants } from "./constants";
import * as lancedb from "@lancedb/lancedb";

const app = new Router();

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

app.get('/', health);
app.post('/search', [lanceMiddleware, hardcoverMiddleware, sqsMiddleware], search);

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    logger.info(`Event: ${JSON.stringify(event, null, 2)}`);
    logger.info(`Context: ${JSON.stringify(context, null, 2)}`);
    return app.resolve(event, context);
};
