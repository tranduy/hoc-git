import { describe, expect, it } from "vitest";
import { normalizeBtiLolRecords, type BtiEsportsMarketRecord } from "./bti-esports-normalizer.js";

function record(overrides: Partial<BtiEsportsMarketRecord> = {}): BtiEsportsMarketRecord {
  return {
    sportId: "64", sportCode: "LOL", leagueId: "league-1", leagueName: "League of Legends NACL Summer",
    eventId: "event-1", startAt: "2026-08-12T21:00:00.000Z", isLive: true, eventSuspended: false,
    participantA: "Ole Miss Esports", participantB: "Cupid eSports", marketId: "market-1",
    marketCode: "ML39", marketName: "Live Team/Player to Win", marketIsLive: true, marketSuspended: false,
    selections: [
      { id: "home", side: 1, name: "Ole Miss Esports", decimal: "4.16", locked: false },
      { id: "away", side: 3, name: "Cupid eSports", decimal: "1.21", locked: false }
    ],
    ...overrides
  };
}

describe("normalizeBtiLolRecords", () => {
  it("publishes exact BTI LoL series winner identities and prices", () => {
    const result = normalizeBtiLolRecords([record()], { receivedMonotonicMs: 10, sequence: 4 });

    expect(result.events).toEqual([expect.objectContaining({ provider: "BTI", category: "LOL",
      providerEventId: "event-1", participantA: "Ole Miss Esports", participantB: "Cupid eSports", isLive: true })]);
    expect(result.markets).toEqual([expect.objectContaining({ providerMarketId: "market-1",
      marketType: "SERIES_WINNER", scope: "SERIES", line: null, settlementProfile: "lol-series-winner" })]);
    expect(result.quotes.map((quote) => [quote.providerSelectionId, quote.selection, quote.rawOdds, quote.sequence]))
      .toEqual([["home", "TEAM_A", "4.16", 4], ["away", "TEAM_B", "1.21", 4]]);
  });

  it("fails closed for another esport, non-winner markets and mismatched team identity", () => {
    const result = normalizeBtiLolRecords([
      record({ sportCode: "CS2", eventId: "wrong-game", marketId: "wrong-game-market" }),
      record({ marketCode: "OU39", marketId: "total" }),
      record({ marketId: "wrong-team", selections: [
        { id: "home", side: 1, name: "Another team", decimal: "4.16", locked: false },
        { id: "away", side: 3, name: "Cupid eSports", decimal: "1.21", locked: false }
      ] })
    ], { receivedMonotonicMs: 10, sequence: 1 });

    expect(result.events).toEqual([]);
    expect(result.markets).toEqual([]);
    expect(result.quotes).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });
});
