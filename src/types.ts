export type CoverResult = {
    cover_id: BigInt,
    isbn_13: string,
    cover_url: string,
    _distance: number | null,
};

export type NerResult = {
    label: string;
    text: string;
    score: number;
};

export type TitleAuthorSearch = {
    search: {
        __typename: "SearchResult";
        ids: number[];
    }

};

export type TitleAuthorSearchVariables = Record<string, never>;

export type EditionIdRetrieval = {
    editions: {
        __typename: "Editions";
        id: BigInt;
        book_id: number;
        title: string
        isbn_13: string;
        image: {
            __typename: "CoverImage";
            url: string;
        };
    }[];
};

export type EditionIdRetrievalVariables = Record<string, never>;
