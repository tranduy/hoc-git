import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import { MatchWatchDetail } from "./match-watch-detail.js";

const event: ProviderEvent = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", competition: "Premier Test",
  seasonStage: null, startAtUtcMs: 1_800_000_000_000, participantA: "Alpha", participantB: "Beta",
  eventScope: "REGULATION", bestOf: null, isLive: true, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL",
  liveState: { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 120_000 }
};
const market: ProviderMarket = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
  marketType: "FT_1X2", scope: "FULL_TIME", line: null,
  settlementProfile: "football-regulation-including-added-time", status: "OPEN"
};
const quote = (selection: string, rawOdds: string, status: "OPEN" | "SUSPENDED" = "OPEN"): ProviderQuote => ({
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
  providerSelectionId: `selection-${selection.toLowerCase()}`, marketType: "FT_1X2", scope: "FULL_TIME",
  selection, line: null, rawOdds, rawFormat: "DECIMAL", status, isLive: true,
  sourceTimestampMs: null, receivedMonotonicMs: 100, sequence: 1
});
function catalog(observedAtMs: number, home = "2.1", status: "OPEN" | "SUSPENDED" = "OPEN"): LiveCatalogResponse {
  return {
    dataMode: "LIVE", accountId: "private-account", provider: "CMD", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0, events: [event],
    markets: [{ ...market, status }],
    quotes: [quote("HOME", home, status), quote("DRAW", "3.2", status), quote("AWAY", "3.4", status)]
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MatchWatchDetail", () => {
  it("shows one honest provider column and a readable current-market detail", () => {
    const api: CatalogApiLike = { read: vi.fn(async () => catalog(2_000)) };
    render(<MatchWatchDetail accountId="private-account" catalogApi={api} initialCatalog={catalog(1_000)} onBack={() => undefined} providerEventId="event-1" />);

    expect(screen.getByRole("heading", { name: "Alpha vs Beta" })).toBeTruthy();
    expect(screen.getByText("CMD live feed")).toBeTruthy();
    expect(screen.getByText("HOME")).toBeTruthy();
    expect(screen.getByText("2.1")).toBeTruthy();
    expect(screen.getByText("Awaiting verified second provider")).toBeTruthy();
    expect(screen.getByText("Single-provider observation — cross-book timing unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bet|wager|place/iu })).toBeNull();
  });

  it("polls sequentially, logs odds and suspension changes, then stops", async () => {
    let resolveFirst: ((value: LiveCatalogResponse) => void) | undefined;
    const read = vi.fn()
      .mockImplementationOnce(() => new Promise<LiveCatalogResponse>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(catalog(3_000, "2.05", "SUSPENDED"));
    const api: CatalogApiLike = { read };
    render(<MatchWatchDetail accountId="private-account" catalogApi={api} initialCatalog={catalog(1_000)} onBack={() => undefined} providerEventId="event-1" />);

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(read).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFirst?.(catalog(2_000, "2.05")); await Promise.resolve(); });
    expect(screen.getByText("2.1 DECIMAL → 2.05 DECIMAL")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("OPEN → SUSPENDED").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByText("STOPPED")).toBeTruthy();
  });

  it("keeps prior evidence on poll failure and can clear it", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(catalog(2_000, "2.05"))
      .mockRejectedValueOnce(new Error("secret provider failure"));
    render(<MatchWatchDetail accountId="private-account" catalogApi={{ read }} initialCatalog={catalog(1_000)} onBack={() => undefined} providerEventId="event-1" />);

    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve(); });
    expect(screen.getByText("2.1 DECIMAL → 2.05 DECIMAL")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve(); });
    expect(screen.getByText("Provider catalog read failed")).toBeTruthy();
    expect(screen.getByText("2.1 DECIMAL → 2.05 DECIMAL")).toBeTruthy();
    expect(screen.queryByText("secret provider failure")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear log" }));
    expect(screen.getByText("No changes detected yet.")).toBeTruthy();
  });
});
