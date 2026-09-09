import { describe, expect, it } from "vitest";
import { footballBinaryMarketSpec } from "./football-binary-market.js";
import { footballCategoricalMarketSpec, isFootballCategoricalSelection } from "./football-categorical-market.js";
import { MarketTypeSchema } from "./schemas.js";
import type { MarketType } from "./domain.js";

describe("remaining football contracts",()=>{
  it.each(["FT_FIRST_GOAL_BEFORE","HOME_FT_FIRST_GOAL_BEFORE","AWAY_FT_FIRST_GOAL_BEFORE","FT_GOAL_AFTER"])(
    "keeps %s second thresholds as non-push YES/NO predicates",type=>{
      expect(footballBinaryMarketSpec(type as MarketType)).toMatchObject({scope:"FULL_TIME",linePolicy:"POSITIVE_INTEGER",outcomes:["YES","NO"]});
    });
  it.each(["FT_GOAL_RACE","CORNER_FT_RACE","CORNER_FH_RACE"])("registers explicit integer-target %s",type=>{
    expect(MarketTypeSchema.safeParse(type).success).toBe(true);
    expect(footballCategoricalMarketSpec(type as MarketType)).toMatchObject({linePolicy:"INTEGER"});
    expect(isFootballCategoricalSelection(type as MarketType,"NEITHER")).toBe(true);
    expect(isFootballCategoricalSelection(type as MarketType,"DRAW")).toBe(false);
  });
  it("distinguishes first/last scoring, minute labels and exact seconds",()=>{
    expect(footballCategoricalMarketSpec("FT_FIRST_GOAL_MINUTE_RANGE" as MarketType)?.settlementProfile)
      .not.toBe(footballCategoricalMarketSpec("FT_FIRST_GOAL_SECONDS_RANGE" as MarketType)?.settlementProfile);
    expect(isFootballCategoricalSelection("FT_FIRST_GOAL_SECONDS_RANGE" as MarketType,"SECONDS_0_599")).toBe(true);
    expect(isFootballCategoricalSelection("FT_FIRST_GOAL_SECONDS_RANGE" as MarketType,"MINUTES_1_10")).toBe(false);
  });
  it.each(["SECONDS_599_0","SECONDS_0_99999999999999999999","SECONDS_01_20"])("rejects noncanonical time interval %s",selection=>{
    expect(isFootballCategoricalSelection("FT_FIRST_GOAL_SECONDS_RANGE",selection)).toBe(false);
  });
  it.each(["PLAYER_FT_ANYTIME_SCORER","PLAYER_FT_TWO_PLUS_GOALS","PLAYER_FT_THREE_PLUS_GOALS","PLAYER_FT_FIRST_SCORER"])(
    "retains %s as its own player settlement contract",type=>{
      expect(MarketTypeSchema.safeParse(type).success).toBe(true);
      expect(footballBinaryMarketSpec(type as MarketType)?.family).toBe("YES_NO");
    });
});
