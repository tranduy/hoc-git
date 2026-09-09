import { describe, expect, it } from "vitest";
import { normalizeSabaFootballRecords } from "./saba-football-normalizer.js";

const options = { observedAtMs: 1_786_449_540_000, receivedMonotonicMs: 40, sequence: 3 };

describe("normalizeSabaFootballRecords", () => {
  it("retains original SABA price fields and lines for a native market awaiting semantic mapping", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 3, matchid: 2, bettype: 777, parenttypeid: 777,
        odds1a: 0.82, odds2a: -0.94, hdp1: 0.5, hdp2: 0, oddsstatus: "running" }
    ], options);
    expect(normalized.markets).toEqual([]);
    expect(normalized.nativeMarketObservations[0]?.nativeSelections).toEqual([
      { selectionId: null, outcomeId: "odds1a", line: "0.5", price: "0.82" },
      { selectionId: null, outcomeId: "odds2a", line: "0", price: "-0.94" }
    ]);
  });
  it("accounts for every native odds row instead of silently dropping unknown SABA bet types", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "Premier League", sporttype: 1 },
      { type: "m", matchid: 10, leagueid: 1, hteamnameen: "Alpha", ateamnameen: "Beta",
        kickofftime: 1_786_449_540, eventstatus: "running", marketid: "T", sporttype: 1 },
      { type: "o", matchid: 10, oddsid: 100, bettype: 1, parenttypeid: 1,
        hdp1: 0.5, hdp2: 0, odds1a: 0.9, odds2a: -0.95, oddsstatus: "running", enable: 1 },
      { type: "o", matchid: 10, oddsid: 999, bettype: 321, parenttypeid: 321,
        odds1a: 0.8, odds2a: -0.9, oddsstatus: "running", enable: 1 }
    ], { observedAtMs: 1_786_000_000_000, receivedMonotonicMs: 5, sequence: 7 });

    expect(normalized.nativeMarketObservations).toEqual([
      expect.objectContaining({ providerMarketId: "100", nativeType: "1", disposition: "NORMALIZED",
        reason: "CANONICAL_MARKET_MAPPED" }),
      expect.objectContaining({ providerMarketId: "999", nativeType: "321", disposition: "UNMAPPED",
        reason: "NATIVE_TYPE_UNMAPPED" })
    ]);
  });
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

  it("maps SABA native bet type 2 as an exact full-time odd/even pair", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 4, matchid: 2, bettype: 2, parenttypeid: 2,
        oddsstatus: "running", enable: 1, odds1a: 0.82, odds2a: -0.94, hdp1: 0, hdp2: 0 }
    ], options);

    expect(normalized.markets).toEqual([expect.objectContaining({
      providerMarketId: "4", marketType: "FT_ODD_EVEN", scope: "FULL_TIME", line: null
    })]);
    expect(normalized.quotes.map(({ selection, line }) => [selection, line])).toEqual([
      ["ODD", null], ["EVEN", null]
    ]);
    expect(normalized.nativeMarketObservations).toEqual([expect.objectContaining({
      nativeType: "2", disposition: "NORMALIZED", outcomeLabels: ["ODD", "EVEN"]
    })]);
  });

  it("splits the proven SABA type 13 clean-sheet fields into home and away yes/no markets", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 133152892, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: Math.floor(options.observedAtMs / 1_000) + 3_600, marketid: "T", sporttype: 1 },
      { type: "o", oddsid: 1054290306, matchid: 133152892, bettype: 13, parenttypeid: 13,
        oddsstatus: "running", enable: 1, cs10: 1.36, cs11: 2.72, cs20: 1.22, cs21: 3.60 }
    ], options);

    expect(normalized.markets).toEqual([
      expect.objectContaining({ providerMarketId: "1054290306:home-clean-sheet",
        marketType: "HOME_FT_CLEAN_SHEET", scope: "FULL_TIME", line: null,
        settlementProfile: "football-home-clean-sheet", status: "OPEN" }),
      expect.objectContaining({ providerMarketId: "1054290306:away-clean-sheet",
        marketType: "AWAY_FT_CLEAN_SHEET", scope: "FULL_TIME", line: null,
        settlementProfile: "football-away-clean-sheet", status: "OPEN" })
    ]);
    expect(normalized.quotes.map(({ providerMarketId, providerSelectionId, marketType, selection,
      rawOdds, rawFormat, status, isLive, receivedMonotonicMs, sequence }) => ({ providerMarketId,
        providerSelectionId, marketType, selection, rawOdds, rawFormat, status, isLive,
        receivedMonotonicMs, sequence }))).toEqual([
      { providerMarketId: "1054290306:home-clean-sheet",
        providerSelectionId: "1054290306:home-clean-sheet:yes", marketType: "HOME_FT_CLEAN_SHEET",
        selection: "YES", rawOdds: "2.72", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
        receivedMonotonicMs: 40, sequence: 3 },
      { providerMarketId: "1054290306:home-clean-sheet",
        providerSelectionId: "1054290306:home-clean-sheet:no", marketType: "HOME_FT_CLEAN_SHEET",
        selection: "NO", rawOdds: "1.36", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
        receivedMonotonicMs: 40, sequence: 3 },
      { providerMarketId: "1054290306:away-clean-sheet",
        providerSelectionId: "1054290306:away-clean-sheet:yes", marketType: "AWAY_FT_CLEAN_SHEET",
        selection: "YES", rawOdds: "3.6", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
        receivedMonotonicMs: 40, sequence: 3 },
      { providerMarketId: "1054290306:away-clean-sheet",
        providerSelectionId: "1054290306:away-clean-sheet:no", marketType: "AWAY_FT_CLEAN_SHEET",
        selection: "NO", rawOdds: "1.22", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
        receivedMonotonicMs: 40, sequence: 3 }
    ]);
    expect(normalized.nativeMarketObservations).toEqual([expect.objectContaining({
      providerMarketId: "1054290306", nativeType: "13", nativeScope: "FULL_TIME",
      outcomeLabels: ["HOME_YES", "HOME_NO", "AWAY_YES", "AWAY_NO"],
      disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED"
    })]);
  });

  it("refuses malformed, duplicated and non-goals SABA type 13 rows without guessing a clean-sheet market", () => {
    const base = { type: "o", matchid: 2, bettype: 13, parenttypeid: 13,
      oddsstatus: "running", enable: 1, cs10: 1.36, cs11: 2.72, cs20: 1.22, cs21: 3.60 };
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "l", leagueid: 2, leaguenameen: "League - CORNERS", sporttype: 1 },
      { type: "l", leagueid: 3, leaguenameen: "League - BOOKING", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "m", matchid: 20, leagueid: 2, hteamnameen: "Home No.of Corners",
        ateamnameen: "Away No.of Corners", kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "m", matchid: 30, leagueid: 3, hteamnameen: "Home Total Booking",
        ateamnameen: "Away Total Booking", kickofftime: 10, marketid: "L", sporttype: 1 },
      { ...base, oddsid: 100 },
      { ...base, oddsid: 100 },
      { ...base, oddsid: 101, cs21: undefined },
      { ...base, oddsid: 102, cs11: 1 },
      { ...base, oddsid: 103, parenttypeid: 14 },
      { ...base, oddsid: 104, matchid: 20 },
      { ...base, oddsid: 105, matchid: 30 }
    ], options);

    expect(normalized.markets.map(({ providerMarketId }) => providerMarketId)).toEqual([
      "100:home-clean-sheet", "100:away-clean-sheet"
    ]);
    expect(normalized.nativeMarketObservations.map(({ providerMarketId, disposition, reason }) =>
      [providerMarketId, disposition, reason])).toEqual([
        ["100", "NORMALIZED", "CANONICAL_MARKET_MAPPED"],
        ["100", "EXCLUDED", "DUPLICATE_NATIVE_MARKET_ID"],
        ["101", "EXCLUDED", "INVALID_TWO_WAY_SHAPE"],
        ["102", "EXCLUDED", "INVALID_TWO_WAY_SHAPE"],
        ["103", "EXCLUDED", "PARENT_MARKET_VARIANT"],
        ["104", "UNMAPPED", "NATIVE_TYPE_UNMAPPED"],
        ["105", "UNMAPPED", "NATIVE_TYPE_UNMAPPED"]
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

  it("retains quarter and integer totals while rejecting structurally inconsistent totals", () => {
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

    expect(normalized.markets).toEqual([
      expect.objectContaining({ marketType: "FT_TOTAL", line: "2.25" }),
      expect.objectContaining({ marketType: "FT_TOTAL", line: "2" })
    ]);
    expect(normalized.quotes).toHaveLength(4);
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

  it("classifies SABA corner and booking pseudo-events as their exact market families", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "RUSSIA CUP - CORNERS", sporttype: 1 },
      { type: "l", leagueid: 2, leaguenameen: "RUSSIA CUP - BOOKING", sporttype: 1 },
      { type: "m", matchid: 10, leagueid: 1, hteamnameen: "CSKA Moscow No.of Corners",
        ateamnameen: "FK Akron Togliatti No.of Corners", kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "m", matchid: 20, leagueid: 2, hteamnameen: "CSKA Moscow Total Bookings",
        ateamnameen: "FK Akron Togliatti Total Bookings", kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 11, matchid: 10, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", odds1a: 0.82, odds2a: -0.96, hdp1: 0.5, hdp2: 0 },
      { type: "o", oddsid: 12, matchid: 10, bettype: 8, parenttypeid: 8,
        oddsstatus: "running", odds1a: -0.74, odds2a: 0.62, hdp1: 4.5, hdp2: 0 },
      { type: "o", oddsid: 21, matchid: 20, bettype: 3, parenttypeid: 3,
        oddsstatus: "running", odds1a: 0.72, odds2a: -0.88, hdp1: 3.5, hdp2: 0 },
      { type: "o", oddsid: 22, matchid: 20, bettype: 7, parenttypeid: 7,
        oddsstatus: "running", odds1a: -0.68, odds2a: 0.52, hdp1: 0, hdp2: 0.5 }
    ], options);

    // The team names lose their suffix - these are the same two teams - but the
    // competition keeps its own. Folding these books back into the fixture's
    // competition put three entries with one name, one pair of teams and one
    // kickoff in front of a rival price, which could not say which of them it
    // belonged to and withheld all three, the main match included. Corner books
    // in two different books still meet through the usual competition linking.
    expect(normalized.events.map(({ competition, participantA, participantB }) =>
      ({ competition, participantA, participantB }))).toEqual([
        { competition: "RUSSIA CUP - CORNERS", participantA: "CSKA Moscow",
          participantB: "FK Akron Togliatti" },
        { competition: "RUSSIA CUP - BOOKING", participantA: "CSKA Moscow",
          participantB: "FK Akron Togliatti" }
      ]);
    expect(normalized.markets.map(({ marketType, settlementProfile }) =>
      ({ marketType, settlementProfile }))).toEqual([
        { marketType: "CORNER_FT_AH", settlementProfile: "football-corners-regulation" },
        { marketType: "CORNER_FH_TOTAL", settlementProfile: "football-corners-first-half" },
        { marketType: "CARD_FT_TOTAL", settlementProfile: "football-cards-regulation" },
        { marketType: "CARD_FH_AH", settlementProfile: "football-cards-first-half" }
      ]);
  });

  it("rejects non-total corner and booking derivative pseudo-events", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "RUSSIA CUP - CORNERS", sporttype: 1 },
      { type: "l", leagueid: 2, leaguenameen: "RUSSIA CUP - BOOKING", sporttype: 1 },
      { type: "m", matchid: 10, leagueid: 1, hteamnameen: "CSKA Moscow 1st Corner",
        ateamnameen: "FK Akron Togliatti 1st Corner", kickofftime: 10, marketid: "L", sporttype: 1 },
      { type: "m", matchid: 20, leagueid: 2, hteamnameen: "CSKA Moscow 3rd Booking",
        ateamnameen: "FK Akron Togliatti 3rd Booking", kickofftime: 10, marketid: "L", sporttype: 1 }
    ], options);

    expect(normalized.events).toEqual([]);
    expect(normalized.markets).toEqual([]);
    expect(normalized.diagnostics).toEqual([
      "SABA_FOOTBALL_EVENT_UNSUPPORTED", "SABA_FOOTBALL_EVENT_UNSUPPORTED"
    ]);
  });
});

describe("SABA live claims lose to its own scheduled kickoff", () => {
  const liveStamp = Math.floor(options.observedAtMs / 1_000) - 1_320;
  const scheduled = Math.floor(options.observedAtMs / 1_000) + 47_040;

  it("refuses a live claim for a fixture the same snapshot schedules for later", () => {
    // The live group stamps every fixture with the moment the snapshot was
    // built, so "kickoff has passed" is trivially true. The day's list carries
    // the same fixture with a real kickoff hours away, and a fixture that
    // starts later is not running now.
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "Spain Primera Laliga", sporttype: 1 },
      { type: "m", matchid: 10, leagueid: 1, hteamnameen: "Celta Vigo", ateamnameen: "Osasuna",
        kickofftime: liveStamp, eventstatus: "running", marketid: "L", sporttype: 1 },
      { type: "m", matchid: 11, leagueid: 1, hteamnameen: "Celta Vigo", ateamnameen: "Osasuna",
        kickofftime: scheduled, eventstatus: "running", marketid: "T", sporttype: 1 }
    ], options);

    expect(normalized.events).toEqual([
      expect.objectContaining({ providerEventId: "10", isLive: false,
        startAtUtcMs: scheduled * 1_000 }),
      expect.objectContaining({ providerEventId: "11", isLive: false,
        startAtUtcMs: scheduled * 1_000 })
    ]);
  });

  it("still reports a running fixture the snapshot does not schedule for later", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 12, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: liveStamp, eventstatus: "running", marketid: "L", sporttype: 1 }
    ], options);

    expect(normalized.events).toEqual([expect.objectContaining({
      providerEventId: "12", isLive: true, startAtUtcMs: liveStamp * 1_000
    })]);
  });

  it("does not let a kickoff moments away contradict a live claim", () => {
    const nearlyNow = Math.floor(options.observedAtMs / 1_000) + 60;
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 13, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: liveStamp, eventstatus: "running", marketid: "L", sporttype: 1 },
      { type: "m", matchid: 14, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: nearlyNow, eventstatus: "running", marketid: "T", sporttype: 1 }
    ], options);

    expect(normalized.events[0]).toEqual(expect.objectContaining({
      providerEventId: "13", isLive: true
    }));
  });
});

describe("SABA kickoff evidence survives its live-group record", () => {
  it("keeps a real kickoff when a later record only restates the observation", () => {
    // The live group stamps kickofftime with the moment of the snapshot. Letting
    // it win makes "kickoff has passed" trivially true, so an upcoming fixture
    // claims to be live and can never pair with another book's pre-match one.
    const kickoffSeconds = Math.floor(options.observedAtMs / 1_000) + 7_200;
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: kickoffSeconds, eventstatus: "running", marketid: "T", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: Math.floor(options.observedAtMs / 1_000), eventstatus: "running",
        marketid: "L", sporttype: 1 }
    ], options);

    expect(normalized.events).toEqual([expect.objectContaining({
      providerEventId: "2", isLive: false, startAtUtcMs: kickoffSeconds * 1_000
    })]);
  });

  it("still takes a later kickoff that carries real evidence", () => {
    const corrected = Math.floor(options.observedAtMs / 1_000) + 3_600;
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: Math.floor(options.observedAtMs / 1_000) + 7_200, eventstatus: "running",
        marketid: "T", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: corrected, eventstatus: "running", marketid: "T", sporttype: 1 }
    ], options);

    expect(normalized.events).toEqual([expect.objectContaining({
      providerEventId: "2", startAtUtcMs: corrected * 1_000
    })]);
  });
});

describe("SABA live classification requires a started fixture", () => {
  it("keeps a live-group match pre-match until its own kickoff has passed", () => {
    // Measured 2026-08-26: SABA published 92 live-group matches with no period,
    // clock or score, and CMD gave 83 of them a kickoff still six hours away.
    // The live group alone is not evidence that a fixture has started, and a
    // live event can never be compared against another book's pre-match one.
    const kickoffSeconds = Math.floor(options.observedAtMs / 1_000) + 6 * 60 * 60;
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "Japan Emperor Cup", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Sagan Tosu", ateamnameen: "Kataller Toyama",
        kickofftime: kickoffSeconds, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }
    ], options);

    expect(normalized.events[0]).toMatchObject({ isLive: false, liveState: null });
    expect(normalized.quotes[0]).toMatchObject({ isLive: false });
  });

  it("still reports a live-group match as live once its kickoff has passed", () => {
    const kickoffSeconds = Math.floor(options.observedAtMs / 1_000) - 30 * 60;
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 },
      { type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: kickoffSeconds, marketid: "L", sporttype: 1 },
      { type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }
    ], options);

    expect(normalized.events[0]).toMatchObject({ isLive: true });
    expect(normalized.quotes[0]).toMatchObject({ isLive: true });
  });
});

describe("SABA native multi-match aggregate accounting", () => {
  const nativeGroups = (matchid: number) => [1, 3, 7, 8, 2].map((bettype, index) => ({
    type: "o", matchid, oddsid: matchid * 10 + index, bettype, parenttypeid: bettype,
    hdp1: bettype === 3 || bettype === 8 ? 2.5 : 0.5, hdp2: 0,
    odds1a: 0.9, odds2a: -0.95, oddsstatus: "running", enable: 1
  }));

  it.each([
    [134003685, "*GIẢI SERIE A Ý - ĐỘI NHÀ/ĐỘI KHÁCH", 2],
    [134003749, "*GIẢI LALIGA TÂY BAN NHA - ĐỘI NHÀ/ĐỘI KHÁCH", 2],
    [134019593, "GIẢI ALLSVENSKAN THỤY ĐIỂN - ĐỘI NHÀ/ĐỘI KHÁCH", 3]
  ])("excludes aggregate %s but inventories its five native groups", (matchid, competition, count) => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: matchid, leaguenameen: competition, sporttype: 1 },
      { type: "m", matchid, leagueid: matchid,
        hteamnameen: `Đội Nhà - Thứ Hai - ${count} Trận Đấu`,
        ateamnameen: `Đội Khách - Thứ Hai - ${count} Trận Đấu`,
        kickofftime: Math.floor(options.observedAtMs / 1_000) + 3_600, marketid: "T", sporttype: 1 },
      ...nativeGroups(matchid)
    ], options);

    expect(normalized.events).toEqual([]);
    expect(normalized.markets).toEqual([]);
    expect(normalized.quotes).toEqual([]);
    expect(normalized.nativeMarketObservations).toHaveLength(5);
    expect(normalized.nativeMarketObservations.every(({ disposition, reason }) =>
      disposition === "EXCLUDED" && reason === "EVENT_NOT_COMPARABLE")).toBe(true);
  });

  it("keeps an ordinary real fixture unchanged beside an aggregate", () => {
    const normalized = normalizeSabaFootballRecords([
      { type: "l", leagueid: 1, leaguenameen: "League One", sporttype: 1 },
      { type: "l", leagueid: 2, leaguenameen: "League Two - ĐỘI NHÀ/ĐỘI KHÁCH", sporttype: 1 },
      { type: "m", matchid: 10, leagueid: 1, hteamnameen: "Real Home", ateamnameen: "Real Away",
        kickofftime: Math.floor(options.observedAtMs / 1_000) + 3_600, marketid: "T", sporttype: 1 },
      { type: "m", matchid: 20, leagueid: 2,
        hteamnameen: "Đội Nhà - Thứ Hai - 2 Trận Đấu",
        ateamnameen: "Đội Khách - Thứ Hai - 2 Trận Đấu",
        kickofftime: Math.floor(options.observedAtMs / 1_000) + 3_600, marketid: "T", sporttype: 1 },
      ...nativeGroups(10).slice(0, 1), ...nativeGroups(20).slice(0, 1)
    ], options);

    expect(normalized.events).toEqual([expect.objectContaining({ providerEventId: "10",
      participantA: "Real Home", participantB: "Real Away" })]);
    expect(normalized.markets).toHaveLength(1);
    expect(normalized.nativeMarketObservations).toEqual([
      expect.objectContaining({ providerEventId: "10", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerEventId: "20", disposition: "EXCLUDED",
        reason: "EVENT_NOT_COMPARABLE" })
    ]);
  });
});
