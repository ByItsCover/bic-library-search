export {};

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            DB_URI: string;
            ENVIRONMENT: "test" | "dev" | "prod";
            ROOT_DIR: string;
            HARDCOVER_SECRET_NAME: string;
            COGNITO_USER_POOL_ID: string;
            COGNITO_CLIENT_ID: string;
            SQS_URL: string;
        }
    }
}
