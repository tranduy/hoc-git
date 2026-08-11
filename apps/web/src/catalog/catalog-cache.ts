import { parseLiveCatalogResponse, type LiveCatalogResponse } from "../api/catalog.js";

export const LIVE_CATALOG_CACHE_KEY = "tool-chenh.live-catalog-cache.v1";

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
  try {
    storage.setItem(LIVE_CATALOG_CACHE_KEY, JSON.stringify(catalogs));
  } catch {
    // A verified live read must still render when browser storage is unavailable or full.
  }
}
