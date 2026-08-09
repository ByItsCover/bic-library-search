import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { S3Client } from "@aws-sdk/client-s3";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { ApolloClient, InMemoryCache } from "@apollo/client";
import { InferenceSession } from "onnxruntime-node";
import { Gliner } from "gliner/node";
import { CLIPTokenizer, env } from "@huggingface/transformers";
import * as lancedb from "@lancedb/lancedb";
import * as path from 'path';
import { toHex, toBytes } from "./utils";
import { UserAttributes, TablePair } from "./types";
import { constants } from "./constants";


const modelMiddleware: Middleware = async ({ reqCtx, next }) => {
    env.allowLocalModels = true;
    console.time('modelMiddleware');
    console.log("Starting model loads");

    const clipDir = path.join(process.env.ROOT_DIR ?? ".", "clip_model");
    const clipPath = path.join(clipDir, "clip_text.onnx");
    const glinerDir = path.join(process.env.ROOT_DIR ?? ".", "gliner_model")
    const glinerPath = path.join(glinerDir, "gliner_quantized.onnx");

    const clipSession = await InferenceSession.create(
        clipPath,
        { executionProviders: ['cpu'], graphOptimizationLevel: 'all'}
    );
    console.timeLog("modelMiddleware", "Just loaded clipSession");
    const tokenizer = await CLIPTokenizer.from_pretrained(clipDir, {
        local_files_only: true
    });
    console.timeLog("modelMiddleware", "Just loaded tokenizer");

    const glinerModel = new Gliner({
        tokenizerPath: glinerDir,
        onnxSettings: {
            modelPath: glinerPath,
            executionProvider: 'cpu',
        },
        transformersSettings: {
            allowLocalModels: true,
            useBrowserCache: false,
        }
    });
    console.timeLog("modelMiddleware", "Just loaded glinerModel");

    try {
        await glinerModel.initialize();
        console.timeLog("modelMiddleware", "Gliner model initialized now.");
    } catch (error) {
        console.error("Gliner initialize failed", error);
        throw error;
    }

    console.timeEnd("modelMiddleware");
    console.log("Done with model loads");

    reqCtx.set("clip_session", clipSession);
    reqCtx.set("clip_tokenizer", tokenizer);
    reqCtx.set("gliner_model", glinerModel);
    await next();
};

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
    let userAttributes: UserAttributes | null = null;

    try {
        const verifier = CognitoJwtVerifier.create({
            userPoolId: process.env.COGNITO_USER_POOL_ID,
            tokenUse: "id",
            clientId: process.env.COGNITO_CLIENT_ID,
        });

        const accessHeader = reqCtx.event.headers?.Authorization ?? reqCtx.event.headers?.authorization ?? null;
        const token = accessHeader !== null ? accessHeader.replace("Bearer ", "") : null;

        if (token !== null) {
            try {
                const payload = await verifier.verify(token);
                console.log(payload);
                userAttributes = {
                    username: payload["preferred_username"],
                    email: payload["email"]!.toLocaleString(),
                    uid_hex: toHex(payload["custom:uid"]!.toLocaleString()),
                    uid_bytes: toBytes(payload["custom:uid"]!.toLocaleString()),
                }
            } catch (error) {
                console.error("Token is not valid", error);
            }
        }
    } catch (error) {
        console.error("customAuthMiddleware failure", error);
    }

    reqCtx.set("user_attributes", userAttributes);
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

const s3Middleware: Middleware = async ({ reqCtx, next }) => {
    const config = {};
    const client = new S3Client(config);
    reqCtx.set('s3_client', client);
    await next();
};

export { modelMiddleware, lanceMiddleware, customAuthMiddleware, hardcoverMiddleware, s3Middleware };
