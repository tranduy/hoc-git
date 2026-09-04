import type { FastifyInstance } from "fastify";
import type { SessionRefreshControl } from "../session-maintenance.js";

const refreshableProviders = new Set(["SABA", "IM", "SBOBET", "APSPORT", "BTI", "CMD"] as const);
export type RefreshableProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI" | "CMD";

const PROVIDER_REFRESH_COOLDOWN_MS = 60_000;

interface MaintenanceRouteOptions {
  readonly refreshProvider?: (provider: RefreshableProvider) => Promise<number>;
  readonly recoverIm?: (url: string) => number;
}

export function registerMaintenanceRoutes(app: FastifyInstance, maintenance: SessionRefreshControl,
  options: MaintenanceRouteOptions = {}): void {
  const lastProviderRefreshAtMs = new Map<RefreshableProvider, number>();
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/maintenance")) return;
    const ip = request.ip.replace(/^::ffff:/u, "");
    if (ip !== "127.0.0.1" && ip !== "::1") await reply.code(403).send({ error: "LOCAL_ACCESS_ONLY" });
  });
  app.get("/api/maintenance", async () => maintenance.status());
  app.get("/api/maintenance/logs", async () => ({ logs: maintenance.logs() }));
  app.post("/api/maintenance/refresh-all", async (_request, reply) =>
    reply.code(202).send(maintenance.start("MANUAL")));
  app.post<{ Params: { provider: string } }>("/api/maintenance/refresh-provider/:provider",
    async (request, reply) => {
      const provider = request.params.provider.toUpperCase();
      if (!refreshableProviders.has(provider as RefreshableProvider)) {
        return reply.code(400).send({ error: "INVALID_PROVIDER" });
      }
      if (options.refreshProvider === undefined) {
        return reply.code(503).send({ error: "PROVIDER_REFRESH_UNAVAILABLE" });
      }
      const refreshableProvider = provider as RefreshableProvider;
      const nowMs = Date.now();
      const retryAfterMs = Math.max(0, (lastProviderRefreshAtMs.get(refreshableProvider) ??
        Number.NEGATIVE_INFINITY) + PROVIDER_REFRESH_COOLDOWN_MS - nowMs);
      if (retryAfterMs > 0) {
        return reply.header("retry-after", String(Math.ceil(retryAfterMs / 1_000))).code(429)
          .send({ error: "PROVIDER_REFRESH_COOLDOWN", retryAfterMs });
      }
      lastProviderRefreshAtMs.set(refreshableProvider, nowMs);
      const requested = await options.refreshProvider(refreshableProvider);
      return reply.code(202).send({ provider, requested });
    });
  app.post<{ Body: { url?: unknown } }>("/api/maintenance/recover-im", async (request, reply) => {
    if (options.recoverIm === undefined) return reply.code(503).send({ error: "IM_RECOVERY_UNAVAILABLE" });
    const rawUrl = request.body?.url;
    let url: URL;
    try { url = new URL(typeof rawUrl === "string" ? rawUrl : ""); }
    catch { return reply.code(400).send({ error: "INVALID_IM_RECOVERY_URL" }); }
    const token = url.searchParams.get("token")?.trim() ?? "";
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "imsports.directsb.net" ||
      url.username !== "" || url.password !== "" || token.length < 8 || token.length > 512 || url.href.length > 2_048) {
      return reply.code(400).send({ error: "INVALID_IM_RECOVERY_URL" });
    }
    return reply.code(202).send({ provider: "IM", requested: options.recoverIm(url.href) });
  });
}
