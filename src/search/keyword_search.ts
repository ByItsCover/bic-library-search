import { ApolloClient, gql, TypedDocumentNode } from "@apollo/client";
import logger from "../logger";
import { constants } from "../constants";
import {
    CoverResult, BookIdRetrieval,
    BookIdRetrievalVariables, NerResult, TitleAuthorSearch, TitleAuthorSearchVariables
} from "../types";


const keywordSearch = async (nerPairsPromise: Promise<NerResult[]>, hardcoverClientPromise: Promise<ApolloClient>) => {
    const nerPairs = await nerPairsPromise;
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
    const hardcoverClient = await hardcoverClientPromise;
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
                _distance: null,
                rating: null
            };
            idCoverMap.set(book.id, newCover);
        }
    });
    logger.info('Printing NER api results);');
    console.log([...idCoverMap.entries()]);

    return [...idCoverMap.values().filter(res => res !== null)];
}

export default keywordSearch;
