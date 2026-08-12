import { Decimal } from "@tool-chenh/core";
import type { RankedEvent, RankedTicket } from "./ranked-tickets.js";

export interface ProfitAlert {
  readonly id: string;
  readonly identity: string;
  readonly ticket: RankedTicket;
  readonly event: RankedEvent["event"];
  readonly createdAtMs: number;
}

function identityOf(ticket: RankedTicket): string | null {
  if (ticket.plan === null) return null;
  const legs = ticket.plan.legs.map((leg) => `${leg.provider}:${leg.selection}`).sort().join("|");
  return `${ticket.eventKey}::${ticket.key}::${legs}`;
}

export class ProfitAlertTracker {
  private readonly states = new Map<string, { above: boolean; lastAlertedProfit: Decimal }>();

  update(events: readonly RankedEvent[], nowMs: number): readonly ProfitAlert[] {
    const present = new Set<string>();
    const alerts: ProfitAlert[] = [];
    for (const rankedEvent of events) {
      for (const ticket of rankedEvent.tickets) {
        const identity = identityOf(ticket);
        if (identity === null) continue;
        present.add(identity);
        const profit = new Decimal(ticket.plan!.worstCaseProfit);
        const above = ticket.state === "VERIFIED_PROFIT" && profit.gte(20_000);
        const previous = this.states.get(identity);
        const shouldAlert = above && (previous === undefined || !previous.above ||
          profit.minus(previous.lastAlertedProfit).gte(5_000));
        if (shouldAlert) {
          alerts.push({ id: `${identity}::${nowMs}`, identity, ticket, event: rankedEvent.event, createdAtMs: nowMs });
          this.states.set(identity, { above: true, lastAlertedProfit: profit });
        } else if (previous !== undefined) {
          this.states.set(identity, { ...previous, above });
        }
      }
    }
    for (const identity of [...this.states.keys()]) {
      if (!present.has(identity)) this.states.delete(identity);
    }
    return alerts;
  }
}
