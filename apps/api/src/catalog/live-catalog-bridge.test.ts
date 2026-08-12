import { describe, expect, it } from "vitest";
import type { ProviderQuoteUpdate, ProviderSink } from "@tool-chenh/adapters";
import type { ProviderConnectionStatus, ProviderEvent, ProviderMarket } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { LiveCatalogBridge } from "./live-catalog-bridge.js";
import { Runtime } from "../runtime.js";

function catalog(provider: "SABA" | "SBOBET" = "SABA"): ObservedProviderCatalog {
  const event = {
    provider, category: "FOOTBALL", providerEventId: `${provider}-event`, competition: "League",
    seasonStage: "Round 1", startAtUtcMs: 1_000, participantA: "Alpha", participantB: "Beta",
    isLive: true, eventScope: "REGULATION", bestOf: null, rematchCandidate: false,
    fixtureDiscriminator: null,
    liveState: { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 60_000 },
    isVirtual: false, sportVariant: "FOOTBALL"
  } as const;
  const market = {
    provider, category: "FOOTBALL", providerEventId: `${provider}-event`, providerMarketId: `${provider}-market`,
    marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5", settlementProfile: "FT_AH_REGULATION",
    status: "OPEN", isLive: true
  } as const;
  const quote = (selection: "HOME" | "AWAY", id: string) => ({
    provider, category: "FOOTBALL" as const, providerEventId: market.providerEventId,
    providerMarketId: market.providerMarketId, marketType: market.marketType, scope: market.scope,
    line: market.line, status: market.status, isLive: true,
    providerSelectionId: id, selection, rawOdds: selection === "HOME" ? "0.9" : "-0.9",
    rawFormat: "MALAY" as const, sourceTimestampMs: null, receivedMonotonicMs: 50, sequence: 7
  });
  return { dataMode: "LIVE", accountId: `${provider}-account`, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 2_000, rejectedMarketCount: 0,
    events: [event], markets: [market], quotes: [quote("HOME", "home"), quote("AWAY", "away")] };
}

describe("LiveCatalogBridge", () => {
  it("publishes a successful catalog as a polling full snapshot without changing provider identities", async () => {
    const events: ProviderEvent[] = []; const markets: ProviderMarket[] = [];
    const updates: ProviderQuoteUpdate[] = []; const statuses: ProviderConnectionStatus[] = [];
    const sink: ProviderSink = { onEvent: (value) => events.push(value), onMarket: (value) => markets.push(value),
      onQuoteUpdate: (value) => updates.push(value), onStatus: (value) => statuses.push(value), onSchemaError: () => undefined };
    const bridge = new LiveCatalogBridge();
    const adapter = bridge.adapters.find((value) => value.id === "SABA-catalog-bridge-FOOTBALL")!;
    await adapter.start(sink, new AbortController().signal);

    bridge.publish(catalog());

    expect(events.map((value) => value.providerEventId)).toEqual(["SABA-event"]);
    expect(markets.map((value) => value.providerMarketId)).toEqual(["SABA-market"]);
    expect(updates).toEqual([expect.objectContaining({
      source: { provider: "SABA", category: "FOOTBALL" }, kind: "FULL_SNAPSHOT", transport: "POLLING",
      sequence: 7, quotes: [expect.objectContaining({ providerSelectionId: "home" }),
        expect.objectContaining({ providerSelectionId: "away" })]
    })]);
    expect(statuses.at(-1)).toMatchObject({ provider: "SABA", category: "FOOTBALL", status: "LIVE",
      updatedAtMs: 2_000 });
  });

  it("fails closed when one market contains mixed or missing sequence evidence", async () => {
    const updates: ProviderQuoteUpdate[] = [];
    const sink: ProviderSink = { onEvent: () => undefined, onMarket: () => undefined,
      onQuoteUpdate: (value) => updates.push(value), onStatus: () => undefined, onSchemaError: () => undefined };
    const bridge = new LiveCatalogBridge();
    await bridge.adapters.find((value) => value.id === "SABA-catalog-bridge-FOOTBALL")!
      .start(sink, new AbortController().signal);
    const source = catalog();
    bridge.publish({ ...source, quotes: source.quotes.map((quote, index) => ({ ...quote, sequence: index + 1 })) });
    expect(updates).toEqual([]);
  });

  it("feeds two real-catalog shapes into backend exact event and market mapping", async () => {
    const bridge = new LiveCatalogBridge();
    const runtime = new Runtime({ adapters: bridge.adapters, mappingPolicy: bridge.mappingPolicy });
    await runtime.start(new AbortController().signal);

    bridge.publish(catalog("SABA"));
    bridge.publish(catalog("SBOBET"));
    const snapshot = runtime.getSnapshot();
    expect(runtime.getDiagnostics()).toEqual([]);

    expect(snapshot.events).toEqual([expect.objectContaining({
      category: "FOOTBALL", participantA: "alpha", participantB: "beta", mappingStatus: "VERIFIED",
      providerEventIds: ["SABA-event", "SBOBET-event"]
    })]);
    expect(snapshot.markets).toEqual([expect.objectContaining({
      marketType: "FT_AH", line: "-0.5", mappingStatus: "VERIFIED",
      providerMarketIds: ["SABA-market", "SBOBET-market"]
    })]);
  });
});
