import type { ProviderId, ProviderQuote, ProviderStakeConstraint } from "@tool-chenh/contracts";
import { Decimal, effectiveDecimal, type FeeModel } from "@tool-chenh/core";
import { exactTwoWayOutcomeDomain, type ComparisonCell, type ComparisonRow } from "../catalog/comparison.js";

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

type StakeComparableRow = Pick<ComparisonRow, "key" | "marketType" | "scope" | "line" | "cells">;

export interface OpposingLegPair {
  readonly first: { readonly provider: ProviderId; readonly quote: ProviderQuote };
  readonly second: { readonly provider: ProviderId; readonly quote: ProviderQuote };
}

export interface AnchoredStakeInput {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly stake: string;
}

function plain(value: Decimal): string {
  return value.toFixed(value.decimalPlaces());
}

function oddsOf(quote: ProviderQuote): Decimal | null {
  try {
    const raw = new Decimal(quote.rawOdds);
    if (!raw.isFinite()) return null;
    if (quote.rawFormat === "DECIMAL") return raw.gt(1) ? raw : null;
    if (quote.rawFormat === "HK") return raw.gt(0) ? raw.plus(1) : null;
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
  readonly providerSelectionId: string;
}

type SettlementFactors = readonly [Decimal, Decimal];

function settlementFactors(row: StakeComparableRow, firstOdds: Decimal,
  secondOdds: Decimal): readonly SettlementFactors[] | null {
  const expected = exactTwoWayOutcomeDomain(row.marketType, row.scope, row.line);
  if (expected === null) return null;
  if (row.line === null || row.marketType === "SERIES_WINNER" || row.marketType === "MAP_WINNER") {
    return [[firstOdds, new Decimal(0)], [new Decimal(0), secondOdds]];
  }
  const line = Number(row.line);
  if (!Number.isFinite(line)) return null;
  const fraction = Math.abs(line) % 1;
  const extremes: readonly SettlementFactors[] = [
    [firstOdds, new Decimal(0)], [new Decimal(0), secondOdds]
  ];
  if (Math.abs(fraction - 0.5) < 1e-9) return extremes;
  if (Math.abs(fraction - 0.25) >= 1e-9 && Math.abs(fraction - 0.75) >= 1e-9) return null;

  let firstHalfWin: boolean;
  if (row.marketType === "FT_TOTAL" || row.marketType === "FH_TOTAL" || row.marketType === "SH_TOTAL" ||
    row.marketType === "CORNER_FT_TOTAL" || row.marketType === "CORNER_FH_TOTAL" ||
    row.marketType === "CARD_FT_TOTAL" || row.marketType === "CARD_FH_TOTAL") {
    firstHalfWin = Math.abs(fraction - 0.75) < 1e-9;
  } else {
    const homeHalfWin = (Math.abs(fraction - 0.25) < 1e-9 && line > 0) ||
      (Math.abs(fraction - 0.75) < 1e-9 && line < 0);
    // Handicap domains are canonicalized as AWAY, HOME, so the first leg has
    // the inverse half-settlement of the home handicap encoded by row.line.
    firstHalfWin = !homeHalfWin;
  }
  const halfWin = (odds: Decimal) => odds.plus(1).div(2);
  const middle: SettlementFactors = firstHalfWin
    ? [halfWin(firstOdds), new Decimal(0.5)]
    : [new Decimal(0.5), halfWin(secondOdds)];
  return [extremes[0]!, middle, extremes[1]!];
}

function sameLine(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  try {
    return new Decimal(left).isFinite() && new Decimal(right).isFinite() && new Decimal(left).eq(right);
  } catch {
    return false;
  }
}

function exactMarketCell(row: StakeComparableRow, cell: ComparisonCell,
  expectedDomain: ReadonlySet<string>): boolean {
  if (cell.provider !== cell.market.provider || cell.market.marketType !== row.marketType ||
    cell.market.scope !== row.scope || !sameLine(cell.market.line, row.line) || cell.quotes.length === 0) return false;
  const expectedCategory = row.marketType === "SERIES_WINNER" || row.marketType === "MAP_WINNER"
    ? "LOL" : "FOOTBALL";
  if (cell.market.category !== expectedCategory) return false;
  const selections = cell.quotes.map((quote) => quote.selection);
  const selectionIds = cell.quotes.map((quote) => quote.providerSelectionId);
  if (new Set(selections).size !== selections.length || new Set(selectionIds).size !== selectionIds.length ||
    selections.some((selection) => !expectedDomain.has(selection))) return false;
  return cell.quotes.every((quote) => quote.provider === cell.provider && quote.category === cell.market.category &&
    quote.providerEventId === cell.market.providerEventId && quote.providerMarketId === cell.market.providerMarketId &&
    quote.marketType === row.marketType && quote.scope === row.scope && sameLine(quote.line, row.line));
}

function exactMarketCells(row: StakeComparableRow,
  selectedProviders: ReadonlySet<ProviderId>): readonly ComparisonCell[] {
  const expected = exactTwoWayOutcomeDomain(row.marketType, row.scope, row.line);
  if (expected === null) return [];
  const expectedDomain = new Set(expected);
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of row.cells) {
    if (!selectedProviders.has(cell.provider)) continue;
    byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  }
  return [...byProvider.values()].flatMap((cells) => cells.length === 1 &&
    exactMarketCell(row, cells[0]!, expectedDomain) ? [cells[0]!] : []);
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

export function enumerateOpposingLegPairs(row: ComparisonRow,
  selectedProviders: ReadonlySet<ProviderId>): readonly OpposingLegPair[] {
  const expected = exactTwoWayOutcomeDomain(row.marketType, row.scope, row.line);
  if (expected === null) return [];
  const cells = exactMarketCells(row, selectedProviders);
  const [firstSelection, secondSelection] = expected as readonly [string, string];
  const quotesFor = (selection: string) => cells.flatMap((cell) => {
    if (cell.market.status !== "OPEN") return [];
    return cell.quotes.filter((quote) => quote.selection === selection && quote.status === "OPEN" && oddsOf(quote) !== null)
      .map((quote) => ({ provider: cell.provider, quote, settlementProfile: cell.market.settlementProfile }));
  }).sort((left, right) => left.provider.localeCompare(right.provider) ||
    left.quote.providerSelectionId.localeCompare(right.quote.providerSelectionId));
  return quotesFor(firstSelection).flatMap((first) => quotesFor(secondSelection)
    .filter((second) => second.provider !== first.provider && second.settlementProfile === first.settlementProfile)
    .map((second) => ({
      first: { provider: first.provider, quote: first.quote },
      second: { provider: second.provider, quote: second.quote }
    })));
}

function pairLegs(row: StakeComparableRow, pair: OpposingLegPair): [BestLeg, BestLeg] | null {
  const expected = exactTwoWayOutcomeDomain(row.marketType, row.scope, row.line);
  if (expected === null || pair.first.provider === pair.second.provider ||
    [pair.first.quote.selection, pair.second.quote.selection].sort().join("|") !== expected.join("|")) return null;
  const pairProviders = new Set<ProviderId>([pair.first.provider, pair.second.provider]);
  const cells = exactMarketCells(row, pairProviders);
  if (cells.length !== 2 || cells[0]!.market.settlementProfile !== cells[1]!.market.settlementProfile) return null;
  const legs = [pair.first, pair.second].flatMap((candidate): BestLeg[] => {
    const cell = cells.find((item) => item.provider === candidate.provider && item.market.status === "OPEN" &&
      item.quotes.some((quote) => quote.providerSelectionId === candidate.quote.providerSelectionId));
    const quote = cell?.quotes.find((item) => item.providerSelectionId === candidate.quote.providerSelectionId &&
      item.selection === candidate.quote.selection && item.status === "OPEN");
    const odds = quote === undefined ? null : oddsOf(quote);
    return quote === undefined || odds === null ? [] : [{ provider: candidate.provider, selection: quote.selection, odds,
      providerSelectionId: quote.providerSelectionId }];
  });
  if (legs.length !== 2) return null;
  legs.sort((left, right) => left.odds.comparedTo(right.odds) || left.selection.localeCompare(right.selection) ||
    left.provider.localeCompare(right.provider) || left.providerSelectionId.localeCompare(right.providerSelectionId));
  return legs as [BestLeg, BestLeg];
}

function buildPlanForPair(row: StakeComparableRow, pair: OpposingLegPair,
  policy: FixedBaseStakePolicy, requireProfit: boolean, observedAtMs?: number,
  anchorInput?: AnchoredStakeInput): FixedBaseStakePlan | null {
  const bestLegs = pairLegs(row, pair);
  if (bestLegs === null) return null;

  const anchor = anchorInput === undefined ? bestLegs[0] : bestLegs.find((leg) =>
    leg.provider === anchorInput.provider && leg.selection === anchorInput.selection);
  if (anchor === undefined) return null;
  const calculated = bestLegs.find((leg) => leg !== anchor);
  if (calculated === undefined) return null;
  const anchorStake = policyDecimal(anchorInput?.stake ?? policy.baseStake);
  const anchorConstraint = resolveConstraint(anchor.provider, policy, observedAtMs);
  const calculatedConstraint = resolveConstraint(calculated.provider, policy, observedAtMs);
  if (anchorStake === null || anchorConstraint === null || calculatedConstraint === null ||
    anchorStake.lt(anchorConstraint.minStake) || anchorStake.gt(anchorConstraint.maxStake) ||
    anchorStake.gt(anchorConstraint.balance) || !anchorStake.mod(anchorConstraint.stakeStep).isZero()) return null;
  const anchorEffectiveOdds = effectiveDecimal(anchor.odds, anchorConstraint.fee);
  const calculatedEffectiveOdds = effectiveDecimal(calculated.odds, calculatedConstraint.fee);
  if (!anchorEffectiveOdds.gt(1) || !calculatedEffectiveOdds.gt(1)) return null;
  const expected = exactTwoWayOutcomeDomain(row.marketType, row.scope, row.line);
  if (expected === null) return null;
  const factors = settlementFactors(row,
    anchor.selection === expected[0] ? anchorEffectiveOdds : calculatedEffectiveOdds,
    anchor.selection === expected[0] ? calculatedEffectiveOdds : anchorEffectiveOdds);
  if (factors === null) return null;
  const byLeg = factors.map(([first, second]) => anchor.selection === expected[0]
    ? [first, second] as const : [second, first] as const);
  const intersections: Decimal[] = [];
  for (let leftIndex = 0; leftIndex < byLeg.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < byLeg.length; rightIndex += 1) {
      const left = byLeg[leftIndex]!;
      const right = byLeg[rightIndex]!;
      const denominator = left[1].minus(right[1]);
      if (denominator.isZero()) continue;
      const stake = anchorStake.times(right[0].minus(left[0])).div(denominator);
      if (stake.isFinite() && stake.gt(0)) intersections.push(stake);
    }
  }
  const rawCandidates = [calculatedConstraint.minStake,
    Decimal.min(calculatedConstraint.maxStake, calculatedConstraint.balance), ...intersections]
    .flatMap((stake) => [stake.div(calculatedConstraint.stakeStep).floor().times(calculatedConstraint.stakeStep),
      stake.div(calculatedConstraint.stakeStep).ceil().times(calculatedConstraint.stakeStep)]);
  const candidates = [...new Map(rawCandidates.map((stake) => [plain(stake), stake])).values()]
    .filter((stake) => stake.gte(calculatedConstraint.minStake) && stake.lte(calculatedConstraint.maxStake) &&
      stake.lte(calculatedConstraint.balance));

  const plans = candidates.flatMap((hedgeStake) => {
    const totalStake = anchorStake.plus(hedgeStake);
    const anchorPayout = anchorStake.times(anchorEffectiveOdds);
    const calculatedPayout = hedgeStake.times(calculatedEffectiveOdds);
    const anchorProfit = anchorPayout.minus(totalStake);
    const calculatedProfit = calculatedPayout.minus(totalStake);
    const scenarioProfits = byLeg.map(([anchorFactor, calculatedFactor]) =>
      anchorStake.times(anchorFactor).plus(hedgeStake.times(calculatedFactor)).minus(totalStake));
    const worstCaseProfit = Decimal.min(...scenarioProfits);
    if (requireProfit && !worstCaseProfit.gt(0)) return [];
    return [{ hedgeStake, totalStake, anchorPayout, calculatedPayout, anchorProfit, calculatedProfit,
      profitDifference: Decimal.max(...scenarioProfits).minus(worstCaseProfit), worstCaseProfit }];
  }).sort((left, right) => right.worstCaseProfit.comparedTo(left.worstCaseProfit) ||
    left.profitDifference.comparedTo(right.profitDifference) ||
    left.totalStake.comparedTo(right.totalStake));
  const plan = plans[0];
  if (plan === undefined) return null;

  const legs: readonly FixedBaseStakeLeg[] = [
    { provider: anchor.provider, selection: anchor.selection, decimalOdds: plain(anchor.odds), stake: plain(anchorStake),
      payout: plain(plan.anchorPayout), profit: plain(plan.anchorProfit), role: "BASE",
      feeType: anchorConstraint.feeType, feeRate: anchorConstraint.feeRate },
    { provider: calculated.provider, selection: calculated.selection, decimalOdds: plain(calculated.odds), stake: plain(plan.hedgeStake),
      payout: plain(plan.calculatedPayout), profit: plain(plan.calculatedProfit), role: "HEDGE",
      feeType: calculatedConstraint.feeType, feeRate: calculatedConstraint.feeRate }
  ];
  return {
    fingerprint: [row.key, plain(anchorStake), ...legs.map((leg) => {
      const identity = bestLegs.find((candidate) => candidate.provider === leg.provider && candidate.selection === leg.selection)!;
      return `${leg.provider}|${leg.selection}|${identity.providerSelectionId}|${leg.decimalOdds}|${leg.stake}`;
    })].join("::"),
    currency: policy.currency, legs, totalStake: plain(plan.totalStake),
    profitsBySelection: { [anchor.selection]: plain(plan.anchorProfit), [calculated.selection]: plain(plan.calculatedProfit) },
    worstCaseProfit: plain(plan.worstCaseProfit), roi: plain(plan.worstCaseProfit.div(plan.totalStake))
  };
}

export function buildFixedBaseStakePlanForPair(row: ComparisonRow, pair: OpposingLegPair,
  policy: FixedBaseStakePolicy, observedAtMs?: number): FixedBaseStakePlan | null {
  return buildPlanForPair(row, pair, policy, true, observedAtMs);
}

function bestPlan(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>, policy: FixedBaseStakePolicy,
  requireProfit: boolean, observedAtMs?: number): FixedBaseStakePlan | null {
  return enumerateOpposingLegPairs(row, selectedProviders)
    .flatMap((pair) => {
      const plan = buildPlanForPair(row, pair, policy, requireProfit, observedAtMs);
      return plan === null ? [] : [plan];
    }).sort((left, right) => new Decimal(right.worstCaseProfit).comparedTo(left.worstCaseProfit) ||
      new Decimal(right.roi).comparedTo(left.roi) || left.fingerprint.localeCompare(right.fingerprint))[0] ?? null;
}

export function buildFixedBaseStakePlan(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy, observedAtMs?: number): FixedBaseStakePlan | null {
  return bestPlan(row, selectedProviders, policy, true, observedAtMs);
}

export function buildObservedFixedBaseStakeEstimate(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>,
  policy: FixedBaseStakePolicy): FixedBaseStakePlan | null {
  return bestPlan(row, selectedProviders, policy, false);
}

export function buildObservedAnchoredStakeEstimate(row: ComparisonRow, pair: OpposingLegPair,
  policy: FixedBaseStakePolicy, anchor: AnchoredStakeInput): FixedBaseStakePlan | null {
  return buildPlanForPair(row, pair, policy, false, undefined, anchor);
}
