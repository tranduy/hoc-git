import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { registerCatalogRoutes } from "./catalog.js";

function catalog(): ObservedProviderCatalog {
  return {
    dataMode: "LIVE",
    accountId: "catalog-source:BTI:FOOTBALL",
    provider: "BTI",
    category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: Date.now(),
    rejectedMarketCount: 0,
    events: [],
    markets: Array.from({ length: 300 }, (_, index) => ({
      provider: "BTI",
      category: "FOOTBALL",
      providerEventId: `e${Math.floor(index / 100)}`,
      providerMarketId: `m${index}`,
      marketType: "FT_TOTAL",
      scope: "FULL_TIME",
      line: String(index),
      settlementProfile: "football-regulation",
      status: "OPEN"
    })),
    quotes: []
  } as unknown as ObservedProviderCatalog;
}

describe("catalog response streaming", () => {
  it("never serializes the complete catalog into one giant JSON string", async () => {
    const source = catalog();
    const original = JSON.stringify;
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation((value, ...rest) => {
      if (typeof value === "object" && value !== null &&
        Array.isArray((value as { markets?: unknown }).markets)) {
        throw new Error("WHOLE_CATALOG_STRINGIFY_FORBIDDEN");
      }
      return original(value, ...rest);
    });
    const app = Fastify();
    registerCatalogRoutes(app, { read: async () => source, snapshotFreshnessMaxAgeMs: 600_000 });
    await app.ready();

    const response = await app.inject({ method: "GET",
      url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL" });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { markets: unknown[] }).markets).toHaveLength(300);
    expect(stringify).not.toHaveBeenCalledWith(expect.objectContaining({ markets: expect.any(Array) }));
    stringify.mockRestore();
    await app.close();
  });
});
