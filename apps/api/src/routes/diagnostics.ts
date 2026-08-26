import type { FastifyInstance } from "fastify";
import type { PipelineDiagnostic } from "../diagnostics/pipeline-telemetry.js";

export interface PipelineDiagnosticsLike {
  list(): Promise<readonly PipelineDiagnostic[]>;
  get(accountId: string): Promise<PipelineDiagnostic | null>;
}

export function registerDiagnosticRoutes(app: FastifyInstance, diagnostics: PipelineDiagnosticsLike): void {
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
