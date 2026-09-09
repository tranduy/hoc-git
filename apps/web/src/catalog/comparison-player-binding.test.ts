import { describe, expect, it } from "vitest";
import { footballBinaryMarketSpec, type ProviderPlayerIdentity } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, binaryOpposingCellPairs, exactTwoWayOutcomeDomain, isAvailableTwoWayTicket,
  twoWaySettlementCases, type ComparisonRow } from "./comparison.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";
import { ComparisonWorkerClient, type WorkerLike, type HydratedComparisonWorkerOutput } from "./comparison-worker-client.js";
import { buildFixedBaseStakePlan, buildFixedBaseStakePlanForPair, enumerateOpposingLegPairs,
  stakeLegMatchesQuote } from "../watch/fixed-base-stake.js";

const identity = (providerPlayerId = "11", name = "Joao Felix",
  teamSide: ProviderPlayerIdentity["teamSide"] = "HOME"): ProviderPlayerIdentity => ({ providerPlayerId, name, teamSide });

function catalog(provider: "APSPORT" | "BTI", player = identity(), swapped = false, receipt = 1): LiveCatalogResponse {
  const marketType = "PLAYER_FT_SHOTS_TOTAL";
  const market = { provider, category: "FOOTBALL" as const, providerEventId: provider, providerMarketId: "market",
    marketType, scope: "FULL_TIME", line: "1.5", player,
    settlementProfile: footballBinaryMarketSpec(marketType)!.settlementProfile, status: "OPEN" as const } as const;
  return { dataMode: "LIVE", accountId: provider, provider, category: "FOOTBALL", snapshotState: "FRESH",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: receipt, rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: provider, competition: "Premier League",
      seasonStage: null, startAtUtcMs: 2_000_000, participantA: swapped ? "Arsenal" : "Liverpool",
      participantB: swapped ? "Liverpool" : "Arsenal", eventScope: "REGULATION", bestOf: null,
      isLive: false, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
      sportVariant: "FOOTBALL", liveState: null }], markets: [market],
    quotes: (["OVER", "UNDER"] as const).map(selection => ({ ...market, providerSelectionId: selection,
      selection, rawOdds: "2.1", rawFormat: "DECIMAL", isLive: false, sourceTimestampMs: receipt,
      receivedMonotonicMs: receipt, sequence: receipt })) };
}

const rows = (...catalogs: LiveCatalogResponse[]) => buildComparisonEvents(catalogs).flatMap(event => event.rows);
const policy = { currency: "VND", baseStake: "500000", minStake: "1", maxStake: "10000000", stakeStep: "1", balance: "10000000" };
const providers = new Set(["APSPORT", "BTI"] as const);
const validRow = () => rows(catalog("APSPORT"), catalog("BTI", identity("22")))[0]!;

describe("player subject binding in comparison and stake plans", () => {
  it("separates player contracts by full name while retaining native player IDs", () => {
    const source = catalog("APSPORT"), peer = catalog("BTI", identity("22", "Mohamed Salah"));
    expect(rows(source, peer)).toHaveLength(0);
    const first = validRow();
    expect(first).toBeDefined();
    const second = rows(catalog("APSPORT", identity("33", "Mohamed Salah")), peer)[0]!;
    expect(first.key).not.toBe(second.key);
    expect(first.cells.map(cell => cell.market.player?.providerPlayerId).sort()).toEqual(["11", "22"]);
  });

  it("orients the player and every quote's team without changing the source identity", () => {
    const row = rows(catalog("APSPORT"), catalog("BTI", identity("22", "João Félix", "AWAY"), true))[0]!;
    expect(row).toBeDefined();
    const cell = row.cells.find(cell => cell.provider === "BTI")!;
    expect(cell.market.player?.teamSide).toBe("HOME");
    expect(cell.quotes.every(quote => quote.player?.teamSide === "HOME")).toBe(true);
    expect(cell.sourceMarket?.player?.teamSide).toBe("AWAY");
    expect(cell.sourceQuotes?.every(quote => quote.player?.teamSide === "AWAY")).toBe(true);
    expect(buildFixedBaseStakePlan(row, providers, policy)).not.toBeNull();
  });

  it.each([identity("22", "Joao Felix", null), identity("22", "J. Felix"), identity("22", "Joao Felix", "AWAY")])(
    "does not pair an unresolved or differently sided player %j", player => {
      expect(rows(catalog("APSPORT"), catalog("BTI", player))).toHaveLength(0);
    });

  it.each([undefined, identity("99"), identity("11", "Mohamed Salah"), identity("11", "Joao Felix", "AWAY")])(
    "rejects quote metadata that differs from its exact native market player %j", player => {
      const source = catalog("APSPORT");
      const corrupted = { ...source, quotes: source.quotes.map(quote => ({ ...quote, player })) };
      expect(rows(corrupted, catalog("BTI", identity("22")))).toHaveLength(0);
      expect(isAvailableTwoWayTicket({ provider: source.provider, market: source.markets[0]!, quotes: corrupted.quotes })).toBe(false);
    });

  it("rejects same-name native ambiguity found on another line of the same event/team", () => {
    const source = catalog("APSPORT"), other = catalog("APSPORT", identity("99"));
    const ambiguous = { ...source, markets: [...source.markets, { ...other.markets[0]!, providerMarketId: "other", line: "2.5" }],
      quotes: [...source.quotes, ...other.quotes.map(quote => ({ ...quote, providerMarketId: "other", line: "2.5" }))] };
    expect(rows(ambiguous, catalog("BTI", identity("22")))).toHaveLength(0);
    expect(ambiguous.markets).toHaveLength(2);
  });

  it("checks the original source player even when the oriented copies agree", () => {
    const row = validRow(), cell = row.cells[0]!;
    expect(isAvailableTwoWayTicket({ ...cell, sourceMarket: { ...cell.sourceMarket!, player: identity("99") } })).toBe(false);
    expect(isAvailableTwoWayTicket({ ...cell, sourceQuotes: cell.sourceQuotes!.map(quote => ({ ...quote, player: identity("99") })) })).toBe(false);
  });

  it("rejects missing player metadata and cross-player hand-built rows in both pairing paths", () => {
    const row = validRow();
    const bad = catalog("BTI", identity("22", "Mohamed Salah"));
    const mixed: ComparisonRow = { ...row, cells: [row.cells[0]!, { provider: "BTI", market: bad.markets[0]!, quotes: bad.quotes }] };
    expect(binaryOpposingCellPairs(mixed.cells)).toHaveLength(0);
    expect(enumerateOpposingLegPairs(mixed, providers)).toHaveLength(0);
    expect(buildFixedBaseStakePlan(mixed, providers, policy)).toBeNull();
    const source = catalog("APSPORT");
    const missing = { ...source, markets: source.markets.map(({ player: _player, ...market }) => market),
      quotes: source.quotes.map(({ player: _player, ...quote }) => quote) };
    expect(rows(missing, catalog("BTI", identity("22")))).toHaveLength(0);
  });

  it("invalidates a selected pair and plan leg when player IDs are reused for a different subject", () => {
    const row = validRow(), pair = enumerateOpposingLegPairs(row, providers)[0]!;
    const plan = buildFixedBaseStakePlanForPair(row, pair, policy)!;
    expect(plan).not.toBeNull();
    const replaced = { ...pair, first: { ...pair.first, quote: { ...pair.first.quote, player: identity("11", "Mohamed Salah") } } };
    expect(buildFixedBaseStakePlanForPair(row, replaced, policy)).toBeNull();
    const leg = plan.legs.find(leg => leg.provider === pair.first.provider)!;
    expect(stakeLegMatchesQuote(leg, pair.first.quote)).toBe(true);
    expect(stakeLegMatchesQuote(leg, replaced.first.quote)).toBe(false);
  });
});

describe("worker player identity continuity", () => {
  it("does not display a previous complete player offer after its native ID changes subject", () => {
    const engine = new ComparisonWorkerEngine(), before = catalog("APSPORT");
    engine.apply({ type: "RESET", generation: 1, catalogs: [before, catalog("BTI", identity("22"))], staleAccountIds: [] });
    const changed = catalog("APSPORT", identity("11", "Mohamed Salah"));
    const output = engine.apply({ type: "UPSERT", generation: 2, catalog: { ...changed, quotes: [] }, stale: false });
    expect(output.displayEvents.flatMap(event => event.rows)).toHaveLength(0);
  });

  it.each(["player", "ambiguous roster"])("does not renew intermediate receipts after %s changes", kind => {
    const posted: unknown[] = [], outputs: HydratedComparisonWorkerOutput[] = [];
    const worker: WorkerLike = { onmessage: null, onerror: null, postMessage: value => { posted.push(value); }, terminate() {} };
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null, onResult: value => outputs.push(value) });
    client.reset([catalog("APSPORT"), catalog("BTI", identity("22"))], []);
    const completed = new ComparisonWorkerEngine().apply(posted[0] as never);
    const next = catalog("APSPORT", kind === "player" ? identity("11", "Mohamed Salah") : identity(), false, 2000);
    const ambiguity = { ...next.markets[0]!, providerMarketId: "other", player: identity("99"), line: "2.5" };
    client.upsert(kind === "player" ? next : { ...next, markets: [...next.markets, ambiguity] }, false);
    worker.onmessage!({ data: completed } as MessageEvent);
    client.stop();
    expect(outputs.flatMap(output => output.freshEvents.flatMap(event => event.rows))).toHaveLength(0);
  });
});

describe("integer predicate thresholds are not Asian lines", () => {
  it("accepts a 600-second YES/NO contract with exactly two win/loss cases", () => {
    expect(exactTwoWayOutcomeDomain("FT_FIRST_GOAL_BEFORE", "FULL_TIME", "600")).toEqual(["NO", "YES"]);
    expect(twoWaySettlementCases("FT_FIRST_GOAL_BEFORE", "FULL_TIME", "600")?.map(item => item.kind))
      .toEqual(["FIRST_WINS", "SECOND_WINS"]);
    expect(twoWaySettlementCases("FT_TOTAL", "FULL_TIME", "2")?.map(item => item.kind))
      .toEqual(["FIRST_WINS", "SECOND_WINS", "PUSH"]);
  });
  it.each(["0", "-600", "600.5", "600.0000000000000001", "9007199254740992"])("rejects invalid threshold %s", line => {
    expect(exactTwoWayOutcomeDomain("FT_FIRST_GOAL_BEFORE", "FULL_TIME", line)).toBeNull();
  });
  it("does not round an invalid source threshold into a valid projected contract", () => {
    const timeCatalog = (provider: "APSPORT" | "BTI", line: string): LiveCatalogResponse => {
      const source = catalog(provider), spec = footballBinaryMarketSpec("FT_FIRST_GOAL_BEFORE")!;
      return { ...source, markets: source.markets.map(({ player: _player, ...market }) => ({ ...market,
        marketType: spec.marketType, line, settlementProfile: spec.settlementProfile })),
      quotes: source.quotes.map(({ player: _player, ...quote }, index) => ({ ...quote,
        marketType: spec.marketType, line, selection: spec.outcomes[index]! })) };
    };
    expect(rows(timeCatalog("APSPORT", "600.0000000000000001"), timeCatalog("BTI", "600"))).toHaveLength(0);
    expect(rows(timeCatalog("APSPORT", "600.0"), timeCatalog("BTI", "600"))).toHaveLength(1);
  });
});
