import { CatalogSourceStatusSchema, type CatalogSourceStatus, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogCoverageGuard } from "../catalog/catalog-coverage-guard.js";
import { AdapterRouter } from "./adapter-router.js";
import { CmdDomCatalogAdapter } from "./cmd-dom-adapter.js";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { SbobetSocketIoCatalogAdapter } from "./sbobet-socketio-adapter.js";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";
import { TsportWsCatalogAdapter } from "./tsport-ws-adapter.js";
import { NetworkBodyAssembler } from "./network-body-assembler.js";

export interface ChromeCatalogDataPlaneOptions {
  readonly now?: () => number;
  readonly freshnessMs?: number;
  readonly maxEnvelopeAgeMs?: number;
  readonly publish?: (catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => void;
  /**
   * Automatic stall recovery. CMD and IM re-request their catalog in page on
   * every bridge reconnect, so they are excluded by default. The streaming
   * providers (SABA, SBOBET, APSPORT, BTI) cannot replay a WebSocket baseline
   * through CDP once it is lost, so a stalled catalog stays stale until the
   * provider tab is replaced with a fresh launch.
   */
  readonly recoveryAfterMs?: number;
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
  readonly #router = new AdapterRouter([new CmdDomCatalogAdapter(), new ImHttpCatalogAdapter(),
    new SabaWsCatalogAdapter(), new KsportWsCatalogAdapter(),
    new SbobetSocketIoCatalogAdapter("KSPORT"), new SbobetSocketIoCatalogAdapter("SBO"), new TsportWsCatalogAdapter(),
    new BtiHttpCatalogAdapter()],
    { confirmationsRequired: 1 });
  readonly #networkBodies = new NetworkBodyAssembler();
  readonly #coverage = new CatalogCoverageGuard();
  readonly #catalogs = new Map<string, ObservedProviderCatalog>();
  readonly #lastTransportAtMs = new Map<string, number>();
  readonly #transportStartedAtMs = new Map<string, number>();
  readonly #sourceEpochs = new Map<string, string>();
  readonly #activeSourceIds = new Map<string, string>();
  readonly #lastEnvelopeAtMsBySource = new Map<string, number>();
  readonly #invalidatedAccounts = new Set<string>();
  readonly #recoveryAfterMs: number;
  readonly #recoveryCooldownMs: number;
  readonly #recoverableAccountIds: ReadonlySet<string>;
  readonly #onSourceRecoveryNeeded: ((accountId: string) => void) | null;
  readonly #lastRecoveryAtMs = new Map<string, number>();
  readonly #lastDecodedAtMs = new Map<string, number>();
  readonly #startedAtMs: number;

  constructor(options: ChromeCatalogDataPlaneOptions = {}) {
    this.#now = options.now ?? Date.now;
    // BTI and similar authenticated pages poll their live catalog every
    // 10-15 seconds. A five-second TTL made a healthy source oscillate between
    // LIVE and STALE for most of every poll interval.
    this.#freshnessMs = options.freshnessMs ?? 20_000;
    this.#maxEnvelopeAgeMs = options.maxEnvelopeAgeMs ?? 30_000;
    this.#publish = options.publish ?? null;
    this.#recoveryAfterMs = options.recoveryAfterMs ?? 60_000;
    this.#recoveryCooldownMs = options.recoveryCooldownMs ?? 300_000;
    this.#recoverableAccountIds = options.recoverableAccountIds ?? DEFAULT_RECOVERABLE_ACCOUNTS;
    this.#onSourceRecoveryNeeded = options.onSourceRecoveryNeeded ?? null;
    this.#startedAtMs = this.#now();
  }

  owns(accountId: string): boolean {
    // When the local Chrome bridge is enabled, every configured Football
    // source is bridge-owned. Missing decoders must fail closed instead of
    // silently launching a second Playwright browser per provider.
    return /^(?:catalog-source:)(?:CMD|IM|SABA|SBOBET|APSPORT|BTI):FOOTBALL$/u.test(accountId);
  }

  ingest(envelope: ChromeBridgeEnvelope): boolean {
    const ageMs = this.#now() - envelope.observedAtMs;
    const replayed = envelope.request.replayed === true;
    if (!Number.isFinite(ageMs) ||
      (ageMs > this.#maxEnvelopeAgeMs && (!replayed || ageMs > 86_400_000))) return false;
    const transportAccountId = accountIdForLobby(envelope.lobby);
    let stateChanged = false;
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
        this.#router.resetSource(previousSourceId);
        this.#networkBodies.resetSource(previousSourceId);
        this.#sourceEpochs.delete(previousSourceId);
        this.#lastEnvelopeAtMsBySource.delete(previousSourceId);
      }
      this.#activeSourceIds.set(transportAccountId, envelope.sourceId);
      this.#lastEnvelopeAtMsBySource.set(envelope.sourceId, this.#now());
    }
    if (envelope.sourceEpoch !== undefined) {
      const priorEpoch = this.#sourceEpochs.get(envelope.sourceId);
      if (priorEpoch !== undefined && priorEpoch !== envelope.sourceEpoch) {
        this.#router.resetSource(envelope.sourceId);
        this.#networkBodies.resetSource(envelope.sourceId);
        if (transportAccountId !== null) {
          stateChanged = this.#invalidate(transportAccountId) || stateChanged;
        }
      }
      this.#sourceEpochs.set(envelope.sourceId, envelope.sourceEpoch);
    }
    // KSPORT heartbeats and analytics only prove that the tab exists. Its
    // catalog transport is the sportsbook STOMP socket, so only a routed
    // WebSocket frame may refresh transport liveness for this provider.
    if (transportAccountId !== null && envelope.lobby !== "KSPORT" && envelope.lobby !== "BTI") {
      if (!this.#lastTransportAtMs.has(transportAccountId)) {
        this.#transportStartedAtMs.set(transportAccountId, envelope.observedAtMs);
      }
      this.#lastTransportAtMs.set(transportAccountId, envelope.observedAtMs);
    }
    if (transportAccountId !== null && envelope.request.pathnameClass === "/__fieldline_heartbeat__") {
      // A tab that keeps heartbeating while its catalog stays stale is exactly
      // the lost-WebSocket-baseline case: the renderer is alive, the feed is not.
      this.#requestRecoveryIfStalled(transportAccountId);
    }
    const assembled = this.#networkBodies.ingest(envelope);
    if (assembled === null) return stateChanged;
    const route = this.#router.route(assembled);
    if (route.status !== "TRUSTED" || route.adapter === null) return stateChanged;
    const update = route.adapter.decode(assembled).at(-1);
    if (update === undefined) return stateChanged;
    // Any frame the provider adapter understood (including a liveness-only
    // STOMP/socket heartbeat) proves the sportsbook feed itself is alive.
    if (transportAccountId !== null) this.#lastDecodedAtMs.set(transportAccountId, envelope.observedAtMs);
    if (transportAccountId !== null && (envelope.lobby === "KSPORT" || envelope.lobby === "BTI")) {
      if (!this.#lastTransportAtMs.has(transportAccountId)) {
        this.#transportStartedAtMs.set(transportAccountId, envelope.observedAtMs);
      }
      this.#lastTransportAtMs.set(transportAccountId, envelope.observedAtMs);
    }
    if (update.transportAlive === true) return stateChanged;
    if (update.invalidateAccountId !== undefined) {
      return this.#invalidate(update.invalidateAccountId) || stateChanged;
    }
    if (!isObservedCatalog(update.value)) return stateChanged;
    let nextCatalog = update.value;
    if (envelope.lobby === "SABA" && envelope.transport === "DOM_SNAPSHOT") {
      const retained = this.#catalogs.get(nextCatalog.accountId);
      if (retained !== undefined) nextCatalog = overlaySabaDomCatalog(retained, nextCatalog);
    }
    if (nextCatalog.category !== "FOOTBALL") return stateChanged;
    // A provider page can briefly render the event shell before its market
    // rows. Such a snapshot is transport-valid but unusable for comparison;
    // publishing it would erase the last complete catalog on every refresh.
    if (nextCatalog.events.length > 0 &&
      (nextCatalog.markets.length === 0 || nextCatalog.quotes.length === 0)) return stateChanged;
    // A reconnecting delta-only feed can briefly publish a small viewport or
    // one channel before its full reset/done snapshot. Retain the last
    // complete catalog until the smaller event set is stable across three
    // identical reads; this prevents a transient partial update erasing most
    // of a provider's prices.
    if (update.authoritativeBaseline === true) this.#coverage.reset(nextCatalog.accountId);
    if (!this.#coverage.accept(nextCatalog.accountId,
      nextCatalog.events.map((event) => event.providerEventId))) return stateChanged;
    this.#catalogs.set(nextCatalog.accountId, nextCatalog);
    const snapshotState = this.#now() - nextCatalog.observedAtMs <= this.#freshnessMs ? "FRESH" : "STALE";
    if (snapshotState === "FRESH") this.#invalidatedAccounts.delete(nextCatalog.accountId);
    else this.#invalidatedAccounts.add(nextCatalog.accountId);
    this.#publish?.(nextCatalog, snapshotState);
    return true;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const catalog = this.#catalogs.get(accountId);
    if (catalog === undefined) throw new Error("CHROME_CATALOG_NOT_FOUND");
    if (this.#invalidatedAccounts.has(accountId) || this.#now() - catalog.observedAtMs > this.#freshnessMs) {
      throw new Error("CHROME_CATALOG_STALE");
    }
    return catalog;
  }

  restore(catalog: ObservedProviderCatalog): void {
    if (!this.owns(catalog.accountId) || catalog.category !== "FOOTBALL" ||
      catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return;
    this.#catalogs.set(catalog.accountId, catalog);
    this.#coverage.accept(catalog.accountId, catalog.events.map((event) => event.providerEventId));
    this.#invalidatedAccounts.add(catalog.accountId);
    this.#publish?.(catalog, "STALE");
  }

  resetCoverage(accountId?: string): void {
    if (accountId !== undefined) {
      this.#coverage.reset(accountId);
      return;
    }
    for (const id of this.#catalogs.keys()) this.#coverage.reset(id);
  }

  async overlayStatuses(statuses: readonly CatalogSourceStatus[]): Promise<readonly CatalogSourceStatus[]> {
    return statuses.map((status) => {
      const catalog = this.#catalogs.get(status.id);
      const invalidated = this.#invalidatedAccounts.has(status.id);
      const fresh = !invalidated && catalog !== undefined && this.#now() - catalog.observedAtMs <= this.#freshnessMs;
      const transportAtMs = this.#lastTransportAtMs.get(status.id);
      const transportFresh = transportAtMs !== undefined && this.#now() - transportAtMs <= this.#freshnessMs;
      if (!fresh && status.sessionState === "ACTIVE") this.#requestRecoveryIfStalled(status.id);
      if (fresh || (!invalidated && catalog !== undefined && transportFresh)) {
        return CatalogSourceStatusSchema.parse({ ...status, sessionState: "ACTIVE",
          acquiredAtMs: catalog.observedAtMs, reason: null });
      }
      // Authentication/bridge heartbeats only prove that a tab is reachable.
      // They must never promote a source to ACTIVE until a provider-specific
      // adapter has decoded a fresh, usable catalog from that tab.
      if (status.sessionState === "ACTIVE") {
        return CatalogSourceStatusSchema.parse({ ...status, sessionState: "ACTION_REQUIRED",
          acquiredAtMs: catalog?.observedAtMs ?? status.acquiredAtMs,
          reason: "PROVIDER_VALIDATION_FAILED" });
      }
      return status;
    });
  }

  /**
   * Requests a targeted tab replacement when a recoverable provider that once
   * delivered a catalog (or at least opened its transport) has been silent for
   * longer than `recoveryAfterMs`. A source that never produced anything is
   * left alone: after an API restart the tab may simply not have emitted its
   * first baseline yet, and replacing it would consume a one-time launch.
   */
  #requestRecoveryIfStalled(accountId: string): void {
    if (this.#onSourceRecoveryNeeded === null || !this.#recoverableAccountIds.has(accountId)) return;
    const candidates = [this.#catalogs.get(accountId)?.observedAtMs, this.#lastDecodedAtMs.get(accountId),
      this.#transportStartedAtMs.get(accountId)].filter((value): value is number => value !== undefined);
    if (candidates.length === 0) return;
    const lastSeenMs = Math.max(...candidates);
    // A catalog restored from disk at startup is old by definition; give the
    // attached tabs one full window to deliver their first live baseline.
    const stalledSinceMs = Math.max(lastSeenMs, this.#startedAtMs);
    // Tab heartbeats also count as transport for SABA/APSPORT, so transport
    // liveness must not gate recovery: the decisive signal is that no decoded
    // catalog has arrived for the whole recovery window.
    const now = this.#now();
    if (now - stalledSinceMs < this.#recoveryAfterMs) return;
    const lastRecoveryAtMs = this.#lastRecoveryAtMs.get(accountId) ?? Number.NEGATIVE_INFINITY;
    if (now - lastRecoveryAtMs < this.#recoveryCooldownMs) return;
    this.#lastRecoveryAtMs.set(accountId, now);
    try { this.#onSourceRecoveryNeeded(accountId); } catch { /* recovery is best-effort */ }
  }

  #invalidate(accountId: string): boolean {
    const catalog = this.#catalogs.get(accountId);
    if (catalog === undefined || this.#invalidatedAccounts.has(accountId)) return false;
    this.#invalidatedAccounts.add(accountId);
    this.#publish?.(catalog, "STALE");
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
