import { describe, expect, it } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ProviderFeedController } from "./provider-feed-controller.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";

const SABA = "catalog-source:SABA:FOOTBALL";
const clock = { nowMs: 0, set(nowMs: number) { this.nowMs = nowMs; } };

function catalog(overrides: Partial<ObservedProviderCatalog> = {}): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId: SABA, provider: "SABA", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1_000,
    rejectedMarketCount: 0, events: [], markets: [], quotes: [], ...overrides
  };
}

function controllerFor(accountId: string, nowMs: number): ProviderFeedController {
  const policy = providerFeedPolicies.get(accountId);
  if (policy === undefined) throw new Error("TEST_POLICY_MISSING");
  clock.set(nowMs);
  return new ProviderFeedController({ accountId, policy, now: () => clock.nowMs });
}

function wsBaseline(atMs: number, sourceEpoch: string, generation: string) {
  return { kind: "CATALOG" as const, accountId: SABA, sourceId: "chrome:SABA:7", sourceEpoch, atMs,
    generation, mode: "BASELINE" as const, provenance: "WS" as const, providerTimestampMs: null,
    catalog: catalog({ observedAtMs: atMs }) };
}

function wsDelta(atMs: number, sourceEpoch: string, generation = "reset-1") {
  return { ...wsBaseline(atMs, sourceEpoch, generation), mode: "DELTA" as const };
}

function wsTransport(atMs: number, sourceEpoch: string) {
  return { kind: "TRANSPORT" as const, accountId: SABA, sourceId: "chrome:SABA:7", sourceEpoch, atMs,
    provenance: "WS" as const };
}

function invalidate(atMs: number, sourceEpoch: string,
  reason: "SOURCE_REPLACED" | "PROVIDER_STREAM_CLOSED" | "PROVIDER_STREAM_GAP" | "SCHEMA_CHANGED") {
  return { kind: "INVALIDATE" as const, accountId: SABA, sourceId: "chrome:SABA:7", sourceEpoch, atMs, reason };
}

describe("ProviderFeedController", () => {
  it("does not promote restored data or tab heartbeats to LIVE", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.restore(catalog({ observedAtMs: 100 }));
    controller.accept({ kind: "TAB_REACHABLE", accountId: SABA, sourceId: "chrome:SABA:7",
      sourceEpoch: "worker-a:0", atMs: 1_000 });
    expect(controller.snapshot()).toMatchObject({ state: "SYNCING", lastCompleteBaselineAtMs: null });
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("keeps DOM fallback display-only until a policy-authorized baseline arrives", () => {
    const controller = controllerFor(SABA, 1_000);
    const domCandidate = { ...wsBaseline(1_000, "worker-a:0", "dom-1"), provenance: "DOM_FALLBACK" as const };
    expect(controller.accept(domCandidate)).toMatchObject({ accepted: true, publish: { snapshotState: "STALE" } });
    expect(controller.snapshot()).toMatchObject({ state: "SYNCING", lastCompleteBaselineAtMs: null,
      lastSemanticChangeAtMs: 1_000 });
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("removes prior authority when restored data replaces a live feed", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    controller.restore(catalog({ observedAtMs: 1_500 }));
    controller.accept(wsTransport(2_000, "worker-a:0"));
    expect(controller.snapshot()).toMatchObject({ state: "SYNCING", lastCompleteBaselineAtMs: null,
      lastAuthoritativeEvidenceAtMs: null });
  });

  it("keeps a current baseline live on provider transport but not beyond max baseline age", () => {
    const controller = controllerFor(SABA, 1_000);
    expect(controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1")).publish?.snapshotState).toBe("FRESH");
    clock.set(9_000);
    controller.accept(wsTransport(9_000, "worker-a:0"));
    expect(controller.snapshot().state).toBe("LIVE");
    clock.set(61_001);
    expect(controller.sweep()).toMatchObject({ accountId: SABA, stage: "SOFT" });
    expect(controller.snapshot().state).toBe("SOFT_RECOVERY");
  });

  it("revokes LIVE and blocks reads when authoritative evidence misses its cadence", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(11_001);
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "EVIDENCE_CADENCE_EXCEEDED" });
  });

  it("rejects a delta after its complete baseline has expired", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(61_001);
    expect(controller.accept(wsDelta(61_001, "worker-a:0"))).toMatchObject({
      accepted: false, publish: null, stateChanged: true
    });
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "BASELINE_EXPIRED" });
  });

  it("rejects late evidence from a retired source epoch", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    controller.accept(invalidate(2_000, "worker-a:0", "SOURCE_REPLACED"));
    expect(controller.accept(wsDelta(2_100, "worker-a:0"))).toMatchObject({ accepted: false });
  });

  it("stalls and republishes the retained catalog when the current stream has a gap", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    expect(controller.accept(invalidate(1_500, "worker-a:0", "PROVIDER_STREAM_GAP"))).toMatchObject({
      accepted: true, publish: { snapshotState: "STALE" }, stateChanged: true
    });
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "PROVIDER_STREAM_GAP" });
  });

  it("escalates recovery once per cooldown and only after the soft stage", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(21_001);
    expect(controller.sweep()).toMatchObject({ stage: "SOFT", attempt: 1, requestedAtMs: 21_001 });
    expect(controller.sweep()).toBeNull();
    clock.set(51_001);
    expect(controller.sweep()).toMatchObject({ stage: "HARD", attempt: 2, requestedAtMs: 51_001 });
    expect(controller.snapshot()).toMatchObject({ state: "HARD_RECOVERY", recoveryStage: "HARD", recoveryAttempt: 2 });
  });

  it("requires a current authoritative baseline before accepting deltas", () => {
    const controller = controllerFor(SABA, 1_000);
    expect(controller.accept(wsDelta(1_000, "worker-a:0"))).toMatchObject({ accepted: false });
    controller.accept(wsBaseline(1_001, "worker-a:0", "reset-1"));
    expect(controller.accept(wsDelta(1_002, "worker-a:0", "reset-2"))).toMatchObject({ accepted: false });
  });
});
