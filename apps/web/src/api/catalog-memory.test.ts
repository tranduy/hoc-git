import { describe, expect, it, vi } from "vitest";
import { CatalogApi, parseLiveCatalogResponse, readLiveCatalogResponse } from "./catalog.js";

const quote = (id: string) => ({ provider: "BTI", category: "FOOTBALL", providerEventId: "event",
  providerMarketId: "total", providerSelectionId: id, marketType: "FT_TOTAL", scope: "FULL_TIME",
  selection: id === "over" ? "OVER" : "UNDER", line: "2.5", rawOdds: "1.95", rawFormat: "DECIMAL",
  status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 });
const payload = () => ({ dataMode: "LIVE", accountId: "bti", provider: "BTI", category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: 1,
  rejectedMarketCount: 0, events: [], markets: [], quotes: [quote("over"), quote("under")] });

describe("owned catalog response validation memory", () => {
  it("reads a real network body incrementally without calling whole-response json()", async () => {
    const body = payload();
    const response = new Response(JSON.stringify(body));
    const json = vi.spyOn(response, "json").mockRejectedValue(new Error("whole-body decoding forbidden"));
    const api = new CatalogApi(async () => response);
    expect(await api.read("bti")).toEqual(parseLiveCatalogResponse(body, "bti"));
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects and cancels an invalid first quote before the rest of a huge body arrives", async () => {
    const invalid = quote("over"); invalid.rawFormat = "GUESS";
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"quotes":[' + JSON.stringify(invalid) + ','));
    }, cancel });
    await expect(readLiveCatalogResponse({ body: stream, json: async () => { throw Error("unused"); } }, "bti"))
      .rejects.toThrow("Invalid live catalog response");
    expect(cancel).toHaveBeenCalled();
  });

  it("still rejects malformed envelope and cross-provider rows after streaming validation", async () => {
    for (const value of [ { ...payload(), accountId: "wrong" }, { ...payload(), quotes: null },
      { ...payload(), nativeMarketObservations: null },
      { ...payload(), quotes: [{ ...quote("over"), provider: "CMD" }] },
      { ...payload(), nativeCoverageByEvent: [{ providerEventId: "a", normalized: 1, excluded: 0, unmapped: 0 },
        { providerEventId: "a", normalized: 1, excluded: 0, unmapped: 0 }] } ]) {
      await expect(readLiveCatalogResponse(new Response(JSON.stringify(value)), "bti"))
        .rejects.toThrow("Invalid live catalog response");
    }
  });
  it("releases each raw quote before validating the next without retaining a second full array", () => {
    const body = payload(), first = body.quotes[0]!, second = body.quotes[1]!;
    let firstReleased = false;
    Object.defineProperty(body.quotes, 1, { configurable: true, get() {
      firstReleased = body.quotes[0] !== first; return second;
    }, set(value) { Object.defineProperty(body.quotes, 1, { value, writable: true, configurable: true }); } });
    const parsed = parseLiveCatalogResponse(body, "bti", { consumeInput: true });
    expect(firstReleased).toBe(true);
    expect(parsed.quotes).toBe(body.quotes);
    expect(parsed.quotes).toHaveLength(2);
    expect(parsed.quotes).toEqual([first, second]);
  });

  it("preserves non-owned caller data and applies the same schema errors in both modes", () => {
    const body = payload(), original = body.quotes[0];
    const parsed = parseLiveCatalogResponse(body, "bti");
    expect(body.quotes[0]).toBe(original);
    expect(parsed.quotes[0]).not.toBe(original);
    for (const consumeInput of [true, false]) {
      const invalid = payload(); invalid.quotes[1]!.rawFormat = "GUESS";
      expect(() => parseLiveCatalogResponse(invalid, "bti", { consumeInput })).toThrow("Invalid live catalog response");
      const unknown = payload(); Object.assign(unknown.quotes[1]!, { unknownTransportField: "reject" });
      expect(() => parseLiveCatalogResponse(unknown, "bti", { consumeInput })).toThrow("Invalid live catalog response");
    }
  });

  it("uses consumption only for its own response and never caches a partially validated revision", async () => {
    const good = payload(), bad = payload(); bad.quotes[1]!.rawFormat = "GUESS";
    let calls = 0;
    const api = new CatalogApi(async () => ({ ok: true, status: 200,
      json: async () => ++calls === 1 ? good : bad,
      headers: new Headers({ etag: '"revision"' }) }) as Response);
    const first = await api.read("bti");
    expect(first.quotes).toBe(good.quotes);
    await expect(api.read("bti")).rejects.toThrow("Invalid live catalog response");
    expect(first.quotes).toHaveLength(2);
    expect(first.quotes[1]?.rawFormat).toBe("DECIMAL");
  });
});
