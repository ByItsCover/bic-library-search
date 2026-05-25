export const constants = {
    db_table_name: "covers",
    vector_query_limit: 10,
    keyword_query_limit: 10,
    keyword_field_weights: [5, 3, 1, 1],
    hardcover_url: "https://api.hardcover.app/v1/graphql"
} as const;
