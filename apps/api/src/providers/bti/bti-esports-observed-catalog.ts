import { normalizeBtiLolRecords } from "@tool-chenh/adapters";
import type { ObservedProviderCatalog } from "../cmd/cmd-observed-catalog.js";
import type { BtiEsportsCatalogSnapshot } from "./bti-esports-source.js";

export class BtiEsportsObservedCatalogReader {
  readonly provider = "BTI" as const;
  readonly #source: { readCatalogFromFabet(): Promise<BtiEsportsCatalogSnapshot> };
  readonly #sequences = new Map<string, number>();

  constructor(options: { readonly source: { readCatalogFromFabet(): Promise<BtiEsportsCatalogSnapshot> } }) {
    this.#source = options.source;
  }

  async read(accountId: string): Promise<ObservedProviderCatalog> {
    const snapshot = await this.#source.readCatalogFromFabet();
    const sequence = (this.#sequences.get(accountId) ?? 0) + 1;
    const normalized = normalizeBtiLolRecords(snapshot.records, {
      receivedMonotonicMs: snapshot.receivedMonotonicMs, sequence
    });
    this.#sequences.set(accountId, sequence);
    return {
      dataMode: "LIVE", accountId, provider: "BTI", category: "LOL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: snapshot.observedAtMs,
      rejectedMarketCount: normalized.diagnostics.length,
      events: normalized.events, markets: normalized.markets, quotes: normalized.quotes
    };
  }
}
