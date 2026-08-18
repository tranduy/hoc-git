import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BetHistoryPage, type BetHistoryApiLike } from "./bet-history-page.js";

afterEach(() => cleanup());

describe("BetHistoryPage", () => {
  it("shows own ticket stakes, odds and expected profit", async () => {
    const api: BetHistoryApiLike = { list: async () => ({ storageState: "READY", records: [{
      id: "id-1", stage: "PREFLIGHT_READY", recordedAtMs: 2000, ticketId: "ticket-1",
      opportunityId: "opp-1", canonicalEventId: "event-1", canonicalMarketId: "market-1",
      baseCurrency: "VND", totalStakeBase: "172000", worstCaseProfit: "20000", issuedAtMs: 1000,
      expiresAtMs: 4000, legs: [
        { provider: "SABA", accountId: "a", providerEventId: "ea", providerMarketId: "ma",
          providerSelectionId: "sa", selection: "HOME", line: "0.5", decimalOdds: "1.8", stake: "100000", currency: "VND" },
        { provider: "SBOBET", accountId: "b", providerEventId: "eb", providerMarketId: "mb",
          providerSelectionId: "sb", selection: "AWAY", line: "0.5", decimalOdds: "2.5", stake: "72000", currency: "VND" }
      ]
    }] }) };

    render(<BetHistoryPage api={api} />);

    expect(await screen.findByText("20.000 VND")).toBeTruthy();
    expect(screen.getByText(/SABA · HOME · 1.8/)).toBeTruthy();
    expect(screen.getByText(/SBOBET · AWAY · 2.5/)).toBeTruthy();
  });

  it("shows storage failure without crashing the page", async () => {
    render(<BetHistoryPage api={{ list: async () => ({ storageState: "UNAVAILABLE", records: [] }) }} />);
    expect(await screen.findByText(/không đọc được file lịch sử/i)).toBeTruthy();
  });
});
