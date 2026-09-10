import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";

function catalog(provider: "SABA" | "SBOBET", accountId: string, odds: readonly [string, string]): LiveCatalogResponse {
  const event: ProviderEvent = { provider, category: "FOOTBALL", providerEventId: accountId,
    competition: "Eliteserien", seasonStage: null, startAtUtcMs: 2_000_000,
    participantA: "Kristiansund BK", participantB: "Molde", eventScope: "REGULATION",
    bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
    isVirtual: false, sportVariant: "FOOTBALL", liveState: null };
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId: accountId,
    providerMarketId: `${accountId}-total`, marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
    settlementProfile: "football-regulation-including-added-time", status: "OPEN" };
  const quotes: ProviderQuote[] = (["OVER", "UNDER"] as const).map((selection, index) => ({
    provider, category: "FOOTBALL", providerEventId: accountId, providerMarketId: market.providerMarketId,
    providerSelectionId: `${accountId}-${selection}`, marketType: "FT_TOTAL", scope: "FULL_TIME",
    selection, line: "2.5", rawOdds: odds[index]!, rawFormat: "DECIMAL", status: "OPEN", isLive: false,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { dataMode: "LIVE", accountId, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: 1,
    rejectedMarketCount: 0, events: [event], markets: [market], quotes };
}

describe("ComparisonWorkerEngine", () => {
  it.each(["participants", "kickoff"] as const)("does not borrow prices after fixture %s change", change => {
    const engine = new ComparisonWorkerEngine();
    const first = catalog("SABA", "saba", ["2.20", "1.80"]);
    const second = catalog("SBOBET", "sbo", ["2.10", "1.90"]);
    engine.apply({ type: "RESET", generation: 1, catalogs: [first, second], staleAccountIds: [] });
    const replace = (event: ProviderEvent): ProviderEvent => change === "participants"
      ? { ...event, participantA: "Rosenborg", participantB: "Brann" }
      : { ...event, startAtUtcMs: 3_000_000 };
    const output = engine.apply({ type: "BATCH_DELTA", generation: 2, changes: [
      { type: "UPSERT", stale: false, catalog: { ...first, events: first.events.map(replace),
        quotes: first.quotes.map((quote, index) => ({ ...quote, sequence: index + 2 })) } },
      { type: "UPSERT", stale: false, catalog: { ...second, events: second.events.map(replace),
        quotes: second.quotes.map(quote => ({ ...quote, sequence: 2 })) } }
    ] });
    expect(output.freshEvents.flatMap(event => event.rows)).toEqual([]);
    expect(output.displayEvents.flatMap(event => event.rows)).toEqual([]);
  });

  it.each(["settlement", "selection"] as const)("does not borrow prices after native %s terms change", change => {
    const engine = new ComparisonWorkerEngine();
    const first = catalog("SABA", "saba", ["2.20", "1.80"]);
    engine.apply({ type: "RESET", generation: 1, staleAccountIds: [],
      catalogs: [first, catalog("SBOBET", "sbo", ["2.10", "1.90"])] });
    const output = engine.apply({ type: "UPSERT", generation: 2, stale: false, catalog: { ...first,
      markets: first.markets.map(market => ({ ...market, settlementProfile: change === "settlement"
        ? "football-including-extra-time" : market.settlementProfile })),
      quotes: first.quotes.map((quote, index) => ({ ...quote, sequence: index + 2,
        providerSelectionId: change === "selection" ? `new-${quote.providerSelectionId}` : quote.providerSelectionId }))
    } });
    expect(output.displayEvents.flatMap(event => event.rows)).toEqual([]);
  });

  it.each(["SUSPENDED", "CLOSED"] as const)("does not resurrect explicitly %s quotes", status => {
    const engine = new ComparisonWorkerEngine();
    const first = catalog("SABA", "saba", ["2.20", "1.80"]);
    const second = catalog("SBOBET", "sbo", ["2.10", "1.90"]);
    engine.apply({ type: "RESET", generation: 1, catalogs: [first, second], staleAccountIds: [] });
    const current = { ...first, observedAtMs: 2,
      quotes: first.quotes.map(quote => ({ ...quote, status, sequence: 2, receivedMonotonicMs: 2 })) };
    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: current, stale: false });
    expect(output.freshEvents.flatMap(event => event.rows)).toEqual([]);
    expect(output.displayEvents.flatMap(event => event.rows)).toEqual([]);
  });

  it("does not touch prior markets or quotes when every current offer is already usable", () => {
    const engine = new ComparisonWorkerEngine();
    const initial = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    let priorReads = 0;
    const counted = { ...initial,
      get markets() { priorReads += 1; return initial.markets; },
      get quotes() { priorReads += 1; return initial.quotes; } };
    engine.apply({ type: "RESET", generation: 1, catalogs: [counted], staleAccountIds: [] });
    priorReads = 0;
    const current = catalog("SABA", "saba-account", ["2.30", "1.70"]);
    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: current, stale: false });
    expect(priorReads).toBe(0);
    // Identity is retained, so the engine does not build a second comparison
    // from derived display arrays when there was nothing to repair.
    expect(output.displayEvents).toBe(output.freshEvents);
    expect(output.displayEvents[0]!.observedRows[0]!.cells[0]!.sourceMarket).toBe(current.markets[0]);
    expect(output.displayEvents[0]!.observedRows[0]!.cells[0]!.sourceQuotes).toEqual(current.quotes);
  });

  it("preserves current order and withdrawals while falling back only the incomplete native market", () => {
    const engine = new ComparisonWorkerEngine(), base = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const extra = (id: string) => ({ ...base.markets[0]!, providerMarketId: id });
    const extraQuotes = (id: string) => base.quotes.map(quote => ({ ...quote, providerMarketId: id,
      providerSelectionId: `${id}-${quote.selection}` }));
    const previous = { ...base, markets: [extra("removed"), extra("fallback"), base.markets[0]!],
      quotes: [...extraQuotes("removed"), ...extraQuotes("fallback"), ...base.quotes] };
    engine.apply({ type: "RESET", generation: 1, catalogs: [previous], staleAccountIds: [] });
    const current = { ...base, markets: [extra("first"), extra("fallback"), extra("unrecoverable")],
      quotes: [...extraQuotes("first"), ...extraQuotes("fallback").map((quote, index) => ({ ...quote, sequence: index + 1 }))] };
    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: current, stale: false });
    const cells = output.displayEvents[0]!.observedRows[0]!.cells;
    expect(cells.map(cell => cell.market.providerMarketId)).toEqual(["first", "fallback"]);
    expect(cells[0]!.sourceMarket).toBe(current.markets[0]);
    expect(cells[1]!.sourceMarket).toBe(previous.markets[1]);
    expect(cells[1]!.sourceQuotes?.map(quote => quote.sequence)).toEqual([1, 1]);
    expect(output.freshEvents[0]!.observedRows[0]!.cells.map(cell => cell.market.providerMarketId)).toEqual(["first"]);
  });
  it("keeps complete markets when a provider reuses the same market id across events", () => {
    const withSecondEvent = (base: LiveCatalogResponse): LiveCatalogResponse => {
      const secondEventId = `${base.accountId}-second-event`;
      const secondMarketId = base.markets[0]!.providerMarketId;
      return { ...base,
        events: [...base.events, { ...base.events[0]!, providerEventId: secondEventId,
          participantA: "Rosenborg", participantB: "Brann", startAtUtcMs: 2_060_000 }],
        markets: [...base.markets, { ...base.markets[0]!, providerEventId: secondEventId,
          providerMarketId: secondMarketId }],
        quotes: [...base.quotes, ...base.quotes.map((quote) => ({ ...quote,
          providerEventId: secondEventId, providerMarketId: secondMarketId,
          providerSelectionId: `${secondEventId}-${quote.selection}` }))] };
    };
    const engine = new ComparisonWorkerEngine();

    const output = engine.apply({ type: "RESET", generation: 1, staleAccountIds: [],
      catalogs: [withSecondEvent(catalog("SABA", "saba-account", ["2.20", "1.80"])),
        withSecondEvent(catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]))] });

    expect(output.displayEvents.filter((event) => event.providers.length === 2)).toHaveLength(2);
  });

  it("does not discard complete tickets because another market is incomplete", () => {
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const incompleteEventId = "saba-incomplete-event";
    const incompleteMarketId = "saba-incomplete-total";
    const partlyUsable = { ...saba,
      events: [...saba.events, { ...saba.events[0]!, providerEventId: incompleteEventId,
        participantA: "Rosenborg", participantB: "Brann", startAtUtcMs: 2_060_000 }],
      markets: [...saba.markets, { ...saba.markets[0]!, providerEventId: incompleteEventId,
        providerMarketId: incompleteMarketId }],
      quotes: [...saba.quotes, { ...saba.quotes[0]!, providerEventId: incompleteEventId,
        providerMarketId: incompleteMarketId, providerSelectionId: "incomplete-over" }] };
    const engine = new ComparisonWorkerEngine();

    const output = engine.apply({ type: "RESET", generation: 1, staleAccountIds: [],
      catalogs: [partlyUsable, catalog("SBOBET", "sbobet-account", ["2.10", "1.90"])] });

    expect(output.displayEvents.find((event) => event.event.participantA === "Kristiansund BK")?.providers)
      .toEqual(["SABA", "SBOBET"]);
  });

  it("compares one list once when the display and fresh lists are the same list", () => {
    // Nothing stale and every catalog atomic makes the two lists identical, and
    // comparing an identical list twice spends 227ms at the sizes measured on
    // 2026-08-29 to reach the answer already in hand, 44 times a minute.
    const engine = new ComparisonWorkerEngine();
    const output = engine.apply({ type: "RESET", generation: 1, staleAccountIds: [],
      catalogs: [catalog("SABA", "saba-account", ["2.20", "1.80"]),
        catalog("SBOBET", "sbobet-account", ["2.10", "1.90"])] });

    expect(output.freshEvents).toBe(output.displayEvents);
    expect(output.displayEvents.length).toBeGreaterThan(0);
  });

  it("compares the fresh list on its own once a catalog goes stale", () => {
    const engine = new ComparisonWorkerEngine();
    const output = engine.apply({ type: "RESET", generation: 1,
      staleAccountIds: ["sbobet-account"],
      catalogs: [catalog("SABA", "saba-account", ["2.20", "1.80"]),
        catalog("SBOBET", "sbobet-account", ["2.10", "1.90"])] });

    expect(output.freshEvents).not.toBe(output.displayEvents);
  });

  it("returns compact parity projections without cloning full catalogs back", () => {
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const sbobet = catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]);
    const engine = new ComparisonWorkerEngine();

    const output = engine.apply({ type: "RESET", generation: 1,
      catalogs: [saba, sbobet], staleAccountIds: [] });

    expect(output.generation).toBe(1);
    expect(output.displayEvents).toHaveLength(1);
    expect(output.freshEvents).toHaveLength(1);
    expect(output.displayEvents[0]).toMatchObject({
      providers: ["SABA", "SBOBET"], accountIds: ["saba-account", "sbobet-account"],
      providerEventIds: { SABA: "saba-account", SBOBET: "sbobet-account" },
      rows: [{ marketType: "FT_TOTAL", line: "2.5" }]
    });
    expect(output.displayEvents[0]).not.toHaveProperty("catalogs");
  });

  it("keeps stale catalogs in display output but excludes them from executable output", () => {
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const sbobet = catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]);
    const engine = new ComparisonWorkerEngine();
    engine.apply({ type: "RESET", generation: 1, catalogs: [saba, sbobet], staleAccountIds: [] });

    const stale = engine.apply({ type: "SET_STALE", generation: 2,
      accountId: "sbobet-account", stale: true });

    expect(stale.displayEvents[0]?.providers).toEqual(["SABA", "SBOBET"]);
    expect(stale.freshEvents[0]?.providers).toEqual(["SABA"]);
    expect(stale.freshEvents[0]?.rows).toEqual([]);
  });

  it("upserts and removes only the addressed account at the requested generation", () => {
    const engine = new ComparisonWorkerEngine();
    engine.apply({ type: "RESET", generation: 1,
      catalogs: [catalog("SABA", "saba-account", ["2.20", "1.80"])], staleAccountIds: [] });
    const added = engine.apply({ type: "UPSERT", generation: 2,
      catalog: catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]), stale: false });
    expect(added.displayEvents[0]?.providers).toEqual(["SABA", "SBOBET"]);

    const removed = engine.apply({ type: "REMOVE", generation: 3, accountId: "saba-account" });
    expect(removed.generation).toBe(3);
    expect(removed.displayEvents[0]?.providers).toEqual(["SBOBET"]);
  });

  it.each(["UPSERT", "BATCH_DELTA"] as const)(
    "keeps the last complete display snapshot while a half-generation %s fails closed", (type) => {
    const engine = new ComparisonWorkerEngine();
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const sbobet = catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]);
    engine.apply({ type: "RESET", generation: 1, catalogs: [saba, sbobet], staleAccountIds: [] });
    const halfGeneration = { ...saba, quotes: saba.quotes.map((quote, index) => ({ ...quote,
      rawOdds: index === 0 ? "2.40" : quote.rawOdds, sequence: index === 0 ? 2 : 1 })) };

    const change = { type: "UPSERT" as const, catalog: halfGeneration, stale: false };
    const output = engine.apply(type === "BATCH_DELTA"
      ? { type, generation: 2, changes: [change] } : { ...change, generation: 2 });

    expect(output.displayEvents[0]?.rows[0]?.cells.find((cell) => cell.provider === "SABA")
      ?.quotes.map((quote) => quote.rawOdds)).toEqual(["2.20", "1.80"]);
    expect(output.freshEvents[0]?.rows).toEqual([]);
  });

  it("clears display fallback when an account is removed and re-added in one batch", () => {
    const engine = new ComparisonWorkerEngine();
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    engine.apply({ type: "RESET", generation: 1, staleAccountIds: [],
      catalogs: [saba, catalog("SBOBET", "sbobet-account", ["2.10", "1.90"])] });
    const halfGeneration = { ...saba, quotes: saba.quotes.map((quote, index) => ({ ...quote,
      rawOdds: index === 0 ? "2.40" : quote.rawOdds, sequence: index === 0 ? 2 : 1 })) };
    const output = engine.apply({ type: "BATCH_DELTA", generation: 2, changes: [
      { type: "REMOVE", accountId: saba.accountId },
      { type: "UPSERT", catalog: halfGeneration, stale: false }
    ] });
    expect(output.displayEvents.flatMap((event) => event.rows)).toEqual([]);
    expect(output.freshEvents.flatMap((event) => event.rows)).toEqual([]);
  });

  it("does not restore prior terms when the same selection ID changes its outcome", () => {
    const engine = new ComparisonWorkerEngine();
    const saba = catalog("SABA", "saba-account", ["2.20", "1.80"]);
    const sbobet = catalog("SBOBET", "sbobet-account", ["2.10", "1.90"]);
    engine.apply({ type: "RESET", generation: 1, catalogs: [saba, sbobet], staleAccountIds: [] });
    const duplicateOutcome = { ...saba, quotes: saba.quotes.map((quote) => ({ ...quote,
      selection: "OVER", sequence: 2 })) };

    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: duplicateOutcome, stale: false });

    expect(output.displayEvents.flatMap(event => event.rows)).toEqual([]);
    expect(output.freshEvents[0]?.rows).toEqual([]);
  });
});
