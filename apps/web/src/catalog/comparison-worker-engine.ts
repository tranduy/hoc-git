import type { LiveCatalogResponse } from "../api/catalog.js";
import { playerComparisonKey, sameNativePlayer } from "@tool-chenh/contracts";
import { buildComparisonEvents, createCompetitionLinkMemory, exactTwoWayOutcomeDomain,
  isFocusedTwoWayTicket, isAvailableTwoWayTicket, type ComparisonEvent } from "./comparison.js";
import type { ComparisonProjection, ComparisonWorkerCommand, ComparisonWorkerOutput } from "./comparison-worker-protocol.js";

function project(event: ComparisonEvent, historicalMarkets?: ReadonlySet<LiveCatalogResponse["markets"][number]>): ComparisonProjection {
  const { catalogs, ...comparison } = event;
  const matchedPlayerRows = new Set(event.rows.filter(row => row.marketType.startsWith("PLAYER_")).map(row => row.key));
  // A player proposition with no opposing source remains in the cached catalog
  // and direct detail model. Repeating those rows in every worker message can
  // clone more than 140,000 unusable player offers back onto the UI thread.
  const observedRows = event.observedRows.filter(row =>
    !row.marketType.startsWith("PLAYER_") || matchedPlayerRows.has(row.key));
  const mark = <T extends { readonly cells: ComparisonEvent["rows"][number]["cells"] }>(row: T): T => {
    if (historicalMarkets === undefined || historicalMarkets.size === 0) return row;
    return { ...row, cells: row.cells.map(cell => historicalMarkets.has(cell.sourceMarket ?? cell.market)
      ? { ...cell, historical: true as const } : cell) };
  };
  return { ...comparison, rows: event.rows.map(mark), observedRows: observedRows.map(mark),
    accountIds: catalogs.map((catalog) => catalog.accountId) };
}

export class ComparisonWorkerEngine {
  readonly #catalogs = new Map<string, LiveCatalogResponse>();
  readonly #displayCatalogs = new Map<string, LiveCatalogResponse>();
  readonly #historicalMarkets = new Map<string, Set<LiveCatalogResponse["markets"][number]>>();
  readonly #stale = new Set<string>();
  // Which competitions two books have been seen to agree on, kept across
  // commands. A 24-hour window shows most leagues one fixture at a time, so the
  // second fixture that proves two names mean one competition usually arrives
  // in a later snapshot rather than beside the first.
  readonly #competitionMemory = createCompetitionLinkMemory();
  #confirmedCount = 0;

  apply(command: ComparisonWorkerCommand): ComparisonWorkerOutput {
    if (command.type === "RESET") {
      this.#competitionMemory.seed(command.competitionLinks ?? []);
      this.#catalogs.clear();
      this.#displayCatalogs.clear();
      this.#historicalMarkets.clear();
      this.#stale.clear();
      for (const catalog of command.catalogs) {
        this.#catalogs.set(catalog.accountId, catalog);
        const historicalMarkets = new Set<LiveCatalogResponse["markets"][number]>();
        this.#historicalMarkets.set(catalog.accountId, historicalMarkets);
        this.#displayCatalogs.set(catalog.accountId, completeDisplayCatalog(catalog, undefined, historicalMarkets));
      }
      for (const accountId of command.staleAccountIds) this.#stale.add(accountId);
    } else {
      for (const change of command.type === "BATCH_DELTA" ? command.changes : [command]) {
        if (change.type === "UPSERT") {
          this.#catalogs.set(change.catalog.accountId, change.catalog);
          const historicalMarkets = new Set<LiveCatalogResponse["markets"][number]>();
          this.#historicalMarkets.set(change.catalog.accountId, historicalMarkets);
          this.#displayCatalogs.set(change.catalog.accountId,
            completeDisplayCatalog(change.catalog, this.#displayCatalogs.get(change.catalog.accountId), historicalMarkets));
          if (change.stale) this.#stale.add(change.catalog.accountId);
          else this.#stale.delete(change.catalog.accountId);
        } else if (change.type === "SET_STALE") {
          if (change.stale) this.#stale.add(change.accountId);
          else this.#stale.delete(change.accountId);
        } else {
          this.#catalogs.delete(change.accountId);
          this.#displayCatalogs.delete(change.accountId);
          this.#historicalMarkets.delete(change.accountId);
          this.#stale.delete(change.accountId);
        }
      }
    }
    const catalogs = [...this.#catalogs.values()];
    const displayCatalogs = [...this.#displayCatalogs.values()];
    const freshCatalogs = catalogs.filter((catalog) => !this.#stale.has(catalog.accountId));
    const historicalMarkets = new Set([...this.#historicalMarkets.values()].flatMap(markets => [...markets]));
    const displayEvents = buildComparisonEvents(displayCatalogs, this.#competitionMemory, { playerComparisonsOnly: true })
      .map(event => project(event, historicalMarkets));
    // The two lists are the same list whenever nothing is stale and every
    // supported market is complete, which is most of the time. Comparing a list twice
    // spends the same 227ms to reach the answer already in hand - 44 times a
    // minute at the sizes measured 2026-08-29, a third of a core for nothing.
    const output = { generation: command.generation, displayEvents,
      freshEvents: sameCatalogs(displayCatalogs, freshCatalogs) ? displayEvents
        : buildComparisonEvents(freshCatalogs, this.#competitionMemory, { playerComparisonsOnly: true }).map(event => project(event)) };
    // Sent only when the proven set grows, because it rides on every catalog
    // update and most of them prove nothing new.
    const confirmed = this.#competitionMemory.confirmed();
    if (confirmed.length === this.#confirmedCount) return output;
    this.#confirmedCount = confirmed.length;
    return { ...output, competitionLinks: confirmed };
  }
}

/**
 * Whether two catalog lists are the same catalogs, by identity and in order.
 *
 * buildComparisonEvents reads only what it is given, so the same objects in the
 * same order produce the same comparison. Object identity is what makes this
 * safe to assert: a catalog that arrived again as a new revision is a different
 * object, and the comparison is redone.
 */
function sameCatalogs(left: readonly LiveCatalogResponse[],
  right: readonly LiveCatalogResponse[]): boolean {
  return left.length === right.length && left.every((catalog, index) => catalog === right[index]);
}

function marketIdentity(item: { readonly providerEventId: string; readonly providerMarketId: string }): string {
  return `${item.providerEventId}\u0000${item.providerMarketId}`;
}

function displayFixtureIdentities(events: LiveCatalogResponse["events"]): Map<string, string | null> {
  const identities = new Map<string, string | null>();
  for (const event of events) {
    // Scores, phase and fixture metadata invalidate old terms; clock ticks do not.
    const liveState = event.liveState === null ? null
      : Object.fromEntries(Object.entries(event.liveState).filter(([key]) => key !== "clockMs"));
    identities.set(event.providerEventId, identities.has(event.providerEventId) ? null
      : JSON.stringify({ ...event, liveState }));
  }
  return identities;
}

function completeDisplayCatalog(catalog: LiveCatalogResponse,
  previous?: LiveCatalogResponse,
  historicalMarkets?: Set<LiveCatalogResponse["markets"][number]>): LiveCatalogResponse {
  type Market = (typeof catalog.markets)[number];
  type Quote = (typeof catalog.quotes)[number];
  const quotesByMarket = new Map<string, Quote[]>();
  for (const quote of catalog.quotes) {
    const key = marketIdentity(quote);
    const values = quotesByMarket.get(key) ?? [];
    values.push(quote);
    quotesByMarket.set(key, values);
  }
  const candidates = new Set<Market>();
  const candidateIds = new Map<string, Set<string>>();
  for (const market of catalog.markets) {
    const key = marketIdentity(market);
    const currentQuotes = quotesByMarket.get(key) ?? [];
    const expected = exactTwoWayOutcomeDomain(market.marketType, market.scope, market.line);
    // Unresolved player names/teams and conflicting native quote subjects can
    // never pass comparison binding. Keep their current inventory unchanged:
    // dropping them creates a needless second full comparison every revision,
    // while falling back could resurrect a different or unproven player.
    const unpairablePlayer = market.marketType.startsWith("PLAYER_") &&
      (playerComparisonKey(market.player) === null || currentQuotes.some(quote => !sameNativePlayer(market.player, quote.player)));
    // An explicit withdrawal must replace the retained OPEN price immediately.
    // Only an incomplete receipt can borrow the last complete display ticket.
    if (market.status !== "OPEN" || currentQuotes.some(quote => quote.status !== "OPEN") ||
      expected === null || unpairablePlayer ||
      isAvailableTwoWayTicket({ provider: catalog.provider, market, quotes: currentQuotes })) continue;
    candidates.add(market);
    const ids = candidateIds.get(market.providerEventId) ?? new Set<string>();
    ids.add(market.providerMarketId); candidateIds.set(market.providerEventId, ids);
  }
  // The common case needs neither a prior-catalog index nor replacement arrays.
  if (candidates.size === 0) return catalog;
  const currentFixtures = displayFixtureIdentities(catalog.events);
  const previousFixtures = displayFixtureIdentities(previous?.events ?? []);
  const isCandidate = (item: Market | Quote): boolean =>
    candidateIds.get(item.providerEventId)?.has(item.providerMarketId) === true;
  const previousMarkets = new Map<string, Market>();
  for (const market of previous?.markets ?? []) {
    if (isCandidate(market)) previousMarkets.set(marketIdentity(market), market);
  }
  const previousQuotes = new Map<string, Quote[]>();
  for (const quote of previous?.quotes ?? []) {
    if (!isCandidate(quote)) continue;
    const key = marketIdentity(quote);
    const values = previousQuotes.get(key) ?? [];
    values.push(quote);
    previousQuotes.set(key, values);
  }
  const markets: Market[] = [];
  const quotes: Quote[] = [];
  for (const market of catalog.markets) {
    const key = marketIdentity(market);
    const currentQuotes = quotesByMarket.get(key) ?? [];
    if (!candidates.has(market)) {
      markets.push(market);
      quotes.push(...currentQuotes);
      continue;
    }
    const previousMarket = previousMarkets.get(key);
    const lastCompleteQuotes = previousQuotes.get(key) ?? [];
    const fixture = currentFixtures.get(market.providerEventId);
    const sameTicket = fixture !== undefined && fixture !== null &&
      fixture === previousFixtures.get(market.providerEventId) &&
      previousMarket !== undefined && previousMarket.marketType === market.marketType &&
      previousMarket.scope === market.scope && previousMarket.line === market.line &&
      previousMarket.settlementProfile === market.settlementProfile &&
      (market.marketType.startsWith("PLAYER_") || previousMarket.player !== undefined || market.player !== undefined
        ? sameNativePlayer(previousMarket.player, market.player) : true) &&
      currentQuotes.every(quote => lastCompleteQuotes.some(prior =>
        prior.providerSelectionId === quote.providerSelectionId && prior.selection === quote.selection &&
        prior.marketType === quote.marketType && prior.scope === quote.scope && prior.line === quote.line &&
        prior.rawFormat === quote.rawFormat && prior.isLive === quote.isLive)) &&
      currentQuotes.every(quote => market.marketType.startsWith("PLAYER_")
        ? sameNativePlayer(market.player, quote.player) : quote.player === undefined);
    if (sameTicket && isFocusedTwoWayTicket({ provider: catalog.provider,
      market: previousMarket, quotes: lastCompleteQuotes })) {
      markets.push(previousMarket);
      quotes.push(...lastCompleteQuotes);
      historicalMarkets?.add(previousMarket);
    }
  }
  return { ...catalog, markets, quotes };
}
