import { describe, expect, it, vi } from "vitest";
import type { ProviderEvent, ProviderId } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";
import type { HydratedComparisonWorkerOutput } from "./comparison-worker-client.js";
import { ComparisonWorkerClient, type WorkerLike } from "./comparison-worker-client.js";

function catalog(accountId: string): LiveCatalogResponse {
  const event: ProviderEvent = { provider: "SABA", category: "FOOTBALL", providerEventId: accountId,
    competition: "League", seasonStage: null, startAtUtcMs: 2_000_000,
    participantA: accountId, participantB: "Opponent", eventScope: "REGULATION", bestOf: null,
    isLive: false, rematchCandidate: false, fixtureDiscriminator: null,
    isVirtual: false, sportVariant: "FOOTBALL", liveState: null };
  return { dataMode: "LIVE", accountId, provider: "SABA", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", snapshotState: "FRESH", observedAtMs: 1,
    // The matcher omits empty roster entries. Keep one complete market so
    // these fixtures exercise worker commands and hydration for real events.
    rejectedMarketCount: 0, events: [event], markets: [{ provider: "SABA", category: "FOOTBALL",
      providerEventId: accountId, providerMarketId: `${accountId}-market`, marketType: "FT_TOTAL",
      scope: "FULL_TIME", line: "2.5", settlementProfile: "football-regulation-including-added-time",
      status: "OPEN" }],
    quotes: (["OVER", "UNDER"] as const).map((selection) => ({ provider: "SABA", category: "FOOTBALL",
      providerEventId: accountId, providerMarketId: `${accountId}-market`,
      providerSelectionId: `${accountId}-${selection}`, marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection, line: "2.5", rawOdds: "1.95", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
      sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 })) };
}

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn();
  postMessage(message: unknown): void { this.posted.push(message); }
  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
  fail(): void { this.onerror?.(new ErrorEvent("error")); }
}

function sharedCatalog(provider: ProviderId, revision = 1): LiveCatalogResponse {
  const base = catalog(provider);
  return { ...base, provider, observedAtMs: revision,
    events: base.events.map(event => ({ ...event, provider, participantA: "Alpha", participantB: "Beta" })),
    markets: base.markets.map(market => ({ ...market, provider })),
    quotes: base.quotes.map(quote => ({ ...quote, provider, sequence: revision, receivedMonotonicMs: revision })) };
}

describe("ComparisonWorkerClient", () => {
  it("quarantines a newly ambiguous fixture without suppressing other providers' exact pair", () => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: HydratedComparisonWorkerOutput[] = [];
    const saba = sharedCatalog("SABA");
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      competitionLinkStorage: null, onResult: output => received.push(output) });
    client.reset([saba, sharedCatalog("BTI"), sharedCatalog("SBOBET")], []);
    const earlier = engine.apply(worker.posted[0] as never);
    const duplicateId = "ambiguous-saba-event";
    client.upsert({ ...saba, observedAtMs: 2,
      events: [...saba.events, { ...saba.events[0]!, providerEventId: duplicateId }],
      markets: [...saba.markets, ...saba.markets.map(market => ({ ...market, providerEventId: duplicateId }))],
      quotes: [...saba.quotes, ...saba.quotes.map(quote => ({ ...quote, providerEventId: duplicateId }))] }, false);
    worker.emit(earlier);
    expect(received).toHaveLength(1);
    expect(received[0]!.freshEvents.some(event => event.rows.length > 0)).toBe(true);
    expect(received[0]!.freshEvents.every(event => !event.providers.includes("SABA") &&
      !event.catalogs.some(catalog => catalog.provider === "SABA") && !event.providerEventIds.SABA &&
      event.rows.every(row => row.cells.every(cell => cell.provider !== "SABA")))).toBe(true);
    worker.emit(engine.apply(worker.posted[1] as never));
    expect(received.at(-1)!.freshEvents.flatMap(event => event.rows.flatMap(row => row.cells))
      .every(cell => cell.provider !== "SABA")).toBe(true);
    client.stop();
  });

  it("keeps independent fresh pairs publishing when unrelated roster churn accompanies stale books", () => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: HydratedComparisonWorkerOutput[] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      competitionLinkStorage: null, onResult: output => received.push(output) });
    client.reset((["SABA", "SBOBET", "CMD", "APSPORT", "IM", "BTI"] as ProviderId[])
      .map(provider => sharedCatalog(provider)), []);
    worker.emit(engine.apply(worker.posted[0] as never));
    client.setStale("IM", true); client.setStale("BTI", true);
    for (let index = 1; index <= 5; index++) {
      const done = engine.apply(worker.posted[index] as never);
      expect(done.freshEvents.some(event => event.rows.length > 0)).toBe(true);
      const catalog = sharedCatalog("SABA", index + 1);
      client.upsert({ ...catalog, events: [...catalog.events, { ...catalog.events[0]!,
        providerEventId: `unmatched-${index}`, participantA: `Unrelated club ${index}`,
        participantB: "Nobody", startAtUtcMs: 5_000_000 }] }, false);
      worker.emit(done);
    }
    expect(received.length).toBeGreaterThan(1);
    const latest = received.at(-1)!;
    expect(latest.freshEvents.some(event => event.rows.length > 0)).toBe(true);
    expect(latest.freshEvents.flatMap(event => event.catalogs.map(catalog => catalog.provider)))
      .not.toEqual(expect.arrayContaining(["SABA"]));
    expect(latest.freshEvents.every(event => !event.providerEventIds.SABA && !event.providerEventIds.IM && !event.providerEventIds.BTI)).toBe(true);
    expect(latest.freshEvents.every(event => !event.providers.includes("SABA") && !event.providers.includes("IM") && !event.providers.includes("BTI"))).toBe(true);
    expect(latest.freshEvents.flatMap(event => event.rows.flatMap(row => row.cells.map(cell => cell.provider))))
      .not.toEqual(expect.arrayContaining(["SABA"]));
    client.stop();
  });
  it.each(["fixture", "phase"])("preserves the fresh %s barrier with a continuously stale third source", kind => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine(), received = vi.fn();
    const fresh = sharedCatalog("BTI");
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      competitionLinkStorage: null, onResult: received });
    client.reset([fresh, sharedCatalog("SABA"), { ...sharedCatalog("CMD"), snapshotState: "STALE" }], ["CMD"]);
    client.upsert({ ...fresh, ...(kind === "phase" ? { observedAtMs: 1_700_001 }
      : { events: fresh.events.map(event => ({ ...event, participantA: "Different team" })) }) }, false);
    client.setStale("CMD", true);
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(received).not.toHaveBeenCalled();
    client.stop();
  });

  it.each(["upsert", "flag"] as const)("keeps fresh pairs progressing through repeated stale-source %s", mode => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: string[][] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: output => {
        expect(output.isLatest).toBe(false);
        expect(output.displayEvents).toEqual(output.freshEvents);
        received.push([...new Set(output.freshEvents.flatMap(event => event.rows.flatMap(row => row.cells.map(cell => cell.provider))))].sort());
      } });
    client.reset([sharedCatalog("BTI"), sharedCatalog("SABA"),
      { ...sharedCatalog("CMD"), snapshotState: "STALE" }], ["CMD"]);
    for (let index = 0; index < 4; index += 1) {
      const completed = engine.apply(worker.posted[index] as never);
      expect(completed.freshEvents.some(event => event.rows.length > 0)).toBe(true);
      if (mode === "flag") client.setStale("CMD", true);
      else client.upsert({ ...sharedCatalog("CMD", index + 2), snapshotState: "STALE",
        events: [] }, true);
      worker.emit(completed);
    }
    expect(received).toEqual(Array.from({ length: 4 }, () => ["BTI", "SABA"]));
    client.stop();
  });

  it.each([false, true])("does not serialize 5000 unprojected offers when the large source changes=%s", changed => {
    const worker = new FakeWorker(), base = sharedCatalog("BTI"), rival = sharedCatalog("SABA");
    let unusedTermReads = 0;
    const unusedMarkets = Array.from({ length: 5000 }, (_, index) => ({ ...base.markets[0]!,
      providerMarketId: `unprojected-${index}`, marketType: "FT_CORRECT_SCORE" as const, line: null,
      get settlementProfile() { unusedTermReads += 1; return "football-correct-score-regulation"; } }));
    const unusedQuotes = unusedMarkets.map((market, index) => ({ ...base.quotes[0]!,
      providerMarketId: market.providerMarketId, providerSelectionId: `unused-selection-${index}`,
      marketType: "FT_CORRECT_SCORE" as const, line: null, selection: "SCORE_1_0",
      get rawOdds() { unusedTermReads += 1; return "3.1"; } }));
    const large = { ...base, markets: [...base.markets, ...unusedMarkets], quotes: [...base.quotes, ...unusedQuotes] };
    const completed = new ComparisonWorkerEngine().apply({ type: "RESET", generation: 1,
      catalogs: [base, rival], staleAccountIds: [] });
    const received: Array<{ receipt: number; sharedProjection: boolean }> = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: output => received.push({ receipt: output.freshEvents[0]!.rows[0]!.cells
        .find(cell => cell.provider === "BTI")!.quotes[0]!.receivedMonotonicMs,
        sharedProjection: output.displayEvents === output.freshEvents }) });
    client.reset([large, rival], []);
    client.upsert(changed ? { ...large, observedAtMs: 2,
      quotes: [...base.quotes.map(quote => ({ ...quote, receivedMonotonicMs: 2, sequence: 2 })), ...unusedQuotes] }
      : sharedCatalog("SABA", 2), false);
    unusedTermReads = 0;
    worker.emit(completed);
    expect(unusedTermReads).toBe(0);
    expect(received).toEqual([{ receipt: changed ? 2 : 1, sharedProjection: true }]);
    client.stop();
  });
  it("publishes useful results through continuous revisions with the validated current native receipt clocks", () => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: Array<{ generation: number; observedAtMs: number; receipt: number }> = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: output => {
        const event = output.freshEvents.find(event => event.rows.length > 0)!;
        const source = event.catalogs.find(c => c.provider === "BTI")!;
        const quote = event.rows[0]!.cells.find(cell => cell.provider === "BTI")!.quotes[0]!;
        received.push({ generation: output.generation, observedAtMs: source.observedAtMs, receipt: quote.receivedMonotonicMs });
      } });
    client.reset([sharedCatalog("BTI"), sharedCatalog("SABA")], []);
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const completed = engine.apply(worker.posted[iteration] as never);
      client.upsert(sharedCatalog("BTI", iteration + 2), false);
      worker.emit(completed);
      expect(worker.posted).toHaveLength(iteration + 2);
    }
    expect(received).toEqual([1, 2, 3, 4].map(generation => ({ generation, observedAtMs: generation + 1, receipt: generation + 1 })));
    client.stop();
  });

  it("keeps the unchanged opposing pair when a third source's price changes during comparison", () => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: string[][] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: output => received.push(output.freshEvents.flatMap(event => event.rows.flatMap(row => row.cells.map(cell => cell.provider)))) });
    client.reset([sharedCatalog("BTI"), sharedCatalog("SABA"), sharedCatalog("SBOBET")], []);
    const changed = sharedCatalog("SBOBET", 2);
    client.upsert({ ...changed, quotes: changed.quotes.map(quote => ({ ...quote, rawOdds: "2.1" })) }, false);
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(received).toEqual([["SABA", "BTI"]]);
    client.stop();
  });

  it.each(["market suspended", "quote suspended", "removed selection", "duplicate selection", "mixed generation",
    "line", "settlement", "format", "receipt rollback"])("withholds the changed offer for %s", kind => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: string[][] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: output => received.push(output.freshEvents.flatMap(event => event.rows.flatMap(row => row.cells.map(cell => cell.provider)))) });
    client.reset([sharedCatalog("BTI"), sharedCatalog("SABA"), sharedCatalog("SBOBET")], []);
    const changed = sharedCatalog("SBOBET", 2);
    const modified: LiveCatalogResponse = { ...changed,
      markets: changed.markets.map(market => ({ ...market,
        ...(kind === "market suspended" ? { status: "SUSPENDED" as const } : {}),
        ...(kind === "line" ? { line: "3.5" } : {}),
        ...(kind === "settlement" ? { settlementProfile: "different-rules" } : {}) })),
      quotes: kind === "removed selection" ? changed.quotes.slice(0, 1) :
        kind === "duplicate selection" ? [changed.quotes[0]!, changed.quotes[0]!] : changed.quotes.map((quote, index) => ({ ...quote,
          ...(kind === "quote suspended" && index === 0 ? { status: "SUSPENDED" as const } : {}),
          ...(kind === "mixed generation" && index === 0 ? { sequence: 3 } : {}),
          ...(kind === "receipt rollback" ? { receivedMonotonicMs: 0 } : {}),
          ...(kind === "format" ? { rawFormat: "MALAY" as const } : {}) })) };
    client.upsert(modified, false);
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(received).toEqual([["SABA", "BTI"]]);
    client.stop();
  });

  it.each(["reset", "remove and readd", "stale and fresh", "stale upsert and fresh",
    "new rival fixture", "new market family", "phase correction cutoff", "observed rollback"])("keeps the %s barrier across a pending batch", kind => {
    const worker = new FakeWorker(), engine = new ComparisonWorkerEngine();
    const received: number[] = [];
    const sources = [sharedCatalog("BTI"), sharedCatalog("SABA")];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: output => received.push(output.generation) });
    client.reset(sources, []);
    if (kind === "reset") client.reset(sources, []);
    else if (kind === "remove and readd") { client.remove("BTI"); client.upsert(sources[0]!, false); }
    else if (kind === "stale and fresh") { client.setStale("BTI", true); client.setStale("BTI", false); }
    else if (kind === "stale upsert and fresh") {
      client.upsert({ ...sources[0]!, snapshotState: "STALE" }, true); client.upsert(sources[0]!, false);
    } else if (kind === "new rival fixture") {
      client.upsert({ ...sources[0]!, events: [...sources[0]!.events,
        { ...sources[0]!.events[0]!, providerEventId: "rival" }] }, false);
    } else if (kind === "new market family") {
      client.upsert({ ...sources[0]!, markets: [...sources[0]!.markets,
        { ...sources[0]!.markets[0]!, providerMarketId: "extra", marketType: "FH_TOTAL", scope: "FIRST_HALF" }] }, false);
    } else client.upsert({ ...sources[0]!, observedAtMs: kind === "phase correction cutoff" ? 1_700_001 : 0 }, false);
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(received).toEqual([]);
    worker.emit(engine.apply(worker.posted[1] as never));
    expect(received).toHaveLength(1);
    client.stop();
  });

  it("sends only comparison data to the worker and hydrates results with the complete catalog", () => {
    const worker = new FakeWorker();
    const received: LiveCatalogResponse[] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      competitionLinkStorage: null,
      onResult: (output) => received.push(...output.displayEvents.flatMap((event) => event.catalogs)) });
    const full: LiveCatalogResponse = { ...catalog("first"), nativeMarketObservations: [{
      provider: "SABA", category: "FOOTBALL", providerEventId: "first", providerMarketId: "native-1",
      nativeType: "total", nativeLabel: "Total", nativeScope: null, outcomeLabels: ["OVER", "UNDER"],
      observedAtMs: 1, disposition: "NORMALIZED", reason: "FT_TOTAL"
    }], nativeCoverageByEvent: [{ providerEventId: "first", normalized: 1, excluded: 0, unmapped: 0 }] };
    const engine = new ComparisonWorkerEngine();
    const verifyLast = () => {
      const command = worker.posted.at(-1) as { catalog?: LiveCatalogResponse; catalogs?: LiveCatalogResponse[];
        changes?: Array<{ catalog: LiveCatalogResponse }> };
      for (const sent of command.catalogs ?? command.changes?.map((change) => change.catalog) ?? [command.catalog!]) {
        expect(sent).not.toHaveProperty("nativeMarketObservations");
        expect(sent).not.toHaveProperty("nativeCoverageByEvent");
        expect(sent.events).toBe(full.events);
        expect(sent.markets).toBe(full.markets);
        expect(sent.quotes).toBe(full.quotes);
      }
      worker.emit(engine.apply(command as never));
    };
    client.reset([full], []);
    verifyLast();
    expect(received.at(-1)).toBe(full);
    client.upsert(full, false);
    verifyLast();
    expect(received.at(-1)?.nativeMarketObservations).toBe(full.nativeMarketObservations);
    // Coalesced updates also cross the same compact transport boundary.
    client.upsert(full, false);
    client.upsert(full, false);
    verifyLast();
    verifyLast();
    expect(received.at(-1)).toBe(full);
    client.stop();
  });

  it("coalesces updates while the worker is busy instead of building a command backlog", () => {
    const worker = new FakeWorker();
    const received: number[] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      onResult: (output) => received.push(output.generation) });
    const first = catalog("first");
    const second = catalog("second");
    const third = catalog("third");
    const engine = new ComparisonWorkerEngine();

    client.reset([first], []);
    client.upsert(second, false);
    client.upsert(third, false);

    expect(worker.posted).toHaveLength(1);
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toEqual({ type: "BATCH_DELTA", generation: 3,
      changes: [{ type: "UPSERT", catalog: second, stale: false },
        { type: "UPSERT", catalog: third, stale: false }] });
    const output = engine.apply(worker.posted[1] as never);
    expect(output.displayEvents.flatMap((event) => event.accountIds)).toEqual(["first", "second", "third"]);
    worker.emit(output);
    expect(received).toEqual([3]);
  });

  it("coalesces each account to its latest catalog, removal and freshness", () => {
    const worker = new FakeWorker();
    const received: number[] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: (output) => received.push(output.generation) });
    const first = catalog("first");
    const second = { ...catalog("second"), observedAtMs: 2 };
    const engine = new ComparisonWorkerEngine();
    client.reset([first, catalog("removed")], []);
    client.upsert(catalog("second"), false);
    client.upsert(second, false);
    client.setStale("second", true);
    client.remove("first");
    client.upsert(first, false);
    client.remove("removed");
    client.setStale("removed", false);
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(worker.posted[1]).toEqual({ type: "BATCH_DELTA", generation: 8, changes: [
      { type: "UPSERT", catalog: second, stale: true },
      { type: "REMOVE", accountId: "first" },
      { type: "UPSERT", catalog: first, stale: false },
      { type: "REMOVE", accountId: "removed" }
    ] });
    const output = engine.apply(worker.posted[1] as never);
    expect(output.displayEvents.flatMap((event) => event.accountIds).sort()).toEqual(["first", "second"]);
    expect(output.freshEvents.flatMap((event) => event.accountIds)).toEqual(["first"]);
    worker.emit(output);
    expect(received).toEqual([8]);
  });

  it("lets a selection reset supersede pending deltas and includes only the latest selection", () => {
    const worker = new FakeWorker();
    const received: number[] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker, competitionLinkStorage: null,
      onResult: (output) => received.push(output.generation) });
    const engine = new ComparisonWorkerEngine();
    const selected = catalog("selected");
    client.reset([catalog("old")], []);
    client.upsert(catalog("discarded"), false);
    client.reset([catalog("removed")], []);
    client.upsert(selected, true);
    client.remove("removed");
    worker.emit(engine.apply(worker.posted[0] as never));
    expect(worker.posted[1]).toEqual({ type: "RESET", generation: 5, catalogs: [selected],
      staleAccountIds: ["selected"], competitionLinks: [] });
    const output = engine.apply(worker.posted[1] as never);
    expect(output.displayEvents.flatMap((event) => event.accountIds)).toEqual(["selected"]);
    expect(output.freshEvents).toEqual([]);
    worker.emit(output);
    expect(received).toEqual([5]);
    expect(worker.posted).toHaveLength(2);
  });

  it("carries proven competition links across a reload", () => {
    // Two books mean one competition once two fixtures agree, and a league's
    // second fixture is a match day away. Evidence that lasted only as long as
    // a page was evidence that never finished arriving.
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); } };
    const first = new FakeWorker();
    const client = new ComparisonWorkerClient({ createWorker: () => first,
      onResult: () => undefined, competitionLinkStorage: storage });

    client.reset([catalog("first")], []);
    first.emit({ generation: 1, displayEvents: [], freshEvents: [],
      competitionLinks: ["SABA league|SBOBET giai"] });

    const second = new FakeWorker();
    const reloaded = new ComparisonWorkerClient({ createWorker: () => second,
      onResult: () => undefined, competitionLinkStorage: storage });
    reloaded.reset([catalog("first")], []);

    expect(second.posted.at(-1)).toMatchObject({ type: "RESET",
      competitionLinks: ["SABA league|SBOBET giai"] });
  });

  it("keeps comparing when the browser refuses to store the links", () => {
    const worker = new FakeWorker();
    const results: number[] = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      onResult: (output) => results.push(output.generation),
      competitionLinkStorage: { getItem: () => { throw new Error("BLOCKED"); },
        setItem: () => { throw new Error("QUOTA"); } } });

    client.reset([catalog("first")], []);
    worker.emit({ generation: 1, displayEvents: [], freshEvents: [], competitionLinks: ["a|b"] });

    expect(results).toEqual([1]);
  });

  it("ignores stale generations and hydrates compact results with current catalog references", () => {
    const worker = new FakeWorker();
    const received: number[] = [];
    const catalogsSeen: Array<readonly LiveCatalogResponse[]> = [];
    const client = new ComparisonWorkerClient({ createWorker: () => worker,
      onResult: (output) => {
        received.push(output.generation);
        catalogsSeen.push(output.displayEvents[0]?.catalogs ?? []);
      } });
    const first = catalog("first");
    const second = catalog("second");
    client.reset([first], []);
    client.upsert(second, false);
    const engine = new ComparisonWorkerEngine();
    const generation1 = engine.apply({ type: "RESET", generation: 1, catalogs: [first], staleAccountIds: [] });
    const generation2 = engine.apply({ type: "UPSERT", generation: 2, catalog: second, stale: false });

    worker.emit(generation1);
    worker.emit(generation2);

    expect(received).toEqual([2]);
    expect(catalogsSeen[0]?.map((item) => item.accountId)).toEqual(["first"]);
    client.stop();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("recreates a failed worker once and requires a reset generation before accepting output", () => {
    const workers: FakeWorker[] = [];
    const received: number[] = [];
    const errors: string[] = [];
    const client = new ComparisonWorkerClient({
      createWorker: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
      onResult: (output) => received.push(output.generation),
      onError: (message) => errors.push(message)
    });
    const source = catalog("first");
    client.reset([source], []);
    client.upsert(source, true);
    workers[0]!.fail();

    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted).toEqual([{
      type: "RESET", generation: 3, catalogs: [source], staleAccountIds: ["first"], competitionLinks: []
    }]);
    const output = new ComparisonWorkerEngine().apply({
      type: "RESET", generation: 3, catalogs: [source], staleAccountIds: ["first"]
    });
    workers[1]!.emit(output);
    expect(received).toEqual([3]);
    expect(workers[1]!.posted).toHaveLength(1);

    workers[1]!.fail();
    expect(workers).toHaveLength(2);
    expect(errors).toEqual(["COMPARISON_WORKER_FAILED"]);
    client.upsert(catalog("after-terminal-error"), false);
    client.reset([source], []);
    expect(workers[1]!.posted).toHaveLength(1);
    client.stop();
  });
});
