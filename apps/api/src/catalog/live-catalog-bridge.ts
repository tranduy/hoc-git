import type { ProviderAdapter, ProviderSink } from "@tool-chenh/adapters";
import type { Category, ProviderId, ProviderQuote } from "@tool-chenh/contracts";
import { normalizeName, type MappingPolicy } from "@tool-chenh/core";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const providers = ["CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"] as const;
const categories = ["FOOTBALL", "LOL"] as const;

class CatalogBridgeAdapter implements ProviderAdapter {
  readonly id: string;
  readonly categories: readonly Category[];
  readonly provider: ProviderId;
  readonly category: Category;
  #sink: ProviderSink | null = null;

  constructor(provider: ProviderId, category: Category) {
    this.provider = provider; this.category = category;
    this.id = `${provider}-catalog-bridge-${category}`;
    this.categories = [category];
  }

  async start(sink: ProviderSink, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    this.#sink = sink;
    signal.addEventListener("abort", () => { if (this.#sink === sink) this.#sink = null; }, { once: true });
  }

  publish(catalog: ObservedProviderCatalog): void {
    const sink = this.#sink;
    if (sink === null || catalog.provider !== this.provider || catalog.category !== this.category) return;
    for (const event of catalog.events) sink.onEvent(event);
    for (const market of catalog.markets) sink.onMarket(market);
    let degraded = false;
    for (const market of catalog.markets) {
      const quotes = catalog.quotes.filter((quote) => quote.provider === market.provider &&
        quote.category === market.category && quote.providerEventId === market.providerEventId &&
        quote.providerMarketId === market.providerMarketId);
      if (quotes.length === 0) continue;
      const sequences = new Set(quotes.map((quote) => quote.sequence));
      if (sequences.size !== 1) { degraded = true; continue; }
      const sequence = quotes[0]!.sequence;
      sink.onQuoteUpdate({ source: { provider: catalog.provider, category: catalog.category },
        kind: "FULL_SNAPSHOT", transport: "POLLING", sequence,
        clock: { monotonicNowMs: newestReceivedClock(quotes), wallClockNowMs: catalog.observedAtMs }, quotes });
    }
    sink.onStatus({ adapterId: this.id, provider: catalog.provider, category: catalog.category,
      status: degraded ? "DEGRADED" : "LIVE", detail: null, updatedAtMs: catalog.observedAtMs });
  }
}

function newestReceivedClock(quotes: readonly ProviderQuote[]): number {
  return quotes.reduce((latest, quote) => Math.max(latest, quote.receivedMonotonicMs), 0);
}

export class LiveCatalogBridge {
  readonly adapters: readonly ProviderAdapter[];
  readonly mappingPolicy: MappingPolicy;
  readonly #bySource: ReadonlyMap<string, CatalogBridgeAdapter>;
  readonly #aliases: Record<Category, Record<string, string>>;

  constructor() {
    this.#aliases = { FOOTBALL: {}, LOL: {} };
    this.mappingPolicy = { prematchToleranceMs: 120_000, liveClockToleranceMs: 20_000,
      aliasRegistry: { version: "live-exact-normalized-v1", aliases: this.#aliases } };
    const adapters = providers.flatMap((provider) => categories.map((category) =>
      new CatalogBridgeAdapter(provider, category)));
    this.adapters = adapters;
    this.#bySource = new Map(adapters.map((adapter) => [`${adapter.provider}|${adapter.category}`, adapter]));
  }

  publish(catalog: ObservedProviderCatalog): void {
    for (const event of catalog.events) {
      for (const participant of [event.participantA, event.participantB]) {
        const normalized = normalizeName(participant);
        if (normalized.length > 0) this.#aliases[catalog.category][normalized] = normalized;
      }
    }
    this.#bySource.get(`${catalog.provider}|${catalog.category}`)?.publish(catalog);
  }
}
