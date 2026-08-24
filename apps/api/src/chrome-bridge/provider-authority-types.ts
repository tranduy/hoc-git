import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { ChromeBridgeProviderAccountId } from "./chrome-bridge-account.js";
import type { ProviderFeedEvidence } from "./provider-feed-types.js";

export interface AuthorityIdentity {
  readonly accountId: ChromeBridgeProviderAccountId;
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly connectionGeneration: number;
}

export interface AuthorityCandidateToken {
  readonly accountId: ChromeBridgeProviderAccountId;
  readonly nonce: number;
}

export interface AuthorityLaneToken {
  readonly accountId: ChromeBridgeProviderAccountId;
  readonly nonce: number;
  readonly phase: "ACTIVE" | "CANDIDATE";
}

export type AuthorityEvidenceClass = "REPLAY" | "TRANSPORT" | "CANDIDATE_DATA";
export type CatalogEmptyProof = "NONEMPTY" | "PROVIDER_CONFIRMED_EMPTY";
export type ProviderFeedInvalidationReason = Extract<
  ProviderFeedEvidence,
  { readonly kind: "INVALIDATE" }
>["reason"];

export interface CatalogCommitProof {
  readonly authorityCursor: bigint;
  readonly provenance: "WS" | "AUTHENTICATED_HTTP";
  readonly contentClass: "FOOTBALL";
  readonly completeness: "COMPLETE";
  readonly scope: "ACCOUNT" | "PROVIDER_PARTITION" | "SABA_CHANNEL";
  readonly completedPartitions: readonly string[];
  readonly emptyProof: CatalogEmptyProof;
  readonly catalog: ObservedProviderCatalog;
}

export type AuthorityObservation =
  | {
      readonly disposition: "ACTIVE";
      readonly token: null;
      readonly laneToken: AuthorityLaneToken;
      readonly reason: null;
    }
  | {
      readonly disposition: "CANDIDATE";
      readonly token: AuthorityCandidateToken;
      readonly laneToken: AuthorityLaneToken;
      readonly reason: null;
      readonly retiredCandidateLaneToken?: AuthorityLaneToken;
    }
  | {
      readonly disposition: "REJECTED";
      readonly token: null;
      readonly laneToken: null;
      readonly reason:
        | "REPLAY_DIAGNOSTIC_ONLY"
        | "RETIRED_AUTHORITY_IDENTITY"
        | "AUTHORITY_IDENTITY_INVALID";
    };

export interface AuthoritySlotSnapshot {
  readonly accountId: ChromeBridgeProviderAccountId;
  readonly active: AuthorityIdentity | null;
  readonly candidate: AuthorityIdentity | null;
  readonly activeLaneToken: AuthorityLaneToken | null;
  readonly candidateLaneToken: AuthorityLaneToken | null;
  readonly candidateToken: AuthorityCandidateToken | null;
}

export type AuthorityPromotion =
  | {
      readonly promoted: true;
      readonly reason: null;
      readonly accountId: ChromeBridgeProviderAccountId;
      readonly previousActive: AuthorityIdentity | null;
      readonly active: AuthorityIdentity;
      readonly previousActiveLaneToken: AuthorityLaneToken | null;
      readonly candidateLaneToken: AuthorityLaneToken;
      readonly activeLaneToken: AuthorityLaneToken;
      readonly proof: CatalogCommitProof;
    }
  | {
      readonly promoted: false;
      readonly reason: "STALE_CANDIDATE_TOKEN" | "PROOF_INVALID" | "PROOF_ACCOUNT_MISMATCH" |
        "PROMOTION_TRANSACTION_FAILED";
    };

export type AuthorityDecision =
  | { readonly accepted: true; readonly disposition: "ACTIVE" | "CANDIDATE" }
  | { readonly accepted: false; readonly disposition: "REJECTED" };

export type AuthorityReleaseDecision =
  | { readonly changed: true; readonly disposition: "CANDIDATE"; readonly retiredLaneToken: AuthorityLaneToken }
  | { readonly changed: false; readonly disposition: "ACTIVE" | "REJECTED" };

export type AuthorityTransition =
  | {
      readonly kind: "CANDIDATE_REPLACED";
      readonly accountId: ChromeBridgeProviderAccountId;
      readonly retiredIdentity: AuthorityIdentity;
      readonly retiredLaneToken: AuthorityLaneToken;
      readonly candidate: AuthorityIdentity;
      readonly candidateLaneToken: AuthorityLaneToken;
    }
  | {
      readonly kind: "CANDIDATE_RELEASED";
      readonly accountId: ChromeBridgeProviderAccountId;
      readonly retiredIdentity: AuthorityIdentity;
      readonly retiredLaneToken: AuthorityLaneToken;
    }
  | {
      readonly kind: "ACTIVE_TRANSPORT_RELEASED";
      readonly accountId: ChromeBridgeProviderAccountId;
      readonly active: AuthorityIdentity;
      readonly activeLaneToken: AuthorityLaneToken;
    }
  | {
      readonly kind: "PROMOTED";
      readonly accountId: ChromeBridgeProviderAccountId;
      readonly previousActive: AuthorityIdentity | null;
      readonly active: AuthorityIdentity;
      readonly previousActiveLaneToken: AuthorityLaneToken | null;
      readonly candidateLaneToken: AuthorityLaneToken;
      readonly activeLaneToken: AuthorityLaneToken;
      readonly proof: CatalogCommitProof;
    };

export type AuthorityTransitionListener = (transition: AuthorityTransition) => void;
