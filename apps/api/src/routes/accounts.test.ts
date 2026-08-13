import Fastify, { type FastifyInstance } from "fastify";
import type { AccountStatus } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAccountRoutes } from "./accounts.js";

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("account routes", () => {
  it("coalesces concurrent account-list reads from multiple UI tabs", async () => {
    let release: ((value: readonly []) => void) | undefined;
    const pending = new Promise<readonly []>((resolve) => { release = resolve; });
    const listStatuses = vi.fn(async () => pending);
    const app = Fastify();
    registerAccountRoutes(app, { listStatuses, register: vi.fn(), refresh: vi.fn() });
    apps.push(app);

    const reads = Array.from({ length: 8 }, () => app.inject({ method: "GET", url: "/api/accounts" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listStatuses).toHaveBeenCalledTimes(1);
    release?.([]);

    expect((await Promise.all(reads)).every((response) => response.statusCode === 200)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/accounts" })).statusCode).toBe(200);
    expect(listStatuses).toHaveBeenCalledTimes(1);
  });

  it("coalesces duplicate profile refreshes from multiple UI tabs", async () => {
    const status: AccountStatus = { id: "account-1", alias: "SABA", provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", profileState: "FRESH", redactedLabel: "••••0001", currency: "VND",
      balance: "100000", balanceAsOfMs: 1_000, capabilities: ["PROFILE", "CATALOG"], reason: null };
    let release: ((value: typeof status) => void) | undefined;
    const pending = new Promise<typeof status>((resolve) => { release = resolve; });
    const refresh = vi.fn(async () => pending);
    const app = Fastify();
    registerAccountRoutes(app, { listStatuses: vi.fn(async () => []), register: vi.fn(), refresh });
    apps.push(app);

    const requests = Array.from({ length: 6 }, () =>
      app.inject({ method: "POST", url: "/api/accounts/account-1/refresh" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledTimes(1);
    release?.(status);

    expect((await Promise.all(requests)).every((response) => response.statusCode === 200)).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/accounts/account-1/refresh" })).statusCode).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
