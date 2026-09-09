import type { ProviderId } from "@tool-chenh/contracts";
import { resultOppositionCellPairs, binaryOpposingCellPairs, comparisonOutcomeDomain,
  observedTicketAsComparisonRow, type ComparisonCell, type ComparisonEvent } from "./comparison.js";

/** Project admitted source relationships; never infer a new event/market match. */
export function selectComparisonProviders(event: ComparisonEvent, selected: ReadonlySet<ProviderId>): ComparisonEvent {
  const providers = event.providers.filter(provider => selected.has(provider));
  if (providers.length === event.providers.length) return event;
  const rows = event.rows.flatMap(row => {
    const cells = row.cells.filter(cell => selected.has(cell.provider));
    const selectedRow = { ...row, cells };
    const pairs = row.opposition === undefined ? binaryOpposingCellPairs(cells) : resultOppositionCellPairs(selectedRow);
    if (pairs.length === 0) return [];
    return [observedTicketAsComparisonRow({ ...selectedRow,
      settlementProfile: cells[0]!.market.settlementProfile,
      outcomeDomain: comparisonOutcomeDomain(row) ?? [] })];
  });
  const margins = rows.flatMap(row => row.margin === null ? [] : [row.margin]);
  return { ...event, providers, rows,
    catalogs: event.catalogs.filter(catalog => selected.has(catalog.provider)),
    providerEventIds: Object.fromEntries(Object.entries(event.providerEventIds).filter(([provider]) => selected.has(provider as ProviderId))),
    observedRows: event.observedRows.map(row => ({ ...row, cells: row.cells.filter(cell => selected.has(cell.provider)) }))
      .filter(row => row.cells.length > 0), bestMargin: margins.length === 0 ? null : Math.max(...margins) };
}

export interface ComparisonCounts {
  readonly matchedContractCount: number;
  readonly matchedSourceMarketCount: number;
  readonly crossBookPairCount: number;
}

export function summarizeComparisonCounts(
  events: readonly Pick<ComparisonEvent, "key" | "rows">[]
): ComparisonCounts {
  const seenRows = new Set<string>();
  const sourceMarkets = new Set<string>();
  const resultSourcePairs = new Set<string>();
  let matchedContractCount = 0;
  let crossBookPairCount = 0;
  for (const event of events) {
    for (const row of event.rows) {
      if (row.opposition !== undefined || row.cells.some(cell => cell.quotes.length < 2) ||
        new Set(row.cells.map(cell => cell.provider)).size < row.cells.length) {
        const sourceKey = (cell: ComparisonCell): string => {
          const source = cell.sourceMarket ?? cell.market;
          return JSON.stringify([cell.provider, source.category, source.providerEventId, source.providerMarketId]);
        };
        const pairs = row.opposition !== undefined ? resultOppositionCellPairs(row) : binaryOpposingCellPairs(row.cells);
        if (pairs.length === 0) continue;
        const keys = [...new Set(pairs.flatMap(pair => pair.map(sourceKey)))].sort();
        const identity = JSON.stringify([row.key, keys]);
        if (seenRows.has(identity)) continue;
        seenRows.add(identity);
        matchedContractCount += 1;
        for (const pair of pairs) {
          const key = JSON.stringify(pair.map(sourceKey).sort());
          if (!resultSourcePairs.has(key)) { resultSourcePairs.add(key); crossBookPairCount += 1; }
        }
        for (const key of keys) sourceMarkets.add(key);
        continue;
      }
      const providers = new Map<ProviderId, ComparisonCell>();
      for (const cell of row.cells) {
        if (!providers.has(cell.provider)) providers.set(cell.provider, cell);
      }
      // Only rows already containing a cross-provider comparison contribute.
      if (providers.size < 2) continue;
      const sourceKeys = [...providers.values()].map((cell) => {
        const source = cell.sourceMarket ?? cell.market;
        return JSON.stringify([
          cell.provider, source.category, source.providerEventId, source.providerMarketId
        ]);
      }).sort();
      // Display keys can collide for independently gated fixture groups. Count
      // only the pairs present in each actual row; never union their providers.
      const identity = JSON.stringify([row.key, sourceKeys]);
      if (seenRows.has(identity)) continue;
      seenRows.add(identity);
      matchedContractCount += 1;
      // One unordered pair per distinct bookmaker; quote assignments are not pairs.
      crossBookPairCount += providers.size * (providers.size - 1) / 2;
      for (const sourceKey of sourceKeys) sourceMarkets.add(sourceKey);
    }
  }
  return { matchedContractCount, matchedSourceMarketCount: sourceMarkets.size, crossBookPairCount };
}
