import { describe, expect, it } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ProviderFeedController } from "./provider-feed-controller.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";

const SABA = "catalog-source:SABA:FOOTBALL";
const CMD = "catalog-source:CMD:FOOTBALL";
const IM = "catalog-source:IM:FOOTBALL";
const BTI = "catalog-source:BTI:FOOTBALL";
const clock = { nowMs: 0, set(nowMs: number) { this.nowMs = nowMs; } };

function catalog(overrides: Partial<ObservedProviderCatalog> = {}): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId: SABA, provider: "SABA", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1_000,
    rejectedMarketCount: 0, events: [], markets: [], quotes: [], ...overrides
  };
}

function controllerFor(accountId: string, nowMs: number): ProviderFeedController {
  const policy = policyFor(accountId);
  clock.set(nowMs);
  return new ProviderFeedController({ accountId, policy, now: () => clock.nowMs });
}

function policyFor(accountId: string) {
  const policy = providerFeedPolicies.get(accountId);
  if (policy === undefined) throw new Error("TEST_POLICY_MISSING");
  return policy;
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

function cmdCatalogEvidence(atMs: number, mode: "BASELINE" | "DELTA") {
  return { kind: "CATALOG" as const, accountId: CMD, sourceId: "chrome:CMD:9", sourceEpoch: "worker-a:0",
    atMs, generation: "cmd:100", mode, provenance: "AUTHENTICATED_HTTP" as const,
    providerTimestampMs: null,
    catalog: catalog({ accountId: CMD, provider: "CMD", observedAtMs: atMs }) };
}

function imCatalogEvidence(atMs: number, mode: "BASELINE" | "DELTA") {
  return { kind: "CATALOG" as const, accountId: IM, sourceId: "chrome:IM:8", sourceEpoch: "worker-a:0",
    atMs, generation: "im:8:100", mode, provenance: "AUTHENTICATED_HTTP" as const,
    providerTimestampMs: null,
    catalog: catalog({ accountId: IM, provider: "IM", observedAtMs: atMs }) };
}

function btiCatalogEvidence(atMs: number) {
  return { kind: "CATALOG" as const, accountId: BTI, sourceId: "chrome:BTI:10", sourceEpoch: "worker-a:0",
    atMs, generation: "bti:100:1", mode: "BASELINE" as const,
    provenance: "AUTHENTICATED_HTTP" as const, providerTimestampMs: null,
    catalog: catalog({ accountId: BTI, provider: "BTI", observedAtMs: atMs }) };
}

function imTransport(atMs: number) {
  return { kind: "TRANSPORT" as const, accountId: IM, sourceId: "chrome:IM:8", sourceEpoch: "worker-a:0",
    atMs, provenance: "AUTHENTICATED_HTTP" as const };
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
    // CMD authorizes WS and authenticated HTTP only. SABA additionally trusts
    // DOM_FALLBACK, so the display-only guarantee is asserted where it holds.
    const controller = controllerFor(CMD, 1_000);
    const domCandidate = { ...cmdCatalogEvidence(1_000, "BASELINE"), provenance: "DOM_FALLBACK" as const };
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
    const policy = policyFor(SABA);
    const controller = controllerFor(SABA, 1_000);
    expect(controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1")).publish?.snapshotState).toBe("FRESH");
    clock.set(9_000);
    controller.accept(wsTransport(9_000, "worker-a:0"));
    expect(controller.snapshot().state).toBe("LIVE");
    clock.set(9_000 + policy.softRecoveryAfterMs + 1);
    expect(controller.sweep()).toMatchObject({ accountId: SABA, stage: "SOFT" });
    expect(controller.snapshot().state).toBe("SOFT_RECOVERY");
  });

  it("keeps CMD live through runtime sweeps until its current baseline reaches twenty seconds", () => {
    const controller = controllerFor(CMD, 0);
    expect(controller.accept(cmdCatalogEvidence(0, "BASELINE")).publish?.snapshotState).toBe("FRESH");

    for (const nowMs of [15_001, 19_999, 20_000]) {
      clock.set(nowMs);
      expect(controller.sweep()).toBeNull();
      expect(controller.read()).toMatchObject({ accountId: CMD, observedAtMs: 0 });
      expect(controller.snapshot()).toMatchObject({ state: "LIVE", recoveryStage: "NONE" });
    }

    clock.set(20_001);
    expect(controller.sweep()).toMatchObject({ accountId: CMD, stage: "SOFT", requestedAtMs: 20_001 });
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("publishes a current-generation CMD semantic delta immediately", () => {
    const controller = controllerFor(CMD, 0);
    controller.accept(cmdCatalogEvidence(0, "BASELINE"));

    const decision = controller.accept(cmdCatalogEvidence(1, "DELTA"));

    expect(decision).toMatchObject({ accepted: true,
      publish: { snapshotState: "FRESH", catalog: { observedAtMs: 1 } } });
    expect(controller.snapshot()).toMatchObject({ state: "LIVE", lastDeltaAtMs: 1,
      lastAuthoritativeEvidenceAtMs: 1 });
  });

  it("keeps IM live through its configured sweep-safe window and enforces evidence cadence", () => {
    const policy = policyFor(IM);
    const sweepSafeMs = Math.min(policy.softRecoveryAfterMs, policy.expectedEvidenceCadenceMs);
    const controller = controllerFor(IM, 0);
    expect(controller.accept(imCatalogEvidence(0, "BASELINE")).publish?.snapshotState).toBe("FRESH");

    for (const nowMs of [sweepSafeMs - 5_000, sweepSafeMs - 1, sweepSafeMs]) {
      clock.set(nowMs);
      expect(controller.sweep()).toBeNull();
      expect(controller.read()).toMatchObject({ accountId: IM, observedAtMs: 0 });
      expect(controller.snapshot()).toMatchObject({ state: "LIVE", recoveryStage: "NONE" });
    }

    clock.set(policy.expectedEvidenceCadenceMs + 1);
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "EVIDENCE_CADENCE_EXCEEDED" });
  });

  it("publishes a current-generation IM semantic delta immediately", () => {
    const controller = controllerFor(IM, 0);
    controller.accept(imCatalogEvidence(0, "BASELINE"));

    const decision = controller.accept(imCatalogEvidence(1, "DELTA"));

    expect(decision).toMatchObject({ accepted: true,
      publish: { snapshotState: "FRESH", catalog: { observedAtMs: 1 } } });
    expect(controller.snapshot()).toMatchObject({ state: "LIVE", lastDeltaAtMs: 1,
      lastAuthoritativeEvidenceAtMs: 1 });
  });

  it("does not let IM transport liveness extend the configured maximum baseline age", () => {
    const policy = policyFor(IM);
    const controller = controllerFor(IM, 0);
    controller.accept(imCatalogEvidence(0, "BASELINE"));
    clock.set(policy.expectedEvidenceCadenceMs);
    expect(controller.accept(imTransport(policy.expectedEvidenceCadenceMs))).toMatchObject({ accepted: true });
    expect(controller.read()).toMatchObject({ accountId: IM });

    clock.set(policy.maxBaselineAgeMs + 1);
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "BASELINE_EXPIRED" });
  });

  it("keeps BTI live through its configured sweep-safe window and enforces evidence cadence", () => {
    const policy = policyFor(BTI);
    const sweepSafeMs = Math.min(policy.softRecoveryAfterMs, policy.expectedEvidenceCadenceMs);
    const controller = controllerFor(BTI, 0);
    expect(controller.accept(btiCatalogEvidence(0)).publish?.snapshotState).toBe("FRESH");

    clock.set(sweepSafeMs);
    expect(controller.sweep()).toBeNull();
    expect(controller.read()).toMatchObject({ accountId: BTI, observedAtMs: 0 });
    expect(controller.snapshot()).toMatchObject({ state: "LIVE", recoveryStage: "NONE" });

    clock.set(policy.expectedEvidenceCadenceMs + 1);
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "EVIDENCE_CADENCE_EXCEEDED" });
  });

  it("revokes LIVE and blocks reads when authoritative evidence misses its cadence", () => {
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(1_000 + policyFor(SABA).expectedEvidenceCadenceMs + 1);
    expect(() => controller.read()).toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(controller.snapshot()).toMatchObject({ state: "STALLED", reason: "EVIDENCE_CADENCE_EXCEEDED" });
  });

  it("rejects a delta after its complete baseline has expired", () => {
    const controller = controllerFor(SABA, 1_000);
    const expiredAtMs = 1_000 + policyFor(SABA).maxBaselineAgeMs + 1;
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(expiredAtMs);
    expect(controller.accept(wsDelta(expiredAtMs, "worker-a:0"))).toMatchObject({
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
    const policy = policyFor(SABA);
    const softAtMs = 1_000 + policy.softRecoveryAfterMs + 1;
    const hardAtMs = 1_000 + policy.hardRecoveryAfterMs + 1;
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(softAtMs);
    expect(controller.sweep()).toMatchObject({ stage: "SOFT", attempt: 1, requestedAtMs: softAtMs });
    expect(controller.sweep()).toBeNull();
    clock.set(hardAtMs);
    expect(controller.sweep()).toMatchObject({ stage: "HARD", attempt: 2, requestedAtMs: hardAtMs });
    expect(controller.snapshot()).toMatchObject({ state: "HARD_RECOVERY", recoveryStage: "HARD", recoveryAttempt: 2 });
  });

  it("keeps retrying the hard stage once each cooldown while the source stays dead", () => {
    const policy = policyFor(SABA);
    const softAtMs = 1_000 + policy.softRecoveryAfterMs + 1;
    const hardAtMs = 1_000 + policy.hardRecoveryAfterMs + 1;
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(softAtMs);
    expect(controller.sweep()).toMatchObject({ stage: "SOFT", attempt: 1 });
    clock.set(hardAtMs);
    expect(controller.sweep()).toMatchObject({ stage: "HARD", attempt: 2 });

    // A hard stage that fails leaves the feed dead. Without a further request
    // nothing asks the extension to rebuild the source again, so the provider
    // stays offline until the API process restarts.
    clock.set(hardAtMs + policy.recoveryCooldownMs);
    expect(controller.sweep()).toMatchObject({ stage: "HARD", attempt: 3 });
    expect(controller.snapshot()).toMatchObject({ state: "HARD_RECOVERY", recoveryAttempt: 3 });

    clock.set(hardAtMs + policy.recoveryCooldownMs + 1);
    expect(controller.sweep()).toBeNull();
  });

  it("leaves the hard stage as soon as a fresh baseline arrives", () => {
    const policy = policyFor(SABA);
    const hardAtMs = 1_000 + policy.hardRecoveryAfterMs + 1;
    const controller = controllerFor(SABA, 1_000);
    controller.accept(wsBaseline(1_000, "worker-a:0", "reset-1"));
    clock.set(1_000 + policy.softRecoveryAfterMs + 1);
    controller.sweep();
    clock.set(hardAtMs);
    controller.sweep();
    expect(controller.snapshot()).toMatchObject({ state: "HARD_RECOVERY" });

    controller.accept(wsBaseline(hardAtMs + 500, "worker-a:0", "reset-2"));
    expect(controller.snapshot()).toMatchObject({ state: "LIVE", recoveryStage: "NONE", recoveryAttempt: 0 });
    clock.set(hardAtMs + 500 + policy.recoveryCooldownMs);
    expect(controller.sweep()).toBeNull();
  });

  it("requires a current authoritative baseline before accepting deltas", () => {
    const controller = controllerFor(SABA, 1_000);
    expect(controller.accept(wsDelta(1_000, "worker-a:0"))).toMatchObject({ accepted: false });
    controller.accept(wsBaseline(1_001, "worker-a:0", "reset-1"));
    expect(controller.accept(wsDelta(1_002, "worker-a:0", "reset-2"))).toMatchObject({ accepted: false });
  });
});
