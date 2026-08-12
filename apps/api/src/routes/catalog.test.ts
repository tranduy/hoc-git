import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("provider catalog route", () => {
  it("coalesces concurrent reads for the same account so multiple UI tabs cannot stampede a provider", async () => {
    let release: ((catalog: ObservedProviderCatalog) => void) | undefined;
    const pending = new Promise<ObservedProviderCatalog>((resolve) => { release = resolve; });
    let reads = 0;
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: { read: async () => { reads += 1; return pending; } }
    });
    apps.push(app);

    const first = app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    const second = app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(1);

    release?.({
      dataMode: "LIVE", accountId: "account-1", provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    });
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    expect(reads).toBe(1);
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
