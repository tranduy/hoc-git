import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resultCatalog } from "../catalog/result-opposition.fixture.js";
import { buildComparisonEvents } from "../catalog/comparison.js";
import { rankTicketsForEvent } from "../watch/ranked-tickets.js";
import { RankedTicketTable } from "./ranked-ticket-table.js";

afterEach(cleanup);
it("displays a selected DC source beside the native 1X2 and opens the correct market; mixed-type check stays unavailable", () => {
  const bti = resultCatalog("BTI", false, ["HOME"]), dc = resultCatalog("BTI", true, ["DRAW_AWAY"]);
  const merged = { ...bti, markets: [...bti.markets, ...dc.markets], quotes: [...bti.quotes, ...dc.quotes] };
  const event = buildComparisonEvents([merged, resultCatalog("CMD", false, ["HOME"])])[0]!;
  const policy = { currency: "VND", baseStake: "100000", minStake: "1", maxStake: "1000000",
    stakeStep: "1", balance: "1000000" };
  const tickets = rankTicketsForEvent({ event, selectedProviders: new Set(["BTI", "CMD"]),
    movements: [], verified: new Map(), observationPolicy: policy, nowMs: 1 });
  expect(tickets).toHaveLength(1);
  const onOpen = vi.fn(), check = vi.fn();
  render(<RankedTicketTable compact event={event.event} providers={["BTI", "CMD"]} tickets={tickets}
    onOpenProviderTicket={onOpen} realtimeCheckApi={{ check }}
    providerCatalogEvidence={{ BTI: { accountId: "bti", observedAtMs: 1 }, CMD: { accountId: "cmd", observedAtMs: 1 } }} />);
  expect(screen.getByText("1X2 cả trận ↔ Cơ hội kép")).toBeTruthy();
  expect(screen.getAllByText("Hòa hoặc Away Club").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Mở kèo BTI tại sàn" }));
  expect(onOpen).toHaveBeenCalledWith({ provider: "BTI", providerEventId: dc.events[0]!.providerEventId,
    providerMarketId: dc.markets[0]!.providerMarketId, providerSelectionId: dc.quotes[0]!.providerSelectionId });
  expect(screen.getByText("Chỉ ước tính; kiểm tra vé ghép 1X2/cơ hội kép chưa hỗ trợ")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Kiểm tra giá thật/u })).toBeNull();
  expect(check).not.toHaveBeenCalled();
});

it("opens and edits the selected higher-priced singleton, never the first same-book complete offer", () => {
  const source = resultCatalog("BTI", false, ["YES", "NO"]);
  const market = { ...source.markets[0]!, marketType: "FT_BTTS" as const,
    settlementProfile: "football-btts-regulation" };
  const completeQuotes = source.quotes.map(quote => ({ ...quote, marketType: market.marketType, rawOdds: "1.8" }));
  const partialMarket = { ...market, providerMarketId: "bti-best-singleton" };
  const partialQuote = { ...completeQuotes[0]!, providerMarketId: partialMarket.providerMarketId,
    providerSelectionId: "native-best-YES", rawOdds: "3" };
  const bti = { ...source, markets: [market, partialMarket], quotes: [...completeQuotes, partialQuote] };
  const cmdSource = resultCatalog("CMD", false, ["NO"]);
  const cmd = { ...cmdSource, markets: [{ ...cmdSource.markets[0]!, marketType: market.marketType,
    settlementProfile: market.settlementProfile }], quotes: cmdSource.quotes.map(quote => ({ ...quote, marketType: market.marketType })) };
  const event = buildComparisonEvents([bti, cmd])[0]!;
  const policy = { currency: "VND", baseStake: "100000", minStake: "1", maxStake: "1000000",
    stakeStep: "1", balance: "1000000" };
  const tickets = rankTicketsForEvent({ event, selectedProviders: new Set(["BTI", "CMD"]), movements: [],
    verified: new Map(), observationPolicy: policy, nowMs: 1 });
  expect(tickets[0]!.gapsBySelection.YES).toBeUndefined();
  const onOpen = vi.fn();
  render(<RankedTicketTable compact event={event.event} providers={["BTI", "CMD"]} tickets={tickets}
    stakePolicy={policy} onOpenProviderTicket={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Mở kèo BTI tại sàn" }));
  expect(onOpen).toHaveBeenCalledWith({ provider: "BTI", providerEventId: partialQuote.providerEventId,
    providerMarketId: partialMarket.providerMarketId, providerSelectionId: partialQuote.providerSelectionId });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Stake BTI Yes" }), { target: { value: "120000" } });
  expect(screen.getByDisplayValue("180000")).toBeTruthy();
  expect(screen.queryByText("1.8 DECIMAL")).toBeNull();
});
