import type { ProviderId } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import type { ComparisonRow } from "../catalog/comparison.js";
import { buildFixedBaseStakePlan, type FixedBaseStakePolicy } from "./fixed-base-stake.js";

export type WatchStakePolicy = FixedBaseStakePolicy;

export interface WatchArbitrageLeg {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly decimalOdds: string;
  readonly stake: string;
  readonly payout: string;
  readonly profit: string;
  readonly role: "BASE" | "HEDGE";
}

export interface WatchArbitrageAlert {
  readonly fingerprint: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly currency: string;
  readonly legs: readonly WatchArbitrageLeg[];
  readonly totalStake: string;
  readonly worstCasePayout: string;
  readonly worstCaseProfit: string;
  readonly roi: string;
}

export const DEFAULT_WATCH_STAKE_POLICY: WatchStakePolicy = {
  currency: "VND",
  baseStake: "100000",
  minStake: "30000",
  maxStake: "100000",
  stakeStep: "1000",
  balance: "100000"
};

export function buildArbitrageAlert(
  row: ComparisonRow,
  selectedProviders: ReadonlySet<ProviderId>,
  policy: WatchStakePolicy = DEFAULT_WATCH_STAKE_POLICY
): WatchArbitrageAlert | null {
  try {
    const plan = buildFixedBaseStakePlan(row, selectedProviders, policy);
    if (plan === null) return null;
    const legs = plan.legs.map(({ provider, selection, decimalOdds, stake, payout, profit, role }): WatchArbitrageLeg =>
      ({ provider, selection, decimalOdds, stake, payout, profit, role }));
    const worstCasePayout = Decimal.min(...plan.legs.map((leg) => new Decimal(leg.payout)));
    return {
      fingerprint: plan.fingerprint, marketType: row.marketType, scope: row.scope, line: row.line,
      currency: plan.currency, legs, totalStake: plan.totalStake,
      worstCasePayout: worstCasePayout.toFixed(worstCasePayout.decimalPlaces()),
      worstCaseProfit: plan.worstCaseProfit, roi: plan.roi
    };
  } catch {
    return null;
  }
}
