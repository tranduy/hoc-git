import { createReadStream } from "node:fs";

const arrayFields = new Set(["events", "markets", "quotes", "nativeMarketObservations"]);
const scalarFields = new Set(["dataMode", "accountId", "provider", "category", "comparisonState",
  "observedAtMs", "observedMonotonicMs", "rejectedMarketCount"]);
type State = "OPEN" | "KEY" | "COLON" | "VALUE" | "ARRAY_VALUE" | "ARRAY_AFTER" | "FIELD_AFTER" | "DONE";
interface Token {
  start: number;
  target: "KEY" | "VALUE" | "ENTRY";
  mode: "STRING" | "STRUCTURED" | "PRIMITIVE";
  depth: number;
  inString: boolean;
  escaped: boolean;
}
const whitespace = (char: string): boolean => char === " " || char === "\t" || char === "\r" || char === "\n";

/** Read the existing catalog JSON format one array entry at a time. The retained
 * object graph is necessary; an additional full 500 MB JSON string is not. */
export async function readCatalogJson(path: string): Promise<unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let state: State = "OPEN", key = "", array: unknown[] | null = null;
  let buffer = "", cursor = 0, token: Token | null = null, allowEnd = true;
  // Accessors keep TypeScript from treating values mutated by scan() as their
  // initial literals at the asynchronous read boundary.
  const currentToken = (): Token | null => token;
  const currentState = (): State => state;
  const fail = (): never => { throw new Error("CATALOG_JSON_INVALID"); };
  const begin = (target: Token["target"]): void => {
    const char = buffer[cursor]!;
    if (char !== '"' && char !== "{" && char !== "[" && !/[-0-9tfn]/u.test(char)) fail();
    token = { start: cursor, target, mode: char === '"' ? "STRING" : char === "{" || char === "[" ? "STRUCTURED" : "PRIMITIVE",
      depth: 0, inString: false, escaped: false };
  };
  const finish = (end: number): void => {
    const current = token!;
    const value: unknown = JSON.parse(buffer.slice(current.start, end));
    token = null; cursor = end;
    if (current.target === "KEY") {
      if (typeof value !== "string") throw new Error("CATALOG_JSON_INVALID");
      if ((!arrayFields.has(value) && !scalarFields.has(value)) || Object.hasOwn(result, value)) fail();
      key = value; state = "COLON";
    } else if (current.target === "ENTRY") {
      array!.push(value); state = "ARRAY_AFTER";
    } else {
      result[key] = value; state = "FIELD_AFTER";
    }
  };
  const scan = (): void => {
    while (cursor < buffer.length) {
      const char = buffer[cursor]!;
      if (token !== null) {
        if (token.mode === "PRIMITIVE") {
          if (whitespace(char) || char === "," || char === "}" || char === "]") { finish(cursor); continue; }
        } else if (token.inString) {
          if (token.escaped) token.escaped = false;
          else if (char === "\\") token.escaped = true;
          else if (char === '"') {
            token.inString = false;
            if (token.mode === "STRING") { finish(cursor + 1); continue; }
          }
        } else if (char === '"') token.inString = true;
        else if (char === "{" || char === "[") token.depth++;
        else if (char === "}" || char === "]") {
          token.depth--;
          if (token.depth === 0) { finish(cursor + 1); continue; }
        }
        cursor++;
        continue;
      }
      if (whitespace(char)) { cursor++; continue; }
      switch (state) {
        case "OPEN":
          if (char !== "{") fail();
          state = "KEY"; allowEnd = true; cursor++; break;
        case "KEY":
          if (char === "}" && allowEnd) { state = "DONE"; cursor++; break; }
          if (char !== '"') fail();
          begin("KEY"); break;
        case "COLON":
          if (char !== ":") fail();
          state = "VALUE"; cursor++; break;
        case "VALUE":
          if (arrayFields.has(key)) {
            if (char !== "[") fail();
            array = []; result[key] = array; state = "ARRAY_VALUE"; allowEnd = true; cursor++;
          } else {
            if (char === "{" || char === "[") fail();
            begin("VALUE");
          }
          break;
        case "ARRAY_VALUE":
          if (char === "]" && allowEnd) { state = "FIELD_AFTER"; cursor++; break; }
          begin("ENTRY"); break;
        case "ARRAY_AFTER":
          if (char === "]") { state = "FIELD_AFTER"; cursor++; break; }
          if (char !== ",") fail();
          state = "ARRAY_VALUE"; allowEnd = false; cursor++; break;
        case "FIELD_AFTER":
          if (char === "}") { state = "DONE"; cursor++; break; }
          if (char !== ",") fail();
          state = "KEY"; allowEnd = false; cursor++; break;
        case "DONE": fail();
      }
    }
  };
  // Node's UTF-8 decoder retains split multibyte characters between chunks.
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
    buffer += chunk as string;
    scan();
    const pending = currentToken();
    const consumed = pending === null ? cursor : pending.start;
    buffer = buffer.slice(consumed); cursor -= consumed;
    if (pending !== null) pending.start = 0;
  }
  if (currentToken() !== null || currentState() !== "DONE") fail();
  return result;
}
