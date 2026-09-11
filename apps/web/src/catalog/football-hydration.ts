import {footballRefreshPolicy,type ProviderEvent,type ProviderId} from "@tool-chenh/contracts";
import type {LiveCatalogResponse} from "../api/catalog.js";

export class FootballHydrationSchedule {
  readonly #reads = new Map<string,{atMs:number;tier:string}>();
  readonly #manual = new Set<string>();
  requestManual(provider:ProviderId):void {this.#manual.add(provider);}
  invalidateAccount(accountId:string):void {
    for (const key of this.#reads.keys()) if (key.startsWith(`${accountId}:`)) this.#reads.delete(key);
  }
  isDue(accountId:string,event:ProviderEvent,urgent:boolean,nowMs:number):boolean {
    if (event.category !== "FOOTBALL") return true;
    if (this.#manual.has(event.provider)) return true;
    const policy=footballRefreshPolicy(event.startAtUtcMs,event.isLive,urgent,nowMs);
    if (policy.refreshMs === null) return false;
    const previous=this.#reads.get(`${accountId}:${event.providerEventId}`);
    return previous === undefined || previous.tier !== policy.tier || nowMs-previous.atMs >= policy.refreshMs;
  }
  completed(accountId:string,events:readonly ProviderEvent[],urgentIds:ReadonlySet<string>,nowMs:number):void {
    for (const event of events) this.#reads.set(`${accountId}:${event.providerEventId}`,{atMs:nowMs,
      tier:footballRefreshPolicy(event.startAtUtcMs,event.isLive,urgentIds.has(event.providerEventId),nowMs).tier});
    for (const event of events) this.#manual.delete(event.provider);
    while (this.#reads.size > 30000) this.#reads.delete(this.#reads.keys().next().value!);
  }
}

export function sameHydrationClockEpoch(previous:LiveCatalogResponse,incoming:LiveCatalogResponse):boolean {
  const previousMono=previous.observedMonotonicMs,incomingMono=incoming.observedMonotonicMs;
  return previous.accountId === incoming.accountId && previous.provider === incoming.provider &&
    previousMono !== undefined && incomingMono !== undefined && incomingMono >= previousMono &&
    Math.abs((previous.observedAtMs-previousMono)-(incoming.observedAtMs-incomingMono)) <= 1000;
}

/** Preserve quote objects and their ORIGINAL paired clocks when merging a subset. */
export function mergeHydratedCatalog(previous:LiveCatalogResponse|undefined,incoming:LiveCatalogResponse,
  wantedIds:ReadonlySet<string>,roster:readonly ProviderEvent[]):LiveCatalogResponse {
  const previousMono=previous?.observedMonotonicMs, incomingMono=incoming.observedMonotonicMs;
  if (previous !== undefined && incoming.observedAtMs < previous.observedAtMs) return previous;
  const sameEpoch=previous !== undefined && sameHydrationClockEpoch(previous,incoming);
  const liveIds=new Set(roster.map(event => event.providerEventId));
  const retain = (id:string):boolean => sameEpoch && liveIds.has(id) && !wantedIds.has(id);
  const replace = (id:string):boolean => liveIds.has(id) && wantedIds.has(id);
  const anchors=new Map<string,NonNullable<LiveCatalogResponse["eventReceiptAnchors"]>[number]>();
  const previousAnchors=new Map(previous?.eventReceiptAnchors?.map(anchor => [anchor.providerEventId,anchor]));
  if (sameEpoch) {
    for (const event of previous.events) if (retain(event.providerEventId)) anchors.set(event.providerEventId,
      previousAnchors.get(event.providerEventId) ?? {providerEventId:event.providerEventId,
        observedAtMs:previous.observedAtMs,observedMonotonicMs:previousMono!});
  }
  if (incomingMono !== undefined) for (const event of roster) if (replace(event.providerEventId)) {
    const freshAnchor={providerEventId:event.providerEventId,
      observedAtMs:incoming.observedAtMs,observedMonotonicMs:incomingMono};
    const oldAnchor=sameEpoch ? previousAnchors.get(event.providerEventId) ?? {
      providerEventId:event.providerEventId,observedAtMs:previous!.observedAtMs,observedMonotonicMs:previousMono!} : undefined;
    // Even a requested view can contain untouched quotes. Use the earlier
    // actual clock offset so wall-clock drift cannot renew those receipts.
    anchors.set(event.providerEventId,oldAnchor !== undefined && oldAnchor.observedAtMs-oldAnchor.observedMonotonicMs <
      freshAnchor.observedAtMs-freshAnchor.observedMonotonicMs ? oldAnchor : freshAnchor);
  }
  const merge = <T extends {readonly providerEventId:string}>(old:readonly T[]|undefined, fresh:readonly T[]|undefined):T[] =>
    [...(old ?? []).filter(item => retain(item.providerEventId)),...(fresh ?? []).filter(item => replace(item.providerEventId))];
  return {...incoming,events:roster,eventReceiptAnchors:[...anchors.values()],
    markets:merge(previous?.markets,incoming.markets),quotes:merge(previous?.quotes,incoming.quotes),
    nativeMarketObservations:merge(previous?.nativeMarketObservations,incoming.nativeMarketObservations)};
}
