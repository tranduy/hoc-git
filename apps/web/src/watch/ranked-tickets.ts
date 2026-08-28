import type { ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import { decimalOdds, type ComparisonEvent, type ComparisonRow } from "../catalog/comparison.js";
import { buildObservedFixedBaseStakeEstimate, type FixedBaseStakePlan,
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

function sameQuoteIdentity(left: ProviderQuote, right: ProviderQuote): boolean {
  return left.providerEventId === right.providerEventId && left.providerMarketId === right.providerMarketId &&
    left.providerSelectionId === right.providerSelectionId;
}

function isFreshApsportQuote(event: ComparisonEvent, quote: ProviderQuote, nowMs: number): boolean {
  if (quote.provider !== "APSPORT") return true;
  const catalog = event.catalogs.find((candidate) => candidate.provider === "APSPORT" &&
    candidate.snapshotState !== "STALE" && candidate.quotes.some((current) => sameQuoteIdentity(current, quote)));
  if (catalog === undefined || catalog.quotes.length === 0) return false;
  const current = catalog.quotes.find((candidate) => sameQuoteIdentity(candidate, quote));
  if (current === undefined) return false;
  const newestReceivedAt = catalog.quotes.filter((candidate) =>
    candidate.providerEventId === current.providerEventId).reduce((latest, candidate) =>
    Math.max(latest, candidate.receivedMonotonicMs), current.receivedMonotonicMs);
  const estimatedAgeMs = Math.max(0, nowMs - catalog.observedAtMs) +
    Math.max(0, newestReceivedAt - current.receivedMonotonicMs);
  return estimatedAgeMs <= (current.isLive ? APSPORT_LIVE_QUOTE_MAX_AGE_MS : APSPORT_PREMATCH_QUOTE_MAX_AGE_MS);
}

function freshnessFilteredRow(event: ComparisonEvent, row: ComparisonRow, nowMs: number): {
  readonly row: ComparisonRow; readonly rejectedApsportQuote: boolean;
} {
  let rejectedApsportQuote = false;
  const cells = row.cells.map((cell) => {
    if (cell.provider !== "APSPORT") return cell;
    const quotes = cell.quotes.filter((quote) => {
      const fresh = isFreshApsportQuote(event, quote, nowMs);
      if (!fresh) rejectedApsportQuote = true;
      return fresh;
    });
    const sourceQuotes = cell.sourceQuotes?.filter((quote) => isFreshApsportQuote(event, quote, nowMs));
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

function movementFor(eventKey: string, rowKey: string, movements: readonly ObservedPriceMovement[]): string {
  return movements.filter((movement) => movement.event.key === eventKey && movement.rowKey === rowKey)
    .reduce((largest, movement) => Decimal.max(largest, movement.magnitude), new Decimal(0)).toString();
}

function verifiedRank(state: RankedTicketState): number {
  return state === "OBSERVATION" ? 1 : 0;
}

function numberOf(value: string | undefined): Decimal {
  return new Decimal(value ?? 0);
}

function priceGaps(row: ComparisonRow, selectedProviders: ReadonlySet<ProviderId>): RankedTicket["gapsBySelection"] {
  const oddsBySelection = new Map<string, Decimal[]>();
  for (const cell of row.cells) {
    if (!selectedProviders.has(cell.provider)) continue;
    for (const quote of cell.quotes) {
      const odds = decimalOdds(quote);
      if (odds === null) continue;
      const current = oddsBySelection.get(quote.selection) ?? [];
      current.push(new Decimal(odds));
      oddsBySelection.set(quote.selection, current);
    }
  }
  return Object.fromEntries([...oddsBySelection.entries()].flatMap(([selection, odds]) => {
    if (odds.length < 2) return [];
    const minimum = Decimal.min(...odds);
    const absolute = Decimal.max(...odds).minus(minimum);
    return [[selection, { absolute: absolute.toString(), percent: absolute.div(minimum).mul(100).toString() }]];
  }));
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
  const tickets = input.event.rows.map((row): RankedTicket => {
    const freshness = freshnessFilteredRow(input.event, row, input.nowMs);
    const safeRow = freshness.row;
    const verified = input.verified.get(`${input.event.key}::${row.key}`);
    const movementMagnitude = movementFor(input.event.key, row.key, input.movements);
    const gapsBySelection = priceGaps(safeRow, input.selectedProviders);
    if (verified !== undefined && verified.eventKey === input.event.key && verified.rowKey === row.key &&
      verified.expiresAtMs > input.nowMs && !freshness.rejectedApsportQuote) {
      const profitable = new Decimal(verified.plan.worstCaseProfit).gte(20_000);
      return { key: row.key, eventKey: input.event.key, row: safeRow, plan: verified.plan,
        state: profitable ? "VERIFIED_PROFIT" : "VERIFIED_NO_PROFIT",
        reason: profitable ? null : "Verified prices do not reach 20,000 VND guaranteed profit", movementMagnitude,
        gapsBySelection };
    }
    return { key: row.key, eventKey: input.event.key, row: safeRow,
      plan: buildObservedFixedBaseStakeEstimate(safeRow, input.selectedProviders, input.observationPolicy),
      state: "OBSERVATION", reason: freshness.rejectedApsportQuote
        ? "APSPORT quote freshness not confirmed" : "Provider preflight required", movementMagnitude, gapsBySelection };
  });

  return tickets.sort((left, right) => verifiedRank(left.state) - verifiedRank(right.state) ||
    numberOf(right.plan?.worstCaseProfit).comparedTo(numberOf(left.plan?.worstCaseProfit)) ||
    numberOf(right.plan?.roi).comparedTo(numberOf(left.plan?.roi)) ||
    numberOf(right.movementMagnitude).comparedTo(numberOf(left.movementMagnitude)) || left.key.localeCompare(right.key))
    .slice(0, input.limit ?? 5);
}

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
      if (item.ticket.plan === null || new Set(item.ticket.plan.legs.map((leg) => leg.provider)).size !== 2) return false;
      const key = `${item.event.event.key}::${item.ticket.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => numberOf(right.ticket.plan?.roi).comparedTo(numberOf(left.ticket.plan?.roi)) ||
      numberOf(right.ticket.plan?.worstCaseProfit).comparedTo(numberOf(left.ticket.plan?.worstCaseProfit)) ||
      numberOf(right.ticket.movementMagnitude).comparedTo(numberOf(left.ticket.movementMagnitude)) ||
      left.event.event.event.startAtUtcMs - right.event.event.event.startAtUtcMs ||
      left.event.event.key.localeCompare(right.event.event.key) || left.ticket.key.localeCompare(right.ticket.key))
    .slice(0, safeLimit);
}
