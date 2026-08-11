import type { ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import type { ComparisonRow } from "../catalog/comparison.js";

export interface FixedBaseStakePolicy {
  readonly currency: string;
  readonly baseStake: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
}

export interface FixedBaseStakeLeg {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly decimalOdds: string;
  readonly stake: string;
  readonly payout: string;
  readonly profit: string;
  readonly role: "BASE" | "HEDGE";
}

export interface FixedBaseStakePlan {
  readonly fingerprint: string;
  readonly currency: string;
  readonly legs: readonly FixedBaseStakeLeg[];
  readonly totalStake: string;
  readonly profitsBySelection: Readonly<Record<string, string>>;
  readonly worstCaseProfit: string;
  readonly roi: string;
}

type StakeComparableRow = Pick<ComparisonRow, "key" | "marketType" | "cells">;

function plain(value: Decimal): string {
  return value.toFixed(value.decimalPlaces());
}

function oddsOf(quote: ProviderQuote): Decimal | null {
  try {
    const raw = new Decimal(quote.rawOdds);
    if (!raw.isFinite()) return null;
    if (quote.rawFormat === "DECIMAL") return raw.gt(1) ? raw : null;
    if (quote.rawFormat !== "MALAY" || raw.isZero() || raw.abs().gt(1)) return null;
    const odds = raw.gt(0) ? raw.plus(1) : new Decimal(1).plus(new Decimal(1).div(raw.abs()));
    return odds.gt(1) ? odds : null;
  } catch {
    return null;
  }
}

interface BestLeg {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly odds: Decimal;
}

function policyDecimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.gt(0) ? parsed : null;
  } catch {
    return null;
  }
}

function buildPlan(row: StakeComparableRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy, requireProfit: boolean): FixedBaseStakePlan | null {
  if (row.marketType === "FT_1X2") return null;
  const selections = [...new Set(row.cells.flatMap((cell) => cell.quotes.map((quote) => quote.selection)))].sort();
  if (selections.length !== 2) return null;

  const bestLegs: BestLeg[] = [];
  for (const selection of selections) {
    const candidates = row.cells.flatMap((cell): BestLeg[] => {
      if (!selectedProviders.has(cell.provider) || cell.market.status !== "OPEN") return [];
      return cell.quotes.flatMap((quote): BestLeg[] => {
        if (quote.selection !== selection || quote.status !== "OPEN") return [];
        const odds = oddsOf(quote);
        return odds === null ? [] : [{ provider: cell.provider, selection, odds }];
      });
    }).sort((left, right) => right.odds.comparedTo(left.odds) || left.provider.localeCompare(right.provider));
    if (candidates[0] === undefined) return null;
    bestLegs.push(candidates[0]);
  }
  if (new Set(bestLegs.map((leg) => leg.provider)).size !== 2) return null;
  bestLegs.sort((left, right) => left.odds.comparedTo(right.odds) ||
    left.selection.localeCompare(right.selection) || left.provider.localeCompare(right.provider));

  const baseStake = policyDecimal(policy.baseStake);
  const minStake = policyDecimal(policy.minStake);
  const maxStake = policyDecimal(policy.maxStake);
  const stakeStep = policyDecimal(policy.stakeStep);
  const balance = policyDecimal(policy.balance);
  if (baseStake === null || minStake === null || maxStake === null || stakeStep === null || balance === null ||
    maxStake.lt(minStake) || baseStake.lt(minStake) || baseStake.gt(maxStake) || baseStake.gt(balance) ||
    !baseStake.mod(stakeStep).isZero()) return null;

  const low = bestLegs[0]!;
  const high = bestLegs[1]!;
  const continuousHedge = baseStake.times(low.odds).div(high.odds);
  const lower = continuousHedge.div(stakeStep).floor().times(stakeStep);
  const upper = continuousHedge.div(stakeStep).ceil().times(stakeStep);
  const candidates = [...new Map([lower, upper].map((stake) => [plain(stake), stake])).values()]
    .filter((stake) => stake.gte(minStake) && stake.lte(maxStake) && stake.lte(balance));

  const plans = candidates.flatMap((hedgeStake) => {
    const totalStake = baseStake.plus(hedgeStake);
    const lowPayout = baseStake.times(low.odds);
    const highPayout = hedgeStake.times(high.odds);
    const lowProfit = lowPayout.minus(totalStake);
    const highProfit = highPayout.minus(totalStake);
    if (requireProfit && (!lowProfit.gt(0) || !highProfit.gt(0))) return [];
    return [{ hedgeStake, totalStake, lowPayout, highPayout, lowProfit, highProfit,
      worstCaseProfit: Decimal.min(lowProfit, highProfit) }];
  }).sort((left, right) => right.worstCaseProfit.comparedTo(left.worstCaseProfit) ||
    left.totalStake.comparedTo(right.totalStake));
  const plan = plans[0];
  if (plan === undefined) return null;

  const legs: readonly FixedBaseStakeLeg[] = [
    { provider: low.provider, selection: low.selection, decimalOdds: plain(low.odds), stake: plain(baseStake),
      payout: plain(plan.lowPayout), profit: plain(plan.lowProfit), role: "BASE" },
    { provider: high.provider, selection: high.selection, decimalOdds: plain(high.odds), stake: plain(plan.hedgeStake),
      payout: plain(plan.highPayout), profit: plain(plan.highProfit), role: "HEDGE" }
  ];
  return {
    fingerprint: [row.key, policy.baseStake, ...legs.map((leg) =>
      `${leg.provider}|${leg.selection}|${leg.decimalOdds}|${leg.stake}`)].join("::"),
    currency: policy.currency, legs, totalStake: plain(plan.totalStake),
    profitsBySelection: { [low.selection]: plain(plan.lowProfit), [high.selection]: plain(plan.highProfit) },
    worstCaseProfit: plain(plan.worstCaseProfit), roi: plain(plan.worstCaseProfit.div(plan.totalStake))
  };
}

export function buildFixedBaseStakePlan(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy): FixedBaseStakePlan | null {
  return buildPlan(row, selectedProviders, policy, true);
}

export function buildObservedFixedBaseStakeEstimate(row: StakeComparableRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy): FixedBaseStakePlan | null {
  return buildPlan(row, selectedProviders, policy, false);
}
