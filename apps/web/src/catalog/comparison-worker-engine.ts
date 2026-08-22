import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents, exactTwoWayOutcomeDomain, isFocusedTwoWayTicket,
  type ComparisonEvent } from "./comparison.js";
import type { ComparisonProjection, ComparisonWorkerCommand, ComparisonWorkerOutput } from "./comparison-worker-protocol.js";

function project(event: ComparisonEvent): ComparisonProjection {
  const { catalogs, ...comparison } = event;
  return { ...comparison, accountIds: catalogs.map((catalog) => catalog.accountId) };
}

export class ComparisonWorkerEngine {
  readonly #catalogs = new Map<string, LiveCatalogResponse>();
  readonly #displayCatalogs = new Map<string, LiveCatalogResponse>();
  readonly #stale = new Set<string>();

  apply(command: ComparisonWorkerCommand): ComparisonWorkerOutput {
    if (command.type === "RESET") {
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
    return { generation: command.generation,
      displayEvents: buildComparisonEvents([...this.#displayCatalogs.values()]).map(project),
      freshEvents: buildComparisonEvents(catalogs.filter((catalog) => !this.#stale.has(catalog.accountId))).map(project) };
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
