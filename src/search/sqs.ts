import {
    SQSClient,
    SendMessageBatchCommand,
    SendMessageBatchRequestEntry, BatchResultErrorEntry
} from "@aws-sdk/client-sqs";
import {CoverResult} from "../types";
import logger from "../logger";

export const uploadBooks = async (nerItems: CoverResult[], sqsClient: SQSClient, chunkSize = 10) => {
    if (nerItems.length === 0) {
        logger.info("No new books");
        return;
    }

    logger.info(`"Number of embeddings to upload: ${nerItems.length}`);

    let successfulCount = 0;
    const failureResponses:  BatchResultErrorEntry[] = [];

    const promises = Array(Math.ceil(nerItems.length / 10)).fill(0).map(async (_, i) => {
        const nerChunk = nerItems.slice(i * chunkSize, (i+1) * chunkSize);

        const messages = nerChunk.map((item): SendMessageBatchRequestEntry => ({
            Id: `${String(item.cover_id)}-${item.isbn_13}`,
            MessageBody: item.cover_url,
            MessageAttributes: {
                "cover_id": {
                    DataType: "Number",
                    StringValue: String(item.cover_id),
                },
                "book_id": {
                    DataType: "Number",
                    StringValue: String(item.book_id)
                },
                "isbn_13": {
                    DataType: "String",
                    StringValue: item.isbn_13
                }
            }
        }));
        const batchCommand = new SendMessageBatchCommand({
            QueueUrl: process.env.SQS_URL,
            Entries: messages
        });

        const batchResponse = await sqsClient.send(batchCommand);
        if (batchResponse.Successful !== undefined) {
            successfulCount += batchResponse.Successful.length;
        }
        if (batchResponse.Failed !== undefined) {
            failureResponses.push(...batchResponse.Failed);
        }
    });

    await Promise.all(promises);
    logger.info(`Number of embedding uploaded: ${successfulCount}`);
    logger.info("Failure responses:", {failed: failureResponses});
}
