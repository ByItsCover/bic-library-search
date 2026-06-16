import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import {
    SQSClient,
    SendMessageBatchCommand,
    SendMessageBatchRequestEntry, BatchResultErrorEntry
} from "@aws-sdk/client-sqs";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient, gql, TypedDocumentNode } from "@apollo/client";
import { logger } from "./logger";
import { constants } from "./constants";
import {
    CoverResult, BookIdRetrieval,
    BookIdRetrievalVariables, NerResult, TitleAuthorSearch, TitleAuthorSearchVariables
} from "./types";

const normalize = (arr: number[]) => {
    const norm = Math.sqrt(arr.reduce((sum, val) => sum + val**2, 0));

    if (norm === 0) return Array<number>(arr.length).fill(0);

    return arr.map(val => val / norm);
}

export const vectorSearch = async ( embedding: number[], table: lancedb.Table) => {
    const queryVector = normalize(embedding);

    // Temporary; Todo: Implement more efficient read and write to tables
    await table.checkoutLatest();
    let tableRes: CoverResult[] = await table.search(queryVector)
        .select(["cover_id", "book_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.vector_query_limit)
        .toArray();
    console.table(tableRes);

    return tableRes;
}

export const nounSearch = async (nerPairs: NerResult[], hardcoverClient: ApolloClient) => {
    let keywordRes: CoverResult[] = [];
    if (nerPairs.length === 0) {
        return keywordRes;
    }

    const nerDetails = nerPairs.reduce((acc, result) => {
        acc.keyword_query += result.text + " ";
        acc.hasAuthors ||= result.label === "Author_Name";
        acc.hasTitles ||= result.label === "Book_Title_Only";
        return acc;
    }, {
        keyword_query: "",
        hasAuthors: false,
        hasTitles: false,
    });
    const rawWeights = [nerDetails.hasTitles ? 5 : 1, nerDetails.hasTitles ? 3 : 1, nerDetails.hasAuthors ? 5 : 1, 1];
    const fieldWeights = rawWeights.join(",");
    const GET_KEYWORD_RESULTS: TypedDocumentNode<TitleAuthorSearch, TitleAuthorSearchVariables> = gql`
        query TitleAuthorSearch {
            search(
                query: "${nerDetails.keyword_query}",
                query_type: "Book",
                per_page: ${constants.keyword_query_limit},
                page: 1,
                fields: "title,series_names,author_names,alternative_titles",
                weights: "${fieldWeights}",
                typos: "5,5,5,5"
            ) {
                ids
            }
        }
    `;
    const { data: idData } = await hardcoverClient.query({query: GET_KEYWORD_RESULTS});
    if (idData === undefined || idData.search.ids.length === 0) {
        return keywordRes;
    }

    const idsString = idData.search.ids.join(",");
    const GET_BOOK_RESULTS: TypedDocumentNode<BookIdRetrieval, BookIdRetrievalVariables> = gql`
        query BookIdRetrieval {
            books(
                where: {
                    id: {_in: [${idsString}]}
                }
                order_by: [{default_cover_edition: {score: desc}}]
            ) {
                id
                title
                default_cover_edition {
                    id
                    isbn_13
                    image {
                        url
                    }
                }
            }
        }
    `;
    const { data: bookData } = await hardcoverClient.query({query: GET_BOOK_RESULTS});
    if (bookData === undefined) {
        throw new Error("NER Book Edition results are null (likely api call fail)");
    }

    const idCoverMap: Map<bigint, CoverResult | null> = new Map(idData.search.ids.map(id => [id, null]));
    bookData.books.forEach((book) => {
        let coverValue = idCoverMap.get(book.id);
        if (coverValue === null && book.default_cover_edition !== null && book.default_cover_edition.image !== null && book.default_cover_edition.image.url !== null && book.default_cover_edition.isbn_13 !== null) {
            let newCover: CoverResult = {
                cover_id: book.default_cover_edition.id,
                book_id: book.id,
                isbn_13: book.default_cover_edition.isbn_13,
                cover_url: book.default_cover_edition.image.url,
                _distance: null
            };
            idCoverMap.set(book.id, newCover);
        }
    });
    logger.info('Printing NER api results);');
    console.log([...idCoverMap.entries()]);

    return [...idCoverMap.values().filter(res => res !== null)];
}
``
const rrfScore = (rank: number, weight: number, k: number) => {
    // rank is 1 for first item, 2 for second, and so on
    return weight * (1 / (rank + k));
}

const mergeResults = (
    vector: CoverResult[],
    ner: CoverResult[],
    nerWeight: number,
    vectorWeight: number,
    k: number,
    limit: number
) => {
    // Map from id to { item, score }
    const bucket = new Map<string, { item: CoverResult; score: number }>();
    const newNerItems: CoverResult[] = [];

    // Add semantic scores
    vector.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, vectorWeight, k);
        const prev = bucket.get(String(item.book_id));
        if (prev !== undefined) {
            prev.score += score;
        } else {
            bucket.set(String(item.book_id), { item, score });
        }
    });

    // Add fuzzy scores
    ner.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, nerWeight, k);
        const prev = bucket.get(String(item.book_id));
        if (prev !== undefined) {
            prev.score += score;
        } else {
            bucket.set(String(item.book_id), { item, score });
            newNerItems.push(item);
        }
    });

    // Convert to array and sort by score descending
    return [
        [...bucket.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(entry => entry.item),
        newNerItems
    ];
}

const uploadBooks = async (nerItems: CoverResult[], sqsClient: SQSClient, chunkSize = 10) => {
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

export const search = async (reqCtx : RequestContext) => {
    const body: {vector: number[], ner: NerResult[]} = await reqCtx.req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    const table = reqCtx.get("lance_table") as lancedb.Table;
    const hardcoverClient = reqCtx.get("hardcover_client") as ApolloClient;
    const sqsClient = reqCtx.get("sqs_client") as SQSClient;

    const [vectorResult, nounResult] = await Promise.all([
        vectorSearch(body.vector, table),
        nounSearch(body.ner, hardcoverClient)
    ])
    const [searchResults, newNerItems] = mergeResults(vectorResult, nounResult, 0.51, 0.49, 60, constants.results_limit);
    await uploadBooks(newNerItems, sqsClient);

    return {
        statusCode: 200,
        body: JSON.stringify({
            covers: searchResults.map((res) => ({
                ...res,
                cover_id: Number(res.cover_id),
                book_id: Number(res.book_id),
            })),
        }),
    };
}
