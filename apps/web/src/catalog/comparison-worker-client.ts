import type { LiveCatalogResponse } from "../api/catalog.js";
import { binaryOpposingCellPairs, comparisonOutcomeDomain, observedTicketAsComparisonRow,
  resultOppositionCellPairs, type ComparisonCell, type ComparisonEvent } from "./comparison.js";
import type { ComparisonProjection, ComparisonWorkerCommand, ComparisonWorkerDelta,
  ComparisonWorkerOutput } from "./comparison-worker-protocol.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";

export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface HydratedComparisonWorkerOutput {
  readonly generation: number;
  /** Intermediate projections are observations only; they must not start preflight. */
  readonly isLatest?: boolean;
  readonly displayEvents: readonly ComparisonEvent[];
  readonly freshEvents: readonly ComparisonEvent[];
}

function defaultWorker(): WorkerLike {
  if (typeof Worker === "undefined") {
    const engine = new ComparisonWorkerEngine();
    let stopped = false;
    const inline: WorkerLike = {
      onmessage: null, onerror: null,
      postMessage(message) {
        queueMicrotask(() => {
          if (stopped) return;
          try { inline.onmessage?.({ data: engine.apply(message as ComparisonWorkerCommand) } as MessageEvent); }
          catch (error) { inline.onerror?.(new ErrorEvent("error", { error })); }
        });
      },
      terminate() { stopped = true; }
    };
    return inline;
  }
  return new Worker(new URL("./comparison.worker.ts", import.meta.url), { type: "module" });
}

function hydrate(projection: ComparisonProjection,
  catalogs: ReadonlyMap<string, LiveCatalogResponse>): ComparisonEvent {
  const { accountIds, ...event } = projection;
  return { ...event, catalogs: accountIds.flatMap((accountId) => {
    const catalog = catalogs.get(accountId);
    return catalog === undefined ? [] : [catalog];
  }) };
}

function comparisonCatalog(catalog: LiveCatalogResponse): LiveCatalogResponse {
  // The comparison engine reads normalized events, markets and quotes only.
  // Native inventory accounting belongs to the provider summary on the UI.
  const { nativeMarketObservations: _nativeMarketObservations,
    nativeCoverageByEvent: _nativeCoverageByEvent, ...comparison } = catalog;
  return comparison;
}

function isOutput(value: unknown): value is ComparisonWorkerOutput {
  if (typeof value !== "object" || value === null) return false;
  const output = value as Partial<ComparisonWorkerOutput>;
  return Number.isSafeInteger(output.generation) && (output.generation ?? -1) >= 0 &&
    Array.isArray(output.displayEvents) && Array.isArray(output.freshEvents);
}

type NativeMarket = LiveCatalogResponse["markets"][number];
type NativeQuote = LiveCatalogResponse["quotes"][number];
const marketIdentity = (market: NativeMarket | NativeQuote): string => JSON.stringify([
  market.provider, market.providerEventId, market.providerMarketId
]);

function quoteTerms(quote: NativeQuote, projected = false): string {
  const { sequence: _sequence, receivedMonotonicMs: _receipt, sourceTimestampMs: _timestamp,
    isLive, ...terms } = quote;
  return JSON.stringify(projected ? terms : { ...terms, isLive });
}

function matchingRoster(catalog: LiveCatalogResponse): string {
  const families = new Map<string, Set<string>>();
  const players = new Map<string, Set<string>>();
  for (const market of catalog.markets) {
    const types = families.get(market.providerEventId) ?? new Set<string>();
    types.add(`${market.marketType}:${market.scope}`);
    families.set(market.providerEventId, types);
    if (market.marketType.startsWith("PLAYER_")) {
      const identities = players.get(market.providerEventId) ?? new Set<string>();
      identities.add(JSON.stringify(market.player ?? null));
      players.set(market.providerEventId, identities);
    }
  }
  const quotedEvents = new Set(catalog.quotes.map(quote => quote.providerEventId));
  return JSON.stringify([catalog.provider, catalog.category, catalog.events.map(event => {
    // Running clock ticks do not affect fixture identity. Scores and periods do.
    const liveState = Object.fromEntries(Object.entries(event.liveState ?? {}).filter(([key]) => key !== "clockMs"));
    return [{ ...event, liveState: event.liveState === null ? null : liveState },
      [...(families.get(event.providerEventId) ?? [])].sort(), [...(players.get(event.providerEventId) ?? [])].sort(),
      quotedEvents.has(event.providerEventId)];
  })]);
}

type NeededOffers = Map<NativeMarket["provider"], Map<string, Set<string>>>;

function projectedNativeOffers(output: ComparisonWorkerOutput): NeededOffers {
  const needed: NeededOffers = new Map();
  const projections = output.displayEvents === output.freshEvents
    ? [output.displayEvents] : [output.displayEvents, output.freshEvents];
  for (const events of projections) for (const event of events) {
    for (const rows of [event.rows, event.observedRows]) for (const row of rows) for (const cell of row.cells) {
      const market = cell.sourceMarket ?? cell.market;
      const providerEvents = needed.get(market.provider) ?? new Map<string, Set<string>>();
      const markets = providerEvents.get(market.providerEventId) ?? new Set<string>();
      markets.add(market.providerMarketId); providerEvents.set(market.providerEventId, markets);
      needed.set(market.provider, providerEvents);
    }
  }
  return needed;
}

function nativeOffers(catalog: LiveCatalogResponse, needed: NeededOffers): Map<string, { market: NativeMarket; quotes: NativeQuote[] } | null> {
  const offers = new Map<string, { market: NativeMarket; quotes: NativeQuote[] } | null>();
  const includes = (item: NativeMarket | NativeQuote): boolean =>
    needed.get(item.provider)?.get(item.providerEventId)?.has(item.providerMarketId) === true;
  for (const market of catalog.markets) {
    if (!includes(market)) continue;
    const key = marketIdentity(market);
    offers.set(key, offers.has(key) ? null : { market, quotes: [] });
  }
  for (const quote of catalog.quotes) if (includes(quote)) offers.get(marketIdentity(quote))?.quotes.push(quote);
  return offers;
}

/** Keep admitted fixture relations and price terms, binding only the exact
 * current native offer's receipt fields after all existing guards pass. */
function intermediateValidator(previous: ReadonlyMap<string, LiveCatalogResponse>,
  current: ReadonlyMap<string, LiveCatalogResponse>, stale: ReadonlySet<string>,
  needed: NeededOffers): ((cell: ComparisonCell) => ComparisonCell | null) | null {
  if (previous.size !== current.size) return null;
  const clock = (catalogs: ReadonlyMap<string, LiveCatalogResponse>, freshOnly: boolean): number =>
    [...catalogs.values()].reduce((latest, catalog) => freshOnly && stale.has(catalog.accountId)
      ? latest : Math.max(latest, catalog.observedAtMs), 0);
  const clocks = [false, true].map(freshOnly => [clock(previous, freshOnly), clock(current, freshOnly)] as const);
  const unchanged = new Map<string, { before: { market: NativeMarket; quotes: NativeQuote[] };
    current: ReadonlyMap<string, NativeQuote> } | null>();
  const candidates = new Map<string, { before: { market: NativeMarket; quotes: NativeQuote[] };
    after: { market: NativeMarket; quotes: NativeQuote[] } } | null>();
  for (const [accountId, before] of previous) {
    const after = current.get(accountId);
    if (after === undefined || (after.snapshotState === "STALE" && before.snapshotState !== "STALE") ||
        after.observedAtMs < before.observedAtMs ||
        (before !== after && matchingRoster(before) !== matchingRoster(after))) return null;
    // withScheduledPhase uses this five-minute boundary in both display and
    // fresh-only projections. A clock-only update can invalidate that evidence.
    if (before.events.some(event => event.category === "FOOTBALL" && !event.isLive && clocks.some(([oldClock, newClock]) =>
      (event.startAtUtcMs > oldClock + 300_000) !== (event.startAtUtcMs > newClock + 300_000)))) return null;
    // The full roster guards above remain global. Price validation only needs
    // offers the worker actually projected, not hundreds of thousands of
    // unmatched native markets. Identical snapshots can share their index.
    const oldOffers = nativeOffers(before, needed), newOffers = before === after ? oldOffers : nativeOffers(after, needed);
    for (const [key, oldOffer] of oldOffers) {
      const newOffer = newOffers.get(key);
      candidates.set(key, candidates.has(key) || oldOffer == null || newOffer == null ? null
        : { before: oldOffer, after: newOffer });
    }
  }
  return cell => {
    const market = cell.sourceMarket ?? cell.market;
    const key = marketIdentity(market);
    if (!unchanged.has(key)) {
      const candidate = candidates.get(key);
      const oldOffer = candidate?.before, newOffer = candidate?.after;
      let valid = oldOffer !== undefined && newOffer !== undefined &&
        (oldOffer.market === newOffer.market || JSON.stringify(oldOffer.market) === JSON.stringify(newOffer.market)) &&
        oldOffer.quotes.length === newOffer.quotes.length && newOffer.quotes.length > 0 &&
        new Set(newOffer.quotes.map(quote => quote.sequence)).size === 1 &&
        newOffer.quotes.every(quote => quote.sequence !== null);
      let bySelection: ReadonlyMap<string, NativeQuote> | undefined;
      if (valid && oldOffer !== undefined && newOffer !== undefined) {
        bySelection = new Map(newOffer.quotes.map(quote => [quote.providerSelectionId, quote]));
        valid = bySelection.size === newOffer.quotes.length &&
          new Set(oldOffer.quotes.map(quote => quote.providerSelectionId)).size === oldOffer.quotes.length &&
          oldOffer.quotes.every(quote => {
            const next = bySelection!.get(quote.providerSelectionId);
            return next !== undefined && (quote === next || quoteTerms(quote) === quoteTerms(next)) &&
              next.receivedMonotonicMs >= quote.receivedMonotonicMs &&
              next.sequence !== null && quote.sequence !== null && next.sequence >= quote.sequence &&
              (quote.sourceTimestampMs === null || (next.sourceTimestampMs !== null && next.sourceTimestampMs >= quote.sourceTimestampMs));
          });
      }
      unchanged.set(key, !valid ? null : { before: oldOffer!, current: bySelection! });
    }
    const offer = unchanged.get(key);
    if (offer == null || (market !== offer.before.market && JSON.stringify(market) !== JSON.stringify(offer.before.market))) return null;
    // Display fallback can refer to an older native quote even in this worker
    // snapshot. Validate each original selection, never oriented synthetic IDs.
    if (!(cell.sourceQuotes ?? cell.quotes).every(quote => offer.before.quotes.some(original =>
      original.providerSelectionId === quote.providerSelectionId && quoteTerms(original, true) === quoteTerms(quote, true) &&
      original.sequence === quote.sequence && original.receivedMonotonicMs === quote.receivedMonotonicMs &&
      original.sourceTimestampMs === quote.sourceTimestampMs))) return null;
    if (cell.quotes.some(quote => marketIdentity(quote) !== marketIdentity(market) ||
      !offer.current.has(quote.providerSelectionId))) return null;
    // Preserve oriented HOME/AWAY, handicap signs and every displayed term.
    // Native selection IDs are unique only inside this validated native market.
    const bindReceipt = (quote: NativeQuote): NativeQuote => {
      const current = offer.current.get(quote.providerSelectionId)!;
      return { ...quote, sequence: current.sequence, receivedMonotonicMs: current.receivedMonotonicMs,
        sourceTimestampMs: current.sourceTimestampMs };
    };
    return { ...cell, quotes: cell.quotes.map(bindReceipt),
      ...(cell.sourceQuotes === undefined ? {} : { sourceQuotes: cell.sourceQuotes.map(bindReceipt) }) };
  };
}

function validatedProjection(event: ComparisonEvent, bind: (cell: ComparisonCell) => ComparisonCell | null): ComparisonEvent {
  const rows = event.rows.flatMap(row => {
    const cells = row.cells.flatMap(cell => { const current = bind(cell); return current === null ? [] : [current]; });
    if (cells.length === row.cells.length) return [{ ...row, cells }];
    const candidate = { ...row, cells };
    const pairs = row.opposition === undefined ? binaryOpposingCellPairs(cells) : resultOppositionCellPairs(candidate);
    return pairs.length === 0 ? [] : [observedTicketAsComparisonRow({ ...candidate,
      settlementProfile: cells[0]!.market.settlementProfile,
      outcomeDomain: comparisonOutcomeDomain(candidate) ?? [] })];
  });
  const observedRows = event.observedRows.flatMap(row => {
    const cells = row.cells.flatMap(cell => { const current = bind(cell); return current === null ? [] : [current]; });
    return cells.length === 0 ? [] : [{ ...row, cells }];
  });
  return { ...event, rows, observedRows,
    bestMargin: rows.reduce<number | null>((best, row) => row.margin === null ? best : Math.max(best ?? -Infinity, row.margin), null) };
}

const COMPETITION_LINKS_KEY = "comparisonCompetitionLinksV1";
// A page reload is not evidence that two books stopped meaning one competition,
// but it used to throw away everything proving they did - and a league's second
// fixture is a match day away, so what was thrown away took days to rebuild.
const MAX_STORED_COMPETITION_LINKS = 4_000;

function defaultLinkStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return window.localStorage; } catch { return null; }
}

function readCompetitionLinks(storage: Pick<Storage, "getItem" | "setItem"> | null): readonly string[] {
  if (storage === null) return [];
  try {
    const stored: unknown = JSON.parse(storage.getItem(COMPETITION_LINKS_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((entry): entry is string => typeof entry === "string")
        .slice(0, MAX_STORED_COMPETITION_LINKS)
      : [];
  } catch { return []; }
}

export class ComparisonWorkerClient {
  readonly #createWorker: () => WorkerLike;
  readonly #onResult: (output: HydratedComparisonWorkerOutput) => void;
  readonly #onError: (message: string) => void;
  readonly #catalogs = new Map<string, LiveCatalogResponse>();
  readonly #stale = new Set<string>();
  readonly #linkStorage: Pick<Storage, "getItem" | "setItem"> | null;
  #links: readonly string[];
  #worker: WorkerLike;
  #generation = 0;
  #inFlightGeneration: number | null = null;
  #inFlightCatalogs: ReadonlyMap<string, LiveCatalogResponse> | null = null;
  #inFlightStale: ReadonlySet<string> = new Set();
  #inFlightInvalidated = false;
  #pendingReset = false;
  readonly #pendingChanges = new Map<string, readonly ComparisonWorkerDelta[]>();
  #restartCount = 0;
  #stopped = false;

  constructor(options: {
    readonly createWorker?: () => WorkerLike;
    readonly onResult: (output: HydratedComparisonWorkerOutput) => void;
    readonly onError?: (message: string) => void;
    readonly competitionLinkStorage?: Pick<Storage, "getItem" | "setItem"> | null;
  }) {
    this.#createWorker = options.createWorker ?? defaultWorker;
    this.#onResult = options.onResult;
    this.#onError = options.onError ?? (() => undefined);
    this.#linkStorage = options.competitionLinkStorage === undefined
      ? defaultLinkStorage() : options.competitionLinkStorage;
    this.#links = readCompetitionLinks(this.#linkStorage);
    this.#worker = this.#spawn();
  }

  reset(catalogs: readonly LiveCatalogResponse[], staleAccountIds: readonly string[]): number {
    this.#catalogs.clear();
    this.#stale.clear();
    for (const catalog of catalogs) this.#catalogs.set(catalog.accountId, catalog);
    for (const accountId of staleAccountIds) this.#stale.add(accountId);
    return this.#enqueue({ type: "RESET", generation: ++this.#generation,
      catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale],
      competitionLinks: this.#links });
  }

  upsert(catalog: LiveCatalogResponse, stale: boolean): number {
    if (this.#inFlightGeneration !== null && this.#stale.has(catalog.accountId) !== stale) this.#inFlightInvalidated = true;
    this.#catalogs.set(catalog.accountId, catalog);
    if (stale) this.#stale.add(catalog.accountId); else this.#stale.delete(catalog.accountId);
    return this.#enqueue({ type: "UPSERT", generation: ++this.#generation, catalog, stale });
  }

  setStale(accountId: string, stale: boolean): number {
    if (stale) this.#stale.add(accountId); else this.#stale.delete(accountId);
    return this.#enqueue({ type: "SET_STALE", generation: ++this.#generation, accountId, stale });
  }

  remove(accountId: string): number {
    this.#catalogs.delete(accountId);
    this.#stale.delete(accountId);
    return this.#enqueue({ type: "REMOVE", generation: ++this.#generation, accountId });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#inFlightCatalogs = null;
    this.#pendingChanges.clear();
    this.#worker.terminate();
  }

  #storeLinks(links: readonly string[]): void {
    this.#links = links.slice(0, MAX_STORED_COMPETITION_LINKS);
    // Storage a browser has filled or refused is a lost head start, not a
    // reason to stop comparing: the session keeps its own copy either way.
    try { this.#linkStorage?.setItem(COMPETITION_LINKS_KEY, JSON.stringify(this.#links)); }
    catch { /* quota or a blocked store; the next session simply starts over */ }
  }

  #enqueue(command: Exclude<ComparisonWorkerCommand, { type: "BATCH_DELTA" }>): number {
    if (this.#stopped) return command.generation;
    if (this.#inFlightGeneration !== null) {
      const continuouslyStale = command.type === "SET_STALE"
        ? command.stale && this.#inFlightStale.has(command.accountId)
        : command.type === "UPSERT" && command.stale && this.#inFlightStale.has(command.catalog.accountId);
      if (command.type === "RESET" || command.type === "REMOVE" ||
          (command.type === "SET_STALE" && !continuouslyStale) ||
          (command.type === "UPSERT" && (command.stale || command.catalog.snapshotState === "STALE") && !continuouslyStale)) {
        this.#inFlightInvalidated = true;
      }
      if (command.type === "RESET") {
        this.#pendingReset = true;
        this.#pendingChanges.clear();
      } else if (!this.#pendingReset) {
        const { generation: _generation, ...delta } = command;
        const accountId = delta.type === "UPSERT" ? delta.catalog.accountId : delta.accountId;
        const previous = this.#pendingChanges.get(accountId) ?? [];
        const latest = previous.at(-1);
        if (delta.type === "SET_STALE" && latest?.type === "UPSERT") {
          this.#pendingChanges.set(accountId, [...previous.slice(0, -1), { ...latest, stale: delta.stale }]);
        } else if (delta.type === "SET_STALE" && latest?.type === "REMOVE") {
          // A freshness update cannot bring a removed account back.
        } else {
          // Preserve removal before re-addition so old display fallback cannot
          // survive a source being deselected and selected again.
          this.#pendingChanges.set(accountId, delta.type === "UPSERT" && previous[0]?.type === "REMOVE"
            ? [previous[0], delta] : [delta]);
        }
      }
      return command.generation;
    }
    this.#send(command);
    return command.generation;
  }

  #send(command: ComparisonWorkerCommand): void {
    this.#inFlightGeneration = command.generation;
    this.#inFlightCatalogs = new Map(this.#catalogs);
    this.#inFlightStale = new Set(this.#stale);
    this.#inFlightInvalidated = false;
    this.#worker.postMessage(command.type === "RESET"
      ? { ...command, catalogs: command.catalogs.map(comparisonCatalog) }
      : command.type === "BATCH_DELTA" ? { ...command, changes: command.changes.map((delta) =>
        delta.type === "UPSERT" ? { ...delta, catalog: comparisonCatalog(delta.catalog) } : delta) }
      : command.type === "UPSERT" ? { ...command, catalog: comparisonCatalog(command.catalog) } : command);
  }

  #spawn(): WorkerLike {
    const worker = this.#createWorker();
    worker.onmessage = (event) => {
      if (this.#stopped || worker !== this.#worker || !isOutput(event.data) || event.data.generation !== this.#inFlightGeneration) return;
      const snapshots = this.#inFlightCatalogs!;
      const isLatest = event.data.generation === this.#generation;
      if (Array.isArray(event.data.competitionLinks)) this.#storeLinks(event.data.competitionLinks);
      // An already-stale book can keep receiving roster changes while the
      // worker runs. Those changes cannot invalidate independent fresh pairs.
      // Validate only the fresh projection; never publish stale display rows.
      const freshOnly = !isLatest && this.#inFlightStale.size > 0;
      const withoutStale = (catalogs: ReadonlyMap<string, LiveCatalogResponse>) => new Map(
        [...catalogs].filter(([id]) => !this.#inFlightStale.has(id)));
      const projected = freshOnly ? { ...event.data, displayEvents: event.data.freshEvents } : event.data;
      const validate = isLatest || this.#inFlightInvalidated ? null
        : intermediateValidator(freshOnly ? withoutStale(snapshots) : snapshots,
          freshOnly ? withoutStale(this.#catalogs) : this.#catalogs, this.#stale, projectedNativeOffers(projected));
      if (isLatest || validate !== null) {
        const project = (item: ComparisonProjection): ComparisonEvent => {
          const hydrated = hydrate(item, validate === null ? snapshots : this.#catalogs);
          return validate === null ? hydrated : validatedProjection(hydrated, validate);
        };
        const displayEvents = projected.displayEvents.map(project);
        this.#onResult({ generation: event.data.generation, isLatest, displayEvents,
          freshEvents: projected.freshEvents === projected.displayEvents ? displayEvents : projected.freshEvents.map(project) });
      }
      this.#inFlightGeneration = null;
      this.#inFlightCatalogs = null;
      if (this.#stopped) return;
      if (this.#pendingReset) {
        this.#pendingReset = false;
        this.#pendingChanges.clear();
        this.#send({ type: "RESET", generation: this.#generation,
          catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale],
          competitionLinks: this.#links });
      } else if (this.#pendingChanges.size > 0) {
        const changes = [...this.#pendingChanges.values()].flat();
        this.#pendingChanges.clear();
        this.#send({ type: "BATCH_DELTA", generation: this.#generation, changes });
      }
    };
    worker.onerror = () => {
      if (this.#stopped || worker !== this.#worker) return;
      this.#inFlightCatalogs = null;
      if (this.#restartCount >= 1) {
        this.#inFlightGeneration = null;
        this.#pendingReset = false;
        this.#pendingChanges.clear();
        this.stop();
        this.#onError("COMPARISON_WORKER_FAILED");
        return;
      }
      this.#restartCount += 1;
      worker.terminate();
      this.#inFlightGeneration = null;
      this.#pendingReset = false;
      this.#pendingChanges.clear();
      this.#worker = this.#spawn();
      this.#send({ type: "RESET", generation: ++this.#generation,
        catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale],
        competitionLinks: this.#links });
    };
    return worker;
  }
}
