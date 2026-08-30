import { CatalogSourceStatusSchema, type CatalogSourceStatus } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface CatalogSourceRegistryLike {
  listStatuses(): Promise<readonly CatalogSourceStatus[]>;
}

export interface CatalogSourceRouteOptions {
  readonly cacheTtlMs?: number;
  readonly maxStaleMs?: number;
  readonly initialTimeoutMs?: number;
  readonly refreshTimeoutMs?: number;
}

export function registerCatalogSourceRoutes(app: FastifyInstance, sources: CatalogSourceRegistryLike,
  options: CatalogSourceRouteOptions = {}): void {
  let listInFlight: Promise<readonly CatalogSourceStatus[]> | null = null;
  let recent: { readonly sources: readonly CatalogSourceStatus[]; readonly completedAtMs: number } | null = null;
  // These rows carry each provider's acquiredAtMs, which the UI turns into "how
  // old is this book". Serving them from a five-second stale-while-revalidate
  // cache made the freshness strip lie by up to five seconds even when the
  // catalog was 0-1 s old (measured 2026-08-31 against the live pipeline), and
  // a slow or timing-out refresh let a cached row keep ageing indefinitely,
  // which is how books that were answering normally showed as Lagging or
  // Outdated. Revalidate every second, and never serve a snapshot older than
  // maxStaleMs: past that a caller waits for the real answer instead of being
  // told a stale one.
  const cacheTtlMs = options.cacheTtlMs ?? 1_000;
  const maxStaleMs = options.maxStaleMs ?? 3_000;
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
      const ageMs = performance.now() - recent.completedAtMs;
      if (ageMs < cacheTtlMs) return recent.sources;
      const refreshed = refresh().catch(() => undefined);
      if (ageMs < maxStaleMs) return recent.sources;
      const current = await refreshed;
      return current ?? recent.sources;
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
