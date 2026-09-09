import type { MarketType, Scope } from "./domain.js";
import { extendedFootballBinarySpecs } from "./football-extended-market.js";

export type FootballStatistic = "GOALS" | "CORNERS" | "CARDS" | "YELLOW_CARDS" | "SHOTS" | "SHOTS_ON_TARGET" | "ASSISTS" | "FOULS" | "TACKLES" | "OFFSIDES" | "THROW_INS" | "GOAL_KICKS" | "SAVES" | "WOODWORK";
export type FootballBinaryFamily = "HANDICAP" | "TOTAL" | "ODD_EVEN" | "YES_NO";
export type FootballBinaryOutcome = "HOME" | "AWAY" | "OVER" | "UNDER" | "ODD" | "EVEN" | "YES" | "NO";
export type FootballBinaryLinePolicy = "HALF_UNIT" | "NONE" | "POSITIVE_INTEGER";

export interface FootballBinaryMarketSpec {
  readonly marketType: MarketType;
  readonly statistic: FootballStatistic;
  readonly scope: Extract<Scope, "FULL_TIME" | "FIRST_HALF" | "SECOND_HALF" | "EXTRA_TIME" | "EXTRA_TIME_FIRST_HALF">;
  readonly family: FootballBinaryFamily;
  readonly outcomes: readonly [FootballBinaryOutcome, FootballBinaryOutcome];
  readonly linePolicy: FootballBinaryLinePolicy;
  readonly settlementProfile: string;
}

const totalOutcomes = ["OVER", "UNDER"] as const;
const handicapOutcomes = ["HOME", "AWAY"] as const;
const oddEvenOutcomes = ["ODD", "EVEN"] as const;
const yesNoOutcomes = ["YES", "NO"] as const;

function lineSpec(input: Omit<FootballBinaryMarketSpec, "linePolicy">): FootballBinaryMarketSpec {
  return { ...input, linePolicy: "HALF_UNIT" };
}

function noLineSpec(input: Omit<FootballBinaryMarketSpec, "linePolicy">): FootballBinaryMarketSpec {
  return { ...input, linePolicy: "NONE" };
}

const specs: Readonly<Partial<Record<MarketType, FootballBinaryMarketSpec>>> = {
  ...extendedFootballBinarySpecs,
  FT_AH: lineSpec({ marketType: "FT_AH", statistic: "GOALS", scope: "FULL_TIME", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-regulation-including-added-time" }),
  FT_TOTAL: lineSpec({ marketType: "FT_TOTAL", statistic: "GOALS", scope: "FULL_TIME", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-regulation-including-added-time" }),
  FH_AH: lineSpec({ marketType: "FH_AH", statistic: "GOALS", scope: "FIRST_HALF", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-first-half-including-added-time" }),
  FH_TOTAL: lineSpec({ marketType: "FH_TOTAL", statistic: "GOALS", scope: "FIRST_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-first-half-including-added-time" }),
  SH_AH: lineSpec({ marketType: "SH_AH", statistic: "GOALS", scope: "SECOND_HALF", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-second-half-including-added-time" }),
  SH_TOTAL: lineSpec({ marketType: "SH_TOTAL", statistic: "GOALS", scope: "SECOND_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-second-half-including-added-time" }),
  CORNER_FT_AH: lineSpec({ marketType: "CORNER_FT_AH", statistic: "CORNERS", scope: "FULL_TIME", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-corners-regulation" }),
  CORNER_FT_TOTAL: lineSpec({ marketType: "CORNER_FT_TOTAL", statistic: "CORNERS", scope: "FULL_TIME", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-corners-regulation" }),
  CORNER_FH_AH: lineSpec({ marketType: "CORNER_FH_AH", statistic: "CORNERS", scope: "FIRST_HALF", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-corners-first-half" }),
  CORNER_FH_TOTAL: lineSpec({ marketType: "CORNER_FH_TOTAL", statistic: "CORNERS", scope: "FIRST_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-corners-first-half" }),
  CORNER_SH_TOTAL: lineSpec({ marketType: "CORNER_SH_TOTAL", statistic: "CORNERS", scope: "SECOND_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-corners-second-half" }),
  CARD_FT_AH: lineSpec({ marketType: "CARD_FT_AH", statistic: "CARDS", scope: "FULL_TIME", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-cards-regulation" }),
  CARD_FT_TOTAL: lineSpec({ marketType: "CARD_FT_TOTAL", statistic: "CARDS", scope: "FULL_TIME", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-cards-regulation" }),
  CARD_FH_AH: lineSpec({ marketType: "CARD_FH_AH", statistic: "CARDS", scope: "FIRST_HALF", family: "HANDICAP",
    outcomes: handicapOutcomes, settlementProfile: "football-cards-first-half" }),
  CARD_FH_TOTAL: lineSpec({ marketType: "CARD_FH_TOTAL", statistic: "CARDS", scope: "FIRST_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-cards-first-half" }),
  FT_ODD_EVEN: noLineSpec({ marketType: "FT_ODD_EVEN", statistic: "GOALS", scope: "FULL_TIME", family: "ODD_EVEN",
    outcomes: oddEvenOutcomes, settlementProfile: "football-goals-odd-even-regulation" }),
  FH_ODD_EVEN: noLineSpec({ marketType: "FH_ODD_EVEN", statistic: "GOALS", scope: "FIRST_HALF", family: "ODD_EVEN",
    outcomes: oddEvenOutcomes, settlementProfile: "football-goals-odd-even-first-half" }),
  SH_ODD_EVEN: noLineSpec({ marketType: "SH_ODD_EVEN", statistic: "GOALS", scope: "SECOND_HALF", family: "ODD_EVEN",
    outcomes: oddEvenOutcomes, settlementProfile: "football-goals-odd-even-second-half" }),
  CORNER_FT_ODD_EVEN: noLineSpec({ marketType: "CORNER_FT_ODD_EVEN", statistic: "CORNERS", scope: "FULL_TIME",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-corners-odd-even-regulation" }),
  CORNER_FH_ODD_EVEN: noLineSpec({ marketType: "CORNER_FH_ODD_EVEN", statistic: "CORNERS", scope: "FIRST_HALF",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-corners-odd-even-first-half" }),
  FT_BTTS: noLineSpec({ marketType: "FT_BTTS", statistic: "GOALS", scope: "FULL_TIME", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-btts-regulation" }),
  FH_BTTS: noLineSpec({ marketType: "FH_BTTS", statistic: "GOALS", scope: "FIRST_HALF", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-btts-first-half" }),
  SH_BTTS: noLineSpec({ marketType: "SH_BTTS", statistic: "GOALS", scope: "SECOND_HALF", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-btts-second-half" }),
  FT_BOTH_TEAMS_SCORE_BOTH_HALVES: noLineSpec({ marketType: "FT_BOTH_TEAMS_SCORE_BOTH_HALVES", statistic: "GOALS",
    scope: "FULL_TIME", family: "YES_NO", outcomes: yesNoOutcomes,
    settlementProfile: "football-both-teams-score-both-halves" }),
  SENDING_OFF: noLineSpec({ marketType: "SENDING_OFF", statistic: "CARDS", scope: "FULL_TIME", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-sending-off-regulation" }),
  HOME_CORNER_FT_TOTAL: lineSpec({ marketType: "HOME_CORNER_FT_TOTAL", statistic: "CORNERS", scope: "FULL_TIME",
    family: "TOTAL", outcomes: totalOutcomes, settlementProfile: "football-home-corners-regulation" }),
  HOME_CORNER_FH_TOTAL: lineSpec({ marketType: "HOME_CORNER_FH_TOTAL", statistic: "CORNERS", scope: "FIRST_HALF",
    family: "TOTAL", outcomes: totalOutcomes, settlementProfile: "football-home-corners-first-half" }),
  AWAY_CORNER_FT_TOTAL: lineSpec({ marketType: "AWAY_CORNER_FT_TOTAL", statistic: "CORNERS", scope: "FULL_TIME",
    family: "TOTAL", outcomes: totalOutcomes, settlementProfile: "football-away-corners-regulation" }),
  AWAY_CORNER_FH_TOTAL: lineSpec({ marketType: "AWAY_CORNER_FH_TOTAL", statistic: "CORNERS", scope: "FIRST_HALF",
    family: "TOTAL", outcomes: totalOutcomes, settlementProfile: "football-away-corners-first-half" }),
  HOME_FT_SCORE_BOTH_HALVES: noLineSpec({ marketType: "HOME_FT_SCORE_BOTH_HALVES", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-home-score-both-halves" }),
  AWAY_FT_SCORE_BOTH_HALVES: noLineSpec({ marketType: "AWAY_FT_SCORE_BOTH_HALVES", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-away-score-both-halves" }),
  HOME_FT_WIN_BOTH_HALVES: noLineSpec({ marketType: "HOME_FT_WIN_BOTH_HALVES", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-home-win-both-halves" }),
  AWAY_FT_WIN_BOTH_HALVES: noLineSpec({ marketType: "AWAY_FT_WIN_BOTH_HALVES", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-away-win-both-halves" }),
  HOME_FT_WIN_EITHER_HALF: noLineSpec({ marketType: "HOME_FT_WIN_EITHER_HALF", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-home-win-either-half" }),
  AWAY_FT_WIN_EITHER_HALF: noLineSpec({ marketType: "AWAY_FT_WIN_EITHER_HALF", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-away-win-either-half" }),
  HOME_FT_ODD_EVEN: noLineSpec({ marketType: "HOME_FT_ODD_EVEN", statistic: "GOALS", scope: "FULL_TIME",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-home-goals-odd-even" }),
  AWAY_FT_ODD_EVEN: noLineSpec({ marketType: "AWAY_FT_ODD_EVEN", statistic: "GOALS", scope: "FULL_TIME",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-away-goals-odd-even" }),
  HOME_FH_ODD_EVEN: noLineSpec({ marketType: "HOME_FH_ODD_EVEN", statistic: "GOALS", scope: "FIRST_HALF",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-home-goals-odd-even-first-half" }),
  AWAY_FH_ODD_EVEN: noLineSpec({ marketType: "AWAY_FH_ODD_EVEN", statistic: "GOALS", scope: "FIRST_HALF",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-away-goals-odd-even-first-half" }),
  HOME_SH_ODD_EVEN: noLineSpec({ marketType: "HOME_SH_ODD_EVEN", statistic: "GOALS", scope: "SECOND_HALF",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-home-goals-odd-even-second-half" }),
  AWAY_SH_ODD_EVEN: noLineSpec({ marketType: "AWAY_SH_ODD_EVEN", statistic: "GOALS", scope: "SECOND_HALF",
    family: "ODD_EVEN", outcomes: oddEvenOutcomes, settlementProfile: "football-away-goals-odd-even-second-half" }),
  HOME_FT_WIN_TO_NIL: noLineSpec({ marketType: "HOME_FT_WIN_TO_NIL", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-home-win-to-nil" }),
  AWAY_FT_WIN_TO_NIL: noLineSpec({ marketType: "AWAY_FT_WIN_TO_NIL", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-away-win-to-nil" }),
  HOME_FT_CLEAN_SHEET: noLineSpec({ marketType: "HOME_FT_CLEAN_SHEET", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-home-clean-sheet" }),
  AWAY_FT_CLEAN_SHEET: noLineSpec({ marketType: "AWAY_FT_CLEAN_SHEET", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-away-clean-sheet" }),
  FT_BOTH_HALVES_OVER_TOTAL: lineSpec({ marketType: "FT_BOTH_HALVES_OVER_TOTAL", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-both-halves-over-total" }),
  FT_BOTH_HALVES_UNDER_TOTAL: lineSpec({ marketType: "FT_BOTH_HALVES_UNDER_TOTAL", statistic: "GOALS", scope: "FULL_TIME",
    family: "YES_NO", outcomes: yesNoOutcomes, settlementProfile: "football-both-halves-under-total" }),
  HOME_FT_TOTAL: lineSpec({ marketType: "HOME_FT_TOTAL", statistic: "GOALS", scope: "FULL_TIME", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-home-goals-regulation" }),
  AWAY_FT_TOTAL: lineSpec({ marketType: "AWAY_FT_TOTAL", statistic: "GOALS", scope: "FULL_TIME", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-away-goals-regulation" }),
  HOME_FH_TOTAL: lineSpec({ marketType: "HOME_FH_TOTAL", statistic: "GOALS", scope: "FIRST_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-home-goals-first-half" }),
  AWAY_FH_TOTAL: lineSpec({ marketType: "AWAY_FH_TOTAL", statistic: "GOALS", scope: "FIRST_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-away-goals-first-half" }),
  HOME_SH_TOTAL: lineSpec({ marketType: "HOME_SH_TOTAL", statistic: "GOALS", scope: "SECOND_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-home-goals-second-half" }),
  AWAY_SH_TOTAL: lineSpec({ marketType: "AWAY_SH_TOTAL", statistic: "GOALS", scope: "SECOND_HALF", family: "TOTAL",
    outcomes: totalOutcomes, settlementProfile: "football-away-goals-second-half" }),
  HOME_FT_TO_WIN: noLineSpec({ marketType: "HOME_FT_TO_WIN", statistic: "GOALS", scope: "FULL_TIME", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-home-to-win-regulation" }),
  AWAY_FT_TO_WIN: noLineSpec({ marketType: "AWAY_FT_TO_WIN", statistic: "GOALS", scope: "FULL_TIME", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-away-to-win-regulation" }),
  FT_ANY_TEAM_TO_WIN: noLineSpec({ marketType: "FT_ANY_TEAM_TO_WIN", statistic: "GOALS", scope: "FULL_TIME", family: "YES_NO",
    outcomes: yesNoOutcomes, settlementProfile: "football-any-team-to-win-regulation" }),
  YELLOW_CARD_FT_TOTAL: lineSpec({ marketType: "YELLOW_CARD_FT_TOTAL", statistic: "YELLOW_CARDS", scope: "FULL_TIME",
    family: "TOTAL", outcomes: totalOutcomes, settlementProfile: "football-yellow-cards-regulation" })
};

export function footballBinaryMarketSpec(marketType: MarketType): FootballBinaryMarketSpec | null {
  return specs[marketType] ?? null;
}

export function isNoPushFootballLine(line: string | null): boolean {
  if (line === null || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(line)) return false;
  const doubled = Math.abs(Number(line)) * 2;
  return Number.isSafeInteger(doubled) && doubled % 2 === 1;
}
