import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { ProviderMarketSchema, ProviderQuoteSchema } from "@tool-chenh/contracts";
import { extractTsportFootballRecord, observeTsportNativeMarkets } from "./tsport-ws-adapter.js";

const row = (line: string) => ({ "6": "offer", "7": line, "0": "native-home", "8": { "0": "3.76" } });
const event = (group: number, odd: object, live = false) => ({ "2": "fixture", "5": "Home", "22": "Away", "53": "League",
  "6": live, "10": "Active", "11": "2026-09-11T18:00:00Z", "50": [{ "3": group, "10": "Active", "9": [odd] }] });
const normalize = (raw: Record<string, unknown>) => normalizeSbobetCatalog([extractTsportFootballRecord(raw)!],
  { provider: "APSPORT", observedAtMs: 100, receivedMonotonicMs: 10, sequence: 7 });

describe("AP native categorical contracts", () => {
  it.each([
    [10, "2:1", "FT_CORRECT_SCORE", "SCORE_2_1", null, "FULL_TIME"],
    [11, "1:2", "FH_CORRECT_SCORE", "SCORE_1_2", null, "FIRST_HALF"],
    [14, "2:3", "FT_GOAL_RANGE", "RANGE_2_3", null, "FULL_TIME"],
    [15, "1:1", "FH_GOAL_RANGE", "RANGE_1_1", null, "FIRST_HALF"],
    [132, "2:2", "HOME_FT_GOAL_RANGE", "RANGE_2_2", null, "FULL_TIME"],
    [133, "1:1", "AWAY_FT_GOAL_RANGE", "RANGE_1_1", null, "FULL_TIME"],
    // AP uses 1=home, 2=away, 3=draw for HT/FT, but 2=draw for result/BTTS.
    [68, "13", "FT_HALF_FULL_RESULT", "HOME_DRAW", null, "FULL_TIME"],
    [68, "32", "FT_HALF_FULL_RESULT", "DRAW_AWAY", null, "FULL_TIME"],
    [81, "24", "FT_RESULT_BTTS", "DRAW_YES", null, "FULL_TIME"],
    [98, "24", "FT_DOUBLE_CHANCE_BTTS", "HOME_AWAY_YES", null, "FULL_TIME"],
    [82, "5:2.5", "FT_RESULT_TOTAL", "AWAY_OVER", "2.5", "FULL_TIME"],
    [131, "5-6", "CORNER_FT_RANGE", "RANGE_5_6", null, "FULL_TIME"]
  ] as const)("decodes group %s/%s with its own native outcome table", (group, line, marketType, selection, canonicalLine, scope) => {
    const raw = event(group, row(line));
    const result = normalize(raw);
    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]).toMatchObject({ providerMarketId: `tsport:${group}:offer`, marketType, line: canonicalLine, scope });
    expect(result.quotes).toEqual([expect.objectContaining({ providerSelectionId: "native-home", selection, rawOdds: "3.76",
      rawFormat: "DECIMAL", sequence: 7, receivedMonotonicMs: 10 })]);
    expect(ProviderMarketSchema.safeParse(result.markets[0]).success).toBe(true);
    expect(ProviderQuoteSchema.safeParse(result.quotes[0]).success).toBe(true);
    expect(observeTsportNativeMarkets(raw, 100)[0]).toMatchObject({ disposition: "NORMALIZED", reason: marketType });
  });

  it.each([
    [10, "0:0", "FT_TOTAL", "UNDER", "0.5"], [11, "0:0", "FH_TOTAL", "UNDER", "0.5"],
    [14, "0:1", "FT_TOTAL", "UNDER", "1.5"], [14, "6+", "FT_TOTAL", "OVER", "5.5"],
    [15, "3+", "FH_TOTAL", "OVER", "2.5"], [132, "0:0", "HOME_FT_TOTAL", "UNDER", "0.5"],
    [133, "3+", "AWAY_FT_TOTAL", "OVER", "2.5"], [131, "13+", "CORNER_FT_TOTAL", "OVER", "12.5"],
    [134, "0-1", "HOME_CORNER_FT_TOTAL", "UNDER", "1.5"], [136, "6+", "CORNER_FH_TOTAL", "OVER", "5.5"]
  ] as const)("preserves the native leg when %s/%s has exactly the same payoff as a total", (group, line, marketType, selection, canonicalLine) => {
    const result = normalize(event(group, row(line)));
    expect(result.markets).toEqual([expect.objectContaining({ marketType, line: canonicalLine })]);
    expect(result.quotes).toEqual([expect.objectContaining({ providerSelectionId: "native-home", selection, rawOdds: "3.76" })]);
  });

  const winner = { ...row("0.0"), "2": "native-away", "3": "native-draw", "9": { "0": "4.5" }, "10": { "0": "2.1" } };
  it("keeps first half, second half and equal separate from home/away/draw", () => {
    const result = normalize(event(65, winner));
    expect(result.markets[0]).toMatchObject({ marketType: "FT_HIGHEST_SCORING_HALF" });
    expect(result.quotes.map(q => q.selection)).toEqual(["FIRST_HALF", "SECOND_HALF", "EQUAL"]);
  });
  it("never confuses the corner winner with the goal winner", () => {
    expect(normalize(event(17, winner)).markets[0]).toMatchObject({ marketType: "CORNER_FT_1X2",
      settlementProfile: "football-corners-regulation" });
  });
  it("maps prematch DNB to handicap zero but retains a separate live settlement contract", () => {
    const dnb = { ...winner, "3": undefined, "10": undefined };
    expect(normalize(event(16, dnb)).markets[0]).toMatchObject({ marketType: "FT_AH", line: "0" });
    expect(normalize(event(75, dnb)).markets[0]).toMatchObject({ marketType: "FH_AH", line: "0" });
    expect(normalize(event(16, dnb, true)).markets[0]).toMatchObject({ marketType: "FT_DRAW_NO_BET", line: null });
    expect(normalize(event(16, { ...dnb, "7": "1" })).markets).toEqual([]);
  });
  it.each([[10,"9:9"], [11,"9:9"], [10,"-1:0"], [14,"5:2"], [68,"44"], [81,"16"], [82,"5:2.25"]])(
    "retains ambiguous or invalid %s/%s in inventory without inventing a contract", (group, line) => {
      const raw = event(Number(group), row(String(line)));
      expect(normalize(raw).markets).toEqual([]);
      expect(observeTsportNativeMarkets(raw,100)[0]?.disposition).not.toBe("NORMALIZED");
    });
  it("does not manufacture an extra selection or revive suspended native quotes", () => {
    const raw = event(14, { ...row("0:1"), "13": true });
    expect(normalize(raw).quotes).toEqual([expect.objectContaining({ selection: "UNDER", status: "SUSPENDED" })]);
    expect(normalize(event(14, { ...row("0:1"), "2": "unexpected-side" })).markets).toEqual([]);
  });
});
