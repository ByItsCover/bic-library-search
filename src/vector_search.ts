import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient, gql, InMemoryCache, TypedDocumentNode } from "@apollo/client";
import {BatchHttpLink} from "@apollo/client/link/batch-http";
import { logger } from "./logger";
import { constants } from "./constants";
import {
    CoverResult, EditionIdRetrieval,
    EditionIdRetrievalVariables, NerResult, TitleAuthorSearch, TitleAuthorSearchVariables
} from "./types";


let table: lancedb.Table | null = null;
let client: ApolloClient | null = null;

const loadTable = async () => {
    const uri = process.env.DB_URI;
    const db = await lancedb.connect(uri);
    return await db.openTable(constants.db_table_name);
}

const loadClient = (hardcoverApiKey: string) => {
    const batchLink = new BatchHttpLink({
        uri: constants.hardcover_url,
        headers: {
            authorization: `Bearer ${hardcoverApiKey}`,
        },
    });

    return new ApolloClient({
        link: batchLink,
        cache: new InMemoryCache(),
    });
}

const normalize = (arr: number[]) => {
    const norm = Math.sqrt(arr.reduce((sum, val) => sum + val**2, 0));

    if (norm === 0) return Array<number>(arr.length).fill(0);

    return arr.map(val => val / norm);
}

export const vectorSearch = async ( embedding: number[]) => {
    let tablePromise: Promise<lancedb.Table> | null = null;
    if (table === null) {
        logger.info('Table starting load');
        tablePromise = loadTable();
    }

    const queryVector = normalize(embedding);

    if (table === null) {
        if (tablePromise === null) {
            throw new Error("TablePromise is null (should never happen)");
        }
        table = await tablePromise;
        table.search(queryVector);
        logger.info('Table loaded');
    }

    let tableRes: CoverResult[] = await table.search(queryVector)
        .select(["cover_id", "isbn_13", "cover_url", "_distance"])
        .limit(constants.vector_query_limit)
        .toArray();
    console.table(tableRes);

    return tableRes;
}

export const nounSearch = async (nerPairs: NerResult[], hardcoverKey: string) => {
    if (client === null) {
        logger.info('GQL Client starting load');
        client = loadClient(hardcoverKey);
    }

    let keywordRes: CoverResult[] = [];
    if (nerPairs.length === 0) {
        return keywordRes;
    }

    const keywordQuery = nerPairs.reduce((acc, result) => acc + result.text + " ", "").trim();
    const fieldWeights = constants.keyword_field_weights.join(",");
    const GET_KEYWORD_RESULTS: TypedDocumentNode<TitleAuthorSearch, TitleAuthorSearchVariables> = gql`
        query TitleAuthorSearch {
            search(
                query: "${keywordQuery}",
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
    const { data: idData } = await client.query({query: GET_KEYWORD_RESULTS});
    if (idData === undefined || idData.search.ids.length === 0) {
        return keywordRes;
    }

    const idsString = idData.search.ids.join(",");
    const GET_EDITION_RESULTS: TypedDocumentNode<EditionIdRetrieval, EditionIdRetrievalVariables> = gql`
        query LordOfTheRingsBooks {
            editions(
                where: {
                    book_id: {_in: [${idsString}]}
                }
                order_by: [{book_id: desc}, {score: desc}]
            ) {
                id
                book_id
                title
                isbn_13
                image {
                    url
                }
            }
        }
    `;
    const { data: bookData } = await client.query({query: GET_EDITION_RESULTS});
    if (bookData === undefined) {
        throw new Error("NER Book Edition results are null (likely api call fail)");
    }

    const idCoverMap: Map<number, CoverResult | null> = new Map(idData.search.ids.map(id => [id, null]));
    bookData.editions.forEach((edition) => {
        let coverValue = idCoverMap.get(edition.book_id);
        if (coverValue === null && edition.image !== null && edition.image.url !== null && edition.isbn_13 !== null) {
            let newCover: CoverResult = {
                cover_id: edition.id,
                isbn_13: edition.isbn_13,
                cover_url: edition.image.url,
                _distance: null
            };
            idCoverMap.set(edition.book_id, newCover);
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
    ner: CoverResult[],
    vector: CoverResult[],
    nerWeight: number,
    vectorWeight: number,
    k: number,
    limit: number
) => {
    // Map from id to { item, score }
    const bucket = new Map<BigInt, { item: CoverResult; score: number }>();

    // Add fuzzy scores
    ner.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, nerWeight, k);
        const prev = bucket.get(item.cover_id);
        if (prev !== undefined) {
            prev.score += score;
        } else {
            bucket.set(item.cover_id, { item, score });
        }
    });

    // Add semantic scores
    vector.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, vectorWeight, k);
        const prev = bucket.get(item.cover_id);
        if (prev !== undefined) {
            prev.score += score;
        } else {
            bucket.set(item.cover_id, { item, score });
        }
    });

    // Convert to array and sort by score descending
    return [...bucket.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(entry => entry.item);
}

export const search = async (reqCtx : RequestContext) => {
    const body: {vector: number[], ner: NerResult[]} = await reqCtx.req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    const hardcoverKey = reqCtx.get("hardcover_key") as string;

    const vectorResult = await vectorSearch(body.vector);
    const nounResult = await nounSearch(body.ner, hardcoverKey);
    const results = mergeResults(nounResult, vectorResult, 0.4, 0.6, 60, constants.results_limit);


    return {
        statusCode: 200,
        body: JSON.stringify({
            covers: results.map((res) => ({
                ...res,
                cover_id: Number(res.cover_id),
            })),
        }),
    };
}
