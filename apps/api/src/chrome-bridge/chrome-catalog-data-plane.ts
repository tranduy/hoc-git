import { CatalogSourceStatusSchema, type CatalogSourceStatus, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogCoverageGuard } from "../catalog/catalog-coverage-guard.js";
import { AdapterRouter } from "./adapter-router.js";
import { CmdDomCatalogAdapter } from "./cmd-dom-adapter.js";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";
import { TsportWsCatalogAdapter } from "./tsport-ws-adapter.js";
import { NetworkBodyAssembler } from "./network-body-assembler.js";

export interface ChromeCatalogDataPlaneOptions {
  readonly now?: () => number;
  readonly freshnessMs?: number;
  readonly maxEnvelopeAgeMs?: number;
  readonly publish?: (catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => void;
}

export class ChromeCatalogDataPlane {
  readonly #now: () => number;
  readonly #freshnessMs: number;
  readonly #maxEnvelopeAgeMs: number;
  readonly #publish: ((catalog: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => void) | null;
  readonly #router = new AdapterRouter([new CmdDomCatalogAdapter(), new ImHttpCatalogAdapter(),
    new SabaWsCatalogAdapter(), new KsportWsCatalogAdapter(), new TsportWsCatalogAdapter(),
    new BtiHttpCatalogAdapter()],
    { confirmationsRequired: 1 });
  readonly #networkBodies = new NetworkBodyAssembler();
  readonly #coverage = new CatalogCoverageGuard();
  readonly #catalogs = new Map<string, ObservedProviderCatalog>();
  readonly #lastTransportAtMs = new Map<string, number>();
  readonly #transportStartedAtMs = new Map<string, number>();
  readonly #sourceEpochs = new Map<string, string>();
  readonly #activeSourceIds = new Map<string, string>();
  readonly #invalidatedAccounts = new Set<string>();

  constructor(options: ChromeCatalogDataPlaneOptions = {}) {
    this.#now = options.now ?? Date.now;
    // BTI and similar authenticated pages poll their live catalog every
    // 10-15 seconds. A five-second TTL made a healthy source oscillate between
    // LIVE and STALE for most of every poll interval.
    this.#freshnessMs = options.freshnessMs ?? 20_000;
    this.#maxEnvelopeAgeMs = options.maxEnvelopeAgeMs ?? 30_000;
    this.#publish = options.publish ?? null;
  }

  owns(accountId: string): boolean {
    // When the local Chrome bridge is enabled, every configured Football
    // source is bridge-owned. Missing decoders must fail closed instead of
    // silently launching a second Playwright browser per provider.
    return /^(?:catalog-source:)(?:CMD|IM|SABA|SBOBET|APSPORT|BTI):FOOTBALL$/u.test(accountId);
  }

  ingest(envelope: ChromeBridgeEnvelope): boolean {
    const ageMs = this.#now() - envelope.observedAtMs;
    if (!Number.isFinite(ageMs) || ageMs > this.#maxEnvelopeAgeMs) return false;
    const transportAccountId = accountIdForLobby(envelope.lobby);
    let stateChanged = false;
    if (transportAccountId !== null) {
      const previousSourceId = this.#activeSourceIds.get(transportAccountId);
      if (previousSourceId !== undefined && previousSourceId !== envelope.sourceId) {
        this.#router.resetSource(previousSourceId);
        this.#networkBodies.resetSource(previousSourceId);
        this.#sourceEpochs.delete(previousSourceId);
      }
      this.#activeSourceIds.set(transportAccountId, envelope.sourceId);
    }
    if (envelope.sourceEpoch !== undefined) {
      const priorEpoch = this.#sourceEpochs.get(envelope.sourceId);
      if (priorEpoch !== undefined && priorEpoch !== envelope.sourceEpoch) {
        this.#router.resetSource(envelope.sourceId);
        this.#networkBodies.resetSource(envelope.sourceId);
        if (transportAccountId !== null) {
          this.#coverage.reset(transportAccountId);
          stateChanged = this.#invalidate(transportAccountId) || stateChanged;
        }
      }
      this.#sourceEpochs.set(envelope.sourceId, envelope.sourceEpoch);
    }
    if (transportAccountId !== null) {
      if (!this.#lastTransportAtMs.has(transportAccountId)) {
        this.#transportStartedAtMs.set(transportAccountId, envelope.observedAtMs);
      }
      this.#lastTransportAtMs.set(transportAccountId, envelope.observedAtMs);
    }
    const assembled = this.#networkBodies.ingest(envelope);
    if (assembled === null) return stateChanged;
    const route = this.#router.route(assembled);
    if (route.status !== "TRUSTED" || route.adapter === null) return stateChanged;
    const update = route.adapter.decode(assembled).at(-1);
    if (update === undefined) return stateChanged;
    if (update.invalidateAccountId !== undefined) {
      return this.#invalidate(update.invalidateAccountId) || stateChanged;
    }
    if (!isObservedCatalog(update.value)) return stateChanged;
    if (update.value.category !== "FOOTBALL") return stateChanged;
    // A provider page can briefly render the event shell before its market
    // rows. Such a snapshot is transport-valid but unusable for comparison;
    // publishing it would erase the last complete catalog on every refresh.
    if (update.value.events.length > 0 &&
      (update.value.markets.length === 0 || update.value.quotes.length === 0)) return stateChanged;
    // A reconnecting delta-only feed can briefly publish a small viewport or
    // one channel before its full reset/done snapshot. Retain the last
    // complete catalog until the smaller event set is stable across three
    // identical reads; this prevents a transient partial update erasing most
    // of a provider's prices.
    if (!this.#coverage.accept(update.value.accountId,
      update.value.events.map((event) => event.providerEventId))) return stateChanged;
    this.#catalogs.set(update.value.accountId, update.value);
    this.#invalidatedAccounts.delete(update.value.accountId);
    this.#publish?.(update.value, "FRESH");
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

  async overlayStatuses(statuses: readonly CatalogSourceStatus[]): Promise<readonly CatalogSourceStatus[]> {
    return statuses.map((status) => {
      const catalog = this.#catalogs.get(status.id);
      const invalidated = this.#invalidatedAccounts.has(status.id);
      const fresh = !invalidated && catalog !== undefined && this.#now() - catalog.observedAtMs <= this.#freshnessMs;
      const transportAtMs = this.#lastTransportAtMs.get(status.id);
      const transportFresh = transportAtMs !== undefined && this.#now() - transportAtMs <= this.#freshnessMs;
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
