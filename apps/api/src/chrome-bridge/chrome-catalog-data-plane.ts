import { CatalogSourceStatusSchema, type CatalogSourceStatus, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogCoverageGuard, type CatalogCoverageCandidate } from "../catalog/catalog-coverage-guard.js";
import { withAlignedQuotePhase, withScheduledPhaseResolved } from "./catalog-part-merge.js";
import { AdapterRouter } from "./adapter-router.js";
import { CmdDomCatalogAdapter } from "./cmd-dom-adapter.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";
import { TsportWsCatalogAdapter } from "./tsport-ws-adapter.js";
import { NetworkBodyAssembler, NetworkBodyAssemblyBudget } from "./network-body-assembler.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import type { FeedDecision, FeedProvenance, ProviderFeedEvidence } from "./provider-feed-types.js";
import { chromeBridgeProviderAccountIdForLobby,
  type ChromeBridgeProviderAccountId } from "./chrome-bridge-account.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import type {
  AuthorityCandidateToken,
  AuthorityIdentity,
  AuthorityLaneToken,
  AuthorityObservation,
  CatalogCommitProof
} from "./provider-authority-types.js";
import type { PipelineTelemetry } from "../diagnostics/pipeline-telemetry.js";

export interface ChromeCatalogDataPlaneOptions {
  readonly now?: () => number;
  readonly feedRegistry?: ProviderFeedRegistry;
  readonly freshnessMs?: number;
  readonly maxEnvelopeAgeMs?: number;
  readonly publish?: (catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => void;
  /** @deprecated Provider feed policies now own recovery timing. */
  readonly recoveryAfterMs?: number;
  /** @deprecated Provider feed policies now own recovery cooldowns. */
  readonly recoveryCooldownMs?: number;
  readonly recoverableAccountIds?: ReadonlySet<string>;
  readonly onSourceRecoveryNeeded?: (accountId: string) => void;
  readonly networkBodyBudget?: NetworkBodyAssemblyBudget;
  readonly authorityCoordinator?: ProviderAuthorityCoordinator;
  readonly telemetry?: PipelineTelemetry;
  readonly onIngestRejected?: (envelope: ChromeBridgeEnvelope, reason: string) => void;
}

export interface ChromeCatalogIngestContext {
  readonly connectionGeneration?: number;
  readonly authorityIdentity?: AuthorityIdentity;
  readonly authorityObservation?: AuthorityObservation;
}

interface CanonicalEpochIdentity {
  readonly kind: "CANONICAL";
  readonly lineage: string;
  readonly generation: number;
}

interface LegacyEpochIdentity {
  readonly kind: "LEGACY";
}

type EpochIdentity = CanonicalEpochIdentity | LegacyEpochIdentity;

interface DecodePipeline {
  readonly router: AdapterRouter;
  readonly networkBodies: NetworkBodyAssembler;
  readonly coverage: CatalogCoverageGuard;
  readonly laneToken: AuthorityLaneToken;
}

interface CandidateDecodePipeline {
  readonly identity: AuthorityIdentity;
  readonly token: AuthorityCandidateToken;
  readonly pipeline: DecodePipeline;
}

interface ActiveDecodePipeline {
  readonly identity: AuthorityIdentity;
  readonly pipeline: DecodePipeline;
}

const DEFAULT_RECOVERABLE_ACCOUNTS: ReadonlySet<string> = new Set([
  "catalog-source:SABA:FOOTBALL",
  "catalog-source:SBOBET:FOOTBALL",
  "catalog-source:APSPORT:FOOTBALL",
  "catalog-source:BTI:FOOTBALL"
]);

export class ChromeCatalogDataPlane {
  readonly #now: () => number;
  readonly #freshnessMs: number;
  readonly #maxEnvelopeAgeMs: number;
  readonly #publish: ((catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => void) | null;
  readonly #restoredCoverage = new CatalogCoverageGuard();
  readonly #feeds: ProviderFeedRegistry;
  readonly #catalogs = new Map<string, ObservedProviderCatalog>();
  readonly #catalogBases = new Map<string, FeedProvenance>();
  readonly #activePipelines = new Map<string, ActiveDecodePipeline>();
  readonly #candidatePipelines = new Map<string, CandidateDecodePipeline>();
  readonly #lastEnvelopeAtMsBySource = new Map<string, number>();
  readonly #recoverableAccountIds: ReadonlySet<string>;
  readonly #onSourceRecoveryNeeded: ((accountId: string) => void) | null;
  readonly #networkBodyBudget: NetworkBodyAssemblyBudget;
  readonly #authorityCoordinator: ProviderAuthorityCoordinator;
  readonly #telemetry: PipelineTelemetry | null;
  readonly #onIngestRejected: ((envelope: ChromeBridgeEnvelope, reason: string) => void) | null;

  constructor(options: ChromeCatalogDataPlaneOptions = {}) {
    this.#now = options.now ?? Date.now;
    // BTI and similar authenticated pages poll their live catalog every
    // 10-15 seconds. A five-second TTL made a healthy source oscillate between
    // LIVE and STALE for most of every poll interval.
    this.#freshnessMs = options.freshnessMs ?? 20_000;
    this.#maxEnvelopeAgeMs = options.maxEnvelopeAgeMs ?? 30_000;
    this.#publish = options.publish ?? null;
    this.#recoverableAccountIds = options.recoverableAccountIds ?? DEFAULT_RECOVERABLE_ACCOUNTS;
    this.#onSourceRecoveryNeeded = options.onSourceRecoveryNeeded ?? null;
    this.#feeds = options.feedRegistry ?? new ProviderFeedRegistry({ now: this.#now });
    this.#networkBodyBudget = options.networkBodyBudget ?? new NetworkBodyAssemblyBudget({ now: this.#now });
    this.#authorityCoordinator = options.authorityCoordinator ?? new ProviderAuthorityCoordinator();
    this.#telemetry = options.telemetry ?? null;
    this.#onIngestRejected = options.onIngestRejected ?? null;
    this.#authorityCoordinator.subscribe((transition) => {
      if (transition.kind === "ACTIVE_TRANSPORT_RELEASED") {
        const active = this.#activePipelines.get(transition.accountId);
        if (active?.pipeline.laneToken === transition.activeLaneToken) {
          active.pipeline.networkBodies.dispose();
        }
        return;
      }
      if (transition.kind !== "CANDIDATE_REPLACED" && transition.kind !== "CANDIDATE_RELEASED") return;
      const candidate = this.#candidatePipelines.get(transition.accountId);
      if (candidate?.pipeline.laneToken !== transition.retiredLaneToken) return;
      candidate.pipeline.networkBodies.dispose();
      this.#candidatePipelines.delete(transition.accountId);
    });
  }

  owns(accountId: string): boolean {
    return this.#feeds.list().some((snapshot) => snapshot.accountId === accountId);
  }

  ingest(envelope: ChromeBridgeEnvelope, context: ChromeCatalogIngestContext = {}): boolean {
    const transportAccountId = accountIdForLobby(envelope.lobby);
    const ageMs = this.#now() - envelope.observedAtMs;
    const replayed = envelope.request.replayed === true;
    if (!Number.isFinite(ageMs) ||
      (ageMs > this.#maxEnvelopeAgeMs && (!replayed || ageMs > 86_400_000))) {
      this.#telemetry?.recordEnvelopeRejected(transportAccountId, "TOO_OLD");
      return this.#reject(envelope, "ENVELOPE_TOO_OLD");
    }
    const epoch = envelopeEpoch(envelope);
    if (epoch === null) return this.#reject(envelope, "SOURCE_EPOCH_INVALID");
    // Durable replay is display/bootstrap material only. It must not allocate
    // source ownership or touch body, router, or adapter authority state.
    if (replayed) return this.#reject(envelope, "DURABLE_REPLAY_NOT_AUTHORITATIVE");
    // Direct callers have no authenticated socket generation. The tab id is a
    // stable, bounded compatibility generation; the bridge route always
    // supplies the registry's real monotonically increasing generation.
    const connectionGeneration = context.connectionGeneration ?? Math.max(1, envelope.tabId);
    if (!Number.isSafeInteger(connectionGeneration) || connectionGeneration <= 0) {
      return this.#reject(envelope, "CONNECTION_GENERATION_INVALID");
    }
    const identity: AuthorityIdentity = context.authorityIdentity ?? {
      accountId: transportAccountId,
      sourceId: envelope.sourceId,
      sourceEpoch: epoch.sourceEpoch,
      connectionGeneration
    };
    if (!identityMatchesEnvelope(identity, transportAccountId, envelope, epoch.sourceEpoch,
      connectionGeneration)) return this.#reject(envelope, "AUTHORITY_IDENTITY_MISMATCH");
    const admission = this.#authorityCoordinator.observe(identity,
      envelope.transport === "TAB_STATE" || envelope.transport === "WS_STATE" ? "TRANSPORT" : "CANDIDATE_DATA");
    if (admission.disposition === "REJECTED") {
      this.#telemetry?.recordEnvelopeRejected(transportAccountId, "RETIRED_EPOCH");
      return this.#reject(envelope, "AUTHORITY_EPOCH_RETIRED");
    }
    if (context.authorityObservation !== undefined &&
      !sameAuthorityObservation(admission, context.authorityObservation)) {
      return this.#reject(envelope, "AUTHORITY_OBSERVATION_MISMATCH");
    }
    const sourceEpoch = identity.sourceEpoch;
    this.#telemetry?.recordEnvelope(envelope, sourceEpoch);
    if (admission.disposition === "ACTIVE") {
      this.#lastEnvelopeAtMsBySource.set(envelope.sourceId, this.#now());
      this.#feeds.accept({ kind: "TAB_REACHABLE", accountId: transportAccountId, sourceId: envelope.sourceId,
        sourceEpoch, atMs: envelope.observedAtMs });
    }
    if (envelope.transport === "TAB_STATE") {
      if (admission.disposition === "ACTIVE") this.#requestRecoveries();
      return this.#reject(envelope, "TAB_STATE_TRANSPORT_ONLY");
    }
    const pipeline = admission.disposition === "ACTIVE"
      ? this.#activePipeline(identity, admission.laneToken)
      : this.#candidatePipeline(identity, admission.token, admission.laneToken);
    if (pipeline === null) return this.#reject(envelope, "DECODE_PIPELINE_UNAVAILABLE");
    const assembled = pipeline.networkBodies.ingest(envelope);
    if (assembled === null) return this.#reject(envelope, "NETWORK_BODY_INCOMPLETE");
    if (assembled.transport === "HTTP_RESPONSE" && !hasBoundHttpDocument(assembled)) {
      return this.#reject(envelope, "HTTP_DOCUMENT_NOT_BOUND");
    }
    const route = pipeline.router.route(assembled);
    if (route.status !== "TRUSTED" || route.adapter === null) {
      this.#telemetry?.recordAdapterIgnored(transportAccountId, envelope.observedAtMs,
        envelope.request.pathnameClass);
      const reason = route.reason ?? (route.providerFamily === null
        ? "ADAPTER_FINGERPRINT_UNMATCHED" : "ADAPTER_CONFIRMATION_PENDING");
      return this.#reject(envelope, reason);
    }
    const update = route.adapter.decode(assembled).at(-1);
    if (update === undefined) {
      // An adapter that produces nothing has already decided why, and every one
      // of its exits looks the same from here. Report that reason where the
      // endpoint would go: it is the one thing that shows an adapter going
      // quiet on frames it is still receiving.
      const adapter = route.adapter as { takeIgnoreReason?: () => string | null };
      const reason = adapter.takeIgnoreReason?.() ?? null;
      this.#telemetry?.recordAdapterIgnored(transportAccountId, envelope.observedAtMs,
        reason === null ? envelope.request.pathnameClass : `/ignored/${reason}`);
      return this.#reject(envelope, `ADAPTER_DECODE_EMPTY:${route.adapter.id}`);
    }
    this.#telemetry?.recordAdapterDecoded(transportAccountId, update.observedAtMs);
    if (update.sourceId !== identity.sourceId) {
      return this.#reject(envelope, `ADAPTER_SOURCE_MISMATCH:${route.adapter.id}`);
    }
    if (update.transportAlive === true) {
      if (admission.disposition === "CANDIDATE") {
        return this.#reject(envelope, `CANDIDATE_TRANSPORT_ONLY:${route.adapter.id}`);
      }
      const provenance = transportProvenance(envelope.transport);
      if (provenance !== null) this.#feeds.accept({ kind: "TRANSPORT", accountId: transportAccountId,
        sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, provenance,
        providerSequence: update.sequence });
      return this.#reject(envelope, `ADAPTER_TRANSPORT_ONLY:${route.adapter.id}`);
    }
    if (update.invalidateAccountId !== undefined) {
      if (update.reason === "PROVIDER_STREAM_GAP" || update.reason === "SCHEMA_CHANGED") {
        this.#telemetry?.recordAdapterRejected(transportAccountId, update.reason, update.observedAtMs);
      }
      const shadowsSabaDomAuthority = envelope.lobby === "SABA" &&
        this.#catalogBases.get(update.invalidateAccountId) === "DOM_FALLBACK" &&
        ((envelope.transport === "WS_FRAME" &&
          (update.reason === "PROVIDER_STREAM_GAP" || update.reason === "SCHEMA_CHANGED")) ||
          (envelope.transport === "WS_STATE" && update.reason === "PROVIDER_STREAM_CLOSED"));
      if (shadowsSabaDomAuthority) {
        return this.#reject(envelope, `SABA_SOCKET_INVALIDATION_SHADOWED_BY_DOM:${route.adapter.id}`);
      }
      if (admission.disposition === "CANDIDATE") {
        return this.#reject(envelope, `CANDIDATE_INVALIDATION_IGNORED:${route.adapter.id}`);
      }
      if (!this.#authorityCoordinator.invalidate(identity, update.reason).accepted) {
        return this.#reject(envelope, `AUTHORITY_INVALIDATION_REJECTED:${route.adapter.id}`);
      }
      const applied = this.#applyDecision(this.#feeds.accept({ kind: "INVALIDATE",
        accountId: update.invalidateAccountId, sourceId: update.sourceId, sourceEpoch,
        atMs: update.observedAtMs, reason: update.reason }));
      return applied ? true : this.#reject(envelope, `FEED_INVALIDATION_REJECTED:${route.adapter.id}`);
    }
    if (!isObservedCatalog(update.value)) return this.#reject(envelope, `ADAPTER_VALUE_INVALID:${route.adapter.id}`);
    let nextCatalog = update.value;
    const provenance = update.provenance ?? catalogProvenance(envelope.transport);
    if (admission.disposition === "CANDIDATE" && provenance === "DOM_FALLBACK" && envelope.lobby !== "SABA") {
      return this.#reject(envelope, `CANDIDATE_DOM_FALLBACK:${route.adapter.id}`);
    }
    let catalogBasis = provenance;
    if (envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT") {
      const retained = this.#catalogs.get(nextCatalog.accountId);
      if (retained !== undefined && this.#catalogBases.get(nextCatalog.accountId) === "AUTHENTICATED_HTTP") {
        const feed = this.#feeds.snapshot(transportAccountId);
        // While network authority is current, DOM evidence is intentionally
        // silent. Once authority stalls it can update visible identity/status
        // fields, but never price clocks or LIVE freshness.
        if (feed.state === "LIVE") return this.#reject(envelope, "CMD_DOM_SUPPRESSED_BY_LIVE_HTTP");
        nextCatalog = overlayCmdDomCatalog(retained, nextCatalog);
        catalogBasis = "AUTHENTICATED_HTTP";
      }
    }
    if (envelope.lobby === "SABA" && envelope.transport === "DOM_SNAPSHOT") {
      const retained = this.#catalogs.get(nextCatalog.accountId);
      if (retained !== undefined) nextCatalog = overlaySabaDomCatalog(retained, nextCatalog);
    }
    if (nextCatalog.category !== "FOOTBALL" || nextCatalog.accountId !== transportAccountId) {
      return this.#reject(envelope, `CATALOG_IDENTITY_MISMATCH:${route.adapter.id}`);
    }
    // A provider page can briefly render the event shell before its market
    // rows. Such a snapshot is transport-valid but unusable for comparison;
    // publishing it would erase the last complete catalog on every refresh.
    if (nextCatalog.events.length > 0 &&
      (nextCatalog.markets.length === 0 || nextCatalog.quotes.length === 0)) {
      return this.#reject(envelope, `CATALOG_MARKETS_OR_QUOTES_EMPTY:${route.adapter.id}`);
    }
    const mode = update.evidenceMode ?? (update.authoritativeBaseline === true ? "BASELINE" : "DELTA");
    const generation = update.generation ?? (mode === "BASELINE" && update.authoritativeBaseline === true
      ? `${sourceEpoch}:${update.sequence}` : null);
    if (generation === null) {
      this.#telemetry?.recordAdapterRejected(transportAccountId, "PRE_BASELINE", update.observedAtMs);
      return this.#reject(envelope, `PRE_BASELINE:${route.adapter.id}`);
    }
    if (admission.disposition === "CANDIDATE" &&
      (mode !== "BASELINE" || update.authoritativeBaseline !== true ||
        (provenance === "DOM_FALLBACK" && envelope.lobby !== "SABA"))) {
      return this.#reject(envelope, `CANDIDATE_AUTHORITATIVE_BASELINE_REQUIRED:${route.adapter.id}`);
    }
    const coverage = { generation, authoritativeBaseline: mode === "BASELINE",
      providerEventIds: nextCatalog.events.map((event) => event.providerEventId) };
    const explicitDomSweep = envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT" &&
      update.completeSweepEvidence === true;
    if (!explicitDomSweep && !pipeline.coverage.allows(nextCatalog.accountId, coverage)) {
      return this.#reject(envelope, `CATALOG_COVERAGE_REJECTED:${route.adapter.id}`);
    }
    if (admission.disposition === "CANDIDATE") {
      const proof = compatibilityCatalogProof(nextCatalog, provenance, update.sequence, generation);
      if (proof === null) return this.#reject(envelope, `CANDIDATE_PROOF_INVALID:${route.adapter.id}`);
      const catalogEvidence: Extract<ProviderFeedEvidence, { readonly kind: "CATALOG" }> = {
        kind: "CATALOG", accountId: nextCatalog.accountId, sourceId: update.sourceId, sourceEpoch,
        atMs: update.observedAtMs, generation, mode, provenance,
        providerTimestampMs: update.providerTimestampMs ?? null, catalog: nextCatalog
      };
      const stagedDecision = this.#promoteCandidate(identity, admission.token, pipeline, proof,
        envelope.observedAtMs, catalogEvidence, coverage, catalogBasis);
      if (stagedDecision === null || stagedDecision.publish === null) {
        return this.#reject(envelope, `CANDIDATE_PROMOTION_REJECTED:${route.adapter.id}`);
      }
      this.#telemetry?.recordCatalog(stagedDecision.publish.catalog);
      this.#publish?.(stagedDecision.publish.catalog, stagedDecision.publish.snapshotState);
      return true;
    }
    const decision = this.#feeds.accept({ kind: "CATALOG", accountId: nextCatalog.accountId,
      sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, generation, mode, provenance,
      providerTimestampMs: update.providerTimestampMs ?? null, catalog: nextCatalog });
    if (decision.accepted) pipeline.coverage.commit(nextCatalog.accountId, coverage);
    if (decision.accepted) this.#catalogBases.set(nextCatalog.accountId, catalogBasis);
    const applied = this.#applyDecision(decision);
    return applied ? true : this.#reject(envelope, `FEED_CONTROLLER_REJECTED:${route.adapter.id}`);
  }

  #reject(envelope: ChromeBridgeEnvelope, reason: string): false {
    this.#onIngestRejected?.(envelope, reason);
    return false;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    return this.#feeds.read(accountId);
  }

  restore(catalog: ObservedProviderCatalog): void {
    if (!this.owns(catalog.accountId) || catalog.category !== "FOOTBALL" ||
      catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return;
    this.#restoredCoverage.accept(catalog.accountId, { generation: `restored:${catalog.observedAtMs}`,
      authoritativeBaseline: false, providerEventIds: catalog.events.map((event) => event.providerEventId) });
    this.#catalogBases.set(catalog.accountId, "DOM_FALLBACK");
    this.#applyDecision(this.#feeds.restore(catalog));
  }

  resetCoverage(accountId?: string): void {
    if (accountId !== undefined) {
      this.#restoredCoverage.reset(accountId);
      this.#activePipelines.get(accountId)?.pipeline.coverage.reset(accountId);
      this.#candidatePipelines.get(accountId)?.pipeline.coverage.reset(accountId);
      return;
    }
    for (const id of this.#catalogs.keys()) {
      this.#restoredCoverage.reset(id);
      this.#activePipelines.get(id)?.pipeline.coverage.reset(id);
      this.#candidatePipelines.get(id)?.pipeline.coverage.reset(id);
    }
  }

  async overlayStatuses(statuses: readonly CatalogSourceStatus[]): Promise<readonly CatalogSourceStatus[]> {
    this.#requestRecoveries();
    return statuses.map((status) => {
      const catalog = this.#catalogs.get(status.id);
      if (!this.owns(status.id)) return status;
      let live = false;
      try {
        this.#feeds.read(status.id);
        live = true;
      } catch { /* a non-live provider must fail closed */ }
      if (live && catalog !== undefined) {
        return CatalogSourceStatusSchema.parse({ ...status, sessionState: "ACTIVE",
          acquiredAtMs: catalog.observedAtMs, reason: null });
      }
      if (status.sessionState === "ACTIVE") {
        return CatalogSourceStatusSchema.parse({ ...status, sessionState: "ACTION_REQUIRED",
          acquiredAtMs: catalog?.observedAtMs ?? status.acquiredAtMs,
          reason: "PROVIDER_VALIDATION_FAILED" });
      }
      return status;
    });
  }

  #requestRecoveries(): void {
    if (this.#onSourceRecoveryNeeded === null) return;
    const eligible = new Set(this.#feeds.list().filter((snapshot) =>
      this.#recoverableAccountIds.has(snapshot.accountId) && (this.#catalogs.has(snapshot.accountId) ||
        snapshot.tabReachableAtMs !== null || snapshot.providerTransportAtMs !== null))
      .map((snapshot) => snapshot.accountId));
    for (const request of this.#feeds.sweep(eligible)) {
      try { this.#onSourceRecoveryNeeded(request.accountId); } catch { /* recovery is best-effort */ }
    }
  }

  #activePipeline(identity: AuthorityIdentity, laneToken: AuthorityLaneToken): DecodePipeline {
    const existing = this.#activePipelines.get(identity.accountId);
    if (existing !== undefined && existing.pipeline.laneToken === laneToken &&
      sameAuthorityIdentity(existing.identity, identity)) return existing.pipeline;
    existing?.pipeline.networkBodies.dispose();
    const pipeline = createDecodePipeline(this.#networkBodyBudget, laneToken);
    this.#activePipelines.set(identity.accountId, { identity, pipeline });
    return pipeline;
  }

  #candidatePipeline(identity: AuthorityIdentity, token: AuthorityCandidateToken,
    laneToken: AuthorityLaneToken): DecodePipeline {
    const current = this.#candidatePipelines.get(identity.accountId);
    if (current !== undefined && current.token === token && current.pipeline.laneToken === laneToken &&
      sameAuthorityIdentity(current.identity, identity)) return current.pipeline;
    current?.pipeline.networkBodies.dispose();
    const pipeline = createDecodePipeline(this.#networkBodyBudget, laneToken);
    this.#candidatePipelines.set(identity.accountId, { identity, token, pipeline });
    return pipeline;
  }

  #promoteCandidate(identity: AuthorityIdentity, token: AuthorityCandidateToken,
    pipeline: DecodePipeline, proof: CatalogCommitProof, atMs: number,
    catalogEvidence: Extract<ProviderFeedEvidence, { readonly kind: "CATALOG" }>,
    coverage: CatalogCoverageCandidate, catalogBasis: FeedProvenance): FeedDecision | null {
    const candidate = this.#candidatePipelines.get(identity.accountId);
    if (candidate === undefined || candidate.token !== token || candidate.pipeline !== pipeline ||
      !sameAuthorityIdentity(candidate.identity, identity)) return null;
    const authorityBefore = this.#authorityCoordinator.snapshot(identity.accountId);
    if (authorityBefore.candidateToken !== token || authorityBefore.candidate === null ||
      !sameAuthorityIdentity(authorityBefore.candidate, identity)) return null;
    const previousActive = authorityBefore.active;
    const invalidation: Extract<ProviderFeedEvidence, { readonly kind: "INVALIDATE" }> | null =
      previousActive !== null && (previousActive.sourceId !== identity.sourceId ||
        previousActive.sourceEpoch !== identity.sourceEpoch) ? {
          kind: "INVALIDATE",
          accountId: identity.accountId,
          sourceId: previousActive.sourceId,
          sourceEpoch: previousActive.sourceEpoch,
          atMs,
          reason: "SOURCE_REPLACED"
        } : null;
    const prepared = invalidation === null ? [catalogEvidence] : [invalidation, catalogEvidence];
    let promotedAtMs: number;
    try {
      const decisions = this.#feeds.preflight(prepared);
      if (decisions.some((decision) => !decision.accepted) || decisions.at(-1)?.publish === null) return null;
      promotedAtMs = this.#now();
    } catch {
      return null;
    }

    const coverageCheckpoint = pipeline.coverage.checkpoint();
    const catalogCheckpoint = checkpointMapEntry(this.#catalogs, identity.accountId);
    const basisCheckpoint = checkpointMapEntry(this.#catalogBases, identity.accountId);
    const activePipelineCheckpoint = checkpointMapEntry(this.#activePipelines, identity.accountId);
    const candidatePipelineCheckpoint = checkpointMapEntry(this.#candidatePipelines, identity.accountId);
    const lastEnvelopeCheckpoints = new Map<string, MapEntryCheckpoint<number>>();
    for (const sourceId of new Set([identity.sourceId, previousActive?.sourceId].filter(isString))) {
      lastEnvelopeCheckpoints.set(sourceId, checkpointMapEntry(this.#lastEnvelopeAtMsBySource, sourceId));
    }
    let stagedDecision: FeedDecision | null = null;
    let committed = false;
    try {
      this.#feeds.transaction(identity.accountId, () => {
        const promotion = this.#authorityCoordinator.promote(token, proof, (transaction) => {
          // Construct all potentially fallible state before changing any visible
          // catalog, pipeline, coverage, or ownership pointer.
          const activePipeline: DecodePipeline = {
            router: pipeline.router,
            coverage: pipeline.coverage,
            laneToken: transaction.activeLaneToken,
            networkBodies: new NetworkBodyAssembler({
              budget: this.#networkBodyBudget,
              laneToken: transaction.activeLaneToken
            })
          };
          if (invalidation !== null) {
            const invalidated = this.#feeds.accept(invalidation);
            if (!invalidated.accepted) throw new Error("AUTHORITY_FEED_INVALIDATION_REJECTED");
          }
          stagedDecision = this.#feeds.accept(catalogEvidence);
          if (!stagedDecision.accepted || stagedDecision.publish === null) {
            throw new Error("AUTHORITY_FEED_COMMIT_REJECTED");
          }

          // No fallible work follows this point. The coordinator remains inside
          // its CAS callback until every data-plane pointer agrees on B.
          pipeline.coverage.commit(identity.accountId, coverage);
          this.#catalogBases.set(identity.accountId, catalogBasis);
          this.#catalogs.set(stagedDecision.publish.catalog.accountId, stagedDecision.publish.catalog);
          const oldActive = this.#activePipelines.get(identity.accountId);
          this.#activePipelines.set(identity.accountId, { identity: transaction.active, pipeline: activePipeline });
          this.#candidatePipelines.delete(identity.accountId);
          if (transaction.previousActive !== null) {
            this.#lastEnvelopeAtMsBySource.delete(transaction.previousActive.sourceId);
          }
          this.#lastEnvelopeAtMsBySource.set(identity.sourceId, promotedAtMs);

          // The proof-triggering candidate body has completed. Disposing both
          // retired lanes removes every other pending multipart reservation.
          pipeline.networkBodies.dispose();
          oldActive?.pipeline.networkBodies.dispose();
          committed = true;
        });
        if (!promotion.promoted || !committed) throw new Error("AUTHORITY_PROMOTION_REJECTED");
      });
    } catch {
      pipeline.coverage.restoreCheckpoint(coverageCheckpoint);
      restoreMapEntry(this.#catalogs, identity.accountId, catalogCheckpoint);
      restoreMapEntry(this.#catalogBases, identity.accountId, basisCheckpoint);
      restoreMapEntry(this.#activePipelines, identity.accountId, activePipelineCheckpoint);
      restoreMapEntry(this.#candidatePipelines, identity.accountId, candidatePipelineCheckpoint);
      for (const [sourceId, checkpoint] of lastEnvelopeCheckpoints) {
        restoreMapEntry(this.#lastEnvelopeAtMsBySource, sourceId, checkpoint);
      }
      return null;
    }
    return committed ? stagedDecision : null;
  }

  #applyDecision(decision: FeedDecision): boolean {
    if (decision.publish === null) return false;
    this.#catalogs.set(decision.publish.catalog.accountId, decision.publish.catalog);
    this.#telemetry?.recordCatalog(decision.publish.catalog);
    this.#publish?.(decision.publish.catalog, decision.publish.snapshotState);
    return true;
  }
}

function accountIdForLobby(lobby: ChromeBridgeEnvelope["lobby"]): ChromeBridgeProviderAccountId {
  return chromeBridgeProviderAccountIdForLobby(lobby);
}

interface MapEntryCheckpoint<T> {
  readonly present: boolean;
  readonly value: T | undefined;
}

function checkpointMapEntry<K, V>(map: ReadonlyMap<K, V>, key: K): MapEntryCheckpoint<V> {
  return { present: map.has(key), value: map.get(key) };
}

function restoreMapEntry<K, V>(map: Map<K, V>, key: K, checkpoint: MapEntryCheckpoint<V>): void {
  if (checkpoint.present) map.set(key, checkpoint.value as V);
  else map.delete(key);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

function hasBoundHttpDocument(envelope: ChromeBridgeEnvelope): boolean {
  return envelope.request.requestFrameKey !== undefined && envelope.request.requestDocumentKey !== undefined;
}

function legacySourceEpoch(sourceId: string): string {
  return `legacy:${sourceId}`;
}

function envelopeEpoch(envelope: ChromeBridgeEnvelope): {
  readonly sourceEpoch: string;
  readonly identity: EpochIdentity;
} | null {
  if (envelope.sourceEpoch === undefined) {
    return { sourceEpoch: legacySourceEpoch(envelope.sourceId), identity: { kind: "LEGACY" } };
  }
  const canonical = canonicalSourceEpoch(envelope.sourceEpoch);
  if (canonical === null) return null;
  return { sourceEpoch: envelope.sourceEpoch, identity: { kind: "CANONICAL", ...canonical } };
}

function canonicalSourceEpoch(sourceEpoch: string): { readonly lineage: string; readonly generation: number } | null {
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(sourceEpoch);
  if (match === null) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { lineage: match[1]!, generation } : null;
}

function createDecodePipeline(budget: NetworkBodyAssemblyBudget, laneToken: AuthorityLaneToken): DecodePipeline {
  return { router: new AdapterRouter([new CmdHttpCatalogAdapter(), new CmdDomCatalogAdapter(),
    new ImHttpCatalogAdapter(), new SabaWsCatalogAdapter(), new KsportWsCatalogAdapter(),
    new TsportWsCatalogAdapter(), new BtiHttpCatalogAdapter()], { confirmationsRequired: 1 }),
  coverage: new CatalogCoverageGuard(), laneToken,
  networkBodies: new NetworkBodyAssembler({ budget, laneToken }) };
}

function sameAuthorityIdentity(left: AuthorityIdentity, right: AuthorityIdentity): boolean {
  return left.accountId === right.accountId && left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch && left.connectionGeneration === right.connectionGeneration;
}

function sameAuthorityObservation(left: AuthorityObservation, right: AuthorityObservation): boolean {
  if (left.disposition !== right.disposition) return false;
  if (left.disposition === "REJECTED" || right.disposition === "REJECTED") {
    return left.disposition === right.disposition && left.reason === right.reason;
  }
  return left.laneToken === right.laneToken && left.token === right.token;
}

function identityMatchesEnvelope(identity: AuthorityIdentity, accountId: ChromeBridgeProviderAccountId,
  envelope: ChromeBridgeEnvelope, sourceEpoch: string, connectionGeneration: number): boolean {
  return identity.accountId === accountId && identity.sourceId === envelope.sourceId &&
    identity.sourceEpoch === sourceEpoch && identity.connectionGeneration === connectionGeneration;
}

function compatibilityCatalogProof(catalog: ObservedProviderCatalog, provenance: FeedProvenance,
  sequence: number, generation: string): CatalogCommitProof | null {
  const proofProvenance = provenance === "DOM_FALLBACK" && catalog.provider === "SABA" ? "WS" : provenance;
  if (proofProvenance !== "WS" && proofProvenance !== "AUTHENTICATED_HTTP") return null;
  if (!Number.isSafeInteger(sequence) || sequence < 0) return null;
  return {
    authorityCursor: BigInt(sequence),
    provenance: proofProvenance,
    contentClass: "FOOTBALL",
    completeness: "COMPLETE",
    scope: "ACCOUNT",
    completedPartitions: [generation],
    emptyProof: catalog.events.length === 0 ? "PROVIDER_CONFIRMED_EMPTY" : "NONEMPTY",
    catalog
  };
}

function catalogProvenance(transport: ChromeBridgeEnvelope["transport"]): FeedProvenance {
  return transport === "WS_FRAME" ? "WS"
    : transport === "HTTP_RESPONSE" ? "AUTHENTICATED_HTTP"
    : "DOM_FALLBACK";
}

function transportProvenance(transport: ChromeBridgeEnvelope["transport"]): "WS" | "AUTHENTICATED_HTTP" | null {
  return transport === "WS_FRAME" ? "WS" : transport === "HTTP_RESPONSE" ? "AUTHENTICATED_HTTP" : null;
}

function isObservedCatalog(value: unknown): value is ObservedProviderCatalog {
  if (typeof value !== "object" || value === null) return false;
  const catalog = value as Partial<ObservedProviderCatalog>;
  return catalog.dataMode === "LIVE" && typeof catalog.accountId === "string" &&
    Array.isArray(catalog.events) && Array.isArray(catalog.markets) && Array.isArray(catalog.quotes);
}

function overlaySabaDomCatalog(retained: ObservedProviderCatalog,
  current: ObservedProviderCatalog): ObservedProviderCatalog {
  if (retained.provider !== "SABA" || current.provider !== "SABA" || retained.accountId !== current.accountId) {
    return current;
  }
  const events = new Map(retained.events.map((event) => [event.providerEventId, event]));
  const markets = new Map(retained.markets.map((market) => [market.providerMarketId, market]));
  const quotes = new Map(retained.quotes.map((quote) => [quote.providerSelectionId, quote]));
  for (const event of current.events) events.set(event.providerEventId, event);
  for (const market of current.markets) markets.set(market.providerMarketId, market);
  for (const quote of current.quotes) quotes.set(quote.providerSelectionId, quote);
  // Unioning a retained catalog with a newer one can keep an event from one and
  // its quotes from the other. The comparison layer only shows a quote whose
  // phase equals its event's, so a mismatch here hides every ticket.
  // SABA's live section also lists fixtures that have not kicked off, and its
  // day list - the one carrying their real kickoff - can arrive in a different
  // snapshot. Only this union holds both, so only here can the schedule
  // contradict the live claim.
  return withScheduledPhaseResolved({ ...current,
    rejectedMarketCount: Math.max(retained.rejectedMarketCount, current.rejectedMarketCount),
    events: [...events.values()], markets: [...markets.values()], quotes: [...quotes.values()] });
}

function overlayCmdDomCatalog(retained: ObservedProviderCatalog,
  current: ObservedProviderCatalog): ObservedProviderCatalog {
  if (retained.provider !== "CMD" || current.provider !== "CMD" || retained.accountId !== current.accountId) {
    return current;
  }
  const visibleEvents = new Map(current.events.map((event) => [event.providerEventId, event]));
  const events = retained.events.map((event) => {
    const visible = visibleEvents.get(event.providerEventId);
    if (visible === undefined || event.category !== "FOOTBALL" || visible.category !== "FOOTBALL") return event;
    return { ...event,
      competition: visible.competition, startAtUtcMs: visible.startAtUtcMs,
      participantA: visible.participantA, participantB: visible.participantB,
      isLive: visible.isLive, liveState: visible.liveState };
  });
  const visibleMarkets = new Map(current.markets.map((market) => [marketSemanticKey(market), market]));
  const markets = retained.markets.map((market) => {
    const visible = visibleMarkets.get(marketSemanticKey(market));
    return visible === undefined ? market : { ...market, status: visible.status };
  });
  const visibleQuotes = new Map(current.quotes.map((quote) => [quoteSemanticKey(quote), quote]));
  const quotes = retained.quotes.map((quote) => {
    const visible = visibleQuotes.get(quoteSemanticKey(quote));
    return visible === undefined ? quote : { ...quote, status: visible.status, isLive: visible.isLive };
  });
  return withAlignedQuotePhase({ ...retained,
    rejectedMarketCount: Math.max(retained.rejectedMarketCount, current.rejectedMarketCount),
    events, markets, quotes });
}

function marketSemanticKey(market: ObservedProviderCatalog["markets"][number]): string {
  return `${market.providerEventId}|${market.marketType}|${market.scope}|${market.line ?? ""}`;
}

function quoteSemanticKey(quote: ObservedProviderCatalog["quotes"][number]): string {
  return `${quote.providerEventId}|${quote.marketType}|${quote.scope}|${quote.line ?? ""}|${quote.selection}`;
}
