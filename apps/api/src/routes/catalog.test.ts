import { withinComparisonHorizon } from "./catalog.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { createFixtureRuntime } from "../server.js";
import { CatalogTelemetryRegistry } from "./catalog-telemetry.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { CatalogStoreLike } from "../catalog/durable-catalog-store.js";
import { CatalogRevisionStore } from "../catalog/catalog-revision-store.js";
import type { CatalogReaderLike } from "./catalog.js";

const apps: FastifyInstance[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

describe("provider catalog route", () => {
  it("publishes a catalog with the source-specific freshness window", async () => {
    const revisions = new CatalogRevisionStore({ now: () => 100 });
    const reader = {
      responseCacheMaxAgeMs: 5,
      snapshotFreshnessMaxAgeMs: 20,
      snapshotFreshnessMaxAgeMsFor: () => 75,
      read: async (accountId: string): Promise<ObservedProviderCatalog> => ({
        dataMode: "LIVE", accountId, provider: "SABA", category: "FOOTBALL",
        comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100,
        rejectedMarketCount: 0, events: [], markets: [], quotes: []
      })
    } as CatalogReaderLike & { snapshotFreshnessMaxAgeMsFor(accountId: string): number };
    const app = buildApp(createFixtureRuntime(1_000), { catalogReader: reader, catalogRevisions: revisions });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/catalog-source:SABA:FOOTBALL" }))
      .json()).toMatchObject({ snapshotState: "FRESH" });
    expect(revisions.get("catalog-source:SABA:FOOTBALL")?.freshUntilMs).toBe(175);
  });

  it("restores the last verified catalog as stale and refreshes it without another request", async () => {
    const persisted: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "old-account", provider: "IM", category: "LOL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100, rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    };
    let reads = 0;
    let saved: ObservedProviderCatalog | null = null;
    const store: CatalogStoreLike = {
      load: async () => persisted,
      save: async (_sourceKey, catalog) => { saved = catalog; }
    };
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogStore: store,
      catalogReader: {
        responseCacheMaxAgeMs: 15,
        snapshotFreshnessMaxAgeMs: 100,
        sourceKey: async () => "IM|LOL|session",
        read: async (accountId) => {
          reads += 1;
          return { ...persisted, accountId, observedAtMs: 200 + reads };
        }
      }
    });
    apps.push(app);

    const restored = await app.inject({ method: "GET", url: "/api/catalog/accounts/current-account" });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ accountId: "current-account", snapshotState: "STALE", observedAtMs: 100 });

    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2), { timeout: 250 });
    expect(saved).toMatchObject({ accountId: "current-account" });
    const refreshed = await app.inject({ method: "GET", url: "/api/catalog/accounts/current-account" });
    expect(refreshed.json()).toMatchObject({ snapshotState: "FRESH" });
  });

  it("stops its background collector when Fastify closes", async () => {
    let reads = 0;
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        responseCacheMaxAgeMs: 10,
        read: async (accountId) => {
          reads += 1;
          return {
            dataMode: "LIVE", accountId, provider: "IM", category: "LOL",
            comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: reads,
            rejectedMarketCount: 0, events: [], markets: [], quotes: []
          };
        }
      }
    });
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(2), { timeout: 250 });
    await app.close();
    const stoppedAt = reads;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(reads).toBe(stoppedAt);
  });

  it("stops refreshing a source after its UI demand lease expires", async () => {
    let reads = 0;
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        responseCacheMaxAgeMs: 10,
        collectorLeaseMs: 25,
        read: async (accountId) => {
          reads += 1;
          return { dataMode: "LIVE", accountId, provider: "IM", category: "LOL",
            comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: reads,
            rejectedMarketCount: 0, events: [], markets: [], quotes: [] };
        }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const stoppedAt = reads;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toBe(stoppedAt);
    expect(reads).toBeLessThanOrEqual(3);
  });
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

  it("serves the last completed catalog without restarting a browser read inside the configured refresh interval", async () => {
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
        responseCacheMaxAgeMs: 1_000,
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

  it("serves the last verified catalog immediately while an expired source refreshes in background", async () => {
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

    expect(expired.statusCode).toBe(200);
    expect(expired.json()).toMatchObject({
      accountId: "account-1", provider: "BTI", observedAtMs: 100, snapshotState: "STALE"
    });
    expect(reads).toBe(2);
  });

  it("keeps a recently verified snapshot fresh while its faster refresh cadence runs in background", async () => {
    let reads = 0;
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "account-1", provider: "IM", category: "LOL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Date.now(), rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    };
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        requestTimeoutMs: 10, responseCacheMaxAgeMs: 20, snapshotFreshnessMaxAgeMs: 100,
        read: async () => { reads += 1; return reads === 1 ? catalog : new Promise<ObservedProviderCatalog>(() => undefined); }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const refreshing = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });

    expect(refreshing.statusCode).toBe(200);
    expect(refreshing.json()).toMatchObject({ provider: "IM", category: "LOL", snapshotState: "FRESH" });
    expect(reads).toBe(2);
  });

  it("does not downgrade a recent verified snapshot after one transient background failure", async () => {
    let reads = 0;
    const catalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "account-1", provider: "SABA", category: "LOL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Date.now(), rejectedMarketCount: 0,
      events: [], markets: [], quotes: []
    };
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        responseCacheMaxAgeMs: 10, snapshotFreshnessMaxAgeMs: 100,
        failureRetryBaseMs: 50, failureRetryMaxMs: 50,
        read: async () => {
          reads += 1;
          if (reads > 1) throw new Error("temporary provider frame gap");
          return catalog;
        }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).json())
      .toMatchObject({ snapshotState: "FRESH" });
    await vi.waitFor(() => expect(reads).toBe(2), { timeout: 200 });
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).json())
      .toMatchObject({ snapshotState: "FRESH" });
  });

  it("keeps sampling a rejected coverage regression without overwriting the complete catalog", async () => {
    let reads = 0;
    const catalog = (count: number): ObservedProviderCatalog => ({
      dataMode: "LIVE", accountId: "account-1", provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: reads, rejectedMarketCount: 0,
      events: Array.from({ length: count }, (_, index) => ({ providerEventId: `event-${index}` })),
      markets: [], quotes: []
    } as unknown as ObservedProviderCatalog);
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        responseCacheMaxAgeMs: 10, snapshotFreshnessMaxAgeMs: 1_000,
        failureRetryBaseMs: 1_000, failureRetryMaxMs: 1_000,
        read: async () => {
          reads += 1;
          return catalog(reads === 1 ? 100 : 20);
        }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).json().events)
      .toHaveLength(100);
    await vi.waitFor(() => expect(reads).toBeGreaterThanOrEqual(4), { timeout: 250 });
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" })).json().events)
      .toHaveLength(100);
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

  it("does not start another provider read while a timed-out browser operation is still running", async () => {
    let reads = 0;
    let cancellations = 0;
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: {
        requestTimeoutMs: 5,
        collectionTimeoutMs: 15,
        failureRetryBaseMs: 5,
        failureRetryMaxMs: 5,
        cancel: async () => { cancellations += 1; },
        read: async () => {
          reads += 1;
          return new Promise<ObservedProviderCatalog>(() => undefined);
        }
      }
    });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/hung" })).statusCode).toBe(503);
    await vi.waitFor(() => expect(cancellations).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await app.inject({ method: "GET", url: "/api/catalog/accounts/hung" })).statusCode).toBe(503);
    expect(reads).toBe(1);
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
    await expect.poll(() => published.length).toBe(1);
    expect(published[0]).toMatchObject({ accountId: "account-1", provider: "CMD" });
  });

  it("returns 304 for an unchanged catalog so fast UI polling does not serialize the full book", async () => {
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogReader: { read: async (accountId) => ({
        dataMode: "LIVE" as const, accountId, provider: "SABA" as const, category: "FOOTBALL" as const,
        comparisonState: "AWAITING_SECOND_PROVIDER" as const, observedAtMs: 123,
        rejectedMarketCount: 0, events: [], markets: [], quotes: []
      }) }
    });
    apps.push(app);
    const first = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    const etag = first.headers.etag;
    expect(etag).toBeTypeOf("string");

    const unchanged = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1",
      headers: { "if-none-match": etag! } });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.body).toBe("");
  });

  it("serves a newer published revision inside the reader coalescing window", async () => {
    const revisions = new CatalogRevisionStore({ now: () => 200 });
    const oldCatalog: ObservedProviderCatalog = {
      dataMode: "LIVE", accountId: "account-1", provider: "SABA", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100,
      rejectedMarketCount: 0, events: [], markets: [], quotes: []
    };
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogRevisions: revisions,
      catalogReader: { responseCacheMaxAgeMs: 5_000, read: async () => oldCatalog }
    });
    apps.push(app);
    const first = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });
    const oldEtag = first.headers.etag;

    const latest = revisions.publish("account-1", { ...oldCatalog, observedAtMs: 200, rejectedMarketCount: 1 }, {
      snapshotState: "FRESH", freshnessMs: 20_000
    });
    const refreshed = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1",
      headers: { "if-none-match": oldEtag! } });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toMatchObject({ accountId: "account-1", observedAtMs: 200, rejectedMarketCount: 1 });
    expect(refreshed.headers["x-catalog-revision"]).toBe(latest.revision);
    expect(refreshed.headers.etag).toBe(`"${latest.revision}"`);
  });

  it("returns a verified catalog even when downstream runtime publication fails", async () => {
    const app = buildApp(createFixtureRuntime(1_000), {
      catalogObserver: { publish: () => { throw new Error("RUNTIME_BUSY"); } },
      catalogReader: { read: async (accountId) => ({
        dataMode: "LIVE" as const, accountId, provider: "SBOBET" as const, category: "FOOTBALL" as const,
        comparisonState: "AWAITING_SECOND_PROVIDER" as const, observedAtMs: 100, rejectedMarketCount: 0,
        events: [], markets: [], quotes: []
      }) }
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/catalog/accounts/account-1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ accountId: "account-1", provider: "SBOBET" });
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

describe("withinComparisonHorizon", () => {
  const catalog = (events: ReadonlyArray<{ id: string; startAtUtcMs?: number; isLive?: boolean }>) => ({
    dataMode: "LIVE" as const, accountId: "account-1", provider: "IM" as const,
    category: "FOOTBALL" as const, comparisonState: "AWAITING_SECOND_PROVIDER" as const,
    observedAtMs: 1_000_000_000, rejectedMarketCount: 0,
    events: events.map((event) => ({ providerEventId: event.id,
      startAtUtcMs: event.startAtUtcMs, isLive: event.isLive ?? false })),
    markets: events.map((event) => ({ providerEventId: event.id, providerMarketId: `${event.id}-m` })),
    quotes: events.map((event) => ({ providerEventId: event.id, providerMarketId: `${event.id}-m` }))
  } as unknown as ObservedProviderCatalog);

  it("keeps every future fixture and its prices without a comparison horizon", () => {
    const day = 86_400_000;
    const kept = withinComparisonHorizon(catalog([
      { id: "soon", startAtUtcMs: 1_000_000_000 + 3_600_000 },
      { id: "edge", startAtUtcMs: 1_000_000_000 + day },
      { id: "far", startAtUtcMs: 1_000_000_000 + 30 * day }
    ]));

    expect(kept.events.map((event) => event.providerEventId)).toEqual(["soon", "edge", "far"]);
    expect(kept.markets.map((market) => market.providerEventId)).toEqual(["soon", "edge", "far"]);
    expect(kept.quotes.map((quote) => quote.providerEventId)).toEqual(["soon", "edge", "far"]);
  });

  it("keeps a running fixture and one whose start time is unknown", () => {
    // Neither can be said to be beyond the horizon.
    const kept = withinComparisonHorizon(catalog([
      { id: "live", startAtUtcMs: 1_000_000_000 + 10 * 86_400_000, isLive: true },
      { id: "undated" }
    ]));

    expect(kept.events.map((event) => event.providerEventId)).toEqual(["live", "undated"]);
  });

  it("returns the same catalog instance when no filtering is needed", () => {
    const source = catalog([{ id: "soon", startAtUtcMs: 1_000_000_000 }]);

    expect(withinComparisonHorizon(source)).toBe(source);
  });
});
