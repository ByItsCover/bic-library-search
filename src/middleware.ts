import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { S3Client } from "@aws-sdk/client-s3";
import { InferenceSession } from "onnxruntime-node";
import { Gliner } from "gliner/node";
import { SpanDecoder } from "gliner/src/lib/decoder";
import { CLIPTokenizer, env } from "@huggingface/transformers";
import * as lancedb from "@lancedb/lancedb";
import * as path from 'path';
import { loadTable, initGliner, loadApolloClient, toHex, toBytes } from "./utils";
import { UserAttributes, TablePair } from "./types";
import { constants } from "./constants";


const modelMiddleware: Middleware = async ({ reqCtx, next }) => {
    env.allowLocalModels = true;
    console.time('modelMiddleware');
    console.log("Starting model loads");

    const clipDir = path.join(process.env.ROOT_DIR ?? ".", "clip_model");
    const clipPath = path.join(clipDir, "clip_text.onnx");
    const glinerDir = path.join(process.env.ROOT_DIR ?? ".", "gliner_model")
    const glinerPath = path.join(glinerDir, "gliner.onnx");

    const clipSessionPromise = InferenceSession.create(
        clipPath,
        { executionProviders: ['cpu'], graphOptimizationLevel: 'all'}
    );
    console.timeLog("modelMiddleware", "Just loaded clipSession");
    const tokenizerPromise = CLIPTokenizer.from_pretrained(clipDir, {
        local_files_only: true
    });
    console.timeLog("modelMiddleware", "Just loaded tokenizer");

    const glinerModel = new Gliner({
        tokenizerPath: glinerDir,
        onnxSettings: {
            modelPath: glinerPath,
            executionProvider: 'cpu',
            fetchBinary: false,
            multiThread: false,
            maxThreads: 1,
        },
        transformersSettings: {
            allowLocalModels: true,
            useBrowserCache: false,
        }
    });
    const glinerDirect = await InferenceSession.create(
        glinerPath,
        { executionProviders: ['cpu'], graphOptimizationLevel: 'all'}
    );
    console.timeLog("modelMiddleware", "Just loaded glinerModel + glinerDirect");

    const initPromise = initGliner(glinerModel);

    console.timeEnd("modelMiddleware");
    console.log("Done with model async loads");

    reqCtx.set("clip_session_promise", clipSessionPromise);
    reqCtx.set("clip_tokenizer_promise", tokenizerPromise);
    reqCtx.set("gliner_model", glinerModel);
    reqCtx.set("gliner_init_promise", initPromise);
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
                    username: payload["preferred_username"]!.toLocaleString(),
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
    const secretPromise = getSecret(process.env.HARDCOVER_SECRET_NAME);
    const clientPromise = loadApolloClient(constants.hardcover_url, secretPromise);
    reqCtx.set('hardcover_client_promise', clientPromise);
    await next();
};

const s3Middleware: Middleware = async ({ reqCtx, next }) => {
    console.time('s3Middleware');
    const config = {};
    const client = new S3Client(config);
    reqCtx.set('s3_client', client);
    console.timeEnd("s3Middleware");
    console.log("S3 client load done.");
    await next();
};

export { modelMiddleware, lanceMiddleware, customAuthMiddleware, hardcoverMiddleware, s3Middleware };
