import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { SessionRefreshControl } from "../session-maintenance.js";
import { registerMaintenanceRoutes } from "./maintenance.js";

describe("maintenance routes", () => {
  it("starts a reader/session refresh without stopping the HTTP server", async () => {
    let release: (() => void) | undefined;
    const refresh = vi.fn(async () => new Promise<void>((resolve) => { release = resolve; }));
    const app = Fastify();
    registerMaintenanceRoutes(app, new SessionRefreshControl({ refresh }));

    const started = await app.inject({ method: "POST", url: "/api/maintenance/refresh-all" });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ running: true, scheduledHour: 3 });
    expect(refresh).toHaveBeenCalledOnce();
    expect((await app.inject({ method: "GET", url: "/api/maintenance" })).statusCode).toBe(200);

    release?.();
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: "/api/maintenance" })).json())
      .toMatchObject({ running: false, lastResult: "SUCCESS" }));
    await app.close();
  });

  it("refreshes one explicitly selected provider without starting full maintenance", async () => {
    const refreshProvider = vi.fn(async () => 1);
    const refreshAll = vi.fn(async () => undefined);
    const app = Fastify();
    registerMaintenanceRoutes(app, new SessionRefreshControl({ refresh: refreshAll }), { refreshProvider });

    const response = await app.inject({ method: "POST", url: "/api/maintenance/refresh-provider/SBOBET" });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ provider: "SBOBET", requested: 1 });
    expect(refreshProvider).toHaveBeenCalledWith("SBOBET");
    expect(refreshAll).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an unknown targeted provider", async () => {
    const app = Fastify();
    registerMaintenanceRoutes(app, new SessionRefreshControl({ refresh: async () => undefined }), {
      refreshProvider: async () => 1
    });

    const response = await app.inject({ method: "POST", url: "/api/maintenance/refresh-provider/UNKNOWN" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_PROVIDER" });
    await app.close();
  });
});
