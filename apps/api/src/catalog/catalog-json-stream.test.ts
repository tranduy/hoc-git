import { describe, expect, it } from "vitest";
import { streamCatalogJson } from "./catalog-json-stream.js";

describe("catalog JSON stream batches", () => {
  it("sends large catalogs in bounded blocks instead of scheduling I/O for individual JSON tokens", () => {
    const catalog = { provider: "BTI", observedAtMs: 123,
      quotes: Array.from({ length: 30_000 }, (_, index) => ({ id: index, rawOdds: "1.95", label: "Đội \"A\" \\ B" })) };
    const blocks = [...streamCatalogJson(catalog)];
    expect(blocks.join("")).toBe(JSON.stringify(catalog));
    // Hundreds of tiny compressed writes each wait for an I/O turn under ingress
    // load. A two-megabyte catalog needs only a handful of bounded writes.
    expect(blocks.length).toBeLessThan(16);
    expect(Math.max(...blocks.map((part) => part.length))).toBeLessThan(1_100_000);
  });

  it("flushes short and empty catalogs and does not eagerly serialize a whole large book", () => {
    expect([...streamCatalogJson({})].join("")).toBe("{}");
    const source = { quotes: Array.from({ length: 100_000 }, (_, index) => ({ id: index, rawOdds: "1.95" })) };
    let visited = 0;
    const input = { quotes: source.quotes.map((row) => ({ toJSON() { visited++; return row; } })) };
    const stream = streamCatalogJson(input);
    expect(stream.next().value?.length).toBeGreaterThan(0);
    expect(visited).toBeLessThan(source.quotes.length);
    stream.return(undefined);
    const short = { events: [], quotes: [{ rawOdds: "-0.85" }], absent: undefined };
    expect([...streamCatalogJson(short)].join("")).toBe(JSON.stringify(short));
  });
});
