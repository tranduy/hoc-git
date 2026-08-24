import {
  CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS,
  chromeBridgeSourceIdentity,
  type ChromeBridgeProviderAccountId
} from "./chrome-bridge-account.js";
import type {
  AuthorityCandidateToken,
  AuthorityDecision,
  AuthorityEvidenceClass,
  AuthorityIdentity,
  AuthorityLaneToken,
  AuthorityObservation,
  AuthorityPromotion,
  AuthorityReleaseDecision,
  AuthoritySlotSnapshot,
  AuthorityTransition,
  AuthorityTransitionListener,
  CatalogCommitProof,
  ProviderFeedInvalidationReason
} from "./provider-authority-types.js";

const MAX_TRANSITION_LISTENERS = 8;

interface AuthorityLane {
  readonly identity: AuthorityIdentity;
  readonly laneToken: AuthorityLaneToken;
}

interface CandidateLane extends AuthorityLane {
  readonly token: AuthorityCandidateToken;
}

interface AuthoritySlot {
  active: AuthorityLane | null;
  candidate: CandidateLane | null;
  frontier: AuthorityIdentity | null;
}

export class ProviderAuthorityCoordinator {
  readonly #slots: ReadonlyMap<ChromeBridgeProviderAccountId, AuthoritySlot>;
  readonly #listeners = new Set<AuthorityTransitionListener>();
  #candidateNonce = 0;
  #laneNonce = 0;

  constructor() {
    this.#slots = new Map(CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS.map((accountId) => [
      accountId,
      { active: null, candidate: null, frontier: null }
    ]));
  }

  observe(identity: AuthorityIdentity, evidenceClass: AuthorityEvidenceClass): AuthorityObservation {
    const slot = this.#slots.get(identity.accountId);
    if (slot === undefined || !isValidIdentity(identity)) {
      return rejected("AUTHORITY_IDENTITY_INVALID");
    }
    if (evidenceClass === "REPLAY") {
      return rejected("REPLAY_DIAGNOSTIC_ONLY");
    }
    if (slot.active !== null && sameIdentity(slot.active.identity, identity)) {
      return {
        disposition: "ACTIVE",
        token: null,
        laneToken: slot.active.laneToken,
        reason: null
      };
    }
    if (slot.candidate !== null && sameIdentity(slot.candidate.identity, identity)) {
      return {
        disposition: "CANDIDATE",
        token: slot.candidate.token,
        laneToken: slot.candidate.laneToken,
        reason: null
      };
    }
    if (!isNewerThanFrontier(identity, slot.frontier)) {
      return rejected("RETIRED_AUTHORITY_IDENTITY");
    }

    const retiredCandidate = slot.candidate;
    const admittedIdentity = immutableIdentity(identity);
    const candidate: CandidateLane = {
      identity: admittedIdentity,
      token: Object.freeze({ accountId: identity.accountId, nonce: ++this.#candidateNonce }),
      laneToken: this.#newLaneToken(identity.accountId, "CANDIDATE")
    };
    slot.candidate = candidate;
    slot.frontier = admittedIdentity;
    if (retiredCandidate !== null) {
      this.#notify({
        kind: "CANDIDATE_REPLACED",
        accountId: identity.accountId,
        retiredIdentity: retiredCandidate.identity,
        retiredLaneToken: retiredCandidate.laneToken,
        candidate: admittedIdentity,
        candidateLaneToken: candidate.laneToken
      });
    }
    return {
      disposition: "CANDIDATE",
      token: candidate.token,
      laneToken: candidate.laneToken,
      reason: null,
      ...(retiredCandidate === null ? {} : { retiredCandidateLaneToken: retiredCandidate.laneToken })
    };
  }

  promote(token: AuthorityCandidateToken, proof: CatalogCommitProof,
    transact?: (promotion: Extract<AuthorityPromotion, { readonly promoted: true }>) => void): AuthorityPromotion {
    const slot = this.#slots.get(token.accountId);
    if (slot === undefined || slot.candidate?.token !== token) {
      return { promoted: false, reason: "STALE_CANDIDATE_TOKEN" };
    }
    if (!isValidProof(proof)) {
      return { promoted: false, reason: "PROOF_INVALID" };
    }
    const expectedProvider = token.accountId.split(":")[1];
    if (proof.catalog.accountId !== token.accountId || proof.catalog.provider !== expectedProvider) {
      return { promoted: false, reason: "PROOF_ACCOUNT_MISMATCH" };
    }

    const candidate = slot.candidate;
    const previousActive = slot.active;
    const activeLaneToken = this.#newLaneToken(token.accountId, "ACTIVE");
    slot.active = { identity: candidate.identity, laneToken: activeLaneToken };
    slot.candidate = null;
    slot.frontier = candidate.identity;
    const promotion: Extract<AuthorityPromotion, { readonly promoted: true }> = {
      promoted: true,
      reason: null,
      accountId: token.accountId,
      previousActive: previousActive?.identity ?? null,
      active: candidate.identity,
      previousActiveLaneToken: previousActive?.laneToken ?? null,
      candidateLaneToken: candidate.laneToken,
      activeLaneToken,
      proof
    };
    try {
      transact?.(promotion);
    } catch {
      slot.active = previousActive;
      slot.candidate = candidate;
      slot.frontier = candidate.identity;
      return { promoted: false, reason: "PROMOTION_TRANSACTION_FAILED" };
    }
    this.#notify({ kind: "PROMOTED", ...promotion });
    return promotion;
  }

  invalidate(identity: AuthorityIdentity, _reason: ProviderFeedInvalidationReason): AuthorityDecision {
    const slot = this.#slots.get(identity.accountId);
    if (slot === undefined) return { accepted: false, disposition: "REJECTED" };
    if (slot.active !== null && sameIdentity(slot.active.identity, identity)) {
      return { accepted: true, disposition: "ACTIVE" };
    }
    if (slot.candidate !== null && sameIdentity(slot.candidate.identity, identity)) {
      return { accepted: true, disposition: "CANDIDATE" };
    }
    return { accepted: false, disposition: "REJECTED" };
  }

  release(identity: AuthorityIdentity): AuthorityReleaseDecision {
    const slot = this.#slots.get(identity.accountId);
    if (slot === undefined) return { changed: false, disposition: "REJECTED" };
    if (slot.candidate !== null && sameIdentity(slot.candidate.identity, identity)) {
      const retired = slot.candidate;
      slot.candidate = null;
      this.#notify({
        kind: "CANDIDATE_RELEASED",
        accountId: identity.accountId,
        retiredIdentity: retired.identity,
        retiredLaneToken: retired.laneToken
      });
      return { changed: true, disposition: "CANDIDATE", retiredLaneToken: retired.laneToken };
    }
    if (slot.active !== null && sameIdentity(slot.active.identity, identity)) {
      // Transport disappearance stalls the feed, but cannot surrender ownership. A
      // newer, proven candidate is still required to replace this active lane.
      this.#notify({ kind: "ACTIVE_TRANSPORT_RELEASED", accountId: identity.accountId,
        active: slot.active.identity, activeLaneToken: slot.active.laneToken });
      return { changed: false, disposition: "ACTIVE" };
    }
    return { changed: false, disposition: "REJECTED" };
  }

  snapshot(accountId: ChromeBridgeProviderAccountId): AuthoritySlotSnapshot {
    const slot = this.#slot(accountId);
    return Object.freeze({
      accountId,
      active: slot.active?.identity ?? null,
      candidate: slot.candidate?.identity ?? null,
      activeLaneToken: slot.active?.laneToken ?? null,
      candidateLaneToken: slot.candidate?.laneToken ?? null,
      candidateToken: slot.candidate?.token ?? null
    });
  }

  snapshots(): readonly AuthoritySlotSnapshot[] {
    return Object.freeze(CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS.map((accountId) => this.snapshot(accountId)));
  }

  subscribe(listener: AuthorityTransitionListener): () => void {
    if (this.#listeners.size >= MAX_TRANSITION_LISTENERS) {
      throw new Error("AUTHORITY_LISTENER_LIMIT");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #slot(accountId: ChromeBridgeProviderAccountId): AuthoritySlot {
    const slot = this.#slots.get(accountId);
    if (slot === undefined) throw new Error("AUTHORITY_ACCOUNT_UNKNOWN");
    return slot;
  }

  #newLaneToken(accountId: ChromeBridgeProviderAccountId, phase: AuthorityLaneToken["phase"]): AuthorityLaneToken {
    return Object.freeze({ accountId, nonce: ++this.#laneNonce, phase });
  }

  #notify(transition: AuthorityTransition): void {
    for (const listener of this.#listeners) {
      try { listener(transition); } catch { /* one observer cannot break committed authority */ }
    }
  }
}

function immutableIdentity(identity: AuthorityIdentity): AuthorityIdentity {
  return Object.freeze({ ...identity });
}

function isValidIdentity(identity: AuthorityIdentity): boolean {
  const source = chromeBridgeSourceIdentity(identity.sourceId);
  return source?.accountId === identity.accountId && identity.sourceEpoch.length > 0 &&
    Number.isSafeInteger(identity.connectionGeneration) && identity.connectionGeneration > 0;
}

function sameIdentity(left: AuthorityIdentity, right: AuthorityIdentity): boolean {
  return left.accountId === right.accountId && left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch && left.connectionGeneration === right.connectionGeneration;
}

function isNewerThanFrontier(identity: AuthorityIdentity, frontier: AuthorityIdentity | null): boolean {
  if (frontier === null) return true;
  const nextEpoch = canonicalSourceEpoch(identity.sourceEpoch);
  const currentEpoch = canonicalSourceEpoch(frontier.sourceEpoch);
  if (nextEpoch !== null && currentEpoch !== null && nextEpoch.lineage === currentEpoch.lineage &&
    nextEpoch.generation < currentEpoch.generation) return false;
  if (identity.connectionGeneration !== frontier.connectionGeneration) {
    return identity.connectionGeneration > frontier.connectionGeneration;
  }
  return nextEpoch !== null && currentEpoch !== null && nextEpoch.lineage === currentEpoch.lineage &&
    nextEpoch.generation > currentEpoch.generation;
}

function canonicalSourceEpoch(sourceEpoch: string): { readonly lineage: string; readonly generation: number } | null {
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(sourceEpoch);
  if (match === null) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { lineage: match[1]!, generation } : null;
}

function isValidProof(proof: CatalogCommitProof): boolean {
  return typeof proof.authorityCursor === "bigint" && proof.authorityCursor >= 0n &&
    proof.contentClass === "FOOTBALL" && proof.completeness === "COMPLETE" &&
    (proof.provenance === "WS" || proof.provenance === "AUTHENTICATED_HTTP") &&
    proof.completedPartitions.length > 0 && proof.catalog.category === "FOOTBALL";
}

function rejected(reason: Extract<AuthorityObservation, { readonly disposition: "REJECTED" }>["reason"]): AuthorityObservation {
  return { disposition: "REJECTED", token: null, laneToken: null, reason };
}
