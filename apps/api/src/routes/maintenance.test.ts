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
});
