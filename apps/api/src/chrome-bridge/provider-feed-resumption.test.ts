import { describe, expect, it } from "vitest";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

function evidence(provider: ObservedProviderCatalog["provider"], atMs: number, mode: "BASELINE" | "DELTA") {
  const accountId = `catalog-source:${provider}:FOOTBALL`;
  const catalog: ObservedProviderCatalog = { accountId, provider, category: "FOOTBALL", dataMode: "LIVE",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: atMs, rejectedMarketCount: 0,
    events: [], markets: [], quotes: [] };
  return { kind: "CATALOG" as const, accountId, sourceId: `chrome:${provider}:7`, sourceEpoch: "worker:1",
    generation: "baseline-1", mode, atMs, providerTimestampMs: null, catalog,
    provenance: provider === "SABA" ? "WS" as const : "AUTHENTICATED_HTTP" as const };
}

describe("authoritative feed resumption", () => {
  it.each(["CMD", "IM", "BTI", "SBOBET", "SABA", "APSPORT"] as const)(
    "restores %s after a cadence lapse when a valid delta resumes its unexpired baseline", (provider) => {
      let nowMs = 0;
      const registry = new ProviderFeedRegistry({ now: () => nowMs });
      const baseline = evidence(provider, 0, "BASELINE");
      const policy = providerFeedPolicies.get(baseline.accountId)!;
      registry.accept(baseline);
      nowMs = policy.expectedEvidenceCadenceMs + 1;
      expect(() => registry.read(baseline.accountId)).toThrow("PROVIDER_FEED_NOT_LIVE");
      expect(registry.sweep()).toContainEqual(expect.objectContaining({ accountId: baseline.accountId, stage: "SOFT" }));
      nowMs += 1;
      expect(registry.accept(evidence(provider, nowMs, "DELTA"))).toMatchObject({
        accepted: true, stateChanged: true, publish: { snapshotState: "FRESH" }
      });
      expect(registry.read(baseline.accountId).observedAtMs).toBe(nowMs);
      expect(registry.snapshot(baseline.accountId)).toMatchObject({ state: "LIVE", reason: null,
        recoveryStage: "NONE", recoveryAttempt: 0, lastCompleteBaselineAtMs: 0, lastDeltaAtMs: nowMs });
      expect(registry.sweep()).not.toContainEqual(expect.objectContaining({ accountId: baseline.accountId }));
      registry.dispose();
    });

  it.each(["STALLED", "HARD_RECOVERY"] as const)("resumes a valid CMD delta from %s", (state) => {
    let nowMs = 0;
    const registry = new ProviderFeedRegistry({ now: () => nowMs });
    const baseline = evidence("CMD", 0, "BASELINE");
    registry.accept(baseline);
    nowMs = 30_001;
    expect(() => registry.read(baseline.accountId)).toThrow();
    if (state === "HARD_RECOVERY") { registry.sweep(); nowMs = 60_002; registry.sweep(); }
    expect(registry.snapshot(baseline.accountId).state).toBe(state);
    nowMs += 1;
    registry.accept(evidence("CMD", nowMs, "DELTA"));
    expect(registry.read(baseline.accountId).observedAtMs).toBe(nowMs);
    registry.dispose();
  });

  it.each(["PROVIDER_STREAM_GAP", "PROVIDER_STREAM_CLOSED", "SCHEMA_CHANGED", "SOURCE_REPLACED"] as const)(
    "requires a complete baseline after %s", (reason) => {
      const registry = new ProviderFeedRegistry({ now: () => 32_000 });
      const baseline = evidence("CMD", 0, "BASELINE");
      registry.accept(baseline);
      registry.accept({ kind: "INVALIDATE", accountId: baseline.accountId, sourceId: baseline.sourceId,
        sourceEpoch: baseline.sourceEpoch, atMs: 31_000, reason });
      expect(registry.accept(evidence("CMD", 32_000, "DELTA"))).toMatchObject({ accepted: false });
      expect(() => registry.read(baseline.accountId)).toThrow();
      registry.dispose();
    });

  it("does not revive an expired baseline with a current delta", () => {
    let nowMs = 0;
    const registry = new ProviderFeedRegistry({ now: () => nowMs });
    const baseline = evidence("CMD", 0, "BASELINE");
    registry.accept(baseline);
    nowMs = 90_001;
    expect(registry.accept(evidence("CMD", nowMs, "DELTA"))).toMatchObject({ accepted: false });
    expect(() => registry.read(baseline.accountId)).toThrow();
    registry.dispose();
  });

  it("does not revive a stalled source from buffered old evidence or a different generation", () => {
    let nowMs = 0;
    const registry = new ProviderFeedRegistry({ now: () => nowMs });
    const baseline = evidence("CMD", 0, "BASELINE");
    registry.accept(baseline);
    nowMs = 70_000;
    registry.sweep();
    expect(registry.accept(evidence("CMD", 31_000, "DELTA"))).toMatchObject({ publish: { snapshotState: "STALE" } });
    expect(() => registry.read(baseline.accountId)).toThrow();
    expect(registry.accept({ ...evidence("CMD", nowMs, "DELTA"), generation: "other" })).toMatchObject({ accepted: false });
    expect(() => registry.read(baseline.accountId)).toThrow();
    registry.dispose();
  });
});
