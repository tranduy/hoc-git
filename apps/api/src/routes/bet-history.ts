import type { FastifyInstance } from "fastify";
import type { BetHistoryList } from "../history/file-bet-history.js";

export interface BetHistoryLike { list(limit: number): Promise<BetHistoryList> }

export function registerBetHistoryRoute(app: FastifyInstance, history: BetHistoryLike): void {
  app.get("/api/bet-history", async (request) => {
    const raw = (request.query as { readonly limit?: unknown }).limit;
    const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
    const limit = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : 100;
    try { return await history.list(limit); }
    catch { return { storageState: "UNAVAILABLE" as const, records: [] }; }
  });
}
