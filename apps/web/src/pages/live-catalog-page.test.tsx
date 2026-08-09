import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AccountStatus, ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountApiLike } from "../api/accounts.js";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import { LiveCatalogPage } from "./live-catalog-page.js";

const account: AccountStatus = {
  id: "account-1", alias: "CMD main", provider: "CMD", sessionState: "ACTIVE", profileState: "FRESH",
  redactedLabel: "••••1445", currency: "UUS", balance: "0", balanceAsOfMs: 100,
  capabilities: ["PROFILE", "CATALOG"], reason: null
};
const event: ProviderEvent = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", competition: "Premier Test",
  seasonStage: null, startAtUtcMs: 1_800_000_000_000, participantA: "Alpha", participantB: "Beta",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
};
const market: ProviderMarket = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
  marketType: "FT_1X2", scope: "FULL_TIME", line: null,
  settlementProfile: "football-regulation-including-added-time", status: "OPEN"
};
const quotes: ProviderQuote[] = ["HOME", "DRAW", "AWAY"].map((selection, index) => ({
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
  providerSelectionId: `selection-${index}`, marketType: "FT_1X2", scope: "FULL_TIME", selection,
  line: null, rawOdds: ["2.1", "3.2", "3.4"][index]!, rawFormat: "DECIMAL", status: "OPEN",
  isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 100, sequence: 1
}));
const catalog: LiveCatalogResponse = {
  dataMode: "LIVE", accountId: account.id, provider: "CMD", category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100,
  rejectedMarketCount: 0,
  events: [event], markets: [market], quotes
};

const accountApi: AccountApiLike = {
  list: async () => [account],
  register: async () => account,
  refresh: async () => account
};
const catalogApi: CatalogApiLike = { read: async () => catalog };

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/live-catalog");
});

describe("LiveCatalogPage", () => {
  it("automatically loads real matches when a catalog-capable account becomes available", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByText("Alpha vs Beta")).toBeTruthy();
    expect(screen.getByText("HOME: 2.1 DECIMAL")).toBeTruthy();
  });

  it("shows real CMD matches separately from verified cross-provider comparisons", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load live catalog" }));

    expect(await screen.findByText("Alpha vs Beta")).toBeTruthy();
    expect(screen.getByText("Premier Test")).toBeTruthy();
    expect(screen.getByText("HOME: 2.1 DECIMAL")).toBeTruthy();
    expect(screen.getByText("Awaiting second provider")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View & watch Alpha vs Beta" }));
    expect(await screen.findByRole("heading", { name: "Alpha vs Beta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to matches" })).toBeTruthy();
    expect(screen.queryByText(/arbitrage verified/iu)).toBeNull();
    expect(screen.queryByRole("button", { name: /bet|wager|place/iu })).toBeNull();
  });

  it("states honestly that LoL is not connected yet", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "LoL" }));
    expect(screen.getByText("No verified live LoL adapter is connected yet.")).toBeTruthy();
  });

  it("clears a Football catalog error when switching to LoL", async () => {
    const unavailableCatalogApi: CatalogApiLike = { read: async () => { throw new Error("unavailable"); } };
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={unavailableCatalogApi} />);

    expect(await screen.findByText(/Live catalog is unavailable/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "LoL" }));

    expect(screen.getByText("No verified live LoL adapter is connected yet.")).toBeTruthy();
    expect(screen.queryByText(/Live catalog is unavailable/u)).toBeNull();
  });

  it("retries the same Football account after leaving and returning to the category", async () => {
    const read = vi.fn<CatalogApiLike["read"]>()
      .mockRejectedValueOnce(new Error("stale provider page"))
      .mockResolvedValueOnce(catalog);
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={{ read }} />);
    expect(await screen.findByText(/Live catalog is unavailable/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "LoL" }));
    fireEvent.click(screen.getByRole("button", { name: "Football" }));

    expect(await screen.findByText("Alpha vs Beta")).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reopens a selected match detail from its safe URL identity", async () => {
    window.history.replaceState({}, "", "/live-catalog?account=account-1&event=event-1");
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByRole("heading", { name: "Alpha vs Beta" })).toBeTruthy();
    expect(screen.getByText("Single-provider observation — cross-book timing unavailable")).toBeTruthy();
  });
});
