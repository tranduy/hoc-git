import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogSourceStatus, ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
import { NetworkBodyAssemblyBudget } from "./network-body-assembler.js";
import { ProviderFeedRegistry } from "./provider-feed-registry.js";

const SBOBET = "catalog-source:SBOBET:FOOTBALL";
const SABA = "catalog-source:SABA:FOOTBALL";

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
      providerFunctionCode: options.providerFunctionCode ?? 1 },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } } as ChromeBridgeEnvelope;
}

function imEnvelope(sequence: number, partition: "IM_MARKET_1" | "IM_MARKET_2",
  body: unknown): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "HTTP_RESPONSE", request: { hostname: "imsports.directsb.net",
      pathnameClass: "/api/EventV6/GetSE", resourceType: "Fetch", providerPartition: partition,
      streamId: "im:8:1", reconcileCutoffSequence: 0 },
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

function ksportEnvelope(sequence: number, partition: "live" | "today", eventIds: readonly number[],
  sourceEpoch = "worker-a:0", receiptGeneration = Math.floor((sequence + 1) / 2)): ChromeBridgeEnvelope {
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
    transport: "WS_FRAME", request: { hostname: "sports.example", pathnameClass: "/sport/session/websocket",
      resourceType: "WebSocket", streamId: "ksport-stream-1" },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([frame])}` } };
}

function ksportDeltaEnvelope(sequence: number, receiptGeneration: number,
  eventId: number): ChromeBridgeEnvelope {
  const event = { "2": `Home ${eventId}`, "3": `Away ${eventId}`, "8": eventId,
    "7": { "3": [`2.5 0.95*${eventId}0030002005h -0.98*${eventId}0030002005a ${eventId}181025`] } };
  const frame = "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n" +
    `subscription:subSportBookLive\nmessage-id:socket-${receiptGeneration}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify(event) })}\0`;
  const base = ksportEnvelope(sequence, "live", [], "worker-a:0", receiptGeneration);
  return { ...base, payload: { encoding: "UTF8", body: `a${JSON.stringify([frame])}` } };
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
      resourceType: "Fetch", streamId: `ksport-http:${tabId}:${generation}:${partition}` },
    payload: { encoding: "UTF8", body: JSON.stringify(partition === "live"
      ? [{ "1": "League", "2": events }] : []) } };
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

afterEach(() => vi.restoreAllMocks());

describe("ChromeCatalogDataPlane", () => {
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
    expect(plane.ingest({ ...ksportEnvelope(2, "live", [101, 102], "worker-b:0"),
      sourceId: "chrome:KSPORT:9", tabId: 9 })).toBe(true);
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
    const candidate = (envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope => ({ ...envelope,
      sourceId: "chrome:KSPORT:9", tabId: 9, sourceEpoch: "worker-b:0" });

    expect(plane.ingest(replayedEnvelope(candidate(ksportEnvelope(3, "live", [999], "worker-b:0", 1))),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(replayedEnvelope(candidate(ksportEnvelope(4, "today", [], "worker-b:0", 1))),
      { connectionGeneration: 2 })).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "101" })]
    });

    expect(plane.ingest(candidate(ksportEnvelope(5, "live", [103], "worker-b:0", 2)),
      { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(candidate(ksportEnvelope(6, "today", [], "worker-b:0", 2)),
      { connectionGeneration: 2 })).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "103" })]
    });
  });

  it("injects one application-global multipart budget into active and candidate lanes", async () => {
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
    now = 11_003;

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

    now = 9_000;
    expect(plane.ingest({ ...ksportEnvelope(3, "today", []), observedAtMs: now,
      payload: { encoding: "UTF8", body: `a${JSON.stringify(["\n"])}` } })).toBe(false);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({ observedAtMs: 1_002 });

    now = 20_001;
    plane.ingest(tabHeartbeat(ksportEnvelope(4, "today", []), now, 4));
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("keeps the current epoch live until a replacement source completes an authoritative baseline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0"), { connectionGeneration: 1 });
    plane.ingest(ksportEnvelope(2, "today", [102], "worker-a:0"), { connectionGeneration: 1 });

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
    now = 30_000;
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

  it("marks a live provider stale immediately when its catalog socket closes", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    const baseline = ksportEnvelope(2, "today", [102]);
    plane.ingest(baseline);
    const closed: ChromeBridgeEnvelope = { ...baseline, sequence: 3, observedAtMs: 1_100,
      transport: "WS_STATE", payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } };

    expect(plane.ingest(closed)).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("re-baselines KSPORT on a strictly newer stream in the same source epoch after close", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0", 100));
    expect(plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0", 100))).toBe(true);
    const lifecycle = (state: "OPEN" | "CLOSED", streamId: string, sequence: number) => ({
      ...ksportEnvelope(sequence, "live", [], "worker-a:0", 101), transport: "WS_STATE" as const,
      request: { ...ksportEnvelope(sequence, "live", [], "worker-a:0", 101).request, streamId },
      payload: { encoding: "UTF8" as const, body: JSON.stringify({ state }) }
    });

    expect(plane.ingest(lifecycle("CLOSED", "ksport-stream-1", 3))).toBe(true);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(plane.ingest(lifecycle("OPEN", "2", 4))).toBe(false);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const replacement = (partition: "live" | "today", sequence: number) => {
      const value = ksportEnvelope(sequence, partition, partition === "live" ? [202] : [],
        "worker-a:0", 101);
      return { ...value, request: { ...value.request, streamId: "2" } };
    };
    expect(plane.ingest(replacement("live", 5))).toBe(false);
    expect(plane.ingest(replacement("today", 6))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "202" })]
    });
    expect(plane.ingest(ksportEnvelope(7, "live", [999], "worker-a:0", 102))).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE", "FRESH"]);
  });

  it("fails closed through 59 seconds after pending-delta loss and ignores heartbeat freshness", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, publish });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0", 100));
    expect(plane.ingest(ksportEnvelope(2, "today", [], "worker-a:0", 100))).toBe(true);
    expect(plane.ingest(ksportEnvelope(3, "live", [102], "worker-a:0", 200))).toBe(false);
    for (let index = 0; index <= 256; index += 1) {
      plane.ingest(ksportDeltaEnvelope(10 + index, 201 + index, 5_700_000 + index));
    }

    now = 59_000;
    const heartbeat = { ...ksportEnvelope(400, "today", [], "worker-a:0", 458), observedAtMs: now,
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };
    expect(plane.ingest(heartbeat)).toBe(false);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);

    const replacement = (partition: "live" | "today", sequence: number, observedAtMs: number) => ({
      ...ksportEnvelope(sequence, partition, partition === "live" ? [202] : [], "worker-a:0", 500),
      observedAtMs
    });
    expect(plane.ingest(replacement("live", 500, 59_001))).toBe(false);
    now = 59_002;
    expect(plane.ingest(replacement("today", 501, 59_002))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "202" })]
    });
  });

  it("requests controller-governed recovery without heartbeat freshness maps", async () => {
    let now = 1_500;
    const onSourceRecoveryNeeded = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, onSourceRecoveryNeeded });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));

    now = 17_004;
    plane.ingest(tabHeartbeat(ksportEnvelope(3, "today", []), now, 3));
    expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith(SBOBET);
    await plane.overlayStatuses([activeSbobet]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(1);

    now = 47_005;
    await plane.overlayStatuses([activeSbobet]);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(2);
  });

  it("does not request recovery for a provider with no tab or feed evidence", async () => {
    const onSourceRecoveryNeeded = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 900_000, onSourceRecoveryNeeded });
    await plane.overlayStatuses([activeSaba, activeSbobet]);
    expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();
  });

  it("delivers SOFT first when a tab attaches after a long no-source period", async () => {
    let now = 0;
    const onSourceRecoveryNeeded = vi.fn();
    const registry = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: registry, onSourceRecoveryNeeded });

    now = 100_000;
    await plane.overlayStatuses([activeSaba]);
    expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();

    now = 100_001;
    plane.ingest(tabHeartbeat(sabaEnvelope(1, []), now, 2));

    expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith(SABA);
    expect(registry.snapshot(SABA)).toMatchObject({ recoveryStage: "SOFT", recoveryAttempt: 1 });
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

  it("publishes a stale CMD DOM overlay with network prices after authority expires", async () => {
    let now = 1_100;
    const publish = vi.fn();
    const registry = new ProviderFeedRegistry({ now: () => now });
    const plane = new ChromeCatalogDataPlane({ now: () => now, feedRegistry: registry, publish });
    expect(plane.ingest(cmdHttpEnvelope(1))).toBe(true);
    now = 5_100;
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    const visible = { ...record, matchId: "24881365", leagueId: "318", leagueName: "Visible Premier",
      teamNames: ["Visible Newcastle", "Visible Liverpool"], groups: [{
        ...record.groups[0]!, odds: record.groups[0]!.odds.map((odd) => ({ ...odd,
          marketOddsId: "visible-ah", priceText: "0.55" }))
      }] };
    const dom = { ...cmdEnvelope(2, [visible], 0, 1, "cmd:9:visible-overlay-0001"),
      sourceEpoch: "worker-a:0", observedAtMs: 5_100 };
    expect(plane.ingest(dom)).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ participantA: "Visible Newcastle" })],
      quotes: expect.arrayContaining([expect.objectContaining({ rawOdds: "-0.96", sequence: 1 })])
    }), "STALE");
    const calls = publish.mock.calls.length;
    expect(plane.ingest({ ...dom, sequence: 3, observedAtMs: 5_200 })).toBe(false);
    expect(publish).toHaveBeenCalledTimes(calls);
  });

  it("does not authorize malformed nonempty IM reconciliation partitions", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(plane.ingest(imEnvelope(1, "IM_MARKET_1", { StatusCode: 100,
      sel: [{ eid: 1, malformed: true }] }))).toBe(false);
    expect(plane.ingest(imEnvelope(2, "IM_MARKET_2", { StatusCode: 100, sel: [] }))).toBe(false);
    await expect(plane.read("catalog-source:IM:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
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

  it("keeps CMD DOM-only additions and complete-sweep tombstones without becoming LIVE", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const second = { ...record, matchId: "event-2", teamNames: ["Gamma", "Delta"], groups: [{
      ...record.groups[0]!, odds: record.groups[0]!.odds.map((odd) => ({ ...odd, marketOddsId: "market-2" }))
    }] };
    expect(plane.ingest(cmdSweepEnvelope(1, [record], false, "cmd:9:dom-only-a-0001",
      "cmd:9:dom-only-prior"))).toBe(true);
    expect(plane.ingest(cmdSweepEnvelope(2, [second], true, "cmd:9:dom-only-b-0002",
      "cmd:9:dom-only-prior"))).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ events: expect.arrayContaining([
      expect.objectContaining({ providerEventId: "event-1" }),
      expect.objectContaining({ providerEventId: "event-2" })
    ]) }), "STALE");

    expect(plane.ingest(cmdSweepEnvelope(3, [record], true, "cmd:9:dom-only-sweep-0003",
      "cmd:9:dom-only-next"))).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ providerEventId: "event-1" })]
    }), "STALE");
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });
});
