import { Router } from '@aws-lambda-powertools/event-handler/http';
import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import { logger } from "./logger";
import { health } from "./healthcheck";
import { search } from "./vector_search";

const app = new Router();

app.get('/', health);
app.post('/search', search);

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
    logger.info(`Event: ${JSON.stringify(event, null, 2)}`);
    logger.info(`Context: ${JSON.stringify(context, null, 2)}`);
    return app.resolve(event, context);
};
