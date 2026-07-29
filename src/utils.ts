import { parse } from "uuid";
import { CoverResult } from "./types";

const rrfScore = (rank: number, weight: number, k: number) => {
    // rank is 1 for first item, 2 for second, and so on
    return weight * (1 / (rank + k));
}

const mergeResults = (
    vector: CoverResult[],
    keyword: CoverResult[],
    vectorWeight: number,
    keywordWeight: number,
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
    keyword.forEach((item, idx) => {
        const rank = idx + 1;
        const score = rrfScore(rank, keywordWeight, k);
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

const normalize = (arr: number[]) => {
    const norm = Math.sqrt(arr.reduce((sum, val) => sum + val**2, 0));

    if (norm === 0) return Array<number>(arr.length).fill(0);

    return arr.map(val => val / norm);
}

const toHex = (uuid: string) => {
    return uuid.replaceAll("-", "");
}

const toBytes = (uuid: string) => {
    return parse(uuid);
}

export { toHex, toBytes, mergeResults, normalize };
