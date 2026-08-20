import { parse } from "uuid";

const toHex = (uuid: string) => {
    return uuid.replaceAll("-", "");
}

const toBytes = (uuid: string) => {
    return parse(uuid);
}

export { toHex, toBytes };
