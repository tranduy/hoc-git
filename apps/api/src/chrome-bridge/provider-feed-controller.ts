import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { FeedDecision, FeedProvenance, ProviderFeedEvidence, ProviderFeedPolicy, ProviderFeedSnapshot,
  ProviderRecoveryRequest, ProviderFeedState } from "./provider-feed-types.js";

export interface ProviderFeedControllerOptions {
  readonly accountId: string;
  readonly policy: ProviderFeedPolicy;
  readonly now?: () => number;
}

export class ProviderFeedController {
  readonly #accountId: string;
  readonly #policy: ProviderFeedPolicy;
  readonly #now: () => number;
  readonly #startedAtMs: number;
  readonly #retiredEpochs = new Set<string>();
  #state: ProviderFeedState = "STARTING";
  #reason: string | null = null;
  #latestCatalog: ObservedProviderCatalog | null = null;
  #authoritativeCatalog: ObservedProviderCatalog | null = null;
  #sourceId: string | null = null;
  #sourceEpoch: string | null = null;
  #tabReachableAtMs: number | null = null;
  #providerTransportAtMs: number | null = null;
  #lastAuthoritativeEvidenceAtMs: number | null = null;
  #lastCompleteBaselineAtMs: number | null = null;
  #lastDeltaAtMs: number | null = null;
  #lastSemanticChangeAtMs: number | null = null;
  #activeGeneration: string | null = null;
  #recoveryStage: "NONE" | "SOFT" | "HARD" = "NONE";
  #recoveryAttempt = 0;
  #lastRecoveryRequestedAtMs: number | null = null;

  constructor(options: ProviderFeedControllerOptions) {
    if (options.accountId.length === 0 || !validPolicy(options.policy)) throw new Error("PROVIDER_FEED_OPTIONS_INVALID");
    this.#accountId = options.accountId;
    this.#policy = options.policy;
    this.#now = options.now ?? Date.now;
    this.#startedAtMs = this.#now();
  }

  accept(evidence: ProviderFeedEvidence): FeedDecision {
    if (evidence.accountId !== this.#accountId || !validEvidence(evidence) || this.#isRetired(evidence)) return rejected();
    const stateBefore = this.#state;
    const reasonBefore = this.#reason;
    const result = this.#acceptEvidence(evidence);
    if (!result.accepted) return { ...result, stateChanged: stateBefore !== this.#state || reasonBefore !== this.#reason };
    return { ...result, stateChanged: result.stateChanged ||
      stateBefore !== this.#state || reasonBefore !== this.#reason };
  }

  restore(catalog: ObservedProviderCatalog): FeedDecision {
    if (catalog.accountId !== this.#accountId) return rejected();
    const stateBefore = this.#state;
    const reasonBefore = this.#reason;
    this.#latestCatalog = catalog;
    this.#authoritativeCatalog = null;
    this.#lastAuthoritativeEvidenceAtMs = null;
    this.#lastCompleteBaselineAtMs = null;
    this.#lastDeltaAtMs = null;
    this.#activeGeneration = null;
    this.#recoveryStage = "NONE";
    this.#lastRecoveryRequestedAtMs = null;
    this.#transition("SYNCING", "BASELINE_REQUIRED");
    return { accepted: true, publish: { catalog, snapshotState: "STALE" },
      stateChanged: stateBefore !== this.#state || reasonBefore !== this.#reason };
  }

  sweep(nowMs = this.#now()): ProviderRecoveryRequest | null {
    if (!Number.isFinite(nowMs)) return null;
    if (this.#state === "LIVE" && !this.#livePrerequisitesSatisfied(nowMs)) {
      this.#transition("STALLED", this.#liveFailureReason(nowMs));
    }
    const stale = this.#authorityAgeMs(nowMs) > this.#policy.softRecoveryAfterMs || this.#baselineExpired(nowMs);
    if (["STARTING", "SYNCING", "STALLED", "LIVE"].includes(this.#state)) {
      if (!stale || !this.#canRequestRecovery(nowMs)) return null;
      this.#recoveryStage = "SOFT";
      this.#transition("SOFT_RECOVERY", "RECOVERY_SOFT");
      return this.#requestRecovery("SOFT", nowMs);
    }
    if (this.#state !== "SOFT_RECOVERY" || this.#authorityAgeMs(nowMs) <= this.#policy.hardRecoveryAfterMs ||
      !this.#canRequestRecovery(nowMs)) return null;
    this.#recoveryStage = "HARD";
    this.#transition("HARD_RECOVERY", "RECOVERY_HARD");
    return this.#requestRecovery("HARD", nowMs);
  }

  read(): ObservedProviderCatalog {
    const nowMs = this.#now();
    if (this.#state === "LIVE" && !this.#livePrerequisitesSatisfied(nowMs)) {
      this.#transition("STALLED", this.#liveFailureReason(nowMs));
    }
    if (this.#state !== "LIVE" || this.#authoritativeCatalog === null) throw new Error("PROVIDER_FEED_NOT_LIVE");
    return this.#authoritativeCatalog;
  }

  snapshot(): ProviderFeedSnapshot {
    return { accountId: this.#accountId, state: this.#state, reason: this.#reason,
      sourceId: this.#sourceId, sourceEpoch: this.#sourceEpoch, tabReachableAtMs: this.#tabReachableAtMs,
      providerTransportAtMs: this.#providerTransportAtMs,
      lastAuthoritativeEvidenceAtMs: this.#lastAuthoritativeEvidenceAtMs,
      lastCompleteBaselineAtMs: this.#lastCompleteBaselineAtMs, lastDeltaAtMs: this.#lastDeltaAtMs,
      lastSemanticChangeAtMs: this.#lastSemanticChangeAtMs, activeGeneration: this.#activeGeneration,
      recoveryStage: this.#recoveryStage, recoveryAttempt: this.#recoveryAttempt };
  }

  #acceptEvidence(evidence: ProviderFeedEvidence): FeedDecision {
    switch (evidence.kind) {
      case "TAB_REACHABLE":
        if (!this.#acceptSource(evidence.sourceId, evidence.sourceEpoch)) return rejected();
        this.#tabReachableAtMs = evidence.atMs;
        if (this.#state === "STARTING") this.#transition("SYNCING", "BASELINE_REQUIRED");
        return accepted();
      case "TRANSPORT":
        if (!this.#acceptSource(evidence.sourceId, evidence.sourceEpoch)) return rejected();
        this.#providerTransportAtMs = evidence.atMs;
        if (this.#state === "STARTING") this.#transition("SYNCING", "BASELINE_REQUIRED");
        if (this.#authoritativeCatalog !== null && this.#isAuthoritative(evidence.provenance) &&
          !this.#baselineExpired(evidence.atMs)) this.#lastAuthoritativeEvidenceAtMs = evidence.atMs;
        return accepted();
      case "CATALOG":
        return this.#acceptCatalog(evidence);
      case "INVALIDATE":
        if (!this.#matchesCurrentSource(evidence.sourceId, evidence.sourceEpoch)) return rejected();
        return this.#invalidate(evidence);
    }
  }

  #acceptCatalog(evidence: Extract<ProviderFeedEvidence, { readonly kind: "CATALOG" }>): FeedDecision {
    if (evidence.catalog.accountId !== this.#accountId) return rejected();
    if (!this.#isAuthoritative(evidence.provenance)) {
      if (!this.#acceptSource(evidence.sourceId, evidence.sourceEpoch)) return rejected();
      this.#latestCatalog = evidence.catalog;
      this.#lastSemanticChangeAtMs = evidence.atMs;
      if (this.#state === "STARTING") this.#transition("SYNCING", "BASELINE_REQUIRED");
      return { accepted: true, publish: { catalog: evidence.catalog, snapshotState: "STALE" }, stateChanged: false };
    }
    if (evidence.mode === "BASELINE") {
      if (!this.#acceptSource(evidence.sourceId, evidence.sourceEpoch)) return rejected();
      this.#latestCatalog = evidence.catalog;
      this.#authoritativeCatalog = evidence.catalog;
      this.#lastAuthoritativeEvidenceAtMs = evidence.atMs;
      this.#lastCompleteBaselineAtMs = evidence.atMs;
      this.#lastDeltaAtMs = null;
      this.#lastSemanticChangeAtMs = evidence.atMs;
      this.#activeGeneration = evidence.generation;
      this.#recoveryStage = "NONE";
      this.#recoveryAttempt = 0;
      this.#lastRecoveryRequestedAtMs = null;
      this.#transition("LIVE", null);
      return { accepted: true, publish: { catalog: evidence.catalog, snapshotState: "FRESH" }, stateChanged: false };
    }
    if (this.#authoritativeCatalog === null || !this.#matchesCurrentSource(evidence.sourceId, evidence.sourceEpoch) ||
      evidence.generation !== this.#activeGeneration ||
      (this.#lastAuthoritativeEvidenceAtMs !== null && evidence.atMs < this.#lastAuthoritativeEvidenceAtMs)) return rejected();
    if (this.#baselineExpired(evidence.atMs)) {
      if (this.#state === "LIVE") this.#transition("STALLED", "BASELINE_EXPIRED");
      return rejected();
    }
    this.#latestCatalog = evidence.catalog;
    this.#authoritativeCatalog = evidence.catalog;
    this.#lastAuthoritativeEvidenceAtMs = evidence.atMs;
    this.#lastDeltaAtMs = evidence.atMs;
    this.#lastSemanticChangeAtMs = evidence.atMs;
    return { accepted: true, publish: { catalog: evidence.catalog, snapshotState: "FRESH" }, stateChanged: false };
  }

  #invalidate(evidence: Extract<ProviderFeedEvidence, { readonly kind: "INVALIDATE" }>): FeedDecision {
    this.#retiredEpochs.add(epochKey(evidence.sourceId, evidence.sourceEpoch));
    this.#sourceId = null;
    this.#sourceEpoch = null;
    this.#authoritativeCatalog = null;
    this.#lastAuthoritativeEvidenceAtMs = null;
    this.#lastCompleteBaselineAtMs = null;
    this.#lastDeltaAtMs = null;
    this.#activeGeneration = null;
    this.#recoveryStage = "NONE";
    this.#lastRecoveryRequestedAtMs = null;
    const next = evidence.reason === "SCHEMA_CHANGED" ? "ACTION_REQUIRED" :
      evidence.reason === "SOURCE_REPLACED" ? "SYNCING" : "STALLED";
    const reason = evidence.reason === "SOURCE_REPLACED" ? "BASELINE_REQUIRED" : evidence.reason;
    this.#transition(next, reason);
    return { accepted: true, publish: this.#latestCatalog === null ? null :
      { catalog: this.#latestCatalog, snapshotState: "STALE" }, stateChanged: false };
  }

  #transition(state: ProviderFeedState, reason: string | null): void {
    this.#state = state;
    this.#reason = reason;
  }

  #acceptSource(sourceId: string, sourceEpoch: string): boolean {
    if (this.#sourceId === null && this.#sourceEpoch === null) {
      this.#sourceId = sourceId;
      this.#sourceEpoch = sourceEpoch;
      return true;
    }
    return this.#matchesCurrentSource(sourceId, sourceEpoch);
  }

  #matchesCurrentSource(sourceId: string, sourceEpoch: string): boolean {
    return this.#sourceId === sourceId && this.#sourceEpoch === sourceEpoch;
  }

  #isRetired(evidence: ProviderFeedEvidence): boolean {
    return this.#retiredEpochs.has(epochKey(evidence.sourceId, evidence.sourceEpoch));
  }

  #isAuthoritative(provenance: FeedProvenance): boolean {
    return this.#policy.authoritativeProvenance.has(provenance);
  }

  #authorityAgeMs(nowMs: number): number {
    return nowMs - (this.#lastAuthoritativeEvidenceAtMs ?? this.#startedAtMs);
  }

  #baselineExpired(nowMs: number): boolean {
    return this.#lastCompleteBaselineAtMs === null || nowMs - this.#lastCompleteBaselineAtMs > this.#policy.maxBaselineAgeMs;
  }

  #livePrerequisitesSatisfied(nowMs: number): boolean {
    return this.#authoritativeCatalog !== null && !this.#baselineExpired(nowMs) &&
      this.#authorityAgeMs(nowMs) <= this.#policy.expectedEvidenceCadenceMs;
  }

  #liveFailureReason(nowMs: number): "BASELINE_EXPIRED" | "EVIDENCE_CADENCE_EXCEEDED" {
    return this.#baselineExpired(nowMs) ? "BASELINE_EXPIRED" : "EVIDENCE_CADENCE_EXCEEDED";
  }

  #canRequestRecovery(nowMs: number): boolean {
    return this.#lastRecoveryRequestedAtMs === null || nowMs - this.#lastRecoveryRequestedAtMs >= this.#policy.recoveryCooldownMs;
  }

  #requestRecovery(stage: "SOFT" | "HARD", requestedAtMs: number): ProviderRecoveryRequest {
    this.#lastRecoveryRequestedAtMs = requestedAtMs;
    this.#recoveryAttempt += 1;
    return { accountId: this.#accountId, stage, attempt: this.#recoveryAttempt, requestedAtMs };
  }
}

function validPolicy(policy: ProviderFeedPolicy): boolean {
  return [policy.expectedEvidenceCadenceMs, policy.maxBaselineAgeMs, policy.softRecoveryAfterMs,
    policy.hardRecoveryAfterMs, policy.recoveryCooldownMs].every((value) => Number.isFinite(value) && value > 0);
}

function validEvidence(evidence: ProviderFeedEvidence): boolean {
  return evidence.sourceId.length > 0 && evidence.sourceEpoch.length > 0 && Number.isFinite(evidence.atMs) && evidence.atMs >= 0;
}

function epochKey(sourceId: string, sourceEpoch: string): string {
  return `${sourceId}\u0000${sourceEpoch}`;
}

function accepted(): FeedDecision {
  return { accepted: true, publish: null, stateChanged: false };
}

function rejected(): FeedDecision {
  return { accepted: false, publish: null, stateChanged: false };
}
