import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { CatalogRevisionEntry } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { CatalogRevisionStore } from "./catalog-revision-store.js";

const stores: CatalogRevisionStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function catalog(observedAtMs: number, accountId = "catalog-source:SABA:FOOTBALL"): ObservedProviderCatalog {
  return {
    dataMode: "LIVE", accountId, provider: "SABA", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs,
    rejectedMarketCount: 0, events: [], markets: [], quotes: []
  };
}

function pricedCatalog(observedAtMs: number, receivedMonotonicMs: number,
  sequence: number, provider: "SABA" | "APSPORT" = "SABA"): ObservedProviderCatalog {
  return {
    ...catalog(observedAtMs, `catalog-source:${provider}:FOOTBALL`), provider,
    quotes: [{
      provider, category: "FOOTBALL", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5",
      rawOdds: "0.95", rawFormat: "MALAY", status: "OPEN", isLive: true,
      sourceTimestampMs: null, receivedMonotonicMs, sequence
    }]
  };
}

describe("CatalogRevisionStore", () => {
  it("reuses unchanged immutable blocks without serializing every AP quote again", () => {
    const store = new CatalogRevisionStore({ now: () => 100 }); stores.push(store);
    const base = pricedCatalog(100, 10, 1, "APSPORT");
    let reads = 0;
    const quotes = Array.from({ length: 257 }, (_, index) => ({ ...base.quotes[0]!,
      providerSelectionId: `selection-${index}`, get rawOdds() { reads += 1; return "0.95"; } }));
    const first = { ...base, quotes };
    const publish = (value: ObservedProviderCatalog) => store.publish(value.accountId, value,
      { snapshotState: "FRESH", freshnessMs: 20 });
    const before = publish(first);
    expect(reads).toBe(257);
    const renewed = publish({ ...first, observedAtMs: 101, quotes: [...quotes] });
    expect(renewed.revision).toBe(before.revision);
    expect(reads).toBe(257);
    const nextQuotes = [...quotes];
    nextQuotes[129] = { ...base.quotes[0]!, providerSelectionId: "selection-129", rawOdds: "0.50" };
    const replacement = { ...first, observedAtMs: 102, quotes: nextQuotes };
    const changed = publish(replacement);
    expect(changed.revision).not.toBe(before.revision);
    expect(reads).toBe(257 + 127);
    const cold = new CatalogRevisionStore({ now: () => 100 }); stores.push(cold);
    expect(changed.revision).toBe(cold.publish(replacement.accountId, replacement,
      { snapshotState: "FRESH", freshnessMs: 20 }).revision);
  });

  it("coalesces a burst per account and exposes the latest catalog immediately to reads", () => {
    vi.useFakeTimers();
    try {
      const store = new CatalogRevisionStore(); stores.push(store);
      const publish = vi.fn(); store.subscribe(publish);
      const first = pricedCatalog(100, 10, 1);
      store.publishCoalesced(first.accountId, first, { snapshotState: "FRESH", freshnessMs: 1000 });
      publish.mockClear();
      let latest = first;
      for (let index = 1; index <= 100; index++) {
        latest = { ...pricedCatalog(100 + index, 10 + index, 1 + index),
          quotes: [{ ...first.quotes[0]!, rawOdds: String(index / 100) }] };
        store.publishCoalesced(first.accountId, latest, { snapshotState: "FRESH", freshnessMs: 1000 });
      }
      expect(publish).not.toHaveBeenCalled();
      expect(store.get(first.accountId)!.catalog).toBe(latest);
      expect(publish).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(20);
      expect(publish).toHaveBeenCalledTimes(1);
    } finally { stores.splice(0).forEach(store => store.close()); vi.useRealTimers(); }
  });

  it("cancels buffered freshness immediately on invalidation and on close", () => {
    vi.useFakeTimers();
    try {
      const store = new CatalogRevisionStore(); stores.push(store);
      const first = pricedCatalog(100, 10, 1), latest = pricedCatalog(200, 20, 2);
      store.publishCoalesced(first.accountId, first, { snapshotState: "FRESH", freshnessMs: 1000 });
      store.publishCoalesced(first.accountId, latest, { snapshotState: "FRESH", freshnessMs: 1000 });
      store.publishCoalesced(first.accountId, first, { snapshotState: "STALE", freshnessMs: 1000 });
      vi.advanceTimersByTime(20);
      expect(store.get(first.accountId)!.snapshotState).toBe("STALE");
      expect(store.get(first.accountId)!.catalog).toBe(latest);
      const publish = vi.fn(); store.subscribe(publish);
      store.publishCoalesced(first.accountId, pricedCatalog(300, 30, 3), { snapshotState: "FRESH", freshnessMs: 1000 });
      store.close(); vi.advanceTimersByTime(20);
      expect(publish).not.toHaveBeenCalled();
    } finally { stores.splice(0).forEach(store => store.close()); vi.useRealTimers(); }
  });

  it("does not extend the freshness deadline while a publication waits in the queue", () => {
    vi.useFakeTimers();
    try {
      let now = 1000;
      const store = new CatalogRevisionStore({ now: () => now }); stores.push(store);
      const first = pricedCatalog(100, 10, 1);
      store.publishCoalesced(first.accountId, first, { snapshotState: "FRESH", freshnessMs: 100 });
      store.publishCoalesced(first.accountId, pricedCatalog(200, 20, 2), { snapshotState: "FRESH", freshnessMs: 100 });
      now = 1200; vi.advanceTimersByTime(20);
      expect(store.get(first.accountId)!.snapshotState).toBe("STALE");
    } finally { stores.splice(0).forEach(store => store.close()); vi.useRealTimers(); }
  });

  it("publishes stale when hashing itself crosses the queued freshness deadline", () => {
    vi.useFakeTimers();
    try {
      let now = 1000;
      const store = new CatalogRevisionStore({ now: () => now }); stores.push(store);
      const first = pricedCatalog(100, 10, 1);
      store.publishCoalesced(first.accountId, first, { snapshotState: "FRESH", freshnessMs: 100 });
      const latest = { ...pricedCatalog(200, 20, 2), quotes: [{ ...first.quotes[0]!,
        get rawOdds() { now = 1200; return "0.70"; } }] };
      store.publishCoalesced(first.accountId, latest, { snapshotState: "FRESH", freshnessMs: 100 });
      vi.advanceTimersByTime(20);
      expect(store.get(first.accountId)!.snapshotState).toBe("STALE");
      expect(store.get(first.accountId)!.freshUntilMs).toBeNull();
    } finally { stores.splice(0).forEach(store => store.close()); vi.useRealTimers(); }
  });

  it("hashes large catalogs in bounded groups with deterministic v2 revision bytes", () => {
    const referenceRevision = (value: ObservedProviderCatalog, snapshotState: "FRESH" | "STALE") => {
      const { observedAtMs: _time, quotes, ...semantic } = value;
      const projected = { ...semantic,
        quotes: quotes.map(({ receivedMonotonicMs, sequence, sourceTimestampMs: _source, ...quote }) =>
          value.provider === "APSPORT" ? { ...quote, receivedMonotonicMs, sequence } : quote),
        ...(value.nativeMarketObservations === undefined ? {} : {
          nativeMarketObservations: value.nativeMarketObservations.map(({ observedAtMs: _nativeTime, ...item }) => item)
        }) };
      const digest = (record: unknown) => createHash("sha256").update(JSON.stringify(record)).digest("base64url");
      const catalog = Object.fromEntries(Object.entries(projected).map(([key, records]) => {
        if (!Array.isArray(records)) return [key, records];
        const rows = key === "nativeMarketObservations" || value.provider === "BTI" || value.provider === "SBOBET"
          ? records.map(digest) : records;
        return [key, Array.from({ length: Math.ceil(rows.length / 128) }, (_, index) =>
          digest(rows.slice(index * 128, (index + 1) * 128)))];
      }));
      return createHash("sha256").update(JSON.stringify({ revisionFormat: 3, catalog, snapshotState })).digest("base64url");
    };
    for (const provider of ["BTI", "APSPORT", "SABA", "SBOBET"] as const) {
      for (const snapshotState of ["FRESH", "STALE"] as const) {
        for (const includeNative of [false, true]) {
          const original: ObservedProviderCatalog = { ...pricedCatalog(100, 10, 1), provider,
            quotes: Array.from({ length: 513 }, (_, index) => ({ ...pricedCatalog(100, 10, 1).quotes[0]!,
              provider, providerSelectionId: `selection-${index}` })),
            ...(includeNative ? { nativeMarketObservations: Array.from({ length: 257 }, (_, index) => ({
              provider, category: "FOOTBALL" as const, providerEventId: "event", providerMarketId: `market-${index}`,
              nativeType: "unknown", nativeLabel: 'Đội bóng "A"', nativeScope: null, outcomeLabels: [],
              observedAtMs: 90, disposition: "UNMAPPED" as const, reason: "NATIVE_TYPE_UNMAPPED"
            })) } : {}) };
          // Property insertion order is part of the existing digest contract.
          for (const input of [original, Object.fromEntries(Object.entries(original).reverse()) as unknown as ObservedProviderCatalog]) {
            const expected = referenceRevision(input, snapshotState);
            const stringify = vi.spyOn(JSON, "stringify");
            const store = new CatalogRevisionStore({ now: () => 100 });
            stores.push(store);
            try {
              expect(store.publish(input.accountId, input, { snapshotState, freshnessMs: 20 }).revision).toBe(expected);
              const largestArray = (value: unknown): number => Array.isArray(value)
                ? Math.max(value.length, 0, ...value.map(largestArray))
                : value !== null && typeof value === "object" ? Math.max(0, ...Object.values(value).map(largestArray)) : 0;
              expect(Math.max(...stringify.mock.calls.map(([value]) => largestArray(value)))).toBeLessThanOrEqual(128);
            } finally { stringify.mockRestore(); }
          }
        }
      }
    }
  });

  it("reuses immutable record digests across reordered arrays and only hashes replacement records", () => {
    const store = new CatalogRevisionStore({ now: () => 100 });
    stores.push(store);
    const label = vi.fn(() => "Total");
    const first: ObservedProviderCatalog = { ...pricedCatalog(100, 10, 1), provider: "BTI",
      nativeMarketObservations: [{ provider: "BTI", category: "FOOTBALL", providerEventId: "event-1",
        providerMarketId: "market-1", nativeType: "total", get nativeLabel() { return label(); },
        nativeScope: null, outcomeLabels: ["OVER", "UNDER"], observedAtMs: 100,
        disposition: "NORMALIZED", reason: "FT_TOTAL" }],
      quotes: [0, 1].map((index) => ({ ...pricedCatalog(100, 10, 1).quotes[0]!, provider: "BTI",
        providerSelectionId: `selection-${index}` })) };
    const publish = (value: ObservedProviderCatalog) => store.publish(value.accountId, value,
      { snapshotState: "FRESH", freshnessMs: 20 });
    const initial = publish(first);
    expect(label).toHaveBeenCalledTimes(1);
    const renewed = publish({ ...first, observedAtMs: 101, quotes: [...first.quotes],
      nativeMarketObservations: [...first.nativeMarketObservations!] });
    expect(renewed.revision).toBe(initial.revision);
    expect(label).toHaveBeenCalledTimes(1);
    const reversed = publish({ ...first, observedAtMs: 102, quotes: [...first.quotes].reverse() });
    expect(reversed.revision).not.toBe(initial.revision);
    expect(label).toHaveBeenCalledTimes(1);
    const replacement = { ...first, observedAtMs: 103,
      quotes: [{ ...first.quotes[0]!, rawOdds: "0.96" }, first.quotes[1]!] };
    const changed = publish(replacement);
    expect(changed.revision).not.toBe(initial.revision);
    const cold = new CatalogRevisionStore({ now: () => 100 });
    stores.push(cold);
    expect(changed.revision).toBe(cold.publish(replacement.accountId, replacement,
      { snapshotState: "FRESH", freshnessMs: 20 }).revision);
    expect(publish({ ...replacement, observedAtMs: 104, quotes: [] }).revision).not.toBe(changed.revision);
  });

  it("publishes a fresh catalog and a new stale revision after its freshness deadline", () => {
    let now = 100;
    const store = new CatalogRevisionStore({ now: () => now });
    stores.push(store);
    const seen: CatalogRevisionEntry[] = [];
    store.subscribe((entry) => seen.push(entry));

    store.publish("catalog-source:SABA:FOOTBALL", catalog(100), {
      snapshotState: "FRESH", freshnessMs: 20
    });
    expect(store.get("catalog-source:SABA:FOOTBALL")).toMatchObject({
      observedAtMs: 100, snapshotState: "FRESH", sequence: 1
    });

    now = 121;
    store.expire();

    expect(store.get("catalog-source:SABA:FOOTBALL")).toMatchObject({
      observedAtMs: 100, snapshotState: "STALE", sequence: 2
    });
    expect(seen.map((entry) => entry.snapshotState)).toEqual(["FRESH", "STALE"]);
    expect(seen[1]?.revision).not.toBe(seen[0]?.revision);
  });

  it("deduplicates identical publications and rejects older observations", () => {
    const store = new CatalogRevisionStore({ now: () => 200 });
    stores.push(store);
    const seen: CatalogRevisionEntry[] = [];
    store.subscribe((entry) => seen.push(entry));
    const accepted = store.publish("catalog-source:SABA:FOOTBALL", catalog(200), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    expect(store.publish("catalog-source:SABA:FOOTBALL", catalog(200), {
      snapshotState: "FRESH", freshnessMs: 20
    })).toBe(accepted);
    expect(store.publish("catalog-source:SABA:FOOTBALL", catalog(199), {
      snapshotState: "FRESH", freshnessMs: 20
    })).toBe(accepted);
    expect(seen).toHaveLength(1);
  });

  it("renews freshness without broadcasting when only observation clocks advance", () => {
    let now = 100;
    const store = new CatalogRevisionStore({ now: () => now });
    stores.push(store);
    const seen: CatalogRevisionEntry[] = [];
    store.subscribe((entry) => seen.push(entry));
    const first = store.publish("catalog-source:SABA:FOOTBALL", pricedCatalog(100, 10, 1), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    now = 110;
    const renewed = store.publish("catalog-source:SABA:FOOTBALL", pricedCatalog(110, 20, 2), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    expect(renewed.revision).toBe(first.revision);
    expect(renewed.sequence).toBe(first.sequence);
    expect(renewed.catalog.observedAtMs).toBe(110);
    expect(renewed.catalog.quotes[0]).toMatchObject({ receivedMonotonicMs: 20, sequence: 2 });
    expect(renewed.freshUntilMs).toBe(130);
    expect(seen).toHaveLength(1);
  });

  it("detects replacement native selections and quote status while reusing other records", () => {
    const store = new CatalogRevisionStore({ now: () => 100 });
    stores.push(store);
    const original: ObservedProviderCatalog = { ...pricedCatalog(100, 10, 1), provider: "BTI",
      nativeMarketObservations: [{ provider: "BTI", category: "FOOTBALL", providerEventId: "event-1",
        providerMarketId: "market-1", nativeType: "total", nativeLabel: "Total", nativeScope: null,
        outcomeLabels: ["OVER", "UNDER"], observedAtMs: 100, disposition: "NORMALIZED", reason: "FT_TOTAL",
        nativeSelections: [{ selectionId: "over", outcomeId: "over", line: "2.5", price: "0.95" }] }] };
    const publish = (value: ObservedProviderCatalog) => store.publish(value.accountId, value,
      { snapshotState: "FRESH", freshnessMs: 20 }).revision;
    const first = publish(original);
    const nativeChanged = { ...original, observedAtMs: 101, nativeMarketObservations: [{
      ...original.nativeMarketObservations![0]!,
      nativeSelections: [{ selectionId: "over", outcomeId: "over", line: "2.5", price: "0.96" }]
    }] };
    expect(publish(nativeChanged)).not.toBe(first);
    expect(publish({ ...original, observedAtMs: 102,
      quotes: [{ ...original.quotes[0]!, status: "SUSPENDED" }] })).not.toBe(first);
  });

  it("uses cached stale revisions without traversing the expired catalog again", () => {
    let now = 100;
    const store = new CatalogRevisionStore({ now: () => now });
    stores.push(store);
    const input = pricedCatalog(100, 10, 1, "APSPORT");
    const first = store.publish(input.accountId, input, { snapshotState: "FRESH", freshnessMs: 20 });
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      now = 121;
      store.expire();
      expect(stringify).not.toHaveBeenCalled();
      expect(store.get(input.accountId)?.revision).not.toBe(first.revision);
      expect(store.get(input.accountId)?.snapshotState).toBe("STALE");
    } finally { stringify.mockRestore(); }
  });

  it("does not revise a catalog when only native-market observation clocks advance", () => {
    const store = new CatalogRevisionStore({ now: () => 200 });
    stores.push(store);
    const observed = (observedAtMs: number): ObservedProviderCatalog => ({
      ...catalog(observedAtMs),
      nativeMarketObservations: [{
        provider: "SABA", category: "FOOTBALL", providerEventId: "event-1", providerMarketId: "market-1",
        nativeType: "o", nativeScope: "FULL_TIME", nativeLabel: "FT_TOTAL",
        outcomeLabels: ["OVER", "UNDER"], observedAtMs,
        disposition: "NORMALIZED", reason: "FT_TOTAL"
      }]
    });
    const first = store.publish("catalog-source:SABA:FOOTBALL", observed(100), {
      snapshotState: "FRESH", freshnessMs: 20
    });
    const renewed = store.publish("catalog-source:SABA:FOOTBALL", observed(110), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    expect(renewed.revision).toBe(first.revision);
    expect(renewed.sequence).toBe(first.sequence);
  });

  it("broadcasts APSPORT receipt confirmations so per-quote freshness reaches clients", () => {
    let now = 100;
    const store = new CatalogRevisionStore({ now: () => now });
    stores.push(store);
    const seen: CatalogRevisionEntry[] = [];
    store.subscribe((entry) => seen.push(entry));
    const first = store.publish("catalog-source:APSPORT:FOOTBALL", pricedCatalog(100, 10, 1, "APSPORT"), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    now = 110;
    const confirmed = store.publish("catalog-source:APSPORT:FOOTBALL", pricedCatalog(110, 20, 2, "APSPORT"), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    expect(confirmed.revision).not.toBe(first.revision);
    expect(confirmed.sequence).toBe(first.sequence + 1);
    expect(seen).toHaveLength(2);
    expect(confirmed.catalog.quotes[0]).toMatchObject({ receivedMonotonicMs: 20, sequence: 2 });
  });

  it("keeps one latest catalog per account and returns a sorted baseline", () => {
    const store = new CatalogRevisionStore({ now: () => 300 });
    stores.push(store);
    store.publish("catalog-source:SBOBET:FOOTBALL", catalog(299, "catalog-source:SBOBET:FOOTBALL"), {
      snapshotState: "FRESH", freshnessMs: 20
    });
    store.publish("catalog-source:SABA:FOOTBALL", catalog(300), {
      snapshotState: "FRESH", freshnessMs: 20
    });
    store.publish("catalog-source:SABA:FOOTBALL", catalog(301), {
      snapshotState: "FRESH", freshnessMs: 20
    });

    expect(store.baseline()).toMatchObject({
      sequence: 2,
      entries: [
        { accountId: "catalog-source:SABA:FOOTBALL", observedAtMs: 301 },
        { accountId: "catalog-source:SBOBET:FOOTBALL", observedAtMs: 299 }
      ]
    });
  });

  it("unsubscribes listeners and closes without later expiry publication", () => {
    let now = 400;
    const store = new CatalogRevisionStore({ now: () => now });
    stores.push(store);
    const seen: CatalogRevisionEntry[] = [];
    const unsubscribe = store.subscribe((entry) => seen.push(entry));
    store.publish("catalog-source:SABA:FOOTBALL", catalog(400), {
      snapshotState: "FRESH", freshnessMs: 20
    });
    unsubscribe();
    store.close();
    now = 421;
    store.expire();
    expect(seen).toHaveLength(1);
  });
});


it("retains semantic revision when a non-AP paired receipt anchor advances", () => {
  const store = new CatalogRevisionStore({ now: () => 120 }); stores.push(store);
  const before = { ...pricedCatalog(100, 10, 1), observedMonotonicMs: 10 };
  const first = store.publish(before.accountId, before, { snapshotState: "FRESH", freshnessMs: 100 });
  const confirmed = { ...before, observedAtMs: 110, observedMonotonicMs: 20 };
  const next = store.publish(before.accountId, confirmed, { snapshotState: "FRESH", freshnessMs: 100 });
  expect(next.revision).toBe(first.revision);
  expect(next.sequence).toBe(first.sequence);
  expect(next.catalog.observedMonotonicMs).toBe(20);
  expect(next.catalog.quotes).toBe(before.quotes);
});
