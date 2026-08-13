import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("provider catalog route", () => {
  it("coalesces duplicate account aliases by verified source and rebinds the response account", async () => {
    let release: ((catalog: ObservedProviderCatalog) => void) | undefined;
    const pending = new Promise<ObservedProviderCatalog>((resolve) => { release = resolve; });
    let reads = 0;
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        sourceKey: async () => "SABA|FOOTBALL|session-1",
        read: async () => { reads += 1; return pending; }
      }
    });
    apps.push(app);

    const first = app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    const second = app.inject({ method: "GET", url: "/api/catalog/accounts/account-2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(1);

    release?.({
      dataMode: "LIVE", accountId: "account-1", provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    });
    expect((await first).json()).toMatchObject({ accountId: "account-1" });
    expect((await second).json()).toMatchObject({ accountId: "account-2" });
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    expect(reads).toBe(1);
  });

  it("times out callers without duplicating the shared read and caches its later completion", async () => {
    let reads = 0;
    let release: ((catalog: ObservedProviderCatalog) => void) | undefined;
    const pending = new Promise<ObservedProviderCatalog>((resolve) => { release = resolve; });
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        requestTimeoutMs: 10,
        sourceKey: async () => "SBOBET|FOOTBALL|session-1",
        read: async () => { reads += 1; return pending; }
      }
    });
    apps.push(app);

    const timedOut = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    expect(timedOut.statusCode).toBe(503);
    expect(timedOut.json()).toEqual({ error: "CATALOG_TIMEOUT" });
    const second = app.inject({ method: "GET", url: "/api/catalog/accounts/account-2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(1);

    release?.({
      dataMode: "LIVE", accountId: "account-1", provider: "SBOBET", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    });
    expect((await second).json()).toMatchObject({ accountId: "account-2" });
    const cached = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-3" });
    expect(cached.statusCode).toBe(200);
    expect(cached.json()).toMatchObject({ accountId: "account-3" });
    expect(reads).toBe(1);
  });

  it("serves the last completed catalog without restarting a browser read more than once per second", async () => {
    let reads = 0;
    let releaseFirst: ((catalog: ObservedProviderCatalog) => void) | undefined;
    const firstRead = new Promise<ObservedProviderCatalog>((resolve) => { releaseFirst = resolve; });
    const neverCompletes = new Promise<ObservedProviderCatalog>(() => undefined);
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "account-1", provider: "SBOBET", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    };
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        requestTimeoutMs: 10,
        sourceKey: async () => "SBOBET|FOOTBALL|session-1",
        read: async () => { reads += 1; return reads === 1 ? firstRead : neverCompletes; }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(503);
    releaseFirst?.(catalog);
    await firstRead;
    await new Promise((resolve) => setTimeout(resolve, 300));

    const cached = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-2" });
    expect(cached.statusCode).toBe(200);
    expect(cached.json()).toMatchObject({ accountId: "account-2", provider: "SBOBET" });
    expect(reads).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 750));
    const refreshing = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-3" });
    expect(refreshing.statusCode).toBe(200);
    expect(refreshing.json()).toMatchObject({ accountId: "account-3", provider: "SBOBET" });
    expect(reads).toBe(2);
  });

  it("stops serving a completed catalog after its bounded display lifetime", async () => {
    let reads = 0;
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "account-1", provider: "BTI", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    };
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        requestTimeoutMs: 10,
        responseCacheMaxAgeMs: 20,
        read: async () => { reads += 1; return reads === 1 ? catalog : new Promise<ObservedProviderCatalog>(() => undefined); }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const expired = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });

    expect(expired.statusCode).toBe(503);
    expect(expired.json()).toEqual({ error: "CATALOG_TIMEOUT" });
    expect(reads).toBe(2);
  });

  it("keeps health and another source responsive while one source reader is hung", async () => {
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        requestTimeoutMs: 10,
        sourceKey: async (accountId) => accountId === "hung" ? "SABA|FOOTBALL|session-hung" : "IM|LOL|session-fast",
        read: async (accountId) => accountId === "hung" ? new Promise<ObservedProviderCatalog>(() => undefined) : ({
          dataMode: "LIVE", accountId, provider: "IM", category: "LOL",
          comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
          events: [], markets: [], quotes: []
        })
      }
    });
    apps.push(app);

    const hung = app.inject({ method: "GET", url: "/api/catalog/accounts/hung" });
    const [health, fast, timeout] = await Promise.all([
      app.inject({ method: "GET", url: "/api/health" }),
      app.inject({ method: "GET", url: "/api/catalog/accounts/fast" }),
      hung
    ]);
    expect(health.statusCode).toBe(200);
    expect(fast.statusCode).toBe(200);
    expect(timeout.json()).toEqual({ error: "CATALOG_TIMEOUT" });
  });

  it("backs off only the failing source without blocking healthy source reads", async () => {
    const reads = new Map<string, number>();
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        failureRetryBaseMs: 20,
        failureRetryMaxMs: 40,
        sourceKey: async (accountId) => accountId,
        read: async (accountId) => {
          reads.set(accountId, (reads.get(accountId) ?? 0) + 1);
          if (accountId === "failing") throw new Error("provider launch failed");
          return {
            dataMode: "LIVE", accountId, provider: "IM", category: "LOL",
            comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
            events: [], markets: [], quotes: []
          };
        }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/failing" })).statusCode).toBe(503);
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/failing" })).statusCode).toBe(503);
    expect(reads.get("failing")).toBe(1);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/healthy" })).statusCode).toBe(200);
    expect(reads.get("healthy")).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/failing" })).statusCode).toBe(503);
    expect(reads.get("failing")).toBe(2);
  });

  it("records safe per-provider timing, count, and source-age telemetry", async () => {
    let wallNowMs = 1_000;
    let monotonicNowMs = 50;
    const telemetry = new CatalogTelemetryRegistry({
      wallNowMs: () => wallNowMs,
      monotonicNowMs: () => monotonicNowMs
    });
    const catalog = {
      dataMode: "LIVE", accountId: "account-1", provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 900, rejectedMarketCount: 4,
      events: [{ providerEventId: "event" }], markets: [{ providerMarketId: "market" }],
      quotes: [{ sourceTimestampMs: 800 }, { sourceTimestampMs: null }]
    } as unknown as ObservedProviderCatalog;
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogTelemetry: telemetry,
      catalogReader: { read: async () => {
        wallNowMs = 1_025;
        monotonicNowMs = 75;
        return catalog;
      } }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    const response = await app.inject({ method: "GET", url: "/api/catalog/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      dataMode: "LIVE",
      generatedAtMs: 1_025,
      metrics: [{
        accountId: "account-1", provider: "SABA", category: "FOOTBALL", state: "SUCCESS",
        requestStartedAtMs: 1_000, completedAtMs: 1_025, durationMs: 25,
        observedAtMs: 900, newestSourceTimestampMs: 800, sourceAgeMs: 225,
        eventCount: 1, marketCount: 1, quoteCount: 2, rejectedMarketCount: 4,
        totalReads: 1, successCount: 1, failureCount: 0, schemaErrorCount: 0,
        latestSequence: null, sequenceGapCount: 0, recoveryCount: 0, priceChangeCount: 0,
        statusChangeCount: 0, consecutiveFailures: 0, journalErrorCount: 0
      }]
    });
    expect(response.body).not.toContain("sourceTimestampMs");
  });

  it("serves a no-store live account catalog without query-string secrets", async () => {
    const published: ObservedProviderCatalog[] = [];
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogObserver: { publish: (catalog) => published.push(catalog) },
      catalogReader: { read: async (accountId) => ({
        dataMode: "LIVE" as const,
        accountId,
        provider: "CMD" as const,
        category: "FOOTBALL" as const,
        comparisonState: "AWAITING_SECOND_PROVIDER" as const,
        observedAtMs: 100,
        rejectedMarketCount: 0,
        events: [], markets: [], quotes: []
      }) }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ accountId: "account-1", dataMode: "LIVE" });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ accountId: "account-1", provider: "CMD" });
  });

  it("maps private provider failures to a fixed safe diagnostic", async () => {
    const telemetry = new CatalogTelemetryRegistry();
    const published: ObservedProviderCatalog[] = [];
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogTelemetry: telemetry,
      catalogObserver: { publish: (catalog) => published.push(catalog) },
      catalogReader: { read: async () => { throw new Error("private-token-canary"); } }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('{"error":"CATALOG_UNAVAILABLE"}');
    expect(response.body).not.toContain("private-token-canary");
    expect(published).toEqual([]);
    const metrics = (await app.inject({ method: "GET", url: "/api/catalog/metrics" })).json();
    expect(metrics.metrics).toEqual([expect.objectContaining({
      accountId: "account-1", provider: null, state: "UNAVAILABLE",
      totalReads: 1, successCount: 0, failureCount: 1, schemaErrorCount: 0
    })]);
    expect(JSON.stringify(metrics)).not.toContain("private-token-canary");
  });

  it("distinguishes normalized schema drift without returning provider payloads", async () => {
    const telemetry = new CatalogTelemetryRegistry();
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogTelemetry: telemetry,
      catalogReader: { read: async () => { throw new Error("SBOBET_CATALOG_SCHEMA_ERROR"); } }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "CATALOG_SCHEMA_ERROR" });
    const metrics = (await app.inject({ method: "GET", url: "/api/catalog/metrics" })).json();
    expect(metrics.metrics).toEqual([expect.objectContaining({
      accountId: "account-1", state: "SCHEMA_ERROR", schemaErrorCount: 1, failureCount: 1
    })]);
  });
});
