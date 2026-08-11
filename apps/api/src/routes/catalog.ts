import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";

export interface CatalogReaderLike {
  read(accountId: string): Promise<ObservedProviderCatalog>;
}

const paramsSchema = z.strictObject({ accountId: z.string().trim().min(1).max(128) });

export function registerCatalogRoutes(
  app: FastifyInstance,
  reader: CatalogReaderLike,
  telemetry: CatalogTelemetryRegistry = new CatalogTelemetryRegistry()
): void {
  app.get("/api/catalog/metrics", async () => telemetry.response());

  app.get("/api/catalog/accounts/:accountId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    const started = telemetry.now();
    try {
      const catalog = await reader.read(parsed.data.accountId);
      await telemetry.recordSuccess(parsed.data.accountId, catalog, telemetry.complete(started));
      return catalog;
    } catch (error) {
      const schemaError = error instanceof Error && /(?:^|_)CATALOG_SCHEMA_ERROR$/u.test(error.message);
      await telemetry.recordFailure(
        parsed.data.accountId,
        schemaError ? "SCHEMA_ERROR" : "UNAVAILABLE",
        telemetry.complete(started)
      );
      if (schemaError) {
        return reply.code(422).send({ error: "CATALOG_SCHEMA_ERROR" });
      }
      return reply.code(503).send({ error: "CATALOG_UNAVAILABLE" });
    }
  });
}
