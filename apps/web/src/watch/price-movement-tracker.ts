import type { ProviderId } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import { decimalOdds, type ComparisonEvent } from "../catalog/comparison.js";

export interface ObservedPriceMovement {
  readonly key: string;
  readonly event: ComparisonEvent;
  readonly rowKey: string;
  readonly provider: ProviderId;
  readonly selection: string;
  readonly previousDecimal: string;
  readonly currentDecimal: string;
  readonly magnitude: string;
  readonly changedAtMs: number;
}

interface QuoteSample {
  readonly decimal: string;
}

function plain(value: number): string {
  const decimal = new Decimal(value);
  return decimal.toFixed(decimal.decimalPlaces());
}

function quoteKey(eventKey: string, rowKey: string, provider: ProviderId, selection: string): string {
  return `${eventKey}::${rowKey}::${provider}::${selection}`;
}

export class PriceMovementTracker {
  #previous = new Map<string, QuoteSample>();
  #latest = new Map<string, ObservedPriceMovement>();

  constructor(private readonly retentionMs = 60_000) {}

  update(events: readonly ComparisonEvent[], changedAtMs: number): readonly ObservedPriceMovement[] {
    const current = new Map<string, QuoteSample>();
    const visibleRows = new Set<string>();
    for (const event of events) {
      for (const row of event.observedRows) {
        const eventRowKey = `${event.key}::${row.key}`;
        visibleRows.add(eventRowKey);
        for (const cell of row.cells) {
          for (const quote of cell.quotes) {
            const odds = decimalOdds(quote);
            if (odds === null) continue;
            const key = quoteKey(event.key, row.key, cell.provider, quote.selection);
            const decimal = plain(odds);
            current.set(key, { decimal });
            const previous = this.#previous.get(key);
            if (previous === undefined || previous.decimal === decimal) continue;
            const magnitude = new Decimal(decimal).minus(previous.decimal).abs();
            const movement: ObservedPriceMovement = { key, event, rowKey: row.key, provider: cell.provider,
              selection: quote.selection, previousDecimal: previous.decimal, currentDecimal: decimal,
              magnitude: magnitude.toFixed(magnitude.decimalPlaces()), changedAtMs };
            const prior = this.#latest.get(eventRowKey);
            if (prior === undefined || magnitude.gt(prior.magnitude) ||
              (magnitude.eq(prior.magnitude) && movement.key.localeCompare(prior.key) < 0)) {
              this.#latest.set(eventRowKey, movement);
            }
          }
        }
      }
    }
    for (const [key, movement] of this.#latest) {
      if (!visibleRows.has(key) || changedAtMs - movement.changedAtMs > this.retentionMs) this.#latest.delete(key);
    }
    this.#previous = current;
    return [...this.#latest.values()].sort((left, right) =>
      new Decimal(right.magnitude).comparedTo(left.magnitude) || right.changedAtMs - left.changedAtMs ||
      left.key.localeCompare(right.key));
  }
}
