import type { BtiEsportsMarketRecord } from "@tool-chenh/adapters";
import { describe, expect, it } from "vitest";
import { BtiEsportsObservedCatalogReader } from "./bti-esports-observed-catalog.js";

const record: BtiEsportsMarketRecord = {
  sportId: "64", sportCode: "LOL", leagueId: "league", leagueName: "League of Legends NACL Summer",
  eventId: "event", startAt: "2026-08-12T21:00:00.000Z", isLive: true, eventSuspended: false,
  participantA: "Ole Miss Esports", participantB: "Cupid eSports", marketId: "market", marketCode: "ML39",
  marketName: "Live Team/Player to Win", marketIsLive: true, marketSuspended: false,
  selections: [
    { id: "home", side: 1, name: "Ole Miss Esports", decimal: "4.16", locked: false },
    { id: "away", side: 3, name: "Cupid eSports", decimal: "1.21", locked: false }
  ]
};

describe("BtiEsportsObservedCatalogReader", () => {
  it("publishes only the verified BTI LoL series winner catalog", async () => {
    const reader = new BtiEsportsObservedCatalogReader({ source: { readCatalogFromFabet: async () => ({
      records: [record], observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 10
    }) } });

    const result = await reader.read("catalog-source:BTI:LOL");

    expect(result).toMatchObject({ accountId: "catalog-source:BTI:LOL", provider: "BTI", category: "LOL",
      observedAtMs: 1_788_000_000_000, rejectedMarketCount: 0 });
    expect(result.events).toHaveLength(1);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "SERIES_WINNER", scope: "SERIES" })]);
    expect(result.quotes.map((quote) => quote.providerSelectionId)).toEqual(["home", "away"]);
  });

  it("publishes a successful empty LoL catalog when sport 64 currently contains only another game", async () => {
    const reader = new BtiEsportsObservedCatalogReader({ source: { readCatalogFromFabet: async () => ({
      records: [{ ...record, sportCode: "CS2" }], observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 10
    }) } });

    await expect(reader.read("catalog-source:BTI:LOL")).resolves.toMatchObject({
      dataMode: "LIVE", events: [], markets: [], quotes: [], rejectedMarketCount: 1
    });
  });
});
