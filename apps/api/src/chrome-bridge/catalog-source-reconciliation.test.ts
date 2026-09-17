import { describe, expect, it } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import * as reconciliation from "./catalog-source-reconciliation.js";

const reconcileSabaDomDelta = reconciliation.reconcileSabaDomDelta;
const selectionReconciler = () => (reconciliation as unknown as {
  reconcileSelectionObservation?: (catalog: ObservedProviderCatalog, observation: Record<string, unknown>) =>
    ObservedProviderCatalog | null;
}).reconcileSelectionObservation;

function catalog(input: {
  readonly observedAtMs: number;
  readonly events: readonly { readonly providerEventId: string; readonly participantA?: string }[];
  readonly markets: readonly { readonly providerEventId: string; readonly providerMarketId: string;
    readonly marketType: string; readonly scope: string; readonly line: string | null }[];
  readonly quotes: readonly { readonly providerEventId: string; readonly providerMarketId: string;
    readonly providerSelectionId: string; readonly rawOdds: string }[];
}): ObservedProviderCatalog {
  const events = input.events.map((event) => ({ provider: "SABA", category: "FOOTBALL" as const,
    competition: "League", seasonStage: null, startAtUtcMs: 1_000,
    participantA: "Home", participantB: "Away", eventScope: "MATCH", bestOf: null,
    isLive: true, rematchCandidate: null, fixtureDiscriminator: null, isVirtual: false,
    sportVariant: null, liveState: { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 1_000 }, ...event }));
  const markets = input.markets.map((market) => ({ provider: "SABA", category: "FOOTBALL" as const,
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" as const, ...market }));
  const quotes = input.quotes.map((quote) => {
    const market = markets.find((candidate) => candidate.providerEventId === quote.providerEventId &&
      candidate.providerMarketId === quote.providerMarketId)!;
    return { provider: "SABA", category: "FOOTBALL" as const, marketType: market.marketType,
      scope: market.scope, selection: "HOME", line: market.line, rawFormat: "MALAY" as const,
      status: "OPEN" as const, isLive: true, sourceTimestampMs: input.observedAtMs,
      receivedMonotonicMs: input.observedAtMs, sequence: 1, ...quote };
  });
  return { dataMode: "LIVE", accountId: "catalog-source:SABA:FOOTBALL", provider: "SABA",
    category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER",
    rejectedMarketCount: 0, ...input, events, markets, quotes } as ObservedProviderCatalog;
}

describe("catalog source reconciliation", () => {
  it("replaces the visible SABA market family without retaining its obsolete line", () => {
    const retained = catalog({ observedAtMs: 100,
      events: [{ providerEventId: "event-1", participantA: "Old home" }, { providerEventId: "event-2" }],
      markets: [
        { providerEventId: "event-1", providerMarketId: "ah-old", marketType: "FT_AH",
          scope: "FULL_TIME", line: "0.5" },
        { providerEventId: "event-1", providerMarketId: "total", marketType: "FT_TOTAL",
          scope: "FULL_TIME", line: "2.5" },
        { providerEventId: "event-2", providerMarketId: "other-event", marketType: "FT_AH",
          scope: "FULL_TIME", line: "-0.5" }
      ], quotes: [
        { providerEventId: "event-1", providerMarketId: "ah-old", providerSelectionId: "ah-old-home",
          rawOdds: "0.90" },
        { providerEventId: "event-1", providerMarketId: "total", providerSelectionId: "total-over",
          rawOdds: "0.91" },
        { providerEventId: "event-2", providerMarketId: "other-event", providerSelectionId: "other-home",
          rawOdds: "0.92" }
      ] });
    const current = catalog({ observedAtMs: 200,
      events: [{ providerEventId: "event-1", participantA: "Current home" }],
      markets: [{ providerEventId: "event-1", providerMarketId: "ah-new", marketType: "FT_AH",
        scope: "FULL_TIME", line: "1" }],
      quotes: [{ providerEventId: "event-1", providerMarketId: "ah-new",
        providerSelectionId: "ah-new-home", rawOdds: "0.80" }] });

    const reconciled = reconcileSabaDomDelta(retained, current);

    expect(reconciled.events).toEqual([
      expect.objectContaining({ providerEventId: "event-1", participantA: "Current home" }),
      expect.objectContaining({ providerEventId: "event-2" })
    ]);
    expect(reconciled.markets.map((market) => market.providerMarketId).sort())
      .toEqual(["ah-new", "other-event", "total"]);
    expect(reconciled.quotes.map((quote) => [quote.providerSelectionId, quote.rawOdds]).sort())
      .toEqual([["ah-new-home", "0.80"], ["other-home", "0.92"], ["total-over", "0.91"]]);
  });

  it("updates the current price for an unchanged exact SABA selection", () => {
    const retained = catalog({ observedAtMs: 100, events: [{ providerEventId: "event-1" }],
      markets: [{ providerEventId: "event-1", providerMarketId: "ah", marketType: "FT_AH",
        scope: "FULL_TIME", line: "0.5" }],
      quotes: [{ providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home",
        rawOdds: "0.90" }] });
    const current = catalog({ observedAtMs: 200, events: [{ providerEventId: "event-1" }],
      markets: retained.markets as never, quotes: [{ providerEventId: "event-1", providerMarketId: "ah",
        providerSelectionId: "home", rawOdds: "0.77" }] });

    expect(reconcileSabaDomDelta(retained, current).quotes)
      .toEqual([expect.objectContaining({ providerSelectionId: "home", rawOdds: "0.77" })]);
  });

  it("updates an exact quote from a newer direct price observation", () => {
    const current = catalog({ observedAtMs: 100, events: [{ providerEventId: "event-1" }],
      markets: [{ providerEventId: "event-1", providerMarketId: "ah", marketType: "FT_AH",
        scope: "FULL_TIME", line: "0.5" }],
      quotes: [{ providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home",
        rawOdds: "0.90" }] });
    const reconcile = selectionReconciler();
    expect(typeof reconcile).toBe("function");

    const next = reconcile!(current, { kind: "FOUND", accountId: current.accountId, provider: "SABA",
      providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home", line: "0.5",
      expectedCatalogObservedAtMs: 100, expectedRawOdds: "0.90", rawOdds: "0.77",
      observedAtMs: 200, receivedMonotonicMs: 20 });

    expect(next).toMatchObject({ observedAtMs: 200, quotes: [expect.objectContaining({
      providerSelectionId: "home", rawOdds: "0.77", sourceTimestampMs: 200,
      receivedMonotonicMs: 20, sequence: null
    })] });
  });

  it("removes an unverified exact market and its orphaned event", () => {
    const current = catalog({ observedAtMs: 100,
      events: [{ providerEventId: "event-1" }, { providerEventId: "event-2" }],
      markets: [
        { providerEventId: "event-1", providerMarketId: "ah", marketType: "FT_AH",
          scope: "FULL_TIME", line: "0.5" },
        { providerEventId: "event-2", providerMarketId: "other", marketType: "FT_AH",
          scope: "FULL_TIME", line: "1" }
      ], quotes: [
        { providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home", rawOdds: "0.90" },
        { providerEventId: "event-2", providerMarketId: "other", providerSelectionId: "away", rawOdds: "0.80" }
      ] });
    const reconcile = selectionReconciler();
    expect(typeof reconcile).toBe("function");

    const next = reconcile!(current, { kind: "REMOVE", reason: "NOT_FOUND",
      accountId: current.accountId, provider: "SABA", providerEventId: "event-1",
      providerMarketId: "ah", providerSelectionId: "home", line: "0.5",
      expectedCatalogObservedAtMs: 100, expectedRawOdds: "0.90", observedAtMs: 200,
      receivedMonotonicMs: 20 });

    expect(next?.events.map((event) => event.providerEventId)).toEqual(["event-2"]);
    expect(next?.markets.map((market) => market.providerMarketId)).toEqual(["other"]);
    expect(next?.quotes.map((quote) => quote.providerSelectionId)).toEqual(["away"]);
  });

  it("removes only the exact event market when provider IDs are reused", () => {
    const current = catalog({ observedAtMs: 100,
      events: [{ providerEventId: "event-1" }, { providerEventId: "event-2" }],
      markets: [
        { providerEventId: "event-1", providerMarketId: "ah", marketType: "FT_AH",
          scope: "FULL_TIME", line: "0.5" },
        { providerEventId: "event-2", providerMarketId: "ah", marketType: "FT_AH",
          scope: "FULL_TIME", line: "1" }
      ], quotes: [
        { providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home", rawOdds: "0.90" },
        { providerEventId: "event-2", providerMarketId: "ah", providerSelectionId: "home", rawOdds: "0.80" }
      ] });
    const reconcile = selectionReconciler()!;

    const next = reconcile(current, { kind: "REMOVE", reason: "NOT_FOUND",
      accountId: current.accountId, provider: "SABA", providerEventId: "event-1",
      providerMarketId: "ah", providerSelectionId: "home", line: "0.5",
      expectedCatalogObservedAtMs: 100, expectedRawOdds: "0.90", observedAtMs: 200,
      receivedMonotonicMs: 20 });

    expect(next?.events.map((event) => event.providerEventId)).toEqual(["event-2"]);
    expect(next?.markets).toEqual([expect.objectContaining({ providerEventId: "event-2", providerMarketId: "ah" })]);
    expect(next?.quotes).toEqual([expect.objectContaining({ providerEventId: "event-2",
      providerSelectionId: "home", rawOdds: "0.80" })]);
  });

  it("ignores an unchanged price and direct evidence older than the current catalog", () => {
    const current = catalog({ observedAtMs: 100, events: [{ providerEventId: "event-1" }],
      markets: [{ providerEventId: "event-1", providerMarketId: "ah", marketType: "FT_AH",
        scope: "FULL_TIME", line: "0.5" }],
      quotes: [{ providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home",
        rawOdds: "0.90" }] });
    const reconcile = selectionReconciler();
    expect(typeof reconcile).toBe("function");
    const base = { kind: "FOUND", accountId: current.accountId, provider: "SABA",
      providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home", line: "0.5",
      expectedRawOdds: "0.90", rawOdds: "0.90", observedAtMs: 200, receivedMonotonicMs: 20 };

    expect(reconcile!(current, { ...base, expectedCatalogObservedAtMs: 100 })).toBeNull();
    expect(reconcile!(current, { ...base, rawOdds: "0.77", expectedCatalogObservedAtMs: 99,
      observedAtMs: 90 })).toBeNull();
  });

  it("applies direct evidence across a newer catalog revision when the exact quote version is unchanged", () => {
    const current = catalog({ observedAtMs: 150, events: [{ providerEventId: "event-1" }],
      markets: [{ providerEventId: "event-1", providerMarketId: "ah", marketType: "FT_AH",
        scope: "FULL_TIME", line: "0.5" }],
      quotes: [{ providerEventId: "event-1", providerMarketId: "ah", providerSelectionId: "home",
        rawOdds: "0.90" }] });
    const reconcile = selectionReconciler()!;

    const next = reconcile(current, { kind: "REMOVE", reason: "NOT_FOUND",
      accountId: current.accountId, provider: "SABA", providerEventId: "event-1",
      providerMarketId: "ah", providerSelectionId: "home", line: "0.5",
      expectedCatalogObservedAtMs: 100, expectedRawOdds: "0.90", observedAtMs: 200,
      receivedMonotonicMs: 20 });

    expect(next).toMatchObject({ observedAtMs: 200, events: [], markets: [], quotes: [] });
  });
});
