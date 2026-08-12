import type { ProviderId } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import { decimalOdds, type ComparisonEvent, type ComparisonRow } from "../catalog/comparison.js";
import { buildObservedFixedBaseStakeEstimate, type FixedBaseStakePlan,
  type FixedBaseStakePolicy } from "./fixed-base-stake.js";
import type { ObservedPriceMovement } from "./price-movement-tracker.js";
import type { VerifiedTicketEvidence } from "./ticket-preflight-coordinator.js";

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
    const verified = input.verified.get(`${input.event.key}::${row.key}`);
    const movementMagnitude = movementFor(input.event.key, row.key, input.movements);
    const gapsBySelection = priceGaps(row, input.selectedProviders);
    if (verified !== undefined && verified.eventKey === input.event.key && verified.rowKey === row.key &&
      verified.expiresAtMs > input.nowMs) {
      const profitable = new Decimal(verified.plan.worstCaseProfit).gte(20_000);
      return { key: row.key, eventKey: input.event.key, row, plan: verified.plan,
        state: profitable ? "VERIFIED_PROFIT" : "VERIFIED_NO_PROFIT",
        reason: profitable ? null : "Verified prices do not reach 20,000 VND guaranteed profit", movementMagnitude,
        gapsBySelection };
    }
    return { key: row.key, eventKey: input.event.key, row,
      plan: buildObservedFixedBaseStakeEstimate(row, input.selectedProviders, input.observationPolicy),
      state: "OBSERVATION", reason: "Provider preflight required", movementMagnitude, gapsBySelection };
  });

  return tickets.sort((left, right) => verifiedRank(left.state) - verifiedRank(right.state) ||
    (left.state === "OBSERVATION" && right.state === "OBSERVATION" ? 0
      : numberOf(right.plan?.worstCaseProfit).comparedTo(numberOf(left.plan?.worstCaseProfit))) ||
    (left.state === "OBSERVATION" && right.state === "OBSERVATION" ? 0
      : numberOf(right.plan?.roi).comparedTo(numberOf(left.plan?.roi))) ||
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
