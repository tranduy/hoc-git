import type { LiveCatalogResponse } from "../api/catalog.js";

function legacyRevision(catalog: LiveCatalogResponse): string {
  const events = catalog.events.map((event) => [event.providerEventId, event.startAtUtcMs, event.isLive,
    event.participantA, event.participantB].join(":"));
  const markets = catalog.markets.map((market) => [market.providerMarketId, market.status, market.line].join(":"));
  const quotes = catalog.quotes.map((quote) => [quote.providerMarketId, quote.providerSelectionId, quote.rawOdds,
    quote.status, quote.sequence, quote.sourceTimestampMs].join(":"));
  const observations = (catalog.nativeMarketObservations ?? []).map((observation) => [observation.providerMarketId,
    observation.nativeType, observation.disposition, observation.reason, observation.observedAtMs].join(":"));
  const coverage = catalog.nativeCoverageByEvent === undefined ? [] : ["native-coverage",
    ...catalog.nativeCoverageByEvent.map((item) => JSON.stringify([
      item.providerEventId, item.normalized, item.excluded, item.unmapped
    ]))];
  return [catalog.observedAtMs, catalog.snapshotState ?? "FRESH", catalog.rejectedMarketCount,
    ...(catalog.observedMonotonicMs === undefined ? [] : [`receipt:${catalog.observedMonotonicMs}`]),
    ...events, ...markets, ...quotes, ...observations, ...coverage].join("|");
}

export class CatalogRevisionCache {
  readonly #revisions = new WeakMap<LiveCatalogResponse, string>();
  constructor(private readonly compute = legacyRevision) {}
  remember(catalog: LiveCatalogResponse, revision: string): void { this.#revisions.set(catalog, revision); }
  same(left: LiveCatalogResponse, right: LiveCatalogResponse): boolean {
    if (left === right) return true;
    if (left.observedAtMs !== right.observedAtMs || left.observedMonotonicMs !== right.observedMonotonicMs ||
      (left.snapshotState ?? "FRESH") !== (right.snapshotState ?? "FRESH") ||
      left.rejectedMarketCount !== right.rejectedMarketCount || this.get(left) !== this.get(right)) return false;
    // Server revisions omit receipt clocks. At an equal catalog time, retain
    // the old admission rule for overlapping reads without allocating strings
    // for every quote. Newer snapshots and cached 304 bodies exit above.
    if (left.quotes.length !== right.quotes.length) return false;
    for (let index = 0; index < left.quotes.length; index += 1) {
      const previous = left.quotes[index]!;
      const next = right.quotes[index]!;
      if (previous.sequence !== next.sequence || previous.sourceTimestampMs !== next.sourceTimestampMs) return false;
    }
    const leftObservations = left.nativeMarketObservations ?? [];
    const rightObservations = right.nativeMarketObservations ?? [];
    if (leftObservations.length !== rightObservations.length) return false;
    for (let index = 0; index < leftObservations.length; index += 1) {
      if (leftObservations[index]!.observedAtMs !== rightObservations[index]!.observedAtMs) return false;
    }
    const leftCoverage = left.nativeCoverageByEvent;
    const rightCoverage = right.nativeCoverageByEvent;
    if (leftCoverage === undefined || rightCoverage === undefined) return leftCoverage === rightCoverage;
    if (leftCoverage.length !== rightCoverage.length) return false;
    for (let index = 0; index < leftCoverage.length; index += 1) {
      const previous = leftCoverage[index]!;
      const next = rightCoverage[index]!;
      if (previous.providerEventId !== next.providerEventId || previous.normalized !== next.normalized ||
        previous.excluded !== next.excluded || previous.unmapped !== next.unmapped) return false;
    }
    return true;
  }
  get(catalog: LiveCatalogResponse): string {
    const known = this.#revisions.get(catalog);
    if (known !== undefined) return known;
    const revision = this.compute(catalog);
    this.#revisions.set(catalog, revision);
    return revision;
  }
}
