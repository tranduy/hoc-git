import { ProviderTicketPreflightRequestSchema, ProviderTicketPreflightSchema,
  type ProviderTicketPreflight, type ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";

export interface ProviderPreflightLike {
  preflight(request: ProviderTicketPreflightRequest): Promise<ProviderTicketPreflight>;
}

export function registerProviderPreflightRoutes(app: FastifyInstance, preflight: ProviderPreflightLike): void {
  app.post("/api/preflight/provider", async (request, reply) => {
    const parsed = ProviderTicketPreflightRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      return ProviderTicketPreflightSchema.parse(await preflight.preflight(parsed.data));
    } catch (error) {
      const code = error instanceof Error ? error.message : "PREFLIGHT_UNAVAILABLE";
      if (code === "PREFLIGHT_ACCOUNT_NOT_FOUND") return reply.code(404).send({ error: code });
      if (code === "PREFLIGHT_ACCOUNT_UNAVAILABLE") return reply.code(409).send({ error: code });
      if (code === "PREFLIGHT_IDENTITY_MISMATCH") return reply.code(422).send({ error: code });
      return reply.code(503).send({ error: code === "PREFLIGHT_PROVIDER_UNSUPPORTED" ? code : "PREFLIGHT_UNAVAILABLE" });
    }
  });
}
