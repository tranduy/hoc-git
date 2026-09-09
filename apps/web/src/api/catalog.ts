import {
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  NativeMarketObservationSchema,
  ProviderIdSchema,
  CategorySchema,
  type Category,
  type ProviderId,
  type ProviderEvent,
  type ProviderMarket,
  type ProviderQuote
  , type NativeMarketObservation
} from "@tool-chenh/contracts";

export interface NativeCoverageByEvent {
  readonly providerEventId: string;
  readonly normalized: number;
  readonly excluded: number;
  readonly unmapped: number;
}

export interface LiveCatalogResponse {
  readonly dataMode: "LIVE";
  readonly accountId: string;
  readonly provider: ProviderId;
  readonly category: Category;
  readonly comparisonState: "AWAITING_SECOND_PROVIDER";
  readonly observedAtMs: number;
  /** Receipt clock captured together with observedAtMs in the source observer. */
  readonly observedMonotonicMs?: number;
  readonly snapshotState?: "FRESH" | "STALE";
  readonly rejectedMarketCount: number;
  readonly events: readonly ProviderEvent[];
  readonly markets: readonly ProviderMarket[];
  readonly quotes: readonly ProviderQuote[];
  readonly nativeMarketObservations?: readonly NativeMarketObservation[];
  readonly nativeCoverageByEvent?: readonly NativeCoverageByEvent[];
}

export interface CatalogApiLike {
  read(accountId: string): Promise<LiveCatalogResponse>;
  readRevision?(accountId: string): Promise<CatalogReadResult>;
}

export interface CatalogReadResult {
  readonly catalog: LiveCatalogResponse;
  readonly revision: string;
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

function parseNativeCoverage(value: unknown): readonly NativeCoverageByEvent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid live catalog response");
  const eventIds = new Set<string>();
  return value.map((item: unknown) => {
    if (typeof item !== "object" || item === null) throw new Error("Invalid live catalog response");
    const { providerEventId, normalized, excluded, unmapped } = item as Record<string, unknown>;
    if (typeof providerEventId !== "string" || providerEventId.trim().length === 0 || eventIds.has(providerEventId) ||
      typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 0 ||
      typeof excluded !== "number" || !Number.isSafeInteger(excluded) || excluded < 0 ||
      typeof unmapped !== "number" || !Number.isSafeInteger(unmapped) || unmapped < 0) {
      throw new Error("Invalid live catalog response");
    }
    eventIds.add(providerEventId);
    return { providerEventId, normalized, excluded, unmapped };
  });
}

export function parseLiveCatalogResponse(value: unknown, expectedAccountId: string): LiveCatalogResponse {
  if (typeof value !== "object" || value === null) throw new Error("Invalid live catalog response");
  const record = value as Record<string, unknown>;
  const nativeCoverageByEvent = parseNativeCoverage(record.nativeCoverageByEvent);
  const events = ProviderEventSchema.array().safeParse(record.events);
  const markets = ProviderMarketSchema.array().safeParse(record.markets);
  const quotes = ProviderQuoteSchema.array().safeParse(record.quotes);
  const nativeMarketObservations = NativeMarketObservationSchema.array().optional()
    .safeParse(record.nativeMarketObservations);
  const category = CategorySchema.safeParse(record.category);
  if (
    record.dataMode !== "LIVE" || typeof record.accountId !== "string" || record.accountId !== expectedAccountId ||
    !ProviderIdSchema.safeParse(record.provider).success || record.provider === "FABET" || !category.success ||
    record.comparisonState !== "AWAITING_SECOND_PROVIDER" ||
    (record.snapshotState !== undefined && record.snapshotState !== "FRESH" && record.snapshotState !== "STALE") ||
    typeof record.observedAtMs !== "number" || !Number.isFinite(record.observedAtMs) ||
    (record.observedMonotonicMs !== undefined && (typeof record.observedMonotonicMs !== "number" ||
      !Number.isFinite(record.observedMonotonicMs) || record.observedMonotonicMs < 0)) ||
    typeof record.rejectedMarketCount !== "number" || !Number.isSafeInteger(record.rejectedMarketCount) || record.rejectedMarketCount < 0 ||
    !events.success || !markets.success || !quotes.success || !nativeMarketObservations.success ||
    events.data.some((event) => event.category !== category.data || event.provider !== record.provider) ||
    markets.data.some((market) => market.category !== category.data || market.provider !== record.provider) ||
    quotes.data.some((quote) => quote.category !== category.data || quote.provider !== record.provider)
  ) throw new Error("Invalid live catalog response");
  return {
    dataMode: "LIVE", accountId: expectedAccountId, provider: record.provider as ProviderId, category: category.data,
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: record.observedAtMs,
    ...(record.observedMonotonicMs === undefined ? {} : { observedMonotonicMs: record.observedMonotonicMs }),
    snapshotState: record.snapshotState === "STALE" ? "STALE" : "FRESH",
    rejectedMarketCount: record.rejectedMarketCount,
    events: events.data, markets: markets.data, quotes: quotes.data,
    ...(nativeMarketObservations.data === undefined ? {} : {
      nativeMarketObservations: nativeMarketObservations.data
    }),
    ...(nativeCoverageByEvent === undefined ? {} : { nativeCoverageByEvent })
  };
}

export class CatalogApi implements CatalogApiLike {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #bodyTimeoutMs: number;
  readonly #nativeDetail: "full" | "summary" | "counts";
  readonly #cache = new Map<string, { readonly etag: string; readonly revision: string;
    readonly catalog: LiveCatalogResponse }>();
  readonly #inFlight = new Map<string, Promise<CatalogReadResult>>();

  constructor(fetcher: typeof fetch = window.fetch.bind(window), timeoutMs = 10_000,
    bodyTimeoutMs = timeoutMs, nativeDetail: "full" | "summary" | "counts" = "full") {
    this.#fetch = fetcher;
    this.#timeoutMs = timeoutMs;
    this.#bodyTimeoutMs = bodyTimeoutMs;
    this.#nativeDetail = nativeDetail;
  }

  async read(accountId: string): Promise<LiveCatalogResponse> {
    return (await this.readRevision(accountId)).catalog;
  }

  readRevision(accountId: string): Promise<CatalogReadResult> {
    const existing = this.#inFlight.get(accountId);
    if (existing !== undefined) return existing;
    // Initial loading and revision updates share the full transfer and validation.
    const request = this.#readRevision(accountId).finally(() => this.#inFlight.delete(accountId));
    this.#inFlight.set(accountId, request);
    return request;
  }

  async #readRevision(accountId: string): Promise<CatalogReadResult> {
    const controller = new AbortController();
    let timeout = window.setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const cached = this.#cache.get(accountId);
      const query = this.#nativeDetail === "full" ? "" : `?nativeDetail=${this.#nativeDetail}`;
      const response = await this.#fetch(`/api/catalog/accounts/${encodeURIComponent(accountId)}${query}`, {
        method: "GET", cache: "no-store", signal: controller.signal,
        ...(cached === undefined ? {} : { headers: { "if-none-match": cached.etag } })
      });
      if (controller.signal.aborted) throw new CatalogReadError("CATALOG_TIMEOUT", 0);
      // A separate transfer budget is opt-in; existing callers keep one deadline.
      if (this.#bodyTimeoutMs !== this.#timeoutMs) {
        window.clearTimeout(timeout);
        timeout = window.setTimeout(() => controller.abort(), this.#bodyTimeoutMs);
      }
      if (response.status === 304) {
        if (cached === undefined) throw new Error("Invalid live catalog response");
        return { catalog: cached.catalog, revision: cached.revision };
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
      const revisionHeader = response.headers.get("x-catalog-revision");
      const revision = revisionHeader?.trim() || etag?.replace(/^"|"$/gu, "") ||
        `${catalog.provider}-${catalog.category}-${catalog.observedAtMs}-${catalog.snapshotState ?? "FRESH"}` +
        (catalog.observedMonotonicMs === undefined ? "" : `-receipt:${catalog.observedMonotonicMs}`);
      const latest = this.#cache.get(accountId);
      if (latest !== undefined && latest.catalog.observedAtMs > catalog.observedAtMs) {
        return { catalog: latest.catalog, revision: latest.revision };
      }
      if (etag !== null && etag.length > 0) this.#cache.set(accountId, { etag, revision, catalog });
      return { catalog, revision };
    } catch (error) {
      if (controller.signal.aborted) throw new CatalogReadError("CATALOG_TIMEOUT", 0);
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
