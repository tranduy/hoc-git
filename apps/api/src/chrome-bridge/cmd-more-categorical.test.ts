import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ProviderMarketSchema, ProviderQuoteSchema } from "@tool-chenh/contracts";
import { normalizeCmdNativeMore, parseCmdNativeMore } from "./cmd-more-native.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/cmd-more-native-20260908.json", import.meta.url), "utf8"));
const owner = { sportId: "1" as const, leagueId: String(fixture.owner[3]), leagueName: fixture.owner[37],
  matchId: String(fixture.owner[0]), teamNames: [fixture.owner[38], fixture.owner[39]], timeText: "09/09 18:30", groups: [] };
const receipt = { observedAtMs: fixture.observedAtMs, receivedMonotonicMs: 120, sequence: 9 };
const decode = (body = fixture.body, override = {}) => normalizeCmdNativeMore(parseCmdNativeMore(JSON.stringify(body))!, { ...owner, ...override }, receipt);

describe("CMD native More categorical settlement terms", () => {
  it("reads More FT[3] as the two clean-sheet markets, in the order the other books confirm", () => {
    // Measured 2026-09-16: MORE:FT:3 was the largest unmapped native type in
    // the system, 210 fixtures, and CMD prices no clean sheet anywhere else.
    // The row is [home YES, home NO, away YES, away NO]. That order is not a
    // guess from the shape: against SBOBET's and APSPORT's own clean-sheet
    // prices on 37 shared fixtures it sits at a 3.7% median relative gap, 143
    // of 148 prices within 10%, while the reversed reading sits at 28.8% and
    // 23 of 148. An inverted market is a phantom arbitrage, so the order is
    // pinned here rather than left to the next reader to infer.
    const value = decode();
    expect(value.quotes.filter(q => q.marketType === "HOME_FT_CLEAN_SHEET")
      .map(q => [q.selection, q.rawOdds])).toEqual([["YES", "5.5"], ["NO", "1.14"]]);
    expect(value.quotes.filter(q => q.marketType === "AWAY_FT_CLEAN_SHEET")
      .map(q => [q.selection, q.rawOdds])).toEqual([["YES", "3.7"], ["NO", "1.28"]]);
    expect(value.markets.find(m => m.marketType === "AWAY_FT_CLEAN_SHEET")).toMatchObject({
      scope: "FULL_TIME", line: null, settlementProfile: "football-away-clean-sheet" });
    expect(value.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:3"))
      .toMatchObject({ disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" });
  });

  it("closes a clean-sheet pair on its own, and refuses the row for a corners event", () => {
    // -999 closes one side at a time, and the pairs close independently.
    const body = structuredClone(fixture.body);
    body.d[2][3][1] = -999;
    const halfClosed = decode(body);
    expect(halfClosed.quotes.some(q => q.marketType === "HOME_FT_CLEAN_SHEET")).toBe(false);
    expect(halfClosed.quotes.filter(q => q.marketType === "AWAY_FT_CLEAN_SHEET")).toHaveLength(2);

    // Clean sheet counts goals. A corners event must not acquire one, the same
    // guard the goal ranges already carry.
    const corners = decode(fixture.body, { leagueName: `${owner.leagueName} - CORNERS` });
    expect(corners.quotes.some(q => q.marketType.endsWith("_FT_CLEAN_SHEET"))).toBe(false);
    expect(corners.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:3"))
      .toMatchObject({ disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" });
  });

  it("retains exact FT/FH score coordinates and native selection IDs, without treating AOS metadata as odds", () => {
    const value = decode();
    const ft = value.quotes.filter(q => q.marketType === "FT_CORRECT_SCORE");
    const fh = value.quotes.filter(q => q.marketType === "FH_CORRECT_SCORE");
    expect(ft).toHaveLength(25); expect(fh).toHaveLength(16);
    expect(ft[5]).toMatchObject({ selection: "SCORE_1_0", rawOdds: "13", rawFormat: "DECIMAL", providerSelectionId: "25403104:CS:Home:10:0" });
    // Unlike FH 1X2, the provider's CS click uses the original event ID and period=1.
    expect(fh[4]).toMatchObject({ selection: "SCORE_1_0", providerSelectionId: "25403104:CS:Home:10:1" });
    expect(value.quotes.some(q => q.rawOdds === "33554431" || q.rawOdds === "507375")).toBe(false);
    const observation = value.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:4")!;
    expect(observation).toMatchObject({ reason: "CANONICAL_MARKET_MAPPED_WITH_UNRESOLVED_AOS", nativeLabel: JSON.stringify(fixture.body.d[2][4]) });
    expect(observation.nativeSelections).toHaveLength(26);
    expect(observation.nativeSelections!.at(-1)).toMatchObject({ selectionId: "25403104:CS:Home:-99:0", price: "18", status: "OPEN" });
  });

  it("keeps HT/FT, first/last goal, exact totals and home/away goal ranges separate", () => {
    const value = decode();
    expect(value.quotes.find(q => q.marketType === "FT_HALF_FULL_RESULT" && q.selection === "DRAW_AWAY"))
      .toMatchObject({ providerSelectionId: "25403104:DA:DA:0:0", rawOdds: "5.1" });
    expect(value.quotes.filter(q => q.marketType === "FT_FIRST_GOAL_TEAM").map(q => [q.selection, q.providerSelectionId]))
      .toEqual([["HOME", "25403104:FG:Home:0:0"], ["AWAY", "25403104:FG:Away:0:0"], ["NONE", "25403104:NG:Home:0:0"]]);
    expect(value.quotes.filter(q => q.marketType === "FT_LAST_GOAL_TEAM").map(q => q.selection)).toEqual(["HOME", "AWAY", "NONE"]);
    expect(value.quotes.find(q => q.marketType === "FT_GOAL_RANGE" && q.selection === "RANGE_6_PLUS"))
      .toMatchObject({ providerSelectionId: "25403104:ETG:Home:60:0" });
    expect(value.quotes.find(q => q.marketType === "AWAY_FT_GOAL_RANGE" && q.selection === "RANGE_3_PLUS"))
      .toMatchObject({ providerSelectionId: "25403104:ATG:Away:30:0" });
    expect(value.markets.find(m => m.marketType === "FT_EUROPEAN_HANDICAP"))?.toMatchObject({ line: "1" });
    expect(value.quotes.find(q => q.marketType === "FT_EUROPEAN_HANDICAP" && q.selection === "DRAW"))
      .toMatchObject({ providerSelectionId: "25403104:HP3:Home:12:0" });
    value.markets.forEach(m => expect(ProviderMarketSchema.safeParse(m).success, JSON.stringify(m)).toBe(true));
    value.quotes.forEach(q => expect(ProviderQuoteSchema.safeParse(q).success, JSON.stringify(q)).toBe(true));
    expect(value.nativeMarketObservations).toHaveLength(19);
  });

  it("withdraws individual closed score/HTFT/range selections, retains native -999, and uses row closure for first/last goal", () => {
    const body = structuredClone(fixture.body);
    body.d[2][4][5] = -999; body.d[2][6][5] = -999; body.d[2][8][1][1] = -999;
    body.d[2][5][0] = 0.99;
    const value = decode(body);
    expect(value.quotes.some(q => q.marketType === "FT_CORRECT_SCORE" && q.selection === "SCORE_1_0")).toBe(false);
    expect(value.quotes.filter(q => q.marketType === "FT_CORRECT_SCORE")).toHaveLength(24);
    expect(value.quotes.some(q => q.marketType === "FT_HALF_FULL_RESULT" && q.selection === "DRAW_AWAY")).toBe(false);
    expect(value.quotes.some(q => q.providerSelectionId === "25403104:ETG:Home:1:0")).toBe(false);
    expect(value.quotes.some(q => q.marketType === "FT_FIRST_GOAL_TEAM" || q.marketType === "FT_LAST_GOAL_TEAM")).toBe(false);
    expect(value.nativeMarketObservations!.find(o => o.nativeType === "MORE:FT:4")!.nativeSelections![5])
      .toMatchObject({ price: "-999", status: "CLOSED" });
  });

  it("validates exact shapes and handicap metadata, and never maps goal predicates onto stat or extra-time events", () => {
    const body = structuredClone(fixture.body); body.d[2][4].pop(); body.d[2][7][0] = 2; body.d[2][6].push(9);
    expect(decode(body).quotes.filter(q => ["FT_CORRECT_SCORE", "FT_EUROPEAN_HANDICAP", "FT_HALF_FULL_RESULT"].includes(q.marketType))).toEqual([]);
    for (const override of [
      { leagueName: "KOREA K LEAGUE 1 - CORNERS", teamNames: ["Ulsan HD FC (No. of Corners)", "FC Seoul (No. of Corners)"] },
      { teamNames: ["Ulsan HD FC (ET)", "FC Seoul (ET)"] }
    ]) expect(decode(fixture.body, override).quotes.filter(q => /CORRECT_SCORE|GOAL_RANGE|GOAL_TEAM|HALF_FULL|EUROPEAN/u.test(q.marketType))).toEqual([]);
  });

  it("retains the booking statistic for both native More odd/even periods", () => {
    const body = structuredClone(fixture.body); body.d[3][0] = [0.95, 0.93];
    const value = decode(body, { leagueName: "KOREA K LEAGUE 1 - BOOKINGS",
      teamNames: ["Ulsan HD FC (Total Bookings)", "FC Seoul (Total Bookings)"] });
    expect(value.quotes.filter(q => q.marketType.endsWith("ODD_EVEN")).map(q => q.marketType))
      .toEqual(["CARD_FT_ODD_EVEN", "CARD_FT_ODD_EVEN", "CARD_FH_ODD_EVEN", "CARD_FH_ODD_EVEN"]);
  });

  it("uses original event plus period1 for FH goal, total and HP3 click tuples, as the renderer passes Bo", () => {
    const body = structuredClone(fixture.body); body.d[3][3] = [2, 2.1, 3, 3.1, 4]; body.d[3][4] = [true, 1, 2, 3, 4];
    const value = decode(body);
    expect(value.quotes.find(q => q.marketType === "FH_FIRST_GOAL_TEAM" && q.selection === "HOME")?.providerSelectionId).toBe("25403104:FG:Home:0:1");
    expect(value.quotes.find(q => q.marketType === "FH_LAST_GOAL_TEAM" && q.selection === "NONE")?.providerSelectionId).toBe("25403104:NG:Home:0:1");
    expect(value.quotes.find(q => q.marketType === "FH_EUROPEAN_HANDICAP" && q.selection === "AWAY"))
      .toMatchObject({ providerSelectionId: "25403104:HP3:Away:-13:1", line: "-1" });
    expect(value.quotes.find(q => q.marketType === "FH_GOAL_RANGE" && q.selection === "RANGE_0_1")?.providerSelectionId).toBe("25403104:TG:Home:1:1");
    expect(value.quotes.find(q => q.marketType === "FH_GOAL_RANGE" && q.selection === "RANGE_3_PLUS")?.providerSelectionId).toBe("25403104:ETG:Home:30:1");
  });
});
