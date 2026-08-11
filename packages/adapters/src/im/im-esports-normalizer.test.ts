import { describe, expect, it } from "vitest";
import { normalizeImLolRecords, type ImEsportsMarketRecord } from "./im-esports-normalizer.js";

const record = (overrides: Partial<ImEsportsMarketRecord> = {}): ImEsportsMarketRecord => ({
  sportId: 45, sportName: "League of Legends", leagueId: 1, leagueName: "LCK",
  parentMatchNo: 10, parentHomeId: 1, parentHomeName: "Team A", parentAwayId: 2,
  parentAwayName: "Team B", parentDate: "2026-08-11T04:00:00-04:00", matchNo: 11,
  gameTypeCode: "SeriesWin", gameTypeName: "BO3 Series Winner", marketGroup: "", gameOrder: 0,
  status: 1, isLive: false, matchDate: "2026-08-11T04:00:00-04:00", selections: [
    { code: 1, name: "{TeamA}", odds: 1.8, handicap: 0, locked: false },
    { code: 2, name: "{TeamB}", odds: 2.1, handicap: 0, locked: false }
  ], ...overrides
});

describe("normalizeImLolRecords", () => {
  it("normalizes exact LoL series winner evidence", () => {
    const result = normalizeImLolRecords([record()], { receivedMonotonicMs: 5, sequence: 1 });
    expect(result.events).toEqual([expect.objectContaining({ provider: "IM", category: "LOL",
      participantA: "Team A", participantB: "Team B", bestOf: 3 })]);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "SERIES_WINNER", scope: "SERIES", status: "OPEN" })]);
    expect(result.quotes.map((quote) => [quote.selection, quote.rawOdds, quote.rawFormat]))
      .toEqual([["TEAM_A", "1.8", "DECIMAL"], ["TEAM_B", "2.1", "DECIMAL"]]);
  });

  it("rejects other games, map markets, malformed odds, and duplicate markets", () => {
    const result = normalizeImLolRecords([
      record({ sportId: 65 }), record({ gameTypeCode: "LiveBall" }),
      record({ selections: [{ code: 1, name: "a", odds: 1, handicap: 0, locked: false }] }),
      record(), record()
    ], { receivedMonotonicMs: 5, sequence: 1 });
    expect(result.events).toHaveLength(1);
    expect(result.markets).toHaveLength(1);
    expect(result.diagnostics).toContain("IM_ESPORTS_MARKET_REJECTED");
  });

  it("suspends a locked market", () => {
    const result = normalizeImLolRecords([record({ selections: [
      { code: 1, name: "a", odds: 1.8, handicap: 0, locked: true },
      { code: 2, name: "b", odds: 2.1, handicap: 0, locked: false }
    ] })], { receivedMonotonicMs: 5, sequence: 1 });
    expect(result.markets[0]?.status).toBe("SUSPENDED");
    expect(result.quotes.every((quote) => quote.status === "SUSPENDED")).toBe(true);
  });
});
