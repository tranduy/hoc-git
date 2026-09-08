import type { CmdCatalogInputRecord, CmdCatalogOptions } from "@tool-chenh/adapters";
import { describe, expect, it } from "vitest";
import type { NormalizedCatalogPart } from "./catalog-part-merge.js";
import { augmentSabaDomCleanSheet } from "./saba-clean-sheet-dom.js";

const OPTIONS: Pick<CmdCatalogOptions, "observedAtMs" | "receivedMonotonicMs" | "sequence"> = {
  observedAtMs: 1_788_800_000_000,
  receivedMonotonicMs: 123.5,
  sequence: 7
};
const LABELS = ["Giữ sạch lưới", "Đội Nhà Có", "Đội Nhà Không", "Đội Khách Có", "Đội Khách Không"];

function cleanSheetRecord(): CmdCatalogInputRecord {
  return { sportId: "1", leagueId: "league-1", leagueName: "League One", matchId: "133152892",
    timeText: "09/09 11:00PM", teamNames: ["Home", "Away"], groups: [{ betTypeIds: [], labels: LABELS,
      odds: ["2.72", "1.36", "3.60", "1.22"].map((priceText) => ({
        marketOddsId: "1054290306", priceText, status: null, greyedOut: null
      })) }] };
}

function normalizedCatalog(): NormalizedCatalogPart {
  return { diagnostics: ["existing-diagnostic"], events: [{
    provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
    competition: "League One", seasonStage: null, startAtUtcMs: 1_788_900_000_000,
    participantA: "Home", participantB: "Away", eventScope: "REGULATION", bestOf: null,
    isLive: false, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
    sportVariant: "FOOTBALL", liveState: null
  }], markets: [{ provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
    providerMarketId: "existing-total", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" }], quotes: [{
    provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
    providerMarketId: "existing-total", providerSelectionId: "existing-total:over",
    marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5", rawOdds: "0.91",
    rawFormat: "MALAY", status: "OPEN", isLive: false, sourceTimestampMs: null,
    receivedMonotonicMs: 100, sequence: 6
  }], nativeMarketObservations: [{ provider: "SABA", category: "FOOTBALL",
    providerEventId: "133152892", providerMarketId: "existing-total", nativeType: "3",
    nativeLabel: null, nativeScope: "FULL_TIME", outcomeLabels: ["OVER", "UNDER"],
    observedAtMs: OPTIONS.observedAtMs, disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED"
  }, { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
    providerMarketId: "1054290306", nativeType: "UNKNOWN", nativeLabel: LABELS.join(" | "),
    nativeScope: null, outcomeLabels: ["OUTCOME_1", "OUTCOME_2", "OUTCOME_3", "OUTCOME_4"],
    observedAtMs: OPTIONS.observedAtMs, disposition: "EXCLUDED", reason: "AMBIGUOUS_NATIVE_TYPE"
  }] };
}

describe("SABA DOM clean-sheet augmentation", () => {
  it("maps the exact public team clean-sheet proof and preserves the normalized catalog", () => {
    const result = augmentSabaDomCleanSheet(normalizedCatalog(), cleanSheetRecord(), OPTIONS);

    expect(result.diagnostics).toEqual(["existing-diagnostic"]);
    expect(result.events).toHaveLength(1);
    expect(result.markets).toEqual([
      expect.objectContaining({ providerMarketId: "existing-total", marketType: "FT_TOTAL" }),
      { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
        providerMarketId: "1054290306:home-clean-sheet", marketType: "HOME_FT_CLEAN_SHEET",
        scope: "FULL_TIME", line: null, settlementProfile: "football-home-clean-sheet", status: "OPEN" },
      { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
        providerMarketId: "1054290306:away-clean-sheet", marketType: "AWAY_FT_CLEAN_SHEET",
        scope: "FULL_TIME", line: null, settlementProfile: "football-away-clean-sheet", status: "OPEN" }
    ]);
    expect(result.quotes.slice(1)).toEqual([
      { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
        providerMarketId: "1054290306:home-clean-sheet",
        providerSelectionId: "1054290306:home-clean-sheet:yes", marketType: "HOME_FT_CLEAN_SHEET",
        scope: "FULL_TIME", selection: "YES", line: null, rawOdds: "2.72", rawFormat: "DECIMAL",
        status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 123.5, sequence: 7 },
      { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
        providerMarketId: "1054290306:home-clean-sheet",
        providerSelectionId: "1054290306:home-clean-sheet:no", marketType: "HOME_FT_CLEAN_SHEET",
        scope: "FULL_TIME", selection: "NO", line: null, rawOdds: "1.36", rawFormat: "DECIMAL",
        status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 123.5, sequence: 7 },
      { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
        providerMarketId: "1054290306:away-clean-sheet",
        providerSelectionId: "1054290306:away-clean-sheet:yes", marketType: "AWAY_FT_CLEAN_SHEET",
        scope: "FULL_TIME", selection: "YES", line: null, rawOdds: "3.6", rawFormat: "DECIMAL",
        status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 123.5, sequence: 7 },
      { provider: "SABA", category: "FOOTBALL", providerEventId: "133152892",
        providerMarketId: "1054290306:away-clean-sheet",
        providerSelectionId: "1054290306:away-clean-sheet:no", marketType: "AWAY_FT_CLEAN_SHEET",
        scope: "FULL_TIME", selection: "NO", line: null, rawOdds: "1.22", rawFormat: "DECIMAL",
        status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 123.5, sequence: 7 }
    ]);
    expect(result.nativeMarketObservations).toEqual([
      expect.objectContaining({ providerMarketId: "existing-total", nativeType: "3" }),
      expect.objectContaining({ providerMarketId: "1054290306", nativeType: "13",
        nativeScope: "FULL_TIME", outcomeLabels: ["HOME_YES", "HOME_NO", "AWAY_YES", "AWAY_NO"],
        disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" })
    ]);
  });

  it("accepts exact native type 13 and folded case, whitespace, and accents", () => {
    const record = cleanSheetRecord();
    const group = record.groups[0]!;
    const catalog = normalizedCatalog();
    const observations = catalog.nativeMarketObservations!;
    const result = augmentSabaDomCleanSheet(catalog, { ...record, groups: [{ ...group,
      betTypeIds: ["13"], labels: ["  GIU sach LUOI ", "doi nha co", "Đội nhà không",
        "đội khách có", "DOI KHACH KHONG"] }] }, OPTIONS);

    expect(result.markets).toHaveLength(3);
    expect(result.nativeMarketObservations).toHaveLength(2);
    expect(result.nativeMarketObservations![1]).toMatchObject({ nativeType: "13", disposition: "NORMALIZED" });
    expect(observations[1]).toMatchObject({ nativeType: "UNKNOWN" });
  });

  it.each([
    ["missing group", { groups: [] }],
    ["missing label", { groups: [{ ...cleanSheetRecord().groups[0]!, labels: LABELS.slice(0, 4) }] }],
    ["swapped labels", { groups: [{ ...cleanSheetRecord().groups[0]!,
      labels: [LABELS[0]!, LABELS[2]!, LABELS[1]!, LABELS[3]!, LABELS[4]!] }] }],
    ["half label", { groups: [{ ...cleanSheetRecord().groups[0]!,
      labels: ["Giữ sạch lưới Hiệp 1", ...LABELS.slice(1)] }] }],
    ["compound native type", { groups: [{ ...cleanSheetRecord().groups[0]!, betTypeIds: ["13", "25"] }] }],
    ["extra outcome", { groups: [{ ...cleanSheetRecord().groups[0]!, odds: [
      ...cleanSheetRecord().groups[0]!.odds, { marketOddsId: "1054290306", priceText: "1.5",
        status: null, greyedOut: null }] }] }],
    ["mixed market ids", { groups: [{ ...cleanSheetRecord().groups[0]!, odds:
      cleanSheetRecord().groups[0]!.odds.map((odd, index) => ({ ...odd,
        marketOddsId: index === 3 ? "other" : odd.marketOddsId })) }] }],
    ["non-decimal price", { groups: [{ ...cleanSheetRecord().groups[0]!, odds:
      cleanSheetRecord().groups[0]!.odds.map((odd, index) => ({ ...odd,
        priceText: index === 0 ? "0.72" : odd.priceText })) }] }]
  ])("refuses %s without partial augmentation", (_name, override) => {
    const catalog = normalizedCatalog();
    expect(augmentSabaDomCleanSheet(catalog, { ...cleanSheetRecord(), ...override }, OPTIONS)).toBe(catalog);
  });

  it.each(["CORNERS", "CARDS", "AGGREGATE", "VIRTUAL"] as const)(
    "refuses a non-GOALS %s event", (scope) => {
      const catalog = normalizedCatalog();
      const event = catalog.events[0]!;
      const record = cleanSheetRecord();
      const scopedRecord = scope === "CORNERS" ? { ...record, leagueName: "League One - CORNERS",
        teamNames: ["Home No. of Corners", "Away No. of Corners"] }
        : scope === "CARDS" ? { ...record, leagueName: "League One - BOOKING",
          teamNames: ["Home Total Booking", "Away Total Booking"] }
          : scope === "AGGREGATE" ? { ...record, leagueName: "League One - Đội Nhà / Đội Khách",
            teamNames: ["Đội Nhà - 1X2 - 3 Trận Đấu", "Đội Khách - 1X2 - 3 Trận Đấu"] }
            : record;
      const scopedEvent = { ...event, competition: scopedRecord.leagueName,
        participantA: scopedRecord.teamNames[0]!, participantB: scopedRecord.teamNames[1]!,
        ...(scope === "VIRTUAL" ? { isVirtual: true } : {}) };
      const scopedCatalog = { ...catalog, events: [scopedEvent] };

      expect(augmentSabaDomCleanSheet(scopedCatalog, scopedRecord, OPTIONS)).toBe(scopedCatalog);
    });

  it("refuses non-SABA authority, missing native inventory, and generated-id collisions", () => {
    const record = cleanSheetRecord();
    const source = normalizedCatalog();
    const nonSaba = { ...source, events: [{ ...source.events[0]!, provider: "CMD" }] };
    expect(augmentSabaDomCleanSheet(nonSaba, record, OPTIONS)).toBe(nonSaba);

    const missingSource = normalizedCatalog();
    const missingNative = { ...missingSource,
      nativeMarketObservations: missingSource.nativeMarketObservations!.slice(0, 1) };
    expect(augmentSabaDomCleanSheet(missingNative, record, OPTIONS)).toBe(missingNative);

    const collisionSource = normalizedCatalog();
    const collision = { ...collisionSource, markets: [...collisionSource.markets,
      { ...collisionSource.markets[0]!, line: null,
        providerMarketId: "1054290306:home-clean-sheet", marketType: "HOME_FT_CLEAN_SHEET" as const,
        settlementProfile: "football-home-clean-sheet" }] };
    expect(augmentSabaDomCleanSheet(collision, record, OPTIONS)).toBe(collision);
  });

  it.each([
    ["greyed", { greyedOut: "true", status: null }],
    ["explicit nonrunning", { greyedOut: null, status: "closed" }]
  ])("suspends both derived markets when any outcome is %s", (_name, state) => {
    const record = cleanSheetRecord();
    const group = record.groups[0]!;
    const result = augmentSabaDomCleanSheet(normalizedCatalog(), { ...record, groups: [{ ...group,
      odds: group.odds.map((odd, index) => index === 0 ? { ...odd, ...state } : odd) }] }, OPTIONS);
    expect(result.markets.slice(1).map(({ status }) => status)).toEqual(["SUSPENDED", "SUSPENDED"]);
    expect(result.quotes.slice(1).map(({ status }) => status)).toEqual([
      "SUSPENDED", "SUSPENDED", "SUSPENDED", "SUSPENDED"
    ]);
  });
});
