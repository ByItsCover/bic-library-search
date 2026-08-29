import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { S3Client } from "@aws-sdk/client-s3";
import { InferenceSession } from "onnxruntime-node";
import * as lancedb from "@lancedb/lancedb";
import * as path from 'path';
import { loadGliner } from "./utils/gliner/model";
import { loadClipTokenizer } from "./utils/clip/tokenizer";
import { loadTokenizer } from "./utils/models";
import { loadTable } from "./utils/lancedb";
import { loadApolloClient } from "./utils/hardcover";
import { toBytes, toHex } from "./utils/auth";
import { UserAttributes, TablePair } from "./types";
import { constants } from "./constants";
import logger from "./logger";


const modelMiddleware: Middleware = async ({ reqCtx, next }) => {
    const clipDir = path.join(process.env.ROOT_DIR ?? ".", "clip_model");
    const clipPath = path.join(clipDir, "clip_text.onnx");
    const glinerDir = path.join(process.env.ROOT_DIR ?? ".", "gliner_model");
    const glinerPath = path.join(glinerDir, "gliner.onnx");

    // const clipTokenizerPromise = loadClipTokenizer(
    //     path.join(clipDir, "tokenizer.json"),
    //     path.join(clipDir, "tokenizer_config.json")
    // );
    // const glinerTokenizerPromise = loadTokenizer(
    //     path.join(glinerDir, "tokenizer.json"),
    //     path.join(glinerDir, "tokenizer_config.json")
    // );

    // const clipSessionPromise = InferenceSession.create(
    //     clipPath,
    //     {
    //         executionProviders: ['cpu'],
    //         graphOptimizationLevel: 'basic',
    //         interOpNumThreads: 1,
    //         intraOpNumThreads: 1,
    //         enableCpuMemArena: false,
    //     }
    // );
    //const glinerModelPromise = loadGliner(glinerPath, glinerTokenizerPromise);

    //reqCtx.set("clip_session_promise", clipSessionPromise);
    // reqCtx.set("clip_tokenizer_promise", clipTokenizerPromise);
    // reqCtx.set("gliner_model_promise", glinerModelPromise);
    await next();
};

const lanceMiddleware: Middleware = async ({ reqCtx, next }) => {
    const dbPromise = lancedb.connect(process.env.DB_URI);
    const tablesMap: TablePair[] = [
        {var_name: "covers_table", table_name: constants.covers_table_name},
        {var_name: "feedback_table", table_name: constants.feedback_table_name},
    ];

    tablesMap.forEach(pair => {
        const tablePromise = loadTable(pair.table_name, dbPromise);
        reqCtx.set(`${pair.var_name}_promise`, tablePromise);
    })
    await next();
};

const customAuthMiddleware: Middleware = async ({ reqCtx, next }) => {
    let userAttributes: UserAttributes | null = null;

    try {
        const verifier = CognitoJwtVerifier.create({
            userPoolId: process.env.COGNITO_USER_POOL_ID,
            tokenUse: "access",
            clientId: process.env.COGNITO_CLIENT_ID,
        });

        const accessHeader = reqCtx.event.headers?.Authorization ?? reqCtx.event.headers?.authorization ?? null;
        const token = accessHeader !== null ? accessHeader.replace("Bearer ", "") : null;

        if (token !== null) {
            try {
                const payload = await verifier.verify(token);
                userAttributes = {
                    uid_hex: toHex(payload["username"].toLocaleString()),
                    uid_bytes: toBytes(payload["username"].toLocaleString()),
                }
            } catch (error) {
                logger.error("Token is not valid", error as Error);
            }
        }
    } catch (error) {
        logger.error("customAuthMiddleware failure", error as Error);
    }

    reqCtx.set("user_attributes", userAttributes);
    await next();
};

const hardcoverMiddleware: Middleware = async ({ reqCtx, next }) => {
    const secretPromise = getSecret(process.env.HARDCOVER_SECRET_NAME);
    const clientPromise = loadApolloClient(constants.hardcover_url, secretPromise);
    reqCtx.set('hardcover_client_promise', clientPromise);
    await next();
};

const s3Middleware: Middleware = async ({ reqCtx, next }) => {
    const config = {};
    const client = new S3Client(config);
    reqCtx.set('s3_client', client);
    await next();
};

const collectGarbage: Middleware = async ({ next }) => {
    await next();

    try {
        if (global.gc) {
            global.gc();
            logger.info("Manual gc completed");
        }
    } catch (error) {
        logger.error("Manual garbage collection failed", error as Error);
    }
}

export { modelMiddleware, lanceMiddleware, customAuthMiddleware, hardcoverMiddleware, s3Middleware, collectGarbage };
