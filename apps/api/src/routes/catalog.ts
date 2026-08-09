import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export interface CatalogReaderLike {
  read(accountId: string): Promise<ObservedProviderCatalog>;
}

const paramsSchema = z.strictObject({ accountId: z.string().trim().min(1).max(128) });

export function registerCatalogRoutes(app: FastifyInstance, reader: CatalogReaderLike): void {
  app.get("/api/catalog/accounts/:accountId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      return await reader.read(parsed.data.accountId);
    } catch {
      return reply.code(503).send({ error: "CATALOG_UNAVAILABLE" });
    }
  });
}
