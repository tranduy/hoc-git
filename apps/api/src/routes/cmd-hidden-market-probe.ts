import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CmdHiddenMarketProbeResult } from "../providers/cmd/cmd-hidden-market-probe.js";

const BodySchema = z.strictObject({
  providerEventId: z.string().trim().min(1).max(128).regex(/^[a-z0-9_.:-]+$/iu)
});

export interface CmdHiddenMarketProbeLike {
  probe(providerEventId: string): Promise<CmdHiddenMarketProbeResult | { readonly providerEventId: string;
    readonly status: CmdHiddenMarketProbeResult["status"] }>;
}

export function registerCmdHiddenMarketProbeRoute(app: FastifyInstance, probe: CmdHiddenMarketProbeLike): void {
  app.post("/api/catalog/cmd-hidden-probe", async (request, reply) => {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(request.hostname)) {
      return reply.code(403).send({ error: "LOCAL_ADMIN_ONLY" });
    }
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CMD_EVENT_ID" });
    try { return await probe.probe(parsed.data.providerEventId); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "CMD_HIDDEN_PROBE_FAILED";
      return reply.code(503).send({ error: reason });
    }
  });
}
