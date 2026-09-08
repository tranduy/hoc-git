import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";

const at = Date.parse("2026-09-08T12:00:00Z");
const main = { mi: 10, bti: 1, gp: 1, ws: [
  { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67 },
  { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79 }
] };
const hidden = { mi: 20, bti: 18, gp: 1, fieldlineObservedAtMs: at - 120_000,
  ws: [{ wsi: 201, si: 87, o: 0.9 }, { wsi: 202, si: 88, o: -0.95 }] };
const unmapped = { mi: 30, bti: 777, gp: 19, fieldlineObservedAtMs: at - 60_000,
  ws: [{ wsi: 301, si: 701, hdp: 2.5, dih: "2/2.5", o: 3.14 }, { wsi: 302, si: 702, hdp: 2.5, o: -999 }] };
const event = { eid: 100, htn: "Home club", atn: "Away club", cn: "Test league",
  edt: "2026-09-09T20:00:00+08:00", isrbt: false, iscyb: false, mls: [main, hidden, unmapped] };
function frame(body: unknown, sequence: number, partition?: "IM_MARKET_1" | "IM_MARKET_2", generation = "im:8:1"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8,
    sourceEpoch: "im-source:1", sequence, observedAtMs: at + sequence * 1000,
    receivedMonotonicMs: 500_000 + sequence * 1000, transport: "HTTP_RESPONSE",
    request: { hostname: "imsports.directsb.net", resourceType: "XHR", pathnameClass: partition
      ? "/api/EventV6/GetSE" : "/api/EventV6/GetSEDelta", ...(partition ? {
        providerPartition: partition, streamId: generation, reconcileCutoffSequence: 0 } : {}) },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } };
}
function commit(adapter: ImHttpCatalogAdapter, value = event, firstSequence = 1, generation = "im:8:1") {
  adapter.decode(frame({ StatusCode: 100, sel: [value] }, firstSequence, "IM_MARKET_1", generation));
  return adapter.decode(frame({ StatusCode: 100, sel: [] }, firstSequence + 1, "IM_MARKET_2", generation))[0]!.value as any;
}

describe("IM original native market receipts", () => {
  it("keeps cached hidden clocks through a fresh snapshot and unrelated main delta, retaining unknown native selections", () => {
    const adapter = new ImHttpCatalogAdapter();
    const first = commit(adapter);
    expect(first.quotes.find((q: any) => q.providerMarketId === "20")).toMatchObject({ receivedMonotonicMs: 380_000 });
    expect(first.nativeMarketObservations.find((row: any) => row.providerMarketId === "30")).toMatchObject({
      disposition: "UNMAPPED", observedAtMs: at - 60_000, nativeSelections: [
        { selectionId: "301", outcomeId: "701", line: "2/2.5", price: "3.14" },
        { selectionId: "302", outcomeId: "702", line: "2.5", price: "-999" }
      ]
    });
    const fresh = commit(adapter, event, 3, "im:8:2");
    expect(fresh.quotes.filter((q: any) => q.providerMarketId === "20"))
      .toEqual(first.quotes.filter((q: any) => q.providerMarketId === "20"));
    const nextMain = { ...main, ws: main.ws.map((row, index) => ({ ...row, o: index === 0 ? 0.72 : row.o })) };
    const updated = adapter.decode(frame({ StatusCode: 100, dc: [{ eid: 100, a: 3, v: [nextMain] }] }, 5))[0]!.value as any;
    expect(updated.quotes.find((q: any) => q.providerMarketId === "10" && q.selection === "HOME"))
      .toMatchObject({ rawOdds: "0.72", receivedMonotonicMs: 505_000, sequence: 5 });
    expect(updated.quotes.filter((q: any) => q.providerMarketId === "20"))
      .toEqual(first.quotes.filter((q: any) => q.providerMarketId === "20"));
    expect(updated.nativeMarketObservations.find((row: any) => row.providerMarketId === "20").observedAtMs)
      .toBe(at - 120_000);
  });

  it("refuses a future explicit receipt instead of claiming a fresh authoritative generation", () => {
    const adapter = new ImHttpCatalogAdapter();
    const bad = { ...event, mls: [{ ...main, fieldlineObservedAtMs: at + 100_000 }] };
    expect(adapter.decode(frame({ StatusCode: 100, sel: [bad] }, 1, "IM_MARKET_1"))).toEqual([]);
    expect(adapter.decode(frame({ StatusCode: 100, sel: [] }, 2, "IM_MARKET_2"))).toEqual([]);
  });
});
