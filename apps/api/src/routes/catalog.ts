import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";
import type { CatalogStoreLike } from "../catalog/durable-catalog-store.js";
import { CatalogCoverageGuard } from "../catalog/catalog-coverage-guard.js";
import type { CatalogRevisionStore, StoredCatalogRevision } from "../catalog/catalog-revision-store.js";
import { catalogWithNativeCounts } from "../catalog/catalog-native-coverage.js";
import { streamCatalogJson } from "../catalog/catalog-json-stream.js";

export interface CatalogReaderLike {
  readonly requestTimeoutMs?: number;
  readonly responseCacheMaxAgeMs?: number;
  readonly snapshotFreshnessMaxAgeMs?: number;
  readonly snapshotFreshnessMaxAgeMsFor?: (accountId: string) => number;
  readonly failureRetryBaseMs?: number;
  readonly failureRetryMaxMs?: number;
  readonly collectionTimeoutMs?: number;
  readonly collectorLeaseMs?: number;
  sourceKey?(accountId: string): Promise<string>;
  read(accountId: string): Promise<ObservedProviderCatalog>;
  cancel?(accountId: string): Promise<void>;
}

export interface CatalogObserverLike {
  publish(catalog: ObservedProviderCatalog): void;
}

const paramsSchema = z.strictObject({ accountId: z.string().trim().min(1).max(128) });

/** Stable short digest of a request-scoped set, for cache identity only. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function withinComparisonHorizon(catalog: ObservedProviderCatalog): ObservedProviderCatalog {
  return catalog;
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  reader: CatalogReaderLike,
  telemetry: CatalogTelemetryRegistry = new CatalogTelemetryRegistry(),
  observer?: CatalogObserverLike,
  store?: CatalogStoreLike,
  revisions?: CatalogRevisionStore
): void {
  const requestTimeoutMs = reader.requestTimeoutMs ?? 3_000;
  const responseCacheMaxAgeMs = reader.responseCacheMaxAgeMs ?? 5_000;
  const snapshotFreshnessMaxAgeMs = reader.snapshotFreshnessMaxAgeMs ?? responseCacheMaxAgeMs;
  const failureRetryBaseMs = reader.failureRetryBaseMs ?? 1_000;
  const failureRetryMaxMs = reader.failureRetryMaxMs ?? 5_000;
  const collectionTimeoutMs = reader.collectionTimeoutMs ?? Math.max(30_000, requestTimeoutMs * 2);
  const collectorLeaseMs = reader.collectorLeaseMs ?? 10_000;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("CATALOG_REQUEST_TIMEOUT_INVALID");
  if (!Number.isFinite(responseCacheMaxAgeMs) || responseCacheMaxAgeMs <= 0) {
    throw new Error("CATALOG_RESPONSE_CACHE_MAX_AGE_INVALID");
  }
  if (!Number.isFinite(snapshotFreshnessMaxAgeMs) || snapshotFreshnessMaxAgeMs < responseCacheMaxAgeMs) {
    throw new Error("CATALOG_SNAPSHOT_FRESHNESS_INVALID");
  }
  if (!Number.isFinite(failureRetryBaseMs) || failureRetryBaseMs <= 0 ||
    !Number.isFinite(failureRetryMaxMs) || failureRetryMaxMs < failureRetryBaseMs) {
    throw new Error("CATALOG_FAILURE_RETRY_INVALID");
  }
  if (!Number.isFinite(collectionTimeoutMs) || collectionTimeoutMs <= 0) {
    throw new Error("CATALOG_COLLECTION_TIMEOUT_INVALID");
  }
  if (!Number.isFinite(collectorLeaseMs) || collectorLeaseMs <= 0) {
    throw new Error("CATALOG_COLLECTOR_LEASE_INVALID");
  }
  const readsInFlight = new Map<string, {
    readonly response: Promise<ObservedProviderCatalog>;
    readonly underlying: Promise<ObservedProviderCatalog>;
  }>();
  const recentReads = new Map<string, {
    readonly catalog: ObservedProviderCatalog;
    readonly completedAtMs: number;
    readonly restored: boolean;
  }>();
  const sourceFailures = new Map<string, { readonly count: number; readonly retryAtMs: number }>();
  const restoredSources = new Set<string>();
  const restoresInFlight = new Map<string, Promise<void>>();
  const collectorTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastDemandAtMs = new Map<string, number>();
  const coverageGuard = new CatalogCoverageGuard();
  let closing = false;
  const publicationQueue: ObservedProviderCatalog[] = [];
  let publicationScheduled = false;
  // Browser-backed providers take seconds to refresh. The verified snapshot is
  // the read model; requests only schedule its refresh at this cadence. This
  // prevents 250ms UI polling from continuously reopening provider lounges.
  const coalescingWindowMs = responseCacheMaxAgeMs;

  const within = async <T>(operation: Promise<T>, remainingMs: number): Promise<T> => {
    if (remainingMs <= 0) throw new Error("CATALOG_TIMEOUT");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CATALOG_TIMEOUT")), remainingMs);
      timer.unref?.();
    });
    try { return await Promise.race([operation, timeout]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };

  const forAccount = (
    catalog: ObservedProviderCatalog, accountId: string, snapshotState: "FRESH" | "STALE",
    withoutMarkets = false, wantedEvents: ReadonlySet<string> | null = null
  ): ObservedProviderCatalog & { readonly snapshotState: "FRESH" | "STALE" } => {
    const horizon = withinComparisonHorizon(catalog);
    const wanted = (row: { readonly providerEventId?: unknown }): boolean =>
      wantedEvents === null || wantedEvents.has(String(row.providerEventId));
    const projected = withoutMarkets ? { ...horizon, markets: [], quotes: [] }
      : wantedEvents === null ? horizon
      : { ...horizon, markets: horizon.markets.filter(wanted), quotes: horizon.quotes.filter(wanted),
        ...(horizon.nativeMarketObservations === undefined ? {}
          : { nativeMarketObservations: horizon.nativeMarketObservations.filter(wanted) }) };
    return { ...projected, accountId, snapshotState };
  };

  const publishInBackground = (catalog: ObservedProviderCatalog): void => {
    if (observer === undefined) return;
    publicationQueue.push(catalog);
    if (publicationScheduled) return;
    publicationScheduled = true;
    const drainOne = (): void => {
      const next = publicationQueue.shift();
      if (next === undefined) { publicationScheduled = false; return; }
      setImmediate(() => {
        try { observer.publish(next); } catch { /* runtime publication must not invalidate provider data */ }
        drainOne();
      });
    };
    drainOne();
  };

  const restoreSource = (sourceKey: string): Promise<void> => {
    if (restoredSources.has(sourceKey)) return Promise.resolve();
    const existing = restoresInFlight.get(sourceKey);
    if (existing !== undefined) return existing;
    const operation = (store?.load(sourceKey) ?? Promise.resolve(null)).then((catalog) => {
      if (catalog !== null && !recentReads.has(sourceKey)) {
        coverageGuard.accept(sourceKey, { generation: sourceKey, authoritativeBaseline: false,
          providerEventIds: catalog.events.map((event) => event.providerEventId) });
        recentReads.set(sourceKey, { catalog, completedAtMs: performance.now(), restored: true });
      }
    }).catch(() => undefined).finally(() => {
      restoredSources.add(sourceKey);
      restoresInFlight.delete(sourceKey);
    });
    restoresInFlight.set(sourceKey, operation);
    return operation;
  };

  const scheduleCollector = (sourceKey: string, accountId: string): void => {
    if (closing || collectorTimers.has(sourceKey)) return;
    const demandedAtMs = lastDemandAtMs.get(sourceKey);
    if (demandedAtMs === undefined || performance.now() - demandedAtMs >= collectorLeaseMs) return;
    const failure = sourceFailures.get(sourceKey);
    const delayMs = failure === undefined
      ? responseCacheMaxAgeMs
      : Math.max(1, failure.retryAtMs - performance.now());
    const timer = setTimeout(() => {
      collectorTimers.delete(sourceKey);
      const latestDemandAtMs = lastDemandAtMs.get(sourceKey);
      if (!closing && latestDemandAtMs !== undefined && performance.now() - latestDemandAtMs < collectorLeaseMs) {
        void startRead(sourceKey, accountId).catch(() => undefined);
      }
    }, delayMs);
    timer.unref?.();
    collectorTimers.set(sourceKey, timer);
  };

  const startRead = (sourceKey: string, accountId: string): Promise<ObservedProviderCatalog> => {
    const existing = readsInFlight.get(sourceKey);
    if (existing !== undefined) return existing.response;
    const started = telemetry.now();
    const underlying = Promise.resolve().then(() => reader.read(accountId));
    const operation = within(underlying, collectionTimeoutMs).then(async (catalog) => {
      if (!coverageGuard.accept(sourceKey, { generation: sourceKey, authoritativeBaseline: false,
        providerEventIds: catalog.events.map((event) => event.providerEventId) })) {
        throw new Error("CATALOG_COVERAGE_REGRESSION");
      }
      await telemetry.recordSuccess(accountId, catalog, telemetry.complete(started));
      recentReads.set(sourceKey, { catalog, completedAtMs: performance.now(), restored: false });
      sourceFailures.delete(sourceKey);
      if (store !== undefined) void store.save(sourceKey, catalog).catch(() => undefined);
      publishInBackground(catalog);
      return catalog;
    }).catch(async (error: unknown) => {
      if (error instanceof Error && error.message === "CATALOG_TIMEOUT" && reader.cancel !== undefined) {
        await reader.cancel(accountId).catch(() => undefined);
      }
      const schemaError = error instanceof Error && /(?:^|_)CATALOG_SCHEMA_ERROR$/u.test(error.message);
      await telemetry.recordFailure(accountId, schemaError ? "SCHEMA_ERROR" : "UNAVAILABLE", telemetry.complete(started));
      // A coverage regression means the transport is alive but delivered an
      // incomplete frame. Preserve the last good catalog and sample again at
      // the normal cadence instead of treating it as a disconnected provider.
      if (!(error instanceof Error && error.message === "CATALOG_COVERAGE_REGRESSION")) {
        const count = (sourceFailures.get(sourceKey)?.count ?? 0) + 1;
        const retryDelayMs = Math.min(failureRetryMaxMs, failureRetryBaseMs * 2 ** Math.min(count - 1, 16));
        sourceFailures.set(sourceKey, { count, retryAtMs: performance.now() + retryDelayMs });
      }
      throw error;
    });
    const entry = { response: operation, underlying };
    readsInFlight.set(sourceKey, entry);
    // A timeout releases the HTTP caller, not the Playwright operation. Keep
    // the source occupied until the real browser read settles, otherwise the
    // collector stacks another browser/page on top of the orphaned read.
    void Promise.allSettled([underlying, operation]).then(() => {
      if (readsInFlight.get(sourceKey) === entry) readsInFlight.delete(sourceKey);
      scheduleCollector(sourceKey, accountId);
    });
    void operation.catch(() => undefined);
    return operation;
  };

  app.get("/api/catalog/metrics", async () => telemetry.response());

  app.addHook("onClose", async () => {
    closing = true;
    for (const timer of collectorTimers.values()) clearTimeout(timer);
    collectorTimers.clear();
  });

  app.route({ method: ["GET", "POST"], url: "/api/catalog/accounts/:accountId",
    bodyLimit: 131_072, handler: async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const query = z.object({ nativeDetail: z.enum(["full", "summary", "counts"]).optional(),
      markets: z.enum(["none"]).optional(),
      events: z.string().max(65_536).optional() }).strict()
      .safeParse(request.method === "POST" ? request.body : request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const summary = query.data.nativeDetail === "summary";
    const counts = query.data.nativeDetail === "counts";
    // Fixtures without their prices. Deciding which events two books share needs
    // only the events, and markets are the overwhelming majority of a catalog:
    // measured 2026-09-10, one book's response was 99.9 MB of the 146.4 MB the
    // dashboard fetched per polling round. A caller can settle that question
    // cheaply here and then ask for markets only where they can actually pair,
    // which is a reduction that cannot cost a pair - unlike narrowing what is
    // collected, which decides coverage before anyone has looked.
    const withoutMarkets = query.data.markets === "none";
    // Prices for named fixtures only. The caller has already decided, from the
    // fixtures alone, which of them another book also lists; markets for the
    // rest cannot form a cross-book pair and are the bulk of the transfer.
    // Every event still travels either way, so a fixture that becomes pairable
    // later is simply asked for on the next round.
    const wantedEvents = query.data.events === undefined ? null
      : new Set(query.data.events.split(",").map((id) => id.trim()).filter((id) => id.length > 0));
    if (wantedEvents !== null && (wantedEvents.size === 0 || wantedEvents.size > 5_000 ||
      [...wantedEvents].some((id) => !/^[A-Za-z0-9._:|-]{1,128}$/u.test(id)))) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    const view = (catalog: ReturnType<typeof forAccount>) =>
      counts ? catalogWithNativeCounts(catalog) : !summary || catalog.nativeMarketObservations === undefined ? catalog : { ...catalog,
        nativeMarketObservations: catalog.nativeMarketObservations.map(({ nativeSelections: _selections, nativeRow: _rawRow,
          ...observation }) => observation) };
    const sendView = (catalog: ReturnType<typeof forAccount>) => reply
      .type("application/json; charset=utf-8")
      .send(Readable.from(streamCatalogJson(view(catalog) as Readonly<Record<string, unknown>>)));
    // A narrowed response must never answer a request for a different
    // narrowing, so the tag identifies the exact set, not its size.
    const eventsTag = wantedEvents === null ? ""
      : `-events:${wantedEvents.size}:${fnv1a([...wantedEvents].sort().join(","))}`;
    const etagSuffix = `${counts ? "-native-counts" : summary ? "-native-summary" : ""}` +
      `${query.data.markets === "none" ? "-no-markets" : ""}${eventsTag}`;
    try {
      const accountId = parsed.data.accountId;
      const accountSnapshotFreshnessMaxAgeMs = reader.snapshotFreshnessMaxAgeMsFor?.(accountId) ??
        snapshotFreshnessMaxAgeMs;
      if (!Number.isFinite(accountSnapshotFreshnessMaxAgeMs) ||
        accountSnapshotFreshnessMaxAgeMs < responseCacheMaxAgeMs) {
        throw new Error("CATALOG_SNAPSHOT_FRESHNESS_INVALID");
      }
      const sendRevision = (entry: StoredCatalogRevision) => {
        const etag = `"${entry.revision}${etagSuffix}"`;
        reply.header("etag", etag).header("x-catalog-revision", entry.revision);
        if (request.method === "GET" && request.headers["if-none-match"] === etag) return reply.code(304).send();
        return sendView(forAccount(entry.catalog, accountId, entry.snapshotState, withoutMarkets, wantedEvents));
      };
      const sendCatalog = (catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => {
        if (revisions !== undefined) return sendRevision(revisions.publish(accountId, catalog, {
          snapshotState, freshnessMs: accountSnapshotFreshnessMaxAgeMs
        }));
        const etag = `"${catalog.provider}-${catalog.category}-${catalog.observedAtMs}-${snapshotState}${etagSuffix}"`;
        reply.header("etag", etag);
        if (request.method === "GET" && request.headers["if-none-match"] === etag) return reply.code(304).send();
        return sendView(forAccount(catalog, accountId, snapshotState, withoutMarkets, wantedEvents));
      };
      const deadlineMs = performance.now() + requestTimeoutMs;
      const sourceKey = await within(
        reader.sourceKey === undefined ? Promise.resolve(accountId) : reader.sourceKey(accountId),
        deadlineMs - performance.now()
      );
      lastDemandAtMs.set(sourceKey, performance.now());
      let published = revisions?.get(accountId);
      if (published === undefined) {
        await within(restoreSource(sourceKey), deadlineMs - performance.now());
        // Ingress can publish a newer catalog while the cold restore is pending.
        published = revisions?.get(accountId);
      } else if (!restoredSources.has(sourceKey)) {
        // Startup already restored/published Chrome catalogs. Reading disk here
        // would duplicate the entire book just to serve the existing revision.
        coverageGuard.accept(sourceKey, { generation: sourceKey, authoritativeBaseline: false,
          providerEventIds: published.catalog.events.map((event) => event.providerEventId) });
        restoredSources.add(sourceKey);
      }
      if (published !== undefined) {
        if (published.snapshotState === "STALE") void startRead(sourceKey, accountId).catch(() => undefined);
        else scheduleCollector(sourceKey, accountId);
        return sendRevision(published);
      }
      const recent = recentReads.get(sourceKey);
      const recentAgeMs = recent === undefined ? Number.POSITIVE_INFINITY : performance.now() - recent.completedAtMs;
      if (recent !== undefined && recent.restored) {
        void startRead(sourceKey, accountId).catch(() => undefined);
        return sendCatalog(recent.catalog, "STALE");
      }
      if (recent !== undefined && recentAgeMs < coalescingWindowMs) {
        scheduleCollector(sourceKey, accountId);
        return sendCatalog(recent.catalog, "FRESH");
      }
      const failure = sourceFailures.get(sourceKey);
      if (failure !== undefined && failure.retryAtMs > performance.now()) {
        if (recent !== undefined) return sendCatalog(recent.catalog,
          !recent.restored && recentAgeMs < accountSnapshotFreshnessMaxAgeMs ? "FRESH" : "STALE");
        throw new Error("CATALOG_RETRY_BACKOFF");
      }
      const operation = startRead(sourceKey, accountId);
      // Stale-while-revalidate: never make a browser-backed refresh part of the
      // UI response path once this source has produced verified data. The
      // observedAt timestamp lets the client keep it display-only when old.
      if (recent !== undefined) return sendCatalog(recent.catalog,
        recentAgeMs < accountSnapshotFreshnessMaxAgeMs ? "FRESH" : "STALE");
      const catalog = await within(operation, deadlineMs - performance.now());
      return sendCatalog(catalog, "FRESH");
    } catch (error) {
      if (error instanceof Error && error.message === "CATALOG_TIMEOUT") {
        return reply.code(503).send({ error: "CATALOG_TIMEOUT" });
      }
      const schemaError = error instanceof Error && /(?:^|_)CATALOG_SCHEMA_ERROR$/u.test(error.message);
      if (schemaError) {
        return reply.code(422).send({ error: "CATALOG_SCHEMA_ERROR" });
      }
      return reply.code(503).send({ error: "CATALOG_UNAVAILABLE" });
    }
  }});
}
