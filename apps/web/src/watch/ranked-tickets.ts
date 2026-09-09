import type { ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import { decimalOdds, type ComparisonEvent, type ComparisonRow } from "../catalog/comparison.js";
import { buildObservedFixedBaseStakeEstimate, enumerateOpposingLegPairs, type FixedBaseStakePlan,
  type FixedBaseStakePolicy } from "./fixed-base-stake.js";
import type { ObservedPriceMovement } from "./price-movement-tracker.js";
import type { VerifiedTicketEvidence } from "./ticket-preflight-coordinator.js";
import { sortProviders } from "../catalog/provider-order.js";

export type RankedTicketState = "VERIFIED_PROFIT" | "VERIFIED_NO_PROFIT" | "OBSERVATION";

export interface RankedTicket {
  readonly key: string;
  readonly eventKey: string;
  readonly row: ComparisonRow;
  readonly plan: FixedBaseStakePlan | null;
  /** An exact selected source relation survives when its prices need renewal. */
  readonly hasOpposingSources?: boolean;
  /** Scalar source-pair proof for a waiting row when local book selection changes. */
  readonly opposingProviderPairs?: readonly (readonly [ProviderId, ProviderId])[];
  readonly state: RankedTicketState;
  readonly reason: string | null;
  readonly movementMagnitude: string;
  readonly gapsBySelection: Readonly<Record<string, { readonly absolute: string; readonly percent: string }>>;
}

export interface RankedEvent {
  readonly event: ComparisonEvent;
  readonly tickets: readonly RankedTicket[];
  readonly bestVerifiedProfit: string | null;
}

export interface RankedTicketItem {
  readonly event: RankedEvent;
  readonly ticket: RankedTicket;
}

export interface EventEdgeSummary {
  readonly ticketKey: string;
  readonly roiPercent: string;
  readonly worstCaseProfit: string;
  readonly providers: readonly ProviderId[];
  readonly odds: readonly string[];
  readonly marketType: ComparisonRow["marketType"];
  readonly line: string | null;
  readonly state: RankedTicketState;
}

const APSPORT_LIVE_QUOTE_MAX_AGE_MS = 5_000;
const APSPORT_PREMATCH_QUOTE_MAX_AGE_MS = 15_000;
const apsportQuoteDeadlineCache = new WeakMap<ComparisonEvent["catalogs"][number], ReadonlyMap<string, number>>();

function quoteIdentity(quote: ProviderQuote): string {
  return `${quote.providerEventId}\u0000${quote.providerMarketId}\u0000${quote.providerSelectionId}`;
}

function apsportQuoteDeadlines(catalog: ComparisonEvent["catalogs"][number]): ReadonlyMap<string, number> {
  const cached = apsportQuoteDeadlineCache.get(catalog);
  if (cached !== undefined) return cached;
  // The publication clock is paired with observedAtMs, including updates that
  // contain no new quotes. Older API bodies lack it; their fallback uses the
  // newest receipt across the single AP observer, never a separate event clock.
  let newestReceivedAt = catalog.observedMonotonicMs ?? 0;
  if (catalog.observedMonotonicMs === undefined) {
    for (const quote of catalog.quotes) {
      newestReceivedAt = Math.max(newestReceivedAt, quote.receivedMonotonicMs);
    }
  }
  const result = new Map<string, number>();
  for (const quote of catalog.quotes) {
    const offsetMs = Math.max(0, newestReceivedAt - quote.receivedMonotonicMs);
    result.set(quoteIdentity(quote), catalog.observedAtMs + (quote.isLive
      ? APSPORT_LIVE_QUOTE_MAX_AGE_MS : APSPORT_PREMATCH_QUOTE_MAX_AGE_MS) - offsetMs);
  }
  apsportQuoteDeadlineCache.set(catalog, result);
  return result;
}

function apsportFreshnessIndexes(event: ComparisonEvent): readonly ReadonlyMap<string, number>[] {
  return event.catalogs.flatMap((catalog) => catalog.provider === "APSPORT" &&
    catalog.snapshotState !== "STALE" && catalog.quotes.length > 0 ? [apsportQuoteDeadlines(catalog)] : []);
}

function isFreshApsportQuote(indexes: readonly ReadonlyMap<string, number>[], quote: ProviderQuote,
  nowMs: number): boolean {
  if (quote.provider !== "APSPORT") return true;
  const key = quoteIdentity(quote);
  for (const index of indexes) {
    const deadlineMs = index.get(key);
    if (deadlineMs !== undefined) return nowMs <= deadlineMs;
  }
  return false;
}

function freshnessFilteredRow(row: ComparisonRow,
  freshnessIndexes: readonly ReadonlyMap<string, number>[], nowMs: number): {
  readonly row: ComparisonRow; readonly rejectedApsportQuote: boolean;
} {
  let rejectedApsportQuote = false;
  const cells = row.cells.map((cell) => {
    if (cell.provider !== "APSPORT") return cell;
    const quotes = cell.quotes.filter((quote) => {
      const fresh = isFreshApsportQuote(freshnessIndexes, quote, nowMs);
      if (!fresh) rejectedApsportQuote = true;
      return fresh;
    });
    const sourceQuotes = cell.sourceQuotes?.filter((quote) => isFreshApsportQuote(freshnessIndexes, quote, nowMs));
    return { ...cell, quotes, ...(sourceQuotes === undefined ? {} : { sourceQuotes }) };
  });
  return { row: { ...row, cells }, rejectedApsportQuote };
}

export function ticketEdgeSummary(ticket: RankedTicket): EventEdgeSummary | null {
  if (ticket.plan === null) return null;
  const providers = sortProviders([...new Set(ticket.plan.legs.map((leg) => leg.provider))]);
  if (providers.length !== 2) return null;
  return {
    ticketKey: ticket.key,
    roiPercent: new Decimal(ticket.plan.roi).mul(100).toString(),
    worstCaseProfit: ticket.plan.worstCaseProfit,
    providers,
    odds: ticket.plan.legs.map((leg) => leg.decimalOdds),
    marketType: ticket.row.marketType,
    line: ticket.row.line,
    state: ticket.state
  };
}

export function eventEdgeSummary(event: RankedEvent): EventEdgeSummary | null {
  for (const ticket of event.tickets) {
    const summary = ticketEdgeSummary(ticket);
    if (summary !== null) return summary;
  }
  return null;
}

const movementIndexCache = new WeakMap<readonly ObservedPriceMovement[],
  ReadonlyMap<string, ReadonlyMap<string, string>>>();

function movementFor(eventKey: string, rowKey: string, movements: readonly ObservedPriceMovement[]): string {
  let index = movementIndexCache.get(movements);
  if (index === undefined) {
    const byEvent = new Map<string, Map<string, string>>();
    for (const movement of movements) {
      const key = movement.event.key;
      let rows = byEvent.get(key);
      if (rows === undefined) { rows = new Map(); byEvent.set(key, rows); }
      rows.set(movement.rowKey, Decimal.max(rows.get(movement.rowKey) ?? "0", movement.magnitude).toString());
    }
    // MovementTracker emits immutable array snapshots. Reuse the index for
    // every row/event in this ranking pass without retaining old snapshots.
    movementIndexCache.set(movements, byEvent);
    index = byEvent;
  }
  return index.get(eventKey)?.get(rowKey) ?? "0";
}

function verifiedRank(state: RankedTicketState): number {
  return state === "OBSERVATION" ? 1 : 0;
}

function numberOf(value: string | undefined): Decimal {
  return new Decimal(value ?? 0);
}

function priceGaps(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>): RankedTicket["gapsBySelection"] {
  const oddsBySelection = new Map<string, Map<ProviderId, number>>();
  for (const cell of row.cells) {
    if (!selectedProviders.has(cell.provider)) continue;
    for (const quote of cell.quotes) {
      const odds = decimalOdds(quote);
      if (odds === null) continue;
      const current = oddsBySelection.get(quote.selection) ?? new Map<ProviderId, number>();
      current.set(cell.provider, Math.max(current.get(cell.provider) ?? odds, odds));
      oddsBySelection.set(quote.selection, current);
    }
  }
  return Object.fromEntries([...oddsBySelection.entries()].flatMap(([selection, byProvider]) => {
    if (byProvider.size < 2) return [];
    const odds = [...byProvider.values()].map(value => new Decimal(value));
    const minimum = Decimal.min(...odds);
    const absolute = Decimal.max(...odds).minus(minimum);
    return [[selection, { absolute: absolute.toString(), percent: absolute.div(minimum).mul(100).toString() }]];
  }));
}

/**
 * The next instant at which ranking could reach a different answer.
 *
 * Ranking was recomputed once a second because the page's clock ticks once a
 * second, and with 654 fixtures on screen that measured 668ms of work per tick
 * - two thirds of a core, spent almost entirely on arriving at the answer it
 * already had. Nothing here actually varies continuously with the clock: a
 * quote's freshness, a verified ticket's expiry and a fixture's kickoff each
 * turn over at one computable moment and hold their answer either side of it.
 *
 * Waking at those moments is the same computation, not a cheaper approximation
 * of it. Coarsening the clock instead would be the cheaper approximation, and
 * it would let an APSPORT quote sit past the deadline that exists to keep a
 * stale price out of a ticket.
 *
 * Returns null when nothing ahead can change, which is the case for a board of
 * fixtures none of which APSPORT prices.
 */
export function nextRankingDeadlineMs(input: {
  readonly events: readonly ComparisonEvent[];
  readonly verified: ReadonlyMap<string, VerifiedTicketEvidence>;
  readonly nowMs: number;
}): number | null {
  let earliest: number | null = null;
  const consider = (atMs: number): void => {
    if (!Number.isFinite(atMs) || atMs <= input.nowMs) return;
    if (earliest === null || atMs < earliest) earliest = atMs;
  };
  const measured = new Set<ComparisonEvent["catalogs"][number]>();
  for (const event of input.events) {
    // A fixture that has not started leaves the board when its kickoff passes.
    if (!event.event.isLive) consider(event.event.startAtUtcMs);
    for (const catalog of event.catalogs) {
      if (catalog.provider !== "APSPORT" || catalog.snapshotState === "STALE" ||
        measured.has(catalog)) continue;
      measured.add(catalog);
      for (const deadlineMs of apsportQuoteDeadlines(catalog).values()) consider(deadlineMs);
    }
  }
  for (const evidence of input.verified.values()) consider(evidence.expiresAtMs);
  return earliest;
}

export function rankTicketsForEvent(input: {
  readonly event: ComparisonEvent;
  readonly verified: ReadonlyMap<string, VerifiedTicketEvidence>;
  readonly movements: readonly ObservedPriceMovement[];
  readonly selectedProviders: ReadonlySet<ProviderId>;
  readonly observationPolicy: FixedBaseStakePolicy;
  readonly nowMs: number;
  readonly limit?: number;
}): readonly RankedTicket[] {
  const freshnessIndexes = apsportFreshnessIndexes(input.event);
  const tickets = input.event.rows.map((row): RankedTicket => {
    const freshness = freshnessFilteredRow(row, freshnessIndexes, input.nowMs);
    const safeRow = freshness.row;
    const verified = input.verified.get(`${input.event.key}::${row.key}`);
    const movementMagnitude = movementFor(input.event.key, row.key, input.movements);
    const gapsBySelection = priceGaps(safeRow, input.selectedProviders);
    if (row.opposition === undefined && verified !== undefined && verified.eventKey === input.event.key && verified.rowKey === row.key &&
      verified.expiresAtMs > input.nowMs && !freshness.rejectedApsportQuote) {
      const profitable = new Decimal(verified.plan.worstCaseProfit).gte(20_000);
      return { key: row.key, eventKey: input.event.key, row: safeRow, plan: verified.plan,
        state: profitable ? "VERIFIED_PROFIT" : "VERIFIED_NO_PROFIT",
        reason: profitable ? null : "Verified prices do not reach 20,000 VND guaranteed profit", movementMagnitude,
        gapsBySelection };
    }
    const plan = observedStakeEstimates.estimate(`${input.event.key}::${row.key}`, safeRow,
      input.selectedProviders, input.observationPolicy);
    const opposingProviderPairs = plan === null ? [...new Map(enumerateOpposingLegPairs(row, input.selectedProviders)
      .map(pair => {
        const providers = [pair.first.provider, pair.second.provider].sort() as [ProviderId, ProviderId];
        return [providers.join("|"), providers] as const;
      })).values()] : [];
    return { key: row.key, eventKey: input.event.key, row: safeRow, plan,
      ...(plan === null ? { hasOpposingSources: opposingProviderPairs.length > 0, opposingProviderPairs } : {}),
      state: "OBSERVATION", reason: freshness.rejectedApsportQuote
        ? "APSPORT quote freshness not confirmed" : row.opposition !== undefined
          ? "Chỉ ước tính; kiểm tra vé ghép 1X2/cơ hội kép chưa hỗ trợ" : "Provider preflight required", movementMagnitude, gapsBySelection };
  });

  return tickets.sort((left, right) => verifiedRank(left.state) - verifiedRank(right.state) ||
    Number(left.plan === null) - Number(right.plan === null) ||
    numberOf(right.plan?.worstCaseProfit).comparedTo(numberOf(left.plan?.worstCaseProfit)) ||
    numberOf(right.plan?.roi).comparedTo(numberOf(left.plan?.roi)) ||
    numberOf(right.movementMagnitude).comparedTo(numberOf(left.movementMagnitude)) || left.key.localeCompare(right.key))
    .slice(0, input.limit ?? 5);
}

/** Latest calculation only, with no catalog/event/cell references or revision history. */
export class ObservedStakeEstimateCache {
  readonly #entries = new Map<string, { readonly signature: string; readonly plan: FixedBaseStakePlan | null }>();
  // The full normalized six-book capacity replay has 22,740 active rows.
  // Leave bounded headroom so a sequential pass does not evict its own next pass.
  constructor(readonly capacity = 30_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("positive cache capacity required");
  }
  get size(): number { return this.#entries.size; }

  estimate(key: string, row: ComparisonRow, providers: ReadonlySet<ProviderId>,
    policy: FixedBaseStakePolicy): FixedBaseStakePlan | null {
    // Receipt clocks are evaluated by freshnessFilteredRow BEFORE this method.
    // A renewed receipt with unchanged prices does not change stake arithmetic;
    // expired/removed quotes, status, identity, odds and every policy constraint do.
    const signature = JSON.stringify([row.key, row.marketType, row.scope, row.line, row.opposition,
      [...providers].sort(), policy, row.cells.map(cell => [cell.provider, cell.market,
        cell.quotes.map(quote => [quote.provider, quote.category, quote.providerEventId,
          quote.providerMarketId, quote.providerSelectionId, quote.marketType, quote.scope,
          quote.line, quote.selection, quote.rawOdds, quote.rawFormat, quote.status])])]);
    const previous = this.#entries.get(key);
    if (previous?.signature === signature) {
      this.#entries.delete(key); this.#entries.set(key, previous);
      return previous.plan;
    }
    const plan = buildObservedFixedBaseStakeEstimate(row, providers, policy);
    this.#entries.delete(key); this.#entries.set(key, { signature, plan });
    if (this.#entries.size > this.capacity) this.#entries.delete(this.#entries.keys().next().value!);
    return plan;
  }
}

const observedStakeEstimates = new ObservedStakeEstimateCache();

export function rankedEvent(input: Parameters<typeof rankTicketsForEvent>[0]): RankedEvent {
  const tickets = rankTicketsForEvent(input);
  const best = tickets.filter((ticket) => ticket.state !== "OBSERVATION" && ticket.plan !== null)
    .map((ticket) => ticket.plan!.worstCaseProfit)
    .sort((left, right) => new Decimal(right).comparedTo(left))[0] ?? null;
  return { event: input.event, tickets, bestVerifiedProfit: best };
}

export function sortRankedEvents(events: readonly RankedEvent[]): readonly RankedEvent[] {
  return [...events].sort((left, right) => {
    if (left.bestVerifiedProfit === null || right.bestVerifiedProfit === null) {
      if (left.bestVerifiedProfit === null && right.bestVerifiedProfit !== null) return 1;
      if (left.bestVerifiedProfit !== null && right.bestVerifiedProfit === null) return -1;
    } else {
      const profit = new Decimal(right.bestVerifiedProfit).comparedTo(left.bestVerifiedProfit);
      if (profit !== 0) return profit;
    }
    if (left.event.event.isLive !== right.event.event.isLive) return left.event.event.isLive ? 1 : -1;
    return left.event.event.startAtUtcMs - right.event.event.startAtUtcMs || left.event.key.localeCompare(right.event.key);
  });
}

export function topRankedTicketItems(events: readonly RankedEvent[], limit = 25): readonly RankedTicketItem[] {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 25;
  const seen = new Set<string>();
  return events.flatMap((event) => event.tickets.map((ticket) => ({ event, ticket })))
    .filter((item) => {
      if (item.ticket.plan === null ? item.ticket.hasOpposingSources !== true :
        new Set(item.ticket.plan.legs.map((leg) => leg.provider)).size !== 2) return false;
      const key = `${item.event.event.key}::${item.ticket.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(item => ({ item, roi: numberOf(item.ticket.plan?.roi),
      profit: numberOf(item.ticket.plan?.worstCaseProfit), movement: numberOf(item.ticket.movementMagnitude) }))
    .sort((left, right) => Number(left.item.ticket.plan === null) - Number(right.item.ticket.plan === null) ||
      right.roi.comparedTo(left.roi) || right.profit.comparedTo(left.profit) ||
      right.movement.comparedTo(left.movement) ||
      left.item.event.event.event.startAtUtcMs - right.item.event.event.event.startAtUtcMs ||
      left.item.event.event.key.localeCompare(right.item.event.event.key) || left.item.ticket.key.localeCompare(right.item.ticket.key))
    .slice(0, safeLimit).map(({ item }) => item);
}
