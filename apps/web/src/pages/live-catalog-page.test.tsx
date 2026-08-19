import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AccountStatus, CatalogSourceStatus, ProviderEvent, ProviderMarket, ProviderQuote,
  ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountApiLike } from "../api/accounts.js";
import type { CatalogApiLike, LiveCatalogResponse } from "../api/catalog.js";
import type { CatalogSourceApiLike } from "../api/catalog-sources.js";
import type { ProviderPreflightApiLike } from "../api/provider-preflight.js";
import type { ProviderTicketApiLike, ProviderTicketIdentity } from "../api/provider-ticket.js";
import { filterAccountBackedSignals, LiveCatalogPage, selectBettingAccount } from "./live-catalog-page.js";
import { WATCH_BASE_STAKE_STORAGE_KEY } from "../watch/stake-settings.js";
import { SOUND_ENABLED_STORAGE_KEY } from "../watch/sound-settings.js";
import type { LagSignal } from "../watch/lag-signal-tracker.js";

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
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.localStorage.clear();
  window.history.replaceState({}, "", "/live-catalog");
});

describe("LiveCatalogPage", () => {
  it("keeps the comparison workspace fixed by omitting volatile source and movement panels", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    expect(screen.queryByText("Monitoring exact two-book prices")).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent observed price movements" })).toBeNull();
    expect(screen.queryByText(/Nguồn dữ liệu/u)).toBeNull();
    expect(screen.queryByText("LIVE READ-ONLY")).toBeNull();
    expect(screen.queryByText(/fresh provider\(s\)/u)).toBeNull();
  });

  it("persists the live and pre-match visibility choices", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    const live = await screen.findByRole("checkbox", { name: "Live" });
    const prematch = screen.getByRole("checkbox", { name: "Pre-match" });
    expect((live as HTMLInputElement).checked).toBe(true);
    expect((prematch as HTMLInputElement).checked).toBe(true);
    fireEvent.click(prematch);
    expect((prematch as HTMLInputElement).checked).toBe(false);
    expect(window.localStorage.getItem("tool-chenh.live-catalog.event-phase.v1")).toBe("LIVE");
  });
  it("keeps the notification sound toggle in browser storage", async () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi} catalogApi={catalogApi} />);
    const toggle = await screen.findByRole("button", { name: "Âm thanh: Bật" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.textContent).toContain("Âm thanh: Tắt");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(SOUND_ENABLED_STORAGE_KEY)).toBe("false");

    cleanup();
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi} catalogApi={catalogApi} />);
    expect(await screen.findByRole("button", { name: "Âm thanh: Tắt" })).toBeTruthy();
  });

  it("keeps diagnostics compact without empty monitoring panels", async () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi} catalogApi={catalogApi} />);

    const workspace = await screen.findByRole("region", { name: "Live comparison workspace" });
    const stake = screen.getByRole("region", { name: "Cấu hình tiền cược" });
    expect(screen.getByRole("heading", { level: 1 }).closest(".page-header")?.classList.contains("page-header--compact")).toBe(true);
    expect(screen.queryByText("Monitoring exact two-book prices")).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent observed price movements" })).toBeNull();
    expect(stake.classList.contains("stake-panel--compact")).toBe(true);
    expect(workspace).toBeTruthy();
  });

  it("uses a fixed-height workspace when no exact pair is available", async () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi} catalogApi={catalogApi} />);

    const workspace = await screen.findByRole("region", { name: "Live comparison workspace" });
    expect(workspace.classList.contains("catalog-workspace--stable")).toBe(true);
    expect(workspace.querySelector(".catalog-workspace__list--locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Observe Alpha vs Beta" })).toBeNull();
  });

  it("shows provider thumbnails with provider names in the selector", async () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi} catalogApi={catalogApi} />);

    await screen.findByRole("img", { name: "CMD logo" });
    expect(screen.getAllByRole("img", { name: "CMD logo" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("CMD main")).toBeTruthy();
  });

  it("loads source catalogs without waiting for the slower account/profile list", async () => {
    const source = (provider: "SABA" | "SBOBET"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "SBOBET"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`,
        rawOdds: provider === "SABA"
          ? (quote.selection === "HOME" ? "2.2" : "1.7")
          : (quote.selection === "HOME" ? "1.7" : "2.2") }))
    });
    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => new Promise(() => undefined) }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("SBOBET")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "SBOBET") }} />);

    const compactCard = await screen.findByRole("button", { name: "Compare Alpha vs Beta" }, { timeout: 1_000 });
    expect(within(compactCard).getByText("ROI 10.00%")).toBeTruthy();
    expect(within(compactCard).getByText(/Estimated balanced profit/u)).toBeTruthy();
    expect(within(compactCard).queryByText(/exact two-outcome ticket/u)).toBeNull();
    expect(within(compactCard).queryByText(/#SABA ↔ #SBOBET/u)).toBeNull();
    expect(within(compactCard).queryByText(/^Scheduled /u)).toBeNull();
  });

  it("shows a full two-book ROI summary and excludes one-provider events from the arbitrage list", async () => {
    const source = (provider: "SABA" | "SBOBET"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "SBOBET"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`,
        rawOdds: provider === "SABA"
          ? (quote.selection === "HOME" ? "2.2" : "1.7")
          : (quote.selection === "HOME" ? "1.7" : "2.2") }))
    });
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("SBOBET")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "SBOBET") }} />);

    const summaryCard = await screen.findByRole("button", { name: "Compare Alpha vs Beta" });
    const summaryRoi = within(summaryCard).getByText("ROI 10.00%");
    expect(within(summaryCard).getAllByText("ROI 10.00%")).toHaveLength(1);
    expect(summaryRoi.classList.contains("event-edge-summary__roi")).toBe(true);
    expect(summaryRoi.classList.contains("roi-badge--lg")).toBe(true);
    expect(within(summaryCard).getByText("Estimated balanced profit 20,000 VND")).toBeTruthy();
    expect(summaryCard.classList.contains("catalog-event--roi-positive")).toBe(false);
    expect(within(summaryCard).getByTestId("provider-brand-SABA")).toBeTruthy();
    expect(within(summaryCard).getByTestId("provider-brand-SBOBET")).toBeTruthy();
    expect(screen.getAllByText("FT_AH · Line -0.5")).toHaveLength(2);
    expect(screen.getByText("2.2 / 2.2")).toBeTruthy();
    expect(screen.getByLabelText("Selected ticket balance")).toBeTruthy();
  });

  it("renders a negative observation ROI in red instead of the neutral warning tone", async () => {
    const source = (provider: "SABA" | "SBOBET"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "SBOBET"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`,
        rawOdds: "1.8" }))
    });

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("SBOBET")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "SBOBET") }} />);

    const card = await screen.findByRole("button", { name: "Compare Alpha vs Beta" });
    const roi = within(card).getByText("ROI -10.00%");
    expect(roi.classList.contains("roi-badge--lg")).toBe(true);
    expect(card.classList.contains("catalog-event--roi-negative")).toBe(true);
    expect(card.querySelector(".event-edge-summary")?.classList.contains("event-edge-summary--roi-negative")).toBe(true);
  });

  it("renders globally ranked ticket cards and pins the exact ticket selected from the list", async () => {
    const source = (provider: "SABA" | "SBOBET"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "SBOBET"): LiveCatalogResponse => {
      const providerEventId = `${provider}-event`;
      const lines = ["-0.5", "-1.5"] as const;
      return { ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
        events: [{ ...event, provider, providerEventId }],
        markets: lines.map((line) => ({ ...market, provider, providerEventId,
          providerMarketId: `${provider}-${line}`, line })),
        quotes: lines.flatMap((line) => (["HOME", "AWAY"] as const).map((selection, index) => {
          const high = line === "-1.5" ? "3" : "2.2";
          const low = line === "-1.5" ? "1.2" : "1.7";
          return { ...quotes[index]!, provider, providerEventId, providerMarketId: `${provider}-${line}`,
            providerSelectionId: `${provider}-${line}-${selection}`, line,
            rawOdds: (provider === "SABA") === (selection === "HOME") ? high : low };
        })) };
    };
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("SBOBET")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "SBOBET") }} />);

    const cards = await screen.findAllByRole("button", { name: /Compare Alpha vs Beta/u });
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("ROI 50.00%")).toBeTruthy();
    expect(within(cards[1]!).getByText("ROI 10.00%")).toBeTruthy();

    fireEvent.click(cards[1]!);
    expect(new URLSearchParams(window.location.search).get("ticket")).not.toBeNull();
    expect(document.querySelector(".ranked-ticket-row--highlight")).toBeTruthy();
  });

  it("shows one enabled provider button for each leg directly on a profitable match card", async () => {
    const source = (provider: "SABA" | "CMD"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "CMD"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`,
        providerSelectionId: provider === "CMD"
          ? `${provider}-market:${quote.selection === "HOME" ? "home" : "away"}`
          : `${provider}-${quote.selection}`,
        rawOdds: provider === "SABA"
          ? (quote.selection === "HOME" ? "2.2" : "1.7")
          : (quote.selection === "HOME" ? "1.7" : "2.2") }))
    });
    const opened: ProviderTicketIdentity[] = [];
    const providerTicketApi: ProviderTicketApiLike = {
      features: async () => ({ openProviderTicket: true }),
      focus: async (identity) => { opened.push(identity); }
    };

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("CMD")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "CMD") }}
      providerTicketApi={providerTicketApi} />);

    const card = await screen.findByRole("button", { name: "Compare Alpha vs Beta" });
    fireEvent.click(await within(card).findByRole("button", { name: "Mở kèo SABA tại sàn" }));
    fireEvent.click(within(card).getByRole("button", { name: "Mở kèo CMD tại sàn" }));

    expect(opened).toEqual([
      { provider: "SABA", providerEventId: "SABA-event", providerMarketId: "SABA-market",
        providerSelectionId: "SABA-HOME" },
      { provider: "CMD", providerEventId: "CMD-event", providerMarketId: "CMD-market",
        providerSelectionId: "CMD-market:away" }
    ]);
    expect(screen.queryByRole("button", { name: "Back to matches" })).toBeNull();
  });

  it("shows only the two providers that produce the displayed edge on each match card", async () => {
    type ComparisonProvider = "SABA" | "SBOBET" | "CMD" | "BTI";
    const providers: readonly ComparisonProvider[] = ["SABA", "SBOBET", "CMD", "BTI"];
    const source = (provider: ComparisonProvider): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: ComparisonProvider): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`,
        rawOdds: provider === "SABA" ? (quote.selection === "HOME" ? "2.2" : "1.7")
          : provider === "SBOBET" ? (quote.selection === "HOME" ? "1.7" : "2.2") : "1.55" }))
    });
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => providers.map(source) }}
      catalogApi={{ read: async (id) => providerCatalog(providers.find((provider) => id.includes(provider))!) }} />);

    const card = await screen.findByRole("button", { name: "Compare Alpha vs Beta" });
    const brands = within(card).getAllByTestId(/^provider-brand-/u);
    expect(brands).toHaveLength(2);
    expect(brands.map((brand) => brand.getAttribute("data-testid"))).toEqual([
      "provider-brand-SABA", "provider-brand-SBOBET"
    ]);
  });

  it("limits summary odds to five fractional digits", async () => {
    const source = (provider: "SABA" | "SBOBET"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "SBOBET"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`,
        rawFormat: "MALAY" as const, rawOdds: quote.selection === (provider === "SABA" ? "HOME" : "AWAY") ? "0.59" : "-0.66" }))
    });
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("SBOBET")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "SBOBET") }} />);

    const summaryOdds = await screen.findByText("2.51515 / 2.51515");
    expect(summaryOdds.closest(".event-edge-summary")?.textContent).not.toContain("2.5151515151");
    expect(screen.getAllByText(/@ 2\.51515$/u).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("2.515151515151");
  });

  it("does not pad the exact-pair list with one-book observed matches", async () => {
    const observedEvents = Array.from({ length: 8 }, (_, index) => ({ ...event,
      provider: "SABA" as const, providerEventId: `event-${index}`, participantA: `Home ${index}`,
      participantB: `Away ${index}`, startAtUtcMs: Date.now() + (index + 1) * 60_000 }));
    const observedCatalog: LiveCatalogResponse = { ...catalog, accountId: "catalog-source:SABA:FOOTBALL",
      provider: "SABA", events: observedEvents,
      markets: observedEvents.map((item, index) => ({ ...market, provider: "SABA" as const,
        providerEventId: item.providerEventId, providerMarketId: `market-${index}` })),
      quotes: observedEvents.flatMap((item, eventIndex) => quotes.map((quote, quoteIndex) => ({ ...quote,
        provider: "SABA" as const, providerEventId: item.providerEventId, providerMarketId: `market-${eventIndex}`,
        providerSelectionId: `selection-${eventIndex}-${quoteIndex}` }))) };

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [{ id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA",
        category: "FOOTBALL", sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null }] }}
      catalogApi={{ read: async () => observedCatalog }} />);

    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Observe Home/u })).toBeNull();
    expect(screen.queryByText("ONE BOOK / NO EXACT PAIR")).toBeNull();
  });

  it("publishes an exact pair without waiting for another selected provider that hangs", async () => {
    const source = (provider: "SABA" | "SBOBET" | "APSPORT"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SBOBET" | "APSPORT"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event` }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`,
        rawOdds: provider === "APSPORT"
          ? (quote.selection === "HOME" ? "2.2" : "1.7")
          : (quote.selection === "HOME" ? "1.7" : "2.2") }))
    });
    const never = new Promise<LiveCatalogResponse>(() => undefined);
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("APSPORT"), source("SBOBET"), source("SABA")] }}
      catalogApi={{ read: async (id) => id.includes("SABA") ? never
        : providerCatalog(id.includes("APSPORT") ? "APSPORT" : "SBOBET") }} />);

    const compactCard = await screen.findByRole("button", { name: "Compare Alpha vs Beta" }, { timeout: 1_000 });
    expect(within(compactCard).getByText("ROI 10.00%")).toBeTruthy();
    expect(within(compactCard).getByTestId("provider-brand-APSPORT")).toBeTruthy();
    expect(within(compactCard).getByTestId("provider-brand-SBOBET")).toBeTruthy();
  });

  it("does not list a single-provider match as an arbitrage comparison", async () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [{ id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA",
        category: "FOOTBALL", sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null }] }}
      catalogApi={{ read: async () => ({ ...catalog, accountId: "catalog-source:SABA:FOOTBALL", provider: "SABA",
        events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
        quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) }) }} />);

    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Observe Alpha vs Beta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare Alpha vs Beta" })).toBeNull();
  });

  it("excludes virtual football even when two providers expose the same ticket", async () => {
    const source = (provider: "SABA" | "SBOBET"): CatalogSourceStatus => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    });
    const providerCatalog = (provider: "SABA" | "SBOBET"): LiveCatalogResponse => ({
      ...catalog, accountId: `catalog-source:${provider}:FOOTBALL`, provider,
      events: [{ ...event, provider, providerEventId: `${provider}-event`, isVirtual: true,
        sportVariant: "VIRTUAL_FOOTBALL" }],
      markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}` }))
    });
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source("SABA"), source("SBOBET")] }}
      catalogApi={{ read: async (id) => providerCatalog(id.includes("SABA") ? "SABA" : "SBOBET") }} />);

    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(screen.queryByText("Alpha vs Beta")).toBeNull();
    expect(screen.queryByText("#VIRTUAL")).toBeNull();
  });

  it("keeps stable catalog-source identity separate from the newest eligible betting account", async () => {
    const source: CatalogSourceStatus = { id: "catalog-source:SABA:FOOTBALL", alias: "C-Sports · SABA",
      provider: "SABA", category: "FOOTBALL", sessionState: "ACTIVE", sessionSource: "FABET_LOGIN",
      acquiredAtMs: 200, reason: null };
    const older: AccountStatus = { ...account, id: "bettor-old", provider: "SABA", category: "FOOTBALL",
      alias: "Old bettor", capabilities: ["PROFILE", "PREFLIGHT"], balanceAsOfMs: 100 };
    const newer: AccountStatus = { ...older, id: "bettor-new", alias: "New bettor", balanceAsOfMs: 200 };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => ({ ...catalog, accountId: id,
      provider: "SABA", events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) }));
    const sourceApi: CatalogSourceApiLike = { list: async () => [source] };

    expect(selectBettingAccount([older, newer], "SABA", "FOOTBALL")?.id).toBe("bettor-new");
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [older, newer] }}
      catalogApi={{ read }} catalogSourceApi={sourceApi} fixedCategory="FOOTBALL" />);

    expect(await screen.findByText("C-Sports · SABA")).toBeTruthy();
    expect(read).toHaveBeenCalledWith("catalog-source:SABA:FOOTBALL");
    expect(read).not.toHaveBeenCalledWith("bettor-new");
  });

  it("keeps catalog-only or stale-balance providers out of executable lag signals", () => {
    const saba = { ...catalog, accountId: "saba-account", provider: "SABA" as const };
    const sbobet = { ...catalog, accountId: "sbobet-account", provider: "SBOBET" as const };
    const candidate = { plan: { currency: "VND", legs: [
      { provider: "SABA", stake: "100000" }, { provider: "SBOBET", stake: "80000" }
    ] } } as unknown as LagSignal;
    const fresh = (id: string, provider: "SABA" | "SBOBET"): AccountStatus => ({ ...account,
      id, provider, alias: provider, currency: "VND", balance: "500000", balanceAsOfMs: 10_000 });
    const sabaAccount = fresh("saba-account", "SABA");
    const sbobetAccount = fresh("sbobet-account", "SBOBET");

    expect(filterAccountBackedSignals([candidate], [saba, sbobet], [sabaAccount, sbobetAccount], 20_000)).toEqual([]);
    expect(filterAccountBackedSignals([candidate], [saba, sbobet], [
      { ...sabaAccount, capabilities: [...sabaAccount.capabilities, "PREFLIGHT"] },
      { ...sbobetAccount, capabilities: [...sbobetAccount.capabilities, "PREFLIGHT"] }
    ], 20_000)).toEqual([candidate]);
    expect(filterAccountBackedSignals([candidate], [saba, sbobet], [sabaAccount,
      { ...sbobetAccount, profileState: "UNAVAILABLE", balance: null, balanceAsOfMs: null }], 20_000)).toEqual([]);
    expect(filterAccountBackedSignals([candidate], [saba, sbobet], [sabaAccount,
      { ...sbobetAccount, balanceAsOfMs: 1 }], 40_002)).toEqual([]);
    expect(filterAccountBackedSignals([candidate], [saba, sbobet], [sabaAccount,
      { ...sbobetAccount, balance: "79000" }], 20_000)).toEqual([]);
    expect(filterAccountBackedSignals([candidate], [saba, sbobet], [sabaAccount,
      { ...sbobetAccount, currency: "UUS" }], 20_000)).toEqual([]);
  });

  it("shows the immediate price movement but no executable signal without ticket preflight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const executableProfile = { currency: "VND", balance: "1000000", balanceAsOfMs: 1_000 } as const;
    const sabaAccount: AccountStatus = { ...account, ...executableProfile,
      id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, ...executableProfile,
      id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
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

    expect(await screen.findByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    expect(screen.queryByText("Best live lag signal")).toBeNull();
    expect(screen.queryByRole("region", { name: "Recent observed price movements" })).toBeNull();
    expect(screen.queryByLabelText("Leg #SBOBET HOME at 2.2")).toBeNull();
    expect(screen.queryByText("PRICE GAP DETECTED")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Compare Alpha vs Beta" }));
    expect(screen.getByText("Chưa kiểm tra lại vé trực tiếp tại sàn")).toBeTruthy();
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
    expect(within(screen.getByRole("region", { name: "Cấu hình tiền cược" })).getByDisplayValue("100000")).toBe(input);
    expect(input.value).toBe("100000");
    expect(await screen.findByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    fireEvent.change(input, { target: { value: "150000" } });
    expect(window.localStorage.getItem(WATCH_BASE_STAKE_STORAGE_KEY)).toBe("150000");
  });

  it("recalculates the opposite display-only stake when a manual amount is below the assumed provider minimum", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus, home: string, away: string): LiveCatalogResponse => ({
      ...catalog, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}`,
        rawOdds: quote.selection === "HOME" ? home : away }))
    });
    const saba = providerCatalog(sabaAccount, "1.29", "1.2");
    const sbobet = providerCatalog(sbobetAccount, "1.2", "3.94");
    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? saba : sbobet }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Compare Alpha vs Beta" }));
    const sabaStake = screen.getByRole("spinbutton", { name: "Stake SABA Alpha" });
    const sbobetStake = screen.getByRole("spinbutton", { name: "Stake SBOBET Beta" });
    fireEvent.change(sabaStake, { target: { value: "50000" } });

    expect((sabaStake as HTMLInputElement).value).toBe("50000");
    expect((sbobetStake as HTMLInputElement).value).toBe("16371");
    expect((sabaStake as HTMLInputElement).step).toBe("1");
    expect((sbobetStake as HTMLInputElement).step).toBe("1");
    expect(screen.queryByText("KhÃ´ng thá»ƒ cÃ¢n vá»›i sá»‘ tiá»n nÃ y")).toBeNull();
    expect(screen.queryByText("Cannot calculate")).toBeNull();
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
  });

  it("shows provider checkboxes, countdown, provider badges, and side-by-side market rates", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const saba = { ...catalog, accountId: sabaAccount.id, provider: "SABA" as const,
      events: [{ ...event, provider: "SABA" as const, providerEventId: "saba-event" },
        { ...event, provider: "SABA" as const, providerEventId: "saba-virtual", participantA: "Virtual A",
          participantB: "Virtual B", isVirtual: true, sportVariant: "ESPORTS_FOOTBALL" }],
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
    const sabaSelector = screen.getByRole("checkbox", { name: /SABA main/u }).closest("label")!;
    const sbobetSelector = screen.getByRole("checkbox", { name: /SBOBET main/u }).closest("label")!;
    expect(within(sabaSelector).getByText("(1 match)")).toBeTruthy();
    expect(within(sbobetSelector).getByText("(1 match)")).toBeTruthy();
    expect((await screen.findAllByText("#SABA")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("#SBOBET").length).toBeGreaterThan(0);
    expect(screen.getByText(/Starts in/u)).toBeTruthy();
    const matchCard = screen.getByRole("button", { name: "Compare Alpha vs Beta" });
    expect(within(matchCard).getByText("Xem chi tiết 2 cửa")).toBeTruthy();
    expect(within(matchCard).queryByRole("table")).toBeNull();
    fireEvent.click(matchCard);
    const compactPrices = (await screen.findByRole("heading", { name: "Vé chấp 2 cửa giữa các sàn" })).closest("section")!;
    expect(compactPrices.querySelector("table")).toBeNull();
    expect(compactPrices.querySelectorAll(".watch-odds-provider")).toHaveLength(2);
    expect(within(compactPrices).getAllByText("2.25 DECIMAL").length).toBeGreaterThan(0);
    expect(screen.getByText(/Alpha: Gap 0\.45 · 25\.00%/u)).toBeTruthy();
    expect(screen.getAllByText("ROI 18.42%").length).toBeGreaterThan(0);
    expect(screen.getByText("Guaranteed 35,000 VND")).toBeTruthy();
    expect(screen.getByText(/If Alpha wins/u).textContent).toContain("35,000 VND");
    expect(screen.getByText(/If Beta wins/u).textContent).toContain("35,000 VND");
    expect(screen.getByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    expect(matchCard.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "View & watch Alpha vs Beta" })).toBeNull();
    expect(screen.queryByText("Click for details")).toBeNull();
    expect(screen.getByRole("heading", { name: "Exact two-book matches" })).toBeTruthy();
    expect(screen.queryByText(/Total: \d+ matches?/u)).toBeNull();
    expect(await screen.findByText("Books shown in this comparison")).toBeTruthy();
    expect(screen.getByText("Comparing SABA vs SBOBET")).toBeTruthy();
  });

  it("updates the selected detail in place on the next catalog delta", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sabaAccount: AccountStatus = {
      ...account, id: "saba-account", alias: "SABA main", provider: "SABA"
    };
    let cmdReads = 0;
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => {
      if (id === sabaAccount.id) {
        return {
          ...catalog, accountId: sabaAccount.id, provider: "SABA",
          events: [{ ...event, provider: "SABA", providerEventId: "saba-event" }],
          markets: [{ ...market, provider: "SABA", providerEventId: "saba-event", providerMarketId: "saba-market" }],
          quotes: quotes.map((quote) => ({
            ...quote, provider: "SABA", providerEventId: "saba-event", providerMarketId: "saba-market",
            providerSelectionId: `saba-${quote.selection}`,
            rawOdds: quote.selection === "HOME" ? "1.6" : "2.2"
          }))
        };
      }
      cmdReads += 1;
      return { ...catalog, observedAtMs: 100 + cmdReads,
        quotes: quotes.map((quote) => ({ ...quote,
          rawOdds: quote.selection === "HOME" && cmdReads > 1 ? "2.1" : quote.rawOdds,
          sequence: cmdReads })) };
    });
    window.history.replaceState({}, "", "/live-catalog?account=account-1&event=event-1");
    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [account, sabaAccount] }} catalogApi={{ read }} />);

    expect(await screen.findByRole("button", { name: "Back to matches" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    const detail = screen.getByRole("complementary", { name: "Selected match detail" });
    expect(within(detail).getByText("Alpha")).toBeTruthy();
    expect(within(detail).getAllByText("2.1 DECIMAL").length).toBeGreaterThan(0);
  });

  it("keeps the clicked match pinned when live-score evidence changes its comparison key", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const read = vi.fn(async (): Promise<LiveCatalogResponse> => {
      reads += 1;
      const scoreHome = reads > 1 ? 1 : 0;
      return { ...catalog, observedAtMs: 100 + reads,
        events: [{ ...event, isLive: true, liveState: { period: "1H", scoreHome, scoreAway: 0, clockMs: 60_000 } }],
        quotes: quotes.map((quote) => ({ ...quote, isLive: true, sequence: reads })) };
    });
    window.history.replaceState({}, "", "/live-catalog?account=account-1&event=event-1");
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi} catalogApi={{ read }} />);

    expect(await screen.findByRole("button", { name: "Back to matches" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    const detail = screen.getByRole("complementary", { name: "Selected match detail" });
    expect(within(detail).getByText("Alpha vs Beta")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to matches" })).toBeTruthy();
  });

  it("keeps refreshing a fast source while another selected source is still pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sources: readonly CatalogSourceStatus[] = [
      { id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
        sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null },
      { id: "catalog-source:IM:FOOTBALL", alias: "IM", provider: "IM", category: "FOOTBALL",
        sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null }
    ];
    let fastReads = 0;
    const never = new Promise<LiveCatalogResponse>(() => undefined);
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => {
      if (id === "catalog-source:IM:FOOTBALL") return never;
      fastReads += 1;
      return { ...catalog, accountId: id, provider: "SABA", observedAtMs: 100 + fastReads,
        events: [{ ...event, provider: "SABA", providerEventId: "saba-event" }],
        markets: [{ ...market, provider: "SABA", providerEventId: "saba-event", providerMarketId: "saba-market" }],
        quotes: quotes.map((quote) => ({ ...quote, provider: "SABA", providerEventId: "saba-event",
          providerMarketId: "saba-market", providerSelectionId: `saba-${quote.selection}`, sequence: fastReads })) };
    });

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => sources }} catalogApi={{ read }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fastReads).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(750));

    expect(fastReads).toBeGreaterThan(1);
    expect(screen.getByText("No exact two-book comparison is currently available")).toBeTruthy();
  });

  it("does not let an older overlapping refresh erase a newer exact pair", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sources: readonly CatalogSourceStatus[] = [
      { id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
        sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null },
      { id: "catalog-source:SBOBET:FOOTBALL", alias: "SBOBET", provider: "SBOBET", category: "FOOTBALL",
        sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null }
    ];
    const counts = new Map<string, number>();
    let releaseSlowRefresh: ((value: LiveCatalogResponse) => void) | undefined;
    const slowRefresh = new Promise<LiveCatalogResponse>((resolve) => { releaseSlowRefresh = resolve; });
    const providerCatalog = (source: CatalogSourceStatus, observedAtMs: number,
      empty = false): LiveCatalogResponse => {
      const providerEventId = `${source.provider}-event`;
      const providerMarketId = `${source.provider}-market`;
      return { ...catalog, accountId: source.id, provider: source.provider, observedAtMs,
        events: empty ? [] : [{ ...event, provider: source.provider, providerEventId }],
        markets: empty ? [] : [{ ...market, provider: source.provider, providerEventId, providerMarketId }],
        quotes: empty ? [] : quotes.map((quote) => ({ ...quote, provider: source.provider, providerEventId,
          providerMarketId, providerSelectionId: `${source.provider}-${quote.selection}`,
          rawOdds: source.provider === "SABA"
            ? (quote.selection === "HOME" ? "2.2" : "1.7")
            : (quote.selection === "HOME" ? "1.7" : "2.2") })) };
    };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => {
      const source = sources.find((candidate) => candidate.id === id)!;
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      if (count === 1) return providerCatalog(source, 100);
      if (source.provider === "SBOBET" && count === 2) return slowRefresh;
      if (source.provider === "SABA" && count === 2) return providerCatalog(source, 200, true);
      return providerCatalog(source, 300 + count);
    });

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => sources }} catalogApi={{ read }} />);
    expect(await screen.findByRole("button", { name: "Compare Alpha vs Beta" })).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(250));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByRole("button", { name: "Compare Alpha vs Beta" })).toBeTruthy();

    await act(async () => {
      releaseSlowRefresh?.(providerCatalog(sources[1]!, 200));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Compare Alpha vs Beta" })).toBeTruthy();
  });

  it("keeps the last exact pair visible when source status briefly becomes unavailable", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const activeSources: readonly CatalogSourceStatus[] = (["SABA", "SBOBET"] as const).map((provider) => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    }));
    let sourceReads = 0;
    const providerCatalog = (source: CatalogSourceStatus): LiveCatalogResponse => {
      const providerEventId = `${source.provider}-event`;
      const providerMarketId = `${source.provider}-market`;
      return { ...catalog, accountId: source.id, provider: source.provider,
        events: [{ ...event, provider: source.provider, providerEventId }],
        markets: [{ ...market, provider: source.provider, providerEventId, providerMarketId }],
        quotes: quotes.map((quote) => ({ ...quote, provider: source.provider, providerEventId,
          providerMarketId, providerSelectionId: `${source.provider}-${quote.selection}`,
          rawOdds: source.provider === "SABA"
            ? (quote.selection === "HOME" ? "2.2" : "1.7")
            : (quote.selection === "HOME" ? "1.7" : "2.2") })) };
    };

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => {
        sourceReads += 1;
        return sourceReads === 1 ? activeSources : activeSources.map((source) => ({ ...source,
          sessionState: "ACTION_REQUIRED" as const, reason: "EXPIRED" as const }));
      } }} catalogApi={{ read: async (id) => providerCatalog(activeSources.find((source) => source.id === id)!) }} />);
    expect(await screen.findByRole("button", { name: "Compare Alpha vs Beta" })).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(screen.getByRole("button", { name: "Compare Alpha vs Beta" })).toBeTruthy();
  });

  it("keeps a just-verified catalog fresh across a transient poll failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(10_000);
    const source: CatalogSourceStatus = { id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA",
      category: "FOOTBALL", sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null };
    let reads = 0;
    const read = vi.fn(async (): Promise<LiveCatalogResponse> => {
      reads += 1;
      if (reads > 1) throw new Error("transient timeout");
      return { ...catalog, accountId: source.id, provider: "SABA", observedAtMs: Date.now() };
    });

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => [source] }} catalogApi={{ read }} />);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));

    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(screen.queryByText("STALE")).toBeNull();
  });

  it("does not rewrite catalog state when a poll returns the same catalog revision", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA",
      currency: "VND", balance: "500000", balanceAsOfMs: Date.now(), capabilities: ["PROFILE", "CATALOG", "PREFLIGHT"] };
    const sbobetAccount: AccountStatus = { ...sabaAccount, id: "sbobet-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus): LiveCatalogResponse => ({
      ...catalog, observedAtMs: 500, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}`, sequence: 5 }))
    });
    const preflight = vi.fn(async (request: ProviderTicketPreflightRequest) => ({
      accountId: request.accountId, provider: request.accountId === sabaAccount.id ? "SABA" as const : "SBOBET" as const,
      providerEventId: request.providerEventId, providerMarketId: request.providerMarketId,
      providerSelectionId: request.providerSelectionId, selection: request.selection, line: request.line,
      decimalOdds: request.expectedDecimalOdds, quoteStatus: "OPEN" as const,
      limitEvidence: { currency: "VND" as const, minStake: "30000", maxStake: "500000", stakeStep: "1000",
        balance: "500000", verifiedAsOfMs: 500, expiresAtMs: Date.now() + 10_000 },
      constraint: { currency: "VND" as const, minStake: "30000", maxStake: "500000", stakeStep: "1000",
        balance: "500000", feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: 500,
        expiresAtMs: Date.now() + 10_000 }, eligible: true, reasons: []
    }));
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? providerCatalog(sabaAccount) : providerCatalog(sbobetAccount) }}
      providerPreflightApi={{ preflight }} />);

    expect((await screen.findAllByText("Alpha vs Beta")).length).toBeGreaterThan(0);
    const initialWrites = storageWrites.mock.calls.length;
    expect(initialWrites).toBeGreaterThan(0);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(storageWrites).toHaveBeenCalledTimes(initialWrites);
  });

  it("pauses background polling while the page is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const read = vi.fn(async () => catalog);
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={{ read }} />);
    await screen.findByRole("region", { name: "Live comparison workspace" });
    const initialReads = read.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(read).toHaveBeenCalledTimes(initialReads);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("cold-starts the recently reliable football books before slower sources", async () => {
    const providers = ["SABA", "IM", "SBOBET", "APSPORT", "BTI"] as const;
    const sources: readonly CatalogSourceStatus[] = providers.map((provider) => ({
      id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider,
      category: "FOOTBALL", sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    }));
    const order: string[] = [];
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => sources }} catalogApi={{ read: async (id) => {
        order.push(id);
        return { ...catalog, accountId: id, provider: sources.find((source) => source.id === id)!.provider };
      } }} />);

    await vi.waitFor(() => expect(order.length).toBeGreaterThanOrEqual(2));
    expect(order.slice(0, 2)).toEqual([
      "catalog-source:APSPORT:FOOTBALL",
      "catalog-source:SBOBET:FOOTBALL"
    ]);
  });

  it("keeps the other provider fresh when only one source completes a later poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sources: readonly CatalogSourceStatus[] = [
      { id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA", category: "FOOTBALL",
        sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null },
      { id: "catalog-source:IM:FOOTBALL", alias: "IM", provider: "IM", category: "FOOTBALL",
        sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null }
    ];
    const counts = new Map<string, number>();
    const never = new Promise<LiveCatalogResponse>(() => undefined);
    const read = async (id: string): Promise<LiveCatalogResponse> => {
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      if (id.includes(":IM:") && count > 1) return never;
      const provider = id.includes(":IM:") ? "IM" as const : "SABA" as const;
      return { ...catalog, accountId: id, provider, observedAtMs: 100 + count,
        events: [{ ...event, provider, providerEventId: `${provider}-event` }],
        markets: [{ ...market, provider, providerEventId: `${provider}-event`, providerMarketId: `${provider}-market` }],
        quotes: quotes.map((quote) => ({ ...quote, provider, providerEventId: `${provider}-event`,
          providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${quote.selection}`, sequence: count })) };
    };

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list: async () => sources }} catalogApi={{ read }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect((await screen.findAllByText("Alpha vs Beta")).length).toBeGreaterThan(0);

    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(screen.getAllByText("Alpha vs Beta").length).toBeGreaterThan(0);
    expect(screen.queryByText("STALE")).toBeNull();
  });

  it("shows exact full-time totals with a clear TÃ i/Xá»‰u label and both provider prices", async () => {
    const providerAccount = (id: string, provider: "SABA" | "SBOBET"): AccountStatus => ({ ...account,
      id, provider, alias: `${provider} main` });
    const sabaAccount = providerAccount("saba-account", "SABA");
    const sbobetAccount = providerAccount("sbobet-account", "SBOBET");
    const totalCatalog = (sourceAccount: AccountStatus, odds: readonly [string, string]): LiveCatalogResponse => {
      const provider = sourceAccount.provider;
      const providerEventId = `${provider}-event`;
      const providerMarketId = `${provider}-total-2.5`;
      return { ...catalog, accountId: sourceAccount.id, provider,
        events: [{ ...event, provider, providerEventId }],
        markets: [{ ...market, provider, providerEventId, providerMarketId,
          marketType: "FT_TOTAL", line: "2.5" }],
        quotes: (["OVER", "UNDER"] as const).map((selection, index) => ({ ...quotes[index]!, provider,
          providerEventId, providerMarketId, providerSelectionId: `${provider}-${selection}`,
          marketType: "FT_TOTAL", selection, line: "2.5", rawOdds: odds[index]! })) };
    };
    const saba = totalCatalog(sabaAccount, ["2.20", "1.72"]);
    const sbobet = totalCatalog(sbobetAccount, ["2.08", "1.85"]);

    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? saba : sbobet }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Compare Alpha vs Beta" }));
    expect((await screen.findAllByText("T\u00e0i/X\u1ec9u to\u00e0n tr\u1eadn")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("T\u00e0i").some((node) =>
      node.closest(".ranked-ticket-price")?.textContent?.includes("2.2 DECIMAL"))).toBe(true);
    expect(screen.getAllByText("X\u1ec9u").some((node) =>
      node.closest(".ranked-ticket-price")?.textContent?.includes("1.85 DECIMAL"))).toBe(true);
  });

  it("turns an exact row green only after both provider legs pass fresh preflight", async () => {
    const observedAtMs = Date.now();
    const liveAccount = (id: string, provider: "SABA" | "SBOBET"): AccountStatus => ({ ...account, id,
      alias: `${provider} main`, provider, currency: "VND", balance: "500000", balanceAsOfMs: observedAtMs,
      capabilities: ["CATALOG", "PROFILE", "PREFLIGHT"] });
    const sabaAccount = liveAccount("saba-account", "SABA");
    const sbobetAccount = liveAccount("sbobet-account", "SBOBET");
    const liveCatalog = (providerAccount: AccountStatus, odds: readonly [string, string]): LiveCatalogResponse => {
      const provider = providerAccount.provider;
      const eventId = `${provider}-event`;
      const marketId = `${provider}-market`;
      return { ...catalog, observedAtMs, accountId: providerAccount.id, provider,
        events: [{ ...event, provider, providerEventId: eventId }],
        markets: [{ ...market, provider, providerEventId: eventId, providerMarketId: marketId }],
        quotes: quotes.map((quote, index) => ({ ...quote, provider, providerEventId: eventId,
          providerMarketId: marketId, providerSelectionId: `${provider}-${quote.selection}`,
          rawOdds: odds[index]!, sourceTimestampMs: observedAtMs })) };
    };
    const saba = liveCatalog(sabaAccount, ["2.2", "1.2"]);
    const sbobet = liveCatalog(sbobetAccount, ["1.2", "3"]);
    const preflightRequests: ProviderTicketPreflightRequest[] = [];
    const providerPreflightApi: ProviderPreflightApiLike = { preflight: async (request) => {
      preflightRequests.push(request);
      const provider = request.accountId === sabaAccount.id ? "SABA" as const : "SBOBET" as const;
      const constraint = { currency: "VND" as const, minStake: "30000", maxStake: "500000",
        stakeStep: "5000", balance: "500000", feeType: "NONE" as const, feeRate: null,
        verifiedAsOfMs: observedAtMs, expiresAtMs: Date.now() + 3_000 };
      return { accountId: request.accountId, provider, providerEventId: request.providerEventId,
        providerMarketId: request.providerMarketId, providerSelectionId: request.providerSelectionId,
        selection: request.selection, line: request.line, decimalOdds: request.expectedDecimalOdds,
        quoteStatus: "OPEN" as const, limitEvidence: constraint, constraint, eligible: true, reasons: [] };
    } };

    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? saba : sbobet }}
      providerPreflightApi={providerPreflightApi} />);

    fireEvent.click(await screen.findByRole("button", { name: "Compare Alpha vs Beta" }));
    const ticket = await screen.findByRole("row", { name: /Ticket FT_AH/u });
    expect(ticket.className).toContain("ranked-ticket-row--profitable");
    expect(ticket.textContent).toContain("Guaranteed 45,000 VND");
    expect(preflightRequests.some((request) => request.accountId === sabaAccount.id)).toBe(true);
    expect(preflightRequests.some((request) => request.accountId === sbobetAccount.id)).toBe(true);
    expect(screen.queryByLabelText("Profitable ticket alerts")).toBeNull();
    expect(screen.queryByRole("button", { name: /Open profitable ticket/u })).toBeNull();
  });

  it("retains stale snapshots as display-only comparisons without executable signals", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "Compare Alpha vs Beta" }));
    expect(await screen.findByRole("columnheader", { name: "SABA" })).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(250));

    expect(screen.getByRole("columnheader", { name: "SABA" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SBOBET" })).toBeTruthy();
    expect(screen.getAllByText("Alpha vs Beta").length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: "Compare Alpha vs Beta" }));
    expect(await screen.findByRole("columnheader", { name: "SABA" })).toBeTruthy();
    first.unmount();

    render(<LiveCatalogPage accountApi={accounts} catalogApi={{ read: async () => {
      throw new Error("provider temporarily unavailable");
    } }} />);

    expect((await screen.findAllByText("Alpha vs Beta")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("columnheader", { name: "SABA" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "SBOBET" })).toBeTruthy();
    expect(screen.getByText("STALE")).toBeTruthy();
    expect(screen.queryByText("PRICE GAP DETECTED")).toBeNull();
  });

  it("keeps an API stale-while-revalidate snapshot display-only", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus): LiveCatalogResponse => ({
      ...catalog, snapshotState: "STALE", accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market` }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}` }))
    });

    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => providerCatalog(id === sabaAccount.id ? sabaAccount : sbobetAccount) }} />);

    expect(await screen.findByText("STALE")).toBeTruthy();
    expect(screen.queryByText("PRICE GAP DETECTED")).toBeNull();
  });

  it("hides a single-book event from the exact comparison list", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Observe Alpha vs Beta" })).toBeNull();
    expect(screen.getByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(screen.queryByRole("table", { name: /Top exact tickets/u })).toBeNull();
  });

  it("shows a mapped two-provider event even when no exact handicap line is shared", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-account", alias: "SABA main", provider: "SABA" };
    const sbobetAccount: AccountStatus = { ...account, id: "sbo-account", alias: "SBOBET main", provider: "SBOBET" };
    const providerCatalog = (providerAccount: AccountStatus, line: string): LiveCatalogResponse => ({
      ...catalog, accountId: providerAccount.id, provider: providerAccount.provider,
      events: [{ ...event, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event` }],
      markets: [{ ...market, provider: providerAccount.provider, providerEventId: `${providerAccount.provider}-event`,
        providerMarketId: `${providerAccount.provider}-market`, line }],
      quotes: quotes.map((quote) => ({ ...quote, provider: providerAccount.provider,
        providerEventId: `${providerAccount.provider}-event`, providerMarketId: `${providerAccount.provider}-market`,
        providerSelectionId: `${providerAccount.provider}-${quote.selection}`, line }))
    });
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, sbobetAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? providerCatalog(sabaAccount, "-0.5") :
        providerCatalog(sbobetAccount, "-1.5") }} />);

    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compare Alpha vs Beta" })).toBeNull();
  });

  it("exposes a single-provider price row as observation but never as an arbitrage", async () => {
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load live catalog" }));

    expect(await screen.findByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    expect(screen.getByText("No exact two-book comparison is currently available")).toBeTruthy();
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

  it("keeps a Football catalog error out of the fixed workspace when switching to LoL", async () => {
    const unavailableCatalogApi: CatalogApiLike = { read: async () => { throw new Error("unavailable"); } };
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={unavailableCatalogApi} />);

    await screen.findByText("No exact two-book comparison is currently available");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "LoL" }));

    expect(screen.getByLabelText("SABA unavailable")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retries the same Football account after leaving and returning to the category", async () => {
    const read = vi.fn<CatalogApiLike["read"]>()
      .mockRejectedValueOnce(new Error("stale provider page"))
      .mockResolvedValue(catalog);
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={{ read }} />);
    await screen.findByText("No exact two-book comparison is currently available");
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "LoL" }));
    fireEvent.click(screen.getByRole("button", { name: "Football" }));

    expect(await screen.findByRole("region", { name: "Live comparison workspace" })).toBeTruthy();
    expect(screen.getByText("No exact two-book comparison is currently available")).toBeTruthy();
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
    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
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
    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(read).toHaveBeenCalledWith(lolAccount.id);
  });

  it("reopens a selected match detail from its safe URL identity", async () => {
    window.history.replaceState({}, "", "/live-catalog?account=account-1&event=event-1");
    render(<LiveCatalogPage accountApi={accountApi} catalogApi={catalogApi} />);

    expect(await screen.findByRole("button", { name: "Back to matches" })).toBeTruthy();
    expect(screen.getByText(/Cross-book comparison unavailable/u)).toBeTruthy();
  });

  it("labels an expired Football source instead of presenting it as an empty catalog", async () => {
    const expired: AccountStatus = { ...account, sessionState: "ACTION_REQUIRED", reason: "EXPIRED" };
    const read = vi.fn(async () => catalog);

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [expired] }} catalogApi={{ read }} />);

    expect(await screen.findByLabelText("CMD nguồn hết hạn")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not add an empty-source status row after a successful empty provider response", async () => {
    const emptyCatalog: LiveCatalogResponse = { ...catalog, events: [], markets: [], quotes: [] };
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi}
      catalogApi={{ read: async () => emptyCatalog }} />);

    await screen.findByText("No exact two-book comparison is currently available");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.skip("refreshes the selected betting profile before its 30-second balance gate expires", async () => {
    const stale: AccountStatus = { ...account, profileState: "STALE", balanceAsOfMs: 1 };
    const refreshed: AccountStatus = { ...stale, profileState: "FRESH", currency: "VND",
      balance: "500000", balanceAsOfMs: Date.now() };
    const refresh = vi.fn(async () => refreshed);

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [stale], refresh }} catalogApi={catalogApi} />);

    expect(await screen.findByText("1 nguồn giá + profile đã xác minh; preflight vé chưa có")).toBeTruthy();
    expect(refresh).toHaveBeenCalledWith(stale.id);
  });

  it.skip("refreshes one betting profile only once when several catalog sources share its provider", async () => {
    const betting = { ...account, id: "saba-bettor", provider: "SABA" as const, category: "FOOTBALL" as const };
    const sources: readonly CatalogSourceStatus[] = ["one", "two"].map((suffix) => ({
      id: `saba-${suffix}`, alias: `SABA ${suffix}`, provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: 100, reason: null
    }));
    const refresh = vi.fn(async () => betting);

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [betting], refresh }}
      catalogSourceApi={{ list: async () => sources }} catalogApi={{ read: async (id) => ({ ...catalog,
        accountId: id, provider: "SABA" }) }} />);

    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole("button", { name: "Observe Alpha vs Beta" })).toHaveLength(1);
  });

  it.skip("does not let profile refresh compete with a cold catalog read", async () => {
    let completeCatalog: ((value: LiveCatalogResponse) => void) | undefined;
    const pendingCatalog = new Promise<LiveCatalogResponse>((resolve) => { completeCatalog = resolve; });
    const refresh = vi.fn(async () => account);

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, refresh }} catalogApi={{ read: async () => pendingCatalog }} />);
    await screen.findByText("Football Live Price Gaps");
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(refresh).not.toHaveBeenCalled();

    completeCatalog?.(catalog);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it.skip("does not refresh betting profiles while the page is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const refresh = vi.fn(async () => account);

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, refresh }} catalogApi={catalogApi} />);

    await screen.findByRole("region", { name: "Live comparison workspace" });
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not launch betting-profile refreshes from the read-only price monitor", async () => {
    const refresh = vi.fn(async () => account);

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, refresh }} catalogApi={catalogApi} />);

    await screen.findByRole("region", { name: "Live comparison workspace" });
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not render a transient source error row after a failed provider read", async () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={accountApi}
      catalogApi={{ read: async () => { throw new Error("provider failed"); } }} />);

    await screen.findByText("No exact two-book comparison is currently available");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("never loads a legacy account without a category into the fixed LoL screen", async () => {
    const legacyFootball: AccountStatus = { ...account, id: "legacy-saba", alias: "SABA Football live current",
      provider: "SABA", category: null };
    const lolAccount: AccountStatus = { ...account, id: "im-lol", alias: "IM LoL live", provider: "IM", category: "LOL" };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => ({ ...catalog, accountId: id,
      provider: "IM", category: "LOL", events: [], markets: [], quotes: [] }));

    render(<LiveCatalogPage fixedCategory="LOL"
      accountApi={{ ...accountApi, list: async () => [legacyFootball, lolAccount] }} catalogApi={{ read }} />);

    expect(await screen.findByText("IM LoL live")).toBeTruthy();
    expect(screen.queryByText("SABA Football live current")).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(lolAccount.id);
  });

  it("loads only one account per provider so duplicate SABA bindings cannot duplicate matches", async () => {
    const older: AccountStatus = { ...account, id: "a-saba", alias: "SABA old", provider: "SABA" };
    const current: AccountStatus = { ...account, id: "z-saba", alias: "SABA current", provider: "SABA" };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => ({ ...catalog, accountId: id,
      provider: "SABA", events: [{ ...event, provider: "SABA" }],
      markets: [{ ...market, provider: "SABA" }], quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) }));

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [older, current] }} catalogApi={{ read }} />);

    expect(await screen.findByText("SABA current")).toBeTruthy();
    expect(screen.queryByText("SABA old")).toBeNull();
    expect(screen.queryByRole("button", { name: "Observe Alpha vs Beta" })).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(current.id);
  });

  it("falls back to another active account for the same provider when the preferred binding cannot read", async () => {
    const fallback: AccountStatus = { ...account, id: "a-saba-working", alias: "SABA working", provider: "SABA" };
    const preferred: AccountStatus = { ...account, id: "z-saba-broken", alias: "SABA broken", provider: "SABA" };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => {
      if (id === preferred.id) throw new Error("stale provider page");
      return { ...catalog, accountId: id, provider: "SABA",
        events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
        quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) };
    });

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [fallback, preferred] }} catalogApi={{ read }} />);

    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(read).toHaveBeenNthCalledWith(1, preferred.id);
    expect(read).toHaveBeenNthCalledWith(2, fallback.id);
    expect(screen.queryByRole("button", { name: "Observe Alpha vs Beta" })).toBeNull();
  });

  it("prefers a reachable active binding over a newer unreachable duplicate", async () => {
    const reachable: AccountStatus = { ...account, id: "a-reachable", alias: "SABA reachable", provider: "SABA",
      profileState: "UNAVAILABLE", currency: null, balance: null, balanceAsOfMs: null, reason: "SCHEMA_CHANGED" };
    const unreachable: AccountStatus = { ...reachable, id: "z-unreachable", alias: "SABA unreachable", reason: "UNREACHABLE" };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => ({ ...catalog, accountId: id,
      provider: "SABA", events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) }));

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [reachable, unreachable] }} catalogApi={{ read }} />);

    expect(await screen.findByText("SABA reachable")).toBeTruthy();
    expect(screen.queryByText("SABA unreachable")).toBeNull();
    expect(read).toHaveBeenCalledWith(reachable.id);
  });

  it("prefers the account launched by the live Fabet lobby over stale direct SABA bindings", async () => {
    const fabet: AccountStatus = { ...account, id: "a-fabet", alias: "SABA Fabet lobby", provider: "SABA",
      sessionSource: "FABET_LOGIN", profileState: "UNAVAILABLE", currency: null, balance: null, balanceAsOfMs: null,
      reason: "UNREACHABLE" };
    const direct: AccountStatus = { ...account, id: "z-direct", alias: "SABA direct", provider: "SABA",
      sessionSource: "MANUAL_PROVIDER_SESSION" };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => ({ ...catalog, accountId: id,
      provider: "SABA", events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) }));

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [fabet, direct] }} catalogApi={{ read }} />);

    expect(await screen.findByText("SABA Fabet lobby")).toBeTruthy();
    expect(read).toHaveBeenCalledWith(fabet.id);
  });

  it("shows provider discovery as loading instead of falsely saying every source is disconnected", () => {
    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi,
      list: async () => new Promise<readonly AccountStatus[]>(() => undefined) }} catalogApi={catalogApi} />);

    expect(screen.getByLabelText("SABA loading")).toBeTruthy();
    expect(screen.queryByLabelText("SABA unavailable")).toBeNull();
  });

  it("refreshes a source that attaches after the page has already loaded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const inactive: CatalogSourceStatus = { id: "catalog-source:SABA:FOOTBALL", alias: "SABA", provider: "SABA",
      category: "FOOTBALL", sessionState: "ACTION_REQUIRED", sessionSource: "FABET_LOGIN", acquiredAtMs: null,
      reason: "EXPIRED" };
    const active: CatalogSourceStatus = { ...inactive, sessionState: "ACTIVE", acquiredAtMs: 200, reason: null };
    const list = vi.fn<CatalogSourceApiLike["list"]>().mockResolvedValueOnce([inactive]).mockResolvedValue([active]);

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list: async () => [] }}
      catalogSourceApi={{ list }} catalogApi={catalogApi} />);

    expect(await screen.findByLabelText("SABA nguồn hết hạn")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByTestId("provider-brand-SABA")).toBeTruthy();
    expect(screen.queryByLabelText("SABA nguồn hết hạn")).toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("retries account discovery after the API is temporarily unavailable during page load", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const list = vi.fn<AccountApiLike["list"]>()
      .mockRejectedValueOnce(new Error("api starting"))
      .mockResolvedValue([account]);

    render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ ...accountApi, list }} catalogApi={catalogApi} />);
    expect(screen.queryByRole("status")).toBeNull();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByText("CMD main")).toBeTruthy();
    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("prefers a betting-profile-ready account over a lexically newer catalog-only duplicate", async () => {
    const ready: AccountStatus = { ...account, id: "a-ready", alias: "SABA profile ready", provider: "SABA",
      currency: "VND", balance: "500000", balanceAsOfMs: Date.now() };
    const catalogOnly: AccountStatus = { ...account, id: "z-catalog", alias: "SABA catalog only", provider: "SABA",
      profileState: "UNAVAILABLE", currency: null, balance: null, balanceAsOfMs: null };
    const read = vi.fn(async (id: string): Promise<LiveCatalogResponse> => ({ ...catalog, accountId: id,
      provider: "SABA", events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" })) }));

    render(<LiveCatalogPage fixedCategory="FOOTBALL"
      accountApi={{ ...accountApi, list: async () => [ready, catalogOnly] }} catalogApi={{ read }} />);

    expect(await screen.findByText("SABA profile ready")).toBeTruthy();
    expect(screen.queryByText("SABA catalog only")).toBeNull();
    expect(read).toHaveBeenCalledWith(ready.id);
  });

  it("shows a healthy provider immediately while another selected provider is still pending", async () => {
    const sabaAccount: AccountStatus = { ...account, id: "saba-fast", alias: "SABA fast", provider: "SABA" };
    const imAccount: AccountStatus = { ...account, id: "im-pending", alias: "IM pending", provider: "IM" };
    const sabaCatalog: LiveCatalogResponse = {
      ...catalog, accountId: sabaAccount.id, provider: "SABA",
      events: [{ ...event, provider: "SABA" }], markets: [{ ...market, provider: "SABA" }],
      quotes: quotes.map((quote) => ({ ...quote, provider: "SABA" }))
    };
    const never = new Promise<LiveCatalogResponse>(() => undefined);
    render(<LiveCatalogPage accountApi={{ ...accountApi, list: async () => [sabaAccount, imAccount] }}
      catalogApi={{ read: async (id) => id === sabaAccount.id ? sabaCatalog : never }} />);

    expect(await screen.findByText("No exact two-book comparison is currently available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Observe Alpha vs Beta" })).toBeNull();
    expect((screen.getByLabelText("Load live catalog") as HTMLButtonElement).disabled).toBe(true);
  });
});
