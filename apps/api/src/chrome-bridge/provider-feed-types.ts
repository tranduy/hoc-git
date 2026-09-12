import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export type ProviderFeedState =
  | "STARTING" | "SYNCING" | "LIVE" | "STALLED"
  | "SOFT_RECOVERY" | "HARD_RECOVERY" | "ACTION_REQUIRED";

export type FeedProvenance = "WS" | "AUTHENTICATED_HTTP" | "DOM_FALLBACK" | "RESTORED";

export type ProviderFeedEvidence =
  | { kind: "TAB_REACHABLE"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number }
  | { kind: "TRANSPORT"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number;
      provenance: Exclude<FeedProvenance, "DOM_FALLBACK" | "RESTORED">; providerSequence?: number }
  | { kind: "CATALOG"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number;
      generation: string; mode: "BASELINE" | "DELTA"; provenance: FeedProvenance;
      providerTimestampMs: number | null; catalog: ObservedProviderCatalog }
  | { kind: "INVALIDATE"; accountId: string; sourceId: string; sourceEpoch: string; atMs: number;
      reason: "SOURCE_REPLACED" | "PROVIDER_STREAM_CLOSED" | "PROVIDER_STREAM_GAP" | "SCHEMA_CHANGED" |
        "PROVIDER_PAGE_INVALID" };

export interface ProviderFeedPolicy {
  readonly expectedEvidenceCadenceMs: number;
  readonly catalogFreshnessMs: number;
  readonly maxBaselineAgeMs: number;
  readonly softRecoveryAfterMs: number;
  readonly hardRecoveryAfterMs: number;
  readonly recoveryCooldownMs: number;
  // How long a book with fixtures in play may deliver frames that say nothing.
  // Evidence proves a socket is connected; it does not prove a price arrived,
  // and a heartbeat satisfies every other condition here. APSPORT was measured
  // LIVE on 2026-09-01 with evidence 0s old and no semantic change for 208s -
  // so recovery, which is the only thing that reconnects a source, never ran.
  readonly maxSemanticSilenceMs: number;
  readonly authoritativeProvenance: ReadonlySet<FeedProvenance>;
}

export interface FeedDecision {
  readonly accepted: boolean;
  readonly publish: { readonly catalog: ObservedProviderCatalog; readonly snapshotState: "FRESH" | "STALE" } | null;
  readonly stateChanged: boolean;
}

export interface ProviderRecoveryRequest {
  readonly accountId: string;
  readonly stage: "SOFT" | "HARD";
  readonly attempt: number;
  readonly requestedAtMs: number;
}

export interface ProviderFeedSnapshot {
  readonly accountId: string;
  readonly state: ProviderFeedState;
  readonly reason: string | null;
  readonly sourceId: string | null;
  readonly sourceEpoch: string | null;
  readonly tabReachableAtMs: number | null;
  readonly providerTransportAtMs: number | null;
  readonly lastAuthoritativeEvidenceAtMs: number | null;
  readonly lastCompleteBaselineAtMs: number | null;
  readonly lastDeltaAtMs: number | null;
  readonly lastSemanticChangeAtMs: number | null;
  readonly activeGeneration: string | null;
  readonly recoveryStage: "NONE" | "SOFT" | "HARD";
  readonly recoveryAttempt: number;
}
