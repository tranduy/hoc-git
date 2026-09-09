import { describe, expect, it } from "vitest";
import { footballBinaryMarketSpec, type ProviderPlayerIdentity } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";

function catalog(provider: "BTI" | "APSPORT", selection = "YES", name = "Joao Felix", swapped = false): LiveCatalogResponse {
  const player: ProviderPlayerIdentity = { providerPlayerId: provider === "BTI" ? "11" : "22", name, teamSide: swapped ? "AWAY" : "HOME" };
  const market = { provider, category: "FOOTBALL" as const, providerEventId: provider, providerMarketId: "native:player",
    marketType: "PLAYER_FT_ANYTIME_SCORER" as const, scope: "FULL_TIME" as const, line: null, player,
    settlementProfile: footballBinaryMarketSpec("PLAYER_FT_ANYTIME_SCORER")!.settlementProfile, status: "OPEN" as const };
  return { dataMode: "LIVE", accountId: provider, provider, category: "FOOTBALL", snapshotState: "FRESH",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: provider, competition: "Premier League", seasonStage: null,
      startAtUtcMs: 2_000_000, participantA: swapped ? "Arsenal" : "Liverpool", participantB: swapped ? "Liverpool" : "Arsenal",
      eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
      isVirtual: false, sportVariant: "FOOTBALL", liveState: null }], markets: [market],
    quotes: [{ ...market, providerSelectionId: "native:selection", selection, rawOdds: "2.1", rawFormat: "DECIMAL",
      isLive: false, sourceTimestampMs: 1, receivedMonotonicMs: 1, sequence: 1 }],
    nativeCoverageByEvent: [{ providerEventId: provider, normalized: 1, excluded: 0, unmapped: 3 }] };
}
const observed = (events: ReturnType<typeof buildComparisonEvents>) => events.flatMap(event => event.observedRows);

describe("bounded player comparison worker projections", () => {
  it("keeps direct inventory detail while the worker omits a sole book's player rows", () => {
    const source = catalog("BTI"), saved = structuredClone(source);
    expect(observed(buildComparisonEvents([source]))).toHaveLength(1);
    expect(observed(buildComparisonEvents([source], undefined, { playerComparisonsOnly: true }))).toEqual([]);
    const output = new ComparisonWorkerEngine().apply({ type: "RESET", generation: 1, catalogs: [source], staleAccountIds: [] });
    expect(output.displayEvents.flatMap(event => event.observedRows)).toEqual([]);
    expect(output.displayEvents[0]!.accountIds).toEqual(["BTI"]);
    expect(source).toEqual(saved);
    expect([source.markets.length, source.quotes.length, source.nativeCoverageByEvent![0]!.normalized]).toEqual([1, 1, 1]);
  });
  it("retains cached source quotes so a later peer can create the route without resending the first book", () => {
    const engine = new ComparisonWorkerEngine(), source = catalog("BTI");
    engine.apply({ type: "RESET", generation: 1, catalogs: [source], staleAccountIds: [] });
    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: catalog("APSPORT", "NO"), stale: false });
    expect(output.displayEvents.flatMap(event => event.rows)).toHaveLength(1);
    expect(output.displayEvents.flatMap(event => event.observedRows)).toHaveLength(1);
    expect(output.displayEvents[0]!.rows[0]!.cells.find(cell => cell.provider === "BTI")!.sourceQuotes).toEqual(source.quotes);
  });
  it.each([["YES", "Joao Felix"], ["NO", "Mohamed Salah"]])("omits nonopposing player detail with two books (%s, %s)", (selection, name) => {
    const sources = [catalog("BTI"), catalog("APSPORT", selection, name)];
    expect(observed(buildComparisonEvents(sources)).length).toBeGreaterThan(0);
    const output = new ComparisonWorkerEngine().apply({ type: "RESET", generation: 1, catalogs: sources, staleAccountIds: [] });
    expect(output.displayEvents.flatMap(event => event.rows)).toEqual([]);
    expect(output.displayEvents.flatMap(event => event.observedRows)).toEqual([]);
  });
  it("keeps all matched row terms after player team orientation", () => {
    const sources = [catalog("BTI"), catalog("APSPORT", "NO", "João Félix", true)];
    const direct = buildComparisonEvents(sources);
    const output = new ComparisonWorkerEngine().apply({ type: "RESET", generation: 1, catalogs: sources, staleAccountIds: [] });
    expect(output.displayEvents.flatMap(event => event.rows)).toEqual(direct.flatMap(event => event.rows));
    expect(output.displayEvents.flatMap(event => event.observedRows)).toEqual(observed(direct));
  });
  it("does not count two accounts of the same provider as cross-book player coverage", () => {
    const source = catalog("BTI"), second = { ...source, accountId: "BTI-second" };
    expect(observed(buildComparisonEvents([source, second], undefined, { playerComparisonsOnly: true }))).toEqual([]);
  });
  it("keeps nonplayer single-book detail and source counts", () => {
    const source = catalog("BTI"), original = source.markets[0]!;
    const { player: _player, ...base } = original;
    const market = { ...base, providerMarketId: "total", marketType: "FT_TOTAL" as const, line: "2.5",
      settlementProfile: footballBinaryMarketSpec("FT_TOTAL")!.settlementProfile };
    const { player: _quotePlayer, ...quote } = source.quotes[0]!;
    const mixed = { ...source, markets: [...source.markets, market], quotes: [...source.quotes,
      { ...quote, ...market, providerSelectionId: "over", selection: "OVER" }] };
    const output = new ComparisonWorkerEngine().apply({ type: "RESET", generation: 1, catalogs: [mixed], staleAccountIds: [] });
    expect(output.displayEvents.flatMap(event => event.observedRows).map(row => row.marketType)).toEqual(["FT_TOTAL"]);
    expect(mixed.markets).toHaveLength(2); expect(mixed.quotes).toHaveLength(2);
  });
  it("excludes a stale peer from fresh player projections while keeping its display route", () => {
    const engine = new ComparisonWorkerEngine();
    const output = engine.apply({ type: "RESET", generation: 1, catalogs: [catalog("BTI"), catalog("APSPORT", "NO")], staleAccountIds: ["APSPORT"] });
    expect(output.displayEvents.flatMap(event => event.rows)).toHaveLength(1);
    expect(output.freshEvents.flatMap(event => event.observedRows)).toEqual([]);
  });
});
