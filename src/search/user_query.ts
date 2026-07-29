import * as lancedb from "@lancedb/lancedb";
import { UserAttributes, CoverResult, FeedbackResult, Feedback } from "../types";
import logger from "../logger";


const userRatings = async (
    results: CoverResult[], userAttributes: UserAttributes, feedbackTable: lancedb.Table
) => {
    const cover_ids = results.map(cover => String(cover.cover_id));
    const uidQuery = `user_id = X'${userAttributes.uid_hex}'`;
    const cidQuery = `cover_id IN (${cover_ids.join(', ')})`;
    const typeQuery = `type = '${Feedback[Feedback.Rating]}'`;

    logger.info('Trying feedback table query');
    const tableRes: FeedbackResult[] = await feedbackTable.query()
        .where(`(${uidQuery}) AND (${typeQuery}) AND (${cidQuery})`)
        .select(["cover_id", "score"])
        .limit(cover_ids.length)
        .toArray();

    logger.info('Printing user ratings results:');
    console.table(tableRes);

    const ratings_map = new Map(tableRes.map(feedback => [String(feedback.cover_id), feedback.score]));
    const updated_results: CoverResult[] = results.map((cover, ind) => {
        const score = ratings_map.get(String(cover.cover_id));
        return score !== undefined ? {
            ...results[ind],
            rating: Number(score)
        } : results[ind];
    })

    logger.info('Mapping results done:');
    console.log(updated_results);

    return updated_results;
}

export { userRatings };
