import { afterEach, describe, expect, it } from "vitest";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CatalogRevisionStore } from "../catalog/catalog-revision-store.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";

const EPOCH = "observer-sbo:1";
const EVENT = "778899";
const GOAL = "7788993001";
const CORNER = "7788992101";
const CARD = "7788993101";
const WALL = Date.UTC(2026, 8, 8, 4);
type Groups = Record<string, string[]>;
const goal = (price = "0.92") => `2.5 ${price}*778899301h -0.98*778899302a ${GOAL}`;
const corner = (price = "0.91") => `9.5 ${price}*778899211h -0.97*778899212a ${CORNER}`;
const card = () => `3.5 0.90*778899311h -0.98*778899312a ${CARD}`;
const event = (groups: Groups) => ({ "0": "2026-09-08T15:00:00Z", "2": "Home", "3": "Away",
  "8": EVENT, "7": groups });
const base = (sequence: number) => ({ version: 1 as const, kind: "NETWORK" as const,
  lobby: "KSPORT" as const, sourceId: "chrome:KSPORT:8", sourceEpoch: EPOCH, tabId: 8,
  sequence, observedAtMs: WALL + sequence * 100, receivedMonotonicMs: 1000 + sequence * 10 });
function main(sequence: number, partition: "live" | "today", groups: Groups | null,
  ordinal = 1, cutoff = 0): ChromeBridgeEnvelope {
  return { ...base(sequence), transport: "HTTP_RESPONSE", request: { hostname: "be.sb21.net",
    pathnameClass: "/api/v2/getEvent", resourceType: "Fetch", method: "GET",
    observerRequestId: `main-${sequence}`,
    requestFrameKey: "frame-1", requestDocumentKey: "document-1",
    streamId: `ksport-http:8:${ordinal}`, providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
    providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: cutoff },
  payload: { encoding: "UTF8", body: JSON.stringify(groups === null ? [] : [{ "1": "League", "2": [event(groups)] }]) } };
}
function more(sequence: number, groups: Groups, cutoff = 2, ordinal = sequence): ChromeBridgeEnvelope {
  return { ...base(sequence), transport: "HTTP_RESPONSE", request: { hostname: "be.sb21.net",
    pathnameClass: "/api/v2/getEventBetMore", resourceType: "Fetch", method: "GET",
    observerRequestId: `more-${ordinal}`, requestFrameKey: "frame-1", requestDocumentKey: "document-1",
    streamId: `sbobet-more:8:${ordinal}`, reconcileCutoffSequence: cutoff },
  payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SBOBET_EVENT_MORE", generation: EPOCH,
    eventId: EVENT, leagueId: "481", requestStartSequence: cutoff, observedAtMs: base(sequence).observedAtMs,
    marketContainerComplete: false, groups }) } };
}
function detail(sequence: number, groups: Groups, cutoff: number): ChromeBridgeEnvelope {
  const receipt = more(sequence, groups, cutoff);
  return { ...receipt, request: { ...receipt.request, pathnameClass: "/api/v2/getEvent",
    streamId: `sbobet-detail:8:${sequence}` }, payload: { encoding: "UTF8", body: JSON.stringify({
    kind: "SBOBET_EVENT_DETAIL", generation: EPOCH, eventId: EVENT, requestStartSequence: cutoff,
    observedAtMs: receipt.observedAtMs, marketContainerComplete: true, event: event(groups) }) } };
}
function socket(sequence: number, groups: Groups, partition = "today", order = sequence): ChromeBridgeEnvelope {
  const message = `MESSAGE\ndestination:/topic/sports/1_1/${partition}/ma/event/vi\n` +
    `subscription:${partition === "today" ? "subSportBookToday" : "subSportBookLive"}\nmessage-id:socket-${order}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify(event(groups)) })}\0`;
  return { ...base(sequence), transport: "WS_FRAME", request: { hostname: "d42.sb21.net",
    pathnameClass: "/sport/433/session/websocket", resourceType: "WebSocket", streamId: "1" },
  payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}
function seed(adapter: KsportWsCatalogAdapter) {
  expect(adapter.decode(main(1, "live", null))).toEqual([]);
  expect(adapter.decode(main(2, "today", { "3": [goal()] }))).toHaveLength(1);
}
function catalog(adapter: KsportWsCatalogAdapter, input: ChromeBridgeEnvelope): ObservedProviderCatalog {
  const updates = adapter.decode(ChromeBridgeEnvelopeSchema.parse(input));
  expect(updates).toHaveLength(1);
  return updates[0]!.value as ObservedProviderCatalog;
}
function patchBody(input: ChromeBridgeEnvelope, patch: Record<string, unknown>): ChromeBridgeEnvelope {
  return { ...input, payload: { ...input.payload, body: JSON.stringify({ ...JSON.parse(input.payload.body), ...patch }) } };
}

describe("passive SBOBET More receipts", () => {
  it("adds returned identities and unknown inventory while retaining main metadata and clocks", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    const input = more(3, { "0": ["2,3,4,11,12"], "21": [corner()], "777": ["0.9*778899771h 1.1*778899772a"] });
    expect(adapter.fingerprint(input)).toBe(true);
    const update = adapter.decode(input)[0]!;
    expect(update).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP" });
    expect(update).not.toHaveProperty("authoritativeBaseline");
    expect(update).not.toHaveProperty("authoritativeEmptyMarkets");
    const value = update.value as ObservedProviderCatalog;
    expect(value.quotes).toContainEqual(expect.objectContaining({ providerMarketId: GOAL, rawOdds: "0.92",
      sequence: 2, receivedMonotonicMs: 1020 }));
    expect(value.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER, rawOdds: "0.91",
      sequence: 3, receivedMonotonicMs: 1030 }));
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "777",
      disposition: "UNMAPPED", observedAtMs: WALL + 300 }));
    expect(value.nativeMarketObservations?.some((item) => item.nativeType === "0")).toBe(false);
    expect(value.events).toHaveLength(1);
    expect(value.events[0]!.providerEventId).toBe(EVENT);
  });

  it("keeps omitted More identities, no-ops empty responses and retains hidden receipts across shallow refresh", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, more(3, { "21": [corner()], "31": [card()] }));
    const sparse = catalog(adapter, more(4, { "21": [corner("0.63")] }, 3));
    expect(sparse.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CARD, sequence: 3 }));
    const emptyResponses: Groups[] = [{}, { "0": ["2,3"] }, { "21": [] }];
    for (const groups of emptyResponses) expect(adapter.decode(more(5, groups, 4))).toEqual([]);
    adapter.decode(main(6, "live", null, 2, 4));
    const refreshed = catalog(adapter, main(7, "today", { "3": [goal("0.70")] }, 2, 4));
    expect(refreshed.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER, rawOdds: "0.63",
      sequence: 4, receivedMonotonicMs: 1040 }));
    expect(refreshed.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CARD, sequence: 3 }));
  });

  it("protects newer main prices touched by an in-flight More and retains their original receipt across omission", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, socket(3, { "21": [corner("0.60")] }));
    const hydrated = catalog(adapter, more(4, { "21": [corner()] }, 2));
    expect(hydrated.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER, rawOdds: "0.60",
      sequence: 3, receivedMonotonicMs: 1030 }));
    adapter.decode(main(5, "live", null, 2, 4));
    const refreshed = catalog(adapter, main(6, "today", { "3": [goal()] }, 2, 4));
    expect(refreshed.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER, rawOdds: "0.60", sequence: 3 }));
  });

  it("does not resurrect a newer socket withdrawal and lets later socket prices update a More identity", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, more(3, { "21": [corner()] }));
    catalog(adapter, socket(4, { "21": [corner("0")] }));
    const stale = catalog(adapter, more(5, { "21": [corner()] }, 3));
    expect(stale.quotes.some((quote) => quote.providerMarketId === CORNER)).toBe(false);
    const reopened = catalog(adapter, socket(6, { "21": [corner("0.65")] }));
    expect(reopened.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER, rawOdds: "0.65", sequence: 6 }));
  });

  it("retains a touched newer HTTP price through later main omission without promoting untouched main identities", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    adapter.decode(main(3, "live", null, 2, 2));
    catalog(adapter, main(4, "today", { "3": [goal("0.61")], "31": [card()] }, 2, 2));
    const incoming = catalog(adapter, more(5, { "3": [goal()], "21": [corner()] }, 2));
    expect(incoming.quotes).toContainEqual(expect.objectContaining({ providerMarketId: GOAL, rawOdds: "0.61",
      sequence: 4, receivedMonotonicMs: 1040 }));
    adapter.decode(main(6, "live", null, 3, 5));
    const shallow = catalog(adapter, main(7, "today", {}, 3, 5));
    expect(shallow.quotes).toContainEqual(expect.objectContaining({ providerMarketId: GOAL, rawOdds: "0.61",
      sequence: 4, receivedMonotonicMs: 1040 }));
    expect(shallow.quotes.some((quote) => quote.providerMarketId === CORNER)).toBe(true);
    expect(shallow.quotes.some((quote) => quote.providerMarketId === CARD)).toBe(false);
  });

  it("retains a newer More price against an older in-flight main pair", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    adapter.decode(main(3, "live", null, 2, 2));
    catalog(adapter, more(4, { "3": [goal("0.64")] }, 2));
    const older = catalog(adapter, main(5, "today", { "3": [goal()] }, 2, 2));
    expect(older.quotes).toContainEqual(expect.objectContaining({ providerMarketId: GOAL, rawOdds: "0.64",
      sequence: 4, receivedMonotonicMs: 1040 }));
  });

  it("preserves newer More identities when an older complete-detail request arrives", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, more(3, { "21": [corner()] }));
    const older = catalog(adapter, detail(4, { "3": [goal()] }, 2));
    expect(older.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER, sequence: 3 }));
  });

  it("replaces only a touched invalid row and preserves other native observations", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, more(3, { "21": [corner()], "31": [card()], "777": ["opaque"] }));
    const invalid = catalog(adapter, more(4, { "21": [corner("0")] }, 3));
    expect(invalid.quotes.some((quote) => quote.providerMarketId === CORNER)).toBe(false);
    expect(invalid.quotes.some((quote) => quote.providerMarketId === CARD)).toBe(true);
    expect(invalid.nativeMarketObservations).toContainEqual(expect.objectContaining({ nativeType: "777", observedAtMs: WALL + 300 }));
    expect(invalid.nativeMarketObservations).toContainEqual(expect.objectContaining({ providerMarketId: CORNER,
      disposition: "EXCLUDED", observedAtMs: WALL + 400 }));
  });

  it.each([
    { kind: "SBOBET_EVENT_DETAIL" }, { generation: "old" }, { eventId: "999" }, { leagueId: "bad" },
    { marketContainerComplete: true }, { requestStartSequence: 1 }, { observedAtMs: WALL },
    { groups: { error: [] } }, { groups: { "21": {} } }, { groups: { "21": [null] } },
    { groups: { "21": [corner().replace("778899211h", "999211h")] } },
    { groups: { "777": ["0.95*999h"] } }, { groups: { "21": [corner() + " 0.9*bad"] } },
    ...["oops1.8", "1e3", "1.2.3"].map((price) => ({ groups: { "21": [corner(price)] } }))
  ])("rejects malformed or mismatched More payload %# without mutating the catalog", (patch) => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    expect(adapter.decode(patchBody(more(3, { "21": [corner()] }), patch))).toEqual([]);
    expect(catalog(adapter, more(4, { "31": [card()] })).quotes.some((quote) => quote.providerMarketId === CORNER)).toBe(false);
  });

  it.each([
    { hostname: "evil.sb21.net" }, { method: "POST" }, { pathnameClass: "/api/v2/getEvent" },
    { streamId: "sbobet-more:9:3" }, { streamId: "sbobet-more:8:0" }, { streamId: "sbobet-more:8:03" },
    { observerRequestId: undefined }, { reconcileCutoffSequence: 3 }
  ])("rejects wrong source/request fingerprint %#", (patch) => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    const input = more(3, { "21": [corner()] });
    expect(adapter.decode({ ...input, request: { ...input.request, ...patch } })).toEqual([]);
  });

  it("rejects replay, missing authority, other epochs/tabs and request ordinals already consumed", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(more(3, { "21": [corner()] }))).toEqual([]); seed(adapter);
    const input = more(3, { "21": [corner()] });
    for (const receipt of [{ ...input, sourceEpoch: "new" }, { ...input, sourceId: "other-source" },
      { ...input, tabId: 9, request: { ...input.request, streamId: "sbobet-more:9:3" } },
      { ...input, request: { ...input.request, replayed: true } }]) expect(adapter.decode(receipt)).toEqual([]);
    catalog(adapter, input);
    expect(adapter.decode(more(4, { "21": [corner("0.60")] }, 3, 3))).toEqual([]);
    expect(adapter.decode(more(3, { "21": [corner("0.60")] }, 2, 4))).toEqual([]);
  });

  it.each(["remove", "live"])("rejects a pending request after owner %s and same-ID readmission", (retirement) => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, more(3, { "21": [corner()] }));
    adapter.decode(main(4, "live", retirement === "live" ? { "3": [goal()] } : null, 2, 3));
    catalog(adapter, main(5, "today", null, 2, 3));
    expect(adapter.decode(more(6, { "21": [corner()] }, 3))).toEqual([]);
    adapter.decode(main(7, "live", null, 3, 6));
    catalog(adapter, main(8, "today", { "3": [goal()] }, 3, 6));
    expect(adapter.decode(more(9, { "21": [corner()] }, 3))).toEqual([]);
    expect(catalog(adapter, more(10, { "21": [corner()] }, 8, 1)).quotes).toHaveLength(4);
  });
});

const stores: CatalogRevisionStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

describe("More through the real catalog data plane", () => {
  it("publishes explicit invalidation of the last retained quote without claiming More completeness", () => {
    const now = () => WALL + 1000;
    const revisions = new CatalogRevisionStore({ now }); stores.push(revisions);
    const plane = new ChromeCatalogDataPlane({ now, publish: (value, snapshotState) =>
      revisions.publish(value.accountId, value, { snapshotState, freshnessMs: 60_000 }) });
    const ingest = (receipt: ChromeBridgeEnvelope) => plane.ingest(ChromeBridgeEnvelopeSchema.parse(receipt), { connectionGeneration: 1 });
    ingest(main(1, "live", null));
    expect(ingest(main(2, "today", { "3": [goal()] }))).toBe(true);
    const previous = revisions.get("catalog-source:SBOBET:FOOTBALL")!;
    const invalid = more(3, { "3": [goal("0")] });
    expect(JSON.parse(invalid.payload.body).marketContainerComplete).toBe(false);
    expect(ingest(invalid)).toBe(true);
    const current = revisions.get(previous.accountId)!;
    expect(current.revision).not.toBe(previous.revision);
    expect(current.catalog.quotes).toEqual([]);
    expect(current.catalog.markets).toEqual([]);
    expect(current.catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: GOAL, disposition: "EXCLUDED", observedAtMs: WALL + 300 }));
    expect(ingest(more(4, {}, 3))).toBe(false);
    expect(revisions.get(previous.accountId)!.revision).toBe(current.revision);
  });

  it("publishes additive hidden prices and keeps an empty More response from changing revision", async () => {
    const now = () => WALL + 1000;
    const revisions = new CatalogRevisionStore({ now }); stores.push(revisions);
    const plane = new ChromeCatalogDataPlane({ now, publish: (value, snapshotState) =>
      revisions.publish(value.accountId, value, { snapshotState, freshnessMs: 60_000 }) });
    const ingest = (receipt: ChromeBridgeEnvelope) => plane.ingest(ChromeBridgeEnvelopeSchema.parse(receipt), { connectionGeneration: 1 });
    expect(ingest(main(1, "live", null))).toBe(false);
    expect(ingest(main(2, "today", { "3": [goal()] }))).toBe(true);
    expect(ingest(more(3, { "21": [corner()] }))).toBe(true);
    const current = revisions.get("catalog-source:SBOBET:FOOTBALL")!;
    expect(current.catalog.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER,
      rawOdds: "0.91", receivedMonotonicMs: 1030, sequence: 3 }));
    expect(ingest(more(4, {}, 3))).toBe(false);
    expect(revisions.get(current.accountId)!.revision).toBe(current.revision);
    expect(await plane.read(current.accountId)).toEqual(current.catalog);
  });
});

// Exact native group fixture from CORE-MORE-5717357-20260908.json receipt.json.
// Only native groups are retained here; no browser, endpoint, headers or account data.
const observedMoreGroups: Groups = {
  "0": [
    "2,3,4,11,12"
  ],
  "8": [
    "1.91*57173570080000000h 1.8*57173570080000000a 18485280981000 0 2 0 0 0"
  ],
  "9": [
    "2.05*57173570090000000h 1.69*57173570090000000a 18485280991000 0 3 0 0 0"
  ],
  "10": [
    "0:2 36.0*57173570100000002h 184852809101002 0 2 0 0 0",
    "0:3 100.0*57173570100000003h 184852809101003 0 2 0 0 0",
    "2:4 100.0*57173570100002004h 184852809101024 0 2 0 0 0",
    "0:4 100.0*57173570100000004h 184852809101004 0 2 0 0 0",
    "4:0 22.0*57173570100004000h 184852809101040 0 2 0 0 0",
    "4:1 23.0*57173570100004001h 184852809101041 0 2 0 0 0",
    "2:1 8.25*57173570100002001h 184852809101021 0 2 0 0 0",
    "4:4 100.0*57173570100004004h 184852809101044 0 2 0 0 0",
    "2:0 7.75*57173570100002000h 184852809101020 0 2 0 0 0",
    "0:0 14.5*57173570100000000h 184852809101000 0 2 0 0 0",
    "2:3 55.0*57173570100002003h 184852809101023 0 2 0 0 0",
    "4:2 48.5*57173570100004002h 184852809101042 0 2 0 0 0",
    "0:1 17.25*57173570100000001h 184852809101001 0 2 0 0 0",
    "2:2 15.25*57173570100002002h 184852809101022 0 2 0 0 0",
    "4:3 100.0*57173570100004003h 184852809101043 0 2 0 0 0",
    "1:4 100.0*57173570100001004h 184852809101014 0 2 0 0 0",
    "1:3 55.0*57173570100001003h 184852809101013 0 2 0 0 0",
    "3:0 11.25*57173570100003000h 184852809101030 0 2 0 0 0",
    "9:9 13.25*57173570100009009h 184852809101099 0 2 0 0 0",
    "1:0 8.0*57173570100001000h 184852809101010 0 2 0 0 0",
    "3:3 70.0*57173570100003003h 184852809101033 0 2 0 0 0",
    "3:4 100.0*57173570100003004h 184852809101034 0 2 0 0 0",
    "1:2 17.5*57173570100001002h 184852809101012 0 2 0 0 0",
    "3:1 12.0*57173570100003001h 184852809101031 0 2 0 0 0",
    "1:1 7.5*57173570100001001h 184852809101011 0 2 0 0 0",
    "3:2 25.0*57173570100003002h 184852809101032 0 2 0 0 0"
  ],
  "11": [
    "0:3 100.0*57173570110000003h 184852809111003 0 3 0 0 0",
    "3:1 55.0*57173570110003001h 184852809111031 0 3 0 0 0",
    "2:0 7.5*57173570110002000h 184852809111020 0 3 0 0 0",
    "3:0 24.0*57173570110003000h 184852809111030 0 3 0 0 0",
    "9:9 49.5*57173570110009009h 184852809111099 0 3 0 0 0",
    "0:0 2.89*57173570110000000h 184852809111000 0 3 0 0 0",
    "1:2 37.0*57173570110001002h 184852809111012 0 3 0 0 0",
    "2:3 100.0*57173570110002003h 184852809111023 0 3 0 0 0",
    "1:3 100.0*57173570110001003h 184852809111013 0 3 0 0 0",
    "0:2 34.0*57173570110000002h 184852809111002 0 3 0 0 0",
    "1:0 3.38*57173570110001000h 184852809111010 0 3 0 0 0",
    "2:1 17.25*57173570110002001h 184852809111021 0 3 0 0 0",
    "0:1 7.25*57173570110000001h 184852809111001 0 3 0 0 0",
    "1:1 7.5*57173570110001001h 184852809111011 0 3 0 0 0",
    "2:2 75.0*57173570110002002h 184852809111022 0 3 0 0 0",
    "3:2 100.0*57173570110003002h 184852809111032 0 3 0 0 0"
  ],
  "12": [
    "1.11*57173570120000000h 2.4*57173570120000000a 1.2*57173570120000000d 184852809121000 0 2 0 0 0"
  ],
  "13": [
    "1.11*57173570130000000h 1.69*57173570130000000a 1.53*57173570130000000d 184852809131000 0 3 0 0 0"
  ],
  "14": [
    "6+ 10.5*57173570140000006h 18485280914106 0 2 0 0 0",
    "4:5 3.33*57173570140004005h 184852809141045 0 2 0 0 0",
    "2:3 2.0*57173570140002003h 184852809141023 0 2 0 0 0",
    "0:1 4.5*57173570140000001h 184852809141001 0 2 0 0 0"
  ],
  "15": [
    "3+ 6.0*57173570150000003h 18485280915103 0 3 0 0 0",
    "1:1 2.63*57173570150001001h 184852809151011 0 3 0 0 0",
    "2:2 3.78*57173570150002002h 184852809151022 0 3 0 0 0",
    "0:0 3.27*57173570150000000h 184852809151000 0 3 0 0 0"
  ],
  "16": [
    "1.17*57173570160000000h 4.33*57173570160000000a 184852809161000 0 2 0 0 0"
  ],
  "17": [
    "1.29*57173570170000000h 4.23*57173570170000000a 11.25*57173570170000000d 184852809171000 0 4 0 1 0"
  ],
  "18": [
    "1.42*57173570180000000h 4.23*57173570180000000a 6.0*57173570180000000d 184852809181000 0 4 0 1 0"
  ],
  "19": [
    "2.5 0.83*57173570190002995h 0.87*57173570190002995a h 184852809191125 0 4 0 1 0"
  ],
  "20": [
    "1.25 0.87*57173570200019925h 0.84*57173570200019925a h 1848528092011125 0 4 0 1 0"
  ],
  "21": [
    "10.25 0.84*57173570210100025h 0.86*57173570210100025a 18485280921101025 0 4 0 1 0"
  ],
  "22": [
    "4.75 0.82*57173570220040075h 0.88*57173570220040075a 1848528092210475 0 4 0 1 0"
  ],
  "36": [
    "0.0 1.71*57173570360000000h 2.02*57173570360000000a 184852809361000 0 2 0 0 0"
  ],
  "37": [
    "0.0 4.5*57173570370000000h 1.16*57173570370000000a 184852809371000 0 3 0 0 0"
  ],
  "56": [
    "1.84*57173570560000000h 1.86*57173570560000000a 184852809561000 0 4 0 0 0"
  ],
  "57": [
    "1.83*57173570570000000h 1.87*57173570570000000a 184852809571000 0 4 0 0 0"
  ],
  "61": [
    "6.25 1.83*57173570610060025h 1.87*57173570610060025a 1848528096110625 0 4 0 0 0"
  ],
  "62": [
    "3.0 1.91*57173570620003000h 1.8*57173570620003000a 184852809621030 0 4 0 0 0"
  ],
  "63": [
    "3.75 1.9*57173570630030075h 1.8*57173570630030075a 1848528096310375 0 4 0 0 0"
  ],
  "64": [
    "1.75 1.93*57173570640010075h 1.78*57173570640010075a 1848528096410175 0 4 0 0 0"
  ],
  "65": [
    "2.89*57173570650000000h 2.0*57173570650000000a 3.78*57173570650000000d 184852809651000 0 2 0 0 0"
  ],
  "68": [
    "31 4.33*57173570680000031h 184852809681031 0 2 0 0 0",
    "21 28.5*57173570680000021h 184852809681021 0 2 0 0 0",
    "32 13.0*57173570680000032h 184852809681032 0 2 0 0 0",
    "11 2.15*57173570680000011h 184852809681011 0 2 0 0 0",
    "22 9.5*57173570680000022h 184852809681022 0 2 0 0 0",
    "33 6.5*57173570680000033h 184852809681033 0 2 0 0 0",
    "12 50.0*57173570680000012h 184852809681012 0 2 0 0 0",
    "23 21.0*57173570680000023h 184852809681023 0 2 0 0 0",
    "13 21.0*57173570680000013h 184852809681013 0 2 0 0 0"
  ],
  "69": [
    "2.33*57173570690000000h 1.54*57173570690000000a 184852809691000 0 2 0 0 0"
  ],
  "70": [
    "6.5*57173570700000000h 1.08*57173570700000000a 184852809701000 0 2 0 0 0"
  ],
  "71": [
    "4.12*57173570710000000h 1.19*57173570710000000a 184852809711000 0 2 0 0 0"
  ],
  "73": [
    "1.28*57173570730000000h 3.33*57173570730000000a 184852809731000 0 2 0 0 0"
  ],
  "74": [
    "3.08*57173570740000000h 1.32*57173570740000000a 184852809741000 0 2 0 0 0"
  ],
  "75": [
    "1.26*57173570750000000h 3.5*57173570750000000a 184852809751000 0 3 0 0 0"
  ],
  "76": [
    "1.88*57173570760000000h 1.82*57173570760000000a 184852809761000 0 2 0 0 0"
  ],
  "78": [
    "2.79*57173570780000000h 1.39*57173570780000000a 184852809781000 0 2 0 0 0"
  ],
  "80": [
    "1.5 1.88*57173570800001005h 1.83*57173570800001005a 184852809801015 0 11 0 0 0"
  ],
  "81": [
    "34 11.0*57173570810000034h 184852809811034 0 2 0 0 0",
    "24 5.17*57173570810000024h 184852809811024 0 2 0 0 0",
    "35 11.0*57173570810000035h 184852809811035 0 2 0 0 0",
    "14 3.17*57173570810000014h 184852809811014 0 2 0 0 0",
    "25 16.5*57173570810000025h 184852809811025 0 2 0 0 0",
    "15 2.69*57173570810000015h 184852809811015 0 2 0 0 0"
  ],
  "82": [
    "1:1.5 1.95*57173570820011005h 1848528098210115 0 2 0 0 0"
  ],
  "83": [
    "2.43*57173570830000000h 1.5*57173570830000000a 184852809831000 0 2 0 0 0"
  ],
  "84": [
    "7.0*57173570840000000h 1.07*57173570840000000a 184852809841000 0 2 0 0 0"
  ],
  "86": [
    "1.97*57173570860000000h 1.75*57173570860000000a 184852809861000 0 11 0 0 0"
  ],
  "87": [
    "3.08*57173570870000000h 2.23*57173570870000000a 2.97*57173570870000000d 184852809871000 0 2 0 0 0"
  ],
  "88": [
    "4.0*57173570880000000h 3.04*57173570880000000a 1.89*57173570880000000d 184852809881000 0 2 0 0 0"
  ],
  "89": [
    "1.82*57173570890000000h 5.35*57173570890000000a 2.67*57173570890000000d 184852809891000 0 11 0 0 0"
  ],
  "98": [
    "34 3.56*57173570980000034h 184852809981034 0 2 0 0 0",
    "14 1.99*57173570980000014h 184852809981014 0 2 0 0 0",
    "25 2.2*57173570980000025h 184852809981025 0 2 0 0 0",
    "24 2.51*57173570980000024h 184852809981024 0 2 0 0 0",
    "35 7.0*57173570980000035h 184852809981035 0 2 0 0 0",
    "15 2.38*57173570980000015h 184852809981015 0 2 0 0 0"
  ],
  "99": [
    "1.5 4.85*57173570990001005h 1.15*57173570990001005a 184852809991015 0 12 0 0 0"
  ],
  "100": [
    "1.5 2.98*57173571000001005h 1.34*57173571000001005a 1848528091001015 0 12 0 0 0"
  ],
  "101": [
    "1.75 1.72*57173571010010075h 2.01*57173571010010075a 18485280910110175 0 12 0 0 0"
  ],
  "102": [
    "0.75 1.74*57173571020000075h 1.98*57173571020000075a 18485280910210075 0 12 0 0 0"
  ],
  "131": [
    "9-10 4.5*57173571310000910h 18485280913110910 0 4 0 1 0",
    "13+ 2.98*57173571310000013h 1848528091311013 0 4 0 1 0",
    "0-4 19.5*57173571310000004h 1848528091311004 0 4 0 1 0",
    "11-12 5.0*57173571310001112h 184852809131101112 0 4 0 1 0",
    "5-6 8.5*57173571310000056h 1848528091311056 0 4 0 1 0",
    "7-8 5.17*57173571310000078h 1848528091311078 0 4 0 1 0"
  ],
  "132": [
    "3+ 2.68*57173571320000003h 184852809132103 0 2 0 1 0",
    "0:0 6.75*57173571320000000h 1848528091321000 0 2 0 1 0",
    "1:1 3.33*57173571320001001h 1848528091321011 0 2 0 1 0",
    "2:2 3.33*57173571320002002h 1848528091321022 0 2 0 1 0"
  ],
  "133": [
    "3+ 12.25*57173571330000003h 184852809133103 0 2 0 1 0",
    "0:0 2.34*57173571330000000h 1848528091331000 0 2 0 1 0",
    "1:1 2.41*57173571330001001h 1848528091331011 0 2 0 1 0",
    "2:2 5.0*57173571330002002h 1848528091331022 0 2 0 1 0"
  ],
  "134": [
    "6+ 1.49*57173571340000006h 184852809134106 0 4 0 1 0",
    "0-1 29.5*57173571340000001h 1848528091341001 0 4 0 1 0",
    "2-3 6.5*57173571340000023h 1848528091341023 0 4 0 1 0",
    "4-5 3.78*57173571340000045h 1848528091341045 0 4 0 1 0"
  ],
  "135": [
    "0-1 6.5*57173571350000001h 1848528091351001 0 4 0 1 0",
    "2-3 2.66*57173571350000023h 1848528091351023 0 4 0 1 0",
    "4-5 3.0*57173571350000045h 1848528091351045 0 4 0 1 0",
    "6+ 3.7*57173571350000006h 184852809135106 0 4 0 1 0"
  ],
  "136": [
    "0-1 21.0*57173571360000001h 1848528091361001 0 4 0 1 0",
    "2-3 3.86*57173571360000023h 1848528091361023 0 4 0 1 0",
    "4-5 2.53*57173571360000045h 1848528091361045 0 4 0 1 0",
    "6+ 2.38*57173571360000006h 184852809136106 0 4 0 1 0"
  ],
  "140": [
    "2.0 1.03*57173571400002000h 21.5*57173571400002000a 10.5*57173571400002000d 1848528091401020 0 4 0 0 0"
  ]
};

describe("observed More native groups", () => {
  it("retains all 138 rows from 54 native groups without treating metadata as a market", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(main(1, "live", null));
    const owner = { "0": "2026-09-08T15:00:00Z", "2": "Lahti", "3": "IFK Mariehamn", "8": "5717357", "7": {} };
    const baseline = main(2, "today", {});
    adapter.decode({ ...baseline, payload: { ...baseline.payload, body: JSON.stringify([{ "1": "Observed league", "2": [owner] }]) } });
    const value = catalog(adapter, patchBody(more(3, observedMoreGroups), { eventId: "5717357" }));
    expect(value.nativeMarketObservations).toHaveLength(138);
    expect(new Set(value.nativeMarketObservations?.map((row) => row.nativeType)).size).toBe(54);
    expect(value.nativeMarketObservations?.some((row) => row.nativeType === "0")).toBe(false);
    expect(value.markets).toHaveLength(29);
    expect(value.quotes).toHaveLength(58);
    expect(value.quotes).toContainEqual(expect.objectContaining({ providerMarketId: "18485280921101025",
      providerSelectionId: "57173570210100025h", rawOdds: "0.84", sequence: 3, receivedMonotonicMs: 1030 }));
    expect(value.quotes).toContainEqual(expect.objectContaining({ providerMarketId: "184852809371000",
      providerSelectionId: "57173570370000000h", marketType: "FH_BTTS", selection: "YES", line: null,
      rawOdds: "4.5", rawFormat: "DECIMAL", sequence: 3, receivedMonotonicMs: 1030 }));
    expect(value.events).toHaveLength(1);
    expect(value.events[0]!.providerEventId).toBe("5717357");
  });
});
