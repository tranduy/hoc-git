import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CatalogRevisionStore, type StoredCatalogRevision } from "../catalog/catalog-revision-store.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";

type Groups = Record<string, string[]>;
interface SourceFixture {
  readonly eventId: string; readonly leagueId: string; readonly home: string; readonly away: string;
  readonly start: string;
  readonly receipts: readonly [{ readonly observedAtMs: number; readonly groups: Groups },
    { readonly observedAtMs: number; readonly groups: Groups }];
}
const fixture = JSON.parse(readFileSync(new URL(
  "./fixtures/sbobet-more-5729104-source.fixture.json", import.meta.url), "utf8")) as SourceFixture;
const accountId = "catalog-source:SBOBET:FOOTBALL";
const sourceEpoch = "source-revision-fixture:1";
const syntheticMainMarket = "57291043001";
const stores: CatalogRevisionStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));

// Actual receipts are 242591ms apart. Only envelope clocks are compressed here:
// this tests semantic publication while the synthetic full baseline is fresh.
// It does not establish live freshness or replay authority for either capture.
const compressedWall = fixture.receipts[0].observedAtMs;
const receipt = (sequence: number) => ({ version: 1 as const, kind: "NETWORK" as const,
  lobby: "KSPORT" as const, sourceId: "chrome:KSPORT:8", sourceEpoch, tabId: 8,
  sequence, observedAtMs: compressedWall + sequence * 100, receivedMonotonicMs: 1000 + sequence * 10 });
function main(sequence: number, phase: "live" | "today", ordinal = 1, cutoff = 0): ChromeBridgeEnvelope {
  return { ...receipt(sequence), transport: "HTTP_RESPONSE", request: { hostname: "be.sb21.net",
    pathnameClass: "/api/v2/getEvent", resourceType: "Fetch", method: "GET", observerRequestId: `main-${sequence}`,
    requestFrameKey: "frame-source", requestDocumentKey: "document-source", streamId: `ksport-http:8:${ordinal}`,
    providerPartition: phase === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
    providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: cutoff },
    payload: { encoding: "UTF8", body: JSON.stringify(phase === "live" ? [] : [{ "0": Number(fixture.leagueId),
      "1": "Synthetic single-owner baseline", "2": [{ "0": fixture.start,
        "2": fixture.home, "3": fixture.away, "8": fixture.eventId, "7": {
          "3": [`2.5 0.92*5729104301h -0.98*5729104302a ${syntheticMainMarket}`]
        } }] }]) } };
}

// A runtime import exercises the real extension producer without including its
// source tree in the API TypeScript project's rootDir.
const producerUrl = new URL("../../../chrome-extension/src/sbobet-more-protocol.ts", import.meta.url);
async function more(sequence: number, sourceGroups: Groups, cutoff: number): Promise<ChromeBridgeEnvelope> {
  const producer = await import(producerUrl.href) as {
    sbobetMoreRequestFromObserved: (url: string, method: string) => {
      readonly url: string; readonly eventId: string; readonly leagueId: string;
    } | null;
    sbobetMoreBatchFromResponse: (request: unknown, body: string,
      clocks: { readonly generation: string; readonly requestStartSequence: number; readonly observedAtMs: number }) => unknown;
  };
  const url = `https://be.sb21.net/api/v2/getEventBetMore?eventId=${fixture.eventId}&oddsStyle=ma&leagueId=${fixture.leagueId}&sportId=1&sportType=1_1`;
  const request = producer.sbobetMoreRequestFromObserved(url, "GET");
  expect(request).not.toBeNull();
  const batch = producer.sbobetMoreBatchFromResponse(request, JSON.stringify(sourceGroups), {
    generation: sourceEpoch, requestStartSequence: cutoff, observedAtMs: receipt(sequence).observedAtMs
  });
  expect(batch).toMatchObject({ kind: "SBOBET_EVENT_MORE", eventId: fixture.eventId,
    leagueId: fixture.leagueId, marketContainerComplete: false, groups: sourceGroups });
  return ChromeBridgeEnvelopeSchema.parse({ ...receipt(sequence), transport: "HTTP_RESPONSE",
    request: { hostname: "be.sb21.net", pathnameClass: "/api/v2/getEventBetMore", resourceType: "Fetch", method: "GET",
      observerRequestId: `source-more-${sequence}`, requestFrameKey: "frame-source", requestDocumentKey: "document-source",
      streamId: `sbobet-more:8:${sequence}`, reconcileCutoffSequence: cutoff },
    payload: { encoding: "UTF8", body: JSON.stringify(batch) } });
}

const expected = [
  { group: "8", marketId: "18461717981000", selectionId: "57291040080000000h", first: "1.92", second: "1.91",
    marketType: "FT_ODD_EVEN", scope: "FULL_TIME", selection: "ODD" },
  { group: "8", marketId: "18461717981000", selectionId: "57291040080000000a", first: "1.76", second: "1.76",
    marketType: "FT_ODD_EVEN", scope: "FULL_TIME", selection: "EVEN" },
  { group: "9", marketId: "18461717991000", selectionId: "57291040090000000h", first: "2.13", second: "2.11",
    marketType: "FH_ODD_EVEN", scope: "FIRST_HALF", selection: "ODD" },
  { group: "9", marketId: "18461717991000", selectionId: "57291040090000000a", first: "1.61", second: "1.62",
    marketType: "FH_ODD_EVEN", scope: "FIRST_HALF", selection: "EVEN" },
  { group: "36", marketId: "184617179361000", selectionId: "57291040360000000h", first: "1.78", second: "1.71",
    marketType: "FT_BTTS", scope: "FULL_TIME", selection: "YES" },
  { group: "36", marketId: "184617179361000", selectionId: "57291040360000000a", first: "1.89", second: "1.98",
    marketType: "FT_BTTS", scope: "FULL_TIME", selection: "NO" },
  { group: "37", marketId: "184617179371000", selectionId: "57291040370000000h", first: "5.17", second: "4.85",
    marketType: "FH_BTTS", scope: "FIRST_HALF", selection: "YES" },
  { group: "37", marketId: "184617179371000", selectionId: "57291040370000000a", first: "1.12", second: "1.13",
    marketType: "FH_BTTS", scope: "FIRST_HALF", selection: "NO" },
] as const;

describe("actual SBOBET More prices through semantic catalog publication", () => {
  it("publishes changed hidden source odds, suppresses identical revisions, and preserves retained quote clocks", async () => {
    expect(fixture.receipts[1].observedAtMs - fixture.receipts[0].observedAtMs).toBe(242591);
    const now = () => compressedWall + 1000;
    const revisions = new CatalogRevisionStore({ now }); stores.push(revisions);
    const notifications: StoredCatalogRevision[] = [];
    revisions.subscribe(entry => notifications.push(entry));
    const rejected: Array<{ readonly sequence: number; readonly reason: string }> = [];
    // Uses the default production router, including KsportWsCatalogAdapter.
    const plane = new ChromeCatalogDataPlane({ now, publish: (catalog, snapshotState) => {
      revisions.publish(catalog.accountId, catalog, { snapshotState,
        freshnessMs: providerFeedPolicies.get(catalog.accountId)!.catalogFreshnessMs });
    }, onIngestRejected: (envelope, reason) => rejected.push({ sequence: envelope.sequence, reason }) });
    const ingest = (envelope: ChromeBridgeEnvelope) => plane.ingest(ChromeBridgeEnvelopeSchema.parse(envelope),
      { connectionGeneration: 1 });
    expect(ingest(main(1, "live"))).toBe(false);
    expect(ingest(main(2, "today"))).toBe(true);
    const baseline = revisions.get(accountId)!;
    const originalMainQuotes = baseline.catalog.quotes.filter(quote => quote.providerMarketId === syntheticMainMarket);
    expect(originalMainQuotes).toHaveLength(2);

    expect(ingest(await more(3, fixture.receipts[0].groups, 2))).toBe(true);
    const first = revisions.get(accountId)!;
    for (const item of expected) {
      expect(first.catalog.quotes).toContainEqual(expect.objectContaining({ providerEventId: fixture.eventId,
        providerMarketId: item.marketId, providerSelectionId: item.selectionId, rawOdds: item.first, rawFormat: "DECIMAL",
        marketType: item.marketType, scope: item.scope, selection: item.selection, line: null,
        receivedMonotonicMs: receipt(3).receivedMonotonicMs, sequence: 3 }));
    }
    expect(ingest(await more(4, fixture.receipts[1].groups, 3))).toBe(true);
    const second = revisions.get(accountId)!;
    expect(second.revision).not.toBe(first.revision);
    expect(second.sequence).toBe(first.sequence + 1);
    for (const item of expected) {
      expect(second.catalog.quotes).toContainEqual(expect.objectContaining({ providerEventId: fixture.eventId,
        providerMarketId: item.marketId, providerSelectionId: item.selectionId, rawOdds: item.second, rawFormat: "DECIMAL",
        marketType: item.marketType, scope: item.scope, selection: item.selection, line: null,
        receivedMonotonicMs: receipt(4).receivedMonotonicMs, sequence: 4 }));
      expect(second.catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
        providerMarketId: item.marketId, nativeType: item.group, disposition: "NORMALIZED" }));
    }
    expect(second.catalog.quotes.filter(quote => quote.providerMarketId === syntheticMainMarket)).toEqual(originalMainQuotes);
    expect(await plane.read(accountId)).toEqual(second.catalog);
    expect(notifications).toHaveLength(3);

    expect(ingest(await more(5, fixture.receipts[1].groups, 4))).toBe(true);
    const identical = revisions.get(accountId)!;
    expect(identical.revision).toBe(second.revision);
    expect(identical.sequence).toBe(second.sequence);
    expect(notifications).toHaveLength(3);
    const hidden = identical.catalog.quotes.filter(quote => expected.some(item => item.selectionId === quote.providerSelectionId));
    expect(hidden).toHaveLength(expected.length);
    expect(hidden.every(quote => quote.sequence === 5 && quote.receivedMonotonicMs === receipt(5).receivedMonotonicMs)).toBe(true);
    expect(identical.catalog.quotes.filter(quote => quote.providerMarketId === syntheticMainMarket)).toEqual(originalMainQuotes);

    expect(ingest(main(6, "live", 2, 5))).toBe(false);
    expect(ingest(main(7, "today", 2, 5))).toBe(true);
    const shallow = revisions.get(accountId)!;
    expect(shallow.catalog.quotes.filter(quote => expected.some(item => item.selectionId === quote.providerSelectionId))).toEqual(hidden);
    expect(shallow.revision).toBe(identical.revision);
    expect(notifications).toHaveLength(3);
    expect(await plane.read(accountId)).toEqual(shallow.catalog);
    expect(rejected.filter(item => [3, 4, 5, 7].includes(item.sequence))).toEqual([]);
  });
});
