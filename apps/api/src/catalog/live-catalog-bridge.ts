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
  #pendingCatalog: ObservedProviderCatalog | null = null;
  #publishing = false;

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
    if (this.#sink === null || catalog.provider !== this.provider || catalog.category !== this.category) return;
    this.#pendingCatalog = catalog;
    if (this.#publishing) return;
    this.#publishing = true;
    setImmediate(() => this.#publishPending());
  }

  #publishPending(): void {
    const catalog = this.#pendingCatalog;
    const sink = this.#sink;
    this.#pendingCatalog = null;
    if (catalog === null || sink === null) { this.#publishing = false; return; }
    const operations: Array<() => void> = [];
    for (const event of catalog.events) operations.push(() => sink.onEvent(event));
    for (const market of catalog.markets) operations.push(() => sink.onMarket(market));
    let degraded = false;
    const quotesByMarket = new Map<string, ProviderQuote[]>();
    for (const quote of catalog.quotes) {
      const key = `${quote.provider}|${quote.category}|${quote.providerEventId}|${quote.providerMarketId}`;
      const values = quotesByMarket.get(key) ?? [];
      values.push(quote);
      quotesByMarket.set(key, values);
    }
    for (const market of catalog.markets) {
      const quotes = quotesByMarket.get(
        `${market.provider}|${market.category}|${market.providerEventId}|${market.providerMarketId}`) ?? [];
      if (quotes.length === 0) continue;
      const sequences = new Set(quotes.map((quote) => quote.sequence));
      if (sequences.size !== 1) { degraded = true; continue; }
      const sequence = quotes[0]!.sequence;
      operations.push(() => sink.onQuoteUpdate({ source: { provider: catalog.provider, category: catalog.category },
        kind: "FULL_SNAPSHOT", transport: "POLLING", sequence,
        clock: { monotonicNowMs: newestReceivedClock(quotes), wallClockNowMs: catalog.observedAtMs }, quotes }));
    }
    operations.push(() => sink.onStatus({ adapterId: this.id, provider: catalog.provider, category: catalog.category,
      status: degraded ? "DEGRADED" : "LIVE", detail: null, updatedAtMs: catalog.observedAtMs }));
    try {
      sink.beginBatch?.();
      for (const operation of operations) {
        try { operation(); } catch { /* one runtime callback must not lock the bridge queue */ }
      }
    } finally {
      sink.endBatch?.();
    }
    if (this.#pendingCatalog !== null) { setImmediate(() => this.#publishPending()); return; }
    this.#publishing = false;
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
