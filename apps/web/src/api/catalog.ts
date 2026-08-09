import {
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  type ProviderEvent,
  type ProviderMarket,
  type ProviderQuote
} from "@tool-chenh/contracts";

export interface LiveCatalogResponse {
  readonly dataMode: "LIVE";
  readonly accountId: string;
  readonly provider: "CMD";
  readonly category: "FOOTBALL";
  readonly comparisonState: "AWAITING_SECOND_PROVIDER";
  readonly observedAtMs: number;
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
}

export interface CatalogApiLike {
  read(accountId: string): Promise<LiveCatalogResponse>;
}

export class CatalogApi implements CatalogApiLike {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = window.fetch.bind(window)) {
    this.#fetch = fetcher;
  }

  async read(accountId: string): Promise<LiveCatalogResponse> {
    const response = await this.#fetch(`/api/catalog/accounts/${encodeURIComponent(accountId)}`, {
      method: "GET",
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Live catalog request failed (${response.status})`);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("Invalid live catalog response");
    }
    if (typeof value !== "object" || value === null) throw new Error("Invalid live catalog response");
    const record = value as Record<string, unknown>;
    const events = ProviderEventSchema.array().safeParse(record.events);
    const markets = ProviderMarketSchema.array().safeParse(record.markets);
    const quotes = ProviderQuoteSchema.array().safeParse(record.quotes);
    if (
      record.dataMode !== "LIVE" || typeof record.accountId !== "string" || record.accountId !== accountId ||
      record.provider !== "CMD" || record.category !== "FOOTBALL" ||
      record.comparisonState !== "AWAITING_SECOND_PROVIDER" ||
      typeof record.observedAtMs !== "number" || !Number.isFinite(record.observedAtMs) ||
      !events.success || !markets.success || !quotes.success
    ) throw new Error("Invalid live catalog response");
    return {
      dataMode: "LIVE", accountId, provider: "CMD", category: "FOOTBALL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: record.observedAtMs,
      events: events.data, markets: markets.data, quotes: quotes.data
    };
  }
}
