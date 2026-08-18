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
  readonly snapshotState?: "FRESH" | "STALE";
  readonly rejectedMarketCount: number;
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
}

export interface CatalogApiLike {
  read(accountId: string): Promise<LiveCatalogResponse>;
}

export type CatalogReadErrorCode = "CATALOG_TIMEOUT" | "CATALOG_UNAVAILABLE" | "CATALOG_SCHEMA_ERROR";

export class CatalogReadError extends Error {
  readonly code: CatalogReadErrorCode;
  readonly status: number;

  constructor(code: CatalogReadErrorCode, status: number) {
    super(code === "CATALOG_TIMEOUT" ? "Live catalog request timed out" : code);
    this.name = "CatalogReadError";
    this.code = code;
    this.status = status;
  }
}

export function catalogRetryDelayMs(error: unknown): number {
  return error instanceof CatalogReadError && error.code === "CATALOG_TIMEOUT" ? 500 : 30_000;
}

function catalogErrorCode(value: unknown): CatalogReadErrorCode {
  if (typeof value === "object" && value !== null) {
    const code = (value as Record<string, unknown>).error;
    if (code === "CATALOG_TIMEOUT" || code === "CATALOG_UNAVAILABLE" || code === "CATALOG_SCHEMA_ERROR") return code;
  }
  return "CATALOG_UNAVAILABLE";
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
    (record.snapshotState !== undefined && record.snapshotState !== "FRESH" && record.snapshotState !== "STALE") ||
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
    snapshotState: record.snapshotState === "STALE" ? "STALE" : "FRESH",
    rejectedMarketCount: record.rejectedMarketCount,
    events: events.data, markets: markets.data, quotes: quotes.data
  };
}

export class CatalogApi implements CatalogApiLike {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #cache = new Map<string, { readonly etag: string; readonly catalog: LiveCatalogResponse }>();

  constructor(fetcher: typeof fetch = window.fetch.bind(window), timeoutMs = 10_000) {
    this.#fetch = fetcher;
    this.#timeoutMs = timeoutMs;
  }

  async read(accountId: string): Promise<LiveCatalogResponse> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const cached = this.#cache.get(accountId);
      const response = await this.#fetch(`/api/catalog/accounts/${encodeURIComponent(accountId)}`, {
        method: "GET", cache: "no-store", signal: controller.signal,
        ...(cached === undefined ? {} : { headers: { "if-none-match": cached.etag } })
      });
      if (response.status === 304) {
        if (cached === undefined) throw new Error("Invalid live catalog response");
        return cached.catalog;
      }
      if (!response.ok) {
        let errorBody: unknown = null;
        try { errorBody = await response.json(); } catch { /* fixed safe fallback below */ }
        throw new CatalogReadError(catalogErrorCode(errorBody), response.status);
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw new CatalogReadError("CATALOG_TIMEOUT", 0);
        throw new Error("Invalid live catalog response");
      }
      const catalog = parseLiveCatalogResponse(value, accountId);
      const etag = response.headers.get("etag");
      if (etag !== null && etag.length > 0) this.#cache.set(accountId, { etag, catalog });
      return catalog;
    } catch (error) {
      if (controller.signal.aborted) throw new CatalogReadError("CATALOG_TIMEOUT", 0);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
