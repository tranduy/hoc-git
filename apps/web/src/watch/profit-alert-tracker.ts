import { Decimal } from "@tool-chenh/core";
import type { RankedEvent, RankedTicket } from "./ranked-tickets.js";

export interface ProfitAlert {
  readonly id: string;
  readonly identity: string;
  readonly ticket: RankedTicket;
  readonly event: RankedEvent["event"];
  readonly createdAtMs: number;
  readonly freshness: "FRESH" | "STALE_DISPLAY_ONLY";
}

function identityOf(ticket: RankedTicket): string | null {
  if (ticket.plan === null) return null;
  if (new Set(ticket.plan.legs.map((leg) => leg.provider)).size < 2) return null;
  const legs = ticket.plan.legs.map((leg) => `${leg.provider}:${leg.selection}`).sort().join("|");
  return `${ticket.eventKey}::${ticket.key}::${legs}`;
}

export class ProfitAlertTracker {
  private readonly alerted = new Set<string>();

  update(events: readonly RankedEvent[], nowMs: number,
    freshAccountIds?: ReadonlySet<string>): readonly ProfitAlert[] {
    const alerts: ProfitAlert[] = [];
    for (const rankedEvent of events) {
      for (const ticket of rankedEvent.tickets) {
        if (ticket.state === "VERIFIED_NO_PROFIT") continue;
        const identity = identityOf(ticket);
        if (identity === null) continue;
        if (this.alerted.has(identity) || !new Decimal(ticket.plan!.roi).gt("0.05")) continue;
        const fresh = freshAccountIds === undefined || ticket.plan!.legs.every((leg) =>
          rankedEvent.event.catalogs.some((catalog) => catalog.provider === leg.provider &&
            freshAccountIds.has(catalog.accountId)));
        if (!fresh) continue;
        this.alerted.add(identity);
        alerts.push({ id: `${identity}::${nowMs}`, identity, ticket, event: rankedEvent.event, createdAtMs: nowMs,
          freshness: "FRESH" });
      }
    }
    return alerts;
  }
}
