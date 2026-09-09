import { describe, expect, it } from "vitest";
import type { MarketType } from "./domain.js";
import { footballBinaryMarketSpec } from "./football-binary-market.js";
import { footballCategoricalMarketSpec, isFootballCategoricalSelection } from "./football-categorical-market.js";
import { footballResultMarketSpec } from "./football-result-market.js";
import { ProviderMarketSchema, ProviderQuoteSchema, ScopeSchema } from "./schemas.js";

const market = (marketType: string, scope: string, line: string | null) => ({
  provider: "APSPORT", category: "FOOTBALL", providerEventId: "event", providerMarketId: "native-offer",
  marketType, scope, line, settlementProfile: "native-verified", status: "OPEN"
});
const quote = (marketType: string, line: string | null, selection: string) => ({
  provider: "APSPORT", category: "FOOTBALL", providerEventId: "event", providerMarketId: "native-offer",
  providerSelectionId: "native-selection", marketType, scope: "FULL_TIME", line, selection,
  rawOdds: "2.1", rawFormat: "DECIMAL", status: "OPEN", isLive: true,
  sourceTimestampMs: null, receivedMonotonicMs: 100, sequence: 1
});

describe("AP remaining market identities", () => {
  it("keeps draw-or-BTTS as a complete boolean predicate", () => {
    const type = "FT_DRAW_OR_BTTS" as MarketType;
    expect(footballBinaryMarketSpec(type)).toMatchObject({ statistic: "GOALS", scope: "FULL_TIME",
      family: "YES_NO", linePolicy: "NONE", outcomes: ["YES", "NO"], settlementProfile: "football-ft-draw-or-btts" });
    expect(ProviderMarketSchema.safeParse(market(type, "FULL_TIME", null)).success).toBe(true);
    expect(footballBinaryMarketSpec(type)?.settlementProfile).not.toBe(footballBinaryMarketSpec("FT_BTTS")?.settlementProfile);
    expect(footballBinaryMarketSpec(type)?.settlementProfile).not.toBe(footballBinaryMarketSpec("FT_ANY_TEAM_TO_WIN")?.settlementProfile);
  });

  it("keeps a player's numbered-goal predicate separate from first-goalscorer", () => {
    const type = "PLAYER_FT_GOAL_NUMBER_SCORER" as MarketType;
    const spec = footballBinaryMarketSpec(type);
    expect(spec).toMatchObject({ scope: "FULL_TIME", family: "YES_NO", linePolicy: "POSITIVE_INTEGER", outcomes: ["YES", "NO"] });
    expect(spec?.settlementProfile).not.toBe(footballBinaryMarketSpec("PLAYER_FT_FIRST_SCORER")?.settlementProfile);
    expect(ProviderMarketSchema.safeParse({ ...market(type, "FULL_TIME", "3"),
      player: { providerPlayerId: "native-player", name: "Harry Kane", teamSide: null } }).success).toBe(true);
    expect(ProviderMarketSchema.safeParse(market(type, "FULL_TIME", "3")).success).toBe(false);
  });

  it("preserves the explicit goal ordinal and its no-goal alternative", () => {
    const type = "FT_GOAL_NUMBER_TEAM" as MarketType;
    expect(footballCategoricalMarketSpec(type)).toMatchObject({ scope: "FULL_TIME", linePolicy: "INTEGER" });
    for (const selection of ["HOME", "AWAY", "NO_GOAL"]) {
      expect(isFootballCategoricalSelection(type, selection)).toBe(true);
      expect(ProviderQuoteSchema.safeParse(quote(type, "5", selection)).success).toBe(true);
    }
    expect(isFootballCategoricalSelection(type, "DRAW")).toBe(false);
    expect(footballBinaryMarketSpec(type)).toBeNull();
    expect(footballCategoricalMarketSpec(type)?.settlementProfile)
      .not.toBe(footballCategoricalMarketSpec("FT_FIRST_GOAL_TEAM")?.settlementProfile);
  });

  it.each([null, "0", "-1", "1.5", "1.0", "+1", "01", "9007199254740992"])(
    "rejects a missing or noncanonical goal ordinal %s", line => {
      expect(ProviderMarketSchema.safeParse(market("FT_GOAL_NUMBER_TEAM", "FULL_TIME", line)).success).toBe(false);
      expect(ProviderQuoteSchema.safeParse(quote("FT_GOAL_NUMBER_TEAM", line, "HOME")).success).toBe(false);
    });

  it("validates a goal ordinal as a positive safe integer", () => {
    expect(ProviderMarketSchema.safeParse(market("FT_GOAL_NUMBER_TEAM", "FULL_TIME", "1")).success).toBe(true);
    expect(ProviderQuoteSchema.safeParse(quote("FT_GOAL_NUMBER_TEAM", "1", "DRAW")).success).toBe(false);
  });

  it("keeps remaining-result score anchors in the selection identity", () => {
    const type = "FT_REMAINING_RESULT" as MarketType;
    expect(footballCategoricalMarketSpec(type)).toMatchObject({ scope: "FULL_TIME", linePolicy: "NONE" });
    for (const selection of ["FROM_SCORE_3_1_HOME", "FROM_SCORE_0_0_DRAW", "FROM_SCORE_0_99_AWAY"]) {
      expect(isFootballCategoricalSelection(type, selection)).toBe(true);
      expect(ProviderQuoteSchema.safeParse(quote(type, null, selection)).success).toBe(true);
    }
    expect(footballCategoricalMarketSpec(type)?.settlementProfile)
      .not.toBe(footballResultMarketSpec("FT_1X2")?.settlementProfile);
    expect(footballBinaryMarketSpec(type)).toBeNull();
  });

  it.each(["HOME", "FROM_SCORE_3_1_OVER", "FROM_SCORE_-1_0_HOME", "FROM_SCORE_01_0_HOME",
    "FROM_SCORE_1.5_0_HOME", "FROM_SCORE_100_0_HOME", "FROM_SCORE_0_0_HOME_AWAY"])(
    "rejects malformed or missing remaining-result anchor %s", selection => {
      expect(isFootballCategoricalSelection("FT_REMAINING_RESULT" as MarketType, selection)).toBe(false);
      expect(ProviderQuoteSchema.safeParse(quote("FT_REMAINING_RESULT", null, selection)).success).toBe(false);
    });

  it("does not reinterpret the score anchor as a numeric line", () => {
    expect(ProviderMarketSchema.safeParse(market("FT_REMAINING_RESULT", "FULL_TIME", null)).success).toBe(true);
    expect(ProviderMarketSchema.safeParse(market("FT_REMAINING_RESULT", "FULL_TIME", "3.1")).success).toBe(false);
  });

  it.each([
    ["ET_1X2", "EXTRA_TIME", null, "RESULT"],
    ["ET_FH_1X2", "EXTRA_TIME_FIRST_HALF", null, "RESULT"],
    ["ET_TOTAL", "EXTRA_TIME", "0.5", "TOTAL"],
    ["ET_FH_TOTAL", "EXTRA_TIME_FIRST_HALF", "0.5", "TOTAL"],
    ["ET_AH", "EXTRA_TIME", "-0.25", "HANDICAP"],
    ["ET_FH_AH", "EXTRA_TIME_FIRST_HALF", "0", "HANDICAP"]
  ] as const)("keeps %s in its own extra-time period", (type, scope, line, family) => {
    expect(ScopeSchema.safeParse(scope).success).toBe(true);
    const spec = family === "RESULT" ? footballCategoricalMarketSpec(type as MarketType)
      : footballBinaryMarketSpec(type as MarketType);
    expect(spec?.scope).toBe(scope);
    expect(ProviderMarketSchema.safeParse(market(type, scope, line)).success).toBe(true);
    for (const wrongScope of ["FULL_TIME", "FIRST_HALF", scope === "EXTRA_TIME" ? "EXTRA_TIME_FIRST_HALF" : "EXTRA_TIME"]) {
      expect(ProviderMarketSchema.safeParse(market(type, wrongScope, line)).success).toBe(false);
    }
    if (family === "RESULT") {
      expect(spec).toMatchObject({ linePolicy: "NONE" });
      for (const selection of ["HOME", "AWAY", "DRAW"]) expect(isFootballCategoricalSelection(type as MarketType, selection)).toBe(true);
    } else expect(spec).toMatchObject({ family, linePolicy: "HALF_UNIT" });
  });

  it("does not share regulation and extra-time settlement profiles", () => {
    const profiles = ["FT_TOTAL", "FH_TOTAL", "ET_TOTAL", "ET_FH_TOTAL"]
      .map(type => footballBinaryMarketSpec(type as MarketType)?.settlementProfile);
    expect(profiles.every(Boolean)).toBe(true);
    expect(new Set(profiles).size).toBe(4);
    expect(ProviderMarketSchema.safeParse({ ...market("ET_TOTAL", "EXTRA_TIME", "0.5"), category: "LOL" }).success).toBe(false);
  });
});
