import { Tokenizer } from "@huggingface/tokenizers";


export class ClipTokenizer {
    tokenizer: Tokenizer;
    paddingId: number;
    paddingLength: number;

    constructor(tokenizer: Tokenizer, paddingLength: number) {
        this.tokenizer = tokenizer;
        this.paddingId = tokenizer.token_to_id('<|endoftext|>') ?? 49407;
        this.paddingLength = paddingLength;
    }

    padding = (arr: number[], pad_value: number, target_length: number, truncate: boolean) => {
        const padded_arr = [
            ...arr,
            ...Array<number>(Math.max(target_length - arr.length, 0)).fill(pad_value),
        ];

        return truncate ? padded_arr.slice(0, target_length)
            : padded_arr;
    }

    encode = (text: string, paddingLength: number = this.paddingLength, truncate: boolean = true): number[] => {
        const tokens = this.tokenizer.encode(text);
        return this.padding(tokens.ids, this.paddingId, paddingLength, truncate);
    }
}