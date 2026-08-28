import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { ComparisonCell, ComparisonEvent, ComparisonRow, ObservedTicketRow } from "../catalog/comparison.js";
import type { FixedBaseStakePlan, FixedBaseStakePolicy } from "./fixed-base-stake.js";
import { eventEdgeSummary, rankTicketsForEvent, sortRankedEvents, topRankedTicketItems,
  type RankedEvent } from "./ranked-tickets.js";
import type { VerifiedTicketEvidence } from "./ticket-preflight-coordinator.js";

const nowMs = 10_000;
const policy: FixedBaseStakePolicy = { currency: "VND", baseStake: "100000", minStake: "30000",
  maxStake: "500000", stakeStep: "1000", balance: "500000" };
const providerEvent: ProviderEvent = { provider: "SABA", category: "FOOTBALL", providerEventId: "event-a",
  competition: "League", seasonStage: null, startAtUtcMs: 20_000, participantA: "Alpha", participantB: "Beta",
  eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
  isVirtual: false, sportVariant: "FOOTBALL", liveState: null };

function cell(provider: "SABA" | "SBOBET" | "APSPORT", line: string,
  options: { readonly isLive?: boolean; readonly receivedMonotonicMs?: number } = {}): ComparisonCell {
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: `${provider}-event`,
    providerMarketId: `${provider}-${line}`, marketType: "FT_AH", scope: "FULL_TIME", line,
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
  const quotes: ProviderQuote[] = (["HOME", "AWAY"] as const).map((selection) => ({ provider,
    category: "FOOTBALL", providerEventId: market.providerEventId, providerMarketId: market.providerMarketId,
    providerSelectionId: `${provider}-${line}-${selection}`, marketType: "FT_AH", scope: "FULL_TIME", selection,
    line, rawOdds: "2.5", rawFormat: "DECIMAL", status: "OPEN", isLive: options.isLive ?? false,
    sourceTimestampMs: nowMs, receivedMonotonicMs: options.receivedMonotonicMs ?? 1, sequence: 1 }));
  return { provider, market, quotes };
}

function row(index: number): ComparisonRow {
  const line = index % 2 === 0 ? `${index}.5` : `-${index}.5`;
  return { key: `row-${index}`, marketType: "FT_AH", scope: "FULL_TIME", line,
    cells: [cell("SABA", line), cell("SBOBET", line)], bestBySelection: { HOME: "SABA", AWAY: "SBOBET" },
    margin: 0.25, crossBook: true };
}

function plan(rowKey: string, profit: string, roi: string): FixedBaseStakePlan {
  return { fingerprint: `${rowKey}::SABA|HOME::SBOBET|AWAY`, currency: "VND",
    legs: [{ provider: "SABA", selection: "HOME", decimalOdds: "2.5", stake: "100000", payout: "250000",
      profit, role: "BASE", feeType: "NONE", feeRate: null },
    { provider: "SBOBET", selection: "AWAY", decimalOdds: "2.5", stake: "100000", payout: "250000",
      profit, role: "HEDGE", feeType: "NONE", feeRate: null }], totalStake: "200000",
    profitsBySelection: { HOME: profit, AWAY: profit }, worstCaseProfit: profit, roi };
}

function evidence(eventKey: string, rowKey: string, profit: string, roi: string,
  expiresAtMs = nowMs + 1_000): VerifiedTicketEvidence {
  return { key: `${eventKey}::${rowKey}`, eventKey, rowKey, plan: plan(rowKey, profit, roi),
    verifiedAtMs: nowMs, expiresAtMs };
}

function comparisonEvent(): ComparisonEvent {
  const rows = Array.from({ length: 7 }, (_, index) => row(index + 1));
  const observedOnly: ObservedTicketRow = { key: "observed-only", marketType: "FT_AH", scope: "FULL_TIME",
    line: "20.5", settlementProfile: "football-regulation-including-added-time",
    outcomeDomain: ["HOME", "AWAY"], cells: [cell("SABA", "20.5")] };
  return { key: "event-key", event: providerEvent, providers: ["SABA", "SBOBET"], catalogs: [],
    providerEventIds: { SABA: "event-a", SBOBET: "event-b" }, observedRows: [observedOnly], rows, bestMargin: 0.25 };
}

describe("rankTicketsForEvent", () => {
  it("globally ranks up to 25 real two-book tickets instead of collapsing them by event", () => {
    const event = comparisonEvent();
    const tickets = Array.from({ length: 27 }, (_, index) => {
      const rank = index + 1;
      return { key: `ticket-${rank}`, eventKey: event.key, row: row(rank),
        plan: plan(`ticket-${rank}`, String(rank * 1_000), String(rank / 100)),
        state: "OBSERVATION" as const, reason: "Provider preflight required", movementMagnitude: String(rank),
        gapsBySelection: {} };
    });
    const withoutPlan = { ...tickets[0]!, key: "without-plan", plan: null };
    const oneProvider = { ...tickets[1]!, key: "one-provider",
      plan: { ...tickets[1]!.plan!, legs: tickets[1]!.plan!.legs.map((leg) => ({ ...leg, provider: "SABA" as const })) } };

    const result = topRankedTicketItems([{ event, tickets: [...tickets, withoutPlan, oneProvider],
      bestVerifiedProfit: null }], 25);

    expect(result).toHaveLength(25);
    expect(result.map((item) => item.ticket.key)).toEqual(
      Array.from({ length: 25 }, (_, index) => `ticket-${27 - index}`));
    expect(new Set(result.map((item) => item.event.event.key))).toEqual(new Set([event.key]));
    expect(result.every((item) => new Set(item.ticket.plan?.legs.map((leg) => leg.provider)).size === 2)).toBe(true);
  });

  it("does not rank display-only observation events as opportunities by estimated ROI", () => {
    const earlierNegative = comparisonEvent();
    const laterPositive = { ...comparisonEvent(), key: "positive-event",
      event: { ...comparisonEvent().event, providerEventId: "positive", startAtUtcMs: 30_000 } };
    const ranked = sortRankedEvents([
      { event: earlierNegative, bestVerifiedProfit: null,
        tickets: [{ key: "negative", eventKey: earlierNegative.key, row: earlierNegative.rows[0]!,
          plan: plan("negative", "-28000", "-0.0284"), state: "OBSERVATION" as const,
          reason: "Provider preflight required", movementMagnitude: "0", gapsBySelection: {} }] },
      { event: laterPositive, bestVerifiedProfit: null,
        tickets: [{ key: "positive", eventKey: laterPositive.key, row: laterPositive.rows[0]!,
          plan: plan("positive", "220000", "0.2479"), state: "OBSERVATION" as const,
          reason: "Provider preflight required", movementMagnitude: "0", gapsBySelection: {} }] }
    ]);

    expect(ranked.map((item) => item.event.key)).toEqual(["event-key", "positive-event"]);
  });

  it("summarizes the best exact two-book plan using balanced worst-case ROI", () => {
    const event = comparisonEvent();
    const tickets = rankTicketsForEvent({ event, verified: new Map([
      ["event-key::row-1", evidence("event-key", "row-1", "20000", "0.1163")],
      ["event-key::row-2", evidence("event-key", "row-2", "50000", "0.2")]
    ]), movements: [], selectedProviders: new Set(["SABA", "SBOBET"]), observationPolicy: policy, nowMs });
    const summary = eventEdgeSummary({ event, tickets, bestVerifiedProfit: "50000" });

    expect(summary).toMatchObject({ ticketKey: "row-2", roiPercent: "20", worstCaseProfit: "50000",
      providers: ["SABA", "SBOBET"], marketType: "FT_AH", line: "2.5", state: "VERIFIED_PROFIT" });
    expect(summary?.odds).toEqual(["2.5", "2.5"]);
  });

  it("does not invent an edge summary from a one-provider plan or an empty event", () => {
    const event = comparisonEvent();
    const ticket = rankTicketsForEvent({ event, verified: new Map([
      ["event-key::row-1", evidence("event-key", "row-1", "20000", "0.1163")]
    ]), movements: [], selectedProviders: new Set(["SABA", "SBOBET"]), observationPolicy: policy, nowMs })[0]!;
    const oneProvider = { ...ticket, plan: { ...ticket.plan!, legs: ticket.plan!.legs.map((leg) => ({ ...leg, provider: "SABA" as const })) } };

    expect(eventEdgeSummary({ event, tickets: [oneProvider], bestVerifiedProfit: "20000" } as RankedEvent)).toBeNull();
    expect(eventEdgeSummary({ event, tickets: [], bestVerifiedProfit: null })).toBeNull();
  });

  it("uses exact rows only, sorts verified profit descending, and limits the event to five", () => {
    const event = comparisonEvent();
    const verified = new Map<string, VerifiedTicketEvidence>([
      ["event-key::row-1", evidence("event-key", "row-1", "25000", "0.08")],
      ["event-key::row-2", evidence("event-key", "row-2", "50000", "0.1")],
      ["event-key::row-3", evidence("event-key", "row-3", "30000", "0.09")],
      ["event-key::row-4", evidence("event-key", "row-4", "40000", "0.07")]
    ]);

    const ranked = rankTicketsForEvent({ event, verified, movements: [],
      selectedProviders: new Set(["SABA", "SBOBET"]), observationPolicy: policy, nowMs });

    expect(ranked).toHaveLength(5);
    expect(ranked.map((ticket) => ticket.row.key)).toEqual(["row-2", "row-4", "row-3", "row-1", "row-5"]);
    expect(ranked.some((ticket) => ticket.row.key === "observed-only")).toBe(false);
    expect(ranked.slice(0, 4).every((ticket) => ticket.state === "VERIFIED_PROFIT")).toBe(true);
    expect(ranked[4]?.state).toBe("OBSERVATION");
  });

  it("uses ROI then immediate movement then stable identity as deterministic tie breaks", () => {
    const event = comparisonEvent();
    const verified = new Map<string, VerifiedTicketEvidence>([
      ["event-key::row-1", evidence("event-key", "row-1", "30000", "0.1")],
      ["event-key::row-2", evidence("event-key", "row-2", "30000", "0.15")],
      ["event-key::row-3", evidence("event-key", "row-3", "30000", "0.1")]
    ]);
    const movements = [{ key: "move", event, rowKey: "row-3", provider: "SABA" as const, selection: "HOME",
      previousDecimal: "2", currentDecimal: "2.2", magnitude: "0.2", changedAtMs: nowMs }];

    const ranked = rankTicketsForEvent({ event, verified, movements,
      selectedProviders: new Set(["SABA", "SBOBET"]), observationPolicy: policy, nowMs });

    expect(ranked.slice(0, 3).map((ticket) => ticket.row.key)).toEqual(["row-2", "row-3", "row-1"]);
  });

  it("demotes expired evidence to a neutral observation", () => {
    const event = comparisonEvent();
    const expired = evidence("event-key", "row-1", "90000", "0.3", nowMs);

    const ranked = rankTicketsForEvent({ event, verified: new Map([[expired.key, expired]]), movements: [],
      selectedProviders: new Set(["SABA", "SBOBET"]), observationPolicy: policy, nowMs });

    expect(ranked.find((ticket) => ticket.row.key === "row-1")).toMatchObject({ state: "OBSERVATION",
      reason: "Provider preflight required" });
  });

  it("fails closed for a stale APSPORT quote and restores it after an exact receipt confirmation", () => {
    const line = "-0.5";
    const staleApCell = cell("APSPORT", line, { isLive: true, receivedMonotonicMs: 1 });
    const freshApCell = cell("APSPORT", line, { isLive: true, receivedMonotonicMs: 6_002 });
    const sabaCell = cell("SABA", line, { isLive: true, receivedMonotonicMs: 6_002 });
    const eventWithAp = (apCell: ComparisonCell, heartbeatEventId = apCell.quotes[0]!.providerEventId): ComparisonEvent => ({
      ...comparisonEvent(), event: { ...providerEvent, isLive: true }, providers: ["SABA", "APSPORT"],
      providerEventIds: { SABA: "SABA-event", APSPORT: "APSPORT-event" },
      rows: [{ key: "ap-row", marketType: "FT_AH", scope: "FULL_TIME", line,
        cells: [sabaCell, apCell], bestBySelection: { HOME: "SABA", AWAY: "APSPORT" },
        margin: 0.25, crossBook: true }],
      catalogs: [{ dataMode: "LIVE", accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT",
        category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: nowMs,
        snapshotState: "FRESH", rejectedMarketCount: 0, events: [], markets: [],
        quotes: [...apCell.quotes, { ...freshApCell.quotes[0]!, providerEventId: heartbeatEventId,
          providerMarketId: "another-market", providerSelectionId: "another-selection" }] }]
    });
    const input = { verified: new Map<string, VerifiedTicketEvidence>(), movements: [],
      selectedProviders: new Set(["SABA", "APSPORT"] as const), observationPolicy: policy, nowMs };

    const stale = rankTicketsForEvent({ ...input, event: eventWithAp(staleApCell) });
    const unrelatedUpdate = rankTicketsForEvent({ ...input,
      event: eventWithAp(staleApCell, "another-event") });
    const confirmed = rankTicketsForEvent({ ...input, event: eventWithAp(freshApCell) });

    expect(stale[0]).toMatchObject({ key: "ap-row", plan: null, state: "OBSERVATION" });
    expect(stale[0]?.row.cells.find((candidate) => candidate.provider === "APSPORT")?.quotes).toEqual([]);
    expect(unrelatedUpdate[0]?.plan).not.toBeNull();
    expect(confirmed[0]?.plan).not.toBeNull();
  });
});
