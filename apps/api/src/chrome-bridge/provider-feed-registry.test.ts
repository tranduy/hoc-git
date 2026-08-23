import { afterEach, describe, expect, it, vi } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";

const APSPORT = "catalog-source:APSPORT:FOOTBALL";
const BTI = "catalog-source:BTI:FOOTBALL";
const CMD = "catalog-source:CMD:FOOTBALL";
const IM = "catalog-source:IM:FOOTBALL";
const SABA = "catalog-source:SABA:FOOTBALL";
const SBOBET = "catalog-source:SBOBET:FOOTBALL";

function catalogFor(accountId: string, observedAtMs = 100): ObservedProviderCatalog {
  const provider = (accountId.split(":")[1] ?? "SABA") as ObservedProviderCatalog["provider"];
  return { dataMode: "LIVE", accountId, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0,
    events: [], markets: [], quotes: [] };
}

function wsBaseline(accountId: string, atMs: number, generation: string) {
  return { kind: "CATALOG" as const, accountId, sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0",
    atMs, generation, mode: "BASELINE" as const, provenance: "WS" as const, providerTimestampMs: null,
    catalog: catalogFor(accountId, atMs) };
}

afterEach(() => vi.useRealTimers());

describe("ProviderFeedRegistry", () => {
  it("creates all six controllers and keeps restored data stale", () => {
    const registry = new ProviderFeedRegistry({ now: () => 1_000 });

    expect(registry.list().map((item) => item.accountId)).toEqual([
      APSPORT, BTI, CMD, IM, SABA, SBOBET
    ]);
    expect(registry.restore(catalogFor(SBOBET))).toMatchObject({
      accepted: true, publish: { snapshotState: "STALE" }
    });
    expect(registry.snapshot(SBOBET).state).toBe("SYNCING");
    expect(() => registry.read(SBOBET)).toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("waits for a complete baseline newer than the requested boundary and cleans up its timer", async () => {
    vi.useFakeTimers();
    const registry = new ProviderFeedRegistry({ now: () => 1_001 });
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);
    expect(vi.getTimerCount()).toBe(1);

    registry.accept(wsBaseline(SABA, 1_001, "reset-2"));

    await expect(waiting).resolves.toMatchObject({
      accountId: SABA, state: "LIVE", lastCompleteBaselineAtMs: 1_001
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not publish or resolve an already expired evidence baseline as fresh", async () => {
    vi.useFakeTimers();
    const registry = new ProviderFeedRegistry({ now: () => 12_000 });

    expect(registry.accept(wsBaseline(SABA, 1_001, "reset-old"))).toMatchObject({
      accepted: true, publish: { snapshotState: "STALE" }
    });
    expect(registry.snapshot(SABA)).toMatchObject({ state: "STALLED", reason: "EVIDENCE_CADENCE_EXCEEDED" });
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);
    const rejected = expect(waiting).rejects.toThrow("PROVIDER_FEED_BASELINE_TIMEOUT");

    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
  });

  it("rejects a baseline wait on timeout and cleans up its timer", async () => {
    vi.useFakeTimers();
    const registry = new ProviderFeedRegistry({ now: () => 1_000 });
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);
    const rejected = expect(waiting).rejects.toThrow("PROVIDER_FEED_BASELINE_TIMEOUT");

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
