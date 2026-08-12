import { describe, expect, it } from "vitest";
import { normalizeSabaLolRecords } from "./saba-esports-normalizer.js";

const options = { observedAtMs: 1_800_000_000_000, receivedMonotonicMs: 50, sequence: 7 };

describe("normalizeSabaLolRecords", () => {
  it("emits only exact two-way series and map moneylines", () => {
    const normalized = normalizeSabaLolRecords([
      { type: "l", leagueid: 99, leaguegroupid: 25, leaguenameen: "League of Legends - Test League" },
      { type: "m", matchid: 10, leagueid: 99, hteamnameen: "G2", ateamnameen: "TH", kickofftime: 1_800_000_000,
        eventstatus: "running", marketid: "L", bestofmap: 5 },
      { type: "o", oddsid: "series", matchid: 10, bettype: 20, oddsstatus: "running", odds1a: -0.5, odds2a: 0.4 },
      { type: "o", oddsid: "map-2", matchid: 10, bettype: 9001, resourceid: "02", oddsstatus: "running",
        odds1a: 0.8, odds2a: -0.9 },
      { type: "o", oddsid: "total", matchid: 10, bettype: 3, oddsstatus: "running", odds1a: 0.9, odds2a: 0.9 }
    ], options);

    expect(normalized.events).toEqual([expect.objectContaining({
      participantA: "G2", participantB: "TH", category: "LOL", isLive: true
    })]);
    expect(normalized.markets).toEqual([
      expect.objectContaining({ providerMarketId: "series", marketType: "SERIES_WINNER", scope: "SERIES",
        settlementProfile: "lol-series-winner" }),
      expect.objectContaining({ providerMarketId: "map-2", marketType: "MAP_WINNER", scope: "MAP_2",
        settlementProfile: "lol-map-winner" })
    ]);
    expect(normalized.quotes.map((quote) => [quote.providerMarketId, quote.selection, quote.rawOdds])).toEqual([
      ["series", "TEAM_A", "-0.5"], ["series", "TEAM_B", "0.4"],
      ["map-2", "TEAM_A", "0.8"], ["map-2", "TEAM_B", "-0.9"]
    ]);
  });

  it("fails closed for an unidentifiable match, invalid Malay price, or unknown map number", () => {
    const normalized = normalizeSabaLolRecords([
      { type: "l", leagueid: 99, leaguegroupid: 25, leaguenameen: "League of Legends - Test League" },
      { type: "m", matchid: 10, leagueid: 99, hteamnameen: "Same", ateamnameen: "Same", kickofftime: 1 },
      { type: "o", oddsid: "bad", matchid: 10, bettype: 20, oddsstatus: "running", odds1a: 0, odds2a: 2 },
      { type: "o", oddsid: "map-9", matchid: 10, bettype: 9001, resourceid: "09", oddsstatus: "running",
        odds1a: 0.8, odds2a: -0.9 }
    ], options);
    expect(normalized.events).toEqual([]);
    expect(normalized.markets).toEqual([]);
    expect(normalized.quotes).toEqual([]);
    expect(normalized.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects virtual LoL and non-LoL esports even when their teams resemble LoL teams", () => {
    const normalized = normalizeSabaLolRecords([
      { type: "l", leagueid: 1, leaguegroupid: 151, leaguenameen: "E-Sports PinGoal - LOL Worlds" },
      { type: "l", leagueid: 2, leaguegroupid: 24, leaguenameen: "King of Glory - KPL" },
      { type: "m", matchid: 10, leagueid: 1, hteamnameen: "G2 (PG)", ateamnameen: "TH (PG)", kickofftime: 1 },
      { type: "m", matchid: 11, leagueid: 2, hteamnameen: "Alpha", ateamnameen: "Beta", kickofftime: 1 },
      { type: "o", oddsid: "x", matchid: 10, bettype: 20, oddsstatus: "running", odds1a: 0.8, odds2a: 0.9 }
    ], options);
    expect(normalized.events).toEqual([]);
    expect(normalized.markets).toEqual([]);
  });

  it("does not mistake an open pre-match market for a live event", () => {
    const normalized = normalizeSabaLolRecords([
      { type: "l", leagueid: 99, leaguegroupid: 25, leaguenameen: "League of Legends - Test League" },
      { type: "m", matchid: 10, leagueid: 99, hteamnameen: "G2", ateamnameen: "TH", kickofftime: 1_800_000_000,
        eventstatus: "running", marketid: "T", bestofmap: 5 }
    ], options);
    expect(normalized.events[0]).toMatchObject({ isLive: false, liveState: null });
  });
});
