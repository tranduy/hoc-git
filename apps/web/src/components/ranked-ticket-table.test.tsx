import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote,
  TicketRealtimeCheckRequest, TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import type { FixedBaseStakePlan } from "../watch/fixed-base-stake.js";
import type { RankedTicket } from "../watch/ranked-tickets.js";
import type { ProviderTicketIdentity } from "../api/provider-ticket.js";
import { RankedTicketTable } from "./ranked-ticket-table.js";
import "../styles.css";

afterEach(cleanup);

const event: ProviderEvent = { provider: "SABA", category: "LOL", providerEventId: "event-a", competition: "LCK",
  seasonStage: null, startAtUtcMs: 10_000, participantA: "Nongshim Academy", participantB: "Dplus Challengers",
  eventScope: "SERIES", bestOf: 3, isLive: true, rematchCandidate: false, fixtureDiscriminator: null,
  gameVariant: "LOL", liveState: null };

function cell(provider: ProviderId, odds: readonly [string, string]): ComparisonCell {
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
  const stakePolicy = { currency: "VND", baseStake: "100000", minStake: "30000",
    maxStake: "1000000", stakeStep: "1000", balance: "1000000" } as const;

  it("renders providers and stake legs in the canonical order even when inputs arrive reversed", () => {
    const reversed = ticket(1);
    const reversedTicket = { ...reversed, plan: { ...reversed.plan!, legs: [...reversed.plan!.legs].reverse() } };
    render(<RankedTicketTable event={event} providers={["IM", "SABA"]} tickets={[reversedTicket]} />);

    const headers = screen.getAllByRole("columnheader").map((header) => header.getAttribute("aria-label"))
      .filter((label): label is string => label !== null);
    expect(headers.slice(0, 2)).toEqual(["SABA", "IM"]);
    const stakes = screen.getAllByRole("spinbutton").map((input) => input.getAttribute("aria-label"));
    expect(stakes).toEqual(["Stake SABA Nongshim Academy", "Stake IM Dplus Challengers"]);
  });

  it("shows complementary Asian handicap signs separately from negative Malay prices", () => {
    const footballEvent: ProviderEvent = { provider: "CMD", category: "FOOTBALL", providerEventId: "city-arsenal",
      competition: "Premier League", seasonStage: null, startAtUtcMs: 10_000,
      participantA: "Manchester City", participantB: "Arsenal", eventScope: "REGULATION", bestOf: null,
      isLive: true, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
      sportVariant: "FOOTBALL", liveState: null };
    const footballCell = (provider: "CMD" | "IM"): ComparisonCell => {
      const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-market`, marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
        settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
      return { provider, market, quotes: (["HOME", "AWAY"] as const).map((selection) => ({ provider,
        category: "FOOTBALL", providerEventId: market.providerEventId, providerMarketId: market.providerMarketId,
        providerSelectionId: `${provider}-${selection}`, marketType: "FT_AH", scope: "FULL_TIME", selection,
        line: "-0.5", rawOdds: "-0.65", rawFormat: "MALAY", status: "OPEN", isLive: true,
        sourceTimestampMs: 10_000, receivedMonotonicMs: 1, sequence: 1 })) };
    };
    const row: ComparisonRow = { key: "FT_AH|FULL_TIME|-0.5", marketType: "FT_AH", scope: "FULL_TIME",
      line: "-0.5", cells: [footballCell("CMD"), footballCell("IM")], bestBySelection: {}, margin: 0.2,
      crossBook: true };
    const plan: FixedBaseStakePlan = { fingerprint: "city-arsenal-plan", currency: "VND", totalStake: "165000",
      worstCaseProfit: "35000", roi: "0.212121", profitsBySelection: { HOME: "35000", AWAY: "35000" }, legs: [
        { provider: "CMD", selection: "HOME", decimalOdds: "2.53846", stake: "100000", payout: "253846",
          profit: "88846", role: "BASE", feeType: "NONE", feeRate: null },
        { provider: "IM", selection: "AWAY", decimalOdds: "2.53846", stake: "65000", payout: "165000",
          profit: "0", role: "HEDGE", feeType: "NONE", feeRate: null }
      ] };
    const handicapTicket: RankedTicket = { key: row.key, eventKey: "city-arsenal", row, plan,
      state: "OBSERVATION", reason: null, movementMagnitude: "0", gapsBySelection: {} };

    render(<RankedTicketTable compact event={footballEvent} providers={["CMD", "IM"]}
      tickets={[handicapTicket]} />);

    const ticketRow = screen.getByLabelText("Ticket FT_AH|FULL_TIME|-0.5");
    expect(within(ticketRow).getByText("Manchester City · AH -0.5")).toBeTruthy();
    expect(within(ticketRow).getByText("Arsenal · AH +0.5")).toBeTruthy();
    expect(within(ticketRow).getAllByText("-0.65 MALAY")).toHaveLength(2);
  });

  it("copies the two team names instead of the total selections", () => {
    const base = ticket(1);
    const totalCells = base.row.cells.map((sourceCell) => ({ ...sourceCell,
      market: { ...sourceCell.market, category: "FOOTBALL" as const, marketType: "FT_TOTAL" as const,
        scope: "FULL_TIME" as const, line: "2.5",
        settlementProfile: "football-regulation-including-added-time" },
      quotes: sourceCell.quotes.map((sourceQuote, index) => ({ ...sourceQuote,
        category: "FOOTBALL" as const, marketType: "FT_TOTAL" as const, scope: "FULL_TIME" as const, line: "2.5",
        selection: index === 0 ? "OVER" : "UNDER",
        providerSelectionId: `${sourceQuote.provider}-${index === 0 ? "OVER" : "UNDER"}` })) }));
    const total = { ...base, key: "total-1", row: { ...base.row, key: "total-1", marketType: "FT_TOTAL" as const,
      scope: "FULL_TIME" as const, line: "2.5", cells: totalCells,
      bestBySelection: { OVER: "SABA" as const, UNDER: "IM" as const } }, plan: { ...base.plan!,
      profitsBySelection: { OVER: "20000", UNDER: "32000" }, legs: base.plan!.legs.map((leg, index) => ({ ...leg,
        selection: index === 0 ? "OVER" : "UNDER" })) } };
    const footballEvent: ProviderEvent = { provider: "SABA", category: "FOOTBALL", providerEventId: "event-a",
      competition: "League", seasonStage: null, startAtUtcMs: 10_000, participantA: "Alpha", participantB: "Beta",
      eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
      isVirtual: false, sportVariant: "FOOTBALL", liveState: null };

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<RankedTicketTable compact event={footballEvent} providers={["SABA", "IM"]} tickets={[total]} />);

    expect(screen.getByText("T\u00e0i/X\u1ec9u to\u00e0n tr\u1eadn")).toBeTruthy();
    const first = screen.getByRole("button", { name: "Copy Alpha" });
    const second = screen.getByRole("button", { name: "Copy Beta" });
    expect(screen.queryByRole("button", { name: "Copy T\u00e0i" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy X\u1ec9u" })).toBeNull();
    fireEvent.click(first);
    fireEvent.click(second);
    expect(writeText).toHaveBeenNthCalledWith(1, "Alpha");
    expect(writeText).toHaveBeenNthCalledWith(2, "Beta");
  });

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
    expect(screen.getAllByRole("spinbutton", { name: /Stake SABA Nongshim Academy/u })).toHaveLength(5);
    expect(screen.queryByText(/series-6/u)).toBeNull();
  });

  it("uses green styling only for a verified ticket at the profit threshold", () => {
    render(<RankedTicketTable event={event} providers={["SABA", "IM"]}
      tickets={[ticket(1, "VERIFIED_PROFIT"), ticket(2)]} />);

    expect(screen.getByLabelText("Ticket series-1").className).toContain("ranked-ticket-row--profitable");
    expect(screen.getByLabelText("Ticket series-2").className).toContain("ranked-ticket-row--neutral");
    expect(screen.getByText("Chưa kiểm tra lại vé trực tiếp tại sàn")).toBeTruthy();
  });

  it("labels every data cell so the selected-match panel can stack without horizontal scrolling", () => {
    render(<RankedTicketTable event={event} providers={["SABA", "IM"]} tickets={[ticket(1)]} />);

    const row = screen.getByLabelText("Ticket series-1");
    expect([...row.querySelectorAll("td")].map((cell) => cell.getAttribute("data-label"))).toEqual([
      "#SABA prices", "#IM prices", "Selected opposing legs", "Stakes", "Outcome profit", "Guaranteed / ROI"
    ]);
  });

  it("limits calculated odds and gaps to five fractional digits", () => {
    const repeating = ticket(1);
    const longPlan = { ...repeating.plan!, legs: repeating.plan!.legs.map((leg, index) => ({ ...leg,
      decimalOdds: index === 0 ? "2.388888888888888888" : "1.123456789" })) };
    const longTicket = { ...repeating, plan: longPlan, gapsBySelection: {
      TEAM_A: { absolute: "0.037573573573573573", percent: "22.222222222222222222" },
      TEAM_B: { absolute: "0.099999999999999999", percent: "47.058823529411764706" }
    } };

    render(<RankedTicketTable event={event} providers={["SABA", "IM"]} tickets={[longTicket]} />);

    expect(screen.getByText("@ 2.38889")).toBeTruthy();
    expect(screen.getByText("@ 1.12346")).toBeTruthy();
    expect(screen.getByText(/Gap 0\.03757/u)).toBeTruthy();
    expect(document.body.textContent).not.toContain("2.388888888");
    expect(document.body.textContent).not.toContain("0.037573573");
  });

  it("renders a stable compact detail layout", () => {
    const { container } = render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]}
      tickets={[ticket(1)]} />);

    expect(container.querySelector(".ranked-ticket-table-wrap--compact")).toBeTruthy();
    const row = screen.getByLabelText("Ticket series-1");
    expect(row.className).toContain("ranked-ticket-row--compact");
    expect(row.querySelectorAll(".ranked-ticket-provider-heading")).toHaveLength(2);
    expect(row.querySelector('[data-testid="provider-brand-SABA"]')).toBeTruthy();
    expect(row.querySelector('[data-testid="provider-brand-IM"]')).toBeTruthy();
  });

  it("shows only the selected opposing price for each provider in compact detail", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} tickets={[ticket(1)]} />);

    const saba = screen.getByLabelText("Ticket series-1").querySelector<HTMLElement>('[data-label="#SABA prices"]')!;
    const im = screen.getByLabelText("Ticket series-1").querySelector<HTMLElement>('[data-label="#IM prices"]')!;
    expect(within(saba).getByText("Nongshim Academy")).toBeTruthy();
    expect(within(saba).queryByText("Dplus Challengers")).toBeNull();
    expect(within(im).getByText("Dplus Challengers")).toBeTruthy();
    expect(within(im).queryByText("Nongshim Academy")).toBeNull();
  });

  it("puts an icon-only copy action inside each selected provider price", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} tickets={[ticket(1)]} />);

    const first = screen.getByRole("button", { name: "Copy Nongshim Academy" });
    const second = screen.getByRole("button", { name: "Copy Dplus Challengers" });
    expect(first.closest(".ranked-ticket-price")).toBeTruthy();
    expect(second.closest(".ranked-ticket-price")).toBeTruthy();
    expect(first.getAttribute("title")).toBe("Copy Nongshim Academy");
    expect(second.getAttribute("title")).toBe("Copy Dplus Challengers");
    expect(first.textContent).not.toMatch(/Copy/u);
    expect(second.textContent).not.toMatch(/Copy/u);

    fireEvent.click(first);
    fireEvent.click(second);

    expect(writeText).toHaveBeenNthCalledWith(1, "Nongshim Academy");
    expect(writeText).toHaveBeenNthCalledWith(2, "Dplus Challengers");
  });

  it("shows the calculated ROI beside every renderable ticket identity", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} tickets={[ticket(1)]} />);

    const row = screen.getByLabelText("Ticket series-1");
    expect(row.querySelector(".ranked-ticket-roi")?.textContent).toBe("ROI -0.50%");
  });

  it("does not force the detail scrollbar back to the highlighted ticket on realtime price updates", () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      const view = render(<RankedTicketTable compact event={event} highlightTicketKey="series-1"
        providers={["SABA", "IM"]} tickets={[ticket(1)]} />);
      expect(scrollIntoView).toHaveBeenCalledOnce();

      view.rerender(<RankedTicketTable compact event={event} highlightTicketKey="series-1"
        providers={["SABA", "IM"]} tickets={[{ ...ticket(1), movementMagnitude: "0.5" }]} />);

      expect(scrollIntoView).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView",
        { configurable: true, value: originalScrollIntoView });
    }
  });

  it("omits tickets that have no exact opposing two-provider plan", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]}
      tickets={[{ ...ticket(1), plan: null, reason: "No opposing pair" }]} />);

    expect(screen.queryByLabelText("Ticket series-1")).toBeNull();
    expect(screen.queryByRole("table", { name: /Top exact tickets/u })).toBeNull();
  });

  it("anchors either ticket stake and recalculates the opposite stake, outcome profit and ROI", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} stakePolicy={stakePolicy}
      tickets={[ticket(1)]} />);

    const sabaStake = screen.getByRole("spinbutton", { name: "Stake SABA Nongshim Academy" });
    const imStake = screen.getByRole("spinbutton", { name: "Stake IM Dplus Challengers" });
    fireEvent.change(sabaStake, { target: { value: "120000" } });

    expect((sabaStake as HTMLInputElement).value).toBe("120000");
    expect((imStake as HTMLInputElement).value).toBe("106000");
    expect(screen.getByText("Total 226,000 VND")).toBeTruthy();
    expect(screen.getByText("Guaranteed 38,000 VND")).toBeTruthy();
    expect(screen.getAllByText("ROI 16.81%")).toHaveLength(2);

    fireEvent.change(imStake, { target: { value: "50000" } });
    expect((imStake as HTMLInputElement).value).toBe("50000");
    expect((sabaStake as HTMLInputElement).value).toBe("57000");
    expect(screen.getByText("Total 107,000 VND")).toBeTruthy();
    expect(screen.getByText("Guaranteed 18,000 VND")).toBeTruthy();
  });

  it("places the common provider badge directly before every stake input", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} stakePolicy={stakePolicy}
      tickets={[ticket(1)]} />);

    for (const provider of ["SABA", "IM"] as const) {
      const input = screen.getByRole("spinbutton", { name: new RegExp(`Stake ${provider}`, "u") });
      const control = input.closest(".ranked-ticket-stake-control");
      const providerSlot = control?.querySelector(".ranked-ticket-stake-provider");
      expect(control).toBeTruthy();
      expect(providerSlot?.querySelector(`[data-testid="provider-brand-${provider}"]`)).toBeTruthy();
      expect(providerSlot?.nextElementSibling).toBe(input);
      expect(getComputedStyle(providerSlot!).width).toBe("112px");
    }
  });

  it("uses the configured whole-VND step for both editable stake legs", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]}
      stakePolicy={{ ...stakePolicy, stakeStep: "1" }} tickets={[ticket(1)]} />);

    expect(screen.getByRole("spinbutton", { name: "Stake SABA Nongshim Academy" })).toHaveProperty("step", "1");
    expect(screen.getByRole("spinbutton", { name: "Stake IM Dplus Challengers" })).toHaveProperty("step", "1");
  });

  it("fails closed when a ticket stake is outside the configured step", () => {
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} stakePolicy={stakePolicy}
      tickets={[ticket(1)]} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: "Stake SABA Nongshim Academy" }),
      { target: { value: "99999" } });

    expect(screen.getByText("Không thể cân với số tiền này")).toBeTruthy();
    expect(screen.getByText("Cannot calculate")).toBeTruthy();
  });

  it("puts one provider action for each opposing leg at the top of the ticket", () => {
    const base = ticket(1);
    const cmdCell = cell("CMD", ["1.8", "2.5"]);
    const cmdTicket = { ...base, row: { ...base.row, cells: [base.row.cells[0]!, cmdCell] }, plan: { ...base.plan!,
      legs: [base.plan!.legs[0]!, { ...base.plan!.legs[1]!, provider: "CMD" as const }] } };
    const opened: ProviderTicketIdentity[] = [];

    render(<RankedTicketTable compact event={event} providers={["SABA", "CMD"]} tickets={[cmdTicket]}
      onOpenProviderTicket={(identity) => opened.push(identity)} />);
    screen.getByRole("button", { name: "Mở kèo SABA tại sàn" }).click();
    screen.getByRole("button", { name: "Mở kèo CMD tại sàn" }).click();

    expect(opened).toEqual([
      { provider: "SABA", providerEventId: "SABA-event", providerMarketId: "SABA-market",
        providerSelectionId: "SABA-TEAM_A" },
      { provider: "CMD", providerEventId: "CMD-event", providerMarketId: "CMD-market",
        providerSelectionId: "CMD-TEAM_B" }
    ]);
  });

  it("captures displayed odds first, then shows adjacent direct-provider evidence on manual check", async () => {
    const calls: TicketRealtimeCheckRequest[] = [];
    let resolveCheck: ((value: TicketRealtimeCheckResponse) => void) | undefined;
    const check = (request: TicketRealtimeCheckRequest): Promise<TicketRealtimeCheckResponse> => {
      calls.push(request);
      return new Promise((resolve) => { resolveCheck = resolve; });
    };
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} tickets={[ticket(1)]}
      providerCatalogEvidence={{ SABA: { accountId: "saba-account", observedAtMs: 9_900 },
        IM: { accountId: "im-account", observedAtMs: 9_910 } }} realtimeCheckApi={{ check }} />);

    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra giá thật" }));

    const audit = screen.getByLabelText("Kiểm tra giá thật series-1");
    expect(within(within(audit).getByLabelText("Giá tool SABA")).getByText("2.2 DECIMAL")).toBeTruthy();
    expect(within(within(audit).getByLabelText("Giá tool IM")).getByText("2.5 DECIMAL")).toBeTruthy();
    expect(within(audit).getAllByText("Đang đọc trực tiếp…")).toHaveLength(2);
    expect(calls[0]).toMatchObject({ eventLabel: "Nongshim Academy vs Dplus Challengers",
      participantA: "Nongshim Academy", participantB: "Dplus Challengers",
      marketType: "SERIES_WINNER", scope: "SERIES", legs: [
        { provider: "SABA", accountId: "saba-account", providerSelectionId: "SABA-TEAM_A", rawOdds: "2.2" },
        { provider: "IM", accountId: "im-account", providerSelectionId: "IM-TEAM_B", rawOdds: "2.5" }
      ] });

    const captured = calls[0]!;
    resolveCheck?.({ checkId: "check-1", eventLabel: captured.eventLabel, marketType: captured.marketType,
      participantA: captured.participantA, participantB: captured.participantB,
      scope: captured.scope, capturedAtMs: captured.capturedAtMs, completedAtMs: captured.capturedAtMs + 25,
      persisted: true, legs: captured.legs.map((leg, index) => ({ status: index === 0 ? "MATCH" : "ODDS_CHANGED",
        verificationStatus: index === 0 ? "MATCH" : "MISMATCH",
        directMethod: index === 0 ? "DOM" : "IN_PAGE_FETCH",
        displayed: leg, direct: { accountId: leg.accountId, provider: leg.provider,
          providerEventId: leg.providerEventId, providerMarketId: leg.providerMarketId,
          providerSelectionId: leg.providerSelectionId, selection: leg.selection, line: leg.line,
          rawOdds: index === 0 ? leg.rawOdds : "2.2", rawFormat: leg.rawFormat,
          decimalOdds: index === 0 ? leg.decimalOdds : "2.2", quoteStatus: "OPEN",
          providerObservedAtMs: captured.capturedAtMs + 10, receivedMonotonicMs: 3, sequence: 2,
          limitEvidence: null, constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE"] },
        error: null, startedAtMs: captured.capturedAtMs + 1, completedAtMs: captured.capturedAtMs + 20,
        elapsedMs: 19 })) as unknown as TicketRealtimeCheckResponse["legs"] });

    const sabaBookmaker = await within(audit).findByLabelText("Giá sàn SABA");
    expect(within(sabaBookmaker).getByText("2.2 DECIMAL")).toBeTruthy();
    expect(within(within(audit).getByLabelText("Giá sàn IM")).getByText("2.2 DECIMAL")).toBeTruthy();
    expect(within(audit).getByText("MATCH")).toBeTruthy();
    expect(within(audit).getByText("MISMATCH")).toBeTruthy();
    expect(within(audit).getByText(/DOM/u)).toBeTruthy();
    expect(within(audit).getByText(/IN_PAGE_FETCH/u)).toBeTruthy();
    const sabaComparison = within(audit).getByLabelText("So sánh giá SABA");
    expect(within(within(sabaComparison).getByLabelText("Giá tool SABA")).getByText("2.2 DECIMAL")).toBeTruthy();
    expect(within(within(sabaComparison).getByLabelText("Giá sàn SABA")).getByText("2.2 DECIMAL")).toBeTruthy();
    expect(within(audit).getByText(/Đã ghi JSONL/u)).toBeTruthy();
  });
});
