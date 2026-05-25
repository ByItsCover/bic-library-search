import { Router } from '@aws-lambda-powertools/event-handler/http';
import type { Middleware } from "@aws-lambda-powertools/event-handler/types";
import { getSecret } from "@aws-lambda-powertools/parameters/secrets";
import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { logger } from "./logger";
import { health } from "./healthcheck";
import { search } from "./vector_search";

const app = new Router();

const secretsMiddleware: Middleware = async ({ reqCtx, next }) => {
    const secretValue = await getSecret(process.env.HARDCOVER_SECRET_NAME);
    reqCtx.set('hardcover_key', secretValue);
    await next();
};

app.get('/', health);
app.post('/search', [secretsMiddleware], search);

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    logger.info(`Event: ${JSON.stringify(event, null, 2)}`);
    logger.info(`Context: ${JSON.stringify(context, null, 2)}`);
    return app.resolve(event, context);
};
