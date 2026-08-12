import { PreflightRequestSchema, PreflightTicketSchema, type PreflightRequest,
  type PreflightTicket } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface TwoLegPreflightLike {
  preflight(request: PreflightRequest): Promise<PreflightTicket>;
}

export function registerTwoLegPreflightRoutes(app: FastifyInstance, preflight: TwoLegPreflightLike): void {
  app.post("/api/preflight", async (request, reply) => {
    const parsed = PreflightRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: "NOT_READY", error: "INVALID_REQUEST" });
    try {
      const ticket = PreflightTicketSchema.parse(await preflight.preflight(parsed.data));
      return { status: "READY_BOTH", ticket };
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("PREFLIGHT_")
        ? error.message : "PREFLIGHT_UNAVAILABLE";
      if (code === "PREFLIGHT_ACCOUNT_NOT_FOUND") {
        return reply.code(404).send({ status: "NOT_READY", error: code });
      }
      return reply.code(409).send({ status: "NOT_READY", error: code });
    }
  });
}
