import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogSourceStatus, ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { NetworkBodyAssembler, NetworkBodyAssemblyBudget } from "./network-body-assembler.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import { ChromeBridgeRegistry } from "./chrome-bridge-registry.js";
import { ChromeBridgeControlPlane } from "./chrome-bridge-control-plane.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";

const SBOBET = "catalog-source:SBOBET:FOOTBALL";
const SABA = "catalog-source:SABA:FOOTBALL";
const CMD = "catalog-source:CMD:FOOTBALL";
const APSPORT = "catalog-source:APSPORT:FOOTBALL";

const record = { sportId: "1", leagueId: "league-1", leagueName: "League", matchId: "event-1",
  timeText: "08/17 02:30AM", teamNames: ["Alpha", "Beta"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
    { marketOddsId: "market-1", priceText: "0.9", status: null, greyedOut: "false", lineText: "0.5" },
    { marketOddsId: "market-1", priceText: "-0.9", status: null, greyedOut: "false", lineText: null }
  ] }] };

function cmdEnvelope(sequence = 1, records: readonly unknown[] = [record], chunkIndex = 0, chunkCount = 1,
  snapshotId = "cmd:9:dataplane-0001"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, sequence,
    observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "DOM_SNAPSHOT",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2, snapshotId, chunkIndex, chunkCount,
      records }) } };
}

function cmdSweepEnvelope(sequence: number, records: readonly unknown[], sweepComplete: boolean,
  snapshotId: string, sweepId = "cmd:9:sweep-dom-only"): ChromeBridgeEnvelope {
  const base = cmdEnvelope(sequence, records, 0, 1, snapshotId);
  return { ...base, observedAtMs: 1_000 + sequence, payload: { encoding: "UTF8",
    body: JSON.stringify({ schemaVersion: 2, snapshotId, chunkIndex: 0, chunkCount: 1,
      sweepId, sweepComplete, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1", records }) } };
}

function cmdHttpEnvelope(sequence = 1, options: { readonly t?: number; readonly a?: boolean;
  readonly providerFunctionCode?: number; readonly row?: unknown[] } = {}): ChromeBridgeEnvelope {
  const row = Array<unknown>(91).fill(null);
  Object.assign(row, { 0: 24881365, 3: 318, 10: 0.5, 12: 3, 14: 0.25, 16: 1.25, 25: 0,
    37: "ENGLISH PREMIER LEAGUE", 38: "Newcastle United", 39: "Liverpool",
    40: -0.96, 41: 0.90, 42: 0.87, 43: -0.95, 44: 0.88, 45: -0.98, 46: 0.88, 47: -0.98,
    53: "23:30", 56: "08/23", 79: 0 });
  const body = options.a === false ? { t: options.t ?? 8_281_247, a: false, data: [] }
    : { t: options.t ?? 8_281_247, a: true, data: [], today: [options.row ?? row], f: [] };
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "HTTP_RESPONSE", request: { hostname: "cgnew.fts368.com",
      pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx", resourceType: "XHR",
      method: "GET", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: "http-frame:cmd-main", requestDocumentKey: "http-document:cmd-document",
      providerFunctionCode: options.providerFunctionCode ?? 1 },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}

function imEnvelope(sequence: number, partition: "IM_MARKET_1" | "IM_MARKET_2",
  body: unknown): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "HTTP_RESPONSE", request: { hostname: "imsports.directsb.net",
      pathnameClass: "/api/EventV6/GetSE", resourceType: "Fetch", providerPartition: partition,
      method: "POST", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: "http-frame:im-main", requestDocumentKey: "http-document:im-document",
      streamId: "im:8:1", reconcileCutoffSequence: 0 },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}

function imDeltaEnvelope(sequence: number, observedAtMs: number, body: unknown): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8,
    sourceEpoch: "worker-a:0", sequence, observedAtMs, receivedMonotonicMs: 50 + sequence,
    transport: "HTTP_RESPONSE", request: { hostname: "imsports.directsb.net",
      pathnameClass: "/api/EventV6/GetSEDelta", resourceType: "XHR", method: "POST",
      observerRequestId: `observer-a:delta:${sequence}`,
      requestFrameKey: "http-frame:im-main", requestDocumentKey: "http-document:im-document" },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}

const sabaFields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "isrunning", "markettype", "bettype", "hdp", "odds", "selectionid"];

function sabaEnvelope(sequence: number, matchIds: readonly number[]): ChromeBridgeEnvelope {
  const rows = matchIds.flatMap((matchId) => [
    ["upsert", 10, "League", 1, matchId, `Home ${matchId}`, `Away ${matchId}`, 1_700_000_000, false,
      "HDP", "HOME", "0.5", "0.92", `${matchId}:home`],
    ["upsert", 10, "League", 1, matchId, `Home ${matchId}`, `Away ${matchId}`, 1_700_000_000, false,
      "HDP", "AWAY", "-0.5", "-0.88", `${matchId}:away`]
  ]);
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "WS_FRAME", request: { hostname: "sports.example", pathnameClass: "/socket.io/",
      resourceType: "WebSocket", streamId: "1" },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["Data", { v: 2, revision: String(sequence),
      fields: sabaFields, rows }])}` } };
}

const sabaPushFields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
  "enable", "odds1a", "odds2a", "hdp1", "hdp2"];

function sabaPushEnvelope(sequence: number, streamId: string, body: string,
  transport: "WS_FRAME" | "WS_STATE" = "WS_FRAME"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 100_000 + sequence,
    receivedMonotonicMs: 50 + sequence, transport,
    request: { hostname: "sports.example", pathnameClass: "/socket.io/",
      resourceType: "WebSocket", streamId },
    payload: { encoding: "UTF8", body } };
}

function sabaPushOpen(sequence: number, streamId: string): ChromeBridgeEnvelope {
  return sabaPushEnvelope(sequence, streamId, '{"state":"OPEN"}', "WS_STATE");
}

function sabaPushBaseline(sequence: number, streamId: string): ChromeBridgeEnvelope {
  const encode = (record: Record<string, unknown>): readonly unknown[] => Object.entries(record)
    .flatMap(([key, value]) => [sabaPushFields.indexOf(key), value]);
  const rows = [["f", 0, sabaPushFields], [0, "reset"],
    encode({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
    encode({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
      kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
    encode({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
      oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
    [0, "done"]];
  return sabaPushEnvelope(sequence, streamId,
    `42${JSON.stringify(["m", "b1", rows, `revision-${sequence}`])}`);
}

function sabaDomEnvelope(sequence: number): ChromeBridgeEnvelope {
  const records = Array.from({ length: 20 }, (_, index) => ({ ...record,
    matchId: `saba-event-${index}`, teamNames: [`Home ${index}`, `Away ${index}`],
    groups: record.groups.map((group) => ({ ...group, odds: group.odds.map((odds) => ({ ...odds,
      marketOddsId: `saba-market-${index}` })) })) }));
  return { ...cmdEnvelope(sequence, records, 0, 1,
    `saba:7:stable-generation-${sequence.toString().padStart(4, "0")}`),
    lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7, sourceEpoch: "worker-a:0",
    observedAtMs: 100_000 + sequence,
    request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" } };
}

// The canonical SBOBET baseline is the paired getEvent HTTP generation; WS
// receipts can only upsert into it (measured 2026-08-30: socket "snapshots"
// are per-event fragments in full-snapshot clothing and must never own the
// catalog). Baseline-establishing tests therefore speak HTTP.
function ksportEnvelope(sequence: number, partition: "live" | "today", eventIds: readonly number[],
  sourceEpoch = "worker-a:0", generation = Math.floor((sequence + 1) / 2)): ChromeBridgeEnvelope {
  return ksportHttpEnvelope(sequence, partition, generation, eventIds, "chrome:KSPORT:8", 8, sourceEpoch);
}

function ksportSocketEnvelope(sequence: number, partition: "live" | "today",
  eventIds: readonly number[], sourceEpoch = "worker-a:0",
  receiptGeneration = Math.floor((sequence + 1) / 2)): ChromeBridgeEnvelope {
  const events = eventIds.map((eventId) => ({ "2": `Home ${eventId}`, "3": `Away ${eventId}`, "8": eventId,
    "7": { "3": [`2.5 0.92*${eventId}0030002005h -0.98*${eventId}0030002005a ${eventId}181025`] } }));
  const destination = `/topic/sports/1_1/${partition}/ma/event/vi`;
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const frame = `MESSAGE\ndestination:${destination}\nsubscription:${subscription}\n` +
    `message-id:socket-${receiptGeneration}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
      body: JSON.stringify([{ "1": "League", "2": events }]) })}\0`;
  return { version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8,
    sourceEpoch, sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "WS_FRAME", request: { hostname: "d42.sb21.net", pathnameClass: "/sport/session/websocket",
      resourceType: "WebSocket", streamId: "1", recoveryGeneration: receiptGeneration },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([frame])}` } };
}

function ksportHttpEnvelope(sequence: number, partition: "live" | "today", generation: number,
  eventIds: readonly number[], sourceId = "chrome:KSPORT:8", tabId = 8,
  sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope {
  const events = eventIds.map((eventId) => ({ "0": "2026-08-21T16:00:00Z",
    "2": `Home ${eventId}`, "3": `Away ${eventId}`, "8": eventId,
    "7": { "5": [`0.5 0.92*${eventId}0050000000h -0.98*${eventId}0050000000a h ` +
      "735502668161000 0 0 1 1 0"] } }));
  return { version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId, tabId, sourceEpoch,
    sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "HTTP_RESPONSE", request: { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent",
      resourceType: "Fetch", method: "GET", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: `http-frame:ksport-${tabId}`, requestDocumentKey: `http-document:ksport-${tabId}`,
      streamId: `ksport-http:${tabId}:${generation}`,
      providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
      providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: 0 },
    payload: { encoding: "UTF8", body: JSON.stringify([{ "1": "League", "2": events }]) } };
}

function chunkedNetworkBody(base: ChromeBridgeEnvelope, sequence: number, chunkIndex: number,
  snapshotId: string): ChromeBridgeEnvelope {
  const midpoint = Math.ceil(base.payload.body.length / 2);
  const fragments = [base.payload.body.slice(0, midpoint), base.payload.body.slice(midpoint)];
  return { ...base, sequence, observedAtMs: 1_400, receivedMonotonicMs: 140,
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId,
      chunkIndex, chunkCount: 2, bodyEncoding: "UTF8", bodyFragment: fragments[chunkIndex]! }) } };
}

function legacySbobetSocketIoEnvelope(sequence: number): ChromeBridgeEnvelope {
  const fields = ["matchid", "sporttype", "hteamnameen", "ateamnameen", "kickofftime", "leagueid",
    "leaguenameen", "liveperiod", "oddsid", "bettype", "hdp1", "hdp2", "odds1a", "odds2a", "oddsstatus"];
  const rows = [["c", "c2"], ["f", 1, fields],
    [0, "m", 1, 9001, 2, 1, 3, "Alpha", 4, "Beta", 5, 1_787_328_000, 6, 77, 7, "League", 8, 0],
    [0, "o", 9, 7001, 1, 9001, 10, 1, 11, 0.25, 12, 0, 13, "0.91", 14, "-0.97", 15, "running"]];
  return { version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "WS_FRAME", request: { hostname: "sports.example", pathnameClass: "/socket.io/",
      resourceType: "WebSocket", streamId: "legacy-sbobet-socket" },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b52", rows, sequence])}` } };
}

function tabHeartbeat(base: ChromeBridgeEnvelope, observedAtMs: number, sequence: number,
  sourceEpoch = base.sourceEpoch): ChromeBridgeEnvelope {
  return { ...base, sequence, observedAtMs, ...(sourceEpoch === undefined ? {} : { sourceEpoch }),
    transport: "TAB_STATE", request: { hostname: "sports.example",
      pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
    payload: { encoding: "UTF8", body: "{}" } };
}

function replayedEnvelope(envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope {
  return { ...envelope, request: { ...envelope.request, replayed: true } };
}

function apsportRawEvent(eventId: number, firstPrice = "0.83") {
  return { "2": eventId, "5": `AP Home ${eventId}`, "6": true, "10": "Active",
    "11": "2026-08-28T01:00:00Z", "22": `AP Away ${eventId}`, "25": 1, "26": 0,
    "53": "AP League", "50": [{ "3": 3, "9": [{
      "0": `${eventId}-over`, "2": `${eventId}-under`, "6": `${eventId}-total`, "7": "2.5",
      "8": { "2": firstPrice }, "9": { "2": "-0.91" }
    }], "10": "Active" }] };
}

function apsportApiEnvelope(sequence: number, records: readonly unknown[],
  phase: "ROSTER" | "DETAIL" = "ROSTER"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence,
    receivedMonotonicMs: 50 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "pacific.agenate.com", pathnameClass: "/__fieldline_apsport_catalog_refresh__",
      resourceType: "Fetch", method: "POST", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: "http-frame:apsport-main", requestDocumentKey: "http-document:apsport-main" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, generation: "apsport:7:1",
      phase, complete: true, prematchWindowHours: 24, records }) } };
}

function apsportWsEnvelope(sequence: number, rawEvent: unknown): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence,
    receivedMonotonicMs: 50 + sequence, transport: "WS_FRAME",
    request: { hostname: "spws.agenate.com", pathnameClass: "/ln/en/lm",
      resourceType: "WebSocket", streamId: "apsport-football" },
    payload: { encoding: "UTF8", body: JSON.stringify({ s: 1, t: "eu", d: JSON.stringify(rawEvent) }) } };
}

const activeSbobet: CatalogSourceStatus = { id: SBOBET, alias: "K-Sports · SBOBET", provider: "SBOBET",
  category: "FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 900, reason: null };
const activeSaba: CatalogSourceStatus = { id: SABA, alias: "SABA", provider: "SABA", category: "FOOTBALL",
  sessionState: "ACTIVE", acquiredAtMs: 100, reason: null };

async function catalogWith(eventIds: readonly number[]): Promise<ObservedProviderCatalog> {
  const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
  plane.ingest(ksportEnvelope(1, "live", eventIds));
  plane.ingest(ksportEnvelope(2, "today", []));
  return plane.read(SBOBET);
}

function decodedBaseline(sourceId: string, catalog: ObservedProviderCatalog, sequence: number) {
  return [{ sourceId, sequence, observedAtMs: 1_000 + sequence, value: catalog, authoritativeBaseline: true,
    evidenceMode: "BASELINE" as const, generation: "shared-generation", provenance: "WS" as const,
    providerTimestampMs: null }];
}

class RejectingPromotionFeedRegistry extends ProviderFeedRegistry {
  rejectSourceId: string | null = null;

  override accept(evidence: Parameters<ProviderFeedRegistry["accept"]>[0]) {
    if (evidence.kind === "CATALOG" && evidence.sourceId === this.rejectSourceId) {
      return { accepted: false, publish: null, stateChanged: false } as const;
    }
    return super.accept(evidence);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("ChromeCatalogDataPlane", () => {
  it("publishes an APSPORT API baseline and applies a later socket price without DOM authority", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, publish });

    expect(plane.ingest(apsportApiEnvelope(1, [apsportRawEvent(501)]))).toBe(true);
    expect((await plane.read(APSPORT)).quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "501", rawOdds: "0.83" })
    ]));

    expect(plane.ingest(apsportWsEnvelope(2, apsportRawEvent(501, "0.66")))).toBe(true);
    expect((await plane.read(APSPORT)).quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "501", rawOdds: "0.66", sequence: 2 })
    ]));
    now = 60_500;
    expect(plane.ingest({ ...apsportWsEnvelope(3, apsportRawEvent(501, "0.66")),
      observedAtMs: now })).toBe(false);
    expect(publish).toHaveBeenCalledTimes(2);
    now = 61_100;
    await expect(plane.read(APSPORT)).resolves.toMatchObject({ provider: "APSPORT" });
  });

  it("promotes a late-attached SABA candidate from two stable complete DOM generations", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 100_002 });
    const onIngestRejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 100_002,
      authorityCoordinator: coordinator, feedRegistry: feeds, onIngestRejected });

    expect(plane.ingest(sabaDomEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    const accepted = plane.ingest(sabaDomEnvelope(2), { connectionGeneration: 1 });
    expect(onIngestRejected.mock.calls.map((call) => call[1])).toEqual([
      "ADAPTER_DECODE_EMPTY:saba-ws-catalog-v1"
    ]);
    expect(accepted).toBe(true);
    expect(coordinator.snapshot(SABA)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0" }),
      candidate: null
    });
    expect(feeds.snapshot(SABA)).toMatchObject({
      state: "LIVE", activeGeneration: "worker-a:0:dom:2"
    });
    await expect(plane.read(SABA)).resolves.toMatchObject({ provider: "SABA", events: expect.any(Array) });
  });

  it("keeps an active SABA DOM generation when a non-authoritative socket frame is malformed", async () => {
    const feeds = new ProviderFeedRegistry({ now: () => 100_002 });
    const plane = new ChromeCatalogDataPlane({ now: () => 100_002, feedRegistry: feeds });

    expect(plane.ingest(sabaDomEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaDomEnvelope(2), { connectionGeneration: 1 })).toBe(true);
    expect(feeds.snapshot(SABA).activeGeneration).toBe("worker-a:0:dom:2");

    expect(plane.ingest(sabaPushOpen(3, "1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushEnvelope(4, "1", '42["m","b1",[],1,"extra"]'),
      { connectionGeneration: 1 })).toBe(false);
    expect(feeds.snapshot(SABA)).toMatchObject({
      state: "LIVE", activeGeneration: "worker-a:0:dom:2"
    });
    await expect(plane.read(SABA)).resolves.toMatchObject({ provider: "SABA" });
  });

  it("keeps an active SABA DOM generation when its non-authoritative socket closes", async () => {
    const feeds = new ProviderFeedRegistry({ now: () => 100_002 });
    const plane = new ChromeCatalogDataPlane({ now: () => 100_002, feedRegistry: feeds });

    expect(plane.ingest(sabaDomEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaDomEnvelope(2), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(sabaPushOpen(3, "1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushEnvelope(4, "1", '{"state":"CLOSED"}', "WS_STATE"),
      { connectionGeneration: 1 })).toBe(false);

    expect(feeds.snapshot(SABA)).toMatchObject({
      state: "LIVE", activeGeneration: "worker-a:0:dom:2"
    });
    await expect(plane.read(SABA)).resolves.toMatchObject({ provider: "SABA" });
  });

  it("keeps unbound HTTP candidate evidence out of authority and decoder state", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 1_500 });
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish });
    const http = cmdHttpEnvelope(1);
    const { requestFrameKey: _frame, requestDocumentKey: _document, ...unboundRequest } = http.request;

    expect(plane.ingest({ ...http, request: unboundRequest } as ChromeBridgeEnvelope,
      { connectionGeneration: 1 })).toBe(false);
    expect(feeds.snapshot(CMD)).toMatchObject({ state: "STARTING", sourceId: null, sourceEpoch: null });
    expect(coordinator.snapshot(CMD)).toMatchObject({ active: null,
      candidate: expect.objectContaining({ sourceId: "chrome:CMD:9" }) });
    expect(publish).not.toHaveBeenCalled();

    expect(plane.ingest(cmdHttpEnvelope(2), { connectionGeneration: 1 })).toBe(true);
    await expect(plane.read(CMD)).resolves.toMatchObject({ provider: "CMD" });
  });

  it("keeps a DOM-only CMD candidate lane-local until a newer HTTP candidate proves authority", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 1_500 });
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish });

    expect(plane.ingest(cmdEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    expect(coordinator.snapshot(CMD)).toMatchObject({
      active: null,
      candidate: expect.objectContaining({ sourceId: "chrome:CMD:9" })
    });
    expect(feeds.snapshot(CMD)).toMatchObject({ state: "STARTING", sourceId: null, sourceEpoch: null });
    expect(() => feeds.read(CMD)).toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(publish).not.toHaveBeenCalled();

    const network = { ...cmdHttpEnvelope(10), sourceId: "chrome:CMD:10", tabId: 10,
      sourceEpoch: "worker-b:0", request: { ...cmdHttpEnvelope(10).request,
        observerRequestId: "observer-a:request:10", requestFrameKey: "http-frame:cmd-replacement",
        requestDocumentKey: "http-document:cmd-replacement" } };
    expect(plane.ingest(network, { connectionGeneration: 2 })).toBe(true);
    expect(coordinator.snapshot(CMD)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:CMD:10", connectionGeneration: 2 }),
      candidate: null
    });
    await expect(plane.read(CMD)).resolves.toMatchObject({ provider: "CMD" });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("atomically aligns registry, data, feed, and control ownership before active routing", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const budget = new NetworkBodyAssemblyBudget();
    const registry = new ChromeBridgeRegistry({ now: () => 1_500, authorityCoordinator: coordinator });
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      networkBodyBudget: budget });
    const control = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const connection = {};
    const socket = { send: vi.fn(), readyState: 1 };
    registry.subscribe((envelope, context) => { plane.ingest(envelope, context); });
    const ingest = (envelope: ChromeBridgeEnvelope) => {
      const result = registry.ingestDetailed(envelope, connection);
      if (result.context !== null) {
        control.attachAuthority(result.context.authorityIdentity, result.context.authorityObservation,
          envelope.lobby, socket);
      }
      return result;
    };

    expect(ingest(ksportEnvelope(1, "live", [101], "worker-a:0", 1)).control)
      .toMatchObject({ kind: "ACK" });
    expect(registry.listActiveSources()).toEqual([]);
    expect(control.requestAllSnapshots()).toBe(0);

    expect(ingest(ksportEnvelope(2, "today", [], "worker-a:0", 1)).control)
      .toMatchObject({ kind: "ACK" });
    expect(coordinator.snapshot(SBOBET).candidate).toBeNull();
    expect(registry.listActiveSources()).toEqual([expect.objectContaining({
      sourceId: "chrome:KSPORT:8", authorityDisposition: "ACTIVE"
    })]);
    socket.send.mockClear();
    expect(control.requestAllSnapshots()).toBe(1);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:KSPORT:8" }));
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });

    ingest(chunkedNetworkBody(ksportHttpEnvelope(3, "live", 2, [202]), 3, 0,
      "active-body-released-with-connection"));
    expect(budget.stats()).toMatchObject({ pendingBodies: 1 });
    registry.releaseConnection(connection);
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("attaches a one-envelope HTTP candidate control target before publishing its promotion", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 1_500 });
    const registry = new ChromeBridgeRegistry({ now: () => 1_500, authorityCoordinator: coordinator });
    const control = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const socket = { send: vi.fn(), readyState: 1 };
    const observations: Array<{ readonly activeSourceId: string | null; readonly controlRequests: number;
      readonly controlTarget: string | null }> = [];
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish: () => {
        const controlRequests = control.requestAllSnapshots();
        const sent = socket.send.mock.calls.at(-1)?.[0];
        observations.push({ activeSourceId: coordinator.snapshot(CMD).active?.sourceId ?? null,
          controlRequests, controlTarget: typeof sent === "string" ? JSON.parse(sent).sourceId as string : null });
      } });
    registry.subscribe((envelope, context) => { plane.ingest(envelope, context); });
    const connection = {};

    expect(registry.ingestDetailed(cmdHttpEnvelope(1), connection, (context) => {
      control.attachAuthority(context.authorityIdentity, context.authorityObservation, "CMD", socket);
    }).control).toMatchObject({ kind: "ACK" });

    expect(observations).toEqual([{ activeSourceId: "chrome:CMD:9", controlRequests: 1,
      controlTarget: "chrome:CMD:9" }]);
  });

  it("keeps bootstrap evidence candidate-only and promotes only its complete catalog proof", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator });
    const live = ksportEnvelope(1, "live", [101], "worker-a:0", 1);

    expect(plane.ingest(tabHeartbeat(live, 1_001, 0), { connectionGeneration: 1 })).toBe(false);
    expect(coordinator.snapshot(SBOBET)).toMatchObject({
      active: null,
      candidate: expect.objectContaining({ sourceId: "chrome:KSPORT:8", sourceEpoch: "worker-a:0" })
    });
    expect(plane.ingest(live, { connectionGeneration: 1 })).toBe(false);
    expect(coordinator.snapshot(SBOBET).active).toBeNull();

    expect(plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0", 1),
      { connectionGeneration: 1 })).toBe(true);
    expect(coordinator.snapshot(SBOBET)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:KSPORT:8", connectionGeneration: 1 }),
      candidate: null,
      activeLaneToken: expect.objectContaining({ phase: "ACTIVE" })
    });
    await expect(plane.read(SBOBET)).resolves.toMatchObject({ accountId: SBOBET });
  });

  it("flushes replacement promotion only after coordinator and LIVE feed both point at the winner", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 1_500 });
    const published: Array<{ readonly sourceId: string | null; readonly activeSourceId: string | null }> = [];
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish: () => published.push({ sourceId: feeds.snapshot(SBOBET).sourceId,
        activeSourceId: coordinator.snapshot(SBOBET).active?.sourceId ?? null }) });
    plane.ingest(ksportEnvelope(1, "live", [101]), { connectionGeneration: 1 });
    expect(plane.ingest(ksportEnvelope(2, "today", []), { connectionGeneration: 1 })).toBe(true);
    published.length = 0;
    const observed: Array<{ readonly state: string; readonly sourceId: string | null;
      readonly activeSourceId: string | null; readonly readableEventId: string | null }> = [];
    feeds.subscribe((snapshot) => {
      let readableEventId: string | null = null;
      try { readableEventId = feeds.read(SBOBET).events[0]?.providerEventId ?? null; } catch { /* fail closed */ }
      observed.push({ state: snapshot.state, sourceId: snapshot.sourceId,
        activeSourceId: coordinator.snapshot(SBOBET).active?.sourceId ?? null, readableEventId });
    });

    const replacement = (sequence: number, partition: "live" | "today",
      eventIds: readonly number[], generation: number): ChromeBridgeEnvelope =>
      ksportHttpEnvelope(sequence, partition, generation, eventIds, "chrome:KSPORT:9", 9, "worker-b:0");
    expect(plane.ingest(replacement(3, "live", [202], 2),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(replacement(4, "today", [], 2),
      { connectionGeneration: 2 })).toBe(true);

    expect(observed).toEqual([{ state: "LIVE", sourceId: "chrome:KSPORT:9",
      activeSourceId: "chrome:KSPORT:9", readableEventId: "202" }]);
    expect(published).toEqual([{ sourceId: "chrome:KSPORT:9", activeSourceId: "chrome:KSPORT:9" }]);
  });

  it("rolls back feed and authority state when the prepared candidate baseline cannot commit", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new RejectingPromotionFeedRegistry({ now: () => 1_500 });
    const registry = new ChromeBridgeRegistry({ now: () => 1_500, authorityCoordinator: coordinator });
    const control = new ChromeBridgeControlPlane({ authorityCoordinator: coordinator });
    const activeSocket = { send: vi.fn(), readyState: 1 };
    const candidateSocket = { send: vi.fn(), readyState: 1 };
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish });
    registry.subscribe((envelope, context) => { plane.ingest(envelope, context); });
    const activeConnection = {};
    const candidateConnection = {};
    const ingest = (envelope: ChromeBridgeEnvelope, connection: object,
      socket: typeof activeSocket) => registry.ingestDetailed(envelope, connection, (context) => {
        control.attachAuthority(context.authorityIdentity, context.authorityObservation, envelope.lobby, socket);
      });
    ingest(ksportEnvelope(1, "live", [101]), activeConnection, activeSocket);
    expect(ingest(ksportEnvelope(2, "today", []), activeConnection, activeSocket).control)
      .toMatchObject({ kind: "ACK" });
    publish.mockClear();
    feeds.rejectSourceId = "chrome:KSPORT:9";

    const replacement = (sequence: number, partition: "live" | "today",
      eventIds: readonly number[]): ChromeBridgeEnvelope =>
      ksportHttpEnvelope(sequence, partition, 2, eventIds, "chrome:KSPORT:9", 9, "worker-b:0");
    ingest(replacement(3, "live", [202]), candidateConnection, candidateSocket);
    expect(ingest(replacement(4, "today", []),
      candidateConnection, candidateSocket).control).toMatchObject({ kind: "ACK" });

    expect(coordinator.snapshot(SBOBET)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:KSPORT:8" }),
      candidate: expect.objectContaining({ sourceId: "chrome:KSPORT:9" })
    });
    expect(registry.listActiveSources()).toEqual([expect.objectContaining({ sourceId: "chrome:KSPORT:8" })]);
    expect(registry.listSources()).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "chrome:KSPORT:8", authorityDisposition: "ACTIVE" }),
      expect.objectContaining({ sourceId: "chrome:KSPORT:9", authorityDisposition: "CANDIDATE" })
    ]));
    activeSocket.send.mockClear();
    candidateSocket.send.mockClear();
    expect(control.requestAllSnapshots()).toBe(1);
    expect(activeSocket.send).toHaveBeenCalledWith(JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:KSPORT:8" }));
    expect(candidateSocket.send).not.toHaveBeenCalled();
    expect(feeds.snapshot(SBOBET)).toMatchObject({ state: "LIVE", sourceId: "chrome:KSPORT:8" });
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("restores catalog, coverage, and pipeline pointers after a defensive post-swap rollback", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 1_500 });
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      feedRegistry: feeds, publish });
    plane.ingest(ksportEnvelope(1, "live", [101]), { connectionGeneration: 1 });
    expect(plane.ingest(ksportEnvelope(2, "today", []), { connectionGeneration: 1 })).toBe(true);
    publish.mockClear();

    const originalDispose = NetworkBodyAssembler.prototype.dispose;
    let injectFailure = true;
    vi.spyOn(NetworkBodyAssembler.prototype, "dispose").mockImplementation(function (this: NetworkBodyAssembler) {
      if (injectFailure && this.authorityLaneToken?.phase === "CANDIDATE") {
        injectFailure = false;
        throw new Error("post-swap-fault");
      }
      return originalDispose.call(this);
    });
    const replacement = (sequence: number, partition: "live" | "today",
      eventIds: readonly number[], generation: number): ChromeBridgeEnvelope =>
      ksportHttpEnvelope(sequence, partition, generation, eventIds, "chrome:KSPORT:9", 9, "worker-b:0");
    plane.ingest(replacement(3, "live", [202], 2), { connectionGeneration: 2 });
    expect(plane.ingest(replacement(4, "today", [], 2),
      { connectionGeneration: 2 })).toBe(false);

    expect(coordinator.snapshot(SBOBET)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:KSPORT:8" }),
      candidate: expect.objectContaining({ sourceId: "chrome:KSPORT:9" })
    });
    expect(feeds.snapshot(SBOBET)).toMatchObject({ state: "LIVE", sourceId: "chrome:KSPORT:8" });
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });
    expect(publish).not.toHaveBeenCalled();

    expect(plane.ingest(replacement(5, "live", [303], 3),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(replacement(6, "today", [], 3),
      { connectionGeneration: 2 })).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "303" })]
    });
  });

  it("disposes every pending candidate body when the completed promotion body wins CAS", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const budget = new NetworkBodyAssemblyBudget();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      networkBodyBudget: budget });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0", 1), { connectionGeneration: 1 });
    expect(plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0", 1),
      { connectionGeneration: 1 })).toBe(true);

    const replacementHttp = ksportHttpEnvelope(3, "live", 2, [202],
      "chrome:KSPORT:9", 9, "worker-b:0");
    expect(plane.ingest(chunkedNetworkBody(replacementHttp, 3, 0, "candidate-unrelated-pending"),
      { connectionGeneration: 2 })).toBe(false);
    expect(budget.stats()).toMatchObject({ pendingBodies: 1 });
    expect(coordinator.snapshot(SBOBET).active?.sourceId).toBe("chrome:KSPORT:8");

    expect(plane.ingest(ksportHttpEnvelope(4, "live", 2, [202], "chrome:KSPORT:9", 9, "worker-b:0"),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(ksportHttpEnvelope(5, "today", 2, [], "chrome:KSPORT:9", 9, "worker-b:0"),
      { connectionGeneration: 2 })).toBe(true);
    expect(coordinator.snapshot(SBOBET).active?.sourceId).toBe("chrome:KSPORT:9");
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("resolves a recovery-owner wait through the injected shared registry", async () => {
    const registry = new ProviderFeedRegistry({ now: () => 1_500 });
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, feedRegistry: registry });
    const waiting = registry.waitForFreshBaseline(SBOBET, 1_000, 100);

    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));

    await expect(waiting).resolves.toMatchObject({ accountId: SBOBET, state: "LIVE",
      lastCompleteBaselineAtMs: 1_002 });
  });

  it("does not let a retired-epoch baseline poison coverage before a legitimate baseline", async () => {
    const poison = await catalogWith([999]);
    const legitimate = await catalogWith([101, 102]);
    const registry = new ProviderFeedRegistry({ now: () => 1_500 });
    registry.accept({ kind: "TAB_REACHABLE", accountId: SBOBET, sourceId: "chrome:KSPORT:8",
      sourceEpoch: "worker-a:0", atMs: 900 });
    registry.accept({ kind: "INVALIDATE", accountId: SBOBET, sourceId: "chrome:KSPORT:8",
      sourceEpoch: "worker-a:0", atMs: 950, reason: "SOURCE_REPLACED" });
    vi.spyOn(KsportWsCatalogAdapter.prototype, "decode")
      .mockReturnValueOnce(decodedBaseline("chrome:KSPORT:8", poison, 1))
      .mockReturnValueOnce(decodedBaseline("chrome:KSPORT:9", legitimate, 2));
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, feedRegistry: registry });

    expect(plane.ingest(ksportEnvelope(1, "live", [999], "worker-a:0"))).toBe(false);
    expect(plane.ingest(ksportHttpEnvelope(2, "live", 1, [101, 102],
      "chrome:KSPORT:9", 9, "worker-b:0"))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" }),
        expect.objectContaining({ providerEventId: "102" })]
    });
  });

  it("does not let a competing-source baseline poison current-source coverage", async () => {
    const poison = await catalogWith([999]);
    const legitimate = await catalogWith([101, 102]);
    const registry = new ProviderFeedRegistry({ now: () => 1_500 });
    vi.spyOn(KsportWsCatalogAdapter.prototype, "decode")
      .mockReturnValueOnce(decodedBaseline("chrome:KSPORT:99", poison, 1))
      .mockReturnValueOnce(decodedBaseline("chrome:KSPORT:8", legitimate, 2));
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, feedRegistry: registry });

    expect(plane.ingest(ksportEnvelope(1, "live", [999]))).toBe(false);
    expect(plane.ingest(ksportEnvelope(2, "live", [101, 102]))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" }),
        expect.objectContaining({ providerEventId: "102" })]
    });
  });

  it("owns exactly the six configured Football feeds", () => {
    const plane = new ChromeCatalogDataPlane();
    expect(["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"]
      .every((provider) => plane.owns(`catalog-source:${provider}:FOOTBALL`))).toBe(true);
    expect(plane.owns("unrelated-account")).toBe(false);
  });

  it("publishes and serves a complete authoritative KSPORT baseline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    expect(plane.ingest(ksportEnvelope(1, "live", [101]))).toBe(false);
    expect(plane.ingest(ksportEnvelope(2, "today", [102]))).toBe(true);

    await expect(plane.read(SBOBET)).resolves.toMatchObject({ provider: "SBOBET" });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ accountId: SBOBET }), "FRESH");
    await expect(plane.overlayStatuses([activeSbobet])).resolves.toMatchObject([{
      sessionState: "ACTIVE", acquiredAtMs: 1_002, reason: null
    }]);
  });

  it("keeps replayed KSPORT partitions fail-closed until a fresh baseline completes", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });

    expect(plane.ingest(replayedEnvelope(ksportEnvelope(1, "live", [101], "worker-a:0", 100))))
      .toBe(false);
    expect(plane.ingest(replayedEnvelope(ksportEnvelope(2, "today", [], "worker-a:0", 100))))
      .toBe(false);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(plane.ingest(ksportEnvelope(3, "live", [102], "worker-a:0", 100))).toBe(false);
    expect(plane.ingest(ksportEnvelope(4, "today", [], "worker-a:0", 100))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "102" })]
    });
  });

  it("rejects replay before source admission, body assembly, routing, or adapter state", () => {
    const decode = vi.spyOn(KsportWsCatalogAdapter.prototype, "decode");
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });

    expect(plane.ingest(replayedEnvelope(ksportEnvelope(1, "live", [101], "worker-b:1", 100)),
      { connectionGeneration: 2 })).toBe(false);

    expect(decode).not.toHaveBeenCalled();
  });

  it("does not promote a replacement candidate from replayed KSPORT partitions", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0", 100), { connectionGeneration: 1 });
    plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0", 100), { connectionGeneration: 1 });
    const candidate = (sequence: number, partition: "live" | "today",
      eventIds: readonly number[], generation: number): ChromeBridgeEnvelope =>
      ksportHttpEnvelope(sequence, partition, generation, eventIds, "chrome:KSPORT:9", 9, "worker-b:0");

    expect(plane.ingest(replayedEnvelope(candidate(3, "live", [999], 1)),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(replayedEnvelope(candidate(4, "today", [], 1)),
      { connectionGeneration: 2 })).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });

    expect(plane.ingest(candidate(5, "live", [103], 2),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(candidate(6, "today", [], 2),
      { connectionGeneration: 2 })).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "103" })]
    });
  });

  it("shares one multipart budget while candidate rotation retires the prior pending body", async () => {
    const budget = new NetworkBodyAssemblyBudget({
      maxPendingBodies: 1, maxPendingBytes: 1_000_000, now: () => 1_500
    });
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500,
      networkBodyBudget: budget } as ConstructorParameters<typeof ChromeCatalogDataPlane>[0]);
    const current = cmdHttpEnvelope(1, { t: 100 });
    const candidate = { ...cmdHttpEnvelope(2, { t: 200 }), sourceId: "chrome:CMD:10", tabId: 10,
      sourceEpoch: "worker-a:1" };

    expect(plane.ingest(chunkedNetworkBody(current, 1, 0, "network-shared-lane-current"),
      { connectionGeneration: 1 })).toBe(false);
    expect(budget.stats().pendingBodies).toBe(1);
    expect(plane.ingest(chunkedNetworkBody(candidate, 2, 0, "network-shared-lane-candidate"),
      { connectionGeneration: 1 })).toBe(false);
    expect(budget.stats().pendingBodies).toBe(1);
    expect(plane.ingest(chunkedNetworkBody(current, 3, 1, "network-shared-lane-current"),
      { connectionGeneration: 1 })).toBe(false);
    expect(budget.stats().pendingBodies).toBe(1);
    expect(plane.ingest(chunkedNetworkBody(candidate, 4, 1, "network-shared-lane-candidate"),
      { connectionGeneration: 1 })).toBe(true);
    expect(budget.stats()).toMatchObject({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("never assembles KSPORT HTTP authority from mixed current/candidate chunks in either direction", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0", 100), { connectionGeneration: 1 });
    plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0", 100), { connectionGeneration: 1 });
    const current = (sequence: number, generation: number, eventId: number) =>
      ksportHttpEnvelope(sequence, "live", generation, [eventId]);
    const candidate = (sequence: number, partition: "live" | "today", generation: number,
      eventIds: readonly number[]) => ksportHttpEnvelope(sequence, partition, generation, eventIds,
        "chrome:KSPORT:9", 9, "worker-a:1");

    // Candidate first + current final cannot form a candidate baseline.
    const candidateLive1 = candidate(3, "live", 1, [901]);
    expect(plane.ingest(chunkedNetworkBody(candidateLive1, 3, 0, "network-mixed-candidate-1"),
      { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(chunkedNetworkBody(current(4, 1, 901), 4, 1, "network-mixed-candidate-1"),
      { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(candidate(5, "today", 1, []), { connectionGeneration: 1 })).toBe(false);

    // Current first + candidate final is equally non-authorizing.
    const currentLive2 = current(6, 2, 902);
    expect(plane.ingest(chunkedNetworkBody(currentLive2, 6, 0, "network-mixed-current-2"),
      { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(chunkedNetworkBody(candidate(7, "live", 2, [902]), 7, 1,
      "network-mixed-current-2"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(candidate(8, "today", 2, []), { connectionGeneration: 1 })).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });

    // Independent, wholly candidate-owned partitions still recover normally.
    expect(plane.ingest(candidate(9, "live", 3, [903]), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(candidate(10, "today", 3, []), { connectionGeneration: 1 })).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "903" })]
    });
  });

  it("keeps the committed SBOBET catalog until a complete empty replacement baseline commits", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(plane.ingest(ksportEnvelope(1, "live", [101]))).toBe(false);
    expect(plane.ingest(ksportEnvelope(2, "today", []))).toBe(true);

    expect(plane.ingest(ksportEnvelope(3, "live", []))).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });

    expect(plane.ingest(ksportEnvelope(4, "today", []))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      observedAtMs: 1_004, events: [], markets: [], quotes: []
    });
  });

  it("does not let the legacy SBOBET Socket.IO route bypass KSPORT baseline proof", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });

    expect(plane.ingest(legacySbobetSocketIoEnvelope(1))).toBe(false);
    expect(plane.ingest({ ...legacySbobetSocketIoEnvelope(2), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } })).toBe(false);
    expect(plane.ingest(legacySbobetSocketIoEnvelope(3))).toBe(false);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(plane.ingest(ksportEnvelope(4, "live", [101]))).toBe(false);
    expect(plane.ingest(ksportEnvelope(5, "today", [], "worker-a:0", 2))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("never reports ACTIVE when the same provider feed is too stale to read", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));
    // SBOBET now expects evidence once a minute (measured 2026-08-30); the
    // feed only leaves LIVE after that window passes with nothing decoded.
    now = 65_003;

    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    await expect(plane.overlayStatuses([activeSbobet])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED", acquiredAtMs: 1_002, reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("does not report SABA active when only TAB_STATE heartbeats follow a stale restored catalog", async () => {
    const seed = new ChromeCatalogDataPlane({ now: () => 1_500 });
    seed.ingest(ksportEnvelope(1, "live", [101]));
    seed.ingest(ksportEnvelope(2, "today", [102]));
    const restored = await seed.read(SBOBET);
    const plane = new ChromeCatalogDataPlane({ now: () => 10_000 });
    plane.restore({ ...restored, accountId: SABA, provider: "SABA", observedAtMs: 100 });
    plane.ingest(tabHeartbeat(sabaEnvelope(2, []), 10_000, 3));

    await expect(plane.read(SABA)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    await expect(plane.overlayStatuses([activeSaba])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED", reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("renews authority only from a provider-decoded transport heartbeat", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));

    now = 50_000;
    expect(plane.ingest({ ...ksportEnvelope(3, "today", []), observedAtMs: now,
      payload: { encoding: "UTF8", body: `a${JSON.stringify(["\n"])}` } })).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({ observedAtMs: 1_002 });

    now = 125_001;
    plane.ingest(tabHeartbeat(ksportEnvelope(4, "today", []), now, 4));
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("keeps the current epoch live until a replacement source completes an authoritative baseline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0"), { connectionGeneration: 1 });
    plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0"), { connectionGeneration: 1 });

    expect(plane.ingest(tabHeartbeat(ksportEnvelope(3, "today", [], "worker-a:0"),
      1_100, 3, "worker-b:0"), { connectionGeneration: 2 })).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({ observedAtMs: 1_002,
      events: [expect.objectContaining({ providerEventId: "101" })] });

    expect(plane.ingest(ksportEnvelope(4, "live", [103], "worker-b:0"),
      { connectionGeneration: 2 })).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({ observedAtMs: 1_002,
      events: [expect.objectContaining({ providerEventId: "101" })] });
    expect(plane.ingest(ksportEnvelope(5, "today", [], "worker-b:0", 2),
      { connectionGeneration: 2 })).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "FRESH"]);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "103" })]
    });
  });

  it("retains a same-lineage high-watermark across bridge connections and rejects rollback before mutation",
    async () => {
      const publish = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
      const current = { ...cmdHttpEnvelope(1, { t: 133 }), sourceEpoch: "observer-a:33" };
      expect(plane.ingest(current, { connectionGeneration: 1 })).toBe(true);

      const rollback = { ...cmdHttpEnvelope(2, { t: 100 }), sourceEpoch: "observer-a:0" };
      expect(plane.ingest(rollback, { connectionGeneration: 2 })).toBe(false);
      expect(plane.ingest(tabHeartbeat(rollback, 1_003, 3), { connectionGeneration: 2 })).toBe(false);
      expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);
      await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_001 });
    });

  it("keeps the same source epoch authoritative across a newer bridge connection", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const first = { ...cmdHttpEnvelope(1, { t: 100 }), sourceEpoch: "worker-a:0" };
    const replacement = { ...cmdHttpEnvelope(2, { t: 200 }), sourceEpoch: "worker-a:0" };

    expect(plane.ingest(first, { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(replacement, { connectionGeneration: 2 })).toBe(true);
    expect(plane.ingest({ ...cmdHttpEnvelope(3, { t: 150 }), sourceEpoch: "worker-a:0" },
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest({ ...cmdHttpEnvelope(4, { t: 300 }), sourceEpoch: "worker-a:0" },
      { connectionGeneration: 1 })).toBe(false);

    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_002 });
    expect(publish.mock.calls.map((call) => call[0].observedAtMs)).toEqual([1_001, 1_002]);
  });

  it("rejects an explicitly malformed epoch before state mutation but keeps the absent legacy path compatible",
    async () => {
      const malformedPlane = new ChromeCatalogDataPlane({ now: () => 1_500 });
      expect(malformedPlane.ingest({ ...cmdHttpEnvelope(1, { t: 100 }), sourceEpoch: "observer-a:01" },
        { connectionGeneration: 1 })).toBe(false);
      await expect(malformedPlane.read("catalog-source:CMD:FOOTBALL"))
        .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
      expect(malformedPlane.ingest({ ...cmdHttpEnvelope(2, { t: 101 }), sourceEpoch: "observer-a:1" },
        { connectionGeneration: 1 })).toBe(true);

      const legacyPlane = new ChromeCatalogDataPlane({ now: () => 1_500 });
      const { sourceEpoch: _sourceEpoch, ...legacy } = cmdHttpEnvelope(1, { t: 100 });
      expect(legacyPlane.ingest(legacy as ChromeBridgeEnvelope, { connectionGeneration: 1 })).toBe(true);
      await expect(legacyPlane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_001 });
    });

  it("bounds account ownership across more than 128 source replacements and rejects the oldest connection", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    let current!: ChromeBridgeEnvelope;
    for (let generation = 0; generation < 130; generation += 1) {
      current = { ...cmdHttpEnvelope(generation + 1, { t: 1_000 + generation }),
        sourceId: `chrome:CMD:${generation + 1}`, tabId: generation + 1,
        sourceEpoch: `observer-${generation}:0` };
      expect(plane.ingest(current, { connectionGeneration: generation + 1 })).toBe(true);
    }

    const oldest = { ...cmdHttpEnvelope(200, { t: 999 }), sourceId: "chrome:CMD:1", tabId: 1,
      sourceEpoch: "observer-0:0" };
    expect(plane.ingest(tabHeartbeat(oldest, 1_400, 201), { connectionGeneration: 1 })).toBe(false);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_130 });
  });

  it("does not let source A re-enter after same-connection authoritative A to B to C recovery", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    for (let generation = 0; generation < 3; generation += 1) {
      const baseline = { ...cmdHttpEnvelope(generation + 1, { t: 200 + generation }),
        sourceId: `chrome:CMD:${generation + 7}`, tabId: generation + 7,
        sourceEpoch: `observer-a:${generation}` };
      expect(plane.ingest(baseline, { connectionGeneration: 1 })).toBe(true);
    }
    const lateA = { ...cmdHttpEnvelope(10, { t: 100 }), sourceId: "chrome:CMD:7", tabId: 7,
      sourceEpoch: "observer-a:0" };
    expect(plane.ingest(lateA, { connectionGeneration: 1 })).toBe(false);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_003 });
  });

  it("allows a current replacement connection to reuse a legacy source only after fencing its old connection",
    async () => {
      const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
      const { sourceEpoch: _sourceEpoch, ...legacyBase } = cmdHttpEnvelope(1, { t: 100 });
      const legacyA = legacyBase as ChromeBridgeEnvelope;
      expect(plane.ingest(legacyA, { connectionGeneration: 1 })).toBe(true);
      const baselineB = { ...cmdHttpEnvelope(2, { t: 200 }), sourceId: "chrome:CMD:10", tabId: 10,
        sourceEpoch: "observer-b:0" };
      expect(plane.ingest(baselineB, { connectionGeneration: 2 })).toBe(true);
      expect(plane.ingest({ ...legacyA, sequence: 3 }, { connectionGeneration: 1 })).toBe(false);

      const reconnectA = { ...legacyA, sequence: 4, observedAtMs: 1_004,
        payload: { encoding: "UTF8" as const, body: cmdHttpEnvelope(4, { t: 300 }).payload.body } };
      expect(plane.ingest(reconnectA, { connectionGeneration: 3 })).toBe(true);
      await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_004 });
    });

  it("rejects a retired source epoch before it can invalidate the current epoch", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const baselineA = { ...cmdHttpEnvelope(1, { t: 100 }), sourceEpoch: "worker-a:0" };
    const baselineB = { ...cmdHttpEnvelope(2, { t: 200 }), sourceEpoch: "worker-b:0" };

    expect(plane.ingest(baselineA, { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(baselineB, { connectionGeneration: 2 })).toBe(true);
    expect(plane.ingest(tabHeartbeat(baselineA, 1_003, 3, "worker-a:0"),
      { connectionGeneration: 1 })).toBe(false);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_002 });

    const deltaB: ChromeBridgeEnvelope = { ...baselineB, sequence: 4, observedAtMs: 1_004,
      request: { ...baselineB.request, providerFunctionCode: 3 },
      payload: { encoding: "UTF8", body: JSON.stringify({ t: 201, a: true,
        data: [[24881365, 1, 35, 0.80, -0.98, 1, 1, "S"]] }) } };
    expect(plane.ingest(deltaB, { connectionGeneration: 2 })).toBe(true);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_004 });
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "FRESH", "FRESH"]);
  });

  it("rejects the oldest same-lineage epoch after more than 32 replacements without losing the current feed",
    async () => {
      const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
      let current = cmdHttpEnvelope(1, { t: 100 });
      for (let generation = 0; generation <= 33; generation += 1) {
        current = { ...cmdHttpEnvelope(generation + 1, { t: 100 + generation }),
          sourceEpoch: `worker-a:${generation}` };
        expect(plane.ingest(current, { connectionGeneration: 1 })).toBe(true);
      }

      expect(plane.ingest(tabHeartbeat(current, 1_100, 100, "worker-a:0"),
        { connectionGeneration: 1 })).toBe(false);
      await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({
        observedAtMs: 1_034
      });
    });

  it("keeps one pinned tab per account until a competing candidate completes a baseline", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000, publish });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));
    const sboHeartbeat: ChromeBridgeEnvelope = { ...tabHeartbeat(ksportEnvelope(3, "today", []), now, 3),
      lobby: "SBO", sourceId: "chrome:SBO:9", tabId: 9 };

    expect(plane.ingest(sboHeartbeat)).toBe(false);
    now = 90_000;
    expect(plane.ingest({ ...sboHeartbeat, observedAtMs: now, sequence: 4 })).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("lets a new complete authoritative generation remove old events", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    const ten = Array.from({ length: 10 }, (_, index) => 5_600_000 + index);
    plane.ingest(ksportEnvelope(1, "live", ten));
    expect(plane.ingest(ksportEnvelope(2, "today", []))).toBe(true);

    expect(plane.ingest(ksportEnvelope(3, "live", [5_600_000]))).toBe(false);
    expect(plane.ingest(ksportEnvelope(4, "today", []))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [{ providerEventId: "5600000" }]
    });
  });

  it("keeps the HTTP-committed catalog live when a sports socket closes", async () => {
    // Measured 2026-08-30: the SBOBET page rotates /sport sockets freely and
    // their "snapshots" are fragments, so a socket close is not a catalog
    // fault. Only baseline expiry or an explicit replacement retires it.
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    expect(plane.ingest(ksportEnvelope(2, "today", []))).toBe(true);
    const socket = ksportSocketEnvelope(3, "live", []);
    const closed: ChromeBridgeEnvelope = { ...socket, transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } };

    expect(plane.ingest(closed)).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });

    // A WS receipt after the baseline folds in as an upsert (here: a second
    // market group on the same event); it never owns the catalog, so the
    // feed keeps the HTTP generation.
    expect(plane.ingest(ksportSocketEnvelope(4, "live", [101]))).toBe(true);
    const folded = await plane.read(SBOBET);
    expect(folded.events).toHaveLength(1);
    expect(folded.markets).toHaveLength(2);
  });

  it("requests controller-governed recovery without heartbeat freshness maps", async () => {
    let now = 1_500;
    const onSourceRecoveryNeeded = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, onSourceRecoveryNeeded });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));

    now = 62_004;
    plane.ingest(tabHeartbeat(ksportEnvelope(3, "today", []), now, 3));
    expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith(SBOBET);
    await plane.overlayStatuses([activeSbobet]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(1);

    // The hard stage reloads the tab, so it is gated on the provider's own
    // hard window rather than a fixed offset.
    now = 1_500 + providerFeedPolicies.get(SBOBET)!.hardRecoveryAfterMs + 1;
    await plane.overlayStatuses([activeSbobet]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(2);
  });

  it("recovers a malformed current SABA stream without promoting its retired frames", async () => {
    let now = 100_002;
    const onSourceRecoveryNeeded = vi.fn();
    const registry = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: registry,
      onSourceRecoveryNeeded });

    expect(plane.ingest(sabaPushOpen(1, "1"))).toBe(false);
    expect(plane.ingest(sabaPushBaseline(2, "1"))).toBe(true);
    await expect(plane.read(SABA)).resolves.toMatchObject({ provider: "SABA", observedAtMs: 100_002 });

    now = 100_003;
    const malformed = sabaPushEnvelope(3, "1",
      `42${JSON.stringify(["m", "b1", [[999, "o"]], "revision-3"])}`);
    expect(plane.ingest(malformed)).toBe(true);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "STALLED", reason: "SCHEMA_CHANGED",
      sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0", lastAuthoritativeEvidenceAtMs: null,
      activeGeneration: null, recoveryStage: "NONE" });
    await expect(plane.read(SABA)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(plane.ingest(sabaPushEnvelope(4, "1", '42["m","b1",[],1,"extra"]'))).toBe(false);
    expect(plane.ingest(sabaPushEnvelope(5, "1", "2"))).toBe(false);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "STALLED",
      providerTransportAtMs: null, lastAuthoritativeEvidenceAtMs: null, recoveryAttempt: 0 });

    now = 190_003;
    await plane.overlayStatuses([activeSaba]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith(SABA);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "SOFT_RECOVERY",
      recoveryStage: "SOFT", recoveryAttempt: 1 });

    now = 280_003;
    await plane.overlayStatuses([activeSaba]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(2);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "HARD_RECOVERY",
      recoveryStage: "HARD", recoveryAttempt: 2 });

    now = 280_009;
    expect(plane.ingest({ ...sabaPushOpen(6, "2"), observedAtMs: 280_008 })).toBe(false);
    expect(plane.ingest({ ...sabaPushBaseline(7, "2"), observedAtMs: 280_009 })).toBe(true);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "LIVE", reason: null,
      sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0", recoveryStage: "NONE",
      recoveryAttempt: 0, activeGeneration: "worker-a:0:saba:2:7" });
    await expect(plane.read(SABA)).resolves.toMatchObject({ observedAtMs: 280_009 });
  });

  it("does not request recovery for a provider with no tab or feed evidence", async () => {
    const onSourceRecoveryNeeded = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 900_000, onSourceRecoveryNeeded });
    await plane.overlayStatuses([activeSaba, activeSbobet]);
    expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();
  });

  it("keeps a candidate tab out of active feed recovery until catalog promotion", async () => {
    let now = 0;
    const onSourceRecoveryNeeded = vi.fn();
    const registry = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: registry, onSourceRecoveryNeeded });

    now = 100_000;
    await plane.overlayStatuses([activeSaba]);
    expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();

    now = 100_001;
    plane.ingest(tabHeartbeat(sabaEnvelope(1, []), now, 2));

    expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();
    expect(registry.snapshot(SABA)).toMatchObject({ state: "STARTING", recoveryStage: "NONE",
      recoveryAttempt: 0, sourceId: null });
  });

  it("drops expired and incomplete CMD observations without making them live", async () => {
    const publish = vi.fn();
    const expired = new ChromeCatalogDataPlane({ now: () => 40_001, maxEnvelopeAgeMs: 30_000, publish });
    expect(expired.ingest(cmdEnvelope())).toBe(false);
    await expect(expired.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const partial = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const id = "cmd:9:dataplane-chunked-0001";
    expect(partial.ingest(cmdEnvelope(1, [record], 0, 2, id))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(partial.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("keeps a newer authenticated CMD baseline authoritative when a visible DOM fallback arrives", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    expect(plane.ingest(cmdHttpEnvelope())).toBe(true);
    expect(plane.ingest({ ...cmdEnvelope(2), sourceEpoch: "worker-a:0" })).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "CMD",
      events: [expect.objectContaining({ providerEventId: "24881365" })] }), "FRESH");
  });

  it("recovers a CMD provider gap in the same source epoch and rejects a late pre-gap full", async () => {
    let now = 1_100;
    const registry = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: registry });
    expect(plane.ingest(cmdHttpEnvelope(1, { t: 100 }))).toBe(true);
    expect(plane.ingest(cmdHttpEnvelope(2, { t: 110, a: false, providerFunctionCode: 3 }))).toBe(true);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(plane.ingest(cmdHttpEnvelope(3, { t: 105 }))).toBe(false);
    now = 1_200;
    expect(plane.ingest(cmdHttpEnvelope(4, { t: 111 }))).toBe(true);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ provider: "CMD" });
    expect(registry.snapshot("catalog-source:CMD:FOOTBALL")).toMatchObject({
      state: "LIVE", sourceEpoch: "worker-a:0", activeGeneration: "cmd:111"
    });
  });

  it("publishes a stale CMD DOM overlay after the configured evidence cadence expires", async () => {
    const policy = providerFeedPolicies.get(CMD)!;
    let now = 1_100;
    const publish = vi.fn();
    const registry = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: registry, publish });
    expect(plane.ingest(cmdHttpEnvelope(1))).toBe(true);
    now = 1_001 + policy.expectedEvidenceCadenceMs + 1;
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    const visible = { ...record, matchId: "24881365", leagueId: "318", leagueName: "Visible Premier",
      teamNames: ["Visible Newcastle", "Visible Liverpool"], groups: [{
        ...record.groups[0]!, odds: record.groups[0]!.odds.map((odd) => ({ ...odd,
          marketOddsId: "visible-ah", priceText: "0.55" }))
      }] };
    const dom = { ...cmdEnvelope(2, [visible], 0, 1, "cmd:9:visible-overlay-0001"),
      sourceEpoch: "worker-a:0", observedAtMs: now };
    expect(plane.ingest(dom)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ participantA: "Visible Newcastle" })],
      quotes: expect.arrayContaining([expect.objectContaining({ rawOdds: "-0.96", sequence: 1 })])
    }), "STALE");
    const calls = publish.mock.calls.length;
    expect(plane.ingest({ ...dom, sequence: 3, observedAtMs: now + 100 })).toBe(false);
    expect(publish).toHaveBeenCalledTimes(calls);
  });

  it("does not authorize malformed nonempty IM reconciliation partitions", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(plane.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100,
      sel: [{ eid: 1, malformed: true }] }))).toBe(false);
    expect(plane.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100, sel: [] }))).toBe(false);
    await expect(plane.read("catalog-source:IM:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("uses quiet IM transport through the configured cadence without extending maximum baseline age",
    async () => {
      const policy = providerFeedPolicies.get("catalog-source:IM:FOOTBALL")!;
      let now = 1_500;
      const publish = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => now, publish });
      const validEvent = { eid: 112516390, htn: "Monterrey", atn: "Nashville", cn: "Cup",
        edt: "1970-01-01T00:00:02.000Z", isrbt: false, iscyb: false, mls: [{ mi: 10, bti: 1, gp: 1,
          ws: [{ wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67 },
            { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79 }] }] };
      expect(plane.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100, sel: [validEvent] }))).toBe(false);
      expect(plane.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100, sel: [] }))).toBe(true);
      expect(publish).toHaveBeenCalledTimes(1);

      const baselineAtMs = 1_002;
      const effectiveCadenceMs = policy.expectedEvidenceCadenceMs / 3;
      let sequence = 3;
      for (let atMs = baselineAtMs + effectiveCadenceMs;
        atMs <= baselineAtMs + policy.maxBaselineAgeMs; atMs += effectiveCadenceMs) {
        now = atMs;
        expect(plane.ingest(imDeltaEnvelope(sequence, atMs, { StatusCode: 100, dc: [] }))).toBe(false);
        sequence += 1;
      }
      expect(publish).toHaveBeenCalledTimes(1);
      await expect(plane.read("catalog-source:IM:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_002 });

      now = baselineAtMs + policy.maxBaselineAgeMs + 1;
      await expect(plane.read("catalog-source:IM:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
      expect(publish).toHaveBeenCalledTimes(1);
    });

  it("does not publish or replace the IM catalog when a market delta repeats current values", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, publish });
    const validEvent = { eid: 112516390, htn: "Monterrey", atn: "Nashville", cn: "Cup",
      edt: "1970-01-01T00:00:02.000Z", isrbt: false, iscyb: false, mls: [{ mi: 10, bti: 1, gp: 1,
        ws: [{ wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67 },
          { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79 }] }] };
    expect(plane.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100, sel: [validEvent] }))).toBe(false);
    expect(plane.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100, sel: [] }))).toBe(true);
    const baseline = await plane.read("catalog-source:IM:FOOTBALL");
    expect(publish).toHaveBeenCalledTimes(1);

    now = 6_000;
    expect(plane.ingest(imDeltaEnvelope(3, now, { StatusCode: 100,
      dc: [{ eid: validEvent.eid, a: 3, v: structuredClone(validEvent.mls) }] }))).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    const retained = await plane.read("catalog-source:IM:FOOTBALL");
    expect(retained).toBe(baseline);
    expect(retained.observedAtMs).toBe(1_002);
  });

  it("does not authorize an unexplained iscyb-only IM partition or malformed Market 2", async () => {
    const publish = vi.fn();
    const onlyExcluded = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    expect(onlyExcluded.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100,
      sel: [{ iscyb: true }] }))).toBe(false);
    expect(onlyExcluded.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100, sel: [] }))).toBe(false);
    expect(publish).not.toHaveBeenCalledWith(expect.anything(), "FRESH");
    await expect(onlyExcluded.read("catalog-source:IM:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const validEvent = { eid: 112516390, htn: "Monterrey", atn: "Nashville", cn: "Cup",
      edt: "1970-01-01T00:00:02.000Z", isrbt: false, iscyb: false, mls: [{ mi: 10, bti: 1, gp: 1,
        ws: [{ wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67 },
          { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79 }] }] };
    const malformedSecond = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(malformedSecond.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100,
      sel: [validEvent] }))).toBe(false);
    expect(malformedSecond.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100,
      sel: [{ iscyb: true }] }))).toBe(false);
    await expect(malformedSecond.read("catalog-source:IM:FOOTBALL"))
      .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const malformedNested = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(malformedNested.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100,
      sel: [{ ...validEvent, iscyb: true, mls: [{}] }] }))).toBe(false);
    expect(malformedNested.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100,
      sel: [validEvent] }))).toBe(false);
    await expect(malformedNested.read("catalog-source:IM:FOOTBALL"))
      .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const characterizedExclusion = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(characterizedExclusion.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100,
      sel: [{ ...validEvent, eid: 112516391, iscyb: true }] }))).toBe(false);
    expect(characterizedExclusion.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100,
      sel: [validEvent] }))).toBe(true);
    await expect(characterizedExclusion.read("catalog-source:IM:FOOTBALL")).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "112516390" })]
    });
  });

  it("keeps CMD DOM-only additions and complete-sweep tombstones lane-local without publishing", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const second = { ...record, matchId: "event-2", teamNames: ["Gamma", "Delta"], groups: [{
      ...record.groups[0]!, odds: record.groups[0]!.odds.map((odd) => ({ ...odd, marketOddsId: "market-2" }))
    }] };
    expect(plane.ingest(cmdSweepEnvelope(1, [record], false, "cmd:9:dom-only-a-0001",
      "cmd:9:dom-only-prior"))).toBe(false);
    expect(plane.ingest(cmdSweepEnvelope(2, [second], true, "cmd:9:dom-only-b-0002",
      "cmd:9:dom-only-prior"))).toBe(false);
    expect(plane.ingest(cmdSweepEnvelope(3, [record], true, "cmd:9:dom-only-sweep-0003",
      "cmd:9:dom-only-next"))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read(CMD)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });
});
