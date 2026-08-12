import Fastify, { type FastifyInstance } from "fastify";
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
});
