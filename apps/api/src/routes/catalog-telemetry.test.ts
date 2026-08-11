import { describe, expect, it } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogTelemetryRegistry, type CatalogJournalEntry } from "./catalog-telemetry.js";

function catalog(rawOdds: string, status: "OPEN" | "SUSPENDED", sequence: number): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId: "private-account-canary", provider: "SABA", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1_000 + sequence, rejectedMarketCount: 0,
    events: [], markets: [], quotes: [{
      provider: "SABA", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-home", marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME",
      line: "0.5", rawOdds, rawFormat: "MALAY", status, isLive: true, sourceTimestampMs: 900 + sequence,
      receivedMonotonicMs: 100 + sequence, sequence
    }]
  };
}

describe("CatalogTelemetryRegistry quote journal", () => {
  it("records only public quote changes, sequence gaps, failures, and recovery", async () => {
    let wallNowMs = 1_000;
    let monotonicNowMs = 10;
    const journal: CatalogJournalEntry[] = [];
    const registry = new CatalogTelemetryRegistry({
      wallNowMs: () => wallNowMs,
      monotonicNowMs: () => monotonicNowMs
    }, { append: async (entries) => { journal.push(...entries); } });

    let started = registry.now();
    wallNowMs = 1_010;
    monotonicNowMs = 20;
    await registry.recordSuccess("private-account-canary", catalog("0.80", "OPEN", 1), registry.complete(started));

    started = registry.now();
    wallNowMs = 1_020;
    monotonicNowMs = 30;
    await registry.recordSuccess("private-account-canary", catalog("0.81", "SUSPENDED", 3), registry.complete(started));

    started = registry.now();
    wallNowMs = 1_030;
    monotonicNowMs = 40;
    await registry.recordFailure("private-account-canary", "UNAVAILABLE", registry.complete(started));

    started = registry.now();
    wallNowMs = 1_040;
    monotonicNowMs = 50;
    await registry.recordSuccess("private-account-canary", catalog("0.81", "OPEN", 4), registry.complete(started));

    expect(registry.response().metrics).toEqual([expect.objectContaining({
      state: "SUCCESS", latestSequence: 4, sequenceGapCount: 1, recoveryCount: 1,
      priceChangeCount: 1, statusChangeCount: 2, consecutiveFailures: 0, journalErrorCount: 0,
      totalReads: 4, successCount: 3, failureCount: 1
    })]);
    expect(journal.map((entry) => entry.type)).toEqual([
      "SNAPSHOT_ACCEPTED", "SEQUENCE_GAP", "ODDS_CHANGED", "STATUS_CHANGED",
      "CATALOG_UNAVAILABLE", "CATALOG_RECOVERED", "STATUS_CHANGED"
    ]);
    expect(journal).toContainEqual(expect.objectContaining({
      type: "ODDS_CHANGED", provider: "SABA", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-home",
      previousOdds: "0.80", currentOdds: "0.81", sequence: 3
    }));
    expect(JSON.stringify(journal)).not.toContain("private-account-canary");
  });

  it("does not fail a catalog read when the append-only journal is temporarily unavailable", async () => {
    const registry = new CatalogTelemetryRegistry(undefined, {
      append: async () => { throw new Error("private-journal-path-canary"); }
    });
    const started = registry.now();

    await expect(registry.recordSuccess("account", catalog("0.80", "OPEN", 1), registry.complete(started)))
      .resolves.toBeUndefined();
    expect(registry.response().metrics[0]).toEqual(expect.objectContaining({ journalErrorCount: 1 }));
    expect(JSON.stringify(registry.response())).not.toContain("private-journal-path-canary");
  });
});
