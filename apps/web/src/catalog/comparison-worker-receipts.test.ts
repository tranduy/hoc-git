import { describe, expect, it } from "vitest";
import type { ProviderId } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { ComparisonWorkerClient, type HydratedComparisonWorkerOutput, type WorkerLike } from "./comparison-worker-client.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";
import { rankTicketsForEvent } from "../watch/ranked-tickets.js";

function catalog(provider: ProviderId, receipt: number, reversed = false): LiveCatalogResponse {
  const line = reversed ? "-0.5" : "0.5";
  return { dataMode: "LIVE", accountId: provider, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: receipt,
    rejectedMarketCount: 0,
    events: [{ provider, category: "FOOTBALL", providerEventId: provider, competition: "League",
      seasonStage: null, startAtUtcMs: 2_000_000, participantA: reversed ? "Beta" : "Alpha",
      participantB: reversed ? "Alpha" : "Beta", eventScope: "REGULATION", bestOf: null,
      isLive: false, rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
      sportVariant: "FOOTBALL", liveState: null }],
    markets: [{ provider, category: "FOOTBALL", providerEventId: provider, providerMarketId: "market",
      marketType: "FT_AH", scope: "FULL_TIME", line,
      settlementProfile: "football-regulation-including-added-time", status: "OPEN" }],
    quotes: (["HOME", "AWAY"] as const).map(selection => ({ provider, category: "FOOTBALL",
      providerEventId: provider, providerMarketId: "market", providerSelectionId: selection,
      marketType: "FT_AH", scope: "FULL_TIME", line, selection, rawOdds: "1.95", rawFormat: "DECIMAL",
      status: "OPEN", isLive: false, sourceTimestampMs: receipt, receivedMonotonicMs: receipt, sequence: receipt })) };
}

function intermediate(before: LiveCatalogResponse, current: LiveCatalogResponse,
  peer: ProviderId | LiveCatalogResponse = "BTI"): HydratedComparisonWorkerOutput {
  const posted: unknown[] = [], outputs: HydratedComparisonWorkerOutput[] = [];
  const worker: WorkerLike = { onmessage: null, onerror: null, postMessage: message => { posted.push(message); }, terminate() {} };
  const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
    onResult: output => outputs.push(output) });
  client.reset([typeof peer === "string" ? catalog(peer, 1_000) : peer, before], []);
  const completed = new ComparisonWorkerEngine().apply(posted[0] as never);
  client.upsert(current, false);
  worker.onmessage!({ data: completed } as MessageEvent);
  client.stop();
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.isLatest).toBe(false);
  return outputs[0]!;
}

describe("intermediate worker native receipt binding", () => {
  it("keeps an identical newly confirmed AP offer calculable after its original snapshot expires", () => {
    const before = catalog("APSPORT", 1_000), current = catalog("APSPORT", 21_000);
    const output = intermediate(before, current, catalog("BTI",21_000)), event = output.freshEvents.find(event => event.rows.length > 0)!;
    const tickets = rankTicketsForEvent({ event, verified: new Map(), movements: [],
      selectedProviders: new Set(["BTI", "APSPORT"]), nowMs: 22_000, limit: 10,
      observationPolicy: { currency: "VND", baseStake: "500000", minStake: "1000",
        maxStake: "1000000000000", stakeStep: "1", balance: "1000000000000" } });
    expect(tickets[0]!.plan).not.toBeNull();
    expect(event.catalogs.find(source => source.provider === "APSPORT")).toBe(current);
    expect(event.catalogs.find(source => source.provider === "BTI")!.observedAtMs).toBe(21_000);
    expect(event.rows[0]!.cells.find(cell => cell.provider === "APSPORT")!.quotes[0])
      .toMatchObject({ receivedMonotonicMs: 21_000, sequence: 21_000, sourceTimestampMs: 21_000 });
    expect(before.quotes[0]!.receivedMonotonicMs).toBe(1_000);
  });

  it("preserves reversed handicap terms while binding each native selection's exact newer clocks", () => {
    const before = catalog("APSPORT", 1_000, true), next = catalog("APSPORT", 21_000, true);
    const current = { ...next, quotes: next.quotes.map((quote, index) => ({ ...quote,
      receivedMonotonicMs: 20_000 + index, sourceTimestampMs: 19_000 + index })) };
    const event = intermediate(before, current, "CMD").freshEvents.find(event => event.rows.length > 0)!;
    const cell = event.rows[0]!.cells.find(cell => cell.provider === "APSPORT")!;
    expect(cell.market.line).toBe("0.5");
    expect(cell.sourceMarket!.line).toBe("-0.5");
    for (const quote of cell.quotes) {
      const native = current.quotes.find(candidate => candidate.providerSelectionId === quote.providerSelectionId)!;
      expect(quote.selection).toBe(native.selection === "HOME" ? "AWAY" : "HOME");
      expect(quote.line).toBe("0.5");
      expect(quote.receivedMonotonicMs).toBe(native.receivedMonotonicMs);
      expect(quote.sourceTimestampMs).toBe(native.sourceTimestampMs);
      expect(quote.sequence).toBe(native.sequence);
      expect(cell.sourceQuotes!.find(candidate => candidate.providerSelectionId === quote.providerSelectionId)).toEqual(native);
    }
  });

  it.each(["price", "duplicate selection ID"])("does not bind a newer offer with changed %s", kind => {
    const before = catalog("APSPORT", 1_000), next = catalog("APSPORT", 21_000);
    const current = { ...next, quotes: next.quotes.map(quote => ({ ...quote,
      ...(kind === "price" ? { rawOdds: "2.1" } : { providerSelectionId: "duplicate" }) })) };
    const output = intermediate(before, current);
    expect(output.freshEvents.flatMap(event => event.rows)).toEqual([]);
    expect(output.displayEvents.flatMap(event => event.rows)).toEqual([]);
  });

  it("scopes reused selection IDs to their native market and never loans a renewed neighbor's receipt", () => {
    const withNeighbor = (source: LiveCatalogResponse, receipt: number): LiveCatalogResponse => ({ ...source,
      observedAtMs: Math.max(source.observedAtMs, receipt),
      markets: [...source.markets, { ...source.markets[0]!, providerMarketId: "neighbor", line: "1.5" }],
      quotes: [...source.quotes, ...source.quotes.map(quote => ({ ...quote, providerMarketId: "neighbor", line: "1.5",
        receivedMonotonicMs: receipt, sourceTimestampMs: receipt, sequence: receipt }))] });
    const before = withNeighbor(catalog("APSPORT", 1_000), 1_000);
    const current = withNeighbor(catalog("APSPORT", 1_000), 21_000);
    const peer = withNeighbor(catalog("BTI", 21_000), 21_000);
    const event = intermediate(before, current, peer).freshEvents.find(event => event.rows.length > 0)!;
    const receipts = event.rows.map(row => ({ line: row.line,
      receipt: row.cells.find(cell => cell.provider === "APSPORT")!.quotes[0]!.receivedMonotonicMs }));
    expect(receipts).toEqual(expect.arrayContaining([{ line: "0.5", receipt: 1_000 }, { line: "1.5", receipt: 21_000 }]));
    const tickets = rankTicketsForEvent({ event, verified: new Map(), movements: [],
      selectedProviders: new Set(["BTI", "APSPORT"]), nowMs: 22_000, limit: 10,
      observationPolicy: { currency: "VND", baseStake: "500000", minStake: "1000",
        maxStake: "1000000000000", stakeStep: "1", balance: "1000000000000" } });
    expect(tickets.find(ticket => ticket.row.line === "0.5")!.plan).toBeNull();
    expect(tickets.find(ticket => ticket.row.line === "1.5")!.plan).not.toBeNull();
  });
});
