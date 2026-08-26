import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";

function event(providerEventId: string, overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    provider: "CMD", category: "FOOTBALL", providerEventId,
    competition: "CONCACAF CENTRAL AMERICAN CUP", seasonStage: null,
    startAtUtcMs: 1_000, participantA: "Cartagines", participantB: "CD FAS",
    eventScope: "REGULATION", bestOf: null, isLive: true, rematchCandidate: true,
    fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL",
    liveState: { period: null, scoreHome: null, scoreAway: null, clockMs: null },
    ...overrides
  } as ProviderEvent;
}

function market(providerEventId: string, providerMarketId: string): ProviderMarket {
  return { provider: "CMD", category: "FOOTBALL", providerEventId, providerMarketId,
    marketType: "FT_AH", scope: "FULL_TIME", line: "-0.25", status: "OPEN",
    settlementProfile: "ASIAN_HANDICAP", outcomeDomain: ["HOME", "AWAY"] } as unknown as ProviderMarket;
}

function quote(providerEventId: string, providerMarketId: string, selectionId: string): ProviderQuote {
  return { provider: "CMD", category: "FOOTBALL", providerEventId, providerMarketId,
    providerSelectionId: selectionId, selection: "HOME", rawOdds: "0.95", rawFormat: "MALAY",
    decimalOdds: "1.95", status: "OPEN", isLive: true, observedAtMs: 1_000 } as unknown as ProviderQuote;
}

function part(events: ProviderEvent[], markets: ProviderMarket[], quotes: ProviderQuote[]): NormalizedCatalogPart {
  return { diagnostics: [], events, markets, quotes };
}

describe("mergeObservedCatalogParts", () => {
  it("keeps distinct provider events untouched", () => {
    const catalog = mergeObservedCatalogParts({
      accountId: "catalog-source:CMD:FOOTBALL", provider: "CMD", observedAtMs: 1_000,
      collapseDuplicateEvents: true,
      parts: [part([event("1"), event("2", { participantA: "Other", participantB: "Team" })],
        [market("1", "m1"), market("2", "m2")], [quote("1", "m1", "s1"), quote("2", "m2", "s2")])]
    });

    expect(catalog.events).toHaveLength(2);
    expect(catalog.markets).toHaveLength(2);
  });

  it("collapses one provider's duplicate records for the same live fixture", () => {
    // CMD publishes the same live match under two providerEventIds with its
    // markets split between them. Left separate, the comparison layer treats
    // the fixture as ambiguous and drops it from every cross-book pairing.
    const catalog = mergeObservedCatalogParts({
      accountId: "catalog-source:CMD:FOOTBALL", provider: "CMD", observedAtMs: 1_000,
      collapseDuplicateEvents: true,
      parts: [part([event("25315019"), event("25317161")],
        [market("25315019", "m1"), market("25317161", "m2")],
        [quote("25315019", "m1", "s1"), quote("25317161", "m2", "s2")])]
    });

    expect(catalog.events).toHaveLength(1);
    const canonical = catalog.events[0]!.providerEventId;
    expect(canonical).toBe("25315019");
    expect(catalog.markets.map((entry) => entry.providerEventId)).toEqual([canonical, canonical]);
    expect(catalog.quotes.map((entry) => entry.providerEventId)).toEqual([canonical, canonical]);
    expect(catalog.markets.map((entry) => entry.providerMarketId)).toEqual(["m1", "m2"]);
  });

  it("never collapses records that differ in live phase, scope or competition", () => {
    const catalog = mergeObservedCatalogParts({
      accountId: "catalog-source:CMD:FOOTBALL", provider: "CMD", observedAtMs: 1_000,
      collapseDuplicateEvents: true,
      parts: [part([
        event("a"),
        event("b", { isLive: false }),
        event("c", { eventScope: "EXTRA_TIME" as ProviderEvent["eventScope"] }),
        event("d", { competition: "OTHER CUP" })
      ], [], [])]
    });

    expect(catalog.events).toHaveLength(4);
  });

  it("leaves duplicates alone when collapsing is not requested", () => {
    const catalog = mergeObservedCatalogParts({
      accountId: "catalog-source:SABA:FOOTBALL", provider: "SABA", observedAtMs: 1_000,
      parts: [part([event("25315019"), event("25317161")], [], [])]
    });

    expect(catalog.events).toHaveLength(2);
  });
});
