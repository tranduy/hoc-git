import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import { MatchWatchDetail } from "./match-watch-detail.js";
import { buildComparisonEvents } from "../catalog/comparison.js";

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

function totalCatalog(provider: "SABA" | "SBOBET", accountId: string, over: string, under: string,
  status: "OPEN" | "SUSPENDED" = "OPEN", observedAtMs = 1_000): LiveCatalogResponse {
  const providerEventId = `${provider}-total-event`;
  const providerMarketId = `${provider}-total-market`;
  const totalMarket: ProviderMarket = { ...market, provider, providerEventId, providerMarketId,
    marketType: "FT_TOTAL", line: "2.5", status };
  const totalEvent: ProviderEvent = { ...event, provider, providerEventId };
  const makeQuote = (selection: "OVER" | "UNDER", rawOdds: string): ProviderQuote => ({
    ...quote(selection, rawOdds, status), provider, providerEventId, providerMarketId,
    providerSelectionId: `${provider}-${selection}`, marketType: "FT_TOTAL", line: "2.5"
  });
  return { dataMode: "LIVE", accountId, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs, rejectedMarketCount: 0,
    events: [totalEvent], markets: [totalMarket], quotes: [makeQuote("OVER", over), makeQuote("UNDER", under)] };
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
  it("shows the provider match clock and approximate live start in detail", () => {
    const liveCatalog = catalog(200_000);
    render(<MatchWatchDetail accountId="private-account" catalogApi={{ read: vi.fn() }} initialCatalog={liveCatalog}
      onBack={() => undefined} providerEventId="event-1" />);

    expect(screen.getByText("LIVE · 1H · 02:00 elapsed")).toBeTruthy();
    expect(screen.getByText(`Observed ${new Date(200_000).toLocaleString()}`)).toBeTruthy();
    expect(screen.getByText(`Approx. started ${new Date(80_000).toLocaleString()}`)).toBeTruthy();
  });

  it("shows one honest provider column and a readable current-market detail", () => {
    const api: CatalogApiLike = { read: vi.fn(async () => catalog(2_000)) };
    render(<MatchWatchDetail accountId="private-account" catalogApi={api} initialCatalog={catalog(1_000)} onBack={() => undefined} providerEventId="event-1" />);

    expect(screen.getByRole("heading", { name: "Alpha vs Beta" })).toBeTruthy();
    expect(screen.getByText("CMD live feed")).toBeTruthy();
    expect(screen.getByText("HOME")).toBeTruthy();
    expect(screen.getByText("2.1")).toBeTruthy();
    expect(screen.getByText("Awaiting verified second provider")).toBeTruthy();
    expect(screen.getByText(/Cross-book comparison unavailable/u)).toBeTruthy();
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

  it("fails visibly stale when no accepted provider sample arrives in time", () => {
    const read = vi.fn(() => new Promise<LiveCatalogResponse>(() => undefined));
    render(<MatchWatchDetail accountId="private-account" catalogApi={{ read }} initialCatalog={catalog(1_000)}
      onBack={() => undefined} providerEventId="event-1" staleAfterMs={3_000} />);

    act(() => { vi.advanceTimersByTime(1_000); });
    expect(read).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByText("STALE")).toBeTruthy();
    expect(screen.getByText("#CMD · STALE")).toBeTruthy();
    expect(screen.getByText("No accepted provider sample within 3000 ms")).toBeTruthy();
  });

  it("shows one calculated ten-second preflight alert and does not repeat the same fingerprint", () => {
    const saba = totalCatalog("SABA", "saba-account", "2.20", "1.70");
    const sbobet = totalCatalog("SBOBET", "sbo-account", "1.75", "2.20");
    const comparison = buildComparisonEvents([saba, sbobet])[0]!;
    render(<MatchWatchDetail accountId="saba-account" catalogApi={{ read: vi.fn() }} comparisonCatalogs={[saba, sbobet]}
      comparisonEvent={comparison} initialCatalog={saba} onBack={() => undefined} pollDelayMs={60_000}
      providerEventId="SABA-total-event" />);

    expect(screen.getByRole("alert").textContent).toMatch(/READY TO PREFLIGHT.*Alpha vs Beta/u);
    expect(screen.getByRole("alert").textContent).toMatch(/SABA.*OVER.*50,000 VND/u);
    expect(screen.getByRole("alert").textContent).toMatch(/SBOBET.*UNDER.*50,000 VND/u);
    expect(screen.getByRole("alert").textContent).toMatch(/Worst-case profit 10,000 VND.*ROI 10.00%/u);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "SBOBET available for this match" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "SBOBET available for this match" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removes an active candidate immediately when monitoring stops", () => {
    const saba = totalCatalog("SABA", "saba-account", "2.20", "1.70");
    const sbobet = totalCatalog("SBOBET", "sbo-account", "1.75", "2.20");
    render(<MatchWatchDetail accountId="saba-account" catalogApi={{ read: vi.fn() }} comparisonCatalogs={[saba, sbobet]}
      comparisonEvent={buildComparisonEvents([saba, sbobet])[0]!} initialCatalog={saba} onBack={() => undefined}
      providerEventId="SABA-total-event" />);

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop watching" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not alert from an impossible future-dated catalog observation", () => {
    const saba = totalCatalog("SABA", "saba-account", "2.20", "1.70", "OPEN", 20_000);
    const sbobet = totalCatalog("SBOBET", "sbo-account", "1.75", "2.20", "OPEN", 20_000);
    render(<MatchWatchDetail accountId="saba-account" catalogApi={{ read: vi.fn() }} comparisonCatalogs={[saba, sbobet]}
      comparisonEvent={buildComparisonEvents([saba, sbobet])[0]!} initialCatalog={saba} onBack={() => undefined}
      providerEventId="SABA-total-event" />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("alerts again only after a polled price change creates a new plan", async () => {
    const saba = totalCatalog("SABA", "saba-account", "2.20", "1.70");
    const sbobet = totalCatalog("SBOBET", "sbo-account", "1.75", "2.20");
    const read = vi.fn(async (accountId: string) => accountId === "saba-account"
      ? totalCatalog("SABA", "saba-account", "2.30", "1.70", "OPEN", 21_000)
      : totalCatalog("SBOBET", "sbo-account", "1.75", "2.20", "OPEN", 21_000));
    render(<MatchWatchDetail accountId="saba-account" catalogApi={{ read }} comparisonCatalogs={[saba, sbobet]}
      comparisonEvent={buildComparisonEvents([saba, sbobet])[0]!} initialCatalog={saba} onBack={() => undefined}
      pollDelayMs={11_000} providerEventId="SABA-total-event" />);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve(); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toMatch(/SABA.*OVER.*2.3/u);
  });

  it("polls every connected comparison book and refreshes the side-by-side rates", async () => {
    const forProvider = (provider: "SABA" | "SBOBET", accountId: string, home: string): LiveCatalogResponse => ({
      ...catalog(1_000, home), accountId, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: [quote("HOME", home), quote("DRAW", "3.2"), quote("AWAY", "3.4")].map((item) => ({
        ...item, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market`,
        providerSelectionId: `${provider}-${item.selection}`
      }))
    });
    const saba = forProvider("SABA", "saba-account", "2.1");
    const sbobet = forProvider("SBOBET", "sbo-account", "2.2");
    const comparison = buildComparisonEvents([saba, sbobet])[0]!;
    const read = vi.fn(async (id: string) => id === "saba-account"
      ? forProvider("SABA", "saba-account", "2.35")
      : forProvider("SBOBET", "sbo-account", "2.45"));
    render(<MatchWatchDetail accountId="saba-account" catalogApi={{ read }} comparisonCatalogs={[saba, sbobet]}
      comparisonEvent={comparison} initialCatalog={saba} onBack={() => undefined} providerEventId="SABA-event" />);

    expect(screen.getByText("HOME 2.2")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve(); });

    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByText("HOME 2.45")).toBeTruthy();
    expect(screen.getAllByText("#SBOBET · ODDS CHANGED").length).toBeGreaterThan(0);
  });
});
