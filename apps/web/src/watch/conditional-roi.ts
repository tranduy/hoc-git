import { Decimal } from "@tool-chenh/core";
import { comparisonOutcomeDomain, comparisonSettlementCases, type ComparisonRow } from "../catalog/comparison.js";
import type { FixedBaseStakePlan } from "./fixed-base-stake.js";

export interface ConditionalRoi {
  readonly minimumProfit: string;
  readonly roiPercent: string;
}

/** Presentation only: a zero guarantee can coexist with profit outside a full refund. */
export function conditionalRoi(row: Pick<ComparisonRow, "marketType" | "scope" | "line" | "opposition">,
  plan: FixedBaseStakePlan): ConditionalRoi | null {
  try {
    if (!new Decimal(plan.worstCaseProfit).isZero() || !new Decimal(plan.roi).isZero()) return null;
    const cases = comparisonSettlementCases(row);
    const outcomes = comparisonOutcomeDomain(row);
    const scenarios = plan.settlementScenarios;
    if (cases === null || outcomes === null || scenarios === undefined || scenarios.length !== cases.length ||
      new Set(scenarios.map(s => s.kind)).size !== scenarios.length || plan.legs.length !== 2 ||
      new Set(plan.legs.map(leg => leg.provider)).size !== 2 ||
      !outcomes.every(outcome => plan.legs.filter(leg => leg.selection === outcome).length === 1)) return null;
    const totalStake = new Decimal(plan.totalStake);
    const stakes = plan.legs.map(leg => new Decimal(leg.stake));
    if (!totalStake.isFinite() || !totalStake.gt(0) || stakes.some(stake => !stake.isFinite() || !stake.gt(0)) ||
      !stakes[0]!.plus(stakes[1]!).eq(totalStake)) return null;
    const profits: Decimal[] = [];
    let fullRefunds = 0;
    for (const settlement of cases) {
      const scenario = scenarios.find(s => s.kind === settlement.kind);
      if (scenario === undefined) return null;
      const profit = new Decimal(scenario.profit);
      if (!profit.isFinite()) return null;
      const fullRefund = settlement.factors.every(([won, refunded]) => won === 0 && refunded === 1);
      if (fullRefund) {
        if (!profit.isZero()) return null;
        fullRefunds += 1;
      } else {
        // A zero or negative partial settlement must never be hidden behind this label.
        if (!profit.gt(0)) return null;
        profits.push(profit);
      }
    }
    if (fullRefunds === 0 || profits.length === 0) return null;
    const minimumProfit = Decimal.min(...profits);
    return { minimumProfit: minimumProfit.toString(), roiPercent: minimumProfit.div(totalStake).times(100).toString() };
  } catch {
    return null;
  }
}
