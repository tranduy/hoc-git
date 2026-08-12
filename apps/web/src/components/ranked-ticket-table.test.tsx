import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import type { FixedBaseStakePlan } from "../watch/fixed-base-stake.js";
import type { RankedTicket } from "../watch/ranked-tickets.js";
import { RankedTicketTable } from "./ranked-ticket-table.js";

afterEach(cleanup);

const event: ProviderEvent = { provider: "SABA", category: "LOL", providerEventId: "event-a", competition: "LCK",
  seasonStage: null, startAtUtcMs: 10_000, participantA: "Nongshim Academy", participantB: "Dplus Challengers",
  eventScope: "SERIES", bestOf: 3, isLive: true, rematchCandidate: false, fixtureDiscriminator: null,
  gameVariant: "LOL", liveState: null };

function cell(provider: "SABA" | "IM", odds: readonly [string, string]): ComparisonCell {
  const market: ProviderMarket = { provider, category: "LOL", providerEventId: `${provider}-event`,
    providerMarketId: `${provider}-market`, marketType: "SERIES_WINNER", scope: "SERIES", line: null,
    settlementProfile: "lol-series-winner", status: "OPEN" };
  const quotes: ProviderQuote[] = (["TEAM_A", "TEAM_B"] as const).map((selection, index) => ({ provider,
    category: "LOL", providerEventId: market.providerEventId, providerMarketId: market.providerMarketId,
    providerSelectionId: `${provider}-${selection}`, marketType: "SERIES_WINNER", scope: "SERIES", selection,
    line: null, rawOdds: odds[index]!, rawFormat: "DECIMAL", status: "OPEN", isLive: true,
    sourceTimestampMs: 10_000, receivedMonotonicMs: 1, sequence: 1 }));
  return { provider, market, quotes };
}

function ticket(index: number, state: RankedTicket["state"] = "OBSERVATION"): RankedTicket {
  const row: ComparisonRow = { key: `series-${index}`, marketType: "SERIES_WINNER", scope: "SERIES", line: null,
    cells: [cell("SABA", ["2.2", "1.7"]), cell("IM", ["1.8", "2.5"])],
    bestBySelection: { TEAM_A: "SABA", TEAM_B: "IM" }, margin: 0.2, crossBook: true };
  const plan: FixedBaseStakePlan = { fingerprint: `plan-${index}`, currency: "VND", totalStake: "188000",
    worstCaseProfit: state === "VERIFIED_PROFIT" ? "20000" : "-1000", roi: state === "VERIFIED_PROFIT" ? "0.106" : "-0.005",
    profitsBySelection: { TEAM_A: "20000", TEAM_B: "32000" }, legs: [
      { provider: "SABA", selection: "TEAM_A", decimalOdds: "2.2", stake: "100000", payout: "220000",
        profit: "32000", role: "BASE", feeType: "NONE", feeRate: null },
      { provider: "IM", selection: "TEAM_B", decimalOdds: "2.5", stake: "88000", payout: "220000",
        profit: "32000", role: "HEDGE", feeType: "NONE", feeRate: null }
    ] };
  return { key: row.key, eventKey: "event-key", row, plan, state,
    reason: state === "OBSERVATION" ? "Provider preflight required" : null, movementMagnitude: "0.4",
    gapsBySelection: { TEAM_A: { absolute: "0.4", percent: "22.222222222222222222" },
      TEAM_B: { absolute: "0.8", percent: "47.058823529411764706" } } };
}

describe("RankedTicketTable", () => {
  it("shows at most five horizontal exact tickets with named outcomes, provider prices, stakes and profit", () => {
    render(<RankedTicketTable event={event} providers={["SABA", "IM"]}
      tickets={[ticket(1, "VERIFIED_PROFIT"), ticket(2), ticket(3), ticket(4), ticket(5), ticket(6)]} />);

    const table = screen.getByRole("table", { name: "Top exact tickets for Nongshim Academy vs Dplus Challengers" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(screen.getAllByText(/Nongshim Academy/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Dplus Challengers/u).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^TEAM_A$/u)).toBeNull();
    expect(screen.getAllByText(/SABA/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/IM/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/Guaranteed 20,000 VND/u)).toBeTruthy();
    expect(screen.getAllByText(/Gap 0\.4 · 22\.22%/u)).toHaveLength(5);
    expect(screen.getAllByText(/Stake 100,000 VND/u)).toHaveLength(5);
    expect(screen.queryByText(/series-6/u)).toBeNull();
  });

  it("uses green styling only for a verified ticket at the profit threshold", () => {
    render(<RankedTicketTable event={event} providers={["SABA", "IM"]}
      tickets={[ticket(1, "VERIFIED_PROFIT"), ticket(2)]} />);

    expect(screen.getByLabelText("Ticket series-1").className).toContain("ranked-ticket-row--profitable");
    expect(screen.getByLabelText("Ticket series-2").className).toContain("ranked-ticket-row--neutral");
    expect(screen.getByText("Provider preflight required")).toBeTruthy();
  });
});
