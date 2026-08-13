import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";

export interface CatalogReaderLike {
  readonly requestTimeoutMs?: number;
  readonly responseCacheMaxAgeMs?: number;
  readonly failureRetryBaseMs?: number;
  readonly failureRetryMaxMs?: number;
  sourceKey?(accountId: string): Promise<string>;
  read(accountId: string): Promise<ObservedProviderCatalog>;
}

export interface CatalogObserverLike {
  publish(catalog: ObservedProviderCatalog): void;
}

const paramsSchema = z.strictObject({ accountId: z.string().trim().min(1).max(128) });

export function registerCatalogRoutes(
  app: FastifyInstance,
  reader: CatalogReaderLike,
  telemetry: CatalogTelemetryRegistry = new CatalogTelemetryRegistry(),
  observer?: CatalogObserverLike
): void {
  const requestTimeoutMs = reader.requestTimeoutMs ?? 3_000;
  const responseCacheMaxAgeMs = reader.responseCacheMaxAgeMs ?? 5_000;
  const failureRetryBaseMs = reader.failureRetryBaseMs ?? 1_000;
  const failureRetryMaxMs = reader.failureRetryMaxMs ?? 5_000;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw new Error("CATALOG_REQUEST_TIMEOUT_INVALID");
  if (!Number.isFinite(responseCacheMaxAgeMs) || responseCacheMaxAgeMs <= 0) {
    throw new Error("CATALOG_RESPONSE_CACHE_MAX_AGE_INVALID");
  }
  if (!Number.isFinite(failureRetryBaseMs) || failureRetryBaseMs <= 0 ||
    !Number.isFinite(failureRetryMaxMs) || failureRetryMaxMs < failureRetryBaseMs) {
    throw new Error("CATALOG_FAILURE_RETRY_INVALID");
  }
  const readsInFlight = new Map<string, Promise<ObservedProviderCatalog>>();
  const recentReads = new Map<string, { readonly catalog: ObservedProviderCatalog; readonly completedAtMs: number }>();
  const sourceFailures = new Map<string, { readonly count: number; readonly retryAtMs: number }>();
  const coalescingWindowMs = 250;

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

  const forAccount = (catalog: ObservedProviderCatalog, accountId: string): ObservedProviderCatalog =>
    catalog.accountId === accountId ? catalog : { ...catalog, accountId };

  const startRead = (sourceKey: string, accountId: string): Promise<ObservedProviderCatalog> => {
    const existing = readsInFlight.get(sourceKey);
    if (existing !== undefined) return existing;
    const started = telemetry.now();
    const operation = reader.read(accountId).then(async (catalog) => {
      await telemetry.recordSuccess(accountId, catalog, telemetry.complete(started));
      observer?.publish(catalog);
      recentReads.set(sourceKey, { catalog, completedAtMs: performance.now() });
      sourceFailures.delete(sourceKey);
      return catalog;
    }).catch(async (error: unknown) => {
      const schemaError = error instanceof Error && /(?:^|_)CATALOG_SCHEMA_ERROR$/u.test(error.message);
      await telemetry.recordFailure(accountId, schemaError ? "SCHEMA_ERROR" : "UNAVAILABLE", telemetry.complete(started));
      const count = (sourceFailures.get(sourceKey)?.count ?? 0) + 1;
      const retryDelayMs = Math.min(failureRetryMaxMs, failureRetryBaseMs * 2 ** Math.min(count - 1, 16));
      sourceFailures.set(sourceKey, { count, retryAtMs: performance.now() + retryDelayMs });
      throw error;
    }).finally(() => { if (readsInFlight.get(sourceKey) === operation) readsInFlight.delete(sourceKey); });
    readsInFlight.set(sourceKey, operation);
    void operation.catch(() => undefined);
    return operation;
  };

  app.get("/api/catalog/metrics", async () => telemetry.response());

  app.get("/api/catalog/accounts/:accountId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      const accountId = parsed.data.accountId;
      const deadlineMs = performance.now() + requestTimeoutMs;
      const sourceKey = await within(
        reader.sourceKey === undefined ? Promise.resolve(accountId) : reader.sourceKey(accountId),
        deadlineMs - performance.now()
      );
      const recent = recentReads.get(sourceKey);
      const recentAgeMs = recent === undefined ? Number.POSITIVE_INFINITY : performance.now() - recent.completedAtMs;
      if (recent !== undefined && recentAgeMs < Math.min(coalescingWindowMs, responseCacheMaxAgeMs)) {
        return forAccount(recent.catalog, accountId);
      }
      const failure = sourceFailures.get(sourceKey);
      if (failure !== undefined && failure.retryAtMs > performance.now()) {
        if (recent !== undefined && recentAgeMs < responseCacheMaxAgeMs) return forAccount(recent.catalog, accountId);
        throw new Error("CATALOG_RETRY_BACKOFF");
      }
      const operation = startRead(sourceKey, accountId);
      if (recent !== undefined && recentAgeMs < responseCacheMaxAgeMs) return forAccount(recent.catalog, accountId);
      const catalog = await within(operation, deadlineMs - performance.now());
      return forAccount(catalog, accountId);
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
