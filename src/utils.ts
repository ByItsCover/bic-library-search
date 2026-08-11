import { Connection } from "@lancedb/lancedb";
import { Gliner } from "gliner/node";
import { ApolloClient, InMemoryCache } from "@apollo/client";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { parse } from "uuid";
import { CoverResult } from "./types";


const loadTable = async (table_name: string, dbPromise: Promise<Connection>) => {
    const db = await dbPromise;
    return await db.openTable(table_name);
}

const initGliner = async (glinerModel: Gliner) => {
    try {
        await glinerModel.initialize();
    } catch (error) {
        console.error("Gliner initialize failed", error);
        throw error;
    }
}

const loadApolloClient = async (uri: string, secretPromise: Promise<string | Uint8Array<ArrayBufferLike> | undefined>) => {
    const secretValue = await secretPromise;
    const batchLink = new BatchHttpLink({
        uri: uri,
        headers: {
            authorization: `Bearer ${secretValue}`,
        },
    });
    return new ApolloClient({
        link: batchLink,
        cache: new InMemoryCache(),
    });
}

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

export { loadTable, initGliner, loadApolloClient, toHex, toBytes, mergeResults, normalize };
