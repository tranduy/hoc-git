import { afterEach, describe, expect, it } from "vitest";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CatalogRevisionStore, type StoredCatalogRevision } from "../catalog/catalog-revision-store.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";
const EVENT_ID = "778899";
const GOAL_ID = "7788993001";
const CORNER_ID = "7788992101";
const OBSERVED_AT = Date.UTC(2026, 8, 7, 14);
const stores: CatalogRevisionStore[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

const goal = (price = "0.92") => `2.5 ${price}*778899301h -0.98*778899302a ${GOAL_ID}`;
const corner = (price = "0.91", line = "9.5") => `${line} ${price}*778899211h -0.97*778899212a ${CORNER_ID}`;
type NativeGroups = Readonly<Record<string, readonly unknown[]>>;
const event = (groups: NativeGroups) => ({ "0": "2026-09-08T12:00:00Z", "2": "Hidden Home",
  "3": "Hidden Away", "8": EVENT_ID, "7": groups });

function base(sequence: number, sourceEpoch = "observer-sbo:1") {
  return { version: 1 as const, kind: "NETWORK" as const, lobby: "KSPORT" as const,
    sourceId: "chrome:KSPORT:8", sourceEpoch, tabId: 8, sequence,
    observedAtMs: OBSERVED_AT + sequence * 100, receivedMonotonicMs: 1_000 + sequence * 10 };
}

function httpRequest(sequence: number) {
  return { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch", method: "GET",
    observerRequestId: `observer-sbo:request:${sequence}`,
    requestFrameKey: "http-frame:ksport-main", requestDocumentKey: "http-document:ksport-main" };
}

function mainEnvelope(sequence: number, partition: "live" | "today", groups: NativeGroups | null,
  sourceEpoch = "observer-sbo:1", generation = 1, requestStartSequence = 0): ChromeBridgeEnvelope {
  return { ...base(sequence, sourceEpoch), transport: "HTTP_RESPONSE",
    request: { ...httpRequest(sequence), streamId: `ksport-http:8:${generation}`,
      providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
      providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence },
    payload: { encoding: "UTF8", body: JSON.stringify(groups === null ? [] : [
      { "1": "Prematch", "2": [event(groups)] }
    ]) } };
}

function detailEnvelope(sequence: number, groups: NativeGroups, requestStartSequence: number,
  ordinal = 1, sourceEpoch = "observer-sbo:1"): ChromeBridgeEnvelope {
  const receipt = base(sequence, sourceEpoch);
  return { ...receipt, transport: "HTTP_RESPONSE", request: { ...httpRequest(sequence),
    streamId: `sbobet-detail:8:${ordinal}`, reconcileCutoffSequence: requestStartSequence },
    payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SBOBET_EVENT_DETAIL",
      generation: sourceEpoch, eventId: EVENT_ID, requestStartSequence,
      observedAtMs: receipt.observedAtMs, marketContainerComplete: true, event: event(groups) }) } };
}

function emptyEarlyEnvelope(sequence: number, sourceEpoch = "observer-sbo:1"): ChromeBridgeEnvelope {
  const receipt = base(sequence, sourceEpoch);
  return { ...receipt, transport: "HTTP_RESPONSE", request: { ...httpRequest(sequence), hostname: "be.sb21.net",
    streamId: `sbobet-early:8:${sequence}`, reconcileCutoffSequence: sequence - 1 },
  payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SBOBET_EARLY_CATALOG", generation: sourceEpoch,
    requestStartSequence: sequence - 1, observedAtMs: receipt.observedAtMs, rosterComplete: true, body: [] }) } };
}

function socketEnvelope(sequence: number, groups: NativeGroups, sourceEpoch = "observer-sbo:1",
  receiptSequence = sequence): ChromeBridgeEnvelope {
  const message = "MESSAGE\ndestination:/topic/sports/1_1/today/ma/event/vi\n" +
    `content-type:application/json\nsubscription:subSportBookToday\nmessage-id:socket-${receiptSequence}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
      body: JSON.stringify({ "8": EVENT_ID, "7": groups }) })}\0`;
  return { ...base(sequence, sourceEpoch), transport: "WS_FRAME", request: {
    hostname: "d42.sb21.net", pathnameClass: "/sport/433/session/websocket", resourceType: "WebSocket", streamId: "1"
  }, payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}

function harness() {
  const now = () => OBSERVED_AT + 1_000;
  const revisions = new CatalogRevisionStore({ now });
  stores.push(revisions);
  const notifications: StoredCatalogRevision[] = [];
  const rejected: Array<{ sequence: number; reason: string }> = [];
  revisions.subscribe((entry) => notifications.push(entry));
  // This is the production server publication chain, using real implementations.
  const plane = new ChromeCatalogDataPlane({ now,
    publish: (catalog, snapshotState) => {
      const freshnessMs = providerFeedPolicies.get(catalog.accountId)!.catalogFreshnessMs;
      revisions.publish(catalog.accountId, catalog, { snapshotState, freshnessMs });
    }, onIngestRejected: (envelope, reason) => rejected.push({ sequence: envelope.sequence, reason }) });
  const ingest = (envelope: ChromeBridgeEnvelope, connectionGeneration = 1) =>
    plane.ingest(ChromeBridgeEnvelopeSchema.parse(envelope), { connectionGeneration });
  const seed = () => {
    expect(ingest(mainEnvelope(0, "live", null))).toBe(false);
    expect(revisions.get(ACCOUNT_ID)).toBeUndefined();
    expect(ingest(mainEnvelope(1, "today", { "3": [goal()] }))).toBe(false);
    expect(ingest(emptyEarlyEnvelope(2))).toBe(true);
  };
  return { plane, revisions, notifications, rejected, ingest, seed };
}

describe("SBOBET hidden markets through the catalog data plane and revision store", () => {
  it("publishes main, detail and changed hidden prices with exact identity and retained quote clocks", async () => {
    const { plane, revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(socketEnvelope(3, { "3": [goal("0.75")] }))).toBe(true);
    expect(ingest(detailEnvelope(4, { "3": [goal()], "21": [corner()] }, 2))).toBe(true);
    expect(ingest(socketEnvelope(5, { "21": [corner("0.63", "10.5")] }))).toBe(true);

    const latest = revisions.get(ACCOUNT_ID)!;
    expect(latest).toMatchObject({ accountId: ACCOUNT_ID, snapshotState: "FRESH", sequence: 4 });
    expect(latest.catalog.markets).toContainEqual(expect.objectContaining({ providerEventId: EVENT_ID,
      providerMarketId: CORNER_ID, marketType: "CORNER_FT_TOTAL", scope: "FULL_TIME", line: "10.5", status: "OPEN" }));
    expect(latest.catalog.quotes).toContainEqual(expect.objectContaining({ providerEventId: EVENT_ID,
      providerMarketId: CORNER_ID, providerSelectionId: "778899211h", selection: "OVER",
      rawOdds: "0.63", line: "10.5", receivedMonotonicMs: 1_050, sequence: 5 }));
    expect(latest.catalog.quotes).toContainEqual(expect.objectContaining({ providerMarketId: GOAL_ID,
      providerSelectionId: "778899301h", rawOdds: "0.75", receivedMonotonicMs: 1_030, sequence: 3 }));
    expect(latest.catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: GOAL_ID, observedAtMs: OBSERVED_AT + 300
    }));
    expect(await plane.read(ACCOUNT_ID)).toEqual(latest.catalog);
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
    expect(new Set(notifications.map((entry) => entry.revision)).size).toBe(4);

    expect(ingest(socketEnvelope(6, { "21": [corner("0.63", "10.5")] }))).toBe(true);
    expect(revisions.get(ACCOUNT_ID)?.revision).toBe(latest.revision);
    expect(revisions.get(ACCOUNT_ID)?.catalog.quotes).toContainEqual(expect.objectContaining({
      providerMarketId: CORNER_ID, providerSelectionId: "778899211h", receivedMonotonicMs: 1_060, sequence: 6
    }));
    expect(revisions.get(ACCOUNT_ID)?.catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: CORNER_ID, observedAtMs: OBSERVED_AT + 600
    }));
    expect(notifications).toHaveLength(4);
  });

  it("publishes authoritative detail removal through a new catalog revision", () => {
    const { revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(detailEnvelope(3, { "3": [goal()], "21": [corner()] }, 2))).toBe(true);
    const hydrated = revisions.get(ACCOUNT_ID)!;
    expect(ingest(detailEnvelope(4, { "3": [goal()] }, 3, 2))).toBe(true);

    expect(revisions.get(ACCOUNT_ID)?.catalog.markets.map((market) => market.providerMarketId)).toEqual([GOAL_ID]);
    expect(revisions.get(ACCOUNT_ID)?.revision).not.toBe(hydrated.revision);
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it("publishes verified empty detail instead of leaving the last open prices in the revision store", () => {
    const { revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(detailEnvelope(3, {}, 2))).toBe(true);

    expect(revisions.get(ACCOUNT_ID)?.catalog).toMatchObject({ events: [expect.objectContaining({
      providerEventId: EVENT_ID
    })], markets: [], quotes: [], nativeMarketObservations: [] });
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it.each(["live", "today"] as const)("publishes a complete native-only %s main pair without inventing comparable prices", (partition) => {
    const { revisions, ingest } = harness();
    const groups = { "777": ["0.91*777h -0.97*777a 77777"] };
    expect(ingest(mainEnvelope(0, "live", partition === "live" ? groups : null))).toBe(false);
    expect(ingest(mainEnvelope(1, "today", partition === "today" ? groups : null))).toBe(false);
    expect(ingest(emptyEarlyEnvelope(2))).toBe(true);

    expect(revisions.get(ACCOUNT_ID)?.catalog).toMatchObject({ markets: [], quotes: [],
      nativeMarketObservations: [expect.objectContaining({ nativeType: "777", disposition: "UNMAPPED" })] });
  });

  it("preserves a newer hidden quote and removal fences across older detail and pending main HTTP", () => {
    const { revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(detailEnvelope(3, { "3": [goal()], "21": [corner()] }, 2))).toBe(true);
    expect(ingest(mainEnvelope(4, "live", null, "observer-sbo:1", 2, 3))).toBe(false);
    expect(ingest(socketEnvelope(5, { "21": [corner("0.62", "10.5")] }))).toBe(true);
    expect(ingest(detailEnvelope(6, {}, 3, 2))).toBe(true);
    const removed = revisions.get(ACCOUNT_ID)!;
    expect(removed.catalog.markets.map((market) => market.providerMarketId)).toEqual([CORNER_ID]);
    expect(removed.catalog.quotes).toContainEqual(expect.objectContaining({ providerMarketId: CORNER_ID,
      providerSelectionId: "778899211h", rawOdds: "0.62", line: "10.5", receivedMonotonicMs: 1_050, sequence: 5 }));

    expect(ingest(mainEnvelope(7, "today", { "3": [goal()] }, "observer-sbo:1", 2, 3))).toBe(true);
    const reconciled = revisions.get(ACCOUNT_ID)!;
    expect(reconciled.catalog.markets.map((market) => market.providerMarketId)).toEqual([CORNER_ID]);
    expect(reconciled.catalog.quotes).toEqual(removed.catalog.quotes);
    expect(reconciled.revision).toBe(removed.revision);
    expect(notifications).toHaveLength(4);
  });

  it("publishes native-only socket observations and inventory changes after a complete HTTP baseline", () => {
    const { revisions, notifications, ingest } = harness();
    expect(ingest(mainEnvelope(0, "live", null))).toBe(false);
    expect(ingest(mainEnvelope(1, "today", { "777": [goal()] }))).toBe(false);
    expect(ingest(emptyEarlyEnvelope(2))).toBe(true);
    const before = revisions.get(ACCOUNT_ID)!;

    expect(ingest(socketEnvelope(3, { "777": [goal("0.75")] }))).toBe(true);
    const changed = revisions.get(ACCOUNT_ID)!;
    expect(changed.catalog).toMatchObject({ markets: [], quotes: [], nativeMarketObservations: [
      expect.objectContaining({ nativeType: "777", disposition: "UNMAPPED", observedAtMs: OBSERVED_AT + 300 })
    ] });
    // Native prices are now retained as evidence even while their contract is
    // unmapped, so changing a raw price changes inventory content and revision.
    expect(changed.revision).not.toBe(before.revision);
    expect(changed.catalog.nativeMarketObservations?.[0]?.nativeSelections?.[0]?.price).toBe("0.75");
    expect(notifications).toHaveLength(2);
    expect(ingest(socketEnvelope(4, { "777": [goal("0.75"), goal("0.65")] }))).toBe(true);
    expect(revisions.get(ACCOUNT_ID)?.catalog.nativeMarketObservations).toHaveLength(2);
    expect(revisions.get(ACCOUNT_ID)?.revision).not.toBe(before.revision);
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it("withdraws the last published open prices when their exact socket row becomes invalid", () => {
    const { revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(socketEnvelope(3, { "3": [goal("0")] }))).toBe(true);

    expect(revisions.get(ACCOUNT_ID)?.catalog).toMatchObject({ markets: [], quotes: [], nativeMarketObservations: [
      expect.objectContaining({ providerMarketId: GOAL_ID, disposition: "EXCLUDED" })
    ] });
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2]);
  });

  it("cannot publish stale provider prices or duplicate withdrawals under newer bridge envelopes", () => {
    const { revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(socketEnvelope(3, { "3": [goal("0.60")] }, "observer-sbo:1", 100))).toBe(true);
    const current = revisions.get(ACCOUNT_ID)!;
    expect(ingest(socketEnvelope(4, { "3": [goal()] }, "observer-sbo:1", 99))).toBe(false);
    expect(ingest(socketEnvelope(5, { "3": [goal("0")] }, "observer-sbo:1", 99))).toBe(false);
    expect(ingest(socketEnvelope(6, { "3": [goal("0")] }, "observer-sbo:1", 100))).toBe(false);
    expect(revisions.get(ACCOUNT_ID)).toBe(current);
    expect(current.catalog.quotes).toContainEqual(expect.objectContaining({ providerMarketId: GOAL_ID,
      rawOdds: "0.60", receivedMonotonicMs: 1_030, sequence: 3 }));
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2]);

    expect(ingest(socketEnvelope(7, { "3": [goal("0.65")] }, "observer-sbo:1", 101))).toBe(true);
    expect(notifications.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it("does not publish a delayed hidden response from an event's previous roster membership", () => {
    const { revisions, notifications, ingest, seed } = harness();
    seed();
    expect(ingest(detailEnvelope(3, { "3": [goal()], "21": [corner()] }, 2, 5))).toBe(true);
    expect(ingest(mainEnvelope(4, "live", null, "observer-sbo:1", 2, 3))).toBe(false);
    expect(ingest(mainEnvelope(5, "today", null, "observer-sbo:1", 2, 3))).toBe(true);
    expect(ingest(mainEnvelope(6, "live", null, "observer-sbo:1", 3, 5))).toBe(false);
    expect(ingest(mainEnvelope(7, "today", { "3": [goal("0.70")] }, "observer-sbo:1", 3, 5))).toBe(true);
    const readmitted = revisions.get(ACCOUNT_ID)!;

    expect(ingest(detailEnvelope(8, { "3": [goal()], "21": [corner()] }, 3, 6))).toBe(false);
    expect(revisions.get(ACCOUNT_ID)).toBe(readmitted);
    expect(readmitted.catalog.markets.map((market) => market.providerMarketId)).toEqual([GOAL_ID]);
    expect(notifications).toHaveLength(4);
    expect(ingest(detailEnvelope(9, { "3": [goal()], "21": [corner()] }, 7, 1))).toBe(true);
    expect(notifications).toHaveLength(5);
  });

  it("cannot authorize a native-only catalog from standalone socket frames", () => {
    const { revisions, ingest } = harness();
    expect(ingest(socketEnvelope(1, { "777": [goal()] }))).toBe(false);
    expect(ingest(socketEnvelope(2, { "3": [goal("0")] }))).toBe(false);
    expect(revisions.get(ACCOUNT_ID)).toBeUndefined();
  });

  it("rejects unbound or unproven detail without changing the published revision", () => {
    const { revisions, rejected, ingest, seed } = harness();
    seed();
    const before = revisions.get(ACCOUNT_ID)!;
    const valid = detailEnvelope(3, {}, 2);
    const { requestFrameKey: _frame, requestDocumentKey: _document, ...unboundRequest } = valid.request;
    expect(ingest({ ...valid, request: unboundRequest })).toBe(false);
    expect(rejected.at(-1)?.reason).toBe("HTTP_DOCUMENT_NOT_BOUND");
    const payload = JSON.parse(valid.payload.body) as Record<string, unknown>;
    for (const invalid of [
      { ...payload, marketContainerComplete: false },
      { ...payload, generation: "observer-sbo:2" },
      { ...payload, requestStartSequence: 3 },
      { ...payload, eventId: "999999" },
      { ...payload, event: { ...event({}), "7": { "21": "malformed" } } }
    ]) {
      expect(ingest({ ...valid, payload: { encoding: "UTF8", body: JSON.stringify(invalid) } })).toBe(false);
      expect(rejected.at(-1)?.reason).toBe("ADAPTER_DECODE_EMPTY:ksport-ws-catalog-v1");
    }
    expect(revisions.get(ACCOUNT_ID)?.revision).toBe(before.revision);
  });

  it("requires a new baseline before epoch promotion and rejects retired hidden frames afterward", () => {
    const { revisions, notifications, rejected, ingest, seed } = harness();
    seed();
    expect(ingest(detailEnvelope(3, { "3": [goal()], "21": [corner()] }, 2))).toBe(true);
    const current = revisions.get(ACCOUNT_ID)!;
    expect(ingest(detailEnvelope(4, {}, 3, 1, "observer-sbo:2"), 2)).toBe(false);
    expect(revisions.get(ACCOUNT_ID)?.revision).toBe(current.revision);
    expect(ingest(mainEnvelope(5, "live", null, "observer-sbo:2"), 2)).toBe(false);
    expect(ingest(mainEnvelope(6, "today", { "3": [goal("0.70")] }, "observer-sbo:2"), 2)).toBe(false);
    expect(ingest(emptyEarlyEnvelope(7, "observer-sbo:2"), 2)).toBe(true);
    const promoted = revisions.get(ACCOUNT_ID)!;

    expect(promoted.catalog.markets.map((market) => market.providerMarketId)).toEqual([GOAL_ID]);
    expect(ingest(socketEnvelope(7, { "21": [corner("0.60")] }))).toBe(false);
    expect(rejected.at(-1)?.reason).toBe("AUTHORITY_EPOCH_RETIRED");
    expect(ingest(detailEnvelope(8, { "3": [goal()], "21": [corner()] }, 3, 2))).toBe(false);
    expect(revisions.get(ACCOUNT_ID)).toBe(promoted);
    expect(notifications).toHaveLength(3);
  });
});
