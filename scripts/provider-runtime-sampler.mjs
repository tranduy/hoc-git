import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FiveProviderCoordinator, computeBuildIdentity } from "./five-provider-coordinator.mjs";

const internalState = new WeakMap();
const buildIdentityPattern = /^sha256:[a-f0-9]{64}$/u;

export function resolveAcceptanceBinding(state, config, localBuildIdentity, nowMs = Date.now()) {
  if (typeof localBuildIdentity !== "string" || !buildIdentityPattern.test(localBuildIdentity) ||
    state?.lastDeployment?.identity !== localBuildIdentity) {
    throw new Error("LOCAL_ARTIFACT_IDENTITY_MISMATCH");
  }
  const leases = Array.isArray(state?.acceptances) ? state.acceptances.filter((lease) =>
    lease?.provider === config.provider && Number.isSafeInteger(lease.expiresAtMs) && lease.expiresAtMs > nowMs) : [];
  if (leases.length !== 1) throw new Error("ACCEPTANCE_LEASE_REQUIRED");
  const lease = leases[0];
  const expectedPrefix = `chrome:${config.lobby}:`;
  const tabId = sourceIdTab(lease.sourceId);
  if (typeof lease.token !== "string" || lease.token.length < 16 ||
    typeof lease.sourceId !== "string" || !lease.sourceId.startsWith(expectedPrefix) ||
    tabId === null || lease.sourceId !== `${expectedPrefix}${tabId}` ||
    lease.buildIdentity !== localBuildIdentity ||
    lease.deployedAtMs !== state.lastDeployment.completedAtMs) {
    throw new Error("ACCEPTANCE_LEASE_INVALID");
  }
  return { token: lease.token, sourceId: lease.sourceId, tabId, buildIdentity: lease.buildIdentity,
    expiresAtMs: lease.expiresAtMs };
}

export function createRuntimeAccumulator(config, startedAtMs, durationMs, binding = null) {
  const result = {
    provider: config.provider,
    lobby: config.lobby,
    accountId: config.accountId,
    acceptanceToken: binding?.token ?? null,
    expectedSourceId: binding?.sourceId ?? null,
    expectedTabId: binding?.tabId ?? null,
    buildIdentity: binding?.buildIdentity ?? null,
    acceptanceLeaseValid: binding !== null,
    requiredControlLobbies: config.requiredControlLobbies ?? ["BTI"],
    regressionControlMissingSamples: 0,
    recoveryRequestedAtMs: null,
    recoveryCompletedAtMs: null,
    recoverySucceeded: false,
    recoverySourceEpoch: null,
    recoveryBaselineGeneration: null,
    recoveryBaselineAtMs: null,
    startedAtMs,
    durationMs,
    samples: 0,
    transportLiveSamples: 0,
    authorityActiveSamples: 0,
    catalogActiveSamples: 0,
    freshCatalogSamples: 0,
    acceptedRealtimeSamples: 0,
    failedInvariantSamples: 0,
    catalogAvailableSamples: 0,
    firstSourceSequence: null,
    lastSourceSequence: null,
    sourceSequenceChanges: 0,
    firstCatalogRevision: null,
    lastCatalogRevision: null,
    catalogRevisionChanges: 0,
    firstProviderEvidenceAtMs: null,
    lastProviderEvidenceAtMs: null,
    providerEvidenceAdvances: 0,
    firstEventCount: null,
    minEventCount: null,
    lastEventCount: null,
    finalAuthorityDisposition: null,
    finalSourceId: null,
    finalTabId: null,
    finalBridgeState: null,
    finalCatalogState: null,
    finalCatalogReason: null,
    finalCatalogSnapshotState: null,
    finalRuntimeBuildIdentity: null,
    realtimeRevisions: 0,
    quoteChanges: [],
    sampleInvariantFailures: [],
    crossProviderSourceChanges: [],
    errors: []
  };
  internalState.set(result, { priorSourceSequence: null, priorRevision: null, priorEvidenceAtMs: null,
    prices: new Map(), otherActiveSources: null });
  return result;
}

export function recordRuntimeSample(result, sample) {
  const state = internalState.get(result);
  if (state === undefined) throw new Error("UNKNOWN_RUNTIME_ACCUMULATOR");
  const source = sample.sources.find((candidate) => result.expectedSourceId === null
    ? candidate.lobby === result.lobby
    : candidate.sourceId === result.expectedSourceId && candidate.lobby === result.lobby) ?? null;
  const status = sample.statuses.find((candidate) => candidate.id === result.accountId) ?? null;
  const eventCount = Array.isArray(sample.catalog?.events) ? sample.catalog.events.length : null;
  const revision = typeof sample.catalogRevision === "string" ? sample.catalogRevision : null;
  const evidenceAtMs = typeof status?.acquiredAtMs === "number" ? status.acquiredAtMs : null;
  const snapshotState = sample.catalog?.snapshotState ?? null;
  const runtimeBuildIdentity = typeof sample.health?.buildIdentity === "string"
    ? sample.health.buildIdentity : null;
  const btiActive = result.requiredControlLobbies.every((lobby) => sample.sources.some((candidate) =>
    candidate.lobby === lobby && candidate.state === "LIVE" &&
    candidate.authorityDisposition === "ACTIVE"));

  result.samples += 1;
  result.finalAuthorityDisposition = source?.authorityDisposition ?? null;
  result.finalSourceId = source?.sourceId ?? null;
  result.finalTabId = Number.isSafeInteger(source?.tabId) ? source.tabId : sourceIdTab(source?.sourceId);
  result.finalBridgeState = source?.state ?? null;
  result.finalCatalogState = status?.sessionState ?? null;
  result.finalCatalogReason = status?.reason ?? null;
  result.finalCatalogSnapshotState = snapshotState;
  result.finalRuntimeBuildIdentity = runtimeBuildIdentity;
  if (source?.state === "LIVE") result.transportLiveSamples += 1;
  if (source?.authorityDisposition === "ACTIVE") result.authorityActiveSamples += 1;
  if (status?.sessionState === "ACTIVE" && status.reason === null) result.catalogActiveSamples += 1;
  if (snapshotState === "FRESH") result.freshCatalogSamples += 1;
  if (eventCount !== null) result.catalogAvailableSamples += 1;
  if (!btiActive) result.regressionControlMissingSamples += 1;
  const invariantFailures = [];
  if (source?.sourceId !== result.expectedSourceId ||
    (Number.isSafeInteger(source?.tabId) ? source.tabId : sourceIdTab(source?.sourceId)) !== result.expectedTabId) {
    invariantFailures.push("PINNED_SOURCE_NOT_ATTACHED");
  }
  if (source?.state !== "LIVE") invariantFailures.push("BRIDGE_NOT_LIVE");
  if (source?.authorityDisposition !== "ACTIVE") invariantFailures.push("AUTHORITY_NOT_ACTIVE");
  if (status?.sessionState !== "ACTIVE" || status.reason !== null) invariantFailures.push("CATALOG_NOT_ACTIVE");
  if (snapshotState !== "FRESH") invariantFailures.push("CATALOG_NOT_FRESH");
  if (sample.catalog?.accountId !== result.accountId) invariantFailures.push("CATALOG_ACCOUNT_MISMATCH");
  if (!(eventCount > 0)) invariantFailures.push("CATALOG_EMPTY_OR_UNAVAILABLE");
  if (runtimeBuildIdentity !== result.buildIdentity) invariantFailures.push("RUNTIME_BUILD_IDENTITY_MISMATCH");
  if (!btiActive) invariantFailures.push("REGRESSION_CONTROL_NOT_ACTIVE");
  if (invariantFailures.length === 0) result.acceptedRealtimeSamples += 1;
  else {
    result.failedInvariantSamples += 1;
    if (result.sampleInvariantFailures.length < 50) {
      result.sampleInvariantFailures.push({ detectedAtMs: sample.nowMs, reasons: invariantFailures });
    }
  }

  const sequence = Number.isSafeInteger(source?.lastSequence) ? source.lastSequence : null;
  result.firstSourceSequence ??= sequence;
  result.lastSourceSequence = sequence ?? result.lastSourceSequence;
  if (state.priorSourceSequence !== null && sequence !== null && sequence > state.priorSourceSequence) {
    result.sourceSequenceChanges += 1;
  }
  state.priorSourceSequence = sequence;

  result.firstCatalogRevision ??= revision;
  if (state.priorRevision !== null && revision !== null && revision !== state.priorRevision) {
    result.catalogRevisionChanges += 1;
  }
  result.lastCatalogRevision = revision ?? result.lastCatalogRevision;
  state.priorRevision = revision;
  result.firstProviderEvidenceAtMs ??= evidenceAtMs;
  if (state.priorEvidenceAtMs !== null && evidenceAtMs !== null && evidenceAtMs > state.priorEvidenceAtMs) {
    result.providerEvidenceAdvances += 1;
  }
  result.lastProviderEvidenceAtMs = evidenceAtMs ?? result.lastProviderEvidenceAtMs;
  state.priorEvidenceAtMs = evidenceAtMs;

  if (eventCount !== null) {
    result.firstEventCount ??= eventCount;
    result.minEventCount = result.minEventCount === null ? eventCount : Math.min(result.minEventCount, eventCount);
    result.lastEventCount = eventCount;
  }
  for (const quote of Array.isArray(sample.catalog?.quotes) ? sample.catalog.quotes : []) {
    const key = [quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join("|");
    const prior = state.prices.get(key);
    const current = { rawOdds: quote.rawOdds, status: quote.status ?? null, sequence: quote.sequence ?? null };
    if (prior !== undefined && (prior.rawOdds !== current.rawOdds || prior.status !== current.status) &&
      result.quoteChanges.length < 50) {
      result.quoteChanges.push({ key, before: { rawOdds: prior.rawOdds, status: prior.status },
        after: { rawOdds: current.rawOdds, status: current.status }, beforeSequence: prior.sequence,
        afterSequence: current.sequence, detectedAtMs: sample.nowMs });
    }
    state.prices.set(key, current);
  }

  const otherActiveSources = new Map(sample.sources.filter((candidate) => candidate.lobby !== result.lobby &&
    candidate.authorityDisposition === "ACTIVE").map((candidate) => [candidate.lobby, candidate.sourceId]));
  if (state.otherActiveSources !== null) {
    const lobbies = new Set([...state.otherActiveSources.keys(), ...otherActiveSources.keys()]);
    for (const lobby of lobbies) {
      const before = state.otherActiveSources.get(lobby) ?? null;
      const after = otherActiveSources.get(lobby) ?? null;
      if (before !== after && !result.crossProviderSourceChanges.some((change) => change.lobby === lobby &&
        change.before === before && change.after === after)) {
        result.crossProviderSourceChanges.push({ lobby, before, after, detectedAtMs: sample.nowMs });
      }
    }
  }
  state.otherActiveSources = otherActiveSources;
}

export function recordRecoveryConfirmation(result, confirmation, requestedAtMs, completedAtMs) {
  result.recoveryRequestedAtMs = requestedAtMs;
  result.recoveryCompletedAtMs = completedAtMs;
  const baseline = confirmation?.baseline;
  const valid = confirmation?.sourceId === result.expectedSourceId && confirmation?.requested === 1 &&
    typeof baseline?.sourceEpoch === "string" && baseline.sourceEpoch.length > 0 &&
    typeof baseline?.activeGeneration === "string" && baseline.activeGeneration.length > 0 &&
    Number.isSafeInteger(baseline?.lastCompleteBaselineAtMs) &&
    baseline.lastCompleteBaselineAtMs > requestedAtMs &&
    Number.isSafeInteger(completedAtMs) && completedAtMs >= baseline.lastCompleteBaselineAtMs;
  if (!valid) return false;
  result.recoverySucceeded = true;
  result.recoverySourceEpoch = baseline.sourceEpoch;
  result.recoveryBaselineGeneration = baseline.activeGeneration;
  result.recoveryBaselineAtMs = baseline.lastCompleteBaselineAtMs;
  return true;
}

export function runtimeVerdict(result) {
  const reasons = [];
  if (result.samples === 0) reasons.push("NO_SAMPLES");
  if (result.errors.length > 0) reasons.push("RUNTIME_SAMPLE_ERROR");
  if (result.failedInvariantSamples > 0 || result.acceptedRealtimeSamples !== result.samples) {
    reasons.push("SAMPLE_INVARIANT_FAILED");
  }
  if (result.expectedSourceId === null || result.expectedTabId === null || result.buildIdentity === null) {
    reasons.push("ACCEPTANCE_NOT_PINNED");
  }
  if (result.finalSourceId !== result.expectedSourceId || result.finalTabId !== result.expectedTabId) {
    reasons.push("PINNED_SOURCE_NOT_ATTACHED");
  }
  if (result.finalRuntimeBuildIdentity !== result.buildIdentity) {
    reasons.push("RUNTIME_BUILD_IDENTITY_MISMATCH");
  }
  if (result.acceptanceLeaseValid !== true) reasons.push("ACCEPTANCE_LEASE_LOST");
  if (result.finalAuthorityDisposition !== "ACTIVE") reasons.push("AUTHORITY_NOT_ACTIVE");
  if (result.finalBridgeState !== "LIVE") reasons.push("BRIDGE_NOT_LIVE");
  if (result.finalCatalogState !== "ACTIVE" || result.finalCatalogReason !== null) {
    reasons.push("CATALOG_NOT_ACTIVE");
  }
  if (result.finalCatalogSnapshotState !== "FRESH") reasons.push("CATALOG_NOT_FRESH");
  if (!(result.lastEventCount > 0)) reasons.push("CATALOG_EMPTY_OR_UNAVAILABLE");
  if (result.providerEvidenceAdvances < 3) reasons.push("PROVIDER_EVIDENCE_NOT_ADVANCING");
  if (result.regressionControlMissingSamples > 0) reasons.push("REGRESSION_CONTROL_NOT_ACTIVE");
  if (result.recoverySucceeded !== true) reasons.push("TARGETED_RECOVERY_NOT_CONFIRMED");
  if (result.crossProviderSourceChanges.length > 0) reasons.push("CROSS_PROVIDER_SOURCE_CHANGED");
  return { passed: reasons.length === 0, reasons };
}

export async function runProviderRuntimeVerification(config, options = {}) {
  const baseUrl = process.env.TOOL_CHENH_API_URL ?? "http://127.0.0.1:4310";
  const durationMs = Math.max(120_000, Number(options.durationMs ?? 600_000));
  const outputPath = options.outputPath ?? `${config.provider.toLowerCase()}-runtime-evidence.json`;
  const repositoryRoot = options.repositoryRoot === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), "..")
    : resolve(options.repositoryRoot);
  const coordinator = options.coordinator ?? new FiveProviderCoordinator({
    root: resolve(repositoryRoot, ".run", "five-provider")
  });
  const localBuildIdentity = await (options.computeBuildIdentity ?? computeBuildIdentity)(repositoryRoot);
  const binding = resolveAcceptanceBinding(await coordinator.status(), config, localBuildIdentity);
  const startedAtMs = Date.now();
  if (!Number.isFinite(durationMs) || startedAtMs + durationMs >= binding.expiresAtMs) {
    throw new Error("ACCEPTANCE_WINDOW_TOO_SHORT");
  }
  const result = createRuntimeAccumulator(config, startedAtMs, durationMs, binding);
  const deadlineMs = result.startedAtMs + durationMs;
  const socket = new WebSocket(baseUrl.replace(/^http/u, "ws") + "/api/realtime");
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === "CATALOG_REVISION" && message.accountId === config.accountId) {
        result.realtimeRevisions += 1;
      }
    } catch (error) { result.errors.push(safeError(error)); }
  });
  socket.addEventListener("error", () => result.errors.push("WEBSOCKET_ERROR"));
  let recoveryPromise = null;

  while (Date.now() < deadlineMs) {
    try {
      const [sourcesResponse, statusesResponse, catalogResponse, healthResponse] = await Promise.all([
        fetch(baseUrl + "/api/chrome-bridge/sources", { cache: "no-store" }),
        fetch(baseUrl + "/api/catalog/sources", { cache: "no-store" }),
        fetch(baseUrl + "/api/catalog/accounts/" + encodeURIComponent(config.accountId), { cache: "no-store" }),
        fetch(baseUrl + "/api/health", { cache: "no-store" })
      ]);
      if (!sourcesResponse.ok || !statusesResponse.ok || !healthResponse.ok) {
        throw new Error(`STATUS_HTTP_${sourcesResponse.status}_${statusesResponse.status}_${healthResponse.status}`);
      }
      const sources = await sourcesResponse.json();
      const statuses = await statusesResponse.json();
      const catalog = catalogResponse.ok ? await catalogResponse.json() : null;
      const health = await healthResponse.json();
      if (!catalogResponse.ok) result.errors.push(`CATALOG_HTTP_${catalogResponse.status}`);
      recordRuntimeSample(result, { nowMs: Date.now(), sources: sources.sources ?? [],
        statuses: statuses.sources ?? [], catalog, health,
        catalogRevision: catalogResponse.headers.get("x-catalog-revision") });
      if (recoveryPromise === null && result.acceptedRealtimeSamples > 0 &&
        Date.now() - result.startedAtMs >= 5_000) {
        const requestedAtMs = Date.now();
        result.recoveryRequestedAtMs = requestedAtMs;
        recoveryPromise = fetch(baseUrl + "/api/chrome-bridge/request-snapshot", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: binding.sourceId })
        }).then(async (response) => {
          const confirmation = await response.json();
          if (!response.ok || !recordRecoveryConfirmation(result, confirmation, requestedAtMs, Date.now())) {
            throw new Error(`TARGETED_RECOVERY_HTTP_${response.status}`);
          }
        }).catch((error) => { result.errors.push(safeError(error)); });
      }
    } catch (error) { result.errors.push(safeError(error)); }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  await recoveryPromise;
  socket.close();
  result.finishedAtMs = Date.now();
  try {
    const finalBuildIdentity = await (options.computeBuildIdentity ?? computeBuildIdentity)(repositoryRoot);
    const finalBinding = resolveAcceptanceBinding(await coordinator.status(), config, finalBuildIdentity);
    result.acceptanceLeaseValid = finalBinding.token === binding.token &&
      finalBinding.sourceId === binding.sourceId && finalBinding.buildIdentity === binding.buildIdentity;
  } catch (error) {
    result.acceptanceLeaseValid = false;
    result.errors.push(safeError(error));
  }
  result.verdict = runtimeVerdict(result);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.verdict.passed) process.exitCode = 1;
  return result;
}

function safeError(error) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}

function sourceIdTab(sourceId) {
  if (typeof sourceId !== "string") return null;
  const value = Number(sourceId.split(":").at(-1));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
