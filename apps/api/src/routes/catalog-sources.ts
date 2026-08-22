import { CatalogSourceStatusSchema, type CatalogSourceStatus } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface CatalogSourceRegistryLike {
  listStatuses(): Promise<readonly CatalogSourceStatus[]>;
}

export interface CatalogSourceRouteOptions {
  readonly cacheTtlMs?: number;
  readonly initialTimeoutMs?: number;
  readonly refreshTimeoutMs?: number;
}

export function registerCatalogSourceRoutes(app: FastifyInstance, sources: CatalogSourceRegistryLike,
  options: CatalogSourceRouteOptions = {}): void {
  let listInFlight: Promise<readonly CatalogSourceStatus[]> | null = null;
  let recent: { readonly sources: readonly CatalogSourceStatus[]; readonly completedAtMs: number } | null = null;
  const cacheTtlMs = options.cacheTtlMs ?? 5_000;
  const initialTimeoutMs = options.initialTimeoutMs ?? 1_000;
  const refreshTimeoutMs = options.refreshTimeoutMs ?? 2_000;
  const refresh = (): Promise<readonly CatalogSourceStatus[]> => {
    if (listInFlight !== null) return listInFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("CATALOG_SOURCE_REFRESH_TIMEOUT")), refreshTimeoutMs);
      timer.unref?.();
    });
    const operation = Promise.race([sources.listStatuses(), timeout]).then((statuses) => {
      const parsed = CatalogSourceStatusSchema.array().parse(statuses);
      recent = { sources: parsed, completedAtMs: performance.now() };
      return parsed;
    }).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      if (listInFlight === operation) listInFlight = null;
    });
    listInFlight = operation;
    return operation;
  };
  const list = async (): Promise<readonly CatalogSourceStatus[]> => {
    if (recent !== null) {
      if (performance.now() - recent.completedAtMs >= cacheTtlMs) void refresh().catch(() => undefined);
      return recent.sources;
    }
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CATALOG_SOURCE_STATUS_TIMEOUT")), initialTimeoutMs);
      timer.unref();
    });
    return Promise.race([refresh(), timeout]);
  };

  app.get("/api/catalog/sources", async (_request, reply) => {
    try {
      return { sources: await list() };
    } catch {
      return reply.code(503).send({ error: "CATALOG_SOURCES_UNAVAILABLE" });
    }
  });
}
