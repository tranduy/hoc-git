import { describe, expect, it } from "vitest";
import { readCatalogJsonStream } from "./catalog-json-stream.js";

const encoder = new TextEncoder();
function chunks(json: string, size = 7): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(json);
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + size)); offset = Math.min(bytes.length, offset + size);
  } }, { highWaterMark: 0 });
}

describe("incremental catalog JSON reader", () => {
  it.each([1, 2, 3, 7, 64, 1024])("retains all nested, escaped and UTF-8 values with %i byte chunks", async size => {
    const original = { events: [{ id: "Tiếng Việt 😀 𝄞", value: "\\\"[,]{}\n\t" }, { n: -1.25e23 }],
      markets: [{ nested: [null, true, false, { a: [1, 2, 3] }] }], quotes: [1, "two", null],
      nativeMarketObservations: [{ raw: "quoted \"name\"" }], nativeCoverageByEvent: [],
      unknown: { array: ["a", { b: false }] }, empty: "", count: 2, flag: true, nil: null };
    const seen: string[] = [];
    const stream = chunks(JSON.stringify(original), size);
    const parsed = await readCatalogJsonStream(stream, (key, value) => { seen.push(key); return value; });
    expect(parsed).toEqual(original);
    expect(seen).toEqual(["events", "events", "markets", "quotes", "quotes", "quotes", "nativeMarketObservations"]);
    expect(stream.locked).toBe(false);
  });

  it("validates each complete item before requesting the next item's chunk", async () => {
    let pulled = 0, mapped = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulled === 0) controller.enqueue(encoder.encode('{"events":[{"id":1},'));
      else if (pulled === 1) {
        expect(mapped).toBe(1);
        controller.enqueue(encoder.encode('{"id":2}],"quotes":[]}'));
      } else controller.close();
      pulled += 1;
    } }, { highWaterMark: 0 });
    const parsed = await readCatalogJsonStream(stream, (key, value) => { mapped += 1; return { key, value }; });
    expect(parsed.events).toEqual([{ key: "events", value: { id: 1 } }, { key: "events", value: { id: 2 } }]);
    expect(mapped).toBe(2);
  });

  it("retains and maps every record of all five catalog arrays across many chunks", async () => {
    const keys = ["events", "markets", "quotes", "nativeMarketObservations", "nativeCoverageByEvent"];
    const original = Object.fromEntries(keys.map(key => [key, Array.from({ length: 1000 }, (_, id) => ({ id, text: `${key}-${id}` }))]));
    const counts = new Map<string, number>();
    const parsed = await readCatalogJsonStream(chunks(JSON.stringify(original), 257), (key, value) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { ...(value as Record<string, unknown>), validated: key };
    });
    for (const key of keys) {
      expect(counts.get(key)).toBe(1000);
      expect(parsed[key]).toEqual(original[key]!.map(value => ({ ...value, validated: key })));
    }
  });

  it("accepts an empty object, JSON whitespace, and a UTF-8 BOM split across chunks", async () => {
    expect(await readCatalogJsonStream(chunks('\ufeff \n{ "events" : [ ] }\t\r', 1))).toEqual({ events: [] });
    expect(await readCatalogJsonStream(chunks('{}'))).toEqual({});
  });

  it("maps every occurrence of duplicate array keys, retains nonarrays, and handles prototype keys safely", async () => {
    const seen: unknown[] = [];
    const parsed = await readCatalogJsonStream(chunks('{"quotes":[1],"quotes":[2],"events":null,"markets":{},"__proto__":{"polluted":true},"constructor":3}'),
      (_key, value) => { seen.push(value); return Number(value) * 10; });
    expect(seen).toEqual([1, 2]);
    expect(parsed.quotes).toEqual([20]);
    expect(parsed.events).toBeNull(); expect(parsed.markets).toEqual({});
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(parsed.__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    '', ' ', '[]', 'null', '1', '{', '{"events"', '{"events":', '{"events":[',
    '{"events":[1', '{"events":[1,]}', '{"events":[,1]}', '{"events":[1,,2]}',
    '{"events":[],}', '{"events":[] "markets":[]}', '{events:[]}', '{"events" []}',
    '{"events":[01]}', '{"events":[NaN]}', '{"events":[true false]}',
    '{"events":[{"a":1 "b":2}]}', '{"events":[{"a":[1,]}]}', '{"events":[{"a":1]]}',
    '{"events":["\\x20"]}', '{"events":["unterminated]}', '{"events":["raw\nnewline"]}',
    '{}x', '{} {}', '{"events":[]} false', '{"events":[]/*comment*/}', '{"events":[]}\u00a0'
  ])("rejects malformed or truncated JSON %j", async json => {
    const stream = chunks(json, 1);
    await expect(readCatalogJsonStream(stream)).rejects.toThrow();
    expect(stream.locked).toBe(false);
  });

  it("rejects invalid and truncated UTF-8 rather than silently replacing a code point", async () => {
    for (const bytes of [new Uint8Array([123, 34, 120, 34, 58, 34, 0xc3, 34, 125]), new Uint8Array([0xf0, 0x9f])]) {
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      await expect(readCatalogJsonStream(stream)).rejects.toThrow();
      expect(stream.locked).toBe(false);
    }
  });

  it("cancels and releases the reader on callback failure without replacing the original error", async () => {
    const failure = new Error("schema rejected row");
    let cancellation: unknown, pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      pulls += 1; controller.enqueue(encoder.encode('{"quotes":[{"id":1},'));
    }, cancel(reason) { cancellation = reason; throw new Error("cancel failed"); } }, { highWaterMark: 0 });
    await expect(readCatalogJsonStream(stream, () => { throw failure; })).rejects.toBe(failure);
    expect(cancellation).toBe(failure); expect(pulls).toBe(1); expect(stream.locked).toBe(false);
  });

  it("propagates a rejected stream read and releases its lock", async () => {
    const failure = new Error("transport aborted");
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(failure); } });
    await expect(readCatalogJsonStream(stream)).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });
});
