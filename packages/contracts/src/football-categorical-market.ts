import type { MarketType, Scope } from "./domain.js";
import { extendedFootballCategoricalSpecs } from "./football-extended-market.js";

/** Native multi-outcome offers. Keeping a quote does not assert a binary complement. */
export interface FootballCategoricalMarketSpec {
  readonly scope: Extract<Scope, "FULL_TIME" | "FIRST_HALF" | "SECOND_HALF" | "EXTRA_TIME" | "EXTRA_TIME_FIRST_HALF">;
  readonly settlementProfile: string;
  readonly linePolicy: "NONE" | "HALF_UNIT" | "INTEGER";
  readonly selectionPattern: RegExp;
}

const score = /^SCORE_(?:0|[1-9]\d?)_(?:0|[1-9]\d?)$/u;
const scoreSet = /^SCORES_(?:0|[1-9]\d?)_(?:0|[1-9]\d?)(?:\|(?:0|[1-9]\d?)_(?:0|[1-9]\d?))+$/u;
const winMargin = /^(?:HOME|AWAY)_[1-9]\d?(?:_PLUS)?$/u;
const range = /^RANGE_(?:0|[1-9]\d?)_(?:0|[1-9]\d?|PLUS)$/u;
const result = /^(?:HOME|DRAW|AWAY)$/u;
const highestHalf = /^(?:FIRST_HALF|SECOND_HALF|EQUAL)$/u;
const entries = [
  ["FT_CORRECT_SCORE", "FULL_TIME", "football-correct-score-regulation", score],
  ["FH_CORRECT_SCORE", "FIRST_HALF", "football-correct-score-first-half", score],
  ["SH_CORRECT_SCORE", "SECOND_HALF", "football-correct-score-second-half", score],
  ["CORNER_FT_CORRECT_SCORE", "FULL_TIME", "football-corners-correct-score-regulation", score],
  ["CORNER_FH_CORRECT_SCORE", "FIRST_HALF", "football-corners-correct-score-first-half", score],
  ["FT_SCORE_SET", "FULL_TIME", "football-score-set-regulation", scoreSet],
  ["FT_WIN_MARGIN", "FULL_TIME", "football-winning-margin-regulation", winMargin],
  ["FH_WIN_MARGIN", "FIRST_HALF", "football-winning-margin-first-half", winMargin],
  ["FT_GOAL_RANGE", "FULL_TIME", "football-goal-range-regulation", range],
  ["FH_GOAL_RANGE", "FIRST_HALF", "football-goal-range-first-half", range],
  ["SH_GOAL_RANGE", "SECOND_HALF", "football-goal-range-second-half", range],
  ["HOME_FT_GOAL_RANGE", "FULL_TIME", "football-home-goal-range-regulation", range],
  ["AWAY_FT_GOAL_RANGE", "FULL_TIME", "football-away-goal-range-regulation", range],
  ["HOME_FH_GOAL_RANGE", "FIRST_HALF", "football-home-goal-range-first-half", range],
  ["AWAY_FH_GOAL_RANGE", "FIRST_HALF", "football-away-goal-range-first-half", range],
  ["CORNER_FT_RANGE", "FULL_TIME", "football-corner-range-regulation", range],
  ["CORNER_FH_RANGE", "FIRST_HALF", "football-corner-range-first-half", range],
  ["HOME_CORNER_FT_RANGE", "FULL_TIME", "football-home-corner-range-regulation", range],
  ["AWAY_CORNER_FT_RANGE", "FULL_TIME", "football-away-corner-range-regulation", range],
  ["FT_HALF_FULL_RESULT", "FULL_TIME", "football-half-full-result", /^(?:HOME|DRAW|AWAY)_(?:HOME|DRAW|AWAY)$/u],
  ["FT_RESULT_BTTS", "FULL_TIME", "football-result-btts-regulation", /^(?:HOME|DRAW|AWAY)_(?:YES|NO)$/u],
  ["FH_RESULT_BTTS", "FIRST_HALF", "football-result-btts-first-half", /^(?:HOME|DRAW|AWAY)_(?:YES|NO)$/u],
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
  ["FH_DRAW_NO_BET", "FIRST_HALF", "football-draw-no-bet-first-half", /^(?:HOME|AWAY)$/u],
  ["SH_DRAW_NO_BET", "SECOND_HALF", "football-draw-no-bet-second-half", /^(?:HOME|AWAY)$/u]
] as const;
const specs: Readonly<Partial<Record<MarketType, FootballCategoricalMarketSpec>>> = { ...extendedFootballCategoricalSpecs, ...Object.fromEntries(entries.map(
  ([type, scope, settlementProfile, selectionPattern]) => [type, { scope, settlementProfile, selectionPattern,
    linePolicy: type === "FT_RESULT_TOTAL" ? "HALF_UNIT" : "NONE" }])) };

export function footballCategoricalMarketSpec(type: MarketType): FootballCategoricalMarketSpec | null {
  return specs[type] ?? null;
}

export function isFootballCategoricalSelection(type: MarketType, selection: string): boolean {
  const spec = footballCategoricalMarketSpec(type);
  if (spec === null || !spec.selectionPattern.test(selection)) return false;
  if (type === "FT_SCORE_SET") {
    // A set has one canonical spelling: numeric home score, then numeric away score.
    // Strict ascending order also rejects duplicate states without changing native terms.
    let previous = -1;
    for (const pair of selection.slice("SCORES_".length).split("|")) {
      const [home, away] = pair.split("_").map(Number);
      const value = home! * 100 + away!;
      if (value <= previous) return false;
      previous = value;
    }
  }
  const bounds = /^RANGE_(\d+)_(\d+)$/u.exec(selection);
  if (bounds !== null && Number(bounds[1]) > Number(bounds[2])) return false;
  const time = /(?:^|_)(SECONDS|MINUTES)_(\d+)_(\d+)$/u.exec(selection);
  if (time !== null) return /^(?:0|[1-9]\d*)$/u.test(time[2]!) && /^(?:0|[1-9]\d*)$/u.test(time[3]!) &&
    Number.isSafeInteger(Number(time[2])) && Number.isSafeInteger(Number(time[3])) && Number(time[2]) <= Number(time[3]);
  return true;
}
