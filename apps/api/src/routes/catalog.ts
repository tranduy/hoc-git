import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";
import type { CatalogStoreLike } from "../catalog/durable-catalog-store.js";
import { CatalogCoverageGuard } from "../catalog/catalog-coverage-guard.js";
import type { CatalogRevisionStore, StoredCatalogRevision } from "../catalog/catalog-revision-store.js";

export interface CatalogReaderLike {
  readonly requestTimeoutMs?: number;
  readonly responseCacheMaxAgeMs?: number;
  readonly snapshotFreshnessMaxAgeMs?: number;
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
    catalog: ObservedProviderCatalog, accountId: string, snapshotState: "FRESH" | "STALE"
  ): ObservedProviderCatalog & { readonly snapshotState: "FRESH" | "STALE" } => ({
    ...catalog, accountId, snapshotState
  });

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

  app.get("/api/catalog/accounts/:accountId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      const accountId = parsed.data.accountId;
      const sendRevision = (entry: StoredCatalogRevision) => {
        const etag = `"${entry.revision}"`;
        reply.header("etag", etag).header("x-catalog-revision", entry.revision);
        if (request.headers["if-none-match"] === etag) return reply.code(304).send();
        return forAccount(entry.catalog, accountId, entry.snapshotState);
      };
      const sendCatalog = (catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => {
        if (revisions !== undefined) return sendRevision(revisions.publish(accountId, catalog, {
          snapshotState, freshnessMs: snapshotFreshnessMaxAgeMs
        }));
        const etag = `"${catalog.provider}-${catalog.category}-${catalog.observedAtMs}-${snapshotState}"`;
        reply.header("etag", etag);
        if (request.headers["if-none-match"] === etag) return reply.code(304).send();
        return forAccount(catalog, accountId, snapshotState);
      };
      const deadlineMs = performance.now() + requestTimeoutMs;
      const sourceKey = await within(
        reader.sourceKey === undefined ? Promise.resolve(accountId) : reader.sourceKey(accountId),
        deadlineMs - performance.now()
      );
      lastDemandAtMs.set(sourceKey, performance.now());
      await within(restoreSource(sourceKey), deadlineMs - performance.now());
      const published = revisions?.get(accountId);
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
          !recent.restored && recentAgeMs < snapshotFreshnessMaxAgeMs ? "FRESH" : "STALE");
        throw new Error("CATALOG_RETRY_BACKOFF");
      }
      const operation = startRead(sourceKey, accountId);
      // Stale-while-revalidate: never make a browser-backed refresh part of the
      // UI response path once this source has produced verified data. The
      // observedAt timestamp lets the client keep it display-only when old.
      if (recent !== undefined) return sendCatalog(recent.catalog,
        recentAgeMs < snapshotFreshnessMaxAgeMs ? "FRESH" : "STALE");
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
  });
}
