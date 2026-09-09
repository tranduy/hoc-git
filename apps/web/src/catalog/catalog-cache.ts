import { parseLiveCatalogResponse, type LiveCatalogResponse } from "../api/catalog.js";

// v1 may contain event-only snapshots produced by the old football parser.
// Never resurrect those after reload because they make a healthy source look
// like it has no supported tickets.
export const LIVE_CATALOG_CACHE_KEY = "tool-chenh.live-catalog-cache.v2";
const MAX_CACHE_RECORDS = 5_000;
const MAX_CACHE_CODE_UNITS = 1_000_000;

export function loadCatalogCache(storage: Storage): readonly LiveCatalogResponse[] {
  try {
    const raw = storage.getItem(LIVE_CATALOG_CACHE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (typeof value !== "object" || value === null || typeof (value as { accountId?: unknown }).accountId !== "string") return [];
      try {
        return [parseLiveCatalogResponse(value, (value as { accountId: string }).accountId)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveCatalogCache(storage: Storage, catalogs: readonly LiveCatalogResponse[]): void {
  // A full multi-provider catalog exceeds localStorage's capacity. Count first:
  // serializing it on every price update still allocates the entire string even
  // when setItem later throws, blocking the UI and triggering large GC cycles.
  let records = 0;
  for (const catalog of catalogs) {
    records += catalog.events.length + catalog.markets.length + catalog.quotes.length +
      (catalog.nativeMarketObservations?.length ?? 0) + (catalog.nativeCoverageByEvent?.length ?? 0);
    if (records > MAX_CACHE_RECORDS) return;
  }
  try {
    const serialized = JSON.stringify(catalogs);
    if (serialized.length > MAX_CACHE_CODE_UNITS) return;
    storage.setItem(LIVE_CATALOG_CACHE_KEY, serialized);
  } catch {
    // A verified live read must still render when browser storage is unavailable or full.
  }
}
