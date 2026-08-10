import type { ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { Decimal, optimizeStakes } from "@tool-chenh/core";
import type { ComparisonRow } from "../catalog/comparison.js";

export interface WatchStakePolicy {
  readonly currency: string;
  readonly bankroll: string;
  readonly minStake: string;
  readonly maxStake: string;
  readonly stakeStep: string;
  readonly balance: string;
}

export interface WatchArbitrageLeg {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly decimalOdds: string;
  readonly stake: string;
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
  bankroll: "100000",
  minStake: "30000",
  maxStake: "100000",
  stakeStep: "1000",
  balance: "100000"
};

const OUTCOME_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  FT_1X2: ["HOME", "DRAW", "AWAY"],
  FT_TOTAL: ["OVER", "UNDER"]
};

function plainDecimal(value: Decimal): string {
  return value.toFixed(value.decimalPlaces());
}

function exactDecimalOdds(quote: ProviderQuote): Decimal | null {
  try {
    const raw = new Decimal(quote.rawOdds);
    if (!raw.isFinite()) return null;
    if (quote.rawFormat === "DECIMAL") return raw.gt(1) ? raw : null;
    if (quote.rawFormat !== "MALAY" || raw.isZero() || raw.abs().gt(1)) return null;
    const decimal = raw.gt(0) ? raw.plus(1) : new Decimal(1).plus(new Decimal(1).div(raw.abs()));
    return decimal.gt(1) ? decimal : null;
  } catch {
    return null;
  }
}

export function buildArbitrageAlert(
  row: ComparisonRow,
  selectedProviders: ReadonlySet<ProviderId>,
  policy: WatchStakePolicy = DEFAULT_WATCH_STAKE_POLICY
): WatchArbitrageAlert | null {
  const outcomes = OUTCOME_DOMAINS[row.marketType];
  if (outcomes === undefined) return null;

  const bestLegs: Omit<WatchArbitrageLeg, "stake">[] = [];
  for (const selection of outcomes) {
    const candidates = row.cells.flatMap((cell) => {
      if (!selectedProviders.has(cell.provider) || cell.market.status !== "OPEN") return [];
      return cell.quotes.flatMap((quote) => {
        if (quote.selection !== selection || quote.status !== "OPEN") return [];
        const odds = exactDecimalOdds(quote);
        return odds === null ? [] : [{ provider: cell.provider, selection, odds }];
      });
    }).sort((left, right) => right.odds.comparedTo(left.odds) || left.provider.localeCompare(right.provider));
    const best = candidates[0];
    if (best === undefined) return null;
    bestLegs.push({ provider: best.provider, selection, decimalOdds: plainDecimal(best.odds) });
  }

  if (new Set(bestLegs.map((leg) => leg.provider)).size < 2) return null;

  try {
    const plan = optimizeStakes({
      odds: bestLegs.map((leg) => leg.decimalOdds),
      constraints: bestLegs.map(() => ({
        minStake: policy.minStake,
        maxStake: policy.maxStake,
        stakeStep: policy.stakeStep,
        balance: policy.balance
      })),
      bankroll: policy.bankroll,
      minimumWorstCaseProfit: "0",
      minimumRoi: "0"
    });
    if (plan === null || !new Decimal(plan.worstCaseProfit).gt(0) || !new Decimal(plan.roi).gt(0)) return null;
    const legs = bestLegs.map((leg, index): WatchArbitrageLeg => ({ ...leg, stake: plan.stakes[index]! }));
    const fingerprint = [row.key, ...legs.map((leg) =>
      `${leg.provider}|${leg.selection}|${leg.decimalOdds}|${leg.stake}`)].join("::");
    return {
      fingerprint, marketType: row.marketType, scope: row.scope, line: row.line,
      currency: policy.currency, legs, totalStake: plan.totalStake,
      worstCasePayout: plan.worstCasePayout, worstCaseProfit: plan.worstCaseProfit, roi: plan.roi
    };
  } catch {
    return null;
  }
}
