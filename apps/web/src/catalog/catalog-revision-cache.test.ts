import { describe, expect, it, vi } from "vitest";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { CatalogRevisionCache } from "./catalog-revision-cache.js";

const catalog: LiveCatalogResponse = { dataMode: "LIVE", accountId: "source", provider: "BTI",
  category: "FOOTBALL", comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 100,
  rejectedMarketCount: 0, events: [], markets: [], quotes: [] };
const quote: LiveCatalogResponse["quotes"][number] = { provider: "BTI", category: "FOOTBALL",
  providerEventId: "event", providerMarketId: "market", providerSelectionId: "selection",
  marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "-0.5",
  rawOdds: "1.8", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
  sequence: 1, receivedMonotonicMs: 50, sourceTimestampMs: 50 };
const observation: NonNullable<LiveCatalogResponse["nativeMarketObservations"]>[number] = {
  provider: "BTI", category: "FOOTBALL", providerEventId: "event", providerMarketId: "market",
  nativeType: "AH", nativeLabel: null, nativeScope: null, outcomeLabels: [],
  observedAtMs: 50, disposition: "NORMALIZED", reason: "SUPPORTED" };

describe("catalog revisions already supplied by the API", () => {
  it("retains native count changes even when quote prices and observation time are unchanged", () => {
    const revisions = new CatalogRevisionCache();
    const old = { ...catalog, nativeCoverageByEvent: [
      { providerEventId: "event", normalized: 1, excluded: 2, unmapped: 3 }
    ] };
    const next = { ...old, nativeCoverageByEvent: [
      { providerEventId: "event", normalized: 2, excluded: 2, unmapped: 2 }
    ] };
    expect(revisions.get(old)).not.toBe(revisions.get(next));
    revisions.remember(old, "same-prices");
    revisions.remember(next, "same-prices");
    expect(revisions.same(old, next)).toBe(false);
    const same = { ...old, nativeCoverageByEvent: old.nativeCoverageByEvent.map((item) => ({ ...item })) };
    revisions.remember(same, "same-prices");
    expect(revisions.same(old, same)).toBe(true);
  });

  it("does not suppress a newly available empty native inventory", () => {
    const revisions = new CatalogRevisionCache();
    const next = { ...catalog, nativeCoverageByEvent: [] };
    revisions.remember(catalog, "same-prices");
    revisions.remember(next, "same-prices");
    expect(revisions.same(catalog, next)).toBe(false);
  });

  it("retains refreshed observation time when the semantic revision is unchanged", () => {
    const revisions = new CatalogRevisionCache();
    const next = { ...catalog, observedAtMs: 200 };
    revisions.remember(catalog, "same-prices");
    revisions.remember(next, "same-prices");
    expect(revisions.same(catalog, next)).toBe(false);
  });

  it("retains anchor-only changes at equal wall time and semantic revision", () => {
    const revisions = new CatalogRevisionCache();
    const old = { ...catalog, observedMonotonicMs: 1_000 };
    const next = { ...old, observedMonotonicMs: 2_000 };
    expect(revisions.get(old)).not.toBe(revisions.get(next));
    revisions.remember(old, "same-prices");
    revisions.remember(next, "same-prices");
    revisions.remember(catalog, "same-prices");
    expect(revisions.same(old, next)).toBe(false);
    expect(revisions.same(catalog, old)).toBe(false);
    const same = { ...old };
    revisions.remember(same, "same-prices");
    expect(revisions.same(old, same)).toBe(true);
  });

  it("does not equate different quote evidence at the same catalog time", () => {
    const revisions = new CatalogRevisionCache();
    const old = { ...catalog, quotes: [quote] };
    const next = { ...old, quotes: [{ ...quote, sequence: 2, sourceTimestampMs: 60 }] };
    revisions.remember(old, "same-prices");
    revisions.remember(next, "same-prices");
    expect(revisions.same(old, next)).toBe(false);
    expect(revisions.same(next, old)).toBe(false);
  });

  it("retains native observation clock changes excluded from the semantic revision", () => {
    const revisions = new CatalogRevisionCache();
    const old = { ...catalog, nativeMarketObservations: [observation] };
    const next = { ...old, nativeMarketObservations: [{ ...observation, observedAtMs: 60 }] };
    revisions.remember(old, "same-prices");
    revisions.remember(next, "same-prices");
    expect(revisions.same(old, next)).toBe(false);
  });

  it("compares remembered revisions without walking the catalogs again", () => {
    const compute = vi.fn(() => "fallback");
    const revisions = new CatalogRevisionCache(compute);
    const next = { ...catalog, observedAtMs: 200 };
    revisions.remember(catalog, "revision-1");
    revisions.remember(next, "revision-2");
    expect(revisions.get(catalog)).toBe("revision-1");
    expect(revisions.get(next)).toBe("revision-2");
    expect(compute).not.toHaveBeenCalled();
  });

  it("recognizes equal server snapshots and retains the same-object 304 fast path", () => {
    const compute = vi.fn(() => "fallback");
    const revisions = new CatalogRevisionCache(compute);
    const old = { ...catalog, quotes: [quote], nativeMarketObservations: [observation] };
    const same = { ...old, quotes: [{ ...quote }], nativeMarketObservations: [{ ...observation }] };
    revisions.remember(old, "same-prices");
    revisions.remember(same, "same-prices");
    expect(revisions.same(old, same)).toBe(true);
    expect(revisions.same(old, old)).toBe(true);
    expect(compute).not.toHaveBeenCalled();
  });

  it("computes a legacy or restored catalog once and keeps distinct snapshots separate", () => {
    const compute = vi.fn((value: LiveCatalogResponse) => String(value.observedAtMs));
    const revisions = new CatalogRevisionCache(compute);
    const next = { ...catalog, observedAtMs: 200 };
    expect(revisions.get(catalog)).toBe("100");
    expect(revisions.get(catalog)).toBe("100");
    expect(revisions.get(next)).toBe("200");
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
