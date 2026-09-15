import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, exactPartitionOutcomeDomain } from "./comparison.js";

const event = (provider: "SABA" | "SBOBET" | "CMD", id: string): ProviderEvent => ({
  provider, category: "FOOTBALL", providerEventId: id, competition: "Eliteserien",
  seasonStage: null, startAtUtcMs: 2_000_000, participantA: "Kristiansund BK", participantB: "Molde",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
});

const cornerCatalog = (provider: "SABA" | "SBOBET" | "CMD", id: string,
  odds: Readonly<Record<"HOME" | "DRAW" | "AWAY", string>>,
  marketType = "CORNER_FT_1X2"): LiveCatalogResponse => {
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: id,
    providerMarketId: `${id}-corner-1x2`, marketType: marketType as ProviderMarket["marketType"],
    scope: "FULL_TIME", line: null, settlementProfile: "football-corners-regulation", status: "OPEN" };
  const quotes: ProviderQuote[] = (["HOME", "DRAW", "AWAY"] as const).map((selection) => ({
    provider, category: "FOOTBALL", providerEventId: id, providerMarketId: market.providerMarketId,
    providerSelectionId: `${id}-${selection}`, marketType: market.marketType, scope: "FULL_TIME",
    selection, line: null, rawOdds: odds[selection], rawFormat: "DECIMAL", status: "OPEN",
    isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { dataMode: "LIVE", accountId: id, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, rejectedMarketCount: 0,
    events: [event(provider, id)], markets: [market], quotes };
};

const cornerRow = (catalogs: readonly LiveCatalogResponse[]) =>
  buildComparisonEvents(catalogs)[0]?.rows.find((row) => row.marketType === "CORNER_FT_1X2");

describe("three-way corner tickets", () => {
  it("names the partition markets and refuses anything carrying a line", () => {
    expect(exactPartitionOutcomeDomain("CORNER_FT_1X2", "FULL_TIME", null))
      .toEqual(["AWAY", "DRAW", "HOME"]);
    expect(exactPartitionOutcomeDomain("CARD_FT_1X2", "FULL_TIME", null))
      .toEqual(["AWAY", "DRAW", "HOME"]);
    // A line means a push can exist, and a push is not a partition.
    expect(exactPartitionOutcomeDomain("CORNER_FT_1X2", "FULL_TIME", "2.5")).toBeNull();
    // Two-way and handicap markets keep their own settlement route.
    expect(exactPartitionOutcomeDomain("FT_1X2", "FULL_TIME", null)).toBeNull();
    expect(exactPartitionOutcomeDomain("CORNER_FT_AH", "FULL_TIME", null)).toBeNull();
    expect(exactPartitionOutcomeDomain("CORNER_FT_1X2", "FIRST_HALF", null)).toBeNull();
  });

  it("prices a corner 1X2 across three books, which nothing could build before", () => {
    // All four books publish corner 1X2. The opposition route needs a
    // double-chance complement no book offers, and the two-way route is gated
    // at exactly two legs, so this row could never carry a margin.
    const row = cornerRow([
      cornerCatalog("SABA", "a", { HOME: "4.10", DRAW: "3.10", AWAY: "2.20" }),
      cornerCatalog("SBOBET", "b", { HOME: "2.30", DRAW: "4.20", AWAY: "2.50" }),
      cornerCatalog("CMD", "c", { HOME: "2.40", DRAW: "3.00", AWAY: "4.30" })
    ]);
    expect(row).toBeDefined();
    expect(row!.crossBook).toBe(true);
    expect(row!.bestBySelection).toEqual({ HOME: "SABA", DRAW: "SBOBET", AWAY: "CMD" });
    // 1/(1/4.1 + 1/4.2 + 1/4.3) - 1
    expect(row!.margin).toBeCloseTo(1 / (1 / 4.1 + 1 / 4.2 + 1 / 4.3) - 1, 12);
    expect(row!.margin!).toBeGreaterThan(0);
  });

  it("reports a losing book sum as a negative margin rather than hiding it", () => {
    const row = cornerRow([
      // Best prices genuinely split across the two books; the sum still loses.
      cornerCatalog("SABA", "a", { HOME: "2.10", DRAW: "3.00", AWAY: "3.00" }),
      cornerCatalog("SBOBET", "b", { HOME: "2.00", DRAW: "3.10", AWAY: "3.10" })
    ]);
    expect(row?.crossBook).toBe(true);
    expect(row?.margin).toBeLessThan(0);
  });

  it("carries no margin when one book alone holds every best price", () => {
    const row = cornerRow([
      cornerCatalog("SABA", "a", { HOME: "4.10", DRAW: "4.20", AWAY: "4.30" }),
      cornerCatalog("SBOBET", "b", { HOME: "2.00", DRAW: "2.00", AWAY: "2.00" })
    ]);
    expect(row?.crossBook).toBe(false);
    expect(row?.margin).toBeNull();
  });
});
