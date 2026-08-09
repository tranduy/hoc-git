import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("provider catalog route", () => {
  it("serves a no-store live account catalog without query-string secrets", async () => {
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: { read: async (accountId) => ({
        dataMode: "LIVE" as const,
        accountId,
        provider: "CMD" as const,
        category: "FOOTBALL" as const,
        comparisonState: "AWAITING_SECOND_PROVIDER" as const,
        observedAtMs: 100,
        events: [], markets: [], quotes: []
      }) }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ accountId: "account-1", dataMode: "LIVE" });
  });

  it("maps private provider failures to a fixed safe diagnostic", async () => {
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: { read: async () => { throw new Error("private-token-canary"); } }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('{"error":"CATALOG_UNAVAILABLE"}');
    expect(response.body).not.toContain("private-token-canary");
  });
});
