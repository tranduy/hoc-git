import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cmd-early-native-20260908.json", import.meta.url), "utf8"));
const main = (t = fixture.main.t) => ({ t, a: true, data: [], today: [fixture.main.row], f: [] });
const early = (rows = [fixture.early.row], t = fixture.early.t) => ({ t, a: true, today: rows, f: [] });
function envelope(body: unknown, sequence: number, fc = 1, overrides = {}): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "cmd-native:1", sequence, observedAtMs: fixture.early.observedAtMs + sequence,
    receivedMonotonicMs: 1000 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      method: "GET", resourceType: "XHR", providerFunctionCode: fc, cmdFullScope: true,
      observerRequestId: `cmd-observer:request:${sequence}`, requestFrameKey: "cmd-frame",
      requestDocumentKey: "cmd-document", reconcileCutoffSequence: sequence - 1, ...overrides },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}
const catalog = (updates: ReturnType<CmdHttpCatalogAdapter["decode"]>) => updates.at(-1)?.value as ObservedProviderCatalog;

describe("CMD authenticated Early partition", () => {
  it.each(["main-first", "early-first"] as const)("retains the complete catalog until replacement partitions join (%s)", async order => {
    const rows = Array.from({ length: 30 }, (_, index) => {
      const row = [...fixture.main.row]; row[0] = 900000 + index;
      row[38] = `Home ${index}`; row[39] = `Away ${index}`; return row;
    });
    const plane = new ChromeCatalogDataPlane({ now: () => fixture.early.observedAtMs + 100 });
    const id = "catalog-source:CMD:FOOTBALL";
    const oldMain = { ...main(), today: rows };
    expect(plane.ingest(envelope(oldMain, 1), { connectionGeneration: 1 })).toBe(true);
    const retained = await plane.read(id) as ObservedProviderCatalog;
    expect(retained.events).toHaveLength(30);
    const incoming = (body: unknown, sequence: number, fc = 1, overrides = {}) => ({
      ...envelope(body, sequence, fc, overrides), sourceEpoch: "cmd-native:2"
    });
    const partial = { ...main(fixture.main.t + 1), today: [rows[0]] };
    const future = early(rows.slice(1));
    if (order === "main-first") {
      expect(plane.ingest(incoming(partial, 2, 1, { cmdFullScope: undefined }), { connectionGeneration: 2 })).toBe(false);
      expect(plane.ingest(incoming(partial, 3), { connectionGeneration: 2 })).toBe(false);
      expect((await plane.read(id) as ObservedProviderCatalog).events).toHaveLength(30);
      expect(plane.ingest(incoming(future, 4, 6), { connectionGeneration: 2 })).toBe(true);
    } else {
      expect(plane.ingest(incoming(future, 2, 6), { connectionGeneration: 2 })).toBe(false);
      expect((await plane.read(id) as ObservedProviderCatalog).events).toHaveLength(30);
      expect(plane.ingest(incoming(partial, 3), { connectionGeneration: 2 })).toBe(true);
    }
    const replaced = await plane.read(id) as ObservedProviderCatalog;
    expect(replaced.events).toHaveLength(30);
    expect(replaced.observedAtMs).toBeGreaterThan(retained.observedAtMs);
  });

  it("applies an authenticated Early removal through the data plane", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => fixture.early.observedAtMs + 100 });
    expect(plane.ingest(envelope(main(), 1))).toBe(true);
    expect(plane.ingest(envelope(early(), 2, 6))).toBe(true);
    expect((await plane.read("catalog-source:CMD:FOOTBALL") as ObservedProviderCatalog).events).toHaveLength(2);
    expect(plane.ingest(envelope(early([], fixture.early.t + 1), 3, 6))).toBe(true);
    expect((await plane.read("catalog-source:CMD:FOOTBALL") as ObservedProviderCatalog).events)
      .toHaveLength(1);
  });

  it("ignores filtered main baselines after acquiring proven full scope", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    expect(adapter.decode(envelope(main(fixture.main.t + 1), 2, 1, { cmdFullScope: undefined }))).toEqual([]);
    expect(adapter.takeIgnoreReason()).toBe("baseline-filtered-after-full-scope");
  });
  it("keeps a newer matching Today row when an older Early request finishes later", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const newer = [...fixture.main.row]; newer[42] = 0.6;
    adapter.decode(envelope({ ...main(fixture.main.t + 1), today: [newer] }, 3));
    const update = adapter.decode(envelope(early([fixture.main.row]), 4, 6, { reconcileCutoffSequence: 1 }));
    expect(catalog(update).quotes.find(q => q.providerEventId === "25403104" && q.marketType === "FT_TOTAL" && q.selection === "OVER"))
      .toMatchObject({ rawOdds: "0.6", sequence: 3, receivedMonotonicMs: 1003 });
  });

  it("keeps a newer matching Early row when an older Today request finishes after migration", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    // This ordering test uses the characterized ordinary Malay mode. The
    // actual archived Early row is MR and is separately retained raw below.
    const newer = [...fixture.early.row]; newer[42] = 0.61; newer[79] = 0;
    adapter.decode(envelope(early([newer]), 3, 6));
    const update = adapter.decode(envelope({ ...main(fixture.main.t + 1), today: [fixture.early.row] }, 4, 1,
      { reconcileCutoffSequence: 1 }));
    expect(catalog(update).quotes.find(q => q.providerEventId === "1099097157" && q.marketType === "FT_TOTAL" && q.selection === "OVER"))
      .toMatchObject({ rawOdds: "0.61", sequence: 3, receivedMonotonicMs: 1003 });
  });

  it("retains actual fc6 Early prices and clocks after a newer fc1 Today baseline", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const update = adapter.decode(envelope(early(), 2, 6));
    expect(update).toHaveLength(1);
    expect(update[0]).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP" });
    const acquired = catalog(update);
    expect(acquired.events.map(row => row.providerEventId)).toEqual(expect.arrayContaining(["25403104", "1099097157"]));
    const originalQuotes = acquired.quotes.filter(row => row.providerEventId === "1099097157");
    expect(originalQuotes).toEqual([]);
    const native = acquired.nativeMarketObservations!.filter(row => row.providerEventId === "1099097157");
    expect(native).toContainEqual(expect.objectContaining({ nativeType: "3", reason: "NATIVE_MR_ODDS_UNPROVEN",
      observedAtMs: fixture.early.observedAtMs + 2,
      nativeSelections: [expect.objectContaining({ price: "0.93" }), expect.objectContaining({ price: "0.93" })] }));
    const next = catalog(adapter.decode(envelope(main(fixture.main.t + 1), 3)));
    expect(next.quotes.filter(row => row.providerEventId === "1099097157")).toEqual(originalQuotes);
    expect(next.nativeMarketObservations!.filter(row => row.providerEventId === "1099097157")).toEqual(native);
    expect(next.events).toHaveLength(2);
  });

  it("requires exact request scope and current document before admitting Early authority", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    for (const overrides of [{ cmdFullScope: undefined }, { requestDocumentKey: "other-document" },
      { reconcileCutoffSequence: undefined }]) {
      expect(adapter.decode(envelope(early(), 2, 6, overrides))).toEqual([]);
    }
    expect(catalog(adapter.decode(envelope(main(fixture.main.t + 1), 3))).events).toHaveLength(1);
  });

  it("retires only Early-owned events on an authenticated empty Early response", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    adapter.decode(envelope(early(), 2, 6));
    const update = adapter.decode(envelope(early([], fixture.early.t + 1), 3, 6));
    expect(update[0]).toMatchObject({ evidenceMode: "DELTA", authoritativeRemovedEventIds: ["1099097157"] });
    expect(catalog(update).events.map(row => row.providerEventId)).toEqual(["25403104"]);
  });
});
