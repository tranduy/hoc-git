import {
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  ProviderIdSchema,
  CategorySchema,
  type Category,
  type ProviderId,
  type ProviderEvent,
  type ProviderMarket,
  type ProviderQuote
} from "@tool-chenh/contracts";

export interface LiveCatalogResponse {
  readonly dataMode: "LIVE";
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly category: Category;
  readonly comparisonState: "AWAITING_SECOND_PROVIDER";
  readonly observedAtMs: number;
  readonly rejectedMarketCount: number;
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
}

export interface CatalogApiLike {
  read(accountId: string): Promise<LiveCatalogResponse>;
}

export function parseLiveCatalogResponse(value: unknown, expectedAccountId: string): LiveCatalogResponse {
  if (typeof value !== "object" || value === null) throw new Error("Invalid live catalog response");
  const record = value as Record<string, unknown>;
  const events = ProviderEventSchema.array().safeParse(record.events);
  const markets = ProviderMarketSchema.array().safeParse(record.markets);
  const quotes = ProviderQuoteSchema.array().safeParse(record.quotes);
  const category = CategorySchema.safeParse(record.category);
  if (
    record.dataMode !== "LIVE" || typeof record.accountId !== "string" || record.accountId !== expectedAccountId ||
    !ProviderIdSchema.safeParse(record.provider).success || record.provider === "FABET" || !category.success ||
    record.comparisonState !== "AWAITING_SECOND_PROVIDER" ||
    typeof record.observedAtMs !== "number" || !Number.isFinite(record.observedAtMs) ||
    typeof record.rejectedMarketCount !== "number" || !Number.isSafeInteger(record.rejectedMarketCount) || record.rejectedMarketCount < 0 ||
    !events.success || !markets.success || !quotes.success ||
    events.data.some((event) => event.category !== category.data || event.provider !== record.provider) ||
    markets.data.some((market) => market.category !== category.data || market.provider !== record.provider) ||
    quotes.data.some((quote) => quote.category !== category.data || quote.provider !== record.provider)
  ) throw new Error("Invalid live catalog response");
  return {
    dataMode: "LIVE", accountId: expectedAccountId, provider: record.provider as ProviderId, category: category.data,
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: record.observedAtMs,
    rejectedMarketCount: record.rejectedMarketCount,
    events: events.data, markets: markets.data, quotes: quotes.data
  };
}

export class CatalogApi implements CatalogApiLike {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(fetcher: typeof fetch = window.fetch.bind(window), timeoutMs = 12_000) {
    this.#fetch = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  async read(accountId: string): Promise<LiveCatalogResponse> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`/api/catalog/accounts/${encodeURIComponent(accountId)}`, {
        method: "GET", cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error(`Live catalog request failed (${response.status})`);
      let value: unknown;
      try {
        value = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw new Error("Live catalog request timed out");
        throw new Error("Invalid live catalog response");
      }
      return parseLiveCatalogResponse(value, accountId);
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Live catalog request timed out");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
