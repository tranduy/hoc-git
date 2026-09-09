import type { MarketType, Scope } from "./domain.js";

export type FootballResultOutcome = "HOME" | "DRAW" | "AWAY";
export type FootballDoubleChanceOutcome = "HOME_DRAW" | "HOME_AWAY" | "DRAW_AWAY";
export type FootballResultSelection = FootballResultOutcome | FootballDoubleChanceOutcome;

export interface FootballResultMarketSpec {
  readonly marketType: MarketType;
  readonly family: "RESULT" | "DOUBLE_CHANCE";
  readonly scope: Extract<Scope, "FULL_TIME" | "FIRST_HALF" | "SECOND_HALF">;
  readonly outcomes: readonly FootballResultSelection[];
  readonly settlementProfile: string;
}

const resultOutcomes = ["HOME", "DRAW", "AWAY"] as const;
const doubleChanceOutcomes = ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"] as const;
const specs: Readonly<Partial<Record<MarketType, FootballResultMarketSpec>>> = Object.fromEntries(
  ([
    ["FT_1X2", "FT_DOUBLE_CHANCE", "FULL_TIME", "football-regulation-including-added-time"],
    ["FH_1X2", "FH_DOUBLE_CHANCE", "FIRST_HALF", "football-first-half-including-added-time"],
    ["SH_1X2", "SH_DOUBLE_CHANCE", "SECOND_HALF", "football-second-half-including-added-time"]
  ] as const).flatMap(([single, double, scope, settlementProfile]) => [
    [single, { marketType: single, family: "RESULT", scope, outcomes: resultOutcomes, settlementProfile }],
    [double, { marketType: double, family: "DOUBLE_CHANCE", scope, outcomes: doubleChanceOutcomes, settlementProfile }]
  ])
);

/** Result and double-chance markets are not themselves binary partitions. */
export function footballResultMarketSpec(marketType: MarketType): FootballResultMarketSpec | null {
  return specs[marketType] ?? null;
}

const complements: Readonly<Record<FootballResultSelection, FootballResultSelection>> = {
  HOME: "DRAW_AWAY", DRAW: "HOME_AWAY", AWAY: "HOME_DRAW",
  DRAW_AWAY: "HOME", HOME_AWAY: "DRAW", HOME_DRAW: "AWAY"
};

/** Exactly one selection wins for every regulation result in the same period. */
export function resultComplement(selection: string): FootballResultSelection | null {
  return Object.prototype.hasOwnProperty.call(complements, selection)
    ? complements[selection as FootballResultSelection] : null;
}
