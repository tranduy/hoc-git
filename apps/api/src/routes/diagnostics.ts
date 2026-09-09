import type { FastifyInstance } from "fastify";
import { getHeapStatistics } from "node:v8";
import type { PipelineDiagnostic } from "../diagnostics/pipeline-telemetry.js";

export interface PipelineDiagnosticsLike {
  list(): Promise<readonly PipelineDiagnostic[]>;
  get(accountId: string): Promise<PipelineDiagnostic | null>;
}

export function registerDiagnosticRoutes(app: FastifyInstance, diagnostics: PipelineDiagnosticsLike): void {
  app.get("/api/diag/runtime", async () => {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    return { pid: process.pid, uptimeMs: Math.floor(process.uptime() * 1_000),
      rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal,
      heapLimitBytes: getHeapStatistics().heap_size_limit,
      cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system };
  });
  app.get("/api/diag/pipeline", async (_request, reply) => {
    try {
      return { accounts: await diagnostics.list() };
    } catch {
      return reply.code(503).send({ error: "PIPELINE_DIAGNOSTICS_UNAVAILABLE" });
    }
  });
  app.get<{ Params: { accountId: string } }>("/api/diag/pipeline/:accountId", async (request, reply) => {
    try {
      const result = await diagnostics.get(request.params.accountId);
      return result === null ? reply.code(404).send({ error: "PIPELINE_ACCOUNT_NOT_FOUND" }) : result;
    } catch {
      return reply.code(503).send({ error: "PIPELINE_DIAGNOSTICS_UNAVAILABLE" });
    }
  });
}
