import { describe, expect, it, vi } from "vitest";
import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import { createChromeCatalogOverlay } from "./chrome-catalog-overlay.js";

const status: CatalogSourceStatus = { id: "catalog-source:CMD:FOOTBALL", alias: "CMD", provider: "CMD",
  category: "FOOTBALL", sessionState: "UNCONFIGURED", acquiredAtMs: null, reason: null };

describe("createChromeCatalogOverlay", () => {
  it("reads CMD from Chrome first and delegates every unrelated source", async () => {
    const chromeCatalog = { accountId: status.id, provider: "CMD", category: "FOOTBALL" } as never;
    const fallbackCatalog = { accountId: "catalog-source:SABA:FOOTBALL" } as never;
    const fallbackRead = vi.fn(async () => fallbackCatalog);
    const overlay = createChromeCatalogOverlay({
      sources: { listStatuses: async () => [status] },
      reader: { read: fallbackRead },
      chrome: {
        owns: (id: string) => id === status.id,
        read: vi.fn(async (id: string) => id === status.id ? chromeCatalog : Promise.reject(new Error("missing"))),
        overlayStatuses: async (values) => values
      }
    });
    await expect(overlay.reader.read(status.id)).resolves.toBe(chromeCatalog);
    await expect(overlay.reader.read("catalog-source:SABA:FOOTBALL")).resolves.toBe(fallbackCatalog);
    expect(fallbackRead).toHaveBeenCalledTimes(1);
  });

  it("fails closed without launching a legacy browser when a Chrome-owned source is stale", async () => {
    const fallbackCatalog = { accountId: status.id } as never;
    const fallbackRead = vi.fn(async () => fallbackCatalog);
    const overlay = createChromeCatalogOverlay({
      sources: { listStatuses: async () => [status] },
      reader: { read: fallbackRead },
      chrome: { owns: (id) => id === status.id,
        read: vi.fn(async () => { throw new Error("CHROME_CATALOG_STALE"); }),
        overlayStatuses: async (values) => values }
    });
    await expect(overlay.reader.read(status.id)).rejects.toThrow("CHROME_CATALOG_STALE");
    expect(fallbackRead).not.toHaveBeenCalled();
    expect(overlay.reader.failureRetryBaseMs).toBe(1_000);
    expect(overlay.reader.failureRetryMaxMs).toBe(5_000);
  });

  it("uses any fresh Chrome-backed catalog source, including IM", async () => {
    const imId = "catalog-source:IM:FOOTBALL";
    const chromeCatalog = { accountId: imId, provider: "IM" } as never;
    const fallbackRead = vi.fn(async () => ({ accountId: imId }) as never);
    const overlay = createChromeCatalogOverlay({
      sources: { listStatuses: async () => [] }, reader: { read: fallbackRead },
      chrome: { owns: (id) => id === imId,
        read: vi.fn(async (id) => id === imId ? chromeCatalog : Promise.reject(new Error("missing"))),
        overlayStatuses: async (values) => values }
    });
    await expect(overlay.reader.read(imId)).resolves.toBe(chromeCatalog);
    expect(fallbackRead).not.toHaveBeenCalled();
  });

  it("uses each Chrome provider evidence cadence as its public catalog freshness window", () => {
    const overlay = createChromeCatalogOverlay({
      sources: { listStatuses: async () => [] }, reader: { read: async () => Promise.reject(new Error("unused")) },
      chrome: { owns: () => true, read: async () => Promise.reject(new Error("unused")),
        overlayStatuses: async (values) => values }
    });
    const freshnessFor = (overlay.reader as typeof overlay.reader & {
      snapshotFreshnessMaxAgeMsFor?: (accountId: string) => number;
    }).snapshotFreshnessMaxAgeMsFor;

    expect(freshnessFor?.("catalog-source:SABA:FOOTBALL")).toBe(30_000);
    expect(freshnessFor?.("catalog-source:BTI:FOOTBALL")).toBe(30_000);
  });
});
