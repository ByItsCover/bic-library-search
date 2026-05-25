import { RequestContext } from "@aws-lambda-powertools/event-handler/types";
import * as lancedb from "@lancedb/lancedb"
import { ApolloClient, gql, HttpLink, InMemoryCache, TypedDocumentNode } from "@apollo/client";
import { logger } from "./logger";
import { constants } from "./constants";
import {
    CoverResult, EditionIdRetrieval,
    EditionIdRetrievalVariables, NerResult, TitleAuthorSearch, TitleAuthorSearchVariables
} from "./types";
import {BatchHttpLink} from "@apollo/client/link/batch-http";


let table: lancedb.Table | null = null;
let client: ApolloClient | null = null;

const loadTable = async () => {
    const uri = process.env.DB_URI;
    const db = await lancedb.connect(uri);
    return await db.openTable(constants.db_table_name);
}

const loadClient = () => {
    const batchLink = new BatchHttpLink({
        uri: constants.hardcover_url,
        headers: {
            authorization: `Bearer ${process.env.HARDCOVER_TOKEN}`,
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

export const nounSearch = async (nerPairs: NerResult[]) => {
    if (client === null) {
        logger.info('GQL Client starting load');
        client = loadClient();
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
                query: ${keywordQuery},
                query_type: "Book",
                per_page: ${constants.keyword_query_limit},
                page: 1,
                fields: "title,series_names,author_names,alternative_titles",
                weights: ${fieldWeights},
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

    const GET_EDITION_RESULTS: TypedDocumentNode<EditionIdRetrieval, EditionIdRetrievalVariables> = gql`
        query LordOfTheRingsBooks {
            editions(
                where: {
                    book_id: {_in: ${idData.search.ids}}
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
        if (coverValue === null) {
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

export const search = async ({req} : RequestContext) => {
    const body: {vector: number[], ner: NerResult[]} = await req.json();
    logger.info('Printing body of request');
    logger.info(JSON.stringify(body));

    const vectorResult = await vectorSearch(body.vector);
    const nounResult = await nounSearch(body.ner);


    return {
        statusCode: 200,
        body: JSON.stringify({
            covers: [...nounResult, ...vectorResult].map((res) => ({
                ...res,
                cover_id: Number(res.cover_id),
            })),
        }),
    };
}
