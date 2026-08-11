import type { ProviderId } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export type CatalogTelemetryState = "SUCCESS" | "UNAVAILABLE" | "SCHEMA_ERROR";

export type CatalogJournalEventType = "SNAPSHOT_ACCEPTED" | "ODDS_CHANGED" | "STATUS_CHANGED" |
  "SEQUENCE_GAP" | "CATALOG_UNAVAILABLE" | "CATALOG_SCHEMA_ERROR" | "CATALOG_RECOVERED";

export interface CatalogJournalEntry {
  readonly type: CatalogJournalEventType;
  readonly atMs: number;
  readonly provider: ProviderId | null;
  readonly category: "FOOTBALL" | null;
  readonly providerEventId: string | null;
  readonly providerMarketId: string | null;
  readonly providerSelectionId: string | null;
  readonly marketType: string | null;
  readonly scope: string | null;
  readonly selection: string | null;
  readonly line: string | null;
  readonly previousOdds: string | null;
  readonly currentOdds: string | null;
  readonly previousStatus: string | null;
  readonly currentStatus: string | null;
  readonly previousSequence: number | null;
  readonly sequence: number | null;
  readonly sourceTimestampMs: number | null;
  readonly observedAtMs: number | null;
}

export interface CatalogJournal {
  append(entries: readonly CatalogJournalEntry[]): Promise<void>;
}

export interface CatalogTelemetryClock {
  wallNowMs(): number;
  monotonicNowMs(): number;
}

export interface CatalogReadTiming {
  readonly requestStartedAtMs: number;
  readonly requestStartedMonotonicMs: number;
  readonly completedAtMs: number;
  readonly completedMonotonicMs: number;
}

export interface CatalogReadTelemetry {
  readonly accountId: string;
  readonly provider: ProviderId | null;
  readonly category: "FOOTBALL" | null;
  readonly state: CatalogTelemetryState;
  readonly requestStartedAtMs: number;
  readonly completedAtMs: number;
  readonly durationMs: number;
  readonly observedAtMs: number | null;
  readonly newestSourceTimestampMs: number | null;
  readonly sourceAgeMs: number | null;
  readonly eventCount: number;
  readonly marketCount: number;
  readonly quoteCount: number;
  readonly rejectedMarketCount: number;
  readonly totalReads: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly schemaErrorCount: number;
  readonly latestSequence: number | null;
  readonly sequenceGapCount: number;
  readonly recoveryCount: number;
  readonly priceChangeCount: number;
  readonly statusChangeCount: number;
  readonly consecutiveFailures: number;
  readonly journalErrorCount: number;
}

const systemClock: CatalogTelemetryClock = {
  wallNowMs: () => Date.now(),
  monotonicNowMs: () => performance.now()
};

const noOpJournal: CatalogJournal = { append: async () => undefined };

interface QuoteJournalState {
  readonly provider: ProviderId;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly marketType: string;
  readonly scope: string;
  readonly selection: string;
  readonly line: string | null;
  readonly rawOdds: string;
  readonly status: string;
  readonly sequence: number | null;
  readonly sourceTimestampMs: number | null;
}

function quoteKey(quote: QuoteJournalState): string {
  return [quote.provider, quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join("\u0000");
}

function journalEntry(
  type: CatalogJournalEventType,
  atMs: number,
  catalog: ObservedProviderCatalog | null,
  current: QuoteJournalState | null = null,
  previous: QuoteJournalState | null = null
): CatalogJournalEntry {
  return {
    type,
    atMs,
    provider: catalog?.provider ?? current?.provider ?? previous?.provider ?? null,
    category: catalog?.category ?? null,
    providerEventId: current?.providerEventId ?? previous?.providerEventId ?? null,
    providerMarketId: current?.providerMarketId ?? previous?.providerMarketId ?? null,
    providerSelectionId: current?.providerSelectionId ?? previous?.providerSelectionId ?? null,
    marketType: current?.marketType ?? previous?.marketType ?? null,
    scope: current?.scope ?? previous?.scope ?? null,
    selection: current?.selection ?? previous?.selection ?? null,
    line: current?.line ?? previous?.line ?? null,
    previousOdds: previous?.rawOdds ?? null,
    currentOdds: current?.rawOdds ?? null,
    previousStatus: previous?.status ?? null,
    currentStatus: current?.status ?? null,
    previousSequence: previous?.sequence ?? null,
    sequence: current?.sequence ?? null,
    sourceTimestampMs: current?.sourceTimestampMs ?? null,
    observedAtMs: catalog?.observedAtMs ?? null
  };
}

function duration(timing: CatalogReadTiming): number {
  return Math.max(0, timing.completedMonotonicMs - timing.requestStartedMonotonicMs);
}

function newestSourceTimestamp(catalog: ObservedProviderCatalog): number | null {
  const values = catalog.quotes.flatMap((quote) => quote.sourceTimestampMs === null ? [] : [quote.sourceTimestampMs]);
  return values.length === 0 ? null : Math.max(...values);
}

export class CatalogTelemetryRegistry {
  readonly #clock: CatalogTelemetryClock;
  readonly #journal: CatalogJournal;
  readonly #entries = new Map<string, CatalogReadTelemetry>();
  readonly #quotes = new Map<string, Map<string, QuoteJournalState>>();

  constructor(clock: CatalogTelemetryClock = systemClock, journal: CatalogJournal = noOpJournal) {
    this.#clock = clock;
    this.#journal = journal;
  }

  now(): CatalogReadTiming {
    const wall = this.#clock.wallNowMs();
    const monotonic = this.#clock.monotonicNowMs();
    return {
      requestStartedAtMs: wall,
      requestStartedMonotonicMs: monotonic,
      completedAtMs: wall,
      completedMonotonicMs: monotonic
    };
  }

  complete(started: CatalogReadTiming): CatalogReadTiming {
    return {
      ...started,
      completedAtMs: this.#clock.wallNowMs(),
      completedMonotonicMs: this.#clock.monotonicNowMs()
    };
  }

  async recordSuccess(accountId: string, catalog: ObservedProviderCatalog, timing: CatalogReadTiming): Promise<void> {
    const previous = this.#entries.get(accountId);
    const newest = newestSourceTimestamp(catalog);
    const priorQuotes = this.#quotes.get(accountId) ?? new Map<string, QuoteJournalState>();
    const currentQuotes = new Map<string, QuoteJournalState>();
    const journal: CatalogJournalEntry[] = [];
    let sequenceGaps = 0;
    let priceChanges = 0;
    let statusChanges = 0;
    for (const quote of catalog.quotes) {
      const current: QuoteJournalState = {
        provider: catalog.provider,
        providerEventId: quote.providerEventId,
        providerMarketId: quote.providerMarketId,
        providerSelectionId: quote.providerSelectionId,
        marketType: quote.marketType,
        scope: quote.scope,
        selection: quote.selection,
        line: quote.line,
        rawOdds: quote.rawOdds,
        status: quote.status,
        sequence: quote.sequence,
        sourceTimestampMs: quote.sourceTimestampMs
      };
      const key = quoteKey(current);
      currentQuotes.set(key, current);
      const prior = priorQuotes.get(key);
      if (prior === undefined) continue;
      if (current.sequence !== null && prior.sequence !== null && current.sequence > prior.sequence + 1) {
        sequenceGaps += 1;
        journal.push(journalEntry("SEQUENCE_GAP", timing.completedAtMs, catalog, current, prior));
      }
      if (current.rawOdds !== prior.rawOdds) {
        priceChanges += 1;
        journal.push(journalEntry("ODDS_CHANGED", timing.completedAtMs, catalog, current, prior));
      }
      if (current.status !== prior.status) {
        statusChanges += 1;
        journal.push(journalEntry("STATUS_CHANGED", timing.completedAtMs, catalog, current, prior));
      }
    }
    const recovered = previous !== undefined && previous.state !== "SUCCESS";
    if (previous === undefined) journal.unshift(journalEntry("SNAPSHOT_ACCEPTED", timing.completedAtMs, catalog));
    if (recovered) journal.unshift(journalEntry("CATALOG_RECOVERED", timing.completedAtMs, catalog));
    const sequences = catalog.quotes.flatMap((quote) => quote.sequence === null ? [] : [quote.sequence]);
    const next: CatalogReadTelemetry = {
      accountId,
      provider: catalog.provider,
      category: catalog.category,
      state: "SUCCESS",
      requestStartedAtMs: timing.requestStartedAtMs,
      completedAtMs: timing.completedAtMs,
      durationMs: duration(timing),
      observedAtMs: catalog.observedAtMs,
      newestSourceTimestampMs: newest,
      sourceAgeMs: newest === null ? null : Math.max(0, timing.completedAtMs - newest),
      eventCount: catalog.events.length,
      marketCount: catalog.markets.length,
      quoteCount: catalog.quotes.length,
      rejectedMarketCount: catalog.rejectedMarketCount,
      totalReads: (previous?.totalReads ?? 0) + 1,
      successCount: (previous?.successCount ?? 0) + 1,
      failureCount: previous?.failureCount ?? 0,
      schemaErrorCount: previous?.schemaErrorCount ?? 0,
      latestSequence: sequences.length === 0 ? previous?.latestSequence ?? null : Math.max(...sequences),
      sequenceGapCount: (previous?.sequenceGapCount ?? 0) + sequenceGaps,
      recoveryCount: (previous?.recoveryCount ?? 0) + (recovered ? 1 : 0),
      priceChangeCount: (previous?.priceChangeCount ?? 0) + priceChanges,
      statusChangeCount: (previous?.statusChangeCount ?? 0) + statusChanges,
      consecutiveFailures: 0,
      journalErrorCount: previous?.journalErrorCount ?? 0
    };
    this.#entries.set(accountId, next);
    this.#quotes.set(accountId, currentQuotes);
    await this.#append(accountId, journal);
  }

  async recordFailure(
    accountId: string,
    state: Exclude<CatalogTelemetryState, "SUCCESS">,
    timing: CatalogReadTiming
  ): Promise<void> {
    const previous = this.#entries.get(accountId);
    const next: CatalogReadTelemetry = {
      accountId,
      provider: previous?.provider ?? null,
      category: previous?.category ?? null,
      state,
      requestStartedAtMs: timing.requestStartedAtMs,
      completedAtMs: timing.completedAtMs,
      durationMs: duration(timing),
      observedAtMs: previous?.observedAtMs ?? null,
      newestSourceTimestampMs: previous?.newestSourceTimestampMs ?? null,
      sourceAgeMs: previous?.newestSourceTimestampMs === null || previous?.newestSourceTimestampMs === undefined
        ? null : Math.max(0, timing.completedAtMs - previous.newestSourceTimestampMs),
      eventCount: previous?.eventCount ?? 0,
      marketCount: previous?.marketCount ?? 0,
      quoteCount: previous?.quoteCount ?? 0,
      rejectedMarketCount: previous?.rejectedMarketCount ?? 0,
      totalReads: (previous?.totalReads ?? 0) + 1,
      successCount: previous?.successCount ?? 0,
      failureCount: (previous?.failureCount ?? 0) + 1,
      schemaErrorCount: (previous?.schemaErrorCount ?? 0) + (state === "SCHEMA_ERROR" ? 1 : 0),
      latestSequence: previous?.latestSequence ?? null,
      sequenceGapCount: previous?.sequenceGapCount ?? 0,
      recoveryCount: previous?.recoveryCount ?? 0,
      priceChangeCount: previous?.priceChangeCount ?? 0,
      statusChangeCount: previous?.statusChangeCount ?? 0,
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      journalErrorCount: previous?.journalErrorCount ?? 0
    };
    this.#entries.set(accountId, next);
    if (previous?.state !== state) {
      await this.#append(accountId, [journalEntry(
        state === "SCHEMA_ERROR" ? "CATALOG_SCHEMA_ERROR" : "CATALOG_UNAVAILABLE",
        timing.completedAtMs,
        null
      )]);
    }
  }

  async #append(accountId: string, entries: readonly CatalogJournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      await this.#journal.append(entries);
    } catch {
      const current = this.#entries.get(accountId);
      if (current !== undefined) this.#entries.set(accountId, { ...current, journalErrorCount: current.journalErrorCount + 1 });
    }
  }

  response(): { readonly dataMode: "LIVE"; readonly generatedAtMs: number; readonly metrics: readonly CatalogReadTelemetry[] } {
    return {
      dataMode: "LIVE",
      generatedAtMs: this.#clock.wallNowMs(),
      metrics: [...this.#entries.values()].sort((left, right) => left.accountId.localeCompare(right.accountId))
    };
  }
}
