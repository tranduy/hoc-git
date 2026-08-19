import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogRevisionEntry } from "@tool-chenh/contracts";
import type { CatalogReadResult, LiveCatalogResponse } from "../api/catalog.js";
import { CatalogRevisionCoordinator } from "./catalog-revision-coordinator.js";

afterEach(() => vi.useRealTimers());

function entry(accountId: string, revision: string, observedAtMs = 100): CatalogRevisionEntry {
  return { accountId, revision, observedAtMs, snapshotState: "FRESH" };
}

function result(accountId: string, revision: string, observedAtMs = 100): CatalogReadResult {
  const provider = accountId.includes("SBOBET") ? "SBOBET" : "SABA";
  const catalog: LiveCatalogResponse = {
    dataMode: "LIVE", accountId, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs,
    rejectedMarketCount: 0, events: [], markets: [], quotes: []
  };
  return { catalog, revision };
}

describe("CatalogRevisionCoordinator", () => {
  it("fetches and emits only the selected account whose revision changed", async () => {
    vi.useFakeTimers();
    const accepted: CatalogReadResult[] = [];
    const reads: string[] = [];
    const coordinator = new CatalogRevisionCoordinator({
      read: async (accountId) => { reads.push(accountId); return result(accountId, "r2"); },
      onCatalog: (value) => accepted.push(value)
    });
    coordinator.setSelected(["catalog-source:SABA:FOOTBALL", "catalog-source:SBOBET:FOOTBALL"]);
    coordinator.setHeldRevision("catalog-source:SABA:FOOTBALL", "r1");
    coordinator.setHeldRevision("catalog-source:SBOBET:FOOTBALL", "other-r1");
    coordinator.acceptBaseline([
      entry("catalog-source:SABA:FOOTBALL", "r1"),
      entry("catalog-source:SBOBET:FOOTBALL", "other-r1")
    ], 1);
    coordinator.acceptRevision(entry("catalog-source:SABA:FOOTBALL", "r2"), 2);

    await vi.advanceTimersByTimeAsync(50);

    expect(reads).toEqual(["catalog-source:SABA:FOOTBALL"]);
    expect(accepted).toEqual([result("catalog-source:SABA:FOOTBALL", "r2")]);
    coordinator.stop();
  });

  it("cancels a queued baseline reconciliation when the initial read already holds that revision", async () => {
    vi.useFakeTimers();
    const accepted: CatalogReadResult[] = [];
    const accountId = "catalog-source:SABA:FOOTBALL";
    let reads = 0;
    const coordinator = new CatalogRevisionCoordinator({
      read: async () => { reads += 1; return result(accountId, "r1"); },
      onCatalog: (value) => accepted.push(value)
    });
    coordinator.setSelected([accountId]);
    coordinator.acceptBaseline([entry(accountId, "r1")], 1);
    coordinator.setHeldRevision(accountId, "r1");

    await vi.advanceTimersByTimeAsync(50);

    expect(reads).toBe(0);
    expect(accepted).toEqual([]);
    coordinator.stop();
  });

  it("coalesces a revision burst and converges after a revision arrives in flight", async () => {
    vi.useFakeTimers();
    const accepted: CatalogReadResult[] = [];
    const pending: Array<(value: CatalogReadResult) => void> = [];
    const coordinator = new CatalogRevisionCoordinator({
      read: () => new Promise((resolve) => pending.push(resolve)),
      onCatalog: (value) => accepted.push(value)
    });
    const accountId = "catalog-source:SABA:FOOTBALL";
    coordinator.setSelected([accountId]);
    coordinator.acceptBaseline([entry(accountId, "r1")], 1);
    coordinator.acceptRevision(entry(accountId, "r2", 102), 2);
    coordinator.acceptRevision(entry(accountId, "r3", 103), 3);
    await vi.advanceTimersByTimeAsync(50);
    expect(pending).toHaveLength(1);

    coordinator.acceptRevision(entry(accountId, "r4", 104), 4);
    pending[0]!(result(accountId, "r3", 103));
    await vi.advanceTimersByTimeAsync(50);
    expect(pending).toHaveLength(2);
    expect(accepted).toEqual([]);
    pending[1]!(result(accountId, "r4", 104));
    await Promise.resolve();

    expect(accepted).toEqual([result(accountId, "r4", 104)]);
    coordinator.stop();
  });

  it("remembers unselected revisions until selection and repairs a reconnect baseline", async () => {
    vi.useFakeTimers();
    const accepted: CatalogReadResult[] = [];
    const accountId = "catalog-source:SABA:FOOTBALL";
    const coordinator = new CatalogRevisionCoordinator({
      read: async () => result(accountId, "r3", 103),
      onCatalog: (value) => accepted.push(value)
    });
    coordinator.acceptBaseline([entry(accountId, "r3", 103)], 3);
    await vi.advanceTimersByTimeAsync(100);
    expect(accepted).toEqual([]);

    coordinator.setSelected([accountId]);
    await vi.advanceTimersByTimeAsync(50);

    expect(accepted).toEqual([result(accountId, "r3", 103)]);
    coordinator.stop();
  });

  it("polls selected accounts every second only while realtime is unavailable", async () => {
    vi.useFakeTimers();
    const accepted: CatalogReadResult[] = [];
    const accountId = "catalog-source:SABA:FOOTBALL";
    let revision = 0;
    const coordinator = new CatalogRevisionCoordinator({
      read: async () => result(accountId, `fallback-${++revision}`, 100 + revision),
      onCatalog: (value) => accepted.push(value)
    });
    coordinator.setSelected([accountId]);
    coordinator.setRealtimeUnavailable();
    await vi.advanceTimersByTimeAsync(999);
    expect(accepted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(accepted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(accepted).toHaveLength(2);

    coordinator.acceptBaseline([entry(accountId, "fallback-2", 102)], 10);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(accepted).toHaveLength(2);
    coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
