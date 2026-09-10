import { describe, expect, it } from "vitest";
import { footballCategoricalMarketSpec, isFootballCategoricalSelection } from "./football-categorical-market.js";
import type { MarketType } from "./domain.js";
import { footballBinaryMarketSpec } from "./football-binary-market.js";

it("keeps first-half card parity separate from full-time cards and goals", () => {
  const spec = footballBinaryMarketSpec("CARD_FH_ODD_EVEN" as MarketType);
  expect(spec).toMatchObject({ statistic: "CARDS", family: "ODD_EVEN", scope: "FIRST_HALF", linePolicy: "NONE" });
  expect(spec?.settlementProfile).not.toBe(footballBinaryMarketSpec("CARD_FT_ODD_EVEN")?.settlementProfile);
  expect(spec?.settlementProfile).not.toBe(footballBinaryMarketSpec("FH_ODD_EVEN")?.settlementProfile);
});

describe("last scoring team period semantics", () => {
  it("keeps first-half last goal distinct from full-time last and first-half first goal", () => {
    const type = "FH_LAST_GOAL_TEAM" as MarketType;
    const spec = footballCategoricalMarketSpec(type);
    expect(spec).toMatchObject({ scope: "FIRST_HALF", linePolicy: "NONE" });
    expect(spec?.settlementProfile).not.toBe(footballCategoricalMarketSpec("FT_LAST_GOAL_TEAM")?.settlementProfile);
    expect(spec?.settlementProfile).not.toBe(footballCategoricalMarketSpec("FH_FIRST_GOAL_TEAM")?.settlementProfile);
    for (const selection of ["HOME", "AWAY", "NONE"]) expect(isFootballCategoricalSelection(type, selection)).toBe(true);
    for (const selection of ["DRAW", "OVER", "NEXT_HOME"]) expect(isFootballCategoricalSelection(type, selection)).toBe(false);
  });
});
