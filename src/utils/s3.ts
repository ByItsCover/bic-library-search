import {
    PutObjectCommand,
    S3Client,
    S3ServiceException,
} from "@aws-sdk/client-s3";
import { CoverResult } from "../types";
import logger from "../logger";


const fetchBuffer = async (url: string) => {
    const response = await fetch(url);
    const image = await response.arrayBuffer();
    return Buffer.from(image);
};

const uploadBooks = async (nerItems: CoverResult[], s3Client: S3Client) => {
    if (nerItems.length === 0) {
        logger.info("No new books");
        return;
    }

    logger.info(`"Number of embeddings to upload: ${nerItems.length}`);
    let successfulCount = 0;

    const s3Promises = nerItems.map(async(item) => {
        const command = new PutObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: `${String(item.cover_id)}-${item.isbn_13}.bin`,
            Body: await fetchBuffer(item.cover_url),
            Metadata: {
                "cover_id": String(item.cover_id),
                "book_id": String(item.book_id),
                "isbn_13": String(item.isbn_13),
                "image_url": String(item.cover_url),
            }
        });

        try {
            const response = await s3Client.send(command);
            successfulCount += 1;
        } catch (error) {
            if (
                error instanceof S3ServiceException &&
                error.name === "EntityTooLarge"
            ) {
                logger.error(
                    `Error from S3 while uploading object to ${process.env.BUCKET_NAME}. \
The object was too large. To upload objects larger than 5GB, use the S3 console (160GB max) \
or the multipart upload API (5TB max).`, error
                );
            } else if (error instanceof S3ServiceException) {
                logger.error(
                    `Error from S3 while uploading object to ${process.env.BUCKET_NAME}.  ${error.name}: ${error.message}`,
                    error
                );
            } else {
                logger.error("Unfamiliar error:", error as Error);
            }
        }
    });

    await Promise.all(s3Promises);
    logger.info(`Number of embedding uploaded: ${successfulCount}`);
};

export { uploadBooks };
