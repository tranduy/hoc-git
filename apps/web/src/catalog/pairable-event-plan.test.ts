import { describe, expect, it } from "vitest";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { hydratePairableCatalogs, pairableEventIds, footballCollectionPlans } from "./pairable-event-plan.js";
import {FootballHydrationSchedule} from "./football-hydration.js";

function catalog(provider: "SABA" | "BTI", eventIds: readonly string[]): LiveCatalogResponse {
  return {
    dataMode: "LIVE",
    accountId: `catalog-source:${provider}:FOOTBALL`,
    provider,
    category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER",
    snapshotState: "FRESH",
    observedAtMs: 1_800_000_000_000,
    rejectedMarketCount: 0,
    events: eventIds.map((id, index) => ({
      provider,
      category: "FOOTBALL",
      providerEventId: id,
      competition: index === 0 ? "Japan J2 League" : `${provider} unmatched league`,
      seasonStage: null,
      startAtUtcMs: 1_800_000_100_000 + index * 3_600_000,
      participantA: index === 0 ? "Mito Hollyhock" : `${provider} Home`,
      participantB: index === 0 ? "Omiya Ardija" : `${provider} Away`,
      eventScope: "REGULATION",
      bestOf: null,
      isLive: false,
      rematchCandidate: false,
      fixtureDiscriminator: null,
      isVirtual: false,
      sportVariant: "FOOTBALL",
      liveState: null
    })),
    markets: [],
    quotes: []
  };
}

describe("pairable event plan", () => {
  it("reads only due paired event subsets and retains the broad roster between tiers", async () => {
    const now=1_800_000_000_000;
    const sources=(["SABA","BTI"] as const).map(provider => {
      const source=catalog(provider,[`${provider}-near`,`${provider}-far`]);
      return {...source,observedMonotonicMs:100,events:source.events.map((event,i) => ({...event,
        competition:"League",participantA:i ? "Far Home" : "Near Home",participantB:i ? "Far Away" : "Near Away",
        startAtUtcMs:now+(i ? 30*3600000 : 3600000)}))};
    });
    const schedule=new FootballHydrationSchedule();
    const reads:readonly string[][]=[];
    const options={accountIds:sources.map(source => source.accountId),existingCatalogs:[],hydrationSchedule:schedule,
      nowMs:now,readRoster:async (id:string) => ({catalog:sources.find(s => s.accountId === id)!,revision:"roster"}),
      readEvents:async (id:string,ids:readonly string[]) => {
        (reads as string[][]).push([...ids]);return {catalog:sources.find(s => s.accountId === id)!,revision:"detail"};
      }};
    const first=await hydratePairableCatalogs(options);
    expect(reads.map(ids => ids.length)).toEqual([2,2]);
    const retained=first.flatMap(result => result.status === "fulfilled" ? [result.value.catalog] : []);
    await hydratePairableCatalogs({...options,existingCatalogs:retained,nowMs:now+1000});
    expect(reads).toHaveLength(2);
    const next=await hydratePairableCatalogs({...options,existingCatalogs:retained,nowMs:now+10000});
    expect(reads.slice(2)).toEqual([["SABA-near"],["BTI-near"]]);
    expect(next.flatMap(result => result.status === "fulfilled" ? result.value.catalog.events : [])).toHaveLength(4);
  });
  it("selects five unique globally matched fixtures and keeps unmatched roster IDs", () => {
    const now = 1_800_000_000_000;
    const sources = (["SABA", "BTI"] as const).map(provider => {
      const source = catalog(provider, ["seed"]);
      return { ...source, events: Array.from({length:8}, (_,i) => ({...source.events[0]!,
        providerEventId:`${provider}-${i}`, participantA:`${["Alpha","Bravo","Charlie","Delta","Echo","Foxtrot","Golf","Hotel"][i]} City`,
        participantB:`${["Indigo","Juliet","Kilo","Lima","Mike","November","Oscar","Papa"][i]} United`,
        startAtUtcMs:now + (i+1)*600000, competition:"Premier League"})) };
    });
    const plans = footballCollectionPlans(sources,now,1);
    expect(plans.get("SABA")!.events.filter(e => e.urgent).map(e => e.eventId))
      .toEqual(["SABA-0","SABA-1","SABA-2","SABA-3","SABA-4"]);
    expect(plans.get("BTI")!.events.filter(e => e.urgent)).toHaveLength(5);
    expect(plans.get("SABA")!.events).toHaveLength(8);
    expect(footballCollectionPlans(sources,now+3100000,2).get("BTI")!.events.filter(e => e.urgent))
      .toHaveLength(3);
  });
  it("publishes roster counts even when matching market hydration fails", async () => {
    const saba = catalog("SABA", ["saba-shared"]);
    const bti = catalog("BTI", ["bti-shared", "bti-only"]);
    const received: LiveCatalogResponse[] = [];
    const result = await hydratePairableCatalogs({ accountIds: [bti.accountId], existingCatalogs: [saba],
      readRoster: async () => ({ catalog: bti, revision: "roster" }),
      readEvents: async () => { throw new Error("CATALOG_TIMEOUT"); },
      onRoster: value => received.push(value) });
    expect(received).toEqual([bti]);
    expect(result[0]?.status).toBe("rejected");
  });
  it("keeps every provider event in a cross-book fixture and excludes isolated fixtures", () => {
    const saba = catalog("SABA", ["saba-shared", "saba-only"]);
    const bti = catalog("BTI", ["bti-shared", "bti-only"]);

    const result = pairableEventIds([saba, bti]);

    expect([...result.get(saba.accountId)!]).toEqual(["saba-shared"]);
    expect([...result.get(bti.accountId)!]).toEqual(["bti-shared"]);
  });

  it("hydrates all markets for shared fixtures and never requests isolated fixture markets", async () => {
    const saba = catalog("SABA", ["saba-shared", "saba-only"]);
    const bti = catalog("BTI", ["bti-shared", "bti-only"]);
    const fullCoverage = [{
      providerEventId: "saba-shared",
      normalized: 100,
      excluded: 20,
      unmapped: 30
    }];
    const sabaRoster = { ...saba, nativeCoverageByEvent: fullCoverage };
    const rosters = new Map([[saba.accountId, saba], [bti.accountId, bti]]);
    rosters.set(saba.accountId, sabaRoster);
    const selected = new Map<string, readonly string[]>();

    const results = await hydratePairableCatalogs({
      accountIds: [saba.accountId, bti.accountId],
      existingCatalogs: [],
      readRoster: async (accountId) => ({ catalog: rosters.get(accountId)!, revision: `${accountId}:roster` }),
      readEvents: async (accountId, ids) => {
        selected.set(accountId, ids);
        return { catalog: { ...rosters.get(accountId)!, nativeCoverageByEvent: [] },
          revision: `${accountId}:events` };
      }
    });

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(selected.get(saba.accountId)).toEqual(["saba-shared"]);
    expect(selected.get(bti.accountId)).toEqual(["bti-shared"]);
    expect(results[0]?.status === "fulfilled" &&
      results[0].value.catalog.nativeCoverageByEvent).toEqual(fullCoverage);
  });
});
