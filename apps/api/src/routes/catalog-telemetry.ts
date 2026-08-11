import type { ProviderId } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export type CatalogTelemetryState = "SUCCESS" | "UNAVAILABLE" | "SCHEMA_ERROR";

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
}

const systemClock: CatalogTelemetryClock = {
  wallNowMs: () => Date.now(),
  monotonicNowMs: () => performance.now()
};

function duration(timing: CatalogReadTiming): number {
  return Math.max(0, timing.completedMonotonicMs - timing.requestStartedMonotonicMs);
}

function newestSourceTimestamp(catalog: ObservedProviderCatalog): number | null {
  const values = catalog.quotes.flatMap((quote) => quote.sourceTimestampMs === null ? [] : [quote.sourceTimestampMs]);
  return values.length === 0 ? null : Math.max(...values);
}

export class CatalogTelemetryRegistry {
  readonly #clock: CatalogTelemetryClock;
  readonly #entries = new Map<string, CatalogReadTelemetry>();

  constructor(clock: CatalogTelemetryClock = systemClock) {
    this.#clock = clock;
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

  recordSuccess(accountId: string, catalog: ObservedProviderCatalog, timing: CatalogReadTiming): void {
    const previous = this.#entries.get(accountId);
    const newest = newestSourceTimestamp(catalog);
    this.#entries.set(accountId, {
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
      schemaErrorCount: previous?.schemaErrorCount ?? 0
    });
  }

  recordFailure(accountId: string, state: Exclude<CatalogTelemetryState, "SUCCESS">, timing: CatalogReadTiming): void {
    const previous = this.#entries.get(accountId);
    this.#entries.set(accountId, {
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
      schemaErrorCount: (previous?.schemaErrorCount ?? 0) + (state === "SCHEMA_ERROR" ? 1 : 0)
    });
  }

  response(): { readonly dataMode: "LIVE"; readonly generatedAtMs: number; readonly metrics: readonly CatalogReadTelemetry[] } {
    return {
      dataMode: "LIVE",
      generatedAtMs: this.#clock.wallNowMs(),
      metrics: [...this.#entries.values()].sort((left, right) => left.accountId.localeCompare(right.accountId))
    };
  }
}
