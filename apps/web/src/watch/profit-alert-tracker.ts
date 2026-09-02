import type { ProviderId } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import { selectionLabel, ticketMarketLabel } from "../catalog/comparison.js";
import type { RankedEvent, RankedTicket } from "./ranked-tickets.js";

export const PROFIT_ALERTS_STORAGE_KEY = "tool-chenh:profit-alert-history-v1";
export const MAX_PROFIT_ALERTS = 100;

export interface ProfitAlertLeg {
  readonly provider: ProviderId;
  readonly selection: string;
}

export interface ProfitAlert {
  readonly id: string;
  readonly identity: string;
  readonly observedAtMs: number;
  readonly competition: string;
  readonly matchName: string;
  readonly marketName: string;
  readonly line: string | null;
  readonly providers: readonly ProviderId[];
  readonly legs: readonly ProfitAlertLeg[];
  readonly roi: string;
  readonly worstCaseProfit: string;
  readonly currency: string;
  readonly freshness: "FRESH";
}

export interface ProfitAlertUpdate {
  readonly added: readonly ProfitAlert[];
  readonly history: readonly ProfitAlert[];
  readonly changed: boolean;
}

const providers = new Set<ProviderId>(["SABA", "IM", "SBOBET", "APSPORT", "BTI", "CMD", "FABET"]);

function identityOf(ticket: RankedTicket): string | null {
  if (ticket.plan === null) return null;
  const ticketProviders = [...new Set(ticket.plan.legs.map((leg) => leg.provider))].sort();
  if (ticketProviders.length !== 2) return null;
  // Price movement can swap which book supplies either outcome. The market and
  // book pair are still the same ticket, so outcome allocation is deliberately
  // excluded from the durable identity.
  return `${ticket.eventKey}::${ticket.key}::${ticketProviders.join("|")}`;
}

function compareNewest(left: ProfitAlert, right: ProfitAlert): number {
  return right.observedAtMs - left.observedAtMs || left.identity.localeCompare(right.identity);
}

function isBetter(candidate: ProfitAlert, current: ProfitAlert): boolean {
  const roi = new Decimal(candidate.roi).comparedTo(current.roi);
  return roi > 0 || (roi === 0 && new Decimal(candidate.worstCaseProfit).gt(current.worstCaseProfit));
}

function capped(values: Iterable<ProfitAlert>): readonly ProfitAlert[] {
  return [...values].sort(compareNewest).slice(0, MAX_PROFIT_ALERTS);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function validDecimal(value: unknown): value is string {
  if (!isString(value)) return false;
  try { return new Decimal(value).isFinite(); } catch { return false; }
}

function parseProfitAlert(value: unknown): ProfitAlert | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<ProfitAlert>;
  if (!isString(input.id) || !isString(input.identity) || !Number.isFinite(input.observedAtMs) ||
    !isString(input.competition) || !isString(input.matchName) || !isString(input.marketName) ||
    !(input.line === null || isString(input.line)) || !Array.isArray(input.providers) ||
    input.providers.length !== 2 || !input.providers.every((provider) => providers.has(provider as ProviderId)) ||
    !Array.isArray(input.legs) || input.legs.length !== 2 || !input.legs.every((leg) =>
      typeof leg === "object" && leg !== null && providers.has((leg as ProfitAlertLeg).provider) &&
      isString((leg as ProfitAlertLeg).selection)) || !validDecimal(input.roi) ||
    !validDecimal(input.worstCaseProfit) || !isString(input.currency) || input.freshness !== "FRESH") return null;
  return input as ProfitAlert;
}

function normalized(values: readonly ProfitAlert[]): readonly ProfitAlert[] {
  const byIdentity = new Map<string, ProfitAlert>();
  for (const value of values) {
    const current = byIdentity.get(value.identity);
    if (current === undefined || isBetter(value, current)) byIdentity.set(value.identity, value);
  }
  return capped(byIdentity.values());
}

export function loadProfitAlerts(storage: Pick<Storage, "getItem">): readonly ProfitAlert[] {
  try {
    const raw = storage.getItem(PROFIT_ALERTS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalized(parsed.flatMap((item) => {
      const alert = parseProfitAlert(item);
      return alert === null ? [] : [alert];
    }));
  } catch { return []; }
}

export function saveProfitAlerts(storage: Pick<Storage, "setItem">,
  alerts: readonly ProfitAlert[]): void {
  try { storage.setItem(PROFIT_ALERTS_STORAGE_KEY, JSON.stringify(normalized(alerts))); }
  catch { /* notification history must never interrupt the realtime board */ }
}

function alertOf(rankedEvent: RankedEvent, ticket: RankedTicket, identity: string,
  observedAtMs: number): ProfitAlert {
  const plan = ticket.plan!;
  const event = rankedEvent.event.event;
  return {
    id: identity,
    identity,
    observedAtMs,
    competition: event.competition,
    matchName: `${event.participantA} vs ${event.participantB}`,
    marketName: ticketMarketLabel(ticket.row.marketType),
    line: ticket.row.line,
    providers: [...new Set(plan.legs.map((leg) => leg.provider))],
    legs: plan.legs.map((leg) => ({ provider: leg.provider, selection: selectionLabel(event, leg.selection) })),
    roi: plan.roi,
    worstCaseProfit: plan.worstCaseProfit,
    currency: plan.currency,
    freshness: "FRESH"
  };
}

export class ProfitAlertTracker {
  readonly #history = new Map<string, ProfitAlert>();

  constructor(initial: readonly ProfitAlert[] = []) {
    for (const alert of normalized(initial)) this.#history.set(alert.identity, alert);
  }

  history(): readonly ProfitAlert[] {
    return capped(this.#history.values());
  }

  update(events: readonly RankedEvent[], nowMs: number,
    freshAccountIds?: ReadonlySet<string>): ProfitAlertUpdate {
    const added: ProfitAlert[] = [];
    let changed = false;
    for (const rankedEvent of events) {
      for (const ticket of rankedEvent.tickets) {
        if (ticket.state === "VERIFIED_NO_PROFIT" || ticket.plan === null ||
          !new Decimal(ticket.plan.roi).gt("0.05")) continue;
        const identity = identityOf(ticket);
        if (identity === null) continue;
        const fresh = freshAccountIds === undefined || ticket.plan.legs.every((leg) =>
          rankedEvent.event.catalogs.some((catalog) => catalog.provider === leg.provider &&
            freshAccountIds.has(catalog.accountId)));
        if (!fresh) continue;
        const candidate = alertOf(rankedEvent, ticket, identity, nowMs);
        const current = this.#history.get(identity);
        if (current === undefined) {
          this.#history.set(identity, candidate);
          added.push(candidate);
          changed = true;
        } else if (isBetter(candidate, current)) {
          this.#history.set(identity, candidate);
          changed = true;
        }
      }
    }
    if (this.#history.size > MAX_PROFIT_ALERTS) {
      const retained = capped(this.#history.values());
      this.#history.clear();
      for (const alert of retained) this.#history.set(alert.identity, alert);
    }
    return { added, history: this.history(), changed };
  }
}
