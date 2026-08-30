import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import { registerCatalogSourceRoutes } from "./catalog-sources.js";

describe("catalog source routes", () => {
  it("drops a permanently hung refresh so a later status read can recover", async () => {
    const app = Fastify();
    const active: CatalogSourceStatus = {
      id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 200, reason: null
    };
    let calls = 0;
    const listStatuses = async (): Promise<readonly CatalogSourceStatus[]> => {
      calls += 1;
      return calls === 1 ? new Promise(() => undefined) : [active];
    };
    registerCatalogSourceRoutes(app, { listStatuses }, { initialTimeoutMs: 5, refreshTimeoutMs: 10 });

    expect((await app.inject({ method: "GET", url: "/api/catalog/sources" })).statusCode).toBe(503);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const recovered = await app.inject({ method: "GET", url: "/api/catalog/sources" });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toEqual({ sources: [active] });
    expect(calls).toBe(2);
    await app.close();
  });

  it("waits for the real answer instead of serving rows past the stale bound", async () => {
    // These rows carry each provider's acquiredAtMs, which the UI reads as
    // "how old is this book". A cached row that keeps ageing while a refresh
    // is slow reports a healthy provider as Lagging, so past maxStaleMs the
    // caller waits for the current answer rather than being told a stale one.
    const app = Fastify();
    const row = (acquiredAtMs: number): CatalogSourceStatus => ({
      id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs, reason: null
    });
    let calls = 0;
    registerCatalogSourceRoutes(app, {
      listStatuses: async () => { calls += 1; return [row(calls * 100)]; }
    }, { cacheTtlMs: 0, maxStaleMs: 0, initialTimeoutMs: 50, refreshTimeoutMs: 50 });

    expect((await app.inject({ method: "GET", url: "/api/catalog/sources" })).json())
      .toEqual({ sources: [row(100)] });
    expect((await app.inject({ method: "GET", url: "/api/catalog/sources" })).json())
      .toEqual({ sources: [row(200)] });
    expect(calls).toBe(2);
    await app.close();
  });

  it("serves the last verified source list immediately while a slow refresh runs", async () => {
    const app = Fastify();
    let calls = 0;
    let releaseRefresh!: (value: readonly CatalogSourceStatus[]) => void;
    const active: CatalogSourceStatus = {
      id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 200, reason: null
    };
    registerCatalogSourceRoutes(app, {
      listStatuses: async () => {
        calls += 1;
        if (calls === 1) return [active];
        return new Promise((resolve) => { releaseRefresh = resolve; });
      }
    }, { cacheTtlMs: 0, initialTimeoutMs: 20 });

    expect((await app.inject({ method: "GET", url: "/api/catalog/sources" })).statusCode).toBe(200);
    const startedAt = performance.now();
    const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
    expect(performance.now() - startedAt).toBeLessThan(20);
    expect(response.json()).toEqual({ sources: [active] });
    expect(calls).toBe(2);
    releaseRefresh!([active]);
    await app.close();
  });

  it("bounds the cold-start wait without cancelling the shared refresh", async () => {
    const app = Fastify();
    let release!: (value: readonly CatalogSourceStatus[]) => void;
    const active: CatalogSourceStatus = {
      id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 200, reason: null
    };
    registerCatalogSourceRoutes(app, {
      listStatuses: async () => new Promise((resolve) => { release = resolve; })
    }, { initialTimeoutMs: 5 });

    const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
    expect(response.statusCode).toBe(503);
    release!([active]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await app.inject({ method: "GET", url: "/api/catalog/sources" })).json()).toEqual({ sources: [active] });
    await app.close();
  });

  it("returns only strict redacted logical source statuses", async () => {
    const app = Fastify();
    registerCatalogSourceRoutes(app, { listStatuses: async () => [{
      id: "catalog-source:SABA:FOOTBALL",
      alias: "C-Sports · SABA",
      provider: "SABA",
      category: "FOOTBALL",
      sessionState: "ACTIVE",
      sessionSource: "FABET_LOGIN",
      acquiredAtMs: 200,
      reason: null
    }] });

    const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sources: [expect.objectContaining({
      id: "catalog-source:SABA:FOOTBALL", provider: "SABA", category: "FOOTBALL"
    })] });
    expect(JSON.stringify(response.json())).not.toMatch(/token|cookie|launchUrl|trustedHostname|sessionId/iu);
    await app.close();
  });

  it("fails closed on malformed output or resolver failure", async () => {
    for (const listStatuses of [
      async () => [{ id: "catalog-source:SABA:FOOTBALL", token: "secret" }] as unknown as CatalogSourceStatus[],
      async () => { throw new Error("secret-bearing-internal-error"); }
    ]) {
      const app = Fastify();
      registerCatalogSourceRoutes(app, { listStatuses });
      const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "CATALOG_SOURCES_UNAVAILABLE" });
      expect(response.body).not.toContain("secret");
      await app.close();
    }
  });
});
