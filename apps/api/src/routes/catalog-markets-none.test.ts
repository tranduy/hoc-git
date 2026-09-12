import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const catalog = (): ObservedProviderCatalog => ({
  dataMode: "LIVE", accountId: "catalog-source:BTI:FOOTBALL", provider: "BTI", category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Date.now(), rejectedMarketCount: 0,
  events: [{ provider: "BTI", category: "FOOTBALL", providerEventId: "e1", competition: "epl",
    seasonStage: null, startAtUtcMs: Date.now() + 3_600_000, participantA: "Alpha", participantB: "Beta",
    eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
    fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
  markets: [{ provider: "BTI", category: "FOOTBALL", providerEventId: "e1", providerMarketId: "m1",
    marketType: "FT_AH", scope: "FULL_TIME", line: "0", settlementProfile: "p", status: "OPEN" }],
  quotes: [{ provider: "BTI", category: "FOOTBALL", providerEventId: "e1", providerMarketId: "m1",
    providerSelectionId: "m1:HOME", selection: "HOME", marketType: "FT_AH", scope: "FULL_TIME",
    line: "0", rawOdds: "0.9", rawFormat: "MALAY", status: "OPEN", isLive: false, sequence: 1,
    sourceTimestampMs: Date.now(), receivedMonotonicMs: 1 }]
}) as unknown as ObservedProviderCatalog;

const serve = async () => {
  const app = Fastify();
  registerCatalogRoutes(app, { read: async () => catalog(), snapshotFreshnessMaxAgeMs: 600_000 });
  await app.ready();
  return app;
};

describe("catalog markets=none", () => {
  it("accepts large event selections in a POST body with the same complete projection", async () => {
    const app = await serve();
    try {
      const events = ["e1", ...Array.from({ length: 900 }, (_, i) => String(884467107155537920n + BigInt(i)))].join(",");
      const response = await app.inject({ method: "POST",
        url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL",
        payload: { nativeDetail: "counts", events } });
      expect(response.statusCode).toBe(200);
      expect(response.json().events).toHaveLength(1);
      expect(response.json().markets).toHaveLength(1);
      expect(response.json().quotes).toHaveLength(1);
      const other = await app.inject({ method: "POST",
        url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL",
        payload: { nativeDetail: "counts", events: "e2" } });
      expect(other.statusCode).toBe(200);
      expect(other.json().markets).toEqual([]);
      expect(other.headers.etag).not.toBe(response.headers.etag);
    } finally { await app.close(); }
  });

  it("rejects invalid POST filters instead of returning an unfiltered book", async () => {
    const app = await serve();
    try {
      for (const payload of [{ events: "" }, { events: "../etc" }, { events: ["e1"] },
        { events: "x".repeat(65_537) }, { events: "e1", unexpected: true }]) {
        const response = await app.inject({ method: "POST",
          url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL", payload });
        expect(response.statusCode).toBe(400);
      }
    } finally { await app.close(); }
  });

  it("serves the fixtures without their prices, so pairing can be decided cheaply", async () => {
    const app = await serve();
    const full = await app.inject({ method: "GET", url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL" });
    const lean = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?markets=none" });
    expect(full.statusCode).toBe(200);
    expect(lean.statusCode).toBe(200);
    const fullBody = full.json() as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    const leanBody = lean.json() as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    // Every fixture still arrives: nothing about which events exist is hidden.
    expect(leanBody.events).toEqual(fullBody.events);
    expect(leanBody.markets).toEqual([]);
    expect(leanBody.quotes).toEqual([]);
    expect(fullBody.markets.length).toBeGreaterThan(0);
    expect(lean.body.length).toBeLessThan(full.body.length);
    await app.close();
  });

  it("drops the native observations too, which are the bulk of a large book", async () => {
    const app = await serve();
    const full = await app.inject({ method: "GET", url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL" });
    const lean = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?markets=none" });
    const fullBody = full.json() as { nativeMarketObservations?: unknown[] };
    const leanBody = lean.json() as { nativeMarketObservations?: unknown[] };
    // Measured 2026-09-12: BTI answered markets=none with 226 MB because the
    // observations stayed. They are decode diagnostics, never a comparison
    // input, so the view that drops prices has to drop them as well or it
    // does not buy the caller anything.
    if (fullBody.nativeMarketObservations !== undefined) {
      expect(fullBody.nativeMarketObservations.length).toBeGreaterThan(0);
      expect(leanBody.nativeMarketObservations).toEqual([]);
    }
    await app.close();
  });


  it("does not let the two views share a cache entry", async () => {
    const app = await serve();
    const full = await app.inject({ method: "GET", url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL" });
    const lean = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?markets=none" });
    expect(full.headers.etag).toBeDefined();
    expect(lean.headers.etag).toBeDefined();
    // A shared tag would let a lean response answer a request for the whole book.
    expect(lean.headers.etag).not.toBe(full.headers.etag);
    const reused = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL",
      headers: { "if-none-match": String(lean.headers.etag) } });
    expect(reused.statusCode).toBe(200);
    await app.close();
  });

  it("refuses a markets value it does not define", async () => {
    const app = await serve();
    const response = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?markets=some" });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
  it("serves prices for the named fixtures and every fixture either way", async () => {
    const app = await serve();
    const response = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e1" });
    const body = response.json() as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(body.events).toHaveLength(1);
    expect(body.markets).toHaveLength(1);
    expect(body.quotes).toHaveLength(1);
    const other = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e2" });
    const otherBody = other.json() as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    // The fixture still travels; only its prices were not asked for.
    expect(otherBody.events).toHaveLength(1);
    expect(otherBody.markets).toEqual([]);
    expect(otherBody.quotes).toEqual([]);
    await app.close();
  });

  it("never lets one narrowing answer a request for another", async () => {
    const app = await serve();
    const first = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e1" });
    const second = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e2" });
    const wide = await app.inject({ method: "GET", url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL" });
    const tags = [first.headers.etag, second.headers.etag, wide.headers.etag];
    // Same set size and same joined length, so only a real digest separates them.
    expect(new Set(tags).size).toBe(3);
    const reused = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e1",
      headers: { "if-none-match": String(second.headers.etag) } });
    expect(reused.statusCode).toBe(200);
    await app.close();
  });

  it("refuses an events list it cannot trust", async () => {
    const app = await serve();
    for (const value of ["", "e1,../etc", "e1," + "x".repeat(200)]) {
      const response = await app.inject({ method: "GET",
        url: `/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=${encodeURIComponent(value)}` });
      expect(response.statusCode).toBe(400);
    }
    await app.close();
  });
});
