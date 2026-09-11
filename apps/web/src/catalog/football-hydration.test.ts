import {expect,it} from "vitest";
import {resultCatalog} from "./result-opposition.fixture.js";
import {FootballHydrationSchedule,mergeHydratedCatalog} from "./football-hydration.js";
import {parseLiveCatalogResponse} from "../api/catalog.js";
import {buildComparisonEvents} from "./comparison.js";
import {rankTicketsForEvent} from "../watch/ranked-tickets.js";

function snapshot(at:number,mono:number) {
  const source=resultCatalog("BTI",false,["HOME","AWAY"]);
  return {...source,observedAtMs:at,observedMonotonicMs:mono,
    events:[{...source.events[0]!,providerEventId:"near",startAtUtcMs:3600000},
      {...source.events[0]!,providerEventId:"far",startAtUtcMs:30*3600000}],
    markets:["near","far"].map(id => ({...source.markets[0]!,providerEventId:id,marketType:"FT_AH" as const,line:"0.5"})),
    quotes:["near","far"].flatMap(id => source.quotes.map(q => {
      const {settlementProfile:_profile,...quote}=q as typeof q & {settlementProfile?:string};
      return {...quote,providerEventId:id,receivedMonotonicMs:mono,marketType:"FT_AH" as const,line:"0.5"};
    }))};
}

it("merges due IDs without deleting or renewing far receipts, including cache round trips", () => {
  const previous=snapshot(10000,1000);
  const fresh=snapshot(20010,11000);
  const incoming={...fresh,quotes:fresh.quotes.filter(q => q.providerEventId === "near")};
  const merged=mergeHydratedCatalog(previous,incoming,new Set(["near"]),fresh.events);
  expect(merged.quotes.find(q => q.providerEventId === "far")).toBe(previous.quotes[2]);
  expect(merged.eventReceiptAnchors?.find(a => a.providerEventId === "far"))
    .toMatchObject({observedAtMs:10000,observedMonotonicMs:1000});
  const cached=parseLiveCatalogResponse(JSON.parse(JSON.stringify(merged)),merged.accountId);
  expect(cached.eventReceiptAnchors).toEqual(merged.eventReceiptAnchors);
  const peer={...fresh,accountId:"CMD",provider:"CMD" as const,
    events:fresh.events.map(e => ({...e,provider:"CMD" as const})),
    markets:fresh.markets.map(m => ({...m,provider:"CMD" as const})),
    quotes:fresh.quotes.map(q => ({...q,provider:"CMD" as const}))};
  const event=buildComparisonEvents([cached,peer]).find(group => group.event.startAtUtcMs === 30*3600000)!;
  const ticket=rankTicketsForEvent({event,verified:new Map(),movements:[],selectedProviders:new Set(["BTI","CMD"]),
    nowMs:20010,urgent:false,observationPolicy:{currency:"VND",baseStake:"100000",minStake:"1",maxStake:"1000000",
      stakeStep:"1",balance:"1000000"}})[0]!;
  expect(ticket.observationAgeMs).toBe(10010);
  const unchanged=mergeHydratedCatalog(previous,{...incoming,quotes:previous.quotes.filter(q => q.providerEventId === "near")},
    new Set(["near"]),fresh.events);
  const unchangedAnchor=unchanged.eventReceiptAnchors!.find(a => a.providerEventId === "near")!;
  expect(unchangedAnchor.observedAtMs-unchangedAnchor.observedMonotonicMs).toBe(9000);
});

it("drops old epoch prices and truly removed fixtures while accepting incoming passive updates", () => {
  const previous=snapshot(10000,9000);
  const restarted=snapshot(20000,10);
  const merged=mergeHydratedCatalog(previous,{...restarted,quotes:restarted.quotes.filter(q => q.providerEventId === "near")},
    new Set(["near"]),restarted.events);
  expect(merged.quotes.every(q => q.providerEventId === "near")).toBe(true);
  const passive=mergeHydratedCatalog(previous,snapshot(11000,10000),new Set(["far"]),previous.events);
  expect(passive.quotes.find(q => q.providerEventId === "far")!.receivedMonotonicMs).toBe(10000);
  const removed=mergeHydratedCatalog(previous,previous,new Set(),previous.events.filter(e => e.providerEventId === "near"));
  expect(removed.quotes.some(q => q.providerEventId === "far")).toBe(false);
});

it("keeps newer receipts when an older subset response completes late", () => {
  const latest=snapshot(20000,11000),older=snapshot(10000,1000);
  expect(mergeHydratedCatalog(latest,older,new Set(["near"]),latest.events).quotes[0])
    .toBe(latest.quotes[0]);
});

it("hydrates far fixtures once per hour, promotes tiers immediately, and keeps passive detail idle", () => {
  const schedule=new FootballHydrationSchedule();
  const event=snapshot(10000,1000).events[1]!;
  expect(schedule.isDue("BTI",event,false,10000)).toBe(true);
  schedule.completed("BTI",[event],new Set(),10000);
  expect(schedule.isDue("BTI",event,false,10001)).toBe(false);
  schedule.invalidateAccount("BTI");
  expect(schedule.isDue("BTI",event,false,10001)).toBe(true);
  schedule.completed("BTI",[event],new Set(),10000);
  expect(schedule.isDue("BTI",event,false,3610000)).toBe(true);
  expect(schedule.isDue("BTI",{...event,startAtUtcMs:10000+3600000},true,10001)).toBe(true);
  expect(schedule.isDue("BTI",{...event,startAtUtcMs:10000+80*3600000},false,10001)).toBe(false);
  schedule.requestManual("BTI");
  expect(schedule.isDue("BTI",{...event,startAtUtcMs:10000+80*3600000},false,10001)).toBe(true);
  schedule.completed("BTI",[event],new Set(),10001);
  expect(schedule.isDue("BTI",{...event,startAtUtcMs:10000+80*3600000},false,10002)).toBe(false);
});
