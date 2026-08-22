import { afterEach, describe, expect, it } from "vitest";
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
  sequence: number): ObservedProviderCatalog {
  return {
    ...catalog(observedAtMs),
    quotes: [{
      provider: "SABA", category: "FOOTBALL", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5",
      rawOdds: "0.95", rawFormat: "MALAY", status: "OPEN", isLive: true,
      sourceTimestampMs: null, receivedMonotonicMs, sequence
    }]
  };
}

describe("CatalogRevisionStore", () => {
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
