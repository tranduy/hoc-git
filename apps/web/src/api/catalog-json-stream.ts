const recordArrays = new Set(["events", "markets", "quotes", "nativeMarketObservations", "nativeCoverageByEvent"]);
const invalidJson = (): SyntaxError => new SyntaxError("Invalid catalog JSON stream");
const whitespace = (character: string): boolean => character === " " || character === "\t" || character === "\r" || character === "\n";

/** Read one catalog without retaining the complete response text or a second
 * raw record array. JSON.parse still validates each complete JSON value. */
export async function readCatalogJsonStream(stream: ReadableStream<Uint8Array>,
  mapArrayItem?: (key: string, value: unknown) => unknown): Promise<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let chunk = "", position = 0, ended = false;

  const available = async (): Promise<boolean> => {
    while (position === chunk.length) {
      if (ended) return false;
      const next = await reader.read();
      ended = next.done;
      chunk = next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      position = 0;
    }
    return true;
  };
  const skipWhitespace = async (): Promise<void> => {
    while (await available()) {
      while (position < chunk.length && whitespace(chunk[position]!)) position += 1;
      if (position < chunk.length) return;
    }
  };
  const expect = async (character: string): Promise<void> => {
    if (!await available() || chunk[position] !== character) throw invalidJson();
    position += 1;
  };
  const peek = async (): Promise<string | undefined> => await available() ? chunk[position] : undefined;

  const value = async (key = false): Promise<unknown> => {
    // Store slices at chunk boundaries, never concatenate one character at a
    // time. Only the currently unfinished record is buffered across reads.
    const parts: string[] = [];
    let depth = 0, quoted = false, escaped = false;
    while (await available()) {
      const start = position;
      while (position < chunk.length) {
        const character = chunk[position]!;
        if (!quoted && depth === 0 && (character === "," || character === "]" || character === "}" || (key && character === ":"))) {
          if (position > start) parts.push(chunk.slice(start, position));
          if (parts.length === 0) throw invalidJson();
          return JSON.parse(parts.join("")) as unknown;
        }
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === "[" || character === "{") depth += 1;
        else if (character === "]" || character === "}") depth -= 1;
        position += 1;
      }
      if (position > start) parts.push(chunk.slice(start, position));
    }
    if (quoted || depth !== 0 || parts.length === 0) throw invalidJson();
    return JSON.parse(parts.join("")) as unknown;
  };

  const array = async (key: string): Promise<unknown[]> => {
    await expect("[");
    const items: unknown[] = [];
    await skipWhitespace();
    if (await peek() === "]") { position += 1; return items; }
    while (true) {
      const item = await value();
      items.push(mapArrayItem === undefined ? item : mapArrayItem(key, item));
      await skipWhitespace();
      const delimiter = await peek();
      if (delimiter === "]") { position += 1; return items; }
      if (delimiter !== ",") throw invalidJson();
      position += 1;
      await skipWhitespace();
      // A comma always requires another value, including at stream end.
      if (await peek() === "]") throw invalidJson();
    }
  };

  try {
    await skipWhitespace();
    await expect("{");
    const result: Record<string, unknown> = {};
    await skipWhitespace();
    if (await peek() === "}") position += 1;
    else while (true) {
      if (await peek() !== '"') throw invalidJson();
      const key = await value(true);
      if (typeof key !== "string") throw invalidJson();
      await expect(":");
      await skipWhitespace();
      const item = recordArrays.has(key) && await peek() === "[" ? await array(key) : await value();
      // Match JSON.parse's own-property semantics, including __proto__ and
      // duplicate keys. Every streamed duplicate array is still validated.
      Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
      await skipWhitespace();
      const delimiter = await peek();
      if (delimiter === "}") { position += 1; break; }
      if (delimiter !== ",") throw invalidJson();
      position += 1;
      await skipWhitespace();
      if (await peek() === "}") throw invalidJson();
    }
    await skipWhitespace();
    if (await available()) throw invalidJson();
    return result;
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Preserve the parse/validation/transport error. */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
