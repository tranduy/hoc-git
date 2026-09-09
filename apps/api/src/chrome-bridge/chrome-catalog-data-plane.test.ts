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
const BTI = "catalog-source:BTI:FOOTBALL";

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
  transport: "WS_FRAME" | "WS_STATE" = "WS_FRAME", sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7,
    sourceEpoch, sequence, observedAtMs: 100_000 + sequence,
    receivedMonotonicMs: 50 + sequence, transport,
    request: { hostname: "sports.example", pathnameClass: "/socket.io/",
      resourceType: "WebSocket", streamId },
    payload: { encoding: "UTF8", body } };
}

function sabaPushOpen(sequence: number, streamId: string, sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope {
  return sabaPushEnvelope(sequence, streamId, '{"state":"OPEN"}', "WS_STATE", sourceEpoch);
}

function sabaPushBaseline(sequence: number, streamId: string, sourceEpoch = "worker-a:0", eventCount = 1): ChromeBridgeEnvelope {
  const encode = (record: Record<string, unknown>): readonly unknown[] => Object.entries(record)
    .flatMap(([key, value]) => [sabaPushFields.indexOf(key), value]);
  const rows = [["f", 0, sabaPushFields], [0, "reset"],
    encode({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
    ...Array.from({ length: eventCount }, (_, index) => [
      encode({ type: "m", matchid: index + 2, leagueid: 1, hteamnameen: `Home ${index}`, ateamnameen: `Away ${index}`,
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encode({ type: "o", oddsid: index + 3, matchid: index + 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 })
    ]).flat(),
    [0, "done"]];
  return sabaPushEnvelope(sequence, streamId,
    `42${JSON.stringify(["m", "b1", rows, `revision-${sequence}`])}`, "WS_FRAME", sourceEpoch);
}

function sabaDomEnvelope(sequence: number, sourceEpoch = "worker-a:0", eventCount = 20): ChromeBridgeEnvelope {
  const records = Array.from({ length: eventCount }, (_, index) => ({ ...record,
    matchId: `saba-event-${index}`, teamNames: [`Home ${index}`, `Away ${index}`],
    groups: record.groups.map((group) => ({ ...group, odds: group.odds.map((odds) => ({ ...odds,
      marketOddsId: `saba-market-${index}` })) })) }));
  return { ...cmdEnvelope(sequence, records, 0, 1,
    `saba:7:stable-generation-${sequence.toString().padStart(4, "0")}`),
    lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7, sourceEpoch,
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

function ksportEarlyEnvelope(sequence: number, sourceEpoch = "worker-a:0", tabId = 8): ChromeBridgeEnvelope {
  const base = ksportHttpEnvelope(sequence, "today", 1, [], `chrome:KSPORT:${tabId}`, tabId, sourceEpoch);
  return { ...base, request: { ...base.request, hostname: "be.sb21.net",
    streamId: `sbobet-early:${tabId}:${sequence}`, reconcileCutoffSequence: sequence - 1 },
  payload: { encoding: "UTF8", body: JSON.stringify({ kind: "SBOBET_EARLY_CATALOG", generation: sourceEpoch,
    requestStartSequence: sequence - 1, observedAtMs: base.observedAtMs, rosterComplete: true, body: [] }) } };
}

function sabaCompleteCollector(sequence: number, sourceEpoch = "worker-a:0", eventCount = 0): ChromeBridgeEnvelope {
  const generation = `saba:collector:${sourceEpoch}:${sequence}`;
  const rosterMatchIds = Array.from({ length: eventCount }, (_, index) => `saba-collected-${index}`);
  const periods = ["TODAY", "EARLY"].map((period) => ({ period,
    rosterMatchIds: period === "TODAY" ? rosterMatchIds : [], rosterCount: period === "TODAY" ? eventCount : 0 }));
  return { ...sabaDomEnvelope(sequence, sourceEpoch, 0), payload: { encoding: "UTF8",
    body: JSON.stringify({ schemaVersion: 2, snapshotId: generation, chunkIndex: 0, chunkCount: 1,
      sweepId: generation, sweepComplete: true, sweepFrameKey: "sports-frame", sweepDocumentKey: "sports-document",
      records: [...rosterMatchIds.map((ownerMatchId, captureOrdinal) => ({ kind: "CAPTURE",
        collectorGeneration: generation, period: "TODAY", ownerMatchId, captureKind: "ROSTER",
        kickoffDate: { kind: "UNKNOWN" }, capturedAtMs: 100_000 + sequence,
        capturedMonotonicMs: 50, captureOrdinal,
        record: { ...record, matchId: ownerMatchId, providerTimezoneOffsetMinutes: 480,
          teamNames: [`${ownerMatchId} home`, `${ownerMatchId} away`],
          groups: record.groups.map(group => ({ ...group, odds: group.odds.map(odd => ({ ...odd,
            marketOddsId: `${ownerMatchId}-market` })) })) } })),
        ...rosterMatchIds.map(ownerMatchId => ({ kind: "OWNER_COMPLETE", collectorGeneration: generation,
          period: "TODAY", ownerMatchId, safeControlOutcome: "NO_ELIGIBLE_CONTROL", restored: true })),
        ...periods.map((period) => ({ kind: "PERIOD_COMPLETE", collectorGeneration: generation, ...period })),
        { kind: "TERMINAL", collectorGeneration: generation, periods,
          owners: rosterMatchIds.map(ownerMatchId => ({ period: "TODAY", ownerMatchId })),
          todayRestoration: { selected: true, rosterMatchIds, rosterCount: eventCount },
          unresolvedOwners: [], failedOwners: [] }] }) } };
}

function seedKsport(plane: ChromeCatalogDataPlane, live: readonly number[], today: readonly number[] = [],
  context: Parameters<ChromeCatalogDataPlane["ingest"]>[1] = {}, generation = 1): void {
  expect(plane.ingest(ksportEnvelope(0, "live", live, "worker-a:0", generation), context)).toBe(false);
  expect(plane.ingest(ksportEnvelope(1, "today", today, "worker-a:0", generation), context)).toBe(false);
  expect(plane.ingest(ksportEarlyEnvelope(2), context)).toBe(true);
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
  phase: "ROSTER" | "DETAIL" = "ROSTER", sourceEpoch = "worker-a:0",
  generation = "apsport:7:1"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
    sourceEpoch, sequence, observedAtMs: 1_000 + sequence,
    receivedMonotonicMs: 50 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "pacific.agenate.com", pathnameClass: "/__fieldline_apsport_catalog_refresh__",
      resourceType: "Fetch", method: "POST", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: "http-frame:apsport-main", requestDocumentKey: "http-document:apsport-main" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, generation,
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

const btiListPaths = [
  "/api/eventlist/asia/leagues/v2/1/live",
  "/api/eventlist/asia/leagues/v2/1/live/initial",
  "/api/eventlist/asia/leagues/v2/1/prematch",
  "/api/eventlist/asia/leagues/v2/1/prematch/initial"
] as const;

function btiEnvelope(sequence: number, pathnameClass: string,
  sourceEpoch = "worker-a:0", generation = "bti:1000:1", eventCount = 1): ChromeBridgeEnvelope {
  const selection = (eventId: string, id: string, side: number, line: number, price: string) =>
    [id, { VI: "team" }, { VI: "team line" }, false, false, 1.9,
      ["", "1.90", "", "", "", price], side, 2, {}, "", eventId, `market-${eventId}`, line];
  const event = (index: number) => {
    const eventId = `event-${index + 1}`;
    const market = [`hc-${eventId}`, "Live", "Live", ["HC39", "full time", 1], eventId, "league", "1", [
      selection(eventId, `home-${eventId}`, 1, -0.5, "0.82"),
      selection(eventId, `away-${eventId}`, 3, 0.5, "-0.92")]];
    return [eventId, [["h", { VI: `Home ${index + 1}` }], ["a", { VI: `Away ${index + 1}` }]],
      `Home ${index + 1} vs Away ${index + 1}`, "", ["1", "0"], true, false, [],
      [eventId, 0, [], [market]]];
  };
  const payload = { serializedData: [["league", "League", 0, "", false, "", "", "", "", "", "1",
    "Football", Array.from({ length: eventCount }, (_unused, index) => event(index))]] };
  return { version: 1, kind: "NETWORK", lobby: "BTI", sourceId: "chrome:BTI:18", tabId: 18,
    sourceEpoch, sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "HTTP_RESPONSE", request: { hostname: "prod20091.fxf774.com", pathnameClass,
      resourceType: "Fetch", method: "GET", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: "http-frame:bti-main", requestDocumentKey: "http-document:bti-main",
      streamId: generation }, payload: { encoding: "UTF8", body: JSON.stringify(payload) } };
}

function btiPageHealth(sequence: number, status: "HEALTHY" | "AUTH_ERROR",
  sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope {
  const base = btiEnvelope(sequence, btiListPaths[0], sourceEpoch);
  return { ...base, transport: "TAB_STATE", request: { hostname: "prod20091.fxf774.com",
    pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
    payload: { encoding: "UTF8", body: JSON.stringify({ kind: "PAGE_HEALTH", status,
      code: status === "AUTH_ERROR" ? "1008" : null }) } };
}

const activeSbobet: CatalogSourceStatus = { id: SBOBET, alias: "K-Sports · SBOBET", provider: "SBOBET",
  category: "FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 900, reason: null };
const activeSaba: CatalogSourceStatus = { id: SABA, alias: "SABA", provider: "SABA", category: "FOOTBALL",
  sessionState: "ACTIVE", acquiredAtMs: 100, reason: null };

async function catalogWith(eventIds: readonly number[]): Promise<ObservedProviderCatalog> {
  const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
  seedKsport(plane, eventIds);
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
  it("invalidates a fresh BTI catalog immediately when its page reports auth error 1008", async () => {
    const feeds = new ProviderFeedRegistry({ now: () => 1_500 });
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, feedRegistry: feeds });
    for (const [index, path] of btiListPaths.entries()) {
      plane.ingest(btiEnvelope(index + 1, path));
    }
    await expect(plane.read(BTI)).resolves.toMatchObject({ provider: "BTI" });

    const health = btiPageHealth(5, "AUTH_ERROR");
    const rosterCoverage = JSON.stringify({ phase: "COMPLETE", detailCoverageComplete: false,
      detailRosterEvents: 159, detailCachedEvents: 158, detailCachedBytes: 17_500_000,
      detailPendingEvents: 1, detailFailedEvents: 1, detailOldestReceiptAgeMs: 90_000,
      detailNearTtlMs: 12_000, detailDistantTtlMs: 60_000, detailRetainedEventCap: 2048,
      nativeRosterEvents: 196, nativeDetailEvents: 158, nativeMarketRows: 4000,
      nativeSelectionRows: 9000, nativeTypeCounts: "HC39:1500,OU39:2500", nativeInventoryTruncated: false });
    expect(rosterCoverage.length).toBeGreaterThan(400);
    expect(plane.ingest({ ...health, payload: { encoding: "UTF8", body: JSON.stringify({
      ...JSON.parse(health.payload.body), rosterCoverage }) } })).toBe(true);

    expect(feeds.snapshot(BTI)).toMatchObject({ state: "STALLED", reason: "PROVIDER_PAGE_INVALID" });
    await expect(plane.read(BTI)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    for (const [index, path] of btiListPaths.entries()) {
      expect(plane.ingest(btiEnvelope(index + 6, path, "worker-a:0", "bti:2000:1"))).toBe(false);
    }
    await expect(plane.read(BTI)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("keeps a complete BTI catalog while the same tab rebuilds a partial replacement pipeline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    for (const [index, path] of btiListPaths.entries()) {
      plane.ingest(btiEnvelope(index + 1, path, "worker-a:0", "bti:1000:1", 100),
        { connectionGeneration: 1 });
    }
    await expect(plane.read(BTI)).resolves.toMatchObject({ events: expect.arrayContaining([
      expect.objectContaining({ providerEventId: "event-100" })
    ]) });

    let partialAccepted = false;
    for (const [index, path] of btiListPaths.entries()) {
      partialAccepted = plane.ingest(btiEnvelope(index + 10, path, "worker-b:0", "bti:2000:1", 10),
        { connectionGeneration: 2 });
    }
    expect(partialAccepted).toBe(false);
    await expect(plane.read(BTI)).resolves.toMatchObject({ events: expect.arrayContaining([
      expect.objectContaining({ providerEventId: "event-100" })
    ]) });

    let completeAccepted = false;
    for (const [index, path] of btiListPaths.entries()) {
      completeAccepted = plane.ingest(btiEnvelope(index + 20, path, "worker-b:0", "bti:3000:1", 100),
        { connectionGeneration: 2 });
    }
    expect(completeAccepted).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("promotes a complete BTI replacement baseline after the retained authority is stale", async () => {
    let now = 2_000;
    const feeds = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: feeds });
    for (const [index, path] of btiListPaths.entries()) {
      plane.ingest(btiEnvelope(index + 1, path, "worker-a:0", "bti:1000:1", 100),
        { connectionGeneration: 1 });
    }
    expect((await plane.read(BTI)).events).toHaveLength(100);

    now = 100_000;
    await expect(plane.read(BTI)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    let replacementAccepted = false;
    for (const [index, path] of btiListPaths.entries()) {
      replacementAccepted = plane.ingest({
        ...btiEnvelope(index + 10, path, "worker-b:0", "bti:2000:1", 10),
        observedAtMs: now + index
      }, { connectionGeneration: 2 });
    }
    expect(replacementAccepted).toBe(true);
    expect((await plane.read(BTI)).events).toHaveLength(10);
  });

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

  it("recovers APSPORT HTTP authority in the same epoch after socket close without losing hidden detail", async () => {
    let now = 1_000;
    const feeds = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: feeds, publish: vi.fn() });
    now = 900_000;
    const roster = apsportRawEvent(501);
    const detail = { ...roster, "50": [...roster["50"], { "3": 80, "10": "Active", "9": [{
      "0": "501-hidden-over", "2": "501-hidden-under", "6": "501-hidden-total", "7": "1.5",
      "8": { "2": "0.75" }, "9": { "2": "-0.85" }
    }] }] };
    expect(plane.ingest({ ...apsportApiEnvelope(1, [roster]), observedAtMs: now })).toBe(true);
    expect(plane.ingest({ ...apsportApiEnvelope(2, [detail], "DETAIL"), observedAtMs: ++now })).toBe(true);
    expect(plane.ingest({ ...apsportWsEnvelope(3, apsportRawEvent(501, "0.66")), observedAtMs: ++now }))
      .toBe(true);
    const closed = { ...apsportWsEnvelope(4, null), observedAtMs: ++now, transport: "WS_STATE" as const,
      payload: { encoding: "UTF8" as const, body: JSON.stringify({ state: "CLOSED" }) } };
    expect(plane.ingest(closed)).toBe(true);
    await expect(plane.read(APSPORT)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(feeds.sweep(new Set([APSPORT]))).toEqual([expect.objectContaining({ stage: "SOFT" })]);
    now += 10_001;
    expect(feeds.sweep(new Set([APSPORT]))).toEqual([]);
    await expect(plane.read(APSPORT)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    now += 6_000;
    expect(plane.ingest({ ...apsportApiEnvelope(5, [roster], "ROSTER", "worker-a:0", "apsport:7:2"),
      observedAtMs: now })).toBe(true);
    expect(feeds.snapshot(APSPORT)).toMatchObject({ state: "LIVE", sourceEpoch: "worker-a:0",
      activeGeneration: "apsport:7:2", recoveryStage: "NONE" });
    expect((await plane.read(APSPORT)).markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "tsport:80:501-hidden-total", marketType: "SH_TOTAL", line: "1.5" })
    ]));
    expect(feeds.sweep(new Set([APSPORT]))).toEqual([]);
  });

  it("admits validated SABA native quotes before collector completion while refusing unproven DOM", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 100_002 });
    const onIngestRejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 100_002,
      authorityCoordinator: coordinator, feedRegistry: feeds, onIngestRejected });

    expect(plane.ingest(sabaDomEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    const accepted = plane.ingest(sabaDomEnvelope(2), { connectionGeneration: 1 });
    expect(onIngestRejected.mock.calls.map((call) => call[1])).toEqual([
      "ADAPTER_DECODE_EMPTY:saba-ws-catalog-v1", "ADAPTER_DECODE_EMPTY:saba-ws-catalog-v1"
    ]);
    expect(accepted).toBe(false);
    expect(coordinator.snapshot(SABA).active).toBeNull();
    await expect(plane.read(SABA)).rejects.toThrow();
    expect(plane.ingest(sabaPushOpen(3, "1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushBaseline(4, "1"), { connectionGeneration: 1 })).toBe(true);
    const native = await plane.read(SABA);
    expect(native.events.map(event => event.providerEventId)).toEqual(["2"]);
    expect(native.quotes).toHaveLength(2);
    expect(feeds.snapshot(SABA).activeGeneration).toBe("worker-a:0:saba:1:4");
    expect(plane.ingest(sabaCompleteCollector(5), { connectionGeneration: 1 })).toBe(true);
    expect((await plane.read(SABA)).events).toEqual(native.events);
    expect((await plane.read(SABA)).quotes).toEqual(native.quotes);
    expect(coordinator.snapshot(SABA)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0" }),
      candidate: null
    });
    expect(feeds.snapshot(SABA)).toMatchObject({
      state: "LIVE", activeGeneration: expect.not.stringContaining(":dom:")
    });
    await expect(plane.read(SABA)).resolves.toMatchObject({ provider: "SABA", events: expect.any(Array) });
  });

  it("accepts exact APSPORT event removal without freezing subsequent detail deltas", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish: vi.fn() });
    const exactDetail = (sequence: number, records: readonly unknown[]) => {
      const input = apsportApiEnvelope(sequence, records, "DETAIL");
      return { ...input, payload: { ...input.payload,
        body: JSON.stringify({ ...JSON.parse(input.payload.body), trigger: "EVENT_CHANGE" }) } };
    };
    expect(plane.ingest(apsportApiEnvelope(1, [apsportRawEvent(501), apsportRawEvent(502)]))).toBe(true);
    expect(plane.ingest(exactDetail(2, [{ ...apsportRawEvent(501), "10": "Suspended" }]))).toBe(true);
    expect((await plane.read(APSPORT)).events.map((item) => item.providerEventId)).toEqual(["502"]);
    expect(plane.ingest(exactDetail(3, [apsportRawEvent(502, "0.66")]))).toBe(true);
    expect((await plane.read(APSPORT)).quotes[0]?.rawOdds).toBe("0.66");
    expect(plane.ingest(exactDetail(4, [{ ...apsportRawEvent(502), "10": "Suspended" }]))).toBe(true);
    expect((await plane.read(APSPORT)).events).toEqual([]);
    expect((await plane.read(APSPORT)).quotes).toEqual([]);
  });

  it("publishes proven empty APSPORT event detail instead of retaining the final open prices", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish: vi.fn() });
    expect(plane.ingest(apsportApiEnvelope(1, [apsportRawEvent(501)]))).toBe(true);
    const exact = apsportApiEnvelope(2, [{ ...apsportRawEvent(501), "50": [] }], "DETAIL");
    expect(plane.ingest({ ...exact, payload: { ...exact.payload,
      body: JSON.stringify({ ...JSON.parse(exact.payload.body), trigger: "EVENT_CHANGE" }) } })).toBe(true);
    const result = await plane.read(APSPORT);
    expect(result.events).toHaveLength(1);
    expect(result.markets).toEqual([]);
    expect(result.quotes).toEqual([]);
    expect(plane.ingest(apsportApiEnvelope(3, [apsportRawEvent(501)], "ROSTER", "worker-a:0", "apsport:7:2")))
      .toBe(true);
    expect((await plane.read(APSPORT)).quotes).toEqual([]);
  });

  it("does not promote an incomplete APSPORT roster after an API or source epoch handover", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const onIngestRejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 2_000,
      authorityCoordinator: coordinator, onIngestRejected });
    const events = (count: number) => Array.from({ length: count }, (_, index) => apsportRawEvent(index + 1));

    expect(plane.ingest(apsportApiEnvelope(1, events(100)), { connectionGeneration: 1 })).toBe(true);
    expect((await plane.read(APSPORT)).events).toHaveLength(100);

    expect(plane.ingest(apsportApiEnvelope(2, events(85), "ROSTER", "worker-a:1", "apsport:7:2"),
      { connectionGeneration: 1 })).toBe(false);
    expect(onIngestRejected.mock.calls.map((call) => call[1])).toContain(
      "APSPORT_REPLACEMENT_COVERAGE_INCOMPLETE"
    );
    expect((await plane.read(APSPORT)).events).toHaveLength(100);

    expect(plane.ingest(apsportApiEnvelope(3, events(95), "ROSTER", "worker-a:1", "apsport:7:3"),
      { connectionGeneration: 1 })).toBe(true);
    expect((await plane.read(APSPORT)).events).toHaveLength(95);
  });

  it("promotes a complete APSPORT replacement roster after the retained authority is stale", async () => {
    let now = 2_000;
    const feeds = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: feeds });
    const events = (count: number) => Array.from({ length: count }, (_, index) => apsportRawEvent(index + 1));

    expect(plane.ingest(apsportApiEnvelope(1, events(100)), { connectionGeneration: 1 })).toBe(true);
    expect((await plane.read(APSPORT)).events).toHaveLength(100);

    now = 500_000;
    await expect(plane.read(APSPORT)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const replacement = { ...apsportApiEnvelope(2, events(20), "ROSTER", "worker-a:1", "apsport:7:2"),
      observedAtMs: now };
    expect(plane.ingest(replacement, { connectionGeneration: 1 })).toBe(true);
    expect((await plane.read(APSPORT)).events).toHaveLength(20);
  });

  it("retains a fresh SABA roster until a smaller replacement proves complete Today and Early inventory", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const feeds = new ProviderFeedRegistry({ now: () => 100_010 });
    const onIngestRejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 100_010,
      authorityCoordinator: coordinator, feedRegistry: feeds, onIngestRejected });

    expect(plane.ingest(sabaCompleteCollector(0), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(sabaPushOpen(1, "1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushBaseline(2, "1", "worker-a:0", 20), { connectionGeneration: 1 })).toBe(true);
    expect((await plane.read(SABA)).events).toHaveLength(20);
    const retained = await plane.read(SABA);

    expect(plane.ingest(sabaPushOpen(3, "1", "worker-a:1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaDomEnvelope(4, "worker-a:1"), { connectionGeneration: 1 })).toBe(false);

    expect(onIngestRejected.mock.calls.map((call) => call[1])).toContain(
      "ADAPTER_DECODE_EMPTY:saba-ws-catalog-v1"
    );
    expect(coordinator.snapshot(SABA)).toMatchObject({
      active: expect.objectContaining({ sourceEpoch: "worker-a:0" }),
      candidate: expect.objectContaining({ sourceEpoch: "worker-a:1" })
    });
    expect((await plane.read(SABA)).events).toHaveLength(20);

    expect(plane.ingest(sabaDomEnvelope(5, "worker-a:1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaDomEnvelope(6, "worker-a:1"), { connectionGeneration: 1 })).toBe(false);
    expect((await plane.read(SABA)).events).toHaveLength(20);
    // A reset/done owns its live partition; completed Today and Early inventory
    // independently proves that this replacement epoch covers prematch too.
    expect(plane.ingest(sabaPushBaseline(7, "1", "worker-a:1"), { connectionGeneration: 1 })).toBe(false);
    expect((await plane.read(SABA)).events).toEqual(retained.events);
    expect((await plane.read(SABA)).quotes).toEqual(retained.quotes);
    expect(plane.ingest(sabaCompleteCollector(8, "worker-a:1"), { connectionGeneration: 1 })).toBe(true);
    expect(coordinator.snapshot(SABA)).toMatchObject({
      active: expect.objectContaining({ sourceEpoch: "worker-a:1" }), candidate: null
    });
    expect((await plane.read(SABA)).events).toHaveLength(1);
  });

  it("replaces a SABA roster only after a complete collector, never from a stable smaller viewport",
    async () => {
      const coordinator = new ProviderAuthorityCoordinator();
      const feeds = new ProviderFeedRegistry({ now: () => 100_020 });
      const onIngestRejected = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => 100_020,
        authorityCoordinator: coordinator, feedRegistry: feeds, onIngestRejected });

      expect(plane.ingest(sabaCompleteCollector(0), { connectionGeneration: 1 })).toBe(true);
      expect(plane.ingest(sabaPushBaseline(1, "1", "worker-a:0", 100),
        { connectionGeneration: 1 })).toBe(true);
      expect((await plane.read(SABA)).events).toHaveLength(100);
      const retained = await plane.read(SABA);

      expect(plane.ingest(sabaPushOpen(2, "1", "worker-a:1"),
        { connectionGeneration: 1 })).toBe(false);
      expect(plane.ingest(sabaDomEnvelope(3, "worker-a:1", 20),
        { connectionGeneration: 1 })).toBe(false);
      expect(plane.ingest(sabaDomEnvelope(4, "worker-a:1", 20),
        { connectionGeneration: 1 })).toBe(false);
      expect(plane.ingest(sabaPushOpen(5, "2", "worker-a:1"),
        { connectionGeneration: 1 })).toBe(false);
      expect(plane.ingest(sabaDomEnvelope(6, "worker-a:1", 20),
        { connectionGeneration: 1 })).toBe(false);
      expect(plane.ingest(sabaDomEnvelope(7, "worker-a:1", 20),
        { connectionGeneration: 1 })).toBe(false);
      expect((await plane.read(SABA)).events).toHaveLength(100);
      // Native reset/done remains private until both prematch periods complete.
      expect(plane.ingest(sabaPushBaseline(8, "2", "worker-a:1", 20),
        { connectionGeneration: 1 })).toBe(false);
      expect((await plane.read(SABA)).events).toEqual(retained.events);
      expect((await plane.read(SABA)).quotes).toEqual(retained.quotes);
      expect(plane.ingest(sabaCompleteCollector(9, "worker-a:1"),
        { connectionGeneration: 1 })).toBe(true);

      expect(coordinator.snapshot(SABA)).toMatchObject({
        active: expect.objectContaining({ sourceEpoch: "worker-a:1" })
      });
      const replacement = await plane.read(SABA);
      expect(replacement.events).toHaveLength(20);
      expect(replacement.events).not.toContainEqual(expect.objectContaining({ providerEventId: "101" }));
    });

  it("retains collected SABA identities and quote clocks after a socket delta before a smaller epoch replacement", async () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const rejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 100_020,
      authorityCoordinator: coordinator, onIngestRejected: rejected });
    expect(plane.ingest(sabaPushBaseline(1, "1"), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(sabaCompleteCollector(2, "worker-a:0", 100), { connectionGeneration: 1 })).toBe(true);
    const beforeDelta = await plane.read(SABA);
    expect(beforeDelta.events).toHaveLength(101);
    const oddsDelta = Object.entries({ type: "o", oddsid: 3, matchid: 2, odds1a: 0.88, odds2a: -0.98 })
      .flatMap(([key, value]) => [sabaPushFields.indexOf(key), value]);
    expect(plane.ingest(sabaPushEnvelope(3, "1",
      `42${JSON.stringify(["m", "b1", [oddsDelta], "revision-2"])}`), { connectionGeneration: 1 }),
    rejected.mock.calls.at(-1)?.[1]).toBe(true);
    const retained = await plane.read(SABA);
    expect(retained.events).toEqual(beforeDelta.events);
    expect(retained.quotes.filter(quote => quote.providerEventId.startsWith("saba-collected-")))
      .toEqual(beforeDelta.quotes.filter(quote => quote.providerEventId.startsWith("saba-collected-")));
    expect(retained.quotes).toContainEqual(expect.objectContaining({ providerEventId: "2", rawOdds: "0.88" }));

    expect(plane.ingest(sabaPushOpen(4, "2", "worker-a:1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushBaseline(5, "2", "worker-a:1", 20), { connectionGeneration: 1 })).toBe(false);
    expect(rejected.mock.calls.at(-1)?.[1]).toBe("SABA_REPLACEMENT_COVERAGE_INCOMPLETE");
    expect(coordinator.snapshot(SABA).active?.sourceEpoch).toBe("worker-a:0");
    expect((await plane.read(SABA)).events).toEqual(retained.events);
    expect((await plane.read(SABA)).quotes).toEqual(retained.quotes);

    // A complete new Today/Early manifest can explicitly retire the old collected roster.
    expect(plane.ingest(sabaCompleteCollector(6, "worker-a:1"), { connectionGeneration: 1 })).toBe(true);
    const replacement = await plane.read(SABA);
    expect(replacement.events.map(event => event.providerEventId).sort())
      .toEqual(Array.from({ length: 20 }, (_, index) => String(index + 2)).sort());
    expect(replacement.quotes.every(quote => !quote.providerEventId.startsWith("saba-collected-"))).toBe(true);
  });

  it("does not promote a SABA viewport when the socket baseline is missing and a frame is malformed", async () => {
    const feeds = new ProviderFeedRegistry({ now: () => 100_002 });
    const plane = new ChromeCatalogDataPlane({ now: () => 100_002, feedRegistry: feeds });

    expect(plane.ingest(sabaDomEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaDomEnvelope(2), { connectionGeneration: 1 })).toBe(false);
    expect(feeds.snapshot(SABA).activeGeneration).toBeNull();

    expect(plane.ingest(sabaPushOpen(3, "1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushEnvelope(4, "1", '42["m","b1",[],1,"extra"]'),
      { connectionGeneration: 1 })).toBe(false);
    expect(feeds.snapshot(SABA).activeGeneration).toBeNull();
    await expect(plane.read(SABA)).rejects.toThrow();
  });

  it("does not promote a SABA viewport after its uninitialized socket closes", async () => {
    const feeds = new ProviderFeedRegistry({ now: () => 100_002 });
    const plane = new ChromeCatalogDataPlane({ now: () => 100_002, feedRegistry: feeds });

    expect(plane.ingest(sabaDomEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaDomEnvelope(2), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushOpen(3, "1"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(sabaPushEnvelope(4, "1", '{"state":"CLOSED"}', "WS_STATE"),
      { connectionGeneration: 1 })).toBe(false);

    expect(feeds.snapshot(SABA).activeGeneration).toBeNull();
    await expect(plane.read(SABA)).rejects.toThrow();
  });

  it("invalidates SABA socket authority after a DOM price overlay when the native socket closes", async () => {
    const feeds = new ProviderFeedRegistry({ now: () => 100_010 });
    const plane = new ChromeCatalogDataPlane({ now: () => 100_010,
      monotonicNow: () => 10_000, feedRegistry: feeds });
    expect(plane.ingest(sabaCompleteCollector(0))).toBe(true);
    expect(plane.ingest(sabaPushOpen(1, "1"))).toBe(false);
    expect(plane.ingest(sabaPushBaseline(2, "1", "worker-a:0", 2))).toBe(true);
    const before = await plane.read(SABA);
    const dom = sabaDomEnvelope(3, "worker-a:0", 1);
    const visible = { ...record, matchId: "2", leagueId: "1", timeText: "1H0'",
      teamNames: ["Home 0", "Away 0"], groups: record.groups.map((group) => ({ ...group,
        odds: group.odds.map((odds) => ({ ...odds, marketOddsId: "3" })) })) };
    expect(plane.ingest({ ...dom, receivedMonotonicMs: 60, payload: { encoding: "UTF8",
      body: JSON.stringify({ schemaVersion: 2, snapshotId: "saba:7:visible-price-overlay",
        chunkIndex: 0, chunkCount: 1, records: [visible] }) } })).toBe(true);
    const overlaid = await plane.read(SABA);
    expect(overlaid.quotes.filter(({ providerEventId }) => providerEventId === "3"))
      .toEqual(before.quotes.filter(({ providerEventId }) => providerEventId === "3"));
    expect(overlaid.quotes).toContainEqual(expect.objectContaining({ providerEventId: "2", rawOdds: "0.9" }));
    expect(plane.ingest(sabaPushEnvelope(4, "1", '{"state":"CLOSED"}', "WS_STATE"))).toBe(true);
    expect(feeds.snapshot(SABA).state).toBe("STALLED");
    await expect(plane.read(SABA)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
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

    expect(ingest(ksportEnvelope(0, "live", [101], "worker-a:0", 1)).control)
      .toMatchObject({ kind: "ACK" });
    expect(registry.listActiveSources()).toEqual([]);
    expect(control.requestAllSnapshots()).toBe(0);

    expect(ingest(ksportEnvelope(1, "today", [], "worker-a:0", 1)).control)
      .toMatchObject({ kind: "ACK" });
    expect(ingest(ksportEarlyEnvelope(2)).control).toMatchObject({ kind: "ACK" });
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

  it("recovers an idle retired CMD source on the shared bridge only after a new epoch proves its baseline", async () => {
    let now = 1_500;
    const coordinator = new ProviderAuthorityCoordinator();
    const registry = new ChromeBridgeRegistry({ now: () => now, retireAfterMs: 300_000,
      authorityCoordinator: coordinator });
    const plane = new ChromeCatalogDataPlane({ now: () => now, authorityCoordinator: coordinator });
    const connection = {};
    registry.subscribe((envelope, context) => { plane.ingest(envelope, context); });
    const original = { ...cmdHttpEnvelope(1, { t: 100 }), sourceEpoch: "idle-cmd-worker:19" };
    expect(registry.ingest(original, connection)).toMatchObject({ kind: "ACK" });
    await expect(plane.read(CMD)).resolves.toMatchObject({ observedAtMs: 1_001 });

    now = 302_000;
    expect(registry.listActiveSources()).toEqual([]);
    await expect(plane.read(CMD)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(registry.ingest({ ...original, sequence: 2, observedAtMs: now }, connection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    const replacement = { ...cmdHttpEnvelope(1, { t: 200 }), observedAtMs: now,
      receivedMonotonicMs: now, sourceEpoch: "idle-cmd-worker:20" };
    expect(registry.ingest(tabHeartbeat(replacement, now, 0), connection)).toMatchObject({ kind: "ACK" });
    expect(registry.listActiveSources()).toEqual([]);
    await expect(plane.read(CMD)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(registry.ingest(replacement, connection)).toMatchObject({ kind: "ACK" });
    expect(registry.listActiveSources()).toEqual([expect.objectContaining({ lobby: "CMD", authorityDisposition: "ACTIVE" })]);
    await expect(plane.read(CMD)).resolves.toMatchObject({ observedAtMs: now });
    expect(registry.ingest({ ...original, sequence: 3, observedAtMs: now + 1 }, connection))
      .toMatchObject({ kind: "REJECT", reason: "OUT_OF_ORDER" });
    await expect(plane.read(CMD)).resolves.toMatchObject({ observedAtMs: now });
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
      { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(3), { connectionGeneration: 1 })).toBe(true);
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
    seedKsport(plane, [101], [], { connectionGeneration: 1 });
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
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(5, "worker-b:0", 9), { connectionGeneration: 2 })).toBe(true);

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
    ingest(ksportEnvelope(0, "live", [101], "worker-a:0", 1), activeConnection, activeSocket);
    expect(ingest(ksportEnvelope(1, "today", [], "worker-a:0", 1), activeConnection, activeSocket).control)
      .toMatchObject({ kind: "ACK" });
    expect(ingest(ksportEarlyEnvelope(2), activeConnection, activeSocket).control).toMatchObject({ kind: "ACK" });
    publish.mockClear();
    feeds.rejectSourceId = "chrome:KSPORT:9";

    const replacement = (sequence: number, partition: "live" | "today",
      eventIds: readonly number[]): ChromeBridgeEnvelope =>
      ksportHttpEnvelope(sequence, partition, 2, eventIds, "chrome:KSPORT:9", 9, "worker-b:0");
    ingest(replacement(3, "live", [202]), candidateConnection, candidateSocket);
    expect(ingest(replacement(4, "today", []),
      candidateConnection, candidateSocket).control).toMatchObject({ kind: "ACK" });
    expect(ingest(ksportEarlyEnvelope(5, "worker-b:0", 9),
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
    seedKsport(plane, [101], [], { connectionGeneration: 1 });
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
    expect(plane.ingest(ksportEarlyEnvelope(5, "worker-b:0", 9), { connectionGeneration: 2 })).toBe(false);

    expect(coordinator.snapshot(SBOBET)).toMatchObject({
      active: expect.objectContaining({ sourceId: "chrome:KSPORT:8" }),
      candidate: expect.objectContaining({ sourceId: "chrome:KSPORT:9" })
    });
    expect(feeds.snapshot(SBOBET)).toMatchObject({ state: "LIVE", sourceId: "chrome:KSPORT:8" });
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });
    expect(publish).not.toHaveBeenCalled();

    expect(plane.ingest(replacement(6, "live", [303], 3),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(replacement(7, "today", [], 3),
      { connectionGeneration: 2 })).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "303" })]
    });
  });

  it("preserves a correctly bound in-flight candidate body when its sibling promotes the same identity", () => {
    const coordinator = new ProviderAuthorityCoordinator();
    const budget = new NetworkBodyAssemblyBudget();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, authorityCoordinator: coordinator,
      networkBodyBudget: budget });
    seedKsport(plane, [101], [], { connectionGeneration: 1 });

    const replacementHttp = ksportHttpEnvelope(3, "live", 2, [202],
      "chrome:KSPORT:9", 9, "worker-b:0");
    expect(plane.ingest(chunkedNetworkBody(replacementHttp, 3, 0, "candidate-unrelated-pending"),
      { connectionGeneration: 2 })).toBe(false);
    expect(budget.stats()).toMatchObject({ pendingBodies: 1 });
    expect(coordinator.snapshot(SBOBET).active?.sourceId).toBe("chrome:KSPORT:8");

    expect(plane.ingest(ksportHttpEnvelope(4, "live", 2, [202], "chrome:KSPORT:9", 9, "worker-b:0"),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(ksportHttpEnvelope(5, "today", 2, [], "chrome:KSPORT:9", 9, "worker-b:0"),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(6, "worker-b:0", 9), { connectionGeneration: 2 })).toBe(true);
    expect(coordinator.snapshot(SBOBET).active?.sourceId).toBe("chrome:KSPORT:9");
    expect(budget.stats()).toMatchObject({ pendingBodies: 1 });
    plane.ingest(chunkedNetworkBody(replacementHttp, 7, 1, "candidate-unrelated-pending"),
      { connectionGeneration: 2 });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
  });

  it("reports a faulted SBO multipart epoch for resync and admits only the replacement baseline", async () => {
    let now = 1_500;
    const budget = new NetworkBodyAssemblyBudget({ now: () => now });
    const rejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, networkBodyBudget: budget,
      onIngestRejected: rejected });
    seedKsport(plane, [101]);
    const partial = chunkedNetworkBody(ksportHttpEnvelope(3, "live", 2, [202]), 3, 0, "lost-sbo-body-suffix");
    expect(plane.ingest(partial)).toBe(false);
    expect(rejected).toHaveBeenLastCalledWith(partial, "NETWORK_BODY_INCOMPLETE");
    expect(plane.networkBodyAssembly(SBOBET)).toMatchObject({ active: { pendingBodies: 1, blockedSourceEpochs: 0 } });

    now = 125_000;
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    // The fresh native pair is valid, but the prior unfinished body fenced
    // this epoch. Ordinary same-epoch snapshot requests cannot recover it.
    const blocked = { ...chunkedNetworkBody(ksportHttpEnvelope(4, "live", 3, [202]),
      4, 0, "new-sbo-baseline"), observedAtMs: now };
    expect(plane.ingest(blocked)).toBe(false);
    expect(plane.networkBodyAssembly(SBOBET)).toMatchObject({ active: { blockedSourceEpochs: 1,
      lastFault: { reason: "BODY_TTL_EXPIRED", faultAtMs: now, receivedFragments: 1, expectedFragments: 2,
        bodyAgeMs: 123_500 } } });
    expect(rejected).toHaveBeenLastCalledWith(blocked, "NETWORK_BODY_UNAVAILABLE");
    const smallDelta = { ...ksportSocketEnvelope(5, "live", [101]), observedAtMs: now };
    expect(plane.ingest(smallDelta)).toBe(false);
    expect(rejected).toHaveBeenLastCalledWith(smallDelta, "FEED_CONTROLLER_REJECTED:ksport-ws-catalog-v1");
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const replacement = (sequence: number, partition: "live" | "today", index: number) => ({
      ...chunkedNetworkBody(ksportHttpEnvelope(sequence, partition, 4,
        partition === "live" ? [202] : [], "chrome:KSPORT:8", 8, "worker-a:1"),
      sequence + index, index, `replacement-sbo-${partition}`), observedAtMs: now });
    expect(plane.ingest(replacement(0, "live", 0))).toBe(false);
    expect(plane.ingest(replacement(0, "live", 1))).toBe(false);
    expect(plane.ingest(replacement(2, "today", 0))).toBe(false);
    expect(plane.ingest(replacement(2, "today", 1))).toBe(false);
    const early = ksportEarlyEnvelope(4, "worker-a:1");
    const earlyAccepted = plane.ingest({ ...early, observedAtMs: now,
      payload: { encoding: "UTF8", body: JSON.stringify({ ...JSON.parse(early.payload.body), observedAtMs: now }) } });
    expect({ accepted: earlyAccepted, reason: rejected.mock.lastCall?.[1] }).toMatchObject({ accepted: true });
    await expect(plane.read(SBOBET)).resolves.toMatchObject({ observedAtMs: now,
      events: [expect.objectContaining({ providerEventId: "202" })] });
    expect(plane.networkBodyAssembly(SBOBET)).toMatchObject({ active: { blockedSourceEpochs: 0 } });
    expect(plane.networkBodyAssembly(SBOBET).active).not.toHaveProperty("lastFault");
    expect(plane.ingest({ ...blocked, sequence: 6, observedAtMs: now + 1 })).toBe(false);
    expect(rejected).toHaveBeenLastCalledWith(expect.anything(), "AUTHORITY_EPOCH_RETIRED");
  });

  it("renews CMD baselines after concurrent HTTP chunks straddle candidate promotion", async () => {
    let now = 1_500;
    const budget = new NetworkBodyAssemblyBudget({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, networkBodyBudget: budget });
    const first = cmdHttpEnvelope(1, { t: 100 });
    const next = cmdHttpEnvelope(2, { t: 101 });
    expect(plane.ingest(chunkedNetworkBody(first, 1, 0, "cmd-first-promoting"))).toBe(false);
    expect(plane.ingest(chunkedNetworkBody(next, 2, 0, "cmd-concurrent-renewal"))).toBe(false);
    expect(plane.networkBodyAssembly(CMD)).toMatchObject({ active: null,
      candidate: { pendingBodies: 2, blockedSourceEpochs: 0 } });
    expect(plane.ingest(chunkedNetworkBody(first, 3, 1, "cmd-first-promoting"))).toBe(true);
    expect(plane.ingest(chunkedNetworkBody(next, 4, 1, "cmd-concurrent-renewal"))).toBe(true);
    expect(plane.networkBodyAssembly(CMD)).toEqual({ candidate: null,
      active: { pendingBodies: 0, pendingBytes: 0, blockedSourceEpochs: 0 } });
    expect(budget.stats()).toEqual({ pendingBodies: 0, pendingBytes: 0 });
    now = 32_000;
    const fresh = { ...cmdHttpEnvelope(5, { t: 102 }), observedAtMs: now };
    const renewal = (index: number) => ({ ...chunkedNetworkBody(fresh, 5 + index, index,
      "cmd-after-orphan-timeout"), observedAtMs: now });
    expect(plane.ingest(renewal(0))).toBe(false);
    expect(plane.ingest(renewal(1))).toBe(true);
    await expect(plane.read(CMD)).resolves.toMatchObject({ events: expect.any(Array) });
  });

  it("resolves a recovery-owner wait through the injected shared registry", async () => {
    const registry = new ProviderFeedRegistry({ now: () => 1_500 });
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, feedRegistry: registry });
    const waiting = registry.waitForFreshBaseline(SBOBET, 1_000, 100);

    seedKsport(plane, [101], [102], {});

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
    seedKsport(plane, [101], [102], {});

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
    expect(plane.ingest(ksportEnvelope(4, "today", [], "worker-a:0", 100))).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(5))).toBe(true);
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
    seedKsport(plane, [101], [], { connectionGeneration: 1 }, 100);
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
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(7, "worker-b:0", 9), { connectionGeneration: 2 })).toBe(true);
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
    seedKsport(plane, [101], [], { connectionGeneration: 1 }, 100);
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
    expect(plane.ingest(candidate(10, "today", 3, []), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(11, "worker-a:1", 9), { connectionGeneration: 1 })).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "903" })]
    });
  });

  it("keeps the committed SBOBET catalog until a complete empty replacement baseline commits", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    seedKsport(plane, [101], [], {});

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
    expect(plane.ingest(ksportEnvelope(5, "today", [], "worker-a:0", 2))).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(6))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("never reports ACTIVE when the same provider feed is too stale to read", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now });
    seedKsport(plane, [101], [102], {});
    // SBOBET now expects evidence once a minute (measured 2026-08-30); the
    // feed only leaves LIVE after that window passes with nothing decoded.
    now = 65_003;

    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    await expect(plane.overlayStatuses([activeSbobet])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED", acquiredAtMs: 1_002, reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("does not report SABA active when only TAB_STATE heartbeats follow a stale restored catalog", async () => {
    const seed = new ChromeCatalogDataPlane({ now: () => 100_002 });
    expect(seed.ingest(sabaCompleteCollector(0))).toBe(true);
    seed.ingest(sabaPushOpen(1, "1"));
    expect(seed.ingest(sabaPushBaseline(2, "1"))).toBe(true);
    const restored = await seed.read(SABA);
    const plane = new ChromeCatalogDataPlane({ now: () => 200_000 });
    plane.restore({ ...restored, accountId: SABA, provider: "SABA", observedAtMs: 100 });
    plane.ingest(tabHeartbeat(sabaPushOpen(3, "1"), 200_000, 3));

    await expect(plane.read(SABA)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    await expect(plane.overlayStatuses([activeSaba])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED", reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("renews authority only from a provider-decoded transport heartbeat", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now });
    seedKsport(plane, [101], [102], {});

    // Inside the 30 s contract the catalog is still served; a frame the
    // provider decoder refuses is not evidence and cannot extend it.
    now = 25_000;
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
    seedKsport(plane, [101], [], { connectionGeneration: 1 });

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
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(ksportEarlyEnvelope(6, "worker-b:0"), { connectionGeneration: 2 })).toBe(true);
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
    seedKsport(plane, [101], [102], {});
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
    seedKsport(plane, ten, [], {});

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
    seedKsport(plane, [101], [], {});
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
    seedKsport(plane, [101], [102], {});

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

    expect(plane.ingest(sabaCompleteCollector(0))).toBe(true);
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

    now = 100_002 + providerFeedPolicies.get(SABA)!.softRecoveryAfterMs + 1;
    await plane.overlayStatuses([activeSaba]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith(SABA);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "SOFT_RECOVERY",
      recoveryStage: "SOFT", recoveryAttempt: 1 });

    now = 100_002 + providerFeedPolicies.get(SABA)!.hardRecoveryAfterMs + 1;
    await plane.overlayStatuses([activeSaba]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(2);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "HARD_RECOVERY",
      recoveryStage: "HARD", recoveryAttempt: 2 });

    now += 6;
    expect(plane.ingest({ ...sabaPushOpen(6, "2"), observedAtMs: now - 1 })).toBe(false);
    expect(plane.ingest({ ...sabaPushBaseline(7, "2"), observedAtMs: now })).toBe(true);
    const native = await plane.read(SABA);
    expect(native.events.map(event => event.providerEventId)).toEqual(["2"]);
    expect(native.quotes).toHaveLength(2);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "LIVE", recoveryStage: "NONE",
      recoveryAttempt: 0, activeGeneration: "worker-a:0:saba:2:7" });
    expect(plane.ingest({ ...sabaCompleteCollector(8), observedAtMs: now })).toBe(true);
    expect((await plane.read(SABA)).events).toEqual(native.events);
    expect((await plane.read(SABA)).quotes).toEqual(native.quotes);
    expect(registry.snapshot(SABA)).toMatchObject({ state: "LIVE", reason: null,
      sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0", recoveryStage: "NONE",
      recoveryAttempt: 0, activeGeneration: "saba:collector:worker-a:0:8" });
    await expect(plane.read(SABA)).resolves.toMatchObject({ observedAtMs: now });
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
