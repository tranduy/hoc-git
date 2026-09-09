import { describe, expect, it } from "vitest";
import type { MarketType } from "./domain.js";
import { footballBinaryMarketSpec } from "./football-binary-market.js";
import { footballCategoricalMarketSpec, isFootballCategoricalSelection } from "./football-categorical-market.js";
import { ProviderMarketSchema } from "./schemas.js";

describe("BTI period and statistic identities", () => {
  it.each([
    ["SH_CORRECT_SCORE", "SECOND_HALF", "SCORE_2_1"],
    ["CORNER_FT_CORRECT_SCORE", "FULL_TIME", "SCORE_8_5"],
    ["CORNER_FH_CORRECT_SCORE", "FIRST_HALF", "SCORE_3_2"],
    ["FT_SCORE_SET", "FULL_TIME", "SCORES_0_0|1_1|2_2"],
    ["FT_WIN_MARGIN", "FULL_TIME", "HOME_4_PLUS"],
    ["FH_WIN_MARGIN", "FIRST_HALF", "AWAY_1"],
    ["SH_GOAL_RANGE", "SECOND_HALF", "RANGE_2_3"],
    ["HOME_FH_GOAL_RANGE", "FIRST_HALF", "RANGE_3_PLUS"],
    ["AWAY_FH_GOAL_RANGE", "FIRST_HALF", "RANGE_0_0"],
    ["FH_RESULT_BTTS", "FIRST_HALF", "DRAW_YES"],
    ["SH_DRAW_NO_BET", "SECOND_HALF", "HOME"]
  ] as const)("retains %s without turning its selections into binary opposites", (type, scope, selection) => {
    const marketType = type as MarketType;
    const spec = footballCategoricalMarketSpec(marketType);
    expect(spec?.scope).toBe(scope);
    expect(isFootballCategoricalSelection(marketType, selection)).toBe(true);
    expect(isFootballCategoricalSelection(marketType, "OVER")).toBe(false);
    expect(footballBinaryMarketSpec(marketType)).toBeNull();
    const input = { provider: "BTI", category: "FOOTBALL", providerEventId: "event", providerMarketId: "native-offer",
      marketType, scope, line: null, settlementProfile: spec?.settlementProfile, status: "OPEN" };
    expect(ProviderMarketSchema.safeParse(input).success).toBe(true);
    expect(ProviderMarketSchema.safeParse({ ...input, scope: scope === "FULL_TIME" ? "FIRST_HALF" : "FULL_TIME" }).success)
      .toBe(false);
  });

  it("keeps corner scores and each half's score settlement distinct", () => {
    const profiles = ["FT_CORRECT_SCORE", "FH_CORRECT_SCORE", "SH_CORRECT_SCORE", "CORNER_FT_CORRECT_SCORE"]
      .map(type => footballCategoricalMarketSpec(type as MarketType)?.settlementProfile);
    expect(profiles.every(Boolean)).toBe(true);
    expect(new Set(profiles).size).toBe(4);
    expect(isFootballCategoricalSelection("SH_GOAL_RANGE" as MarketType, "RANGE_3_2")).toBe(false);
    expect(isFootballCategoricalSelection("CORNER_FT_CORRECT_SCORE" as MarketType, "SCORE_1_-1")).toBe(false);
  });

  it.each([
    ["HOME_SH_TOTAL", "SECOND_HALF", "GOALS", "TOTAL"],
    ["AWAY_SH_TOTAL", "SECOND_HALF", "GOALS", "TOTAL"],
    ["CORNER_SH_TOTAL", "SECOND_HALF", "CORNERS", "TOTAL"],
    ["HOME_FH_ODD_EVEN", "FIRST_HALF", "GOALS", "ODD_EVEN"],
    ["AWAY_FH_ODD_EVEN", "FIRST_HALF", "GOALS", "ODD_EVEN"],
    ["HOME_SH_ODD_EVEN", "SECOND_HALF", "GOALS", "ODD_EVEN"],
    ["AWAY_SH_ODD_EVEN", "SECOND_HALF", "GOALS", "ODD_EVEN"]
  ] as const)("accepts binary %s only in its own period", (type, scope, statistic, family) => {
    const marketType = type as MarketType;
    const spec = footballBinaryMarketSpec(marketType);
    expect(spec).toMatchObject({ scope, statistic, family, linePolicy: family === "TOTAL" ? "HALF_UNIT" : "NONE" });
    const input = { provider: "BTI", category: "FOOTBALL", providerEventId: "event", providerMarketId: "native-offer",
      marketType, scope, line: family === "TOTAL" ? "0.5" : null, settlementProfile: spec?.settlementProfile, status: "OPEN" };
    expect(ProviderMarketSchema.safeParse(input).success).toBe(true);
    expect(ProviderMarketSchema.safeParse({ ...input, scope: "FULL_TIME" }).success).toBe(false);
  });

  it("does not let first-half, second-half, or opposing team props share settlement profiles", () => {
    const types = ["HOME_FT_ODD_EVEN", "AWAY_FT_ODD_EVEN", "HOME_FH_ODD_EVEN", "AWAY_FH_ODD_EVEN",
      "HOME_SH_ODD_EVEN", "AWAY_SH_ODD_EVEN", "HOME_FT_TOTAL", "AWAY_FT_TOTAL", "HOME_FH_TOTAL", "AWAY_FH_TOTAL",
      "HOME_SH_TOTAL", "AWAY_SH_TOTAL", "CORNER_SH_TOTAL", "SH_TOTAL"];
    const profiles = types.map(type => footballBinaryMarketSpec(type as MarketType)?.settlementProfile);
    expect(profiles.every(Boolean)).toBe(true);
    expect(new Set(profiles).size).toBe(types.length);
  });

  it("requires score sets to contain at least two distinct, numerically ordered scores", () => {
    const type = "FT_SCORE_SET" as MarketType;
    expect(isFootballCategoricalSelection(type, "SCORES_0_2|0_10|1_0")).toBe(true);
    expect(isFootballCategoricalSelection(type, "SCORES_1_99|2_0|99_99")).toBe(true);
    for (const malformed of ["SCORES_0_0", "SCORES_0_0|0_0", "SCORES_1_0|0_1", "SCORES_0_10|0_2",
      "SCORES_0_0|01_0", "SCORES_0_0|-1_0", "SCORES_0_0|100_0", "SCORES_0_0|1_0|", "SCORE_0_0|1_0"]) {
      expect(isFootballCategoricalSelection(type, malformed), malformed).toBe(false);
    }
    expect(isFootballCategoricalSelection("FT_CORRECT_SCORE", "SCORES_0_0|1_1")).toBe(false);
    expect(footballCategoricalMarketSpec(type)?.settlementProfile)
      .not.toBe(footballCategoricalMarketSpec("FT_CORRECT_SCORE")?.settlementProfile);
  });

  it.each(["FT_WIN_MARGIN", "FH_WIN_MARGIN"])("requires a positive team-specific winning margin in %s", type => {
    for (const valid of ["HOME_1", "AWAY_99", "HOME_4_PLUS", "AWAY_1_PLUS"]) {
      expect(isFootballCategoricalSelection(type as MarketType, valid), valid).toBe(true);
    }
    for (const invalid of ["DRAW_1", "HOME_0", "HOME_100", "AWAY_01", "AWAY_-1", "HOME_1.5", "HOME_4+", "HOME"]) {
      expect(isFootballCategoricalSelection(type as MarketType, invalid), invalid).toBe(false);
    }
    expect(footballCategoricalMarketSpec("FT_WIN_MARGIN" as MarketType)?.settlementProfile)
      .not.toBe(footballCategoricalMarketSpec("FH_WIN_MARGIN" as MarketType)?.settlementProfile);
  });
});
