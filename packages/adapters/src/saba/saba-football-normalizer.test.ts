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

  it("rejects quarter lines, three-way markets, invalid prices and non-football matches", () => {
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
    expect(normalized.markets).toEqual([]);
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
});
