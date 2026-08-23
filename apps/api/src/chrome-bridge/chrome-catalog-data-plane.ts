import { CatalogSourceStatusSchema, type CatalogSourceStatus, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogCoverageGuard } from "../catalog/catalog-coverage-guard.js";
import { AdapterRouter } from "./adapter-router.js";
import { CmdDomCatalogAdapter } from "./cmd-dom-adapter.js";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { SbobetSocketIoCatalogAdapter } from "./sbobet-socketio-adapter.js";
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
  readonly #router = new AdapterRouter([new CmdHttpCatalogAdapter(), new CmdDomCatalogAdapter(), new ImHttpCatalogAdapter(),
    new SabaWsCatalogAdapter(), new KsportWsCatalogAdapter(),
    new SbobetSocketIoCatalogAdapter("KSPORT"), new SbobetSocketIoCatalogAdapter("SBO"), new TsportWsCatalogAdapter(),
    new BtiHttpCatalogAdapter()],
    { confirmationsRequired: 1 });
  readonly #networkBodies = new NetworkBodyAssembler();
  readonly #coverage = new CatalogCoverageGuard();
  readonly #feeds: ProviderFeedRegistry;
  readonly #catalogs = new Map<string, ObservedProviderCatalog>();
  readonly #sourceEpochs = new Map<string, string>();
  readonly #activeSourceIds = new Map<string, string>();
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

  ingest(envelope: ChromeBridgeEnvelope): boolean {
    const ageMs = this.#now() - envelope.observedAtMs;
    const replayed = envelope.request.replayed === true;
    if (!Number.isFinite(ageMs) ||
      (ageMs > this.#maxEnvelopeAgeMs && (!replayed || ageMs > 86_400_000))) return false;
    const transportAccountId = accountIdForLobby(envelope.lobby);
    if (transportAccountId === null) return false;
    const sourceEpoch = envelope.sourceEpoch ?? legacySourceEpoch(envelope.sourceId);
    let published = false;
    if (transportAccountId !== null) {
      const previousSourceId = this.#activeSourceIds.get(transportAccountId);
      if (previousSourceId !== undefined && previousSourceId !== envelope.sourceId) {
        // Two attached tabs can feed one account (e.g. a KSPORT tab and an SBO
        // tab both map to SBOBET). Alternating between them reset each
        // other's decoder on every envelope, so neither ever completed a
        // baseline. Keep the pinned source while it is still talking and
        // ignore the other tab; hand over only once the pinned tab is silent.
        // A replacement tab of the same lobby (Reset/recovery) takes over at
        // once: the old tab was closed by the extension. Only a different
        // lobby competing for the same account is held back.
        const previousSeenAtMs = this.#lastEnvelopeAtMsBySource.get(previousSourceId);
        const sameLobby = previousSourceId.split(":")[1] === envelope.lobby;
        if (!sameLobby && previousSeenAtMs !== undefined && this.#now() - previousSeenAtMs <= this.#freshnessMs) {
          return false;
        }
        published = this.#invalidateCurrent(transportAccountId, envelope.observedAtMs, "SOURCE_REPLACED") || published;
        this.#router.resetSource(previousSourceId);
        this.#networkBodies.resetSource(previousSourceId);
        this.#sourceEpochs.delete(previousSourceId);
        this.#lastEnvelopeAtMsBySource.delete(previousSourceId);
      }
      this.#activeSourceIds.set(transportAccountId, envelope.sourceId);
      this.#lastEnvelopeAtMsBySource.set(envelope.sourceId, this.#now());
    }
    const priorEpoch = this.#sourceEpochs.get(envelope.sourceId);
    if (priorEpoch !== undefined && priorEpoch !== sourceEpoch) {
      published = this.#invalidateCurrent(transportAccountId, envelope.observedAtMs, "SOURCE_REPLACED") || published;
      this.#router.resetSource(envelope.sourceId);
      this.#networkBodies.resetSource(envelope.sourceId);
    }
    this.#sourceEpochs.set(envelope.sourceId, sourceEpoch);
    this.#feeds.accept({ kind: "TAB_REACHABLE", accountId: transportAccountId, sourceId: envelope.sourceId,
      sourceEpoch, atMs: envelope.observedAtMs });
    if (envelope.transport === "TAB_STATE") {
      this.#requestRecoveries();
      return published;
    }
    const assembled = this.#networkBodies.ingest(envelope);
    if (assembled === null) return published;
    const route = this.#router.route(assembled);
    if (route.status !== "TRUSTED" || route.adapter === null) return published;
    const update = route.adapter.decode(assembled).at(-1);
    if (update === undefined) return published;
    if (update.transportAlive === true) {
      const provenance = transportProvenance(envelope.transport);
      if (provenance !== null) this.#feeds.accept({ kind: "TRANSPORT", accountId: transportAccountId,
        sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, provenance,
        providerSequence: update.sequence });
      return published;
    }
    if (update.invalidateAccountId !== undefined) {
      return this.#applyDecision(this.#feeds.accept({ kind: "INVALIDATE", accountId: update.invalidateAccountId,
        sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, reason: update.reason })) || published;
    }
    if (!isObservedCatalog(update.value)) return published;
    let nextCatalog = update.value;
    if (envelope.lobby === "CMD" && envelope.transport === "DOM_SNAPSHOT" &&
      this.#feeds.snapshot(transportAccountId).lastCompleteBaselineAtMs !== null) {
      // Visible/virtualized DOM is diagnostic overlay evidence only. Once the
      // authenticated DataOdds baseline exists it must not replace or refresh
      // network prices, even if the visible viewport was observed later.
      return published;
    }
    if (envelope.lobby === "SABA" && envelope.transport === "DOM_SNAPSHOT") {
      const retained = this.#catalogs.get(nextCatalog.accountId);
      if (retained !== undefined) nextCatalog = overlaySabaDomCatalog(retained, nextCatalog);
    }
    if (nextCatalog.category !== "FOOTBALL" || nextCatalog.accountId !== transportAccountId) return published;
    // A provider page can briefly render the event shell before its market
    // rows. Such a snapshot is transport-valid but unusable for comparison;
    // publishing it would erase the last complete catalog on every refresh.
    if (nextCatalog.events.length > 0 &&
      (nextCatalog.markets.length === 0 || nextCatalog.quotes.length === 0)) return published;
    const mode = update.evidenceMode ?? (update.authoritativeBaseline === true ? "BASELINE" : "DELTA");
    const generation = update.generation ?? (mode === "BASELINE" && update.authoritativeBaseline === true
      ? `${sourceEpoch}:${update.sequence}` : null);
    if (generation === null) return published;
    const provenance = update.provenance ?? catalogProvenance(envelope.transport);
    const coverage = { generation, authoritativeBaseline: mode === "BASELINE",
      providerEventIds: nextCatalog.events.map((event) => event.providerEventId) };
    if (!this.#coverage.allows(nextCatalog.accountId, coverage)) return published;
    const decision = this.#feeds.accept({ kind: "CATALOG", accountId: nextCatalog.accountId,
      sourceId: update.sourceId, sourceEpoch, atMs: update.observedAtMs, generation, mode, provenance,
      providerTimestampMs: update.providerTimestampMs ?? null, catalog: nextCatalog });
    if (decision.accepted) this.#coverage.commit(nextCatalog.accountId, coverage);
    return this.#applyDecision(decision) || published;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    return this.#feeds.read(accountId);
  }

  restore(catalog: ObservedProviderCatalog): void {
    if (!this.owns(catalog.accountId) || catalog.category !== "FOOTBALL" ||
      catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return;
    this.#coverage.accept(catalog.accountId, { generation: `restored:${catalog.observedAtMs}`,
      authoritativeBaseline: false, providerEventIds: catalog.events.map((event) => event.providerEventId) });
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

  #invalidateCurrent(accountId: string, atMs: number, reason: "SOURCE_REPLACED"): boolean {
    const snapshot = this.#feeds.snapshot(accountId);
    if (snapshot.sourceId === null || snapshot.sourceEpoch === null) return false;
    return this.#applyDecision(this.#feeds.accept({ kind: "INVALIDATE", accountId,
      sourceId: snapshot.sourceId, sourceEpoch: snapshot.sourceEpoch, atMs, reason }));
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
