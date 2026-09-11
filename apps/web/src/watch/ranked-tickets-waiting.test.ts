import { describe, expect, it } from "vitest";
import { ComparisonWorkerEngine } from "../catalog/comparison-worker-engine.js";
import type { ProviderId } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, type ComparisonEvent } from "../catalog/comparison.js";
import { rankedEvent, topRankedTicketItems } from "./ranked-tickets.js";

const nowMs = 2_000_000;
const policy = { currency: "VND", baseStake: "500000", minStake: "1000",
  maxStake: "1000000000000", stakeStep: "1", balance: "1000000000000" };
function catalog(provider: ProviderId, odds: readonly [string, string], line = "0.5"): LiveCatalogResponse {
  const eventId = `${provider}-event`, marketId = `${provider}-market`;
  return { dataMode: "LIVE", accountId: `${provider}-account`, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: nowMs,
    rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: eventId, competition: "Eliteserien",
      seasonStage: null, startAtUtcMs: nowMs + 3_600_000, participantA: "Kristiansund BK", participantB: "Molde",
      eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
    markets: [{ provider, category: "FOOTBALL", providerEventId: eventId, providerMarketId: marketId,
      marketType: "FT_AH", scope: "FULL_TIME", line, settlementProfile: "football-regulation-including-added-time", status: "OPEN" }],
    quotes: (["HOME", "AWAY"] as const).map((selection, index) => ({ provider, category: "FOOTBALL",
      providerEventId: eventId, providerMarketId: marketId, providerSelectionId: `${marketId}-${selection}`,
      marketType: "FT_AH", scope: "FULL_TIME", line, selection, rawOdds: odds[index]!, rawFormat: "DECIMAL",
      status: "OPEN", isLive: false, sourceTimestampMs: nowMs, receivedMonotonicMs: 100, sequence: 1 })) };
}
const sources = () => [catalog("CMD", ["1.9", "2.1"]), catalog("APSPORT", ["2.12", "1.92"]),
  catalog("BTI", ["1.94", "2.06"]), catalog("SABA", ["2.3", "1.7"]), catalog("SBOBET", ["1.7", "2.3"])];
function rank(event: ComparisonEvent, selectedProviders = new Set<ProviderId>(["CMD", "APSPORT", "BTI"]), time = nowMs) {
  return rankedEvent({ event, verified: new Map(), movements: [], selectedProviders,
    observationPolicy: policy, nowMs: time, limit: event.rows.length });
}

describe("exact rows waiting for prices", () => {
  it("uses the native AP receipt deadline when the fixture projection corrects live to prematch", () => {
    const original = catalog("APSPORT", ["2.12", "1.92"]);
    const ap = { ...original, events: original.events.map(event => ({ ...event, isLive: true })),
      quotes: original.quotes.map(quote => ({ ...quote, isLive: true })) };
    const other = catalog("CMD", ["1.9", "2.1"]);
    const engine = new ComparisonWorkerEngine();
    const output = engine.apply({ type: "RESET", generation: 1, staleAccountIds: [], catalogs: [ap, other] });
    const { accountIds: _accounts, ...projection } = output.freshEvents.find(event => event.rows.length > 0)!;
    const event = { ...projection, catalogs: [ap, other] };
    expect(event.rows[0]!.cells.find(cell => cell.provider === "APSPORT")!.quotes[0]!.isLive).toBe(false);
    expect(topRankedTicketItems([rank(event)])[0]!.ticket.plan).not.toBeNull();
    expect(topRankedTicketItems([rank(event, undefined, nowMs + 5_001)])[0]!.ticket.plan).toBeNull();
  });

  it("keeps an incomplete pair visible without pricing historical quotes, then restores current ROI", () => {
    const current = catalog("CMD", ["2.3", "1.7"]);
    const other = catalog("BTI", ["1.7", "2.3"]);
    const engine = new ComparisonWorkerEngine();
    engine.apply({ type: "RESET", generation: 1, staleAccountIds: [], catalogs: [current, other] });
    const pending = { ...current, observedAtMs: nowMs + 200_000,
      quotes: current.quotes.map((quote, index) => ({ ...quote, sequence: index + 2 })) };
    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: pending, stale: false });
    const projection = output.displayEvents.find(event => event.rows.length > 0)!;
    const { accountIds: _accounts, ...event } = projection;
    const waiting = topRankedTicketItems([rank({ ...event, catalogs: [pending, other] })]);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.ticket).toMatchObject({ plan: null, hasOpposingSources: true,
      reason: "Waiting for a complete current quote" });
    expect(waiting[0]!.ticket.row.cells.find(cell => cell.provider === "CMD")!.quotes).toEqual([]);

    const refreshed = { ...current, observedAtMs: nowMs + 200_001,
      quotes: current.quotes.map(quote => ({ ...quote, sequence: 4 })) };
    const recovered = engine.apply({ type: "UPSERT", generation: 3, catalog: refreshed, stale: false });
    const { accountIds: _currentAccounts, ...freshEvent } = recovered.displayEvents.find(event => event.rows.length > 0)!;
    expect(topRankedTicketItems([rank({ ...freshEvent, catalogs: [refreshed, other] })])[0]!.ticket.plan).not.toBeNull();
  });

  it("recomputes CMD/AP/BTI routes after the globally best SABA/SBO books are deselected", () => {
    const event = buildComparisonEvents(sources()).find(event => event.rows.length > 0)!;
    const all = topRankedTicketItems([rank(event, new Set(sources().map(source => source.provider)))]);
    expect(all[0]!.ticket.plan!.legs.map(leg => leg.provider).sort()).toEqual(["SABA", "SBOBET"]);
    const selected = topRankedTicketItems([rank(event)]);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.ticket.plan!.legs.map(leg => leg.provider).sort()).toEqual(["APSPORT", "CMD"]);
  });

  it("retains the exact CMD/AP row without ROI when AP expires and BTI has a different line", () => {
    const input = sources().map(source => source.provider === "BTI" ? catalog("BTI", ["1.94", "2.06"], "1.5") : source);
    const event = buildComparisonEvents(input).find(event => event.rows.length > 0)!;
    expect(topRankedTicketItems([rank(event)])[0]!.ticket.plan).not.toBeNull();
    const expired = topRankedTicketItems([rank(event, undefined, nowMs + 15_001)]);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.ticket).toMatchObject({ plan: null, hasOpposingSources: true,
      reason: "Football quote freshness not confirmed" });
    expect(expired[0]!.ticket.row.cells.find(cell => cell.provider === "APSPORT")!.quotes).toEqual([]);
    expect(topRankedTicketItems([rank(event, new Set(["CMD"]), nowMs + 15_001)])).toEqual([]);
  });

  it("puts every usable plan, including a losing one, ahead of exact waiting rows", () => {
    const waiting = buildComparisonEvents([catalog("CMD", ["1.9", "2.1"]), catalog("APSPORT", ["2.12", "1.92"])])[0]!;
    const fresh = buildComparisonEvents([catalog("CMD", ["1.8", "1.8"]), catalog("BTI", ["1.8", "1.8"])].map(source => ({...source, quotes:source.quotes.map(quote => ({...quote,sourceTimestampMs:nowMs+15001}))})))[0]!;
    const result = topRankedTicketItems([rank(waiting, undefined, nowMs + 15_001),
      rank({ ...fresh, key: "fresh-negative" }, undefined, nowMs + 15_001)]);
    expect(result).toHaveLength(2);
    expect(Number(result[0]!.ticket.plan!.worstCaseProfit)).toBeLessThan(0);
    expect(result[1]!.ticket.plan).toBeNull();
  });
});
