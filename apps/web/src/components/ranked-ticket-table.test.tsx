import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote,
  TicketRealtimeCheckRequest, TicketRealtimeCheckResponse } from "@tool-chenh/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import type { FixedBaseStakePlan } from "../watch/fixed-base-stake.js";
import type { RankedTicket } from "../watch/ranked-tickets.js";
import type { ProviderTicketIdentity } from "../api/provider-ticket.js";
import type { TicketReportRequest } from "../api/ticket-report.js";
import { RankedTicketTable } from "./ranked-ticket-table.js";
import { capturedRefundExample } from "../watch/conditional-roi.test-fixtures.js";
import "../styles.css";

afterEach(cleanup);

it.each(["handicap", "total", "break-even"] as const)("explains captured %s conditional ROI in the ticket detail", kind => {
  const { row, plan } = capturedRefundExample(kind);
  const candidate: RankedTicket = { key: row.key, eventKey: "saved-event", row, plan, state: "OBSERVATION",
    reason: null, movementMagnitude: "0", gapsBySelection: {} };
  render(<RankedTicketTable event={{ ...event, category: "FOOTBALL", eventScope: "REGULATION", bestOf: null,
    isVirtual: false, sportVariant: "FOOTBALL", liveState: null }}
    providers={row.cells.map(c => c.provider)} tickets={[candidate]} />);
  expect(screen.getByText("Guaranteed 0 VND")).toBeTruthy();
  if (kind === "break-even") expect(screen.queryByText(/ROI khi không hoàn tiền/u)).toBeNull();
  else {
    expect(screen.getByText(`ROI khi không hoàn tiền: ${kind === "handicap" ? "1.24" : "0.28"}%`)).toBeTruthy();
    expect(screen.getByText("Hoàn đủ hai cược: lãi 0 VND")).toBeTruthy();
  }
  expect(screen.getAllByText("ROI 0.00%").every(node => node.classList.contains("roi-badge--neutral"))).toBe(true);
});

it("keeps a real tiny positive estimate visibly nonzero", () => {
  const base = ticket(1);
  render(<RankedTicketTable event={event} providers={["SABA", "IM"]} tickets={[{ ...base,
    plan: { ...base.plan!, worstCaseProfit: "0.000001", roi: "0.00000001" } }]} />);
  expect(screen.getByText("Guaranteed <0.01 VND")).toBeTruthy();
  expect(screen.getAllByText("ROI <0.01%").every(node => node.classList.contains("roi-badge--medium"))).toBe(true);
});

it("renders screenshot-scale negative ROI and profit with compact bounds", () => {
  const base = ticket(1);
  render(<RankedTicketTable event={event} providers={["SABA", "IM"]} tickets={[{ ...base,
    plan: { ...base.plan!, worstCaseProfit: "-2e-34", roi: "-2.17e-40" } }]} />);
  expect(screen.getByText("Guaranteed >-0.01 VND")).toBeTruthy();
  expect(screen.getAllByText("ROI >-0.01%")
    .every(node => node.classList.contains("roi-badge--negative"))).toBe(true);
});

it.each([["PUSH", "Hoàn tiền", "0"], ["SPLIT", "Chia tiền", "5000"]] as const)(
  "shows the %s outcome in addition to full-win profits", (kind, label, profit) => {
    const base = ticket(1);
    const candidate = { ...base, plan: { ...base.plan!, worstCaseProfit: profit,
      roi: kind === "PUSH" ? "0" : "0.025", settlementScenarios: [{ kind, profit }] } };
    render(<RankedTicketTable event={event} providers={["SABA", "IM"]} tickets={[candidate]} />);
    expect(screen.getByText(label)).toBeTruthy();
    if (kind === "PUSH") {
      expect(screen.getByText("Guaranteed 0 VND")).toBeTruthy();
      expect(screen.getAllByText("ROI 0.00%").every(node => node.classList.contains("roi-badge--neutral"))).toBe(true);
    }
  });

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

  function waitingFootballTicket(): RankedTicket {
    const cells: ComparisonCell[] = (["APSPORT", "BTI"] as const).map((provider, index) => {
      const selection = index === 0 ? "HOME" : "AWAY";
      const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: `${provider}-event`,
        providerMarketId: `${provider}-native-market`, marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
        settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
      const quote: ProviderQuote = { provider, category: "FOOTBALL", providerEventId: market.providerEventId,
        providerMarketId: market.providerMarketId, providerSelectionId: `${provider}-native-away`,
        marketType: "FT_AH", scope: "FULL_TIME", selection, line: "-0.5", rawOdds: index === 0 ? "2.1" : "1.95",
        rawFormat: "DECIMAL", status: "OPEN", isLive: false, sourceTimestampMs: 900, receivedMonotonicMs: 19 + index, sequence: 3 };
      return { provider, market, quotes: [quote], sourceMarket: { ...market, line: index === 0 ? "0.5" : "-0.5" },
        sourceQuotes: [{ ...quote, selection: "AWAY", line: index === 0 ? "0.5" : "-0.5" }],
        sourceEvent: { ...event, provider, providerEventId: market.providerEventId,
          participantA: index === 0 ? "Beta" : "Alpha", participantB: index === 0 ? "Alpha" : "Beta" } };
    });
    const auditRow: ComparisonRow = { key: "waiting-ap-bti", marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
      cells, bestBySelection: {}, margin: null, crossBook: true };
    return { key: auditRow.key, eventKey: "ap-bti-event", auditRow, plan: null, state: "OBSERVATION",
      hasOpposingSources: true, opposingProviderPairs: [["APSPORT", "BTI"]],
      row: { ...auditRow, cells: cells.map(cell => cell.provider === "APSPORT" ? { ...cell, quotes: [], sourceQuotes: [] } : cell) },
      reason: "APSPORT quote freshness not confirmed", movementMagnitude: "0", gapsBySelection: {} };
  }

  it("checks retained exact AP/BTI quote identities while waiting without reviving ROI or a betting plan", () => {
    const waiting = waitingFootballTicket();
    const check = vi.fn((_request: TicketRealtimeCheckRequest) => new Promise<TicketRealtimeCheckResponse>(() => undefined));
    const open = vi.fn();
    render(<RankedTicketTable event={{ ...event, participantA: "Alpha", participantB: "Beta" }}
      providers={["APSPORT", "BTI"]} tickets={[waiting]} compact stakePolicy={stakePolicy}
      onOpenProviderTicket={open} realtimeCheckApi={{ check }} providerCatalogEvidence={{
        APSPORT: { accountId: "ap-account", observedAtMs: 1_000 }, BTI: { accountId: "bti-account", observedAtMs: 1_010 } }} />);
    expect(screen.getByText(/Chỉ kiểm tra giá · 100,000 VND mỗi cửa/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra giá thật" }));
    expect(check).toHaveBeenCalledOnce();
    expect(check.mock.calls[0]![0].legs).toMatchObject([
      { provider: "APSPORT", providerEventId: "APSPORT-event", providerMarketId: "APSPORT-native-market",
        providerSelectionId: "APSPORT-native-away", selection: "HOME", line: "-0.5",
        providerSelection: "AWAY", providerLine: "0.5", providerParticipantA: "Beta", providerParticipantB: "Alpha",
        rawOdds: "2.1", providerObservedAtMs: 1_000, receivedMonotonicMs: 19, sequence: 3, requestedStake: "100000" },
      { provider: "BTI", providerEventId: "BTI-event", providerMarketId: "BTI-native-market",
        providerSelectionId: "BTI-native-away", selection: "AWAY", line: "-0.5",
        providerSelection: "AWAY", providerLine: "-0.5", rawOdds: "1.95", requestedStake: "100000" }
    ]);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: /Mở kèo/u })).toBeNull();
    expect(within(screen.getByRole("row", { name: `Ticket ${waiting.key}` })).queryByText(/ROI/u)).toBeNull();
    expect(waiting.plan).toBeNull();
    expect(waiting.row.cells[0]!.quotes).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["missing-audit", "not-opposing", "missing-policy", "missing-native-id", "invalid-stake"] as const)(
    "does not fabricate a waiting read-check when %s", invalid => {
      const original = waitingFootballTicket();
      const { auditRow: _auditRow, ...withoutAudit } = original;
      const waiting: RankedTicket = invalid === "missing-audit" ? withoutAudit :
        invalid === "not-opposing" ? { ...original, auditRow: { ...original.auditRow!,
          cells: original.auditRow!.cells.map(cell => ({ ...cell, quotes: cell.quotes.map(quote => ({ ...quote, selection: "HOME" })) })) } } :
        invalid === "missing-native-id" ? { ...original, auditRow: { ...original.auditRow!,
          cells: original.auditRow!.cells.map(cell => ({ ...cell, sourceQuotes: [] })) } } : original;
      render(<RankedTicketTable event={event} providers={["APSPORT", "BTI"]} tickets={[waiting]}
        {...(invalid === "missing-policy" ? {} : { stakePolicy: invalid === "invalid-stake" ? { ...stakePolicy, baseStake: "0" } : stakePolicy })}
        realtimeCheckApi={{ check: vi.fn() }}
        providerCatalogEvidence={{ APSPORT: { accountId: "ap-account", observedAtMs: 1_000 },
          BTI: { accountId: "bti-account", observedAtMs: 1_000 } }} />);
      expect(screen.queryByRole("button", { name: "Kiểm tra giá thật" })).toBeNull();
    });

  it("shows an exact waiting row without ROI, stake inputs or ticket actions and honors removed sides", () => {
    const original = ticket(1);
    const waiting: RankedTicket = { ...original, plan: null, hasOpposingSources: true,
      opposingProviderPairs: [["SABA", "IM"]], reason: "APSPORT quote freshness not confirmed",
      row: { ...original.row, cells: original.row.cells.map(cell => cell.provider === "IM" ? { ...cell, quotes: [] } : cell) } };
    const view = render(<RankedTicketTable event={event} providers={["SABA", "IM"]} tickets={[waiting]}
      compact onOpenProviderTicket={vi.fn()} realtimeCheckApi={{ check: vi.fn() }} />);
    expect(screen.getByRole("row", { name: `Ticket ${waiting.key}` })).toBeTruthy();
    expect(screen.getByText("Đã ghép kèo; chờ giá mới")).toBeTruthy();
    expect(screen.getByText("APSPORT: chờ xác nhận giá mới")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: `Ticket ${waiting.key}` })).queryByText(/ROI/u)).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: /Mở kèo|Kiểm tra giá thật/u })).toBeNull();

    view.rerender(<RankedTicketTable event={event} providers={["SABA", "BTI"]} tickets={[waiting]} compact />);
    expect(screen.queryByRole("row", { name: `Ticket ${waiting.key}` })).toBeNull();
  });

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

    expect(screen.getByText("Full-time total")).toBeTruthy();
    const first = screen.getByRole("button", { name: "Copy Alpha" });
    const second = screen.getByRole("button", { name: "Copy Beta" });
    expect(screen.queryByRole("button", { name: "Copy Over" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy Under" })).toBeNull();
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
    expect(within(audit).getByText(/Đã lưu kết quả/u)).toBeTruthy();
  });

  it("submits an operator reason with the complete ticket snapshot and shows it in report history", async () => {
    const created: unknown[] = [];
    const reportApi = {
      list: async () => ({ reports: [] }),
      create: async (request: TicketReportRequest) => {
        const entry = { reportId: "report-1", createdAtMs: 20_000, request };
        created.push(entry); return entry;
      }
    };
    render(<RankedTicketTable compact event={event} providers={["SABA", "IM"]} tickets={[ticket(1)]}
      providerCatalogEvidence={{ SABA: { accountId: "saba-account", observedAtMs: 9_900 },
        IM: { accountId: "im-account", observedAtMs: 9_910 } }} ticketReportApi={reportApi} />);

    fireEvent.click(screen.getByRole("button", { name: "Report vé series-1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nguyên nhân report series-1" }),
      { target: { value: "Giá trên sàn khác giá tool" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi report series-1" }));

    const history = await screen.findByRole("region", { name: "Lịch sử report" });
    expect(within(history).getByText("Giá trên sàn khác giá tool")).toBeTruthy();
    expect(created[0]).toMatchObject({ request: { eventKey: "event-key", ticketKey: "series-1",
      reason: "Giá trên sàn khác giá tool", competition: "LCK",
      display: { eventLabel: "Nongshim Academy vs Dplus Challengers", legs: [
        { provider: "SABA", providerSelectionId: "SABA-TEAM_A", rawOdds: "2.2", sequence: 1 },
        { provider: "IM", providerSelectionId: "IM-TEAM_B", rawOdds: "2.5", sequence: 1 }
      ] }, estimate: { roi: "-0.005", worstCaseProfit: "-1000", totalStake: "188000" },
      realtimeCheck: null } });
  });
});
