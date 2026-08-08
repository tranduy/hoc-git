import { cleanup, render, screen, within } from "@testing-library/react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { OpportunitiesPage } from "./opportunities-page.js";

const snapshot: AppSnapshot = {
  revision: 8,
  generatedAtMs: 1_800_000_000_000,
  providerStatuses: [],
  counts: { FOOTBALL: { events: 1, markets: 1 }, LOL: { events: 0, markets: 0 }, mappings: { VERIFIED: 1, REVIEW_REQUIRED: 0, REJECTED: 0 }, opportunities: 1 },
  events: [{ canonicalEventId: "event-1", category: "FOOTBALL", competition: "Premier League", seasonStage: null, startAtUtcMs: 1_800_000_100_000, participantA: "Northbridge", participantB: "Riverside", providerEventIds: ["saba-1", "im-1"], mappingStatus: "VERIFIED", mappingEvidence: [] }],
  markets: [{ canonicalMarketId: "market-1", canonicalEventId: "event-1", category: "FOOTBALL", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", settlementProfile: "football-v1", providerMarketIds: ["saba-market", "im-market"], mappingStatus: "VERIFIED", mappingEvidence: [] }],
  opportunities: [{
    opportunityId: "opportunity-1", canonicalEventId: "event-1", canonicalMarketId: "market-1", category: "FOOTBALL", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", settlementProfile: "football-v1",
    inverseSum: "0.990099009900990099", netMargin: "0.01", worstCaseProfit: "1.00", roi: "0.01", quoteAgeMs: 1_250, mappingEvidence: [], executionConfidence: "HIGH",
    legs: [
      { provider: "SABA", providerEventId: "saba-1", providerMarketId: "saba-market", providerSelectionId: "over", selection: "Over 2.5", rawOdds: "0.98", rawFormat: "HK", decimalOdds: "1.98", effectiveDecimal: "1.98", stake: "50.505050505050505", minStake: "10", maxStake: "500", payout: "100", quoteAgeMs: 1_250, quoteStatus: "OPEN", sourceTimestampMs: 1_799_999_998_750, receivedMonotonicMs: 4, sequence: 9, eligible: true, ineligibleReasons: [] },
      { provider: "IM", providerEventId: "im-1", providerMarketId: "im-market", providerSelectionId: "under", selection: "Under 2.5", rawOdds: "1.02", rawFormat: "HK", decimalOdds: "2.02", effectiveDecimal: "2.02", stake: "49.504950495049505", minStake: "5", maxStake: "250", payout: "100", quoteAgeMs: 980, quoteStatus: "OPEN", sourceTimestampMs: 1_799_999_999_020, receivedMonotonicMs: 5, sequence: 10, eligible: true, ineligibleReasons: [] }
    ]
  }],
  blockedDiagnostics: [{ code: "NEGATIVE_MARGIN", category: "FOOTBALL", canonicalMarketId: "blocked-market", reason: "negative margin", mappingEvidence: [] }]
};

describe("OpportunitiesPage", () => {
  afterEach(cleanup);

  it("renders each verified opportunity with exact leg, payout, constraint, and freshness evidence", () => {
    render(<OpportunitiesPage snapshot={snapshot} connectionState="LIVE" />);

    const card = screen.getByRole("article", { name: /Northbridge vs Riverside/i });
    expect(within(card).getByText("FOOTBALL")).toBeTruthy();
    expect(within(card).getByText("FT_TOTAL")).toBeTruthy();
    expect(within(card).getByText("Full time")).toBeTruthy();
    expect(within(card).getByText("Line 2.5")).toBeTruthy();
    expect(within(card).getByText("Settlement football-v1")).toBeTruthy();
    expect(within(card).getByText("READ ONLY")).toBeTruthy();
    expect(within(card).getByText("HIGH confidence")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: /SABA.*Over 2\.5/u })).toBeTruthy();
    expect(within(card).getByRole("heading", { name: /IM.*Under 2\.5/u })).toBeTruthy();
    expect(within(card).getByLabelText("Effective decimal odds: 1.98")).toBeTruthy();
    expect(within(card).getByLabelText("Effective decimal odds: 2.02")).toBeTruthy();
    expect(within(card).getAllByText("100.00")).toHaveLength(2);
    expect(within(card).getByText("1.00%")).toBeTruthy();
    expect(within(card).getAllByTitle("1250 ms from the server snapshot")).toHaveLength(2);
    expect(within(card).getByLabelText("Source timestamp: 1,799,999,998,750 ms")).toBeTruthy();
    expect(within(card).getByTitle("50.505050505050505")).toBeTruthy();
    expect(within(card).getByTitle("49.504950495049505")).toBeTruthy();
    expect(within(card).getByLabelText("Minimum stake: 10; maximum stake: 500")).toBeTruthy();
    expect(within(card).getByLabelText("Minimum stake: 5; maximum stake: 250")).toBeTruthy();
    expect(screen.queryByText("negative margin")).toBeNull();
    expect(screen.queryByText("NEGATIVE_MARGIN")).toBeNull();
  });

  it("marks all opportunities ineligible while disconnected without offering an execution action", () => {
    render(<OpportunitiesPage snapshot={snapshot} connectionState="DISCONNECTED" />);

    expect(screen.getByRole("alert").textContent).toContain("ineligible until fresh snapshots return");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses only a server STALE diagnostic for the stale empty state", () => {
    render(<OpportunitiesPage snapshot={{ ...snapshot, opportunities: [], blockedDiagnostics: [{ code: "STALE", category: "FOOTBALL", canonicalMarketId: "market-1", reason: "server quote expired", mappingEvidence: [] }] }} connectionState="LIVE" />);

    expect(screen.getByRole("heading", { name: "Stale market data" })).toBeTruthy();
    expect(screen.getByText(/Wait for a fresh server snapshot/i)).toBeTruthy();
  });
});
