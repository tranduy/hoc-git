import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AccountStatus, ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountApiLike } from "../api/accounts.js";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import { LiveCatalogPage } from "./live-catalog-page.js";
import { WATCH_BASE_STAKE_STORAGE_KEY } from "../watch/stake-settings.js";

const account: AccountStatus = {
  id: "account-1", alias: "CMD main", provider: "CMD", category: "FOOTBALL", sessionState: "ACTIVE", profileState: "FRESH",
  redactedLabel: "••••1445", currency: "UUS", balance: "0", balanceAsOfMs: 100,
  capabilities: ["PROFILE", "CATALOG"], reason: null
};
const event: ProviderEvent = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", competition: "Premier Test",
  seasonStage: null, startAtUtcMs: Date.now() + 3_600_000, participantA: "Alpha", participantB: "Beta",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null
};
const market: ProviderMarket = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
  marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
  settlementProfile: "football-regulation-including-added-time", status: "OPEN"
};
const quotes: ProviderQuote[] = ["HOME", "AWAY"].map((selection, index) => ({
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
  providerSelectionId: `selection-${index}`, marketType: "FT_AH", scope: "FULL_TIME", selection,
  line: "-0.5", rawOdds: ["1.8", "2.5"][index]!, rawFormat: "DECIMAL", status: "OPEN",
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
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/live-catalog");
});

describe("LiveCatalogPage", () => {
  it("shows the immediate best lag signal after one provider flips its two prices", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus, over: string, under: string,
      observedAtMs: number): LiveCatalogResponse => ({
      ...catalog, observedAtMs, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}`, sourceTimestampMs: observedAtMs,
        rawOdds: quote.selection === "HOME" ? over : under }))
    });
    let sabaReads = 0;
    const api: CatalogApiLike = { read: async (id) => {
      if (id === sabaAccount.id) {
        sabaReads += 1;
        return sabaReads === 1 ? providerCatalog(sabaAccount, "2.20", "1.70", 1_000)
          : providerCatalog(sabaAccount, "1.70", "2.20", 1_100);
      }
      return providerCatalog(sbobetAccount, "2.20", "1.70", sabaReads === 1 ? 1_000 : 1_100);
    } };
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }} catalogApi={api} />);

    expect(await screen.findByText("Monitoring exact two-book prices")).toBeTruthy();
    expect(await screen.findByText(/Waiting for a provider price change/u)).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    expect(screen.getByText("Best live lag signal")).toBeTruthy();
    expect(screen.getByText("Biến động giá gần nhất")).toBeTruthy();
    expect(screen.getByText(/MẠNH NHẤT · Alpha vs Beta/u)).toBeTruthy();
    expect(screen.getAllByText("1.7 → 2.2").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Movement #SABA AWAY 1.7 to 2.2")).toBeTruthy();
    expect(screen.getByLabelText("Leg #SBOBET HOME at 2.2")).toBeTruthy();
    expect(screen.getAllByText(/Worst profit 20,000 VND/u)).toHaveLength(2);
    expect(screen.getByText("READ-ONLY")).toBeTruthy();
    expect(screen.getByText("PRICE GAP DETECTED")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.queryByText("PRICE GAP DETECTED")).toBeNull();
  });

  it("persists one global base stake while waiting for a real price change", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus, over: string, under: string): LiveCatalogResponse => ({
      ...catalog, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}`,
        rawOdds: quote.selection === "HOME" ? over : under }))
    });
    const saba = providerCatalog(sabaAccount, "1.8", "1.5");
    const sbobet = providerCatalog(sbobetAccount, "1.7", "2.5");
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? saba : sbobet }} />);

    const input = await screen.findByLabelText("Base stake for every match (VND)") as HTMLInputElement;
    expect(input.value).toBe("100000");
    expect(await screen.findByText(/Waiting for a provider price change/u)).toBeTruthy();
    fireEvent.change(input, { target: { value: "150000" } });
    expect(window.localStorage.getItem(WATCH_BASE_STAKE_STORAGE_KEY)).toBe("150000");
  });

  it("shows feed elapsed time, observed time, and approximate start for live events", async () => {
    const observedAtMs = Date.now();
    const liveEvent: ProviderEvent = { ...event, isLive: true, startAtUtcMs: observedAtMs,
      liveState: { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 660_000 } };
    const liveCatalog: LiveCatalogResponse = { ...catalog, observedAtMs,
      events: [liveEvent], quotes: quotes.map((quote) => ({ ...quote, isLive: true })) };
    window.history.replaceState({}, "", "/live-catalog?account=account-1&event=event-1");
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={{ read: async () => liveCatalog }} />);

    expect(await screen.findByText("LIVE · 1H · 11:00 elapsed")).toBeTruthy();
    expect(screen.getByText(`Observed ${new Date(liveCatalog.observedAtMs).toLocaleString()}`)).toBeTruthy();
    expect(screen.getByText(`Approx. started ${new Date(liveCatalog.observedAtMs - 660_000).toLocaleString()}`)).toBeTruthy();
  });

  it("shows provider checkboxes, countdown, provider badges, and side-by-side market rates", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const saba = { ...catalog, accountId: sabaAccount.id, provider: "SABA" as const,
      events: [{ ...event, provider: "SABA" as const, providerEventId: "saba-event" }],
      markets: [{ ...market, provider: "SABA" as const, providerEventId: "saba-event", providerMarketId: "saba-market" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" as const, providerEventId: "saba-event",
        providerMarketId: "saba-market", providerSelectionId: `saba-${quote.selection}` })) };
    const sbobet = { ...catalog, accountId: sbobetAccount.id, provider: "SBOBET" as const,
      events: [{ ...event, provider: "SBOBET" as const, providerEventId: "sbo-event" }],
      markets: [{ ...market, provider: "SBOBET" as const, providerEventId: "sbo-event", providerMarketId: "sbo-market" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SBOBET" as const, providerEventId: "sbo-event",
        providerMarketId: "sbo-market", providerSelectionId: `sbo-${quote.selection}`,
        rawOdds: quote.selection === "HOME" ? "2.25" : quote.rawOdds })) };
    const api: CatalogApiLike = { read: async (id) => id === sabaAccount.id ? saba : sbobet };
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }} catalogApi={api} />);

    expect((await screen.findByRole("checkbox", { name: /SABA main/u }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /SBOBET main/u }) as HTMLInputElement).checked).toBe(true);
    expect((await screen.findAllByText("#SABA")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("#SBOBET").length).toBeGreaterThan(0);
    expect(screen.getByText(/Starts in/u)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SABA" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SBOBET" })).toBeTruthy();
    expect(screen.getAllByText(/Alpha.*2\.25/u).some((element) => String(element.className).includes("best"))).toBe(true);
    expect(screen.getByText(/Alpha: lệch 0\.450 \(25\.00%\)/u)).toBeTruthy();
    expect(screen.getByText("Biên cân hiện tại: 18.42%")).toBeTruthy();
    expect(screen.getAllByText("Lãi/lỗ 35,000 VND")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "View & watch Alpha vs Beta" }));
    expect(await screen.findByText("Books shown in this comparison")).toBeTruthy();
    expect(screen.getByText("Comparing SABA vs SBOBET")).toBeTruthy();
  });

  it("keeps the last verified provider snapshot visible when the next poll fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus, currentOdds: readonly [string, string] = ["1.8", "2.5"]): LiveCatalogResponse => ({
      ...catalog, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}`,
        rawOdds: quote.selection === "HOME" ? currentOdds[0] : currentOdds[1] }))
    });
    let sabaReads = 0;
    const api: CatalogApiLike = { read: async (id) => {
      if (id === sabaAccount.id && ++sabaReads > 1) throw new Error("transient empty snapshot");
      return id === sabaAccount.id ? providerCatalog(sabaAccount) :
        providerCatalog(sbobetAccount, sabaReads > 1 ? ["2.5", "1.8"] : ["1.8", "2.5"]);
    } };

    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }} catalogApi={api} />);
    expect(await screen.findByRole("columnheader", { name: "SABA" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    expect(screen.getByRole("columnheader", { name: "SABA" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SBOBET" })).toBeTruthy();
    expect(screen.getByText(/1 selected provider\(s\) unavailable.*last verified snapshot is retained/iu)).toBeTruthy();
    expect(screen.getByText("1 stale snapshot retained")).toBeTruthy();
    expect(screen.queryByText("PRICE GAP DETECTED")).toBeNull();
  });

  it("restores last verified catalogs as display-only after a page reload", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus): LiveCatalogResponse => ({
      ...catalog, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}` }))
    });
    const accounts = { ...accountApi, list: async () => [sabaAccount, sbobetAccount] };
    const first = render(<LiveCatalogPage accountApi={accounts} catalogApi={{
      read: async (id) => providerCatalog(id === sabaAccount.id ? sabaAccount : sbobetAccount)
    }} />);
    expect(await screen.findByRole("columnheader", { name: "SABA" })).toBeTruthy();
    first.unmount();

    render(<LiveCatalogPage accountApi={accounts} catalogApi={{ read: async () => {
      throw new Error("provider temporarily unavailable");
    } }} />);

    expect(await screen.findByRole("columnheader", { name: "SABA" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SBOBET" })).toBeTruthy();
    expect(screen.getByText("2 stale snapshots retained")).toBeTruthy();
    expect(screen.queryByText("PRICE GAP DETECTED")).toBeNull();
  });

  it("hides single-book matches from the cross-book monitor", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByText("Monitoring exact two-book prices")).toBeTruthy();
    expect(screen.queryByText("Alpha vs Beta")).toBeNull();
    expect(screen.getByText("0 cross-book match(es)")).toBeTruthy();
    expect(screen.getByText(/1 event without an exact two-book ticket hidden/u)).toBeTruthy();
  });

  it("does not expose a single CMD price row as a comparison", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load live catalog" }));

    expect(await screen.findByText("Monitoring exact two-book prices")).toBeTruthy();
    expect(screen.queryByText("Alpha vs Beta")).toBeNull();
    expect(screen.getByText("0 cross-book match(es)")).toBeTruthy();
    expect(screen.queryByText(/arbitrage verified/iu)).toBeNull();
    expect(screen.queryByRole("button", { name: /^(bet|wager|place bet)$/iu })).toBeNull();
  });

  it("keeps every book visible in match detail and explains missing comparisons", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const saba = { ...catalog, accountId: sabaAccount.id, provider: "SABA" as const,
      events: [{ ...event, provider: "SABA" as const, providerEventId: "saba-event" }],
      markets: [{ ...market, provider: "SABA" as const, providerEventId: "saba-event", providerMarketId: "saba-market" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" as const, providerEventId: "saba-event",
        providerMarketId: "saba-market", providerSelectionId: `saba-${quote.selection}` })) };
    const otherEvent = { ...event, provider: "SBOBET" as const, providerEventId: "other-event",
      participantA: "Gamma", participantB: "Delta" };
    const sbobet = { ...catalog, accountId: sbobetAccount.id, provider: "SBOBET" as const,
      events: [otherEvent], markets: [], quotes: [] };
    const api: CatalogApiLike = { read: async (id) => id === sabaAccount.id ? saba : sbobet };
    window.history.replaceState({}, "", "/live-catalog?account=saba-account&event=saba-event");
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }} catalogApi={api} />);

    expect(await screen.findByRole("button", { name: "Back to matches" })).toBeTruthy();

    expect(screen.getByLabelText("SABA available for this match")).toBeTruthy();
    expect(screen.getByLabelText("SBOBET no exact event match")).toBeTruthy();
    expect((screen.getByLabelText("CMD not connected") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("APSPORT not connected") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("BTI not connected") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Cross-book comparison unavailable.*SBOBET/u)).toBeTruthy();
  });

  it("keeps LoL loading available while showing that no LoL account is connected", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "LoL" }));
    expect(screen.getByLabelText("SABA unavailable")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Load live catalog" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("clears a Football catalog error when switching to LoL", async () => {
    const unavailableCatalogApi: CatalogApiLike = { read: async () => { throw new Error("unavailable"); } };
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={unavailableCatalogApi} />);

    expect(await screen.findByText(/Live catalog is unavailable/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "LoL" }));

    expect(screen.getByLabelText("SABA unavailable")).toBeTruthy();
    expect(screen.queryByText(/Live catalog is unavailable/u)).toBeNull();
  });

  it("retries the same Football account after leaving and returning to the category", async () => {
    const read = vi.fn<CatalogApiLike["read"]>()
      .mockRejectedValueOnce(new Error("stale provider page"))
      .mockResolvedValue(catalog);
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={{ read }} />);
    expect(await screen.findByText(/Live catalog is unavailable/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "LoL" }));
    fireEvent.click(screen.getByRole("button", { name: "Football" }));

    expect(await screen.findByText("Monitoring exact two-book prices")).toBeTruthy();
    expect(screen.queryByText("Alpha vs Beta")).toBeNull();
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("loads verified SABA LoL series moneylines but keeps single-book tickets hidden", async () => {
    const lolAccount: AccountStatus = { ...account, id: "saba-lol", alias: "SABA LoL", provider: "SABA", category: "LOL" };
    const lolEvent: ProviderEvent = {
      provider: "SABA", category: "LOL", providerEventId: "lol-1", competition: "League of Legends - LCK",
      seasonStage: null, startAtUtcMs: Date.now() + 60_000, participantA: "G2", participantB: "TH",
      eventScope: "SERIES", bestOf: 5, isLive: false, rematchCandidate: null,
      fixtureDiscriminator: null, gameVariant: "LOL_PC", liveState: null
    };
    const lolMarket: ProviderMarket = {
      provider: "SABA", category: "LOL", providerEventId: "lol-1", providerMarketId: "series-1",
      marketType: "SERIES_WINNER", scope: "SERIES", line: null,
      settlementProfile: "saba-esports-two-way-moneyline", status: "OPEN"
    };
    const lolCatalog: LiveCatalogResponse = {
      dataMode: "LIVE", accountId: lolAccount.id, provider: "SABA", category: "LOL",
      comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Date.now(), rejectedMarketCount: 0,
      events: [lolEvent], markets: [lolMarket], quotes: ["TEAM_A", "TEAM_B"].map((selection, index) => ({
        provider: "SABA", category: "LOL", providerEventId: "lol-1", providerMarketId: "series-1",
        providerSelectionId: `series-${index}`, marketType: "SERIES_WINNER", scope: "SERIES", selection,
        line: null, rawOdds: index === 0 ? "-0.5" : "0.4", rawFormat: "MALAY", status: "OPEN",
        isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
      }))
    };
    render(<LiveCatalogPage
      accountApi={{ ...accountApi, list: async () => [lolAccount] }}
      catalogApi={{ read: async () => lolCatalog }} />);

    fireEvent.click(await screen.findByRole("button", { name: "LoL" }));
    expect(await screen.findByText(/1 event without an exact two-book ticket hidden/u)).toBeTruthy();
    expect(screen.queryByText("G2 vs TH")).toBeNull();
  });

  it("restores LoL after a page reload and does not filter valid LoL catalogs as Football", async () => {
    const lolAccount: AccountStatus = { ...account, id: "saba-lol", alias: "SABA LoL", provider: "SABA", category: "LOL" };
    const lolCatalog: LiveCatalogResponse = {
      ...catalog, accountId: lolAccount.id, provider: "SABA", category: "LOL",
      events: [{
        provider: "SABA", category: "LOL", providerEventId: "lol-reload", competition: "League of Legends - LCK",
        seasonStage: null, startAtUtcMs: Date.now() + 60_000, participantA: "G2", participantB: "TH",
        eventScope: "SERIES", bestOf: 5, isLive: false, rematchCandidate: null,
        fixtureDiscriminator: null, gameVariant: "LOL_PC", liveState: null
      }],
      markets: [{
        provider: "SABA", category: "LOL", providerEventId: "lol-reload", providerMarketId: "series-reload",
        marketType: "SERIES_WINNER", scope: "SERIES", line: null,
        settlementProfile: "saba-esports-two-way-moneyline", status: "OPEN"
      }],
      quotes: ["TEAM_A", "TEAM_B"].map((selection, index) => ({
        provider: "SABA", category: "LOL", providerEventId: "lol-reload", providerMarketId: "series-reload",
        providerSelectionId: `reload-${index}`, marketType: "SERIES_WINNER", scope: "SERIES", selection,
        line: null, rawOdds: index === 0 ? "1.8" : "2.0", rawFormat: "DECIMAL", status: "OPEN",
        isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
      }))
    };
    window.localStorage.setItem("tool-chenh.live-catalog.category.v1", "LOL");
    const read = vi.fn(async () => lolCatalog);

    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [lolAccount] }} catalogApi={{ read }} />);

    expect((await screen.findByRole("button", { name: "LoL" })).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(/1 event without an exact two-book ticket hidden/u)).toBeTruthy();
    expect(read).toHaveBeenCalledWith(lolAccount.id);
  });

  it("reopens a selected match detail from its safe URL identity", async () => {
    window.history.replaceState({}, "", "/live-catalog?account=account-1&event=event-1");
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByRole("button", { name: "Back to matches" })).toBeTruthy();
    expect(screen.getByText(/Cross-book comparison unavailable/u)).toBeTruthy();
  });
});
