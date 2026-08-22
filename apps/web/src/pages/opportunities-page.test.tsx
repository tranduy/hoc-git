import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpportunityCard } from "../components/opportunity-card.js";
import { OpportunitiesPage } from "./opportunities-page.js";

const snapshot: AppSnapshot = {
  revision: 8,
  generatedAtMs: 1_800_000_000_000,
  providerStatuses: [],
  counts: { FOOTBALL: { events: 1, markets: 1 }, LOL: { events: 0, markets: 0 }, mappings: { VERIFIED: 1, REVIEW_REQUIRED: 0, REJECTED: 0 }, opportunities: 1 },
  events: [{ canonicalEventId: "event-1", category: "FOOTBALL", competition: "Premier League", seasonStage: null, startAtUtcMs: 1_800_000_100_000, participantA: "Northbridge", participantB: "Riverside", providerEventIds: ["saba-1", "im-1"], isLive: false, mappingStatus: "VERIFIED", mappingEvidence: [] }],
  markets: [{ canonicalMarketId: "market-1", canonicalEventId: "event-1", category: "FOOTBALL", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", settlementProfile: "football-v1", providerMarketIds: ["saba-market", "im-market"], mappingStatus: "VERIFIED", mappingEvidence: [] }],
  opportunities: [{
    opportunityId: "opportunity-1", canonicalEventId: "event-1", canonicalMarketId: "market-1", category: "FOOTBALL", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", settlementProfile: "football-v1",
    baseCurrency: "USD", totalStakeBase: "100.01000100010001", inverseSum: "0.990099009900990099", netMargin: "0.01", worstCaseProfit: "1.00", roi: "0.01", quoteAgeMs: 1_250, mappingEvidence: [], executionConfidence: "HIGH",
    legs: [
      { provider: "SABA", providerEventId: "saba-1", providerMarketId: "saba-market", providerSelectionId: "over", selection: "Over 2.5", rawOdds: "0.98", rawFormat: "HK", decimalOdds: "1.98", effectiveDecimal: "1.98", stake: "50.505050505050505", stakeCurrency: "USD", baseCurrency: "USD", stakeBase: "50.505050505050505", minStake: "10", maxStake: "500", payout: "100", feeType: "PROFIT", feeRate: "0.01", fxRate: "1", fxSpreadRate: "0", fxAsOfMs: 1_799_999_999_000, quoteAgeMs: 1_250, quoteStatus: "OPEN", sourceTimestampMs: 1_799_999_998_750, receivedMonotonicMs: 4, sequence: 9, eligible: true, ineligibleReasons: [] },
      { provider: "IM", providerEventId: "im-1", providerMarketId: "im-market", providerSelectionId: "under", selection: "Under 2.5", rawOdds: "1.02", rawFormat: "HK", decimalOdds: "2.02", effectiveDecimal: "2.02", stake: "49.504950495049505", stakeCurrency: "USD", baseCurrency: "USD", stakeBase: "49.504950495049505", minStake: "5", maxStake: "250", payout: "100", feeType: "PAYOUT", feeRate: "0.005", fxRate: "1", fxSpreadRate: "0", fxAsOfMs: 1_799_999_999_000, quoteAgeMs: 980, quoteStatus: "OPEN", sourceTimestampMs: 1_799_999_999_020, receivedMonotonicMs: 5, sequence: 10, eligible: true, ineligibleReasons: [] }
    ]
  }],
  blockedDiagnostics: [{ code: "NEGATIVE_MARGIN", category: "FOOTBALL", canonicalMarketId: "blocked-market", reason: "negative margin", mappingEvidence: [] }]
};

describe("OpportunitiesPage", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("renders each verified opportunity with exact leg, payout, constraint, and freshness evidence", () => {
    render(<OpportunitiesPage snapshot={snapshot} connectionState="LIVE" />);

    const card = screen.getByRole("article", { name: /Northbridge vs Riverside/i });
    expect(within(card).getByText("FOOTBALL")).toBeTruthy();
    expect(within(card).getByText("FT_TOTAL")).toBeTruthy();
    expect(within(card).getByText("Full time")).toBeTruthy();
    expect(within(card).getByText("Line 2.5")).toBeTruthy();
    expect(within(card).getByText("Settlement football-v1")).toBeTruthy();
    expect(within(card).getByText("READ ONLY")).toBeTruthy();
    expect(within(card).getByText("HIGH confidence")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: /SABA.*Over 2\.5/u })).toBeTruthy();
    expect(within(card).getByRole("heading", { name: /IM.*Under 2\.5/u })).toBeTruthy();
    expect(within(card).getByLabelText("Raw odds (HK): 0.98")).toBeTruthy();
    expect(within(card).getByLabelText("Raw odds (HK): 1.02")).toBeTruthy();
    expect(within(card).getByLabelText("Decimal odds: 1.98")).toBeTruthy();
    expect(within(card).getByLabelText("Decimal odds: 2.02")).toBeTruthy();
    expect(within(card).getByLabelText("Effective decimal odds: 1.98")).toBeTruthy();
    expect(within(card).getByLabelText("Effective decimal odds: 2.02")).toBeTruthy();
    expect(within(card).getAllByText("100.00")).toHaveLength(2);
    expect(within(card).getAllByLabelText("Outcome payout in USD: 100")).toHaveLength(2);
    expect(within(card).getByText("ROI 1.00%")).toBeTruthy();
    expect(within(card).getByText("Worst-case profit (USD)")).toBeTruthy();
    expect(within(card).getByLabelText("Worst-case profit in USD: 1.00")).toBeTruthy();
    expect(within(card).getByLabelText("ROI: 0.01")).toBeTruthy();
    expect(within(card).getByLabelText("Total stake in USD: 100.01000100010001")).toBeTruthy();
    expect(within(card).getByLabelText("SABA financial policy: PROFIT fee 0.01; USD to USD FX rate 1; spread 0; as of 1799999999000 ms")).toBeTruthy();
    expect(within(card).getByLabelText("IM financial policy: PAYOUT fee 0.005; USD to USD FX rate 1; spread 0; as of 1799999999000 ms")).toBeTruthy();
    expect(within(card).getByText("PROFIT 1.00% · USD→USD @ 1 · spread 0.00%")).toBeTruthy();
    expect(within(card).getByText("PAYOUT 0.50% · USD→USD @ 1 · spread 0.00%")).toBeTruthy();
    expect(within(card).getAllByTitle("1250 ms from the server snapshot")).toHaveLength(2);
    expect(within(card).getByTitle("980 ms from the server snapshot")).toBeTruthy();
    expect(within(card).getByLabelText("Source timestamp: 1,799,999,998,750 ms")).toBeTruthy();
    expect(within(card).getByLabelText("Source timestamp: 1,799,999,999,020 ms")).toBeTruthy();
    expect(within(card).getByLabelText("Exact stake: 50.505050505050505")).toBeTruthy();
    expect(within(card).getByLabelText("Exact stake: 49.504950495049505")).toBeTruthy();
    expect(within(card).getByLabelText("Minimum stake: 10; maximum stake: 500")).toBeTruthy();
    expect(within(card).getByLabelText("Minimum stake: 5; maximum stake: 250")).toBeTruthy();
    expect(screen.queryByText("negative margin")).toBeNull();
    expect(screen.queryByText("NEGATIVE_MARGIN")).toBeNull();
  });

  it("runs preflight then a read-only two-leg dry check and shows both leg results", async () => {
    const calls: string[] = [];
    const accounts = [{ id: "saba-account", alias: "Saba", provider: "SABA", category: "FOOTBALL",
      sessionState: "ACTIVE", profileState: "FRESH", redactedLabel: "Saba", currency: "USD", balance: "500",
      balanceAsOfMs: 1_800_000_000_000, capabilities: ["CATALOG", "PROFILE", "PREFLIGHT"], reason: null },
    { id: "im-account", alias: "IM", provider: "IM", category: "FOOTBALL",
      sessionState: "ACTIVE", profileState: "FRESH", redactedLabel: "IM", currency: "USD", balance: "500",
      balanceAsOfMs: 1_800_000_000_000, capabilities: ["CATALOG", "PROFILE", "PREFLIGHT"], reason: null }] as const;
    const ticket = { ticketId: "ticket-1", opportunityId: "opportunity-1", canonicalEventId: "event-1",
      canonicalMarketId: "market-1", baseCurrency: "USD", totalStakeBase: "100", worstCaseProfit: "1",
      issuedAtMs: 1000, expiresAtMs: 3000, nonce: "nonce-value-123456", signature: "signature-value-123456",
      legs: [
        { accountId: "saba-account", provider: "SABA", providerEventId: "saba-1",
          providerMarketId: "saba-market", providerSelectionId: "over", selection: "Over 2.5", line: "2.5",
          decimalOdds: "1.98", stake: "50", currency: "USD", balance: "500", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
        { accountId: "im-account", provider: "IM", providerEventId: "im-1",
          providerMarketId: "im-market", providerSelectionId: "under", selection: "Under 2.5", line: "2.5",
          decimalOdds: "2.02", stake: "50", currency: "USD", balance: "500", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
      ]
    } as const;
    render(<OpportunitiesPage snapshot={snapshot} connectionState="LIVE"
      accountApi={{ list: async () => accounts, register: async () => { throw new Error("unused"); },
        refresh: async () => { throw new Error("unused"); } }}
      executionApi={{ preflight: async () => { calls.push("preflight"); return ticket; },
        dryRun: async () => { calls.push("dry-run"); return { ticketId: "ticket-1",
          idempotencyKey: "request-key-123456", mode: "DRY_RUN", status: "BOTH_ACCEPTED", legs: [
            { provider: "SABA", providerSelectionId: "over", status: "ACCEPTED", reason: null },
            { provider: "IM", providerSelectionId: "under", status: "ACCEPTED", reason: null }
          ] }; } }} />);

    fireEvent.click(screen.getByRole("button", { name: "Run two-leg dry check" }));
    expect(await screen.findByText("DRY RUN: BOTH_ACCEPTED")).toBeTruthy();
    expect(screen.getByText("SABA: ACCEPTED")).toBeTruthy();
    expect(screen.getByText("IM: ACCEPTED")).toBeTruthy();
    expect(calls).toEqual(["preflight", "dry-run"]);
  });

  it("marks all opportunities ineligible while disconnected without offering an execution action", () => {
    render(<OpportunitiesPage snapshot={snapshot} connectionState="DISCONNECTED" />);

    expect(screen.getByRole("alert").textContent).toContain("ineligible until fresh snapshots return");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps cached opportunities ineligible while a fresh snapshot handshake is connecting", () => {
    render(<OpportunitiesPage snapshot={snapshot} connectionState="CONNECTING" />);

    expect(screen.getByRole("alert").textContent).toContain("ineligible until a validated fresh snapshot returns");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("renders the received same-revision full payload only after the reconnect handshake is live", () => {
    const freshSameRevision = {
      ...snapshot,
      generatedAtMs: snapshot.generatedAtMs + 1_000,
      events: [{ ...snapshot.events[0]!, participantA: "Fresh Northbridge", participantB: "Fresh Riverside" }]
    };
    const { rerender } = render(<OpportunitiesPage snapshot={snapshot} connectionState="CONNECTING" />);

    expect(screen.queryByRole("article", { name: /Northbridge vs Riverside/i })).toBeNull();

    rerender(<OpportunitiesPage snapshot={freshSameRevision} connectionState="LIVE" />);
    expect(screen.getByRole("article", { name: /Fresh Northbridge vs Fresh Riverside/i })).toBeTruthy();
    expect(screen.queryByRole("article", { name: /^Northbridge vs Riverside$/i })).toBeNull();
  });

  it.each(["STALE", "QUOTE_STALE"])("uses a server %s diagnostic for the stale empty state", (code) => {
    render(<OpportunitiesPage snapshot={{ ...snapshot, opportunities: [], blockedDiagnostics: [{ code, category: "FOOTBALL", canonicalMarketId: "market-1", reason: "server quote expired", mappingEvidence: [] }] }} connectionState="LIVE" />);

    expect(screen.getByRole("heading", { name: "Stale market data" })).toBeTruthy();
    expect(screen.getByText(/Wait for a fresh server snapshot/i)).toBeTruthy();
  });

  it("fails closed for non-HIGH confidence", () => {
    render(<OpportunitiesPage snapshot={{ ...snapshot, opportunities: [{ ...snapshot.opportunities[0]!, executionConfidence: "BLOCKED" }] }} connectionState="LIVE" />);

    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("heading", { name: "No verified opportunities" })).toBeTruthy();
  });

  it("fails closed for a suspended leg", () => {
    const original = snapshot.opportunities[0]!;
    const suspended = { ...original.legs[0]!, quoteStatus: "SUSPENDED" as const, eligible: false, ineligibleReasons: ["SUSPENDED" as const] };
    render(<OpportunitiesPage snapshot={{ ...snapshot, opportunities: [{ ...original, legs: [suspended, original.legs[1]!] }] }} connectionState="LIVE" />);

    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("heading", { name: "No verified opportunities" })).toBeTruthy();
  });

  it("fails closed for a same-market or category-wide blocking diagnostic", () => {
    const sameMarket = { code: "NEGATIVE_MARGIN", category: "FOOTBALL" as const, canonicalMarketId: "market-1", reason: "margin invalid", mappingEvidence: [] };
    const categoryWide = { ...sameMarket, canonicalMarketId: null, reason: "feed guard" };
    const { rerender } = render(<OpportunitiesPage snapshot={{ ...snapshot, blockedDiagnostics: [sameMarket] }} connectionState="LIVE" />);

    expect(screen.queryByRole("article")).toBeNull();
    rerender(<OpportunitiesPage snapshot={{ ...snapshot, blockedDiagnostics: [categoryWide] }} connectionState="LIVE" />);
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("hides a stale affected card while retaining an unrelated verified card and a scoped warning", () => {
    const second = { ...snapshot.opportunities[0]!, opportunityId: "opportunity-2", canonicalEventId: "event-2", canonicalMarketId: "market-2", category: "LOL" as const };
    const event2 = { ...snapshot.events[0]!, canonicalEventId: "event-2", category: "LOL" as const, participantA: "Comets", participantB: "Phoenix" };
    render(<OpportunitiesPage snapshot={{ ...snapshot, events: [...snapshot.events, event2], opportunities: [snapshot.opportunities[0]!, second], blockedDiagnostics: [{ code: "STALE", category: "FOOTBALL", canonicalMarketId: "market-1", reason: "football quote expired", mappingEvidence: [] }] }} connectionState="LIVE" />);

    expect(screen.queryByRole("article", { name: /Northbridge vs Riverside/i })).toBeNull();
    expect(screen.getByRole("article", { name: /Comets vs Phoenix/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("football quote expired");
  });

  it("resets displayed quote age when a newer server revision arrives", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const { rerender } = render(<OpportunityCard opportunity={snapshot.opportunities[0]!} event={snapshot.events[0]} revision={8} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getAllByLabelText("Quote age: 2,250 ms")).toHaveLength(2);

    const fresh = { ...snapshot.opportunities[0]!, quoteAgeMs: 10, legs: snapshot.opportunities[0]!.legs.map((leg) => ({ ...leg, quoteAgeMs: 10 })) };
    rerender(<OpportunityCard opportunity={fresh} event={snapshot.events[0]} revision={9} />);
    expect(screen.getAllByLabelText("Quote age: 10 ms")).toHaveLength(3);
  });

  it("displays the supplied confidence value rather than a hardcoded label", () => {
    render(<OpportunityCard opportunity={{ ...snapshot.opportunities[0]!, executionConfidence: "BLOCKED" }} event={snapshot.events[0]} revision={8} />);

    expect(screen.getByText("BLOCKED confidence")).toBeTruthy();
    expect(screen.queryByText("HIGH confidence")).toBeNull();
  });
});
