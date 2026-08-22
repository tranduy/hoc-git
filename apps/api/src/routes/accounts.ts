import { AccountStatusSchema, type AccountStatus, type ProviderId } from "@tool-chenh/contracts";
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

export interface AccountRouteOptions {
  readonly cacheTtlMs?: number;
  readonly initialTimeoutMs?: number;
}

export function registerAccountRoutes(app: FastifyInstance, accounts: AccountRegistryLike,
  options: AccountRouteOptions = {}): void {
  let listInFlight: Promise<readonly AccountStatus[]> | null = null;
  let recent: { readonly accounts: readonly AccountStatus[]; readonly completedAtMs: number } | null = null;
  let listGeneration = 0;
  const refreshesInFlight = new Map<string, Promise<AccountStatus>>();
  const recentRefreshes = new Map<string, { readonly status: AccountStatus; readonly completedAtMs: number }>();
  const coalescingWindowMs = options.cacheTtlMs ?? 250;
  const initialTimeoutMs = options.initialTimeoutMs ?? 1_000;
  const refreshCoalescingWindowMs = 5_000;
  const refreshList = (): Promise<readonly AccountStatus[]> => {
    if (listInFlight !== null) return listInFlight;
    const operationGeneration = ++listGeneration;
    const operation = accounts.listStatuses().then((statuses) => {
      const parsed = AccountStatusSchema.array().parse(statuses);
      if (operationGeneration === listGeneration) {
        recent = { accounts: parsed, completedAtMs: performance.now() };
      }
      return parsed;
    }).finally(() => { if (listInFlight === operation) listInFlight = null; });
    listInFlight = operation;
    return operation;
  };
  const list = async (): Promise<readonly AccountStatus[]> => {
    if (recent !== null) {
      if (performance.now() - recent.completedAtMs >= coalescingWindowMs) void refreshList().catch(() => undefined);
      return recent.accounts;
    }
    const operation = refreshList();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("ACCOUNT_STATUS_TIMEOUT")), initialTimeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([operation, timeout]);
    } catch (error) {
      if (listInFlight === operation) {
        listGeneration += 1;
        listInFlight = null;
      }
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const invalidate = (): void => {
    recent = null;
    listGeneration += 1;
    listInFlight = null;
  };
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

  app.get("/api/accounts", async (_request, reply) => {
    try { return { accounts: await list() }; }
    catch { return reply.code(503).send({ error: "ACCOUNT_STATUS_UNAVAILABLE" }); }
  });
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
