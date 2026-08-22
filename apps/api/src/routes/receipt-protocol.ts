import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ReceiptProtocolResultSchema,
  type ReceiptProtocolResult
} from "../receipts/receipt-protocol-registry.js";

const RequestSchema = z.strictObject({ accountId: z.string().trim().min(1).max(128) });

export interface ReceiptProtocolLike {
  inspect(input: { readonly accountId: string }): Promise<ReceiptProtocolResult>;
}

export function registerReceiptProtocolRoute(app: FastifyInstance, service: ReceiptProtocolLike): void {
  app.post("/api/receipts/protocol/inspect", async (request, reply) => {
    const parsed = RequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      return ReceiptProtocolResultSchema.parse(await service.inspect(parsed.data));
    } catch (error) {
      const code = error instanceof Error ? error.message : "RECEIPT_PROTOCOL_UNAVAILABLE";
      if (code === "RECEIPT_PROTOCOL_ACCOUNT_NOT_FOUND") return reply.code(404).send({ error: code });
      if (code === "RECEIPT_PROTOCOL_ACCOUNT_UNAVAILABLE") return reply.code(409).send({ error: code });
      if (code === "RECEIPT_PROTOCOL_PROVIDER_UNSUPPORTED") return reply.code(422).send({ error: code });
      if (["SBOBET_HISTORY_CONTROL_UNAVAILABLE", "SBOBET_BROWSER_UNAVAILABLE"].includes(code)) {
        return reply.code(503).send({ error: code });
      }
      return reply.code(503).send({ error: "RECEIPT_PROTOCOL_UNAVAILABLE" });
    }
  });
}
