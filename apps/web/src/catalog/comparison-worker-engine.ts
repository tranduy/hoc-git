import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, createCompetitionLinkMemory, exactTwoWayOutcomeDomain,
  isFocusedTwoWayTicket, type ComparisonEvent } from "./comparison.js";
import type { ComparisonProjection, ComparisonWorkerCommand, ComparisonWorkerOutput } from "./comparison-worker-protocol.js";

function project(event: ComparisonEvent): ComparisonProjection {
  const { catalogs, ...comparison } = event;
  return { ...comparison, accountIds: catalogs.map((catalog) => catalog.accountId) };
}

export class ComparisonWorkerEngine {
  readonly #catalogs = new Map<string, LiveCatalogResponse>();
  readonly #displayCatalogs = new Map<string, LiveCatalogResponse>();
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
      this.#stale.clear();
      for (const catalog of command.catalogs) {
        this.#catalogs.set(catalog.accountId, catalog);
        if (isAtomicComparisonCatalog(catalog)) this.#displayCatalogs.set(catalog.accountId, catalog);
      }
      for (const accountId of command.staleAccountIds) this.#stale.add(accountId);
    } else if (command.type === "UPSERT") {
      this.#catalogs.set(command.catalog.accountId, command.catalog);
      if (isAtomicComparisonCatalog(command.catalog)) {
        this.#displayCatalogs.set(command.catalog.accountId, command.catalog);
      }
      if (command.stale) this.#stale.add(command.catalog.accountId);
      else this.#stale.delete(command.catalog.accountId);
    } else if (command.type === "SET_STALE") {
      if (command.stale) this.#stale.add(command.accountId);
      else this.#stale.delete(command.accountId);
    } else {
      this.#catalogs.delete(command.accountId);
      this.#displayCatalogs.delete(command.accountId);
      this.#stale.delete(command.accountId);
    }
    const catalogs = [...this.#catalogs.values()];
    const output = { generation: command.generation,
      displayEvents: buildComparisonEvents([...this.#displayCatalogs.values()],
        this.#competitionMemory).map(project),
      freshEvents: buildComparisonEvents(catalogs.filter((catalog) =>
        !this.#stale.has(catalog.accountId)), this.#competitionMemory).map(project) };
    // Sent only when the proven set grows, because it rides on every catalog
    // update and most of them prove nothing new.
    const confirmed = this.#competitionMemory.confirmed();
    if (confirmed.length === this.#confirmedCount) return output;
    this.#confirmedCount = confirmed.length;
    return { ...output, competitionLinks: confirmed };
  }
}

function isAtomicComparisonCatalog(catalog: LiveCatalogResponse): boolean {
  const quotesByMarket = new Map<string, typeof catalog.quotes>();
  for (const quote of catalog.quotes) {
    quotesByMarket.set(quote.providerMarketId, [...(quotesByMarket.get(quote.providerMarketId) ?? []), quote]);
  }
  for (const market of catalog.markets) {
    const expected = exactTwoWayOutcomeDomain(market.marketType, market.scope, market.line);
    if (market.status !== "OPEN" || expected === null) continue;
    const quotes = quotesByMarket.get(market.providerMarketId) ?? [];
    if (!isFocusedTwoWayTicket({ provider: catalog.provider, market, quotes })) return false;
  }
  return true;
}
