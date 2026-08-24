import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeAccumulator, recordRecoveryConfirmation, recordRuntimeSample, resolveAcceptanceBinding,
  runtimeVerdict } from "./provider-runtime-sampler.mjs";

const config = { provider: "SABA", lobby: "SABA", accountId: "catalog-source:SABA:FOOTBALL" };
const binding = { token: "acceptance-token-123456", sourceId: "chrome:SABA:7", tabId: 7,
  buildIdentity: `sha256:${"a".repeat(64)}`, expiresAtMs: 20_000 };
const catalog = { accountId: config.accountId, snapshotState: "FRESH",
  events: [{ providerEventId: "event-1" }], quotes: [{ providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", rawOdds: "0.91", sequence: 1 }] };

function sample(overrides = {}) {
  return { nowMs: 1_000, sources: [{ lobby: "SABA", sourceId: "chrome:SABA:7", state: "LIVE",
    authorityDisposition: "ACTIVE", lastSequence: 1 },
  { lobby: "BTI", sourceId: "chrome:BTI:2", state: "LIVE",
    authorityDisposition: "ACTIVE", lastSequence: 1 }], statuses: [{ id: config.accountId,
    sessionState: "ACTIVE", acquiredAtMs: 1_000, reason: null }], catalog, catalogRevision: "revision-1",
    health: { buildIdentity: binding.buildIdentity }, ...overrides };
}

test("does not confuse bridge LIVE transport with provider authority", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  recordRuntimeSample(result, sample({ sources: [{ lobby: "SABA", sourceId: "chrome:SABA:7",
    state: "LIVE", authorityDisposition: "CANDIDATE", lastSequence: 10 }] }));
  assert.equal(runtimeVerdict(result).passed, false);
  assert.equal(result.authorityActiveSamples, 0);
});

test("requires ACTIVE authority, ACTIVE catalog, nonempty data and three provider evidence advances", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ nowMs: 1_000 + index, statuses: [{ id: config.accountId,
      sessionState: "ACTIVE", acquiredAtMs: 1_000 + index, reason: null }],
      catalogRevision: `revision-${index + 1}` }));
  }
  recordRecoveryConfirmation(result, { sourceId: binding.sourceId, requested: 1, baseline: {
    sourceEpoch: "observer:2", activeGeneration: "saba:stream-2", lastCompleteBaselineAtMs: 2_100
  } }, 2_000, 2_101);
  assert.deepEqual(runtimeVerdict(result), { passed: true, reasons: [] });
  assert.equal(result.providerEvidenceAdvances, 3);
  assert.equal(result.catalogRevisionChanges, 3);
});

test("fails closed when any accepted catalog sample is stale even if the final sample is fresh", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ nowMs: 1_000 + index,
      catalog: { ...catalog, snapshotState: index === 1 ? "STALE" : "FRESH" },
      statuses: [{ id: config.accountId, sessionState: "ACTIVE", acquiredAtMs: 1_000 + index,
        reason: null }] }));
  }
  recordRecoveryConfirmation(result, { sourceId: binding.sourceId, requested: 1, baseline: {
    sourceEpoch: "observer:2", activeGeneration: "saba:stream-2", lastCompleteBaselineAtMs: 2_100
  } }, 2_000, 2_101);
  assert.ok(runtimeVerdict(result).reasons.includes("SAMPLE_INVARIANT_FAILED"));
  assert.equal(result.failedInvariantSamples, 1);
});

test("fails closed on any polling or parsing error instead of trusting the final successful sample", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ nowMs: 1_000 + index,
      statuses: [{ id: config.accountId, sessionState: "ACTIVE", acquiredAtMs: 1_000 + index,
        reason: null }] }));
  }
  result.errors.push("STATUS_HTTP_500_200_200");
  recordRecoveryConfirmation(result, { sourceId: binding.sourceId, requested: 1, baseline: {
    sourceEpoch: "observer:2", activeGeneration: "saba:stream-2", lastCompleteBaselineAtMs: 2_100
  } }, 2_000, 2_101);
  assert.ok(runtimeVerdict(result).reasons.includes("RUNTIME_SAMPLE_ERROR"));
});

test("does not count catalog revision-only churn as provider-native evidence", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ nowMs: 1_000 + index,
      statuses: [{ id: config.accountId, sessionState: "ACTIVE", acquiredAtMs: 1_000, reason: null }],
      catalogRevision: `revision-${index + 1}` }));
  }
  assert.equal(result.catalogRevisionChanges, 3);
  assert.equal(result.providerEvidenceAdvances, 0);
  assert.ok(runtimeVerdict(result).reasons.includes("PROVIDER_EVIDENCE_NOT_ADVANCING"));
});

test("bridge heartbeat sequence changes alone never satisfy realtime evidence", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 5; index += 1) {
    recordRuntimeSample(result, sample({ sources: [{ lobby: "SABA", sourceId: "chrome:SABA:7",
      state: "LIVE", authorityDisposition: "ACTIVE", lastSequence: 10 + index }] }));
  }
  assert.equal(result.sourceSequenceChanges, 4);
  assert.equal(result.providerEvidenceAdvances, 0);
  assert.match(runtimeVerdict(result).reasons.join(","), /PROVIDER_EVIDENCE_NOT_ADVANCING/u);
});

test("records a cross-provider active source identity change during acceptance", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  const initial = sample();
  recordRuntimeSample(result, initial);
  recordRuntimeSample(result, { ...initial, nowMs: 2_000, sources: [initial.sources[0],
    { lobby: "BTI", sourceId: "chrome:BTI:3", state: "LIVE", authorityDisposition: "ACTIVE", lastSequence: 2 }] });
  assert.deepEqual(result.crossProviderSourceChanges, [{ lobby: "BTI", before: "chrome:BTI:2",
    after: "chrome:BTI:3", detectedAtMs: 2_000 }]);
});

test("fails when the BTI regression control is not continuously ACTIVE", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ sources: [sample().sources[0]], nowMs: 1_000 + index,
      statuses: [{ id: config.accountId, sessionState: "ACTIVE", acquiredAtMs: 1_000 + index, reason: null }],
      catalogRevision: `revision-${index + 1}` }));
  }
  assert.match(runtimeVerdict(result).reasons.join(","), /REGRESSION_CONTROL_NOT_ACTIVE/u);
});

test("requires exact-source recovery to return a strictly newer authoritative generation", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  assert.equal(recordRecoveryConfirmation(result, { sourceId: binding.sourceId, requested: 1, baseline: {
    sourceEpoch: "observer:2", activeGeneration: "saba:stream-2", lastCompleteBaselineAtMs: 2_100
  } }, 2_000, 2_101), true);
  assert.equal(result.recoverySucceeded, true);
  assert.equal(result.recoveryBaselineGeneration, "saba:stream-2");

  const wrong = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  assert.equal(recordRecoveryConfirmation(wrong, { sourceId: "chrome:SABA:8", requested: 1, baseline: {
    sourceEpoch: "observer:2", activeGeneration: "saba:stream-2", lastCompleteBaselineAtMs: 2_100
  } }, 2_000, 2_101), false);
  assert.match(runtimeVerdict(wrong).reasons.join(","), /TARGETED_RECOVERY_NOT_CONFIRMED/u);
});

test("pins every sample to the acceptance source instead of another ACTIVE source in the same lobby", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  recordRuntimeSample(result, sample({ sources: [
    { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8, state: "LIVE",
      authorityDisposition: "ACTIVE", lastSequence: 20 },
    { lobby: "SABA", sourceId: binding.sourceId, tabId: binding.tabId, state: "SYNCING",
      authorityDisposition: "CANDIDATE", lastSequence: 2 }
  ] }));
  assert.equal(result.finalSourceId, binding.sourceId);
  assert.ok(runtimeVerdict(result).reasons.includes("AUTHORITY_NOT_ACTIVE"));
});

test("fails acceptance when the running API artifact identity differs from the deployed lease", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ nowMs: 1_000 + index,
      health: { buildIdentity: `sha256:${"b".repeat(64)}` },
      statuses: [{ id: config.accountId, sessionState: "ACTIVE", acquiredAtMs: 1_000 + index, reason: null }],
      catalogRevision: `revision-${index + 1}` }));
  }
  assert.match(runtimeVerdict(result).reasons.join(","), /RUNTIME_BUILD_IDENTITY_MISMATCH/u);
});

test("fails closed when the pinned acceptance lease is lost before the sample ends", () => {
  const result = createRuntimeAccumulator(config, 1_000, 30_000, binding);
  for (let index = 0; index < 4; index += 1) {
    recordRuntimeSample(result, sample({ nowMs: 1_000 + index,
      statuses: [{ id: config.accountId, sessionState: "ACTIVE", acquiredAtMs: 1_000 + index, reason: null }],
      catalogRevision: `revision-${index + 1}` }));
  }
  result.acceptanceLeaseValid = false;
  assert.match(runtimeVerdict(result).reasons.join(","), /ACCEPTANCE_LEASE_LOST/u);
});

test("resolves only one unexpired exact-provider lease pinned to the current artifact", () => {
  const state = { version: 3, deployment: null,
    lastDeployment: { identity: binding.buildIdentity, provider: "CMD", completedAtMs: 900 }, edits: [],
    acceptances: [{ provider: config.provider, worker: "worker-saba", token: binding.token,
      sourceId: binding.sourceId, buildIdentity: binding.buildIdentity, deployedAtMs: 900,
      claimedAtMs: 1_000, expiresAtMs: 20_000 }] };
  assert.deepEqual(resolveAcceptanceBinding(state, config, binding.buildIdentity, 2_000), binding);
  assert.throws(() => resolveAcceptanceBinding(state, config, `sha256:${"b".repeat(64)}`, 2_000),
    /LOCAL_ARTIFACT_IDENTITY_MISMATCH/u);
  assert.throws(() => resolveAcceptanceBinding(state, config, binding.buildIdentity, 20_001),
    /ACCEPTANCE_LEASE_REQUIRED/u);
});
