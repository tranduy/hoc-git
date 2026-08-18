import { CatalogSourceStatusSchema, type CatalogSourceStatus, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
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
  readonly publish?: (catalog: ObservedProviderCatalog) => void;
}

export class ChromeCatalogDataPlane {
  readonly #now: () => number;
  readonly #freshnessMs: number;
  readonly #maxEnvelopeAgeMs: number;
  readonly #publish: ((catalog: ObservedProviderCatalog) => void) | null;
  readonly #router = new AdapterRouter([new CmdDomCatalogAdapter(), new ImHttpCatalogAdapter(),
    new SabaWsCatalogAdapter(), new KsportWsCatalogAdapter(), new TsportWsCatalogAdapter(),
    new BtiHttpCatalogAdapter()],
    { confirmationsRequired: 1 });
  readonly #networkBodies = new NetworkBodyAssembler();
  readonly #catalogs = new Map<string, ObservedProviderCatalog>();
  readonly #lastTransportAtMs = new Map<string, number>();

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
    if (transportAccountId !== null) this.#lastTransportAtMs.set(transportAccountId, envelope.observedAtMs);
    const assembled = this.#networkBodies.ingest(envelope);
    if (assembled === null) return false;
    const route = this.#router.route(assembled);
    if (route.status !== "TRUSTED" || route.adapter === null) return false;
    const update = route.adapter.decode(assembled).at(-1);
    if (update === undefined || !isObservedCatalog(update.value)) return false;
    if (update.value.category !== "FOOTBALL") return false;
    // A provider page can briefly render the event shell before its market
    // rows. Such a snapshot is transport-valid but unusable for comparison;
    // publishing it would erase the last complete catalog on every refresh.
    if (update.value.events.length > 0 &&
      (update.value.markets.length === 0 || update.value.quotes.length === 0)) return false;
    this.#catalogs.set(update.value.accountId, update.value);
    this.#publish?.(update.value);
    return true;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const catalog = this.#catalogs.get(accountId);
    if (catalog === undefined) throw new Error("CHROME_CATALOG_NOT_FOUND");
    if (this.#now() - catalog.observedAtMs > this.#freshnessMs) throw new Error("CHROME_CATALOG_STALE");
    return catalog;
  }

  async overlayStatuses(statuses: readonly CatalogSourceStatus[]): Promise<readonly CatalogSourceStatus[]> {
    return statuses.map((status) => {
      const catalog = this.#catalogs.get(status.id);
      const fresh = catalog !== undefined && this.#now() - catalog.observedAtMs <= this.#freshnessMs;
      const transportAtMs = this.#lastTransportAtMs.get(status.id);
      const transportFresh = transportAtMs !== undefined && this.#now() - transportAtMs <= this.#freshnessMs;
      if (fresh || (catalog !== undefined && transportFresh)) {
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
