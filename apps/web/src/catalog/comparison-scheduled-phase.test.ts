import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const OBSERVED_AT_MS = 1_700_000_000_000;
const KICKOFF_MS = OBSERVED_AT_MS + 5 * 3_600_000;

function catalogOf(provider: "SABA" | "BTI" | "SBOBET", overrides: Partial<ProviderEvent>,
  odds: readonly [string, string]): LiveCatalogResponse {
  const id = `${provider}-1`;
  const base: ProviderEvent = {
    provider, category: "FOOTBALL", providerEventId: id, competition: "La Liga",
    seasonStage: null, startAtUtcMs: KICKOFF_MS, participantA: "Celta Vigo",
    participantB: "Osasuna", eventScope: "REGULATION", bestOf: null, isLive: false,
    rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
    sportVariant: "FOOTBALL", liveState: null
  };
  const event = { ...base, ...overrides } as ProviderEvent;
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: id,
    providerMarketId: `${id}-m`, marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
  const quotes = (["OVER", "UNDER"] as const).map((selection, index): ProviderQuote => ({
    provider, category: "FOOTBALL", providerEventId: id, providerMarketId: market.providerMarketId,
    providerSelectionId: `${id}-${selection}`, marketType: "FT_TOTAL", scope: "FULL_TIME",
    selection, line: "2.5", rawOdds: odds[index]!, rawFormat: "DECIMAL", status: "OPEN",
    isLive: event.isLive, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider,
    category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER",
    observedAtMs: OBSERVED_AT_MS, rejectedMarketCount: 0, events: [event],
    markets: [market], quotes };
}

describe("a live claim loses to another book's scheduled kickoff", () => {
  it("pairs a fixture one book calls live while another schedules it hours away", () => {
    const groups = buildComparisonEvents([
      catalogOf("SABA", { isLive: true, startAtUtcMs: OBSERVED_AT_MS - 60_000,
        liveState: { period: null, scoreHome: null, scoreAway: null, clockMs: null } },
      ["2.05", "1.85"]),
      catalogOf("BTI", {}, ["1.90", "2.00"])
    ]);
    const paired = groups.filter((group) => group.providers.length >= 2);

    expect(paired).toHaveLength(1);
    expect(paired[0]!.event.isLive).toBe(false);
    expect(paired[0]!.rows.length).toBeGreaterThan(0);
  });

  it("leaves a running fixture alone when no book schedules it later", () => {
    const groups = buildComparisonEvents([
      catalogOf("SABA", { isLive: true, startAtUtcMs: OBSERVED_AT_MS - 60_000 }, ["2.05", "1.85"]),
      catalogOf("BTI", { isLive: true, startAtUtcMs: OBSERVED_AT_MS - 60_000 }, ["1.90", "2.00"])
    ]);
    const paired = groups.filter((group) => group.providers.length >= 2);

    expect(paired).toHaveLength(1);
    expect(paired[0]!.event.isLive).toBe(true);
  });

  it("does not let a kickoff minutes away contradict a live claim", () => {
    const groups = buildComparisonEvents([
      catalogOf("SABA", { isLive: true, startAtUtcMs: OBSERVED_AT_MS - 60_000 }, ["2.05", "1.85"]),
      catalogOf("BTI", { startAtUtcMs: OBSERVED_AT_MS + 60_000 }, ["1.90", "2.00"])
    ]);

    expect(groups.filter((group) => group.providers.length >= 2)).toEqual([]);
  });

  it("believes two books that agree a fixture is running over a third's schedule", () => {
    // Overruling both cost more than it won: 24 fixtures that priced against
    // each other fell to 5. A third book listing the same teams later is more
    // likely naming a different meeting than contradicting the two watching it.
    const groups = buildComparisonEvents([
      catalogOf("SABA", { isLive: true, startAtUtcMs: OBSERVED_AT_MS - 60_000 }, ["2.05", "1.85"]),
      catalogOf("SBOBET", { isLive: true, startAtUtcMs: OBSERVED_AT_MS - 60_000 }, ["2.00", "1.90"]),
      catalogOf("BTI", {}, ["1.90", "2.00"])
    ]);
    const live = groups.filter((group) => group.event.isLive && group.providers.length >= 2);

    expect(live).toHaveLength(1);
    expect([...live[0]!.providers].sort()).toEqual(["SABA", "SBOBET"]);
  });
});
