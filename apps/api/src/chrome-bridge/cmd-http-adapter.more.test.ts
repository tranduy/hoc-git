import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import { cmdNativeMalayPrice } from "./cmd-more-native.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";

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
const moreQuotes = (value: ObservedProviderCatalog) => value.quotes.filter(q => q.providerMarketId.includes(":more:") && q.marketType.endsWith("ODD_EVEN"));

describe("CMD authenticated native More", () => {
  it.each([["ET", "EXTRA_TIME"], ["PEN", "PENALTY_SHOOTOUT"]])(
    "retains HTTP main and More native offers for %s without regulation contracts", (suffix, eventScope) => {
      const owner = [...fixture.owner];
      owner[38] = `AC Nagano Parceiro (${suffix})`; owner[39] = `Mito Hollyhock (${suffix})`;
      const adapter = new CmdHttpCatalogAdapter();
      const baseline = catalog(adapter.decode(envelope(main(owner), 1)));
      expect(baseline.events[0]).toMatchObject({ eventScope, participantA: owner[38], participantB: owner[39] });
      expect(baseline.markets).toEqual([]);
      expect(baseline.quotes).toEqual([]);
      const value = catalog(adapter.decode(envelope(fixture.body, 2, true)));
      expect(value.events[0]?.eventScope).toBe(eventScope);
      expect(value.markets).toEqual([]);
      expect(value.quotes).toEqual([]);
      expect(value.nativeMarketObservations!.length).toBeGreaterThan(19);
      expect(value.nativeMarketObservations!.every(observation => observation.disposition === "EXCLUDED" &&
        observation.reason === "EVENT_PERIOD_SETTLEMENT_UNSUPPORTED")).toBe(true);
      expect(value.nativeMarketObservations!.find(observation => observation.nativeType === "MORE:FT:1"))
        .toMatchObject({ nativeLabel: "[2.92,3.47,2.21]", nativeSelections: [
          expect.objectContaining({ price: "2.92", rawFormat: "DECIMAL", status: "OPEN" }),
          expect.objectContaining({ price: "3.47", rawFormat: "DECIMAL", status: "OPEN" }),
          expect.objectContaining({ price: "2.21", rawFormat: "DECIMAL", status: "OPEN" })] });
    });

  it("normalizes saved FT/FH result prices with separate native More offer identities", () => {
    const adapter = new CmdHttpCatalogAdapter(); adapter.decode(envelope(main(), 1));
    const value = catalog(adapter.decode(envelope(fixture.body, 2, true)));
    expect(value.quotes.filter(q => q.providerMarketId.includes(":more:") && q.marketType.endsWith("_1X2"))
      .map(q => [q.providerMarketId, q.marketType, q.selection, q.rawOdds, q.rawFormat, q.status, q.providerSelectionId])).toEqual([
      ["25403104:more:FT:1X2", "FT_1X2", "HOME", "2.92", "DECIMAL", "OPEN", "25403104:One:Home:0:0"],
      ["25403104:more:FT:1X2", "FT_1X2", "DRAW", "3.47", "DECIMAL", "OPEN", "25403104:X:Home:0:0"],
      ["25403104:more:FT:1X2", "FT_1X2", "AWAY", "2.21", "DECIMAL", "OPEN", "25403104:Two:Away:0:0"],
      ["25403104:more:FH:1X2", "FH_1X2", "HOME", "3.43", "DECIMAL", "OPEN", "100025403104:One:Home:0:1"],
      ["25403104:more:FH:1X2", "FH_1X2", "DRAW", "2.34", "DECIMAL", "OPEN", "100025403104:X:Home:0:1"],
      ["25403104:more:FH:1X2", "FH_1X2", "AWAY", "2.61", "DECIMAL", "OPEN", "100025403104:Two:Away:0:1"]
    ]);
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "MORE:FH:1",
      disposition: "NORMALIZED", outcomeLabels: ["HOME", "DRAW", "AWAY"], nativeSelections: [
        expect.objectContaining({ selectionId: "100025403104:One:Home:0:1", price: "3.43", rawFormat: "DECIMAL", status: "OPEN" }),
        expect.objectContaining({ selectionId: "100025403104:X:Home:0:1", price: "2.34", rawFormat: "DECIMAL", status: "OPEN" }),
        expect.objectContaining({ selectionId: "100025403104:Two:Away:0:1", price: "2.61", rawFormat: "DECIMAL", status: "OPEN" })
      ] }));
  });

  it("withdraws only closed More result legs and keeps their native prices for both periods", () => {
    const adapter = new CmdHttpCatalogAdapter(); adapter.decode(envelope(main(), 1));
    adapter.decode(envelope(fixture.body, 2, true));
    const body = structuredClone(fixture.body); body.d[2][1] = [-999, 3.47, 0]; body.d[3][1] = [3.43, -999, 2.61];
    const value = catalog(adapter.decode({ ...envelope(body, 3, true), observedAtMs: fixture.observedAtMs + 1002 }));
    expect(value.quotes.filter(q => q.providerMarketId.includes(":more:") && q.marketType.endsWith("_1X2"))
      .map(q => [q.marketType, q.selection])).toEqual([["FT_1X2", "DRAW"], ["FH_1X2", "HOME"], ["FH_1X2", "AWAY"]]);
    expect(value.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:1")!.nativeSelections)
      .toEqual([expect.objectContaining({ price: "-999", status: "CLOSED" }), expect.objectContaining({ price: "3.47", status: "OPEN" }),
        expect.objectContaining({ price: "0", status: "CLOSED" })]);
  });

  it("normalizes saved FT Double Chance with decimal prices and native click identities", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(main(), 1));
    const value = catalog(adapter.decode(envelope(fixture.body, 2, true)));
    expect(value.quotes.filter(q => q.marketType === "FT_DOUBLE_CHANCE").map(q =>
      [q.selection, q.rawOdds, q.rawFormat, q.status, q.providerSelectionId])).toEqual([
      ["HOME_DRAW", "1.57", "DECIMAL", "OPEN", "25403104:OneX:Home:0:0"],
      ["HOME_AWAY", "1.27", "DECIMAL", "OPEN", "25403104:OneTwo:Home:0:0"],
      ["DRAW_AWAY", "1.35", "DECIMAL", "OPEN", "25403104:XTwo:Away:0:0"]
    ]);
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "MORE:FT:2",
      disposition: "NORMALIZED", outcomeLabels: ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"],
      nativeSelections: expect.arrayContaining([expect.objectContaining({ selectionId: "25403104:OneX:Home:0:0", price: "1.57", rawFormat: "DECIMAL", status: "OPEN" })]) }));
  });

  it("keeps independently valid More DC legs and retains closed or malformed raw prices", () => {
    for (const prices of [[-999, 1.27, 0], [-999, -999, -999], [1.57, 1.27]]) {
      const adapter = new CmdHttpCatalogAdapter(); adapter.decode(envelope(main(), 1));
      const body = structuredClone(fixture.body); body.d[2][2] = prices;
      const value = catalog(adapter.decode(envelope(body, 2, true)));
      expect(value.quotes.filter(q => q.marketType === "FT_DOUBLE_CHANCE").map(q => q.selection))
        .toEqual(prices.length === 3 && prices[1] === 1.27 ? ["HOME_AWAY"] : []);
      const observation = value.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:2")!;
      expect(observation.nativeSelections!.map(s => s.price)).toEqual(prices.map(String));
      expect(observation.nativeLabel).toBe(JSON.stringify(prices));
    }
  });

  it("respects the native More sanitizer that closes a DC row for a positive sub-1 decimal", () => {
    const adapter = new CmdHttpCatalogAdapter(); adapter.decode(envelope(main(), 1));
    const body = structuredClone(fixture.body); body.d[2][2] = [0.99, 1.27, 1.35];
    const value = catalog(adapter.decode(envelope(body, 2, true)));
    expect(value.quotes.filter(q => q.marketType === "FT_DOUBLE_CHANCE")).toEqual([]);
    expect(value.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:2"))
      .toMatchObject({ disposition: "EXCLUDED", reason: "NATIVE_MARKET_CLOSED", status: "CLOSED",
        nativeSelections: [expect.objectContaining({ price: "0.99", status: "CLOSED" }),
          expect.objectContaining({ price: "1.27", status: "CLOSED" }), expect.objectContaining({ price: "1.35", status: "CLOSED" })] });
  });

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
    expect(inventory.find(o => o.nativeType === "MORE:FT:1")).toMatchObject({ disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" });
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

  it("renews the CMD feed after an incremental cursor without refreshing retained More quotes or replay clocks", async () => {
    const accountId = "catalog-source:CMD:FOOTBALL";
    let now = fixture.observedAtMs + 1;
    const feeds = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: feeds });
    expect(plane.ingest(envelope(main(fixture.owner, 100), 1))).toBe(true);
    now += 1;
    expect(plane.ingest(envelope(fixture.body, 2, true))).toBe(true);
    const before = await plane.read(accountId) as ObservedProviderCatalog;
    expect(moreQuotes(before)).toHaveLength(2);

    now += providerFeedPolicies.get(accountId)!.maxBaselineAgeMs + 1;
    await expect(plane.read(accountId)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    const delta = envelope({ t: 101, a: true, data: [] }, 3, false, { providerFunctionCode: 3 });
    expect(plane.ingest({ ...delta, observedAtMs: now })).toBe(false);
    const replay = envelope(main(fixture.owner, 101), 4, false, { replayed: true });
    expect(plane.ingest(replay)).toBe(false);
    await expect(plane.read(accountId)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    now += 1;
    const fresh = { ...envelope(main(fixture.owner, 101), 5), observedAtMs: now };
    expect(plane.ingest(fresh)).toBe(true);
    const after = await plane.read(accountId) as ObservedProviderCatalog;
    expect(after.observedAtMs).toBe(now);
    expect(moreQuotes(after)).toEqual(moreQuotes(before));
    expect(after.nativeMarketObservations!.filter(row => row.nativeType.startsWith("MORE:")))
      .toEqual(before.nativeMarketObservations!.filter(row => row.nativeType.startsWith("MORE:")));
    expect(feeds.snapshot(accountId)).toMatchObject({ state: "LIVE", activeGeneration: "cmd:101:observation:5" });
    expect(plane.ingest({ ...fresh, sequence: 6 })).toBe(false);
    expect((await plane.read(accountId) as ObservedProviderCatalog).observedAtMs).toBe(now);
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
      expect.objectContaining({ nativeType: "MAIN:2", disposition: "NORMALIZED" }),
      expect.objectContaining({ nativeType: "FH:2", disposition: "EXCLUDED", reason: "INVALID_TWO_WAY_SHAPE" })
    ]));
    expect(value.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "25403104:native:MAIN:2", marketType: "FT_ODD_EVEN" })
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
    expect(value.markets.filter(m => !m.providerMarketId.includes(":more:"))).toEqual(original.markets);
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
