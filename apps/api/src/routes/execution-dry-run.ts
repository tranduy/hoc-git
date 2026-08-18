import { ExecutionRequestSchema, TwoLegExecutionResultSchema, type ExecutionRequest,
  type TwoLegExecutionResult } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface ExecutionDryRunLike {
  execute(request: ExecutionRequest): Promise<TwoLegExecutionResult>;
}

export interface ExecutionHistoryLike {
  recordExecution(ticket: ExecutionRequest["ticket"], result: TwoLegExecutionResult): Promise<void>;
}

function recordBestEffort(history: ExecutionHistoryLike | undefined, request: ExecutionRequest,
  result: TwoLegExecutionResult): void {
  if (history === undefined) return;
  try { void Promise.resolve(history.recordExecution(request.ticket, result)).catch(() => undefined); }
  catch { /* history must never affect execution */ }
}

export function registerExecutionDryRunRoute(app: FastifyInstance, executor: ExecutionDryRunLike,
  history?: ExecutionHistoryLike): void {
  app.post("/api/execution/dry-run", async (request, reply) => {
    const parsed = ExecutionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: "NOT_EXECUTED", error: "INVALID_REQUEST" });
    try {
      const result = TwoLegExecutionResultSchema.parse(await executor.execute(parsed.data));
      recordBestEffort(history, parsed.data, result);
      return result;
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("EXECUTION_")
        ? error.message : "EXECUTION_UNAVAILABLE";
      return reply.code(409).send({ status: "NOT_EXECUTED", error: code });
    }
  });
}
