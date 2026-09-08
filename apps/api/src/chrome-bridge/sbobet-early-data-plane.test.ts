import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CatalogRevisionStore } from "../catalog/catalog-revision-store.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";

const ACCOUNT = "catalog-source:SBOBET:FOOTBALL";
const EPOCH = "early-source:1";
const WALL = Date.UTC(2026, 8, 8, 7);
const EARLY = "5691691";
const TODAY = "991100";
const fixture = JSON.parse(readFileSync(new URL("./sbobet-early-source.fixture.json", import.meta.url), "utf8"));
const total = (id: string, price = "0.91") => `2.5 ${price}*${id}301h -0.97*${id}302a ${id}3001`;
const hidden = (price = "1.91") => `0 ${price}*${EARLY}361h 1.93*${EARLY}362a ${EARLY}3601 0`;
const native = (id = EARLY, price = "0.91") => ({ "0": "2026-09-09T16:45:00Z",
  "2": id === EARLY ? "VfB Stuttgart" : "Today Home", "3": id === EARLY ? "Viking" : "Today Away",
  "8": id, "7": { "3": [total(id, price)] } });
const roster = (events = [native()], league = 354) => [[{ "0": league, "1": "League", "2": events }]];
const base = (sequence: number, sourceEpoch = EPOCH) => ({ version: 1 as const, kind: "NETWORK" as const,
  lobby: "KSPORT" as const, sourceId: "chrome:KSPORT:8", sourceEpoch, tabId: 8, sequence,
  observedAtMs: WALL + sequence * 100, receivedMonotonicMs: 1_000 + sequence * 10 });
const request = (sequence: number) => ({ hostname: "be.sb21.net", pathnameClass: "/api/v2/getEvent",
  method: "GET", resourceType: "Fetch", observerRequestId: `early-request-${sequence}`,
  requestFrameKey: "provider-frame", requestDocumentKey: "provider-document" });
function main(sequence: number, partition: "live" | "today", body: unknown,
  ordinal = 1, cutoff = 0): ChromeBridgeEnvelope {
  return { ...base(sequence), transport: "HTTP_RESPONSE", request: { ...request(sequence),
    streamId: `ksport-http:8:${ordinal}`, providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
    providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: cutoff },
  payload: { encoding: "UTF8", body: JSON.stringify(body) } };
}
function early(sequence: number, body: unknown = roster(), cutoff = 2, ordinal = sequence,
  sourceEpoch = EPOCH): ChromeBridgeEnvelope {
  return { ...base(sequence, sourceEpoch), transport: "HTTP_RESPONSE", request: { ...request(sequence),
    streamId: `sbobet-early:8:${ordinal}`, reconcileCutoffSequence: cutoff },
  payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SBOBET_EARLY_CATALOG", generation: sourceEpoch,
    requestStartSequence: cutoff, observedAtMs: base(sequence).observedAtMs, rosterComplete: true, body }) } };
}
function more(sequence: number, price = "1.91", cutoff = 3, leagueId = "354"): ChromeBridgeEnvelope {
  return { ...base(sequence), transport: "HTTP_RESPONSE", request: { ...request(sequence),
    pathnameClass: "/api/v2/getEventBetMore", streamId: `sbobet-more:8:${sequence}`, reconcileCutoffSequence: cutoff },
  payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SBOBET_EVENT_MORE", generation: EPOCH,
    eventId: EARLY, leagueId, requestStartSequence: cutoff, observedAtMs: base(sequence).observedAtMs,
    marketContainerComplete: false, groups: { "36": [hidden(price)] } }) } };
}
function socket(sequence: number, price = "0.61", phase = "today"): ChromeBridgeEnvelope {
  const message = `MESSAGE\ndestination:/topic/sports/1_1/${phase}/ma/event/vi\nsubscription:subSportBook${phase === "live" ? "Live" : "Today"}\nmessage-id:socket-${sequence}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
      body: JSON.stringify({ "8": EARLY, "7": { "3": [total(EARLY, price)] } }) })}\0`;
  return { ...base(sequence), transport: "WS_FRAME", request: { hostname: "d42.sb21.net",
    pathnameClass: "/sport/433/session/websocket", resourceType: "WebSocket", streamId: "1" },
  payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}
function seed(adapter: KsportWsCatalogAdapter, today: unknown = roster([native(TODAY)], 481)) {
  expect(adapter.decode(main(1, "live", []))).toEqual([]);
  expect(adapter.decode(main(2, "today", today))).toHaveLength(1);
}
function catalog(adapter: KsportWsCatalogAdapter, envelope: ChromeBridgeEnvelope) {
  const updates = adapter.decode(ChromeBridgeEnvelopeSchema.parse(envelope));
  expect(updates).toHaveLength(1);
  return updates[0]!.value as ObservedProviderCatalog;
}

describe("SBOBET complete Early All roster", () => {
  it("admits the actual 377-owner All response with native prices and inventory under the existing pair generation", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    const update = adapter.decode(early(3, fixture.body))[0];
    expect(update).toMatchObject({ evidenceMode: "DELTA", generation: `${EPOCH}:ksport-http:8:1` });
    expect(update).not.toHaveProperty("authoritativeBaseline");
    const value = update!.value as ObservedProviderCatalog;
    expect(value.events).toHaveLength(378);
    expect(value.events.find(x => x.providerEventId === EARLY)).toMatchObject({
      participantA: "VfB Stuttgart", participantB: "Viking", isLive: false });
    expect(value.quotes).toContainEqual(expect.objectContaining({ providerEventId: EARLY,
      providerMarketId: "18467449931040", providerSelectionId: "56916910030004000h", rawOdds: "-0.96",
      sequence: 3, receivedMonotonicMs: 1030 }));
    expect(value.nativeMarketObservations).toContainEqual(expect.objectContaining({ providerEventId: EARLY,
      nativeType: "1", disposition: "EXCLUDED" }));
  });

  it("retains Early-only More and its receipt clocks across Today full refreshes", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3));
    const hydrated = catalog(adapter, more(4));
    expect(hydrated.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3601`, rawOdds: "1.91" }));
    adapter.decode(main(5, "live", [], 2, 4));
    const refreshed = catalog(adapter, main(6, "today", roster([native(TODAY, "0.75")], 481), 2, 4));
    expect(refreshed.events.map(x => x.providerEventId).sort()).toEqual([EARLY, TODAY].sort());
    expect(refreshed.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3601`,
      sequence: 4, receivedMonotonicMs: 1040 }));
    expect(refreshed.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3001`, sequence: 3 }));
  });

  it("preserves a newer sparse WS Early price across an in-flight Early response and later Today replacement", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3));
    catalog(adapter, socket(4));
    const late = catalog(adapter, early(5, roster(), 3));
    expect(late.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3001`, rawOdds: "0.61", sequence: 4 }));
    adapter.decode(main(6, "live", [], 2, 5));
    const refreshed = catalog(adapter, main(7, "today", roster([native(TODAY)], 481), 2, 5));
    expect(refreshed.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3001`, rawOdds: "0.61", sequence: 4 }));
  });

  it("only withdraws Early-only membership and keeps a matching Today owner", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter, roster([native(), native(TODAY)]));
    catalog(adapter, early(3));
    catalog(adapter, more(4));
    const retained = catalog(adapter, early(5, [], 4));
    expect(retained.events.map(x => x.providerEventId).sort()).toEqual([EARLY, TODAY].sort());
    expect(retained.quotes.some(x => x.providerMarketId === `${EARLY}3601`)).toBe(true);
  });

  it("preserves an in-flight request's newer WS price when an Early owner enters Today", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3));
    catalog(adapter, socket(4));
    adapter.decode(main(5, "live", [], 2, 3));
    const migrated = catalog(adapter, main(6, "today", roster([native(), native(TODAY)]), 2, 3));
    expect(migrated.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3001`,
      rawOdds: "0.61", sequence: 4, receivedMonotonicMs: 1040 }));
  });

  it.each(["home", "league", "kickoff"])("rejects contradictory Today/Early ownership: %s", conflict => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter, roster());
    const body = roster();
    if (conflict === "home") body[0]![0]!["2"][0]!["2"] = "Other Home";
    if (conflict === "league") body[0]![0]!["0"] = 999;
    if (conflict === "kickoff") body[0]![0]!["2"][0]!["0"] = "2026-09-10T16:45:00Z";
    expect(adapter.decode(early(3, body))).toEqual([]);
  });

  it("rejects a conflicting Today replacement while retaining the independently proven Early owner", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3));
    adapter.decode(main(4, "live", [], 2, 3));
    const conflicting = roster(); conflicting[0]![0]!["2"][0]!["2"] = "Other Home";
    expect(adapter.decode(main(5, "today", conflicting, 2, 3))).toEqual([]);
    expect(catalog(adapter, more(6, "1.81", 3)).events.find(x => x.providerEventId === EARLY)?.participantA).toBe("VfB Stuttgart");
  });

  it("excludes a live owner even when an Early response arrives later", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3)); catalog(adapter, more(4));
    adapter.decode(main(5, "live", roster(), 2, 4));
    catalog(adapter, main(6, "today", roster([native(TODAY)], 481), 2, 4));
    const latest = catalog(adapter, early(7, roster(), 4));
    expect(latest.events.find(x => x.providerEventId === EARLY)?.isLive).toBe(true);
    expect(latest.quotes.filter(x => x.providerEventId === EARLY).every(x => x.isLive)).toBe(true);
    expect(latest.quotes.some(x => x.providerMarketId === `${EARLY}3601`)).toBe(false);
    expect(adapter.decode(more(8, "1.71", 7))).toEqual([]);
  });

  it("fences wrong-league and removed/readmitted owner More requests", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3));
    expect(adapter.decode(more(4, "1.91", 3, "999"))).toEqual([]);
    catalog(adapter, early(5, [], 3));
    catalog(adapter, early(6, roster(), 5));
    expect(adapter.decode(more(7, "1.91", 3))).toEqual([]);
    expect(catalog(adapter, more(8, "1.71", 6)).quotes.some(x => x.providerMarketId === `${EARLY}3601`)).toBe(true);
  });

  it.each([{}, [[], { error: true }], [[{ "0": 354, "1": "League", "2": [{ ...native(), "7": { "3": null } }] }]],
    roster([native(), { ...native(), "2": "Conflict" }]), roster([Object.assign(native(), { errorCode: 500 })])]
    .map(body => [body]))("rejects malformed full-roster proof %j", body => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    expect(adapter.decode(early(3, body))).toEqual([]);
  });

  it("renews the admission floor when a same-ID Early fixture changes owner metadata", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    catalog(adapter, early(3)); catalog(adapter, more(4));
    const changed = roster(); changed[0]![0]!["2"][0]!["2"] = "Replacement Home";
    const replaced = catalog(adapter, early(5, changed, 4));
    expect(replaced.quotes.some(x => x.providerMarketId === `${EARLY}3601`)).toBe(false);
    expect(adapter.decode(more(6, "1.71", 4))).toEqual([]);
    expect(catalog(adapter, more(7, "1.71", 5)).events.find(x => x.providerEventId === EARLY)?.participantA).toBe("Replacement Home");
  });

  it.each([{}, "bad*selection", total("999999"), "x".repeat(1501)])(
    "rejects malformed or foreign row data before treating an Early response as complete", row => {
      const adapter = new KsportWsCatalogAdapter(); seed(adapter); catalog(adapter, early(3));
      const body = roster(); (body[0]![0]!["2"][0]!["7"] as Record<string, unknown[]>)["3"] = [row];
      expect(adapter.decode(early(4, body, 3))).toEqual([]);
    }
  );

  it("rejects an authoritative Early response exceeding the 2048-owner cap", () => {
    const adapter = new KsportWsCatalogAdapter(); seed(adapter);
    expect(adapter.decode(early(3, roster(Array.from({ length: 2049 }, (_, index) => native(String(700000 + index))))))).toHaveLength(0);
  });

  it.each(["complete", "clock", "cutoff", "method", "host", "tab", "frame", "epoch", "replayed"])(
    "rejects invalid Early evidence without mutating the retained roster: %s", fault => {
      const adapter = new KsportWsCatalogAdapter(); seed(adapter); catalog(adapter, early(3));
      const input = early(4, [], 3);
      const payload = JSON.parse(input.payload.body);
      if (fault === "complete") payload.rosterComplete = false;
      if (fault === "clock") payload.observedAtMs -= 1;
      if (fault === "cutoff") payload.requestStartSequence -= 1;
      if (fault === "epoch") payload.generation = "old";
      const patched = { ...input, request: { ...input.request,
        ...(fault === "method" ? { method: "POST" } : {}),
        ...(fault === "host" ? { hostname: "other.sb21.net" } : {}),
        ...(fault === "tab" ? { streamId: "sbobet-early:9:4" } : {}),
        ...(fault === "frame" ? { requestFrameKey: undefined } : {}),
        ...(fault === "replayed" ? { replayed: true } : {}) },
      payload: { ...input.payload, body: JSON.stringify(payload) } };
      expect(adapter.decode(patched)).toEqual([]);
      expect(catalog(adapter, more(5)).events.some(x => x.providerEventId === EARLY)).toBe(true);
    }
  );

  it("cannot establish baseline authority, cross source epochs, or replay lower ordinals", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(early(3))).toEqual([]);
    seed(adapter); catalog(adapter, early(4));
    expect(adapter.decode(early(5, [], 4, 3))).toEqual([]);
    expect(adapter.decode(early(6, [], 4, 6, "retired-epoch"))).toEqual([]);
    const missingDocument = early(7); delete (missingDocument.request as { requestDocumentKey?: string }).requestDocumentKey;
    expect(adapter.decode(missingDocument)).toEqual([]);
  });
});

const stores: CatalogRevisionStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
describe("SBOBET Early through the real revision store", () => {
  it("publishes additional Early markets, changed More prices and exact Early removal without renewing baseline generation", async () => {
    const now = () => WALL + 2_000;
    const revisions = new CatalogRevisionStore({ now }); stores.push(revisions);
    const plane = new ChromeCatalogDataPlane({ now, publish: (value, snapshotState) =>
      revisions.publish(value.accountId, value, { snapshotState, freshnessMs: 30_000 }) });
    const ingest = (value: ChromeBridgeEnvelope) => plane.ingest(ChromeBridgeEnvelopeSchema.parse(value), { connectionGeneration: 1 });
    expect(ingest(main(1, "live", []))).toBe(false);
    expect(ingest(main(2, "today", roster([native(TODAY)], 481)))).toBe(true);
    expect(ingest(early(3))).toBe(true);
    expect(ingest(more(4))).toBe(true);
    const first = revisions.get(ACCOUNT)!;
    expect(ingest(more(5, "1.71", 4))).toBe(true);
    const changed = revisions.get(ACCOUNT)!;
    expect(changed.revision).not.toBe(first.revision);
    expect(changed.catalog.quotes).toContainEqual(expect.objectContaining({ providerMarketId: `${EARLY}3601`,
      rawOdds: "1.71", sequence: 5, receivedMonotonicMs: 1050 }));
    expect(ingest(early(6, [], 5))).toBe(true);
    const removed = revisions.get(ACCOUNT)!;
    expect(removed.revision).not.toBe(changed.revision);
    expect(removed.catalog.events.map(x => x.providerEventId)).toEqual([TODAY]);
    expect(await plane.read(ACCOUNT)).toEqual(removed.catalog);
  });
});
