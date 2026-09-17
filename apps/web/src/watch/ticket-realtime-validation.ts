import type { ProviderEvent, ProviderId, TicketRealtimeCheckRequest,
  TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { decimalOdds } from "../catalog/comparison.js";
import type { FixedBaseStakePlan } from "./fixed-base-stake.js";
import type { RankedTicket } from "./ranked-tickets.js";

export type ProviderCatalogEvidence = Partial<Record<ProviderId, {
  readonly accountId: string;
  readonly observedAtMs: number;
}>>;

export function buildTicketRealtimeCheckRequest(input: {
  readonly event: ProviderEvent;
  readonly ticket: Pick<RankedTicket, "row">;
  readonly plan: FixedBaseStakePlan | null;
  readonly providerCatalogEvidence: ProviderCatalogEvidence;
  readonly capturedAtMs?: number;
}): TicketRealtimeCheckRequest | null {
  if (input.plan === null || input.plan.legs.length !== 2) return null;
  const legs = input.plan.legs.flatMap((leg) => {
    const cell = input.ticket.row.cells.find((candidate) => candidate.provider === leg.provider);
    const quote = cell?.quotes.find((candidate) => candidate.selection === leg.selection);
    const evidence = input.providerCatalogEvidence[leg.provider];
    if (cell === undefined || quote === undefined || evidence === undefined || leg.stake === "") return [];
    const normalized = decimalOdds(quote);
    if (normalized === null) return [];
    const providerQuote = cell.sourceQuotes?.find((candidate) =>
      candidate.providerSelectionId === quote.providerSelectionId) ?? quote;
    return [{ provider: leg.provider, accountId: evidence.accountId,
      providerEventId: quote.providerEventId, providerMarketId: quote.providerMarketId,
      providerSelectionId: quote.providerSelectionId, selection: quote.selection, line: quote.line,
      rawOdds: quote.rawOdds, rawFormat: quote.rawFormat,
      providerParticipantA: cell.sourceEvent?.participantA ?? input.event.participantA,
      providerParticipantB: cell.sourceEvent?.participantB ?? input.event.participantB,
      providerSelection: providerQuote.selection,
      providerLine: cell.sourceMarket?.line ?? providerQuote.line,
      decimalOdds: normalized.toString(), quoteStatus: quote.status,
      providerObservedAtMs: evidence.observedAtMs, receivedMonotonicMs: quote.receivedMonotonicMs,
      sequence: quote.sequence, requestedStake: leg.stake }];
  });
  if (legs.length !== 2 || legs[0]!.provider === legs[1]!.provider) return null;
  return { eventLabel: `${input.event.participantA} vs ${input.event.participantB}`,
    participantA: input.event.participantA, participantB: input.event.participantB,
    marketType: input.ticket.row.marketType as TicketRealtimeCheckRequest["marketType"],
    scope: input.ticket.row.scope as TicketRealtimeCheckRequest["scope"],
    capturedAtMs: input.capturedAtMs ?? Date.now(),
    legs: [legs[0]!, legs[1]!] };
}

export function ticketRealtimeCheckInvalidates(response: TicketRealtimeCheckResponse): boolean {
  return response.legs.some((leg) => leg.status === "TIMEOUT" || leg.status === "MARKET_NOT_OPEN" ||
    leg.status === "IDENTITY_MISMATCH" || leg.verificationStatus === "NOT_FOUND");
}

export function ticketRealtimeCheckInvalidatesDisplayedVersion(response: TicketRealtimeCheckResponse): boolean {
  return ticketRealtimeCheckInvalidates(response) ||
    response.legs.some((leg) => leg.status === "ODDS_CHANGED" || leg.status === "SOURCE_UNAVAILABLE");
}
