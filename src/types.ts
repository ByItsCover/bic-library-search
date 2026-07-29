export enum Rating {
    "Dislike",
    "Neutral",
    "Like",
    "Love"
}

export type CoverResult = {
    cover_id: bigint,
    book_id: bigint,
    isbn_13: string,
    cover_url: string,
    _distance: number | null,
    rating: Rating | null,
};

export enum Feedback {
    "Rating",
}

export type FeedbackResult = {
    cover_id: bigint,
    score: bigint,
};

export type NerResult = {
    label: string;
    text: string;
    score: number;
};

export type TitleAuthorSearch = {
    search: {
        __typename: "SearchResult";
        ids: bigint[];
    }

};

export type TitleAuthorSearchVariables = Record<string, never>;

export type BookIdRetrieval = {
    books: {
        __typename: "Books";
        id: bigint;
        title: string | null;
        default_cover_edition: {
            __typename: "DefaultCoverEdition";
            id: bigint;
            isbn_13: string | null;
            image: {
                __typename: "CoverImage";
                url: string | null;
            } | null;
        } | null;
    }[];
};

export type BookIdRetrievalVariables = Record<string, never>;

export type UserAttributes = {
    username: string;
    email: string;
    uid_hex: string;
    uid_bytes: Uint8Array;
};

export type TablePair = {
    var_name: string;
    table_name: string;
};
