import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export interface NativeEventCoverage {
  readonly providerEventId: string;
  normalized: number;
  excluded: number;
  unmapped: number;
}

/** Dashboard coverage needs counts, not a copy of every raw market and label. */
export function catalogWithNativeCounts(catalog: ObservedProviderCatalog):
  Omit<ObservedProviderCatalog, "nativeMarketObservations"> & {
    readonly nativeCoverageByEvent?: readonly NativeEventCoverage[];
  } {
  const { nativeMarketObservations, ...canonical } = catalog;
  if (nativeMarketObservations === undefined) return canonical;
  const byEvent = new Map<string, NativeEventCoverage>();
  for (const observation of nativeMarketObservations) {
    if (observation.provider !== catalog.provider || observation.category !== catalog.category) continue;
    let coverage = byEvent.get(observation.providerEventId);
    if (coverage === undefined) {
      coverage = { providerEventId: observation.providerEventId, normalized: 0, excluded: 0, unmapped: 0 };
      byEvent.set(observation.providerEventId, coverage);
    }
    if (observation.disposition === "NORMALIZED") coverage.normalized += 1;
    else if (observation.disposition === "EXCLUDED") coverage.excluded += 1;
    else if (observation.disposition === "UNMAPPED") coverage.unmapped += 1;
  }
  return { ...canonical, nativeCoverageByEvent: [...byEvent.values()] };
}
