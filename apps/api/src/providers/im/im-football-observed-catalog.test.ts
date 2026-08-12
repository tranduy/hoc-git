import { describe, expect, it } from "vitest";
import { ImFootballObservedCatalogReader } from "./im-football-observed-catalog.js";

describe("ImFootballObservedCatalogReader", () => {
  it("publishes the exact IM Football identity with provider event, market and selection ids", async () => {
    const reader = new ImFootballObservedCatalogReader({ source: { readCatalogFromFabet: async () => ({
      observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 20,
      records: [{ eventId: "20", leagueName: "League", timeText: "PREMATCH", scoreText: null,
        startAtUtcMs: 1_788_000_100_000, teamNames: ["Home", "Away"], markets: [{ marketId: "30",
          marketType: "FT_AH", lineText: null, selections: [
            { selectionId: "31", selection: "HOME", priceText: "0.8", locked: false, lineText: "+0.5" },
            { selectionId: "32", selection: "AWAY", priceText: "-0.9", locked: false, lineText: "-0.5" }
          ] }] }]
    }) } });

    const result = await reader.read("catalog-source:IM:FOOTBALL");

    expect(result).toMatchObject({ accountId: "catalog-source:IM:FOOTBALL", provider: "IM", category: "FOOTBALL",
      observedAtMs: 1_788_000_000_000, rejectedMarketCount: 0 });
    expect(result.events[0]).toMatchObject({ providerEventId: "20", participantA: "Home", participantB: "Away" });
    expect(result.markets[0]).toMatchObject({ providerMarketId: "30", marketType: "FT_AH", line: "0.5" });
    expect(result.quotes.map((quote) => [quote.providerSelectionId, quote.selection, quote.sequence]))
      .toEqual([["31", "HOME", 1], ["32", "AWAY", 1]]);
  });
});
