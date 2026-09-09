import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cmd-more-native-20260908.json", import.meta.url), "utf8"));
// CMD public DataFormat: FT Odd/Even 48/49; FH 65/66. The public
// ProcessIncUpdateOEOdds/ProcessIncUpdateOEOddsFH handlers use commands 48/115.
function envelope(body: unknown, sequence: number): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "cmd-native:1", sequence, observedAtMs: fixture.observedAtMs + sequence,
    receivedMonotonicMs: 1000 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      method: "GET", resourceType: "XHR", providerFunctionCode: sequence === 1 ? 1 : 3,
      observerRequestId: `cmd-observer:request:${sequence}`, requestFrameKey: "cmd-frame",
      requestDocumentKey: "cmd-document" },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}
const catalog = (updates: ReturnType<CmdHttpCatalogAdapter["decode"]>) => updates.at(-1)?.value as ObservedProviderCatalog;
function owner(): unknown[] {
  const row = [...fixture.owner];
  row[48] = 0.97; row[49] = 0.91; row[65] = 0.85; row[66] = -0.99;
  return row;
}
const main = (row = owner()) => ({ t: 1, a: true, data: [], today: [row], f: [] });
const oddEven = (value: ObservedProviderCatalog) => value.quotes.filter((quote) => quote.marketType.endsWith("ODD_EVEN"));

describe("CMD native main Odd/Even normalization", () => {
  it("emits FT and FH canonical markets from the native main row without a More receipt", () => {
    const value = catalog(new CmdHttpCatalogAdapter().decode(envelope(main(), 1)));
    expect(oddEven(value).map((quote) => [quote.providerMarketId, quote.marketType, quote.scope,
      quote.selection, quote.line, quote.rawOdds, quote.rawFormat])).toEqual([
      ["25403104:native:MAIN:2", "FT_ODD_EVEN", "FULL_TIME", "ODD", null, "0.97", "MALAY"],
      ["25403104:native:MAIN:2", "FT_ODD_EVEN", "FULL_TIME", "EVEN", null, "0.91", "MALAY"],
      ["25403104:native:FH:2", "FH_ODD_EVEN", "FIRST_HALF", "ODD", null, "0.85", "MALAY"],
      ["25403104:native:FH:2", "FH_ODD_EVEN", "FIRST_HALF", "EVEN", null, "-0.99", "MALAY"]
    ]);
    expect(value.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ nativeType: "MAIN:2", disposition: "NORMALIZED" }),
      expect.objectContaining({ nativeType: "FH:2", disposition: "NORMALIZED" })
    ]));
  });

  it("applies native FT/FH price updates, closure and reopening with original period IDs", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const changed = catalog(adapter.decode(envelope({ t: 2, a: true, data: [
      [25403104, 1, 48, 0.93, 0.95], [25403104, 1, 115, 0.87, -0.97]
    ] }, 2)));
    expect(oddEven(changed).map((quote) => [quote.rawOdds, quote.sequence, quote.receivedMonotonicMs]))
      .toEqual([["0.93", 2, 1002], ["0.95", 2, 1002], ["0.87", 2, 1002], ["-0.97", 2, 1002]]);
    const closed = catalog(adapter.decode(envelope({ t: 3, a: true, data: [
      [25403104, 1, 48, -999, 0.95], [25403104, 1, 115, -999, -999]
    ] }, 3)));
    expect(oddEven(closed)).toEqual([]);
    expect(closed.markets.filter((market) => !market.marketType.endsWith("ODD_EVEN")))
      .toEqual(changed.markets.filter((market) => !market.marketType.endsWith("ODD_EVEN")));
    const reopened = catalog(adapter.decode(envelope({ t: 4, a: true, data: [[25403104, 1, 115, 0.9, 0.98]] }, 4)));
    expect(oddEven(reopened).map((quote) => [quote.marketType, quote.rawOdds, quote.providerMarketId])).toEqual([
      ["FH_ODD_EVEN", "0.9", "25403104:native:FH:2"],
      ["FH_ODD_EVEN", "0.98", "25403104:native:FH:2"]
    ]);
  });

  it("retains MR prices as unproven and refuses incomplete or non-Malay native pairs", () => {
    const suspended = owner(); suspended[79] = 1;
    const value = catalog(new CmdHttpCatalogAdapter().decode(envelope(main(suspended), 1)));
    expect(oddEven(value)).toHaveLength(0);
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "MAIN:2",
      disposition: "EXCLUDED", reason: "NATIVE_MR_ODDS_UNPROVEN" }));
    for (const invalidPrice of [-999, 0, null, 2.5]) {
      const row = owner(); row[48] = invalidPrice; row[65] = invalidPrice;
      const invalid = catalog(new CmdHttpCatalogAdapter().decode(envelope(main(row), 1)));
      expect(oddEven(invalid)).toEqual([]);
    }
  });

  it("normalizes packed command 116 prices atomically and rejects a malformed last pair", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const before = catalog(adapter.decode(envelope(main(), 1)));
    const packed = [25403104, 1, 116, 0.81, -0.97, 0.82, -0.96, 0.83, -0.95,
      0.84, -0.94, 0.85, -0.93, 0.86, -0.92];
    const updates = adapter.decode(envelope({ t: 2, a: true, data: [packed] }, 2));
    expect(updates).toHaveLength(1);
    const changed = catalog(updates);
    expect(changed.markets).toEqual(before.markets);
    expect(oddEven(changed).map((quote) => quote.rawOdds)).toEqual(["0.85", "-0.93", "0.86", "-0.92"]);
    expect(changed.quotes.find((quote) => quote.marketType === "FT_TOTAL" && quote.selection === "OVER")?.rawOdds)
      .toBe("0.83");
    expect(adapter.decode(envelope({ t: 3, a: true, data: [[...packed.slice(0, 14), "bad"]] }, 3))).toEqual([]);
    const closed = [...packed]; closed[11] = -999; closed[12] = -999;
    const next = catalog(adapter.decode(envelope({ t: 3, a: true, data: [closed] }, 4)));
    expect(oddEven(next).map((quote) => quote.marketType)).toEqual(["FH_ODD_EVEN", "FH_ODD_EVEN"]);
  });
});
