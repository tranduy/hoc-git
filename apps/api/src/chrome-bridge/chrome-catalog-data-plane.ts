import { CatalogSourceStatusSchema, type CatalogSourceStatus, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogCoverageGuard } from "../catalog/catalog-coverage-guard.js";
import { AdapterRouter } from "./adapter-router.js";
import { CmdDomCatalogAdapter } from "./cmd-dom-adapter.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";
import { TsportWsCatalogAdapter } from "./tsport-ws-adapter.js";
import { NetworkBodyAssembler } from "./network-body-assembler.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import type { FeedDecision, FeedProvenance } from "./provider-feed-types.js";

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
}

export interface ChromeCatalogIngestContext {
  readonly connectionGeneration?: number;
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

interface AccountSourceOwner {
  readonly connectionGeneration: number;
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly lobby: ChromeBridgeEnvelope["lobby"];
  readonly identity: EpochIdentity;
  readonly legacyHandoverUsed: boolean;
}

interface DecodePipeline {
  readonly router: AdapterRouter;
  readonly networkBodies: NetworkBodyAssembler;
}

interface CandidateDecodePipeline {
  readonly owner: AccountSourceOwner;
  readonly pipeline: DecodePipeline;
}

type SourceAdmission = {
  readonly kind: "CURRENT" | "CANDIDATE";
  readonly owner: AccountSourceOwner;
};

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
  readonly #coverage = new CatalogCoverageGuard();
  readonly #feeds: ProviderFeedRegistry;
  readonly #catalogs = new Map<string, ObservedProviderCatalog>();
  readonly #catalogBases = new Map<string, FeedProvenance>();
  readonly #accountOwners = new Map<string, AccountSourceOwner>();
  readonly #activePipelines = new Map<string, DecodePipeline>();
  readonly #candidatePipelines = new Map<string, CandidateDecodePipeline>();
  readonly #lastEnvelopeAtMsBySource = new Map<string, number>();
  readonly #recoverableAccountIds: ReadonlySet<string>;
  readonly #onSourceRecoveryNeeded: ((accountId: string) => void) | null;

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
  }

  owns(accountId: string): boolean {
    return this.#feeds.list().some((snapshot) => snapshot.accountId === accountId);
  }

  ingest(envelope: ChromeBridgeEnvelope, context: ChromeCatalogIngestContext = {}): boolean {
    const ageMs = this.#now() - envelope.observedAtMs;
    const replayed = envelope.request.replayed === true;
    if (!Number.isFinite(ageMs) ||
      (ageMs > this.#maxEnvelopeAgeMs && (!replayed || ageMs > 86_400_000))) return false;
    const transportAccountId = accountIdForLobby(envelope.lobby);
    if (transportAccountId === null) return false;
    const epoch = envelopeEpoch(envelope);
    if (epoch === null) return false;
    const connectionGeneration = context.connectionGeneration ?? 0;
    const admission = this.#admitSourceEpoch(transportAccountId, envelope, epoch, connectionGeneration);
    if (admission === null) return false;
    const sourceEpoch = admission.owner.sourceEpoch;
    if (admission.kind === "CURRENT") {
      this.#lastEnvelopeAtMsBySource.set(envelope.sourceId, this.#now());
      this.#feeds.accept({ kind: "TAB_REACHABLE", accountId: transportAccountId, sourceId: envelope.sourceId,
        sourceEpoch, atMs: envelope.observedAtMs });
    }
    if (envelope.transport === "TAB_STATE") {
      if (admission.kind === "CURRENT") this.#requestRecoveries();
      return false;
    }
    const pipeline = admission.kind === "CURRENT"
      ? this.#activePipeline(transportAccountId)
      : this.#candidatePipeline(transportAccountId, admission.owner);
    if (pipeline === null) return false;
    const assembled = pipeline.networkBodies.ingest(envelope);
    if (assembled === null) return false;
    const route = pipeline.router.route(assembled);
    if (route.status !== "TRUSTED" || route.adapter === null) return false;
    const update = route.adapter.decode(assembled).at(-1);
    if (update === undefined) return false;
    // Retained bridge replay is decoder bootstrap only. Let adapters rebuild
    // bounded recovery state, but never let replay renew transport, invalidate
    // the live owner, publish authoritative data, or promote a candidate.
    if (replayed) return false;
    if (update.transportAlive === true) {
      if (admission.kind === "CANDIDATE") return false;
      const provenance = transportProvenance(envelope.transport);
      if (provenance !== null) this.#feeds.accept({ kind: "TRANSPORT", accountId: transportAccountId,
        sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, provenance,
        providerSequence: update.sequence });
      return false;
    }
    if (update.invalidateAccountId !== undefined) {
      if (admission.kind === "CANDIDATE") return false;
      return this.#applyDecision(this.#feeds.accept({ kind: "INVALIDATE", accountId: update.invalidateAccountId,
        sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, reason: update.reason }));
    }
    if (!isObservedCatalog(update.value)) return false;
    let nextCatalog = update.value;
    const provenance = update.provenance ?? catalogProvenance(envelope.transport);
    let catalogBasis = provenance;
    if (envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT") {
      const retained = this.#catalogs.get(nextCatalog.accountId);
      if (retained !== undefined && this.#catalogBases.get(nextCatalog.accountId) === "AUTHENTICATED_HTTP") {
        const feed = this.#feeds.snapshot(transportAccountId);
        // While network authority is current, DOM evidence is intentionally
        // silent. Once authority stalls it can update visible identity/status
        // fields, but never price clocks or LIVE freshness.
        if (feed.state === "LIVE") return false;
        nextCatalog = overlayCmdDomCatalog(retained, nextCatalog);
        catalogBasis = "AUTHENTICATED_HTTP";
      }
    }
    if (envelope.lobby === "SABA" && envelope.transport === "DOM_SNAPSHOT") {
      const retained = this.#catalogs.get(nextCatalog.accountId);
      if (retained !== undefined) nextCatalog = overlaySabaDomCatalog(retained, nextCatalog);
    }
    if (nextCatalog.category !== "FOOTBALL" || nextCatalog.accountId !== transportAccountId) return false;
    // A provider page can briefly render the event shell before its market
    // rows. Such a snapshot is transport-valid but unusable for comparison;
    // publishing it would erase the last complete catalog on every refresh.
    if (nextCatalog.events.length > 0 &&
      (nextCatalog.markets.length === 0 || nextCatalog.quotes.length === 0)) return false;
    const mode = update.evidenceMode ?? (update.authoritativeBaseline === true ? "BASELINE" : "DELTA");
    const generation = update.generation ?? (mode === "BASELINE" && update.authoritativeBaseline === true
      ? `${sourceEpoch}:${update.sequence}` : null);
    if (generation === null) return false;
    if (admission.kind === "CANDIDATE" && (mode !== "BASELINE" || update.authoritativeBaseline !== true ||
      provenance === "DOM_FALLBACK")) return false;
    const coverage = { generation, authoritativeBaseline: mode === "BASELINE",
      providerEventIds: nextCatalog.events.map((event) => event.providerEventId) };
    const explicitDomSweep = envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT" &&
      update.completeSweepEvidence === true;
    if (!explicitDomSweep && !this.#coverage.allows(nextCatalog.accountId, coverage)) return false;
    if (admission.kind === "CANDIDATE" &&
      !this.#promoteCandidate(transportAccountId, admission.owner, envelope.observedAtMs)) return false;
    const decision = this.#feeds.accept({ kind: "CATALOG", accountId: nextCatalog.accountId,
      sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, generation, mode, provenance,
      providerTimestampMs: update.providerTimestampMs ?? null, catalog: nextCatalog });
    if (decision.accepted) this.#coverage.commit(nextCatalog.accountId, coverage);
    if (decision.accepted) this.#catalogBases.set(nextCatalog.accountId, catalogBasis);
    return this.#applyDecision(decision);
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    return this.#feeds.read(accountId);
  }

  restore(catalog: ObservedProviderCatalog): void {
    if (!this.owns(catalog.accountId) || catalog.category !== "FOOTBALL" ||
      catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return;
    this.#coverage.accept(catalog.accountId, { generation: `restored:${catalog.observedAtMs}`,
      authoritativeBaseline: false, providerEventIds: catalog.events.map((event) => event.providerEventId) });
    this.#catalogBases.set(catalog.accountId, "DOM_FALLBACK");
    this.#applyDecision(this.#feeds.restore(catalog));
  }

  resetCoverage(accountId?: string): void {
    if (accountId !== undefined) {
      this.#coverage.reset(accountId);
      return;
    }
    for (const id of this.#catalogs.keys()) this.#coverage.reset(id);
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

  #admitSourceEpoch(accountId: string, envelope: ChromeBridgeEnvelope,
    epoch: { readonly sourceEpoch: string; readonly identity: EpochIdentity },
    connectionGeneration: number): SourceAdmission | null {
    if (!Number.isSafeInteger(connectionGeneration) || connectionGeneration < 0) return null;
    const current = this.#accountOwners.get(accountId);
    const proposed = (legacyHandoverUsed: boolean): AccountSourceOwner => ({ connectionGeneration,
      sourceId: envelope.sourceId, sourceEpoch: epoch.sourceEpoch, lobby: envelope.lobby,
      identity: epoch.identity, legacyHandoverUsed });
    if (current === undefined) {
      const owner = proposed(false);
      this.#accountOwners.set(accountId, owner);
      this.#activePipelines.set(accountId, createDecodePipeline());
      return { kind: "CURRENT", owner };
    }
    if (connectionGeneration < current.connectionGeneration) return null;
    if (sameOwnerEpoch(current, envelope.sourceId, epoch.sourceEpoch)) {
      if (connectionGeneration === current.connectionGeneration) return { kind: "CURRENT", owner: current };
      // A new authenticated bridge connection does not create a new provider
      // epoch when the source identity is unchanged. Advance transport
      // ownership in place so the current decoder/controller authority remains
      // intact; provider-specific cursors still reject a stale catalog and the
      // registry connection fence rejects the superseded socket.
      const reconnected = proposed(current.legacyHandoverUsed);
      this.#accountOwners.set(accountId, reconnected);
      const candidate = this.#candidatePipelines.get(accountId);
      if (candidate !== undefined && candidate.owner.connectionGeneration < connectionGeneration) {
        this.#candidatePipelines.delete(accountId);
      }
      return { kind: "CURRENT", owner: reconnected };
    }

    if (current.identity.kind === "CANONICAL" && epoch.identity.kind === "CANONICAL" &&
      current.identity.lineage === epoch.identity.lineage) {
      if (epoch.identity.generation <= current.identity.generation) return null;
      return { kind: "CANDIDATE", owner: proposed(current.legacyHandoverUsed) };
    }

    const feedHasNoOwner = this.#feeds.snapshot(accountId).sourceId === null;
    if (connectionGeneration > current.connectionGeneration || feedHasNoOwner) {
      return { kind: "CANDIDATE", owner: proposed(current.legacyHandoverUsed) };
    }

    // Legacy fixtures have no observer lineage. Preserve one bounded
    // same-connection handover after the pinned source is silent; modern
    // sources use canonical epochs and can advance indefinitely by watermark.
    if (current.identity.kind === "LEGACY" && epoch.identity.kind === "LEGACY" &&
      !current.legacyHandoverUsed) {
      const lastSeenAtMs = this.#lastEnvelopeAtMsBySource.get(current.sourceId);
      if (lastSeenAtMs !== undefined && this.#now() - lastSeenAtMs > this.#freshnessMs) {
        return { kind: "CANDIDATE", owner: proposed(true) };
      }
    }
    return null;
  }

  #activePipeline(accountId: string): DecodePipeline {
    const existing = this.#activePipelines.get(accountId);
    if (existing !== undefined) return existing;
    const pipeline = createDecodePipeline();
    this.#activePipelines.set(accountId, pipeline);
    return pipeline;
  }

  #candidatePipeline(accountId: string, owner: AccountSourceOwner): DecodePipeline | null {
    const current = this.#candidatePipelines.get(accountId);
    if (current !== undefined && sameOwner(current.owner, owner)) return current.pipeline;
    if (current !== undefined && !candidateSupersedes(current.owner, owner)) return null;
    const pipeline = createDecodePipeline();
    this.#candidatePipelines.set(accountId, { owner, pipeline });
    return pipeline;
  }

  #promoteCandidate(accountId: string, owner: AccountSourceOwner, atMs: number): boolean {
    const candidate = this.#candidatePipelines.get(accountId);
    if (candidate === undefined || !sameOwner(candidate.owner, owner)) return false;
    const snapshot = this.#feeds.snapshot(accountId);
    if (snapshot.sourceId !== null && snapshot.sourceEpoch !== null) {
      const invalidation = this.#feeds.accept({ kind: "INVALIDATE", accountId,
        sourceId: snapshot.sourceId, sourceEpoch: snapshot.sourceEpoch, atMs, reason: "SOURCE_REPLACED" });
      if (!invalidation.accepted) return false;
    }
    const previous = this.#accountOwners.get(accountId);
    if (previous !== undefined) this.#lastEnvelopeAtMsBySource.delete(previous.sourceId);
    this.#accountOwners.set(accountId, owner);
    this.#activePipelines.set(accountId, candidate.pipeline);
    this.#candidatePipelines.delete(accountId);
    this.#lastEnvelopeAtMsBySource.set(owner.sourceId, this.#now());
    return true;
  }

  #applyDecision(decision: FeedDecision): boolean {
    if (decision.publish === null) return false;
    this.#catalogs.set(decision.publish.catalog.accountId, decision.publish.catalog);
    this.#publish?.(decision.publish.catalog, decision.publish.snapshotState);
    return true;
  }
}

function accountIdForLobby(lobby: ChromeBridgeEnvelope["lobby"]): string | null {
  const provider = lobby === "KSPORT" || lobby === "SBO" ? "SBOBET"
    : lobby === "TSPORT" ? "APSPORT"
    : lobby === "CMD" || lobby === "IM" || lobby === "SABA" || lobby === "BTI" ? lobby
    : null;
  return provider === null ? null : `catalog-source:${provider}:FOOTBALL`;
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

function sameOwnerEpoch(owner: AccountSourceOwner, sourceId: string, sourceEpoch: string): boolean {
  return owner.sourceId === sourceId && owner.sourceEpoch === sourceEpoch;
}

function sameOwner(left: AccountSourceOwner, right: AccountSourceOwner): boolean {
  return left.connectionGeneration === right.connectionGeneration && left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch;
}

function candidateSupersedes(current: AccountSourceOwner, proposed: AccountSourceOwner): boolean {
  if (proposed.connectionGeneration !== current.connectionGeneration) {
    return proposed.connectionGeneration > current.connectionGeneration;
  }
  return current.identity.kind === "CANONICAL" && proposed.identity.kind === "CANONICAL" &&
    current.identity.lineage === proposed.identity.lineage &&
    proposed.identity.generation > current.identity.generation;
}

function createDecodePipeline(): DecodePipeline {
  return { router: new AdapterRouter([new CmdHttpCatalogAdapter(), new CmdDomCatalogAdapter(),
    new ImHttpCatalogAdapter(), new SabaWsCatalogAdapter(), new KsportWsCatalogAdapter(),
    new TsportWsCatalogAdapter(), new BtiHttpCatalogAdapter()], { confirmationsRequired: 1 }),
  networkBodies: new NetworkBodyAssembler() };
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
  return { ...current, rejectedMarketCount: Math.max(retained.rejectedMarketCount, current.rejectedMarketCount),
    events: [...events.values()], markets: [...markets.values()], quotes: [...quotes.values()] };
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
  return { ...retained, rejectedMarketCount: Math.max(retained.rejectedMarketCount, current.rejectedMarketCount),
    events, markets, quotes };
}

function marketSemanticKey(market: ObservedProviderCatalog["markets"][number]): string {
  return `${market.providerEventId}|${market.marketType}|${market.scope}|${market.line ?? ""}`;
}

function quoteSemanticKey(quote: ObservedProviderCatalog["quotes"][number]): string {
  return `${quote.providerEventId}|${quote.marketType}|${quote.scope}|${quote.line ?? ""}|${quote.selection}`;
}
