import { describe, expect, it } from "vitest";
import { normalizeSabaFootballRecords } from "./saba-football-normalizer.js";

const options = { observedAtMs: 1_786_449_540_000, receivedMonotonicMs: 40, sequence: 3 };

describe("normalizeSabaFootballRecords", () => {
  it("maps a real SABA half-goal handicap using exact provider identities", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 150749, leaguenameen: "AFC Challenge League", sporttype: 1 },
      { type: "m", matchid: 132440177, leagueid: 150749, hteamnameen: "Paro FC", ateamnameen: "Abu Muslim FC",
        kickofftime: 1_786_449_540, eventstatus: "running", marketid: "T", sporttype: 1 },
      { type: "o", oddsid: 1047364844, matchid: 132440177, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: -0.88, odds2a: 0.72, hdp1: 0, hdp2: 0.5 }
    ], options);

    expect(normalized.events).toEqual([expect.objectContaining({
      providerEventId: "132440177", participantA: "Paro FC", participantB: "Abu Muslim FC", isLive: false
    })]);
    expect(normalized.markets).toEqual([expect.objectContaining({
      providerMarketId: "1047364844", marketType: "FT_AH", line: "0.5", status: "OPEN"
    })]);
    expect(normalized.quotes.map((quote) => [quote.selection, quote.rawOdds, quote.line])).toEqual([
      ["HOME", "-0.88", "0.5"], ["AWAY", "0.72", "0.5"]
    ]);
  });

  it("uses a negative canonical home line when hdp1 carries the handicap", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }
    ], options);
    expect(normalized.events[0]).toMatchObject({ isLive: true });
    expect(normalized.markets[0]).toMatchObject({ line: "-0.5" });
  });

  it("maps a real SABA full-time half-goal total as exact OVER and UNDER", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 150746, leaguenameen: "AFC Champions League Two Qualifiers", sporttype: 1 },
      { type: "m", matchid: 132130281, leagueid: 150746, hteamnameen: "East Bengal FC",
        ateamnameen: "Al Arabi", kickofftime: 1_786_545_340, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 1044675909, matchid: 132130281, bettype: 3, parenttypeid: 3,
        oddsstatus: "running", enable: 1, odds1a: -0.63, odds2a: 0.45, hdp1: 1.5, hdp2: 0 }
    ], options);

    expect(normalized.markets).toEqual([expect.objectContaining({
      providerMarketId: "1044675909", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "1.5", status: "OPEN"
    })]);
    expect(normalized.quotes.map((quote) => [quote.selection, quote.rawOdds, quote.line])).toEqual([
      ["OVER", "-0.63", "1.5"], ["UNDER", "0.45", "1.5"]
    ]);
  });

  it("normalizes exact first-half handicap and total groups", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 7, matchid: 2, bettype: 7, parenttypeid: 7,
        oddsstatus: "running", enable: 1, odds1a: 0.82, odds2a: -0.96, hdp1: 0, hdp2: 0.5 },
      { type: "o", oddsid: 8, matchid: 2, bettype: 8, parenttypeid: 8,
        oddsstatus: "running", enable: 1, odds1a: -0.74, odds2a: 0.62, hdp1: 1.5, hdp2: 0 }
    ], options);

    expect(normalized.markets.map(({ marketType, scope, line }) => ({ marketType, scope, line }))).toEqual([
      { marketType: "FH_AH", scope: "FIRST_HALF", line: "0.5" },
      { marketType: "FH_TOTAL", scope: "FIRST_HALF", line: "1.5" }
    ]);
    expect(normalized.quotes.map(({ marketType, scope, selection }) => ({ marketType, scope, selection }))).toEqual([
      { marketType: "FH_AH", scope: "FIRST_HALF", selection: "HOME" },
      { marketType: "FH_AH", scope: "FIRST_HALF", selection: "AWAY" },
      { marketType: "FH_TOTAL", scope: "FIRST_HALF", selection: "OVER" },
      { marketType: "FH_TOTAL", scope: "FIRST_HALF", selection: "UNDER" }
    ]);
  });

  it("accepts quarter totals and rejects integer or structurally inconsistent totals", () => {
    const base = { type: "o", matchid: 2, bettype: 3, parenttypeid: 3,
      oddsstatus: "running", enable: 1, odds1a: 0.9, odds2a: -0.9, hdp2: 0 };
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { ...base, oddsid: 3, hdp1: 2.25 },
      { ...base, oddsid: 4, hdp1: 2 },
      { ...base, oddsid: 5, hdp1: 2.5, hdp2: 0.5 },
      { ...base, oddsid: 6, hdp1: 2.5, parenttypeid: 8 }
    ], options);

    expect(normalized.markets).toEqual([expect.objectContaining({ marketType: "FT_TOTAL", line: "2.25" })]);
    expect(normalized.quotes).toHaveLength(2);
  });

  it("accepts quarter handicap but rejects three-way markets, invalid prices and non-football matches", () => {
    const base = { type: "o", matchid: 2, parenttypeid: 1, oddsstatus: "running", odds1a: 0.9, odds2a: -0.9 };
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "T", sporttype: 1 },
      { ...base, oddsid: 3, bettype: 1, hdp1: 0.25, hdp2: 0 },
      { ...base, oddsid: 4, bettype: 5, hdp1: 0, hdp2: 0.5 },
      { ...base, oddsid: 5, bettype: 1, hdp1: 0, hdp2: 0.5, odds1a: 0 },
      { type: "m", matchid: 6, leagueid: 1, hteamnameen: "X", ateamnameen: "Y",
        kickofftime: 10, marketid: "T", sporttype: 43 }
    ], options);
    expect(normalized.events).toHaveLength(1);
    expect(normalized.markets).toEqual([expect.objectContaining({ marketType: "FT_AH", line: "-0.25" })]);
    expect(normalized.diagnostics).toContain("SABA_FOOTBALL_MARKET_REJECTED");
  });

  it("excludes virtual and separately settled extra-time events", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "SABA CLUB FRIENDLY Virtual PES 21", sporttype: 1 },
      { type: "l", leagueid: 2, leaguenameen: "Australia Cup", sporttype: 1 },
      { type: "m", matchid: 3, leagueid: 1, hteamnameen: "A (V)", ateamnameen: "B (V)",
        kickofftime: 10, marketid: "T", sporttype: 1 },
      { type: "m", matchid: 4, leagueid: 2, hteamnameen: "A (ET)", ateamnameen: "B (ET)",
        kickofftime: 10, marketid: "L", sporttype: 1 }
    ], options);
    expect(normalized.events).toEqual([]);
    expect(normalized.diagnostics).toEqual([
      "SABA_FOOTBALL_EVENT_UNSUPPORTED", "SABA_FOOTBALL_EVENT_UNSUPPORTED"
    ]);
  });

  it("keeps full-time and first-half quarter or three-quarter two-way lines", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 10, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.82, odds2a: -0.96, hdp1: 0.25, hdp2: 0 },
      { type: "o", oddsid: 11, matchid: 2, bettype: 3, parenttypeid: 3,
        oddsstatus: "running", enable: 1, odds1a: -0.74, odds2a: 0.62, hdp1: 2.75, hdp2: 0 },
      { type: "o", oddsid: 12, matchid: 2, bettype: 7, parenttypeid: 7,
        oddsstatus: "running", enable: 1, odds1a: 0.72, odds2a: -0.88, hdp1: 0, hdp2: 0.5 }
    ], options);

    expect(normalized.markets.map(({ marketType, scope, line }) => ({ marketType, scope, line }))).toEqual([
      { marketType: "FT_AH", scope: "FULL_TIME", line: "-0.25" },
      { marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.75" },
      { marketType: "FH_AH", scope: "FIRST_HALF", line: "0.5" }
    ]);
  });
});
