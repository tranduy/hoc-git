import type { FastifyInstance } from "fastify";
import type { SessionRefreshControl } from "../session-maintenance.js";

export function registerMaintenanceRoutes(app: FastifyInstance, maintenance: SessionRefreshControl): void {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/maintenance")) return;
    const ip = request.ip.replace(/^::ffff:/u, "");
    if (ip !== "127.0.0.1" && ip !== "::1") await reply.code(403).send({ error: "LOCAL_ACCESS_ONLY" });
  });
  app.get("/api/maintenance", async () => maintenance.status());
  app.get("/api/maintenance/logs", async () => ({ logs: maintenance.logs() }));
  app.post("/api/maintenance/refresh-all", async (_request, reply) =>
    reply.code(202).send(maintenance.start("MANUAL")));
}
