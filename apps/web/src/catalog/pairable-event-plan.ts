import type { FootballCollectionPlan, ProviderId, ProviderMarket } from "@tool-chenh/contracts";
import type { CatalogReadResult, LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, type ComparisonEvent } from "./comparison.js";
import {FootballHydrationSchedule,mergeHydratedCatalog,sameHydrationClockEpoch} from "./football-hydration.js";

export function urgentFootballEventKeys(events: readonly ComparisonEvent[], nowMs: number): ReadonlySet<string> {
  const candidates = events.filter(group => group.event.category === "FOOTBALL" && !group.event.isLive &&
    new Set(group.providers).size >= 2 && group.event.startAtUtcMs > nowMs &&
    group.event.startAtUtcMs - nowMs < 3 * 3600000)
    .sort((a,b) => a.event.startAtUtcMs - b.event.startAtUtcMs || a.key.localeCompare(b.key));
  // Market families and supplemental two-book relations can describe the same
  // fixture. Connected native identities count once, across every book.
  const components: { ids:Set<string>; groups:ComparisonEvent[] }[] = [];
  for (const group of candidates) {
    const ids = new Set(Object.entries(group.providerEventIds).map(([provider,id]) => `${provider}:${id}`));
    const matches = components.filter(component => [...ids].some(id => component.ids.has(id)));
    const component = matches[0] ?? {ids:new Set<string>(),groups:[]};
    if (matches.length === 0) components.push(component);
    for (const other of matches.slice(1)) {
      for (const id of other.ids) component.ids.add(id);
      component.groups.push(...other.groups); components.splice(components.indexOf(other),1);
    }
    for (const id of ids) component.ids.add(id);
    component.groups.push(group);
  }
  return new Set(components.slice(0,5).flatMap(component => component.groups.map(group => group.key)));
}

let cachedPlanningSignature = "";
let cachedPlanningGroups: readonly ComparisonEvent[] = [];

function planningGroups(sources: readonly LiveCatalogResponse[]): readonly ComparisonEvent[] {
  const signature = JSON.stringify(sources.map(catalog => [catalog.accountId,catalog.provider,
    catalog.events.map(({liveState:_liveState,...event}) => event)]));
  if (signature !== cachedPlanningSignature) {
    cachedPlanningGroups = buildComparisonEvents(sources.map(catalog => ({...catalog,
      markets:planningMarkets(catalog), quotes:[],nativeMarketObservations:[]})));
    cachedPlanningSignature = signature;
  }
  return cachedPlanningGroups;
}

export function footballCollectionPlans(catalogs: readonly LiveCatalogResponse[], nowMs: number,
  revision: number): ReadonlyMap<ProviderId, FootballCollectionPlan> {
  const sources = catalogs.filter(catalog => catalog.category === "FOOTBALL");
  const groups = planningGroups(sources);
  const urgentKeys = urgentFootballEventKeys(groups,nowMs);
  const urgentIds = new Map<ProviderId, Set<string>>();
  const pairableIds = new Map<ProviderId, Set<string>>();
  for (const group of groups) {
    if (new Set(group.providers).size < 2) continue;
    for (const provider of group.providers) {
      const id = group.providerEventIds[provider];
      if (id === undefined) continue;
      const paired = pairableIds.get(provider) ?? new Set<string>();
      paired.add(id); pairableIds.set(provider,paired);
      if (urgentKeys.has(group.key)) {
        const urgent = urgentIds.get(provider) ?? new Set<string>();
        urgent.add(id); urgentIds.set(provider,urgent);
      }
    }
  }
  const plans = new Map<ProviderId, FootballCollectionPlan>();
  for (const catalog of sources) {
    const previous = plans.get(catalog.provider)?.events ?? [];
    const events = new Map(previous.map(event => [event.eventId,event]));
    for (const event of catalog.events) {
      if (event.category !== "FOOTBALL" || event.isVirtual !== false ||
        pairableIds.get(catalog.provider)?.has(event.providerEventId) !== true) continue;
      events.set(event.providerEventId,{eventId:event.providerEventId,
        startAtUtcMs:Number.isFinite(event.startAtUtcMs) && event.startAtUtcMs > 0 ? event.startAtUtcMs : null,
        isLive:event.isLive, urgent:urgentIds.get(catalog.provider)?.has(event.providerEventId) ?? false});
    }
    plans.set(catalog.provider,{revision,events:[...events.values()].sort((a,b) => a.eventId.localeCompare(b.eventId))});
  }
  return plans;
}

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
  const result = new Map<string, Set<string>>(catalogs.map((catalog) => [catalog.accountId, new Set()]));
  for (const group of planningGroups(catalogs)) {
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
  readonly retainedCatalogs?: readonly LiveCatalogResponse[];
  readonly hydrationSchedule?: FootballHydrationSchedule;
  readonly nowMs?: number;
  readonly force?: boolean;
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
  const allRosters=[...rosters,...options.existingCatalogs.filter(catalog => !requested.has(catalog.accountId))];
  const plan = pairableEventIds(allRosters);
  const nowMs=options.nowMs ?? Date.now();
  const collectionPlans=options.hydrationSchedule === undefined ? new Map<ProviderId,FootballCollectionPlan>() :
    footballCollectionPlans(allRosters,nowMs,nowMs);
  return Promise.allSettled(options.accountIds.map(async (accountId, index) => {
    const roster = rosterResults[index];
    if (roster?.status !== "fulfilled") throw roster?.reason ?? new Error("Catalog roster unavailable");
    const previous=(options.retainedCatalogs ?? options.existingCatalogs).find(catalog => catalog.accountId === accountId);
    const urgentIds=new Set(collectionPlans.get(roster.value.catalog.provider)?.events.filter(event => event.urgent)
      .map(event => event.eventId));
    const pairableIds=plan.get(accountId) ?? new Set<string>();
    const dueEvents=roster.value.catalog.events.filter(event => pairableIds.has(event.providerEventId) &&
      (options.hydrationSchedule === undefined || options.force === true ||
        options.hydrationSchedule.isDue(accountId,event,urgentIds.has(event.providerEventId),nowMs)));
    const eventIds=dueEvents.map(event => event.providerEventId).sort();
    if (eventIds.length === 0) {
      if (options.hydrationSchedule === undefined || previous === undefined) return roster.value;
      const sameRoster=JSON.stringify(previous.events) === JSON.stringify(roster.value.catalog.events);
      const catalog=sameRoster ? previous : mergeHydratedCatalog(previous,previous,new Set(),roster.value.catalog.events);
      return {...roster.value,catalog:roster.value.catalog.snapshotState === "STALE" ? {...catalog,snapshotState:"STALE"} : catalog};
    }
    const detail = await options.readEvents(accountId, eventIds);
    if (previous !== undefined && detail.catalog.observedAtMs >= previous.observedAtMs &&
      !sameHydrationClockEpoch(previous,detail.catalog)) options.hydrationSchedule?.invalidateAccount(accountId);
    options.hydrationSchedule?.completed(accountId,dueEvents,urgentIds,nowMs);
    const hydrated=options.hydrationSchedule === undefined ? detail : {...detail,
      catalog:mergeHydratedCatalog(previous,detail.catalog,new Set(eventIds),roster.value.catalog.events)};
    // The detailed response intentionally contains markets only for fixtures that
    // can pair. Keep the full-roster coverage counters so the source card still
    // reports normalization across the whole book instead of that smaller subset.
    return roster.value.catalog.nativeCoverageByEvent === undefined ? hydrated : {
      ...hydrated,
      catalog: {
        ...hydrated.catalog,
        nativeCoverageByEvent: roster.value.catalog.nativeCoverageByEvent
      }
    };
  }));
}
