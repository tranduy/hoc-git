import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { ComparisonCell, ComparisonEvent, ComparisonRow, ObservedTicketRow } from "../catalog/comparison.js";
import type { FixedBaseStakePlan, FixedBaseStakePolicy } from "./fixed-base-stake.js";
import { eventEdgeSummary, nextRankingDeadlineMs, ObservedStakeEstimateCache, rankTicketsForEvent, sortRankedEvents, topRankedTicketItems,
  type RankedEvent } from "./ranked-tickets.js";
import type { VerifiedTicketEvidence } from "./ticket-preflight-coordinator.js";
import { roiTone } from "./roi-tone.js";

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

describe("observed stake estimate reuse", () => {
  it("keeps an active plan warm across the measured 22,740-row inventory scan", () => {
    const cache = new ObservedStakeEstimateCache();
    const providers = new Set(["SABA", "SBOBET"] as const);
    const activeRow = row(1);
    const original = cache.estimate("active-first", activeRow, providers, policy);
    expect(original).not.toBeNull();
    // Null estimates also occupy the active ranking scan; they must not evict
    // a valid row merely because the expanded inventory exceeds the old cap.
    const unavailableRow = { ...row(2), cells: [] };
    for (let index = 1; index < 22_740; index++) {
      cache.estimate(`active-${index}`, unavailableRow, providers, policy);
    }
    expect(cache.estimate("active-first", structuredClone(activeRow), providers, policy)).toBe(original);
    expect(cache.size).toBe(22_740);
  });
  it("bounds retained history and replaces the latest calculation for one row", () => {
    const cache = new ObservedStakeEstimateCache(2);
    const providers = new Set(["SABA", "SBOBET"] as const);
    const first = cache.estimate("first", row(1), providers, policy);
    cache.estimate("second", row(2), providers, policy);
    expect(cache.estimate("first", structuredClone(row(1)), providers, policy)).toBe(first);
    cache.estimate("third", row(3), providers, policy);
    expect(cache.size).toBe(2);
    expect(cache.estimate("first", row(1), providers, policy)).toBe(first);
    cache.estimate("first", row(1), providers, { ...policy, baseStake: "200000" });
    expect(cache.size).toBe(2);
    expect(cache.estimate("first", row(1), providers, policy)).not.toBe(first);
  });
  it("reuses the plan across structural clones but invalidates exact calculation inputs", () => {
    const event = { ...comparisonEvent(), key: "cache-price-regression", rows: [row(1)] };
    const input = { event, verified: new Map(), movements: [], selectedProviders: new Set(["SABA", "SBOBET"] as const),
      observationPolicy: policy, nowMs };
    const original = rankTicketsForEvent(input)[0]!.plan;
    expect(original).not.toBeNull();
    expect(rankTicketsForEvent({ ...input, event: structuredClone(event) })[0]!.plan).toBe(original);
    const changed = structuredClone(event);
    const changedRow = { ...changed.rows[0]!, cells: changed.rows[0]!.cells.map(c => ({ ...c,
      quotes: c.quotes.map(q => ({ ...q, rawOdds: "2.1" })) })) };
    const changedPlan = rankTicketsForEvent({ ...input, event: { ...changed, rows: [changedRow] } })[0]!.plan;
    expect(changedPlan).not.toBe(original);
    expect(Number(changedPlan?.worstCaseProfit)).toBeLessThan(Number(original?.worstCaseProfit));
    const resized = rankTicketsForEvent({ ...input, observationPolicy: { ...policy, baseStake: "200000" } })[0]!.plan;
    expect(resized).not.toBe(original);
    expect(resized?.totalStake).toBe("400000");
    const suspended = { ...event, rows: event.rows.map(r => ({ ...r,
      cells: r.cells.map(c => ({ ...c, market: { ...c.market, status: "SUSPENDED" as const } })) })) };
    expect(rankTicketsForEvent({ ...input, event: suspended })[0]!.plan).toBeNull();
    expect(rankTicketsForEvent({ ...input, selectedProviders: new Set(["SABA"] as const) })[0]!.plan).toBeNull();
    expect(rankTicketsForEvent({ ...input, observationPolicy: { ...policy, requireProviderConstraints: true,
      providerConstraints: {} } })[0]!.plan).toBeNull();
    for (const changedQuote of [
      { rawFormat: "HK" as const }, { providerSelectionId: "new-native-selection" },
      { status: "SUSPENDED" as const }, { providerMarketId: "wrong-native-market" }
    ]) {
      const changedEvent = { ...event, rows: event.rows.map(r => ({ ...r, cells: r.cells.map(c => ({ ...c,
        quotes: c.quotes.map(q => ({ ...q, ...changedQuote })) })) })) };
      const refreshed = rankTicketsForEvent(input)[0]!.plan;
      expect(rankTicketsForEvent({ ...input, event: changedEvent })[0]!.plan).not.toBe(refreshed);
    }
  });
});

describe("nextRankingDeadlineMs", () => {
  const apCatalog = (observedAtMs: number, isLive: boolean) => ({
    dataMode: "LIVE" as const, accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT" as const,
    category: "FOOTBALL" as const, comparisonState: "AWAITING_SECOND_PROVIDER" as const, observedAtMs,
    snapshotState: "FRESH" as const, rejectedMarketCount: 0, events: [], markets: [],
    quotes: cell("APSPORT", "-0.5", { isLive, receivedMonotonicMs: 5 }).quotes
  });

  it("wakes when an APSPORT quote stops being fresh, not once a second", () => {
    // Ranking reads the clock only through deadlines like this one, so the
    // answer between them is the answer it already produced.
    const event = { ...comparisonEvent(), event: { ...providerEvent, isLive: true },
      catalogs: [apCatalog(10_000, true)] };

    expect(nextRankingDeadlineMs({ events: [event], verified: new Map(), nowMs: 10_000 }))
      .toBe(15_000);
    expect(nextRankingDeadlineMs({ events: [event], verified: new Map(), nowMs: 15_001 }))
      .toBeNull();
  });

  it("gives a fixture that has not kicked off the longer pre-match window", () => {
    const event = { ...comparisonEvent(), event: { ...providerEvent, isLive: true },
      catalogs: [apCatalog(10_000, false)] };

    expect(nextRankingDeadlineMs({ events: [event], verified: new Map(), nowMs: 10_000 }))
      .toBe(25_000);
  });

  it("keeps cross-event receipt offsets when scheduling mixed live and prematch deadlines", () => {
    const oldLive = cell("APSPORT", "-0.5", { isLive: true, receivedMonotonicMs: 1_000 });
    const latestPrematch = cell("APSPORT", "-1.5", { receivedMonotonicMs: 21_000 }).quotes
      .map(quote => ({ ...quote, providerEventId: "another-event" }));
    const current = { ...apCatalog(21_000, true), quotes: [...oldLive.quotes, ...latestPrematch] };
    const event = { ...comparisonEvent(), event: { ...providerEvent, isLive: true }, catalogs: [current] };
    // The untouched live event expired at 6,000; only the other event's 36,000 deadline remains.
    expect(nextRankingDeadlineMs({ events: [event], verified: new Map(), nowMs: 22_000 })).toBe(36_000);
    const recent = { ...current, quotes: [...oldLive.quotes.map(quote => ({ ...quote,
      receivedMonotonicMs: 18_000 })), ...latestPrematch] };
    expect(nextRankingDeadlineMs({ events: [{ ...event, catalogs: [recent] }], verified: new Map(),
      nowMs: 22_000 })).toBe(23_000);
  });

  it("wakes for a kickoff and a verified ticket's expiry, earliest first", () => {
    const event = { ...comparisonEvent(), catalogs: [] };

    expect(nextRankingDeadlineMs({ events: [event], verified: new Map(), nowMs })).toBe(20_000);
    expect(nextRankingDeadlineMs({ events: [event],
      verified: new Map([["k", evidence("event-key", "row-1", "1000", "0.01", 12_000)]]), nowMs }))
      .toBe(12_000);
  });

  it("reports nothing ahead for a board no APSPORT price and no kickoff can move", () => {
    const event = { ...comparisonEvent(), event: { ...providerEvent, isLive: true }, catalogs: [] };

    expect(nextRankingDeadlineMs({ events: [event], verified: new Map(), nowMs })).toBeNull();
  });
});

describe("rankTicketsForEvent", () => {
  it("reads each global sort value once and preserves exact decimal order", () => {
    const event = comparisonEvent(); let roiReads = 0; let profitReads = 0; let movementReads = 0;
    const tickets = Array.from({ length: 48 }, (_, index) => {
      const candidatePlan = plan(`sort-${index}`, "10000", "0.1");
      Object.defineProperty(candidatePlan, "roi", { get() { roiReads += 1; return `0.10000000000000000${index % 3}`; } });
      Object.defineProperty(candidatePlan, "worstCaseProfit", { get() { profitReads += 1; return String(index); } });
      return { key: `sort-${index}`, eventKey: event.key, row: row(index + 1), plan: candidatePlan,
        state: "OBSERVATION" as const, reason: null, get movementMagnitude() { movementReads += 1; return "0"; }, gapsBySelection: {} };
    });
    const ranked = topRankedTicketItems([{ event, tickets, bestVerifiedProfit: null }], 48);
    expect(ranked.map(item => Number(item.ticket.key.slice(5)))).toEqual(
      [2, 1, 0].flatMap(remainder => Array.from({ length: 48 }, (_, i) => 47 - i).filter(i => i % 3 === remainder)));
    expect(roiReads).toBe(48); expect(profitReads).toBe(48); expect(movementReads).toBe(48);
  });
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
  it("keeps the screenshot's 1.99 versus Malay -0.99 SH total break-even at a 500,000 base neutral", () => {
    const cells = (["SABA", "SBOBET"] as const).map(provider => {
      const original = cell(provider, "1.5");
      return { ...original, market: { ...original.market, marketType: "SH_TOTAL" as const, scope: "SECOND_HALF" as const,
        settlementProfile: "football-second-half-including-added-time" }, quotes: original.quotes.map((quote, index) => ({
          ...quote, marketType: "SH_TOTAL" as const, scope: "SECOND_HALF" as const,
          selection: index === 0 ? "OVER" as const : "UNDER" as const,
          rawOdds: provider === "SABA" && index === 0 ? "1.99" : provider === "SBOBET" && index === 1 ? "-0.99" : "1.1",
          rawFormat: provider === "SBOBET" && index === 1 ? "MALAY" as const : "DECIMAL" as const
        })) };
    });
    const exactRow: ComparisonRow = { ...row(1), key: "SH_TOTAL|SECOND_HALF|1.5", marketType: "SH_TOTAL", scope: "SECOND_HALF", line: "1.5", cells };
    const event = { ...comparisonEvent(), key: "lausanne-servette-neutral", rows: [exactRow] };
    const tickets = rankTicketsForEvent({ event, verified: new Map(), movements: [], selectedProviders: new Set(["SABA", "SBOBET"]),
      observationPolicy: { ...policy, baseStake: "500000", maxStake: "1000000", balance: "1000000", stakeStep: "1" }, nowMs });
    expect(tickets[0]!.plan).toMatchObject({ worstCaseProfit: "0", roi: "0", totalStake: "995000" });
    const summary = eventEdgeSummary({ event, tickets, bestVerifiedProfit: null })!;
    expect(roiTone(summary.roiPercent, summary.worstCaseProfit)).toBe("neutral");
    // The displayed 2.0101 is rounded. If it were the exact native decimal,
    // the best whole-VND hedge would lose 0.5 VND; it must remain negative.
    const truncated = { ...exactRow, cells: cells.map(c => ({ ...c, quotes: c.quotes.map(q =>
      q.rawFormat === "MALAY" ? { ...q, rawOdds: "2.0101", rawFormat: "DECIMAL" as const } : q) })) };
    const literalTickets = rankTicketsForEvent({ event: { ...event, rows: [truncated] }, verified: new Map(), movements: [],
      selectedProviders: new Set(["SABA", "SBOBET"]), observationPolicy: { ...policy, baseStake: "500000", maxStake: "1000000",
        balance: "1000000", stakeStep: "1" }, nowMs });
    expect(literalTickets[0]!.plan?.worstCaseProfit).toBe("-0.5");
    const literalSummary = eventEdgeSummary({ event, tickets: literalTickets, bestVerifiedProfit: null })!;
    expect(roiTone(literalSummary.roiPercent, literalSummary.worstCaseProfit)).toBe("negative");
  });

  it("indexes each movement once across events and keeps exact event/row identity and maximum magnitude", () => {
    let identityReads = 0;
    const movement = (eventKey: string, rowKey: string, magnitude: string) => ({
      key: `${eventKey}/${rowKey}/${magnitude}`, event: { get key() { identityReads += 1; return eventKey; } },
      rowKey, provider: "SABA" as const, selection: "HOME", previousDecimal: "2",
      currentDecimal: "2.2", magnitude, changedAtMs: nowMs
    });
    const movements = [movement("event-key", "row-1", "0.1"),
      movement("event-key", "row-1", "0.3"), movement("event-key", "row-2", "0.2"),
      movement("other-event", "row-1", "9"), movement("event-key::row-1", "suffix", "8")];
    const input = { verified: new Map(), movements, selectedProviders: new Set(["SABA", "SBOBET"] as const),
      observationPolicy: policy, nowMs, limit: 7 };
    const ranked = rankTicketsForEvent({ ...input, event: comparisonEvent() });
    expect(ranked.find(({ key }) => key === "row-1")?.movementMagnitude).toBe("0.3");
    expect(ranked.find(({ key }) => key === "row-2")?.movementMagnitude).toBe("0.2");
    const other = rankTicketsForEvent({ ...input, event: { ...comparisonEvent(), key: "other-event" } });
    expect(other.find(({ key }) => key === "row-1")?.movementMagnitude).toBe("9");
    expect(identityReads).toBe(movements.length);
    const replacement = rankTicketsForEvent({ ...input, movements: [movement("event-key", "row-1", "0.05")],
      event: comparisonEvent() });
    expect(replacement.find(({ key }) => key === "row-1")?.movementMagnitude).toBe("0.05");
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

    const staleEvent = eventWithAp(staleApCell);
    const stale = rankTicketsForEvent({ ...input, event: staleEvent });
    const unrelatedUpdate = rankTicketsForEvent({ ...input,
      event: eventWithAp(staleApCell, "another-event") });
    const confirmed = rankTicketsForEvent({ ...input, event: eventWithAp(freshApCell) });
    const replaced = eventWithAp(staleApCell);
    const replacedCatalog = { ...replaced.catalogs[0]!,
      quotes: freshApCell.quotes.map(quote => ({ ...quote, rawOdds: "1.50", sequence: 2 })) };
    expect(rankTicketsForEvent({ ...input,
      event: { ...replaced, catalogs: [replacedCatalog] } })[0]?.plan).toBeNull();

    expect(stale[0]).toMatchObject({ key: "ap-row", plan: null, state: "OBSERVATION" });
    expect(stale[0]?.row.cells.find((candidate) => candidate.provider === "APSPORT")?.quotes).toEqual([]);
    expect(stale[0]?.auditRow).toBe(staleEvent.rows[0]);
    expect(stale[0]?.auditRow?.cells.find((candidate) => candidate.provider === "APSPORT")?.quotes)
      .toBe(staleApCell.quotes);
    expect(unrelatedUpdate[0]?.plan).toBeNull();
    expect(confirmed[0]?.plan).not.toBeNull();
    expect(confirmed[0]?.auditRow).toBeUndefined();
    // A warm arithmetic cache must not revive the same prices past their receipt deadline.
    const expiredAfterWarm = rankTicketsForEvent({ ...input, nowMs: nowMs + 5_001,
      event: eventWithAp(freshApCell) });
    expect(expiredAfterWarm[0]?.plan).toBeNull();
    expect(expiredAfterWarm[0]?.reason).toBe("APSPORT quote freshness not confirmed");
  });

  it.each([true, false])("does not revive an untouched APSPORT event when another event renews (live=%s)", isLive => {
    const own = cell("APSPORT", "-0.5", { isLive, receivedMonotonicMs: 1_000 });
    const otherQuotes = cell("APSPORT", "-1.5", { isLive, receivedMonotonicMs: 21_000 }).quotes
      .map(quote => ({ ...quote, providerEventId: "another-event" }));
    const withReceipt = (apCell: ComparisonCell): ComparisonEvent => ({ ...comparisonEvent(),
      providers: ["SABA", "APSPORT"],
      rows: [{ key: "ap-row", marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
        cells: [cell("SABA", "-0.5", { isLive }), apCell],
        bestBySelection: { HOME: "SABA", AWAY: "APSPORT" }, margin: 0.25, crossBook: true }],
      catalogs: [{ dataMode: "LIVE", accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT",
        category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 21_000,
        snapshotState: "FRESH", rejectedMarketCount: 0, events: [], markets: [],
        quotes: [...apCell.quotes, ...otherQuotes] }] });
    const input = { verified: new Map<string, VerifiedTicketEvidence>(), movements: [],
      selectedProviders: new Set(["SABA", "APSPORT"] as const), observationPolicy: policy, nowMs: 22_000 };
    expect(rankTicketsForEvent({ ...input, event: withReceipt(own) })[0]).toMatchObject({
      plan: null, reason: "APSPORT quote freshness not confirmed" });
    const confirmed = withReceipt(cell("APSPORT", "-0.5", { isLive, receivedMonotonicMs: 21_000 }));
    expect(rankTicketsForEvent({ ...input, event: confirmed })[0]?.plan).not.toBeNull();
    const deadline = 21_000 + (isLive ? 5_000 : 15_000);
    expect(rankTicketsForEvent({ ...input, event: confirmed, nowMs: deadline })[0]?.plan).not.toBeNull();
    expect(rankTicketsForEvent({ ...input, event: confirmed, nowMs: deadline + 1 })[0]?.plan).toBeNull();
  });

  it.each([true, false])("expires unchanged quotes after a membership-only AP publication (live=%s)", isLive => {
    const own = cell("APSPORT", "-0.5", { isLive, receivedMonotonicMs: 1_000 });
    const event: ComparisonEvent = { ...comparisonEvent(), event: { ...providerEvent, isLive: true },
      providers: ["SABA", "APSPORT"],
      rows: [{ key: "ap-row", marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5",
        cells: [cell("SABA", "-0.5", { isLive }), own],
        bestBySelection: { HOME: "SABA", AWAY: "APSPORT" }, margin: 0.25, crossBook: true }],
      catalogs: [{ dataMode: "LIVE", accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT",
        category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 21_000,
        observedMonotonicMs: 21_000, snapshotState: "FRESH", rejectedMarketCount: 0,
        events: [], markets: [], quotes: own.quotes }] };
    const input = { event, verified: new Map<string, VerifiedTicketEvidence>(), movements: [],
      selectedProviders: new Set(["SABA", "APSPORT"] as const), observationPolicy: policy, nowMs: 22_000 };
    expect(rankTicketsForEvent(input)[0]).toMatchObject({ plan: null, reason: "APSPORT quote freshness not confirmed" });
    expect(nextRankingDeadlineMs({ events: [event], verified: input.verified, nowMs: input.nowMs })).toBeNull();
  });

  it("indexes APSPORT freshness once instead of rescanning the whole catalog for every quote", () => {
    const line = "-0.5";
    const apCell = cell("APSPORT", line, { isLive: false, receivedMonotonicMs: 1_000 });
    const sabaCell = cell("SABA", line, { isLive: false, receivedMonotonicMs: 1_000 });
    const targetQuotes = Array.from({ length: 100 }, (_, index) => ({
      ...apCell.quotes[index % apCell.quotes.length]!, providerSelectionId: `target-selection-${index}`
    }));
    const unrelated = Array.from({ length: 1_000 }, (_, index) => ({
      ...apCell.quotes[0]!, providerEventId: `other-event-${index}`,
      providerMarketId: `other-market-${index}`, providerSelectionId: `other-selection-${index}`
    }));
    let indexedReads = 0;
    const catalogQuotes = new Proxy([...targetQuotes, ...unrelated], {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      }
    });
    const event: ComparisonEvent = {
      ...comparisonEvent(), providers: ["SABA", "APSPORT"],
      providerEventIds: { SABA: "SABA-event", APSPORT: "APSPORT-event" },
      rows: [{ key: "ap-row", marketType: "FT_AH", scope: "FULL_TIME", line,
        cells: [sabaCell, { ...apCell, quotes: targetQuotes }],
        bestBySelection: { HOME: "SABA", AWAY: "APSPORT" },
        margin: 0.25, crossBook: true }],
      catalogs: [{ dataMode: "LIVE", accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT",
        category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: nowMs,
        snapshotState: "FRESH", rejectedMarketCount: 0, events: [], markets: [], quotes: catalogQuotes }]
    };

    rankTicketsForEvent({ event, verified: new Map(), movements: [],
      selectedProviders: new Set(["SABA", "APSPORT"]), observationPolicy: policy, nowMs });
    rankTicketsForEvent({ event: { ...event, key: "same-catalog-second-event" }, verified: new Map(), movements: [],
      selectedProviders: new Set(["SABA", "APSPORT"]), observationPolicy: policy, nowMs });

    expect(indexedReads).toBeLessThan(3_000);
  });
});
