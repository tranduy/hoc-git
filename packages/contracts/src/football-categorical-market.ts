import type { MarketType, Scope } from "./domain.js";

/** Native multi-outcome offers. Keeping a quote does not assert a binary complement. */
export interface FootballCategoricalMarketSpec {
  readonly scope: Extract<Scope, "FULL_TIME" | "FIRST_HALF">;
  readonly settlementProfile: string;
  readonly linePolicy: "NONE" | "HALF_UNIT";
  readonly selectionPattern: RegExp;
}

const score = /^SCORE_(?:0|[1-9]\d?)_(?:0|[1-9]\d?)$/u;
const range = /^RANGE_(?:0|[1-9]\d?)_(?:0|[1-9]\d?|PLUS)$/u;
const result = /^(?:HOME|DRAW|AWAY)$/u;
const highestHalf = /^(?:FIRST_HALF|SECOND_HALF|EQUAL)$/u;
const entries = [
  ["FT_CORRECT_SCORE", "FULL_TIME", "football-correct-score-regulation", score],
  ["FH_CORRECT_SCORE", "FIRST_HALF", "football-correct-score-first-half", score],
  ["FT_GOAL_RANGE", "FULL_TIME", "football-goal-range-regulation", range],
  ["FH_GOAL_RANGE", "FIRST_HALF", "football-goal-range-first-half", range],
  ["HOME_FT_GOAL_RANGE", "FULL_TIME", "football-home-goal-range-regulation", range],
  ["AWAY_FT_GOAL_RANGE", "FULL_TIME", "football-away-goal-range-regulation", range],
  ["CORNER_FT_RANGE", "FULL_TIME", "football-corner-range-regulation", range],
  ["CORNER_FH_RANGE", "FIRST_HALF", "football-corner-range-first-half", range],
  ["HOME_CORNER_FT_RANGE", "FULL_TIME", "football-home-corner-range-regulation", range],
  ["AWAY_CORNER_FT_RANGE", "FULL_TIME", "football-away-corner-range-regulation", range],
  ["FT_HALF_FULL_RESULT", "FULL_TIME", "football-half-full-result", /^(?:HOME|DRAW|AWAY)_(?:HOME|DRAW|AWAY)$/u],
  ["FT_RESULT_BTTS", "FULL_TIME", "football-result-btts-regulation", /^(?:HOME|DRAW|AWAY)_(?:YES|NO)$/u],
  ["FT_DOUBLE_CHANCE_BTTS", "FULL_TIME", "football-double-chance-btts-regulation", /^(?:HOME_DRAW|HOME_AWAY|DRAW_AWAY)_(?:YES|NO)$/u],
  ["FT_RESULT_TOTAL", "FULL_TIME", "football-result-total-regulation", /^(?:HOME|DRAW|AWAY)_(?:OVER|UNDER)$/u],
  ["FT_HIGHEST_SCORING_HALF", "FULL_TIME", "football-highest-scoring-half", highestHalf],
  ["HOME_FT_HIGHEST_SCORING_HALF", "FULL_TIME", "football-home-highest-scoring-half", highestHalf],
  ["AWAY_FT_HIGHEST_SCORING_HALF", "FULL_TIME", "football-away-highest-scoring-half", highestHalf],
  ["CORNER_FT_1X2", "FULL_TIME", "football-corners-regulation", result],
  ["CORNER_FH_1X2", "FIRST_HALF", "football-corners-first-half", result],
  ["CARD_FT_1X2", "FULL_TIME", "football-cards-regulation", result],
  ["CARD_FH_1X2", "FIRST_HALF", "football-cards-first-half", result],
  ["YELLOW_CARD_FT_1X2", "FULL_TIME", "football-yellow-cards-regulation", result],
  ["YELLOW_CARD_FT_DOUBLE_CHANCE", "FULL_TIME", "football-yellow-cards-regulation", /^(?:HOME_DRAW|HOME_AWAY|DRAW_AWAY)$/u],
  ["FT_DRAW_NO_BET", "FULL_TIME", "football-draw-no-bet-regulation", /^(?:HOME|AWAY)$/u],
  ["FH_DRAW_NO_BET", "FIRST_HALF", "football-draw-no-bet-first-half", /^(?:HOME|AWAY)$/u]
] as const;
const specs: Readonly<Partial<Record<MarketType, FootballCategoricalMarketSpec>>> = Object.fromEntries(entries.map(
  ([type, scope, settlementProfile, selectionPattern]) => [type, { scope, settlementProfile, selectionPattern,
    linePolicy: type === "FT_RESULT_TOTAL" ? "HALF_UNIT" : "NONE" }]));

export function footballCategoricalMarketSpec(type: MarketType): FootballCategoricalMarketSpec | null {
  return specs[type] ?? null;
}

export function isFootballCategoricalSelection(type: MarketType, selection: string): boolean {
  const spec = footballCategoricalMarketSpec(type);
  if (spec === null || !spec.selectionPattern.test(selection)) return false;
  const bounds = /^RANGE_(\d+)_(\d+)$/u.exec(selection);
  return bounds === null || Number(bounds[1]) <= Number(bounds[2]);
}
