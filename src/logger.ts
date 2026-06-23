import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'librarySearch' });

export default logger;
