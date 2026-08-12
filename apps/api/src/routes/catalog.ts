import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";

export interface CatalogReaderLike {
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
  const readsInFlight = new Map<string, Promise<ObservedProviderCatalog>>();
  const recentReads = new Map<string, { readonly catalog: ObservedProviderCatalog; readonly completedAtMs: number }>();
  const coalescingWindowMs = 250;

  app.get("/api/catalog/metrics", async () => telemetry.response());

  app.get("/api/catalog/accounts/:accountId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      const accountId = parsed.data.accountId;
      const recent = recentReads.get(accountId);
      if (recent !== undefined && performance.now() - recent.completedAtMs < coalescingWindowMs) {
        return recent.catalog;
      }
      let operation = readsInFlight.get(accountId);
      if (operation === undefined) {
        const started = telemetry.now();
        operation = reader.read(accountId).then(async (catalog) => {
          await telemetry.recordSuccess(accountId, catalog, telemetry.complete(started));
          observer?.publish(catalog);
          recentReads.set(accountId, { catalog, completedAtMs: performance.now() });
          return catalog;
        }).catch(async (error: unknown) => {
          const schemaError = error instanceof Error && /(?:^|_)CATALOG_SCHEMA_ERROR$/u.test(error.message);
          await telemetry.recordFailure(accountId, schemaError ? "SCHEMA_ERROR" : "UNAVAILABLE", telemetry.complete(started));
          throw error;
        }).finally(() => readsInFlight.delete(accountId));
        readsInFlight.set(accountId, operation);
      }
      const catalog = await operation;
      return catalog;
    } catch (error) {
      const schemaError = error instanceof Error && /(?:^|_)CATALOG_SCHEMA_ERROR$/u.test(error.message);
      if (schemaError) {
        return reply.code(422).send({ error: "CATALOG_SCHEMA_ERROR" });
      }
      return reply.code(503).send({ error: "CATALOG_UNAVAILABLE" });
    }
  });
}
