import { describe, expect, it } from "vitest";
import {
  footballBinaryMarketSpec,
  isNoPushFootballLine
} from "./football-binary-market.js";

describe("football binary market registry", () => {
  it.each([
    ["FT_TOTAL", "GOALS", "FULL_TIME", "TOTAL", ["OVER", "UNDER"]],
    ["FH_AH", "GOALS", "FIRST_HALF", "HANDICAP", ["HOME", "AWAY"]],
    ["CORNER_FT_TOTAL", "CORNERS", "FULL_TIME", "TOTAL", ["OVER", "UNDER"]],
    ["CORNER_FH_AH", "CORNERS", "FIRST_HALF", "HANDICAP", ["HOME", "AWAY"]],
    ["CARD_FT_TOTAL", "CARDS", "FULL_TIME", "TOTAL", ["OVER", "UNDER"]],
    ["CARD_FH_AH", "CARDS", "FIRST_HALF", "HANDICAP", ["HOME", "AWAY"]]
  ] as const)("keeps the exact identity of %s", (marketType, statistic, scope, family, outcomes) => {
    expect(footballBinaryMarketSpec(marketType)).toEqual(expect.objectContaining({
      marketType, statistic, scope, family, outcomes
    }));
  });

  it.each([
    ["FT_ODD_EVEN", "GOALS", "FULL_TIME", "ODD_EVEN", ["ODD", "EVEN"], "NONE"],
    ["FH_BTTS", "GOALS", "FIRST_HALF", "YES_NO", ["YES", "NO"], "NONE"],
    ["SH_BTTS", "GOALS", "SECOND_HALF", "YES_NO", ["YES", "NO"], "NONE"],
    ["HOME_FT_TOTAL", "GOALS", "FULL_TIME", "TOTAL", ["OVER", "UNDER"], "HALF_UNIT"],
    ["HOME_CORNER_FH_TOTAL", "CORNERS", "FIRST_HALF", "TOTAL", ["OVER", "UNDER"], "HALF_UNIT"],
    ["HOME_FT_WIN_TO_NIL", "GOALS", "FULL_TIME", "YES_NO", ["YES", "NO"], "NONE"],
    ["FT_BOTH_HALVES_OVER_TOTAL", "GOALS", "FULL_TIME", "YES_NO", ["YES", "NO"], "HALF_UNIT"]
  ] as const)("registers exact binary prop %s", (marketType, statistic, scope, family, outcomes, linePolicy) => {
    expect(footballBinaryMarketSpec(marketType as never)).toEqual(expect.objectContaining({
      marketType, statistic, scope, family, outcomes, linePolicy
    }));
  });

  it("does not classify three-way or observe-only markets as binary", () => {
    expect(footballBinaryMarketSpec("FT_1X2")).toBeNull();
    expect(footballBinaryMarketSpec("FH_1X2")).toBeNull();
    expect(footballBinaryMarketSpec("OBSERVE_ONLY")).toBeNull();
  });

  it.each([
    ["0.5", true], ["-0.5", true], ["1.5", true], ["10.5", true],
    ["0", false], ["1", false], ["0.25", false], ["-0.75", false],
    ["1.25", false], ["2.75", false], [null, false], ["not-a-line", false]
  ] as const)("classifies no-push line %s as %s", (line, expected) => {
    expect(isNoPushFootballLine(line)).toBe(expected);
  });
});
