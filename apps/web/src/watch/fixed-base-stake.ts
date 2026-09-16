import { sameNativePlayer, footballBinaryMarketSpec, type ProviderId, type ProviderQuote, type ProviderStakeConstraint, type ProviderPlayerIdentity } from "@tool-chenh/contracts";
import { Decimal, effectiveDecimal, type FeeModel } from "@tool-chenh/core";
import { comparisonOutcomeDomain, comparisonSettlementCases, exactPartitionOutcomeDomain, isResultOppositionCell,
  distinctResultSourceCells, isAvailableTwoWayTicket, hasValidComparisonPlayerBinding, sameComparisonPlayer,
  type TwoWaySettlementCase, type ComparisonCell, type ComparisonRow } from "../catalog/comparison.js";

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
  readonly player?: ProviderPlayerIdentity;
  readonly providerEventId?: string;
  readonly providerMarketId?: string;
  readonly providerSelectionId?: string;
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
  readonly settlementScenarios?: readonly { readonly kind: TwoWaySettlementCase["kind"]; readonly profit: string }[];
}

type StakeComparableRow = Pick<ComparisonRow, "key" | "marketType" | "scope" | "line" | "cells" | "opposition">;

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

/**
 * Decoding a price is a pure function of its raw text and format, and Decimal
 * is immutable, so the same pair always yields the same instance-equivalent
 * value. Profiled 2026-09-16: decimal.js was the largest single file on the
 * main thread at 4.8% of samples, because every ranking pass re-parsed every
 * quote of every row. Caching the decode changes no result; it only stops the
 * same string being parsed thousands of times per polling round.
 *
 * Bounded so a long session cannot grow it without limit. Clearing whole is
 * safe: the next call simply decodes again.
 */
const decodedOdds = new Map<string, Decimal | null>();
const DECODED_ODDS_LIMIT = 50_000;

function oddsOf(quote: ProviderQuote): Decimal | null {
  const cacheKey = quote.rawFormat + '|' + quote.rawOdds;
  const cached = decodedOdds.get(cacheKey);
  if (cached !== undefined || decodedOdds.has(cacheKey)) return cached ?? null;
  const decoded = decodeOdds(quote);
  if (decodedOdds.size >= DECODED_ODDS_LIMIT) decodedOdds.clear();
  decodedOdds.set(cacheKey, decoded);
  return decoded;
}

function decodeOdds(quote: ProviderQuote): Decimal | null {
  try {
    const raw = new Decimal(quote.rawOdds);
    if (!raw.isFinite()) return null;
    if (quote.rawFormat === "DECIMAL") return raw.gt(1) ? raw : null;
    if (quote.rawFormat === "HK") return raw.gt(0) ? raw.plus(1) : null;
    if (quote.rawFormat === "AMERICAN") return raw.gte(100) ? raw.div(100).plus(1)
      : raw.lte(-100) ? new Decimal(100).div(raw.abs()).plus(1) : null;
    if (quote.rawFormat !== "MALAY" || raw.isZero() || raw.abs().gt(1)) return null;
    const odds = raw.gt(0) ? raw.plus(1) : new Decimal(1).plus(new Decimal(1).div(raw.abs()));
    return odds.gt(1) ? odds : null;
  } catch {
    return null;
  }
}

interface BestLeg {
  readonly player?: ProviderPlayerIdentity;
  readonly provider: ProviderId;
  readonly selection: string;
  readonly odds: Decimal;
  readonly providerSelectionId: string;
  readonly providerMarketId: string;
  readonly providerEventId: string;
}

export function stakeLegMatchesQuote(leg: Pick<FixedBaseStakeLeg, "provider" | "selection" | "providerEventId" | "providerMarketId" | "providerSelectionId" | "player">,
  quote: ProviderQuote): boolean {
  return leg.provider === quote.provider && leg.selection === quote.selection &&
    (leg.providerEventId === undefined || leg.providerEventId === quote.providerEventId) &&
    (leg.providerMarketId === undefined || leg.providerMarketId === quote.providerMarketId) &&
    (leg.providerSelectionId === undefined || leg.providerSelectionId === quote.providerSelectionId) &&
    (quote.marketType.startsWith("PLAYER_") || leg.player !== undefined || quote.player !== undefined
      ? sameNativePlayer(leg.player, quote.player) : true);
}

type SettlementFactors = readonly [Decimal, Decimal];

function settlementFactors(row: StakeComparableRow, firstOdds: Decimal,
  secondOdds: Decimal): readonly SettlementFactors[] | null {
  return comparisonSettlementCases(row)?.map(({ factors: [first, second] }) => [
    firstOdds.times(first[0]).plus(first[1]), secondOdds.times(second[0]).plus(second[1])
  ] as const) ?? null;
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
  if (cell.market.category !== expectedCategory || !hasValidComparisonPlayerBinding(cell)) return false;
  if (footballBinaryMarketSpec(cell.market.marketType)?.linePolicy === "POSITIVE_INTEGER" && !isAvailableTwoWayTicket(cell)) return false;
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
  const expected = comparisonOutcomeDomain(row);
  if (expected === null) return [];
  if (row.opposition !== undefined) {
    const candidates = row.cells.filter(cell => selectedProviders.has(cell.provider) && isResultOppositionCell(row, cell));
    return distinctResultSourceCells(candidates);
  }
  const expectedDomain = new Set(expected);
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of distinctResultSourceCells(row.cells)) {
    if (!selectedProviders.has(cell.provider)) continue;
    byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  }
  return [...byProvider.values()].flatMap((cells) => {
    if (cells.length === 1) return exactMarketCell(row, cells[0]!, expectedDomain) ? [cells[0]!] : [];
    const valid = cells.filter(cell => exactMarketCell(row, cell, expectedDomain) && isAvailableTwoWayTicket(cell));
    const first = valid[0];
    if (first === undefined || valid.some(cell => cell.market.providerEventId !== first.market.providerEventId ||
      cell.market.settlementProfile !== first.market.settlementProfile)) return [];
    return valid.filter(cell => valid.filter(other => other.market.providerMarketId === cell.market.providerMarketId).length === 1);
  });
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
  const expected = comparisonOutcomeDomain(row);
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
    .filter((second) => second.provider !== first.provider && second.settlementProfile === first.settlementProfile &&
      sameComparisonPlayer(first.quote, second.quote))
    .map((second) => ({
      first: { provider: first.provider, quote: first.quote },
      second: { provider: second.provider, quote: second.quote }
    })));
}

function pairLegs(row: StakeComparableRow, pair: OpposingLegPair): [BestLeg, BestLeg] | null {
  const expected = comparisonOutcomeDomain(row);
  if (expected === null || pair.first.provider === pair.second.provider ||
    [pair.first.quote.selection, pair.second.quote.selection].sort().join("|") !== expected.join("|")) return null;
  const pairProviders = new Set<ProviderId>([pair.first.provider, pair.second.provider]);
  const cells = exactMarketCells(row, pairProviders).filter(cell => [pair.first, pair.second].some(candidate =>
    candidate.provider === cell.provider && candidate.quote.providerMarketId === cell.market.providerMarketId &&
    cell.quotes.some(quote => quote.providerSelectionId === candidate.quote.providerSelectionId)));
  if (cells.length !== 2 || cells[0]!.market.settlementProfile !== cells[1]!.market.settlementProfile ||
    !sameComparisonPlayer(cells[0]!.market, cells[1]!.market)) return null;
  const legs = [pair.first, pair.second].flatMap((candidate): BestLeg[] => {
    const cell = cells.find((item) => item.provider === candidate.provider && item.market.status === "OPEN" &&
      item.market.providerMarketId === candidate.quote.providerMarketId &&
      item.quotes.some((quote) => quote.providerSelectionId === candidate.quote.providerSelectionId));
    const quote = cell?.quotes.find((item) => item.providerSelectionId === candidate.quote.providerSelectionId &&
      item.selection === candidate.quote.selection && item.status === "OPEN" &&
      (item.marketType.startsWith("PLAYER_") ? sameNativePlayer(item.player, candidate.quote.player) : candidate.quote.player === undefined));
    const odds = quote === undefined ? null : oddsOf(quote);
    return quote === undefined || odds === null ? [] : [{ provider: candidate.provider, selection: quote.selection, odds,
      providerSelectionId: quote.providerSelectionId, providerMarketId: quote.providerMarketId,
      providerEventId: quote.providerEventId, ...(quote.player === undefined ? {} : { player: quote.player }) }];
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
  const expected = comparisonOutcomeDomain(row);
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
      profitDifference: Decimal.max(...scenarioProfits).minus(worstCaseProfit), worstCaseProfit, scenarioProfits }];
  }).sort((left, right) => right.worstCaseProfit.comparedTo(left.worstCaseProfit) ||
    left.profitDifference.comparedTo(right.profitDifference) ||
    left.totalStake.comparedTo(right.totalStake));
  const plan = plans[0];
  if (plan === undefined) return null;

  const legs: readonly FixedBaseStakeLeg[] = [
    { provider: anchor.provider, selection: anchor.selection, providerEventId: anchor.providerEventId,
      ...(anchor.player === undefined ? {} : { player: anchor.player }),
      providerMarketId: anchor.providerMarketId, providerSelectionId: anchor.providerSelectionId,
      decimalOdds: plain(anchor.odds), stake: plain(anchorStake),
      payout: plain(plan.anchorPayout), profit: plain(plan.anchorProfit), role: "BASE",
      feeType: anchorConstraint.feeType, feeRate: anchorConstraint.feeRate },
    { provider: calculated.provider, selection: calculated.selection, providerEventId: calculated.providerEventId,
      ...(calculated.player === undefined ? {} : { player: calculated.player }),
      providerMarketId: calculated.providerMarketId, providerSelectionId: calculated.providerSelectionId,
      decimalOdds: plain(calculated.odds), stake: plain(plan.hedgeStake),
      payout: plain(plan.calculatedPayout), profit: plain(plan.calculatedProfit), role: "HEDGE",
      feeType: calculatedConstraint.feeType, feeRate: calculatedConstraint.feeRate }
  ];
  return {
    fingerprint: [row.key, plain(anchorStake), ...legs.map((leg) => {
      const identity = bestLegs.find((candidate) => candidate.provider === leg.provider && candidate.selection === leg.selection)!;
      const player = leg.player === undefined ? "" : `|${JSON.stringify(leg.player)}`;
      return `${leg.provider}|${leg.selection}|${identity.providerEventId}|${identity.providerMarketId}|${identity.providerSelectionId}|${leg.decimalOdds}|${leg.stake}${player}`;
    })].join("::"),
    currency: policy.currency, legs, totalStake: plain(plan.totalStake),
    profitsBySelection: { [anchor.selection]: plain(plan.anchorProfit), [calculated.selection]: plain(plan.calculatedProfit) },
    worstCaseProfit: plain(plan.worstCaseProfit), roi: plain(plan.worstCaseProfit.div(plan.totalStake)),
    settlementScenarios: comparisonSettlementCases(row)!.map((scenario, index) =>
      ({ kind: scenario.kind, profit: plain(plan.scenarioProfits[index]!) }))
  };
}

/**
 * Cells a partition ticket may draw a leg from. exactMarketCells cannot serve
 * here: it resolves the two-way domain first and a partition row has none, so
 * it returns nothing at all.
 *
 * One cell per provider. A provider showing the same market twice is ambiguous
 * about which price is real, and an ambiguous leg is not a leg.
 */
function partitionCells(row: StakeComparableRow, selectedProviders: ReadonlySet<ProviderId>,
  domain: readonly string[]): readonly ComparisonCell[] {
  const wanted = [...domain].sort().join("|");
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of distinctResultSourceCells(row.cells)) {
    if (!selectedProviders.has(cell.provider)) continue;
    if (cell.market.marketType !== row.marketType || cell.market.scope !== row.scope ||
      cell.market.line !== null) continue;
    const selections = cell.quotes.map((quote) => quote.selection);
    if (selections.length !== domain.length || new Set(selections).size !== selections.length ||
      [...selections].sort().join("|") !== wanted) continue;
    if (!hasValidComparisonPlayerBinding(cell)) continue;
    byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  }
  return [...byProvider.values()].flatMap((cells) => cells.length === 1 ? [cells[0]!] : []);
}

/**
 * Stakes for a market whose outcomes partition with nothing to push, one leg on
 * each. Equal payout is the whole plan: with no push there is no result where
 * two legs pay together, so the anchor fixes the payout and every other leg buys
 * that same payout at its own price.
 *
 * Kept apart from the pair builder rather than folded into it. That one searches
 * a single hedge stake across settlement scenarios that can refund or split, and
 * none of that arithmetic has a meaning here.
 */
function buildPartitionPlan(row: StakeComparableRow, policy: FixedBaseStakePolicy,
  selectedProviders: ReadonlySet<ProviderId>, requireProfit: boolean,
  observedAtMs?: number, anchorInput?: AnchoredStakeInput): FixedBaseStakePlan | null {
  const domain = exactPartitionOutcomeDomain(row.marketType, row.scope, row.line);
  if (domain === null || domain.length < 2) return null;
  const cells = partitionCells(row, selectedProviders, domain);
  // One leg per outcome, each the best price on it, every leg settling the same way.
  const bestByOutcome = domain.map((selection) => cells.flatMap((cell) => {
    if (cell.market.status !== "OPEN") return [];
    return cell.quotes.filter((quote) => quote.selection === selection && quote.status === "OPEN")
      .flatMap((quote) => {
        const odds = oddsOf(quote);
        return odds === null ? [] : [{ provider: cell.provider, selection, odds,
          settlementProfile: cell.market.settlementProfile,
          providerSelectionId: quote.providerSelectionId, providerMarketId: quote.providerMarketId,
          providerEventId: quote.providerEventId }];
      });
  }).sort((left, right) => right.odds.comparedTo(left.odds) ||
    left.provider.localeCompare(right.provider) ||
    left.providerSelectionId.localeCompare(right.providerSelectionId))[0]);
  if (bestByOutcome.some((leg) => leg === undefined)) return null;
  const legsIn = bestByOutcome as NonNullable<(typeof bestByOutcome)[number]>[];
  if (new Set(legsIn.map((leg) => leg.settlementProfile)).size !== 1) return null;
  // One book holding every outcome is not a cross-book ticket.
  if (new Set(legsIn.map((leg) => leg.provider)).size < 2) return null;

  const constraints = legsIn.map((leg) => resolveConstraint(leg.provider, policy, observedAtMs));
  if (constraints.some((constraint) => constraint === null)) return null;
  const resolved = constraints as NonNullable<(typeof constraints)[number]>[];
  const effective = legsIn.map((leg, index) => effectiveDecimal(leg.odds, resolved[index]!.fee));
  if (effective.some((odds) => !odds.gt(1))) return null;

  const anchorIndex = anchorInput === undefined ? 0
    : legsIn.findIndex((leg) => leg.provider === anchorInput.provider && leg.selection === anchorInput.selection);
  if (anchorIndex < 0) return null;
  const anchorStake = policyDecimal(anchorInput?.stake ?? policy.baseStake);
  const anchorConstraint = resolved[anchorIndex]!;
  if (anchorStake === null || anchorStake.lt(anchorConstraint.minStake) ||
    anchorStake.gt(anchorConstraint.maxStake) || anchorStake.gt(anchorConstraint.balance) ||
    !anchorStake.mod(anchorConstraint.stakeStep).isZero()) return null;

  // The payout the anchor buys. Every other leg is rounded to its own step both
  // ways, and the combination with the best worst case wins.
  const target = anchorStake.times(effective[anchorIndex]!);
  const options = legsIn.map((leg, index) => {
    void leg;
    if (index === anchorIndex) return [anchorStake];
    const constraint = resolved[index]!;
    const exact = target.div(effective[index]!);
    const rounded = [exact.div(constraint.stakeStep).floor().times(constraint.stakeStep),
      exact.div(constraint.stakeStep).ceil().times(constraint.stakeStep)]
      .filter((stake) => stake.gt(0) && stake.gte(constraint.minStake) &&
        stake.lte(constraint.maxStake) && stake.lte(constraint.balance));
    return [...new Map(rounded.map((stake) => [plain(stake), stake])).values()];
  });
  if (options.some((choices) => choices.length === 0)) return null;

  type PartitionCandidate = { stakes: Decimal[]; total: Decimal; profits: Decimal[]; worst: Decimal };
  let best: PartitionCandidate | null = null;
  const walk = (index: number, chosen: Decimal[]): void => {
    if (index === options.length) {
      const total = chosen.reduce((sum, stake) => sum.plus(stake), new Decimal(0));
      const profits = chosen.map((stake, legIndex) => stake.times(effective[legIndex]!).minus(total));
      const worst = Decimal.min(...profits);
      if (best === null || worst.gt(best.worst) || (worst.eq(best.worst) && total.lt(best.total))) {
        best = { stakes: [...chosen], total, profits, worst };
      }
      return;
    }
    for (const stake of options[index]!) walk(index + 1, [...chosen, stake]);
  };
  walk(0, []);
  if (best === null) return null;
  const plan = best as PartitionCandidate;
  if (requireProfit && !plan.worst.gt(0)) return null;

  const legs: readonly FixedBaseStakeLeg[] = legsIn.map((leg, index) => ({
    provider: leg.provider, selection: leg.selection, providerEventId: leg.providerEventId,
    providerMarketId: leg.providerMarketId, providerSelectionId: leg.providerSelectionId,
    decimalOdds: plain(leg.odds), stake: plain(plan.stakes[index]!),
    payout: plain(plan.stakes[index]!.times(effective[index]!)), profit: plain(plan.profits[index]!),
    role: index === anchorIndex ? "BASE" : "HEDGE",
    feeType: resolved[index]!.feeType, feeRate: resolved[index]!.feeRate
  }));
  return {
    fingerprint: [row.key, plain(anchorStake), ...legs.map((leg, index) =>
      `${leg.provider}|${leg.selection}|${legsIn[index]!.providerEventId}` +
      `|${legsIn[index]!.providerMarketId}|${legsIn[index]!.providerSelectionId}` +
      `|${leg.decimalOdds}|${leg.stake}`)].join("::"),
    currency: policy.currency, legs, totalStake: plain(plan.total),
    profitsBySelection: Object.fromEntries(legs.map((leg, index) => [leg.selection, plain(plan.profits[index]!)])),
    worstCaseProfit: plain(plan.worst), roi: plain(plan.worst.div(plan.total))
  };
}

export function buildFixedBaseStakePlanForPair(row: ComparisonRow, pair: OpposingLegPair,
  policy: FixedBaseStakePolicy, observedAtMs?: number): FixedBaseStakePlan | null {
  return buildPlanForPair(row, pair, policy, true, observedAtMs);
}

function bestPlan(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>, policy: FixedBaseStakePolicy,
  requireProfit: boolean, observedAtMs?: number): FixedBaseStakePlan | null {
  // A required constraint is independent of the market's quote graph. Reject
  // an observation-only board before scanning and pricing every opposing pair.
  const eligibleProviders = policy.requireProviderConstraints === true
    ? new Set([...selectedProviders].filter(provider => resolveConstraint(provider, policy, observedAtMs) !== null))
    : selectedProviders;
  if (eligibleProviders.size < 2) return null;
  if (exactPartitionOutcomeDomain(row.marketType, row.scope, row.line) !== null) {
    return buildPartitionPlan(row, policy, eligibleProviders, requireProfit, observedAtMs);
  }
  return enumerateOpposingLegPairs(row, eligibleProviders)
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
