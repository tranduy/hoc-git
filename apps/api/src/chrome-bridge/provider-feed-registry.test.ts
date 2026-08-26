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

function wsDelta(accountId: string, atMs: number, generation: string) {
  return { ...wsBaseline(accountId, atMs, generation), mode: "DELTA" as const };
}

class TrackingRegistry extends ProviderFeedRegistry {
  activeSubscriptions = 0;

  override subscribe(listener: Parameters<ProviderFeedRegistry["subscribe"]>[0]): () => void {
    const unsubscribe = super.subscribe(listener);
    this.activeSubscriptions += 1;
    return () => {
      this.activeSubscriptions -= 1;
      unsubscribe();
    };
  }
}

class SynchronouslyDeliveringRegistry extends TrackingRegistry {
  override subscribe(listener: Parameters<ProviderFeedRegistry["subscribe"]>[0]): () => void {
    this.accept(wsBaseline(SABA, 1_001, "reset-synchronous"));
    listener(this.snapshot(SABA));
    return super.subscribe(listener);
  }
}

afterEach(() => vi.useRealTimers());

describe("ProviderFeedRegistry", () => {
  it("flushes one final subscriber snapshot after a successful account transaction", () => {
    const registry = new ProviderFeedRegistry({ now: () => 1_001 });
    const listener = vi.fn();
    registry.subscribe(listener);

    registry.transaction(SABA, () => {
      expect(registry.accept(wsBaseline(SABA, 1_001, "reset-transaction"))).toMatchObject({ accepted: true });
      expect(listener).not.toHaveBeenCalled();
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: SABA, state: "LIVE", sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0"
    }));
  });

  it("restores readable controller state and stays silent when a transaction fails", () => {
    const registry = new ProviderFeedRegistry({ now: () => 1_001 });
    registry.accept(wsBaseline(SABA, 1_000, "reset-a"));
    const before = registry.snapshot(SABA);
    const listener = vi.fn();
    registry.subscribe(listener);

    expect(() => registry.transaction(SABA, () => {
      registry.accept({ kind: "INVALIDATE", accountId: SABA, sourceId: "chrome:SABA:7",
        sourceEpoch: "worker-a:0", atMs: 1_001, reason: "SOURCE_REPLACED" });
      throw new Error("fault-injected");
    })).toThrow("fault-injected");

    expect(registry.snapshot(SABA)).toEqual(before);
    expect(registry.read(SABA)).toEqual(catalogFor(SABA, 1_000));
    expect(listener).not.toHaveBeenCalled();
  });

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
    const registry = new ProviderFeedRegistry({ now: () => 77_000 });

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

  it("disposes pending baseline waits and removes their listeners and timers", async () => {
    vi.useFakeTimers();
    const registry = new TrackingRegistry({ now: () => 1_000 });
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);
    const rejected = expect(waiting).rejects.toThrow("PROVIDER_FEED_REGISTRY_DISPOSED");

    expect(registry.activeSubscriptions).toBe(1);
    registry.dispose();

    await rejected;
    expect(registry.activeSubscriptions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts one baseline wait without disturbing the registry or leaking its listener and timer", async () => {
    vi.useFakeTimers();
    const registry = new TrackingRegistry({ now: () => 1_000 });
    const controller = new AbortController();
    const waitForFreshBaseline = registry.waitForFreshBaseline.bind(registry) as unknown as (
      accountId: string, afterMs: number, timeoutMs: number, signal: AbortSignal
    ) => ReturnType<ProviderFeedRegistry["waitForFreshBaseline"]>;
    const waiting = waitForFreshBaseline(SABA, 1_000, 5_000, controller.signal);
    const rejected = expect(waiting).rejects.toThrow("PROVIDER_FEED_WAIT_ABORTED");

    expect(registry.activeSubscriptions).toBe(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(registry.activeSubscriptions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(registry.snapshot(SABA).state).toBe("STARTING");
  });

  it("handles a fresh baseline delivered synchronously while subscribing", async () => {
    vi.useFakeTimers();
    const registry = new SynchronouslyDeliveringRegistry({ now: () => 1_001 });

    await expect(registry.waitForFreshBaseline(SABA, 1_000, 5_000)).resolves.toMatchObject({
      state: "LIVE", lastCompleteBaselineAtMs: 1_001
    });
    expect(registry.activeSubscriptions).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not resolve for a baseline exactly at the requested boundary", async () => {
    vi.useFakeTimers();
    const registry = new ProviderFeedRegistry({ now: () => 1_000 });
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);
    const rejected = expect(waiting).rejects.toThrow("PROVIDER_FEED_BASELINE_TIMEOUT");

    registry.accept(wsBaseline(SABA, 1_000, "reset-boundary"));
    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
  });

  it("does not resolve a baseline wait from a newer DELTA notification", async () => {
    vi.useFakeTimers();
    let nowMs = 1_000;
    const registry = new ProviderFeedRegistry({ now: () => nowMs });
    registry.accept(wsBaseline(SABA, 1_000, "reset-1"));
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);
    const rejected = expect(waiting).rejects.toThrow("PROVIDER_FEED_BASELINE_TIMEOUT");

    nowMs = 1_001;
    registry.accept(wsDelta(SABA, 1_001, "reset-1"));
    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
  });

  it("removes a baseline wait listener after a normal resolve", async () => {
    vi.useFakeTimers();
    const registry = new TrackingRegistry({ now: () => 1_001 });
    const waiting = registry.waitForFreshBaseline(SABA, 1_000, 5_000);

    registry.accept(wsBaseline(SABA, 1_001, "reset-2"));

    await expect(waiting).resolves.toBeDefined();
    expect(registry.activeSubscriptions).toBe(0);
  });

  it("notifies subscribers when read expires a LIVE snapshot", () => {
    let nowMs = 1_000;
    const registry = new ProviderFeedRegistry({ now: () => nowMs });
    registry.accept(wsBaseline(SABA, 1_000, "reset-1"));
    const listener = vi.fn();
    registry.subscribe(listener);

    nowMs = 76_001;
    expect(() => registry.read(SABA)).toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: SABA, state: "STALLED", reason: "EVIDENCE_CADENCE_EXCEEDED"
    }));
  });

  it("keeps one SABA bootstrap generation live through 30 minutes of measured-cadence deltas", () => {
    let nowMs = 1_000;
    const registry = new ProviderFeedRegistry({ now: () => nowMs });
    expect(registry.accept(wsBaseline(SABA, nowMs, "saba-bootstrap"))).toMatchObject({ accepted: true });

    for (nowMs += 69_600; nowMs <= 1_861_000; nowMs += 69_600) {
      expect(registry.accept(wsDelta(SABA, nowMs, "saba-bootstrap"))).toMatchObject({ accepted: true });
      expect(registry.read(SABA)).toEqual(catalogFor(SABA, nowMs));
      expect(registry.snapshot(SABA)).toMatchObject({
        state: "LIVE", activeGeneration: "saba-bootstrap", lastDeltaAtMs: nowMs
      });
    }
  });
});
