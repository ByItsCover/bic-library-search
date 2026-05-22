export type CoverResult = {
    cover_id: BigInt,
    isbn_13: string,
    cover_url: string,
    _distance: number
};

export type NerResult = {
    label: string;
    text: string;
    score: number;
};
