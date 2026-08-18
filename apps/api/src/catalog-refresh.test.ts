import { describe, expect, it, vi } from "vitest";
import { refreshCatalogSources } from "./catalog-refresh.js";

describe("refreshCatalogSources", () => {
  it("uses the Chrome bridge instead of launching legacy session readers", async () => {
    const legacyRefresh = vi.fn(async () => undefined);
    const prepareSources = vi.fn(async () => undefined);
    const requestBridgeSnapshots = vi.fn((_freshAfterMs: number) => 6);
    const statuses = vi.fn(async () => [
      { id: "catalog-source:SABA:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 101 },
      { id: "catalog-source:BTI:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 101 }
    ]);

    await refreshCatalogSources({ legacyRefresh, prepareSources, requestBridgeSnapshots, statuses,
      now: () => 100, timeoutMs: 0 });

    expect(prepareSources).toHaveBeenCalledOnce();
    expect(requestBridgeSnapshots).toHaveBeenCalledOnce();
    expect(legacyRefresh).not.toHaveBeenCalled();
  });

  it("waits for bridge-owned sources and fails with their provider names when recovery is incomplete", async () => {
    const statuses = vi.fn(async () => [
      { id: "catalog-source:SABA:FOOTBALL", sessionState: "ACTION_REQUIRED", acquiredAtMs: 101 },
      { id: "catalog-source:BTI:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 101 }
    ]);

    await expect(refreshCatalogSources({
      legacyRefresh: async () => undefined,
      requestBridgeSnapshots: () => 2,
      statuses,
      now: () => 100,
      timeoutMs: 0
    })).rejects.toThrow("SABA");
  });

  it("fails immediately when no extension source is attached", async () => {
    await expect(refreshCatalogSources({
      legacyRefresh: async () => undefined,
      requestBridgeSnapshots: () => 0,
      statuses: async () => [],
      timeoutMs: 0
    })).rejects.toThrow("CHROME_BRIDGE_NO_ATTACHED_SOURCE");
  });

  it("fails closed instead of reloading old provider tokens when forced Fabet renewal fails", async () => {
    const requestBridgeSnapshots = vi.fn(() => 2);
    await expect(refreshCatalogSources({
      legacyRefresh: async () => undefined,
      prepareSources: async () => { throw new Error("SESSION_REFRESH_FAILED"); },
      requestBridgeSnapshots,
      statuses: async () => [
        { id: "catalog-source:SABA:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 101 },
        { id: "catalog-source:CMD:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 101 }
      ],
      now: () => 100,
      timeoutMs: 0
    })).rejects.toThrow("SESSION_REFRESH_FAILED");
    expect(requestBridgeSnapshots).not.toHaveBeenCalled();
  });

  it("does not accept ACTIVE catalogs produced before the current refresh cycle", async () => {
    await expect(refreshCatalogSources({
      legacyRefresh: async () => undefined,
      prepareSources: async () => undefined,
      requestBridgeSnapshots: () => 2,
      statuses: async () => [
        { id: "catalog-source:SABA:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 99 },
        { id: "catalog-source:CMD:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 101 }
      ],
      now: () => 100,
      timeoutMs: 0
    })).rejects.toThrow("SABA");
  });
});
