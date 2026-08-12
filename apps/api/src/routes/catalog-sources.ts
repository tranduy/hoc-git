import { CatalogSourceStatusSchema, type CatalogSourceStatus } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface CatalogSourceRegistryLike {
  listStatuses(): Promise<readonly CatalogSourceStatus[]>;
}

export function registerCatalogSourceRoutes(app: FastifyInstance, sources: CatalogSourceRegistryLike): void {
  let listInFlight: Promise<readonly CatalogSourceStatus[]> | null = null;
  let recent: { readonly sources: readonly CatalogSourceStatus[]; readonly completedAtMs: number } | null = null;
  const coalescingWindowMs = 250;
  const list = (): Promise<readonly CatalogSourceStatus[]> => {
    if (recent !== null && performance.now() - recent.completedAtMs < coalescingWindowMs) {
      return Promise.resolve(recent.sources);
    }
    if (listInFlight !== null) return listInFlight;
    const operation = sources.listStatuses().then((statuses) => {
      const parsed = CatalogSourceStatusSchema.array().parse(statuses);
      recent = { sources: parsed, completedAtMs: performance.now() };
      return parsed;
    }).finally(() => { if (listInFlight === operation) listInFlight = null; });
    listInFlight = operation;
    return operation;
  };

  app.get("/api/catalog/sources", async (_request, reply) => {
    try {
      return { sources: await list() };
    } catch {
      return reply.code(503).send({ error: "CATALOG_SOURCES_UNAVAILABLE" });
    }
  });
}
