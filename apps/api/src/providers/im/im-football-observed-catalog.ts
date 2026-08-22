import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import type { ObservedProviderCatalog } from "../cmd/cmd-observed-catalog.js";
import type { ImFootballCatalogSnapshot } from "./im-football-browser-manager.js";

export interface ImFootballJitCatalogSource {
  readCatalogFromFabet(): Promise<ImFootballCatalogSnapshot>;
}

export class ImFootballObservedCatalogReader {
  readonly provider = "IM" as const;
  readonly #source: ImFootballJitCatalogSource;
  readonly #sequences = new Map<string, number>();

  constructor(options: { readonly source: ImFootballJitCatalogSource }) {
    this.#source = options.source;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const snapshot = await this.#source.readCatalogFromFabet();
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const normalized = normalizeSbobetCatalog(snapshot.records, {
      observedAtMs: snapshot.observedAtMs,
      receivedMonotonicMs: snapshot.receivedMonotonicMs,
      sequence,
      provider: "IM",
      settlementProfile: "football-regulation-including-added-time"
    });
    if (snapshot.records.length > 0 && normalized.events.length === 0) {
      throw new Error("IM_FOOTBALL_CATALOG_SCHEMA_ERROR");
    }
    this.#sequences.set(accountId, sequence);
    return {
      dataMode: "LIVE",
      accountId,
      provider: "IM",
      category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER",
      observedAtMs: snapshot.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events,
      markets: normalized.markets,
      quotes: normalized.quotes
    };
  }
}
