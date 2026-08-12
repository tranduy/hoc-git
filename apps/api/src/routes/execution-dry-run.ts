import { ExecutionRequestSchema, TwoLegExecutionResultSchema, type ExecutionRequest,
  type TwoLegExecutionResult } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface ExecutionDryRunLike {
  execute(request: ExecutionRequest): Promise<TwoLegExecutionResult>;
}

export function registerExecutionDryRunRoute(app: FastifyInstance, executor: ExecutionDryRunLike): void {
  app.post("/api/execution/dry-run", async (request, reply) => {
    const parsed = ExecutionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: "NOT_EXECUTED", error: "INVALID_REQUEST" });
    try {
      return TwoLegExecutionResultSchema.parse(await executor.execute(parsed.data));
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("EXECUTION_")
        ? error.message : "EXECUTION_UNAVAILABLE";
      return reply.code(409).send({ status: "NOT_EXECUTED", error: code });
    }
  });
}
