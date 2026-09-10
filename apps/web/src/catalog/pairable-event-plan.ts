import type { ProviderMarket } from "@tool-chenh/contracts";
import type { CatalogReadResult, LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const footballPlanningMarkets = [
  ["FT_TOTAL", "FULL_TIME"],
  ["CORNER_FT_TOTAL", "FULL_TIME"],
  ["CARD_FT_TOTAL", "FULL_TIME"]
] as const;

function planningMarkets(catalog: LiveCatalogResponse): readonly ProviderMarket[] {
  return catalog.events.flatMap((event) => {
    const templates = event.category === "LOL"
      ? [["SERIES_WINNER", "SERIES"]] as const
      : footballPlanningMarkets;
    return templates.map(([marketType, scope], index) => ({
      provider: event.provider,
      category: event.category,
      providerEventId: event.providerEventId,
      providerMarketId: `pairable-plan:${index}:${event.providerEventId}`,
      marketType,
      scope,
      line: marketType === "SERIES_WINNER" ? null : "2.5",
      settlementProfile: `pairable-plan:${marketType}`,
      status: "SUSPENDED"
    })) as readonly ProviderMarket[];
  });
}

/** Uses the production fixture matcher on lightweight roster projections. */
export function pairableEventIds(
  catalogs: readonly LiveCatalogResponse[]
): ReadonlyMap<string, ReadonlySet<string>> {
  const planned = catalogs.map((catalog) => ({
    ...catalog,
    markets: planningMarkets(catalog),
    quotes: []
  }));
  const result = new Map<string, Set<string>>(catalogs.map((catalog) => [catalog.accountId, new Set()]));
  for (const group of buildComparisonEvents(planned)) {
    if (new Set(group.providers).size < 2) continue;
    for (const source of group.catalogs) {
      const id = group.providerEventIds[source.provider];
      if (id !== undefined) result.get(source.accountId)?.add(id);
    }
  }
  return result;
}

export async function hydratePairableCatalogs(options: {
  readonly accountIds: readonly string[];
  readonly existingCatalogs: readonly LiveCatalogResponse[];
  readonly readRoster: (accountId: string) => Promise<CatalogReadResult>;
  readonly readEvents: (accountId: string, providerEventIds: readonly string[]) => Promise<CatalogReadResult>;
  readonly onRoster?: (catalog: LiveCatalogResponse) => void;
}): Promise<readonly PromiseSettledResult<CatalogReadResult>[]> {
  const rosterResults = await Promise.allSettled(options.accountIds.map(async (accountId) => {
    const result = await options.readRoster(accountId);
    options.onRoster?.(result.catalog);
    return result;
  }));
  const rosters = rosterResults.flatMap((result) => result.status === "fulfilled" ? [result.value.catalog] : []);
  const requested = new Set(options.accountIds);
  const plan = pairableEventIds([...rosters, ...options.existingCatalogs.filter((catalog) =>
    !requested.has(catalog.accountId))]);
  return Promise.allSettled(options.accountIds.map(async (accountId, index) => {
    const roster = rosterResults[index];
    if (roster?.status !== "fulfilled") throw roster?.reason ?? new Error("Catalog roster unavailable");
    const eventIds = [...(plan.get(accountId) ?? [])].sort();
    if (eventIds.length === 0) return roster.value;
    const detail = await options.readEvents(accountId, eventIds);
    // The detailed response intentionally contains markets only for fixtures that
    // can pair. Keep the full-roster coverage counters so the source card still
    // reports normalization across the whole book instead of that smaller subset.
    return roster.value.catalog.nativeCoverageByEvent === undefined ? detail : {
      ...detail,
      catalog: {
        ...detail.catalog,
        nativeCoverageByEvent: roster.value.catalog.nativeCoverageByEvent
      }
    };
  }));
}
