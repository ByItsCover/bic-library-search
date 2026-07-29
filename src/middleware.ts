import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { SQSClient } from "@aws-sdk/client-sqs";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { ApolloClient, InMemoryCache } from "@apollo/client";
import * as lancedb from "@lancedb/lancedb";
import { toHex, toBytes } from "./utils";
import { UserAttributes, TablePair } from "./types";
import { constants } from "./constants";


const lanceMiddleware: Middleware = async ({ reqCtx, next }) => {
    const db = await lancedb.connect(process.env.DB_URI);
    const tablesMap: TablePair[] = [
        {var_name: "covers_table", table_name: constants.covers_table_name},
        {var_name: "feedback_table", table_name: constants.feedback_table_name},
    ];

    await Promise.all(tablesMap.map(async (pair) => {
        try {
            const table = await db.openTable(pair.table_name);
            reqCtx.set(pair.var_name, table);
        } catch (error) {
            console.error(`${pair.table_name} Table open failed`, error);
            reqCtx.set(pair.var_name, null);
        }
    }));

    await next();
};

const customAuthMiddleware: Middleware = async ({ reqCtx, next }) => {
    const verifier = CognitoJwtVerifier.create({
        userPoolId: process.env.COGNITO_USER_POOL_ID,
        tokenUse: "id",
        clientId: process.env.COGNITO_CLIENT_ID,
    });

    const accessHeader = reqCtx.event.headers?.Authorization ?? reqCtx.event.headers?.authorization ?? null;
    const token = accessHeader !== null ? accessHeader.replace("Bearer ", "") : null;
    let userAttributes: UserAttributes | null = null;

    if (token !== null) {
        try {
            const payload = await verifier.verify(token);
            console.log(payload);
            userAttributes = {
                username: payload["cognito:username"],
                email: payload["email"]!.toLocaleString(),
                uid_hex: toHex(payload["custom:uid"]!.toLocaleString()),
                uid_bytes: toBytes(payload["custom:uid"]!.toLocaleString()),
            }
        } catch (error) {
            console.error("Token is not valid", error);
        }
    }

    reqCtx.set("user_attributes", userAttributes);
    await next();
}

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

export { lanceMiddleware, customAuthMiddleware, hardcoverMiddleware, sqsMiddleware };
