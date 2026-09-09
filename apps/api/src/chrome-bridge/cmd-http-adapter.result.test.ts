import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cmd-more-native-20260908.json", import.meta.url), "utf8"));
function envelope(body: unknown, sequence: number): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "cmd-result:1", sequence, observedAtMs: fixture.observedAtMs + sequence,
    receivedMonotonicMs: 1000 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      method: "GET", resourceType: "XHR", providerFunctionCode: sequence === 1 ? 1 : 3,
      observerRequestId: `cmd-result:request:${sequence}`, requestFrameKey: "frame", requestDocumentKey: "document" },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}
function owner() {
  const row: unknown[] = [...fixture.owner];
  // Public DataFormat names 17/18/19 H/A/D;20/21/22 FH H/A/D.
  Object.assign(row, { 17: 2.1, 18: 3.2, 19: 3.1, 20: 2.8, 21: 4.1, 22: 2.2, 55: false, 84: 1.2, 85: 1.3, 86: 1.4 });
  return row;
}

describe("CMD native main result normalization", () => {
  it("applies native 118 visibility before later result prices and explicitly reopens", () => {
    const adapter = new CmdHttpCatalogAdapter(), row = owner();
    adapter.decode(envelope({ t: 1, a: true, data: [], today: [row], f: [] }, 1));
    const update = (t: number, data: unknown[][]) => {
      const updates = adapter.decode(envelope({ t, a: true, data }, t));
      expect(updates).toHaveLength(1);
      return updates[0]!.value as ObservedProviderCatalog;
    };
    const resultQuotes = (value: ObservedProviderCatalog) => value.quotes.filter(q => q.marketType.endsWith("_1X2"));
    expect(resultQuotes(update(2, [[row[0], 1, 118, false, true, false, row[3], String(row[32]), null, row[25], null, row[67]]]))).toEqual([]);
    expect(resultQuotes(update(3, [[row[0], 1, 51, 2.3, 3.4, 3.3]]))).toEqual([]);
    const reopened = resultQuotes(update(4, [[row[0], 1, 118, false, false, false, row[3], String(row[32]), null, row[25], null, row[67]]]));
    expect(reopened).toHaveLength(6);
    expect(reopened.every(q => q.status === "OPEN" && q.sequence === 4)).toBe(true);
    expect(reopened.filter(q => q.marketType === "FT_1X2").map(q => q.rawOdds)).toEqual(["2.3", "3.3", "3.4"]);
  });

  it("replays a newer native 118 received before its delayed baseline", () => {
    const adapter = new CmdHttpCatalogAdapter(), row = owner();
    expect(adapter.decode(envelope({ t: 2, a: true, data: [[row[0], 1, 118, 0, 1, 0]] }, 2))).toEqual([]);
    const value = adapter.decode(envelope({ t: 1, a: true, data: [], today: [row], f: [] }, 1)).at(-1)!.value as ObservedProviderCatalog;
    expect(value.quotes.filter(q => q.marketType.endsWith("_1X2"))).toEqual([]);
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "5", reason: "NATIVE_MARKET_HIDDEN" }));
  });

  it("does not treat MR odds mode or match commentary as result suspension", () => {
    const row = owner(); row[79] = 1; row[88] = 1;
    const value = new CmdHttpCatalogAdapter().decode(envelope({ t: 1, a: true, data: [], today: [row], f: [] }, 1)).at(-1)!.value as ObservedProviderCatalog;
    const result = value.quotes.filter(quote => quote.marketType.endsWith("_1X2"));
    expect(result).toHaveLength(6);
    expect(result.every(quote => quote.status === "OPEN" && quote.rawFormat === "DECIMAL")).toBe(true);
    expect(value.quotes.filter(quote => !quote.marketType.endsWith("_1X2"))).toEqual([]);
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "1",
      disposition: "EXCLUDED", reason: "NATIVE_MR_ODDS_UNPROVEN", nativeSelections: expect.arrayContaining([
        expect.not.objectContaining({ status: "SUSPENDED" })
      ]) }));
  });

  it("retains hidden or unproven main result permission without creating open quotes", () => {
    for (const flag of [true, 1, null, undefined]) {
      const row = owner(); row[55] = flag;
      const value = new CmdHttpCatalogAdapter().decode(envelope({ t: 1, a: true, data: [], today: [row], f: [] }, 1)).at(-1)!.value as ObservedProviderCatalog;
      expect(value.quotes.filter(quote => quote.marketType.endsWith("_1X2"))).toEqual([]);
      expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "5", disposition: "EXCLUDED",
        reason: flag === true || flag === 1 ? "NATIVE_MARKET_HIDDEN" : "NATIVE_MARKET_PERMISSION_UNPROVEN" }));
    }
  });

  it("publishes proven main 1X2 decimal quotes and keeps DC format unproven", () => {
    const value = new CmdHttpCatalogAdapter().decode(envelope({ t: 1, a: true, data: [], today: [owner()], f: [] }, 1)).at(-1)!.value as ObservedProviderCatalog;
    expect(value.quotes.filter(quote => quote.marketType.endsWith("_1X2"))
      .map(quote => [quote.marketType, quote.selection, quote.rawOdds, quote.rawFormat])).toEqual([
      ["FT_1X2", "HOME", "2.1", "DECIMAL"], ["FT_1X2", "DRAW", "3.1", "DECIMAL"], ["FT_1X2", "AWAY", "3.2", "DECIMAL"],
      ["FH_1X2", "HOME", "2.8", "DECIMAL"], ["FH_1X2", "DRAW", "2.2", "DECIMAL"], ["FH_1X2", "AWAY", "4.1", "DECIMAL"]
    ]);
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "DOUBLE_CHANCE",
      nativeScope: "FULL_TIME", reason: "NATIVE_ODDS_FORMAT_UNPROVEN", nativeSelections: expect.any(Array) }));
  });

  it("applies public 51/54 and packed117 result deltas without swapping away and draw", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const row = owner();
    adapter.decode(envelope({ t: 1, a: true, data: [], today: [row], f: [] }, 1));
    const value = adapter.decode(envelope({ t: 2, a: true, data: [
      [row[0], 1, 51, 2.3, 3.4, 3.3], [row[0], 1, 54, 2.9, 4.2, -999]
    ] }, 2)).at(-1)!.value as ObservedProviderCatalog;
    expect(value.quotes.filter(quote => quote.marketType.endsWith("_1X2"))
      .map(quote => [quote.selection, quote.rawOdds])).toEqual([
      ["HOME", "2.3"], ["DRAW", "3.3"], ["AWAY", "3.4"], ["HOME", "2.9"], ["AWAY", "4.2"]
    ]);
    const packed = adapter.decode(envelope({ t: 3, a: true, data: [
      [row[0], 1, 117, 2.4, 3.5, 3.4, 2.6, 4.3, 2.5]
    ] }, 3)).at(-1)!.value as ObservedProviderCatalog;
    expect(packed.quotes.filter(quote => quote.marketType.endsWith("_1X2")).map(quote => quote.rawOdds))
      .toEqual(["2.4", "3.4", "3.5", "2.6", "2.5", "4.3"]);
  });
});
