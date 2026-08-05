export const constants = {
    covers_table_name: "covers",
    feedback_table_name: "feedback",
    vector_query_limit: 100,
    keyword_query_limit: 100,
    results_limit: 10,
    hardcover_url: "https://api.hardcover.app/v1/graphql"
} as const;

export const NER_QUERY_LABELS = ["Author_Name", "Book_Title_Only", "Genres", "Keywords"];
export const NER_SEARCH_LABELS = ["Author_Name", "Book_Title_Only"];
