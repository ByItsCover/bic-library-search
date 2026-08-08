import {
    SQSClient,
    SendMessageBatchCommand,
    SendMessageBatchRequestEntry, BatchResultErrorEntry
} from "@aws-sdk/client-sqs";
import {CoverResult} from "../types";
import { constants } from "../constants";
import logger from "../logger";


const fetchBase64 = async (url: string) => {
    const response = await fetch(url);
    const image = await response.arrayBuffer();
    return Buffer.from(image).toString('base64');
};

const uploadBooks = async (nerItems: CoverResult[], sqsClient: SQSClient, chunkSize = constants.sqs_chunk_size) => {
    if (nerItems.length === 0) {
        logger.info("No new books");
        return;
    }

    logger.info(`"Number of embeddings to upload: ${nerItems.length}`);

    let successfulCount = 0;
    const failureResponses:  BatchResultErrorEntry[] = [];

    const batchPromises = Array(Math.ceil(nerItems.length / chunkSize)).fill(0).map(async (_, i) => {
        const nerChunk = nerItems.slice(i * chunkSize, (i+1) * chunkSize);

        const messages = nerChunk.map((item): SendMessageBatchRequestEntry => ({
            Id: `${String(item.cover_id)}-${item.isbn_13}`,
            MessageBody: undefined,
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
                },
                "image_url": {
                    DataType: "String",
                    StringValue: item.cover_url
                }
            }
        }));
        const imagePromises = messages.map(async (_, i) => {
            messages[i].MessageBody = await fetchBase64(nerChunk[i].cover_url);
        });
        await Promise.all(imagePromises);

        const batchCommand = new SendMessageBatchCommand({
            QueueUrl: process.env.SQS_URL,
            Entries: messages
        });

        try {
            const batchResponse = await sqsClient.send(batchCommand);
            if (batchResponse.Successful !== undefined) {
                successfulCount += batchResponse.Successful.length;
            }
            if (batchResponse.Failed !== undefined) {
                failureResponses.push(...batchResponse.Failed);
            }
        } catch (error) {
            console.error("SQS send failed:", error);
        }
    });

    await Promise.all(batchPromises);
    logger.info(`Number of embedding uploaded: ${successfulCount}`);
    logger.info("Failure responses:", {failed: failureResponses});
};

export default uploadBooks;
