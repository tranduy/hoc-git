import type { ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { Decimal, effectiveDecimal, type FeeModel } from "@tool-chenh/core";
import type { ComparisonRow } from "../catalog/comparison.js";

export interface FixedBaseStakePolicy {
  readonly currency: string;
  readonly baseStake: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
  readonly providerConstraints?: Readonly<Partial<Record<ProviderId, ProviderStakeConstraint>>>;
  readonly requireProviderConstraints?: boolean;
}

export interface ProviderStakeConstraint {
  readonly currency: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
  readonly feeType: "NONE" | "PROFIT" | "PAYOUT";
  readonly feeRate: string | null;
  readonly verifiedAsOfMs: number;
  readonly expiresAtMs: number;
}

export interface FixedBaseStakeLeg {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly decimalOdds: string;
  readonly stake: string;
  readonly payout: string;
  readonly profit: string;
  readonly role: "BASE" | "HEDGE";
  readonly feeType: "NONE" | "PROFIT" | "PAYOUT";
  readonly feeRate: string | null;
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

interface ResolvedConstraint {
  readonly minStake: Decimal;
  readonly maxStake: Decimal;
  readonly stakeStep: Decimal;
  readonly balance: Decimal;
  readonly fee: FeeModel;
  readonly feeType: "NONE" | "PROFIT" | "PAYOUT";
  readonly feeRate: string | null;
}

function resolveConstraint(provider: ProviderId, policy: FixedBaseStakePolicy, observedAtMs?: number): ResolvedConstraint | null {
  const providerConstraint = policy.providerConstraints?.[provider];
  if (providerConstraint === undefined && policy.requireProviderConstraints === true) return null;
  const source = providerConstraint ?? { currency: policy.currency, minStake: policy.minStake,
    maxStake: policy.maxStake, stakeStep: policy.stakeStep, balance: policy.balance,
    feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: 0, expiresAtMs: Number.MAX_SAFE_INTEGER };
  if (source.currency !== policy.currency || (observedAtMs !== undefined &&
    (source.verifiedAsOfMs > observedAtMs || source.expiresAtMs < observedAtMs))) return null;
  const minStake = policyDecimal(source.minStake);
  const maxStake = policyDecimal(source.maxStake);
  const stakeStep = policyDecimal(source.stakeStep);
  const balance = policyDecimal(source.balance);
  if (minStake === null || maxStake === null || stakeStep === null || balance === null || maxStake.lt(minStake)) return null;
  if ((source.feeType === "NONE") !== (source.feeRate === null)) return null;
  let fee: FeeModel;
  if (source.feeType === "NONE") fee = { type: "NONE" };
  else {
    const rate = source.feeRate === null ? null : policyDecimal(source.feeRate);
    if (rate === null || rate.gte(1)) return null;
    fee = { type: source.feeType, rate };
  }
  return { minStake, maxStake, stakeStep, balance, fee, feeType: source.feeType, feeRate: source.feeRate };
}

function buildPlan(row: StakeComparableRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy, requireProfit: boolean, observedAtMs?: number): FixedBaseStakePlan | null {
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
  const low = bestLegs[0]!;
  const high = bestLegs[1]!;
  const lowConstraint = resolveConstraint(low.provider, policy, observedAtMs);
  const highConstraint = resolveConstraint(high.provider, policy, observedAtMs);
  if (baseStake === null || lowConstraint === null || highConstraint === null ||
    baseStake.lt(lowConstraint.minStake) || baseStake.gt(lowConstraint.maxStake) ||
    baseStake.gt(lowConstraint.balance) || !baseStake.mod(lowConstraint.stakeStep).isZero()) return null;
  const lowEffectiveOdds = effectiveDecimal(low.odds, lowConstraint.fee);
  const highEffectiveOdds = effectiveDecimal(high.odds, highConstraint.fee);
  if (!lowEffectiveOdds.gt(1) || !highEffectiveOdds.gt(1)) return null;
  const continuousHedge = baseStake.times(lowEffectiveOdds).div(highEffectiveOdds);
  const lower = continuousHedge.div(highConstraint.stakeStep).floor().times(highConstraint.stakeStep);
  const upper = continuousHedge.div(highConstraint.stakeStep).ceil().times(highConstraint.stakeStep);
  const candidates = [...new Map([lower, upper].map((stake) => [plain(stake), stake])).values()]
    .filter((stake) => stake.gte(highConstraint.minStake) && stake.lte(highConstraint.maxStake) &&
      stake.lte(highConstraint.balance));

  const plans = candidates.flatMap((hedgeStake) => {
    const totalStake = baseStake.plus(hedgeStake);
    const lowPayout = baseStake.times(lowEffectiveOdds);
    const highPayout = hedgeStake.times(highEffectiveOdds);
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
      payout: plain(plan.lowPayout), profit: plain(plan.lowProfit), role: "BASE",
      feeType: lowConstraint.feeType, feeRate: lowConstraint.feeRate },
    { provider: high.provider, selection: high.selection, decimalOdds: plain(high.odds), stake: plain(plan.hedgeStake),
      payout: plain(plan.highPayout), profit: plain(plan.highProfit), role: "HEDGE",
      feeType: highConstraint.feeType, feeRate: highConstraint.feeRate }
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
  policy: FixedBaseStakePolicy, observedAtMs?: number): FixedBaseStakePlan | null {
  return buildPlan(row, selectedProviders, policy, true, observedAtMs);
}

export function buildObservedFixedBaseStakeEstimate(row: StakeComparableRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy): FixedBaseStakePlan | null {
  return buildPlan(row, selectedProviders, policy, false);
}
