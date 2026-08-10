import type { ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import { decimalOdds, type ComparisonEvent, type ComparisonRow } from "../catalog/comparison.js";
import { buildFixedBaseStakePlan, type FixedBaseStakePlan, type FixedBaseStakePolicy } from "./fixed-base-stake.js";

export interface LagMovement {
  readonly provider: ProviderId;
  readonly selection: string;
  readonly previousDecimal: string;
  readonly currentDecimal: string;
  readonly changedAtMs: number;
  readonly quoteAgeMs: number;
}

export interface LagSignal {
  readonly key: string;
  readonly event: ComparisonEvent;
  readonly row: ComparisonRow;
  readonly plan: FixedBaseStakePlan;
  readonly movements: readonly LagMovement[];
  readonly movementMagnitude: string;
  readonly triggeredAtMs: number;
  readonly quoteAgeMs: number;
}

function plain(value: Decimal): string {
  return value.toFixed(value.decimalPlaces());
}

function largestMovement(movements: readonly LagMovement[]): string {
  return plain(movements.reduce((largest, movement) => Decimal.max(largest,
    new Decimal(movement.currentDecimal).minus(movement.previousDecimal).abs()), new Decimal(0)));
}

interface QuoteSample {
  readonly decimal: string;
}

function plainOdds(quote: ProviderQuote): string | null {
  const value = decimalOdds(quote);
  if (value === null) return null;
  const decimal = new Decimal(value);
  return decimal.toFixed(decimal.decimalPlaces());
}

function quoteKey(eventKey: string, rowKey: string, provider: ProviderId, selection: string): string {
  return `${eventKey}::${rowKey}::${provider}::${selection}`;
}

function rowKey(event: ComparisonEvent, row: ComparisonRow): string {
  return `${event.key}::${row.key}`;
}

function quoteAge(event: ComparisonEvent, provider: ProviderId, quote: ProviderQuote, nowMs: number): number {
  const catalogTime = event.catalogs.find((catalog) => catalog.provider === provider)?.observedAtMs ?? nowMs;
  const asOfMs = quote.sourceTimestampMs ?? catalogTime;
  return Math.max(0, nowMs - asOfMs);
}

function planQuoteAge(event: ComparisonEvent, row: ComparisonRow, plan: FixedBaseStakePlan, nowMs: number): number {
  return plan.legs.reduce((oldest, leg) => {
    const cell = row.cells.find((candidate) => candidate.provider === leg.provider);
    const quote = cell?.quotes.find((candidate) => candidate.selection === leg.selection);
    return quote === undefined ? Number.POSITIVE_INFINITY : Math.max(oldest, quoteAge(event, leg.provider, quote, nowMs));
  }, 0);
}

export class LagSignalTracker {
  #previous = new Map<string, QuoteSample>();
  #active = new Map<string, LagSignal>();

  constructor(private readonly maxQuoteAgeMs = 5_000, private readonly minimumWorstCaseProfit = "20000") {}

  update(events: readonly ComparisonEvent[], selectedProviders: ReadonlySet<ProviderId>, policy: FixedBaseStakePolicy,
    observedAtMs: number): readonly LagSignal[] {
    const current = new Map<string, QuoteSample>();
    const currentRows = new Set<string>();

    for (const event of events) {
      const focusedRowKeys = new Set(event.observedRows.map((row) => row.key));
      for (const row of event.rows) {
        if (!focusedRowKeys.has(row.key)) continue;
        const signalKey = rowKey(event, row);
        currentRows.add(signalKey);
        const movements: LagMovement[] = [];
        for (const cell of row.cells) {
          for (const quote of cell.quotes) {
            const decimal = plainOdds(quote);
            if (decimal === null) continue;
            const key = quoteKey(event.key, row.key, cell.provider, quote.selection);
            current.set(key, { decimal });
            const previous = this.#previous.get(key);
            if (previous !== undefined && previous.decimal !== decimal) {
              movements.push({ provider: cell.provider, selection: quote.selection,
                previousDecimal: previous.decimal, currentDecimal: decimal, changedAtMs: observedAtMs,
                quoteAgeMs: quoteAge(event, cell.provider, quote, observedAtMs) });
            }
          }
        }

        const plan = buildFixedBaseStakePlan(row, selectedProviders, policy);
        if (plan === null || new Decimal(plan.worstCaseProfit).lt(this.minimumWorstCaseProfit)) {
          this.#active.delete(signalKey);
          continue;
        }
        const ageMs = planQuoteAge(event, row, plan, observedAtMs);
        if (!Number.isFinite(ageMs) || ageMs > this.maxQuoteAgeMs) {
          this.#active.delete(signalKey);
          continue;
        }
        const existing = this.#active.get(signalKey);
        if (movements.length > 0) {
          this.#active.set(signalKey, { key: signalKey, event, row, plan, movements,
            movementMagnitude: largestMovement(movements), triggeredAtMs: observedAtMs, quoteAgeMs: ageMs });
        } else if (existing !== undefined) {
          this.#active.set(signalKey, { ...existing, event, row, plan, quoteAgeMs: ageMs });
        }
      }
    }

    for (const key of this.#active.keys()) if (!currentRows.has(key)) this.#active.delete(key);
    this.#previous = current;
    return [...this.#active.values()].sort((left, right) =>
      new Decimal(right.plan.worstCaseProfit).comparedTo(left.plan.worstCaseProfit) ||
      new Decimal(right.movementMagnitude).comparedTo(left.movementMagnitude) ||
      new Decimal(right.plan.roi).comparedTo(left.plan.roi) ||
      right.triggeredAtMs - left.triggeredAtMs || left.key.localeCompare(right.key)).slice(0, 5);
  }
}
