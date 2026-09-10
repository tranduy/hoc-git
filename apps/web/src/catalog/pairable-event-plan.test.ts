import { describe, expect, it } from "vitest";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { hydratePairableCatalogs, pairableEventIds } from "./pairable-event-plan.js";

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
