import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import { cmdNativeMalayPrice } from "./cmd-more-native.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cmd-more-native-20260908.json", import.meta.url), "utf8"));
const group = fixture.body.d[0];
const main = (row = fixture.owner, t = 1) => ({ t, a: true, data: [], today: [row], f: [] });
function envelope(body: unknown, sequence: number, more = false, overrides = {}): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "cmd-native:1", sequence, observedAtMs: fixture.observedAtMs + sequence,
    receivedMonotonicMs: 1000 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: more
      ? "/Member/BetsView/BetLight/DataOdds.asmx/GetAllOdds" : "/Member/BetsView/BetLight/DataOdds.ashx",
      method: more ? "POST" : "GET", resourceType: "XHR", ...(more
        ? { providerGroupId: group } : { providerFunctionCode: 1, cmdFullScope: true }),
      observerRequestId: `cmd-observer:request:${sequence}`, requestFrameKey: "cmd-frame",
      requestDocumentKey: "cmd-document", reconcileCutoffSequence: sequence - 1, ...overrides },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}
const catalog = (updates: ReturnType<CmdHttpCatalogAdapter["decode"]>) => updates.at(-1)?.value as ObservedProviderCatalog;
const moreQuotes = (value: ObservedProviderCatalog) => value.quotes.filter(q => q.providerMarketId.includes(":more:"));

describe("CMD authenticated native More", () => {
  it("coalesces a burst without losing other groups or a final closure before the next main flush", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const secondGroup = "00000000-0000-0000-0000-000000000001";
    const second = [...fixture.owner]; second[0] = 25403105; second[34] = secondGroup; second[38] = "Second home";
    const roster = { ...main(), today: [fixture.owner, second] };
    adapter.decode(envelope(roster, 1));
    expect(adapter.decode(envelope(fixture.body, 2, true))).toHaveLength(1);
    const secondMore = structuredClone(fixture.body); secondMore.d[0] = secondGroup; secondMore.d[1] = second[0];
    expect(adapter.decode(envelope(secondMore, 3, true, { providerGroupId: secondGroup }))).toHaveLength(0);
    const closed = structuredClone(fixture.body); closed.d[2][0] = [-999, -999];
    expect(adapter.decode(envelope(closed, 4, true))).toHaveLength(0);
    const value = catalog(adapter.decode(envelope({ ...roster, t: 2 }, 5)));
    const quotes = moreQuotes(value);
    expect(quotes).toHaveLength(2);
    expect(quotes.every(quote => quote.providerEventId === "25403105" && quote.sequence === 3 && quote.receivedMonotonicMs === 1003)).toBe(true);
    expect(value.nativeMarketObservations!.filter(row => row.nativeType.startsWith("MORE:"))).toHaveLength(38);
    expect(value.nativeMarketObservations!.find(row => row.providerEventId === "25403104" && row.nativeType === "MORE:FT:0"))
      .toMatchObject({ reason: "NATIVE_MARKET_CLOSED", observedAtMs: fixture.observedAtMs + 4 });
  });

  it("matches the saved public MY/A converter for both signs and MY+MR boundary crossings", () => {
    const native = runInNewContext(`${fixture.oddsConversion.closure.body}; OddsUtil`);
    for (const raw of [0.97, 0.91, -0.97, 1.09, -1.09, 1, -1, 0.005, -0.005, -999, 0]) {
      for (const isHome of [true, false]) {
        const converted = native.convertOdds(raw, { ...fixture.oddsConversion.params, isHome });
        const rendered = Number(Number(converted).toFixed(2));
        expect(cmdNativeMalayPrice(raw), `${raw}/${isHome}`).toBe(converted === -999 || rendered === 0
          ? null : String(rendered));
      }
    }
  });

  it("publishes actual FT Odd/Even and inventories every native FT/FH leaf array", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const update = adapter.decode(envelope(fixture.body, 2, true));
    expect(update).toHaveLength(1);
    expect(update[0]).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP" });
    const value = catalog(update);
    expect(moreQuotes(value)).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketType: "FT_ODD_EVEN", selection: "ODD", line: null, rawOdds: "0.97", rawFormat: "MALAY", providerSelectionId: "25403104:Odd:Home:0:0" }),
      expect.objectContaining({ marketType: "FT_ODD_EVEN", selection: "EVEN", line: null, rawOdds: "0.91", rawFormat: "MALAY", providerSelectionId: "25403104:Even:Away:0:0" })
    ]));
    const inventory = value.nativeMarketObservations!.filter(o => o.nativeType.startsWith("MORE:"));
    expect(inventory).toHaveLength(19);
    expect(inventory.find(o => o.nativeType === "MORE:FH:0")).toMatchObject({ disposition: "EXCLUDED", reason: "NATIVE_MARKET_CLOSED" });
    expect(inventory.find(o => o.nativeType === "MORE:FT:1")).toMatchObject({ disposition: "EXCLUDED", reason: "THREE_WAY_OUTCOME_DOMAIN" });
    expect(inventory.find(o => o.nativeType === "MORE:FT:8.3")).toMatchObject({ disposition: "UNMAPPED" });
  });

  it("retains More prices and genuine clocks through a shallow main refresh", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const before = moreQuotes(catalog(adapter.decode(envelope(fixture.body, 2, true))));
    expect(before).toHaveLength(2);
    const after = catalog(adapter.decode(envelope(main(fixture.owner, 2), 3)));
    expect(moreQuotes(after)).toEqual(before);
  });

  it("uses native first-half click identity and the same converted signed price format", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const body = structuredClone(fixture.body); body.d[3][0] = [1.09, -1.09];
    const value = catalog(adapter.decode(envelope(body, 2, true)));
    expect(moreQuotes(value).filter(q => q.marketType === "FH_ODD_EVEN")).toEqual([
      expect.objectContaining({ scope: "FIRST_HALF", line: null, selection: "ODD", rawOdds: "-0.91", providerSelectionId: "100025403104:Odd:Home:0:1" }),
      expect.objectContaining({ scope: "FIRST_HALF", line: null, selection: "EVEN", rawOdds: "0.91", providerSelectionId: "100025403104:Even:Away:0:1" })
    ]);
  });

  it("retains native main market inventory even when no line-market quote can be normalized", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const row = [...fixture.owner]; row[40] = -999; row[41] = -999;
    const value = catalog(adapter.decode(envelope(main(row), 1)));
    expect(value.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ nativeType: "1", disposition: "EXCLUDED", reason: "INVALID_TWO_WAY_SHAPE" }),
      expect.objectContaining({ nativeType: "MAIN:2", disposition: "UNMAPPED" }),
      expect.objectContaining({ nativeType: "FH:2", disposition: "UNMAPPED" })
    ]));
  });

  it("binds group, owner, source document, cutoff and exact POST request", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    for (const changes of [{ providerGroupId: "00000000-0000-0000-0000-000000000000" },
      { requestDocumentKey: "old-doc" }, { requestFrameKey: "other-frame" },
      { reconcileCutoffSequence: undefined }, { method: "GET" }]) {
      expect(adapter.decode(envelope(fixture.body, 2, true, changes))).toEqual([]);
    }
    const foreign = structuredClone(fixture.body); foreign.d[1] = 999;
    expect(adapter.decode(envelope(foreign, 2, true))).toEqual([]);
  });

  it("replaces only More's own markets, withdraws closed pairs, and refuses late responses", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const original = catalog(adapter.decode(envelope(main(), 1)));
    adapter.decode(envelope(fixture.body, 2, true));
    const closed = structuredClone(fixture.body); closed.d[2][0] = [-999, 0.91];
    const value = catalog(adapter.decode({ ...envelope(closed, 3, true), observedAtMs: fixture.observedAtMs + 1002 }));
    expect(moreQuotes(value)).toEqual([]);
    expect(value.markets).toEqual(original.markets);
    expect(adapter.decode(envelope(fixture.body, 4, true, { observerRequestId: "cmd-observer:request:2" }))).toEqual([]);
  });

  it("cancels the previous owner's More domain after group changes or an epoch reset", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    adapter.decode(envelope(fixture.body, 2, true));
    const nextOwner = [...fixture.owner]; nextOwner[34] = "00000000-0000-0000-0000-000000000000";
    expect(moreQuotes(catalog(adapter.decode(envelope(main(nextOwner, 2), 3))))).toEqual([]);
    expect(adapter.decode(envelope(fixture.body, 4, true))).toEqual([]);
    adapter.resetSource("chrome:CMD:9");
    expect(adapter.decode(envelope(fixture.body, 5, true))).toEqual([]);
  });
});
