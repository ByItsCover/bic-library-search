import { Router } from '@aws-lambda-powertools/event-handler/http';
import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import * as ort from "onnxruntime-node";
import logger from "./logger";
import { health } from "./healthcheck/healthcheck";
import search from "./search/search";
import { modelMiddleware, lanceMiddleware, customAuthMiddleware, hardcoverMiddleware, s3Middleware } from "./middleware";


const app = new Router();

app.get('/search/health', health);
app.post('/search', [modelMiddleware, lanceMiddleware, customAuthMiddleware, hardcoverMiddleware, s3Middleware], search);

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    logger.info(`Event: ${JSON.stringify(event, null, 2)}`);
    logger.info(`Context: ${JSON.stringify(context, null, 2)}`);
    ort.env.logLevel = 'verbose';
    ort.env.debug = true;
    return app.resolve(event, context);
};
