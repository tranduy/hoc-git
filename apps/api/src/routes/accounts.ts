import type { AccountStatus, ProviderId } from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export interface AccountRegistryLike {
  listStatuses(): Promise<readonly AccountStatus[]>;
  register(input: { sessionId: string; alias: string; provider: ProviderId }): Promise<AccountStatus>;
  refresh(id: string): Promise<AccountStatus>;
}

const registerBody = z.strictObject({
  sessionId: z.string().trim().min(1).max(128),
  alias: z.string().trim().min(1).max(80),
  provider: z.enum(["CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"])
});
const accountParams = z.strictObject({ id: z.string().trim().min(1).max(128) });

export function registerAccountRoutes(app: FastifyInstance, accounts: AccountRegistryLike): void {
  let listInFlight: Promise<readonly AccountStatus[]> | null = null;
  let recent: { readonly accounts: readonly AccountStatus[]; readonly completedAtMs: number } | null = null;
  const refreshesInFlight = new Map<string, Promise<AccountStatus>>();
  const recentRefreshes = new Map<string, { readonly status: AccountStatus; readonly completedAtMs: number }>();
  const coalescingWindowMs = 250;
  const refreshCoalescingWindowMs = 5_000;
  const list = (): Promise<readonly AccountStatus[]> => {
    if (recent !== null && performance.now() - recent.completedAtMs < coalescingWindowMs) {
      return Promise.resolve(recent.accounts);
    }
    if (listInFlight !== null) return listInFlight;
    const operation = accounts.listStatuses().then((statuses) => {
      recent = { accounts: statuses, completedAtMs: performance.now() };
      return statuses;
    }).finally(() => { if (listInFlight === operation) listInFlight = null; });
    listInFlight = operation;
    return operation;
  };
  const invalidate = (): void => { recent = null; };
  const refresh = (id: string): Promise<AccountStatus> => {
    const cached = recentRefreshes.get(id);
    if (cached !== undefined && performance.now() - cached.completedAtMs < refreshCoalescingWindowMs) {
      return Promise.resolve(cached.status);
    }
    const inFlight = refreshesInFlight.get(id);
    if (inFlight !== undefined) return inFlight;
    const operation = accounts.refresh(id).then((status) => {
      recentRefreshes.set(id, { status, completedAtMs: performance.now() });
      invalidate();
      return status;
    }).finally(() => { if (refreshesInFlight.get(id) === operation) refreshesInFlight.delete(id); });
    refreshesInFlight.set(id, operation);
    return operation;
  };

  app.get("/api/accounts", async () => ({ accounts: await list() }));
  app.post("/api/accounts", async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      const result = await accounts.register(parsed.data);
      invalidate();
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACCOUNT_OPERATION_FAILED";
      return reply.code(code === "SESSION_NOT_FOUND" ? 404 : 400).send({ error: code });
    }
  });
  app.post("/api/accounts/:id/refresh", async (request, reply) => {
    const parsed = accountParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_REQUEST" });
    try {
      return await refresh(parsed.data.id);
    } catch (error) {
      const code = error instanceof Error ? error.message : "ACCOUNT_OPERATION_FAILED";
      return reply.code(code === "ACCOUNT_NOT_FOUND" ? 404 : 400).send({ error: code });
    }
  });
}
