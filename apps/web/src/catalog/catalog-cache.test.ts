import { describe, expect, it, vi } from "vitest";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { LIVE_CATALOG_CACHE_KEY, loadCatalogCache, saveCatalogCache } from "./catalog-cache.js";

const catalog: LiveCatalogResponse = { dataMode: "LIVE", accountId: "source", provider: "SBOBET",
  category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100,
  snapshotState: "FRESH", rejectedMarketCount: 0, events: [], markets: [], quotes: [] };

describe("optional live catalog cache", () => {
  it("counts per-event inventory metadata before allocating a cache serialization", () => {
    const storage = { setItem: vi.fn() } as unknown as Storage;
    const large: LiveCatalogResponse = { ...catalog, nativeCoverageByEvent: Array.from({ length: 5_001 },
      (_, index) => ({ providerEventId: `event-${index}`, normalized: 0, excluded: 0, unmapped: 1 })) };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      saveCatalogCache(storage, [large]);
      expect(stringify).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally { stringify.mockRestore(); }
  });

  it("does not serialize an oversized catalog on the UI thread when it cannot fit the cache", () => {
    const storage = { setItem: vi.fn() } as unknown as Storage;
    const large = { ...catalog, quotes: new Array(60_000).fill({}) } as LiveCatalogResponse;
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      saveCatalogCache(storage, [large]);
      expect(stringify).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    } finally { stringify.mockRestore(); }
  });

  it("keeps small caches readable and preserves their original observation time", () => {
    const data = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => { data.set(key, value); },
      getItem: (key: string) => data.get(key) ?? null } as Storage;
    saveCatalogCache(storage, [catalog]);
    expect(data.has(LIVE_CATALOG_CACHE_KEY)).toBe(true);
    expect(loadCatalogCache(storage)).toEqual([catalog]);
  });

  it("does not replace a previous cache with a small number of oversized records", () => {
    const storage = { setItem: vi.fn() } as unknown as Storage;
    saveCatalogCache(storage, [{ ...catalog, accountId: "x".repeat(1_100_000) }]);
    expect(vi.mocked(storage.setItem).mock.calls.length).toBe(0);
  });
});
