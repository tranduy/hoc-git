import { describe, expect, it, vi } from "vitest";
import type { CatalogSourceStatus, ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";

const record = { sportId: "1", leagueId: "league-1", leagueName: "League", matchId: "event-1",
  timeText: "08/17 02:30AM", teamNames: ["Alpha", "Beta"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
    { marketOddsId: "market-1", priceText: "0.9", status: null, greyedOut: "false", lineText: "0.5" },
    { marketOddsId: "market-1", priceText: "-0.9", status: null, greyedOut: "false", lineText: null }
  ] }] };

function envelope(sequence = 1, records: readonly unknown[] = [record], chunkIndex = 0, chunkCount = 1,
  snapshotId = "cmd:9:dataplane-0001"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, sequence,
    observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "DOM_SNAPSHOT",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({
      schemaVersion: 2, snapshotId, chunkIndex, chunkCount, records
    }) } };
}

function imEnvelope(providerPartition: "IM_MARKET_1" | "IM_MARKET_2" = "IM_MARKET_1",
  sequence = 1): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8, sequence,
    observedAtMs: 1_200, receivedMonotonicMs: 55, transport: "HTTP_RESPONSE",
    request: { hostname: "imsports.directsb.net", pathnameClass: "/api/EventV6/GetSE", resourceType: "XHR",
      providerPartition, streamId: "im:8:dataplane-generation-1" },
    payload: { encoding: "UTF8", body: JSON.stringify({ StatusCode: 100, sel: [{ eid: 22,
      htn: "Home", atn: "Away", cn: "League", edt: "1970-01-01T00:00:02Z", isrbt: false,
      iscyb: false, mls: [{ mi: 220, bti: 1, gp: 1, ws: [
        { wsi: 221, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
        { wsi: 222, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
      ] }] }] }) }
  };
}

const sabaFields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
  "enable", "odds1a", "odds2a", "hdp1", "hdp2"];
const encodeSaba = (value: Record<string, unknown>): unknown[] => Object.entries(value)
  .flatMap(([key, fieldValue]) => [sabaFields.indexOf(key), fieldValue]);
function sabaEnvelope(sequence: number, matchIds: readonly number[]): ChromeBridgeEnvelope {
  const rows: unknown[] = [["f", 0, sabaFields], [0, "reset"]];
  for (const matchId of matchIds) {
    rows.push(encodeSaba({ type: "l", leagueid: matchId, leaguenameen: `League ${matchId}`, sporttype: 1 }));
    rows.push(encodeSaba({ type: "m", matchid: matchId, leagueid: matchId, hteamnameen: `Home ${matchId}`,
      ateamnameen: `Away ${matchId}`, kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }));
    rows.push(encodeSaba({ type: "o", oddsid: matchId * 10, matchid: matchId, bettype: 1, parenttypeid: 1,
      oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }));
  }
  rows.push([0, "done"]);
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7,
    sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket",
      streamId: "saba-stream-1" },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b1", rows, sequence])}` } };
}

function sabaDomEnvelope(sequence: number, matchIds: readonly number[], homePrice = "0.77"): ChromeBridgeEnvelope {
  const records = matchIds.map((matchId) => ({ sportId: "1", leagueId: String(matchId),
    leagueName: `League ${matchId}`, matchId: String(matchId), timeText: "1H0'",
    teamNames: [`Home ${matchId}`, `Away ${matchId}`], groups: [{ betTypeIds: ["1"], labels: ["0.5"],
      odds: [{ marketOddsId: String(matchId * 10), priceText: homePrice, status: null,
        greyedOut: null, lineText: "0.5" },
      { marketOddsId: String(matchId * 10), priceText: "-0.87", status: null, greyedOut: null,
        lineText: null }] }] }));
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7,
    sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "DOM_SNAPSHOT",
    request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
      snapshotId: `saba:7:dom-generation-${sequence}`, chunkIndex: 0, chunkCount: 1, records }) } };
}

function ksportEnvelope(sequence: number, partition: "live" | "today", eventIds: readonly number[]): ChromeBridgeEnvelope {
  const events = eventIds.map((eventId) => ({ "2": `Home ${eventId}`, "3": `Away ${eventId}`, "8": eventId,
    "7": { "3": [`2.5 0.92*${eventId}0030002005h -0.98*${eventId}0030002005a ${eventId}181025`] } }));
  const destination = `/topic/sports/1_1/${partition}/ma/event/vi`;
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const frame = `MESSAGE\ndestination:${destination}\nsubscription:${subscription}\nmessage-id:socket-${sequence}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
      body: JSON.stringify([{ "1": "League", "2": events }]) })}\0`;
  return { version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8,
    sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/sport/session/websocket",
      resourceType: "WebSocket", streamId: "ksport-stream-1" },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([frame])}` } };
}

const btiPaths = ["live", "live/initial", "prematch", "prematch/initial"] as const;
function btiEnvelope(sequence: number, path: typeof btiPaths[number], generation = "bti:1000:1"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "BTI", sourceId: "chrome:BTI:9", tabId: 9, sequence,
    observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "bti.example", pathnameClass: `/api/eventlist/asia/leagues/v2/1/${path}`,
      resourceType: "Fetch", streamId: generation },
    payload: { encoding: "UTF8", body: JSON.stringify({ serializedData: [] }) } };
}

const fallbackStatus: CatalogSourceStatus = { id: "catalog-source:CMD:FOOTBALL", alias: "T-Sports · CMD",
  provider: "CMD", category: "FOOTBALL", sessionState: "UNCONFIGURED", acquiredAtMs: null, reason: null };

describe("ChromeCatalogDataPlane", () => {
  it("drops retained adapter state when a provider moves to a replacement tab", async () => {
    let now = 1_000;
    const plane = new ChromeCatalogDataPlane({ now: () => now });
    const replacementRecord = { ...record, matchId: "event-2", teamNames: ["Gamma", "Delta"] };
    const returnedRecord = { ...record, matchId: "event-3", teamNames: ["Epsilon", "Zeta"] };
    const fromSource = (sourceId: string, tabId: number, sequence: number, value: unknown,
      snapshotId: string): ChromeBridgeEnvelope => ({
      ...envelope(sequence, [value], 0, 1, snapshotId), sourceId, tabId, observedAtMs: now
    });

    expect(plane.ingest(fromSource("chrome:CMD:9", 9, 1, record, "cmd:9:source-switch-first-0001"))).toBe(true);
    now += 1;
    expect(plane.ingest(fromSource("chrome:CMD:10", 10, 1, replacementRecord,
      "cmd:10:source-switch-first-0001"))).toBe(true);
    now += 1;
    expect(plane.ingest(fromSource("chrome:CMD:9", 9, 2, returnedRecord,
      "cmd:9:source-switch-returned-0002"))).toBe(true);

    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({
      events: [{ providerEventId: "event-3" }]
    });
  });

  it("keeps one pinned tab per account while it is talking and hands over only after it goes silent", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000, publish });
    const ksportLive = ksportEnvelope(1, "live", [101]);
    const ksportToday = ksportEnvelope(2, "today", [102]);
    const sboFrame: ChromeBridgeEnvelope = { ...ksportEnvelope(1, "live", []), lobby: "SBO",
      sourceId: "chrome:SBO:9", tabId: 9, transport: "TAB_STATE",
      request: { hostname: "sports-sbomaind-play.jjsskktt.com", pathnameClass: "/__fieldline_heartbeat__",
        resourceType: "Tab" }, payload: { encoding: "UTF8", body: "{}" } };

    expect(plane.ingest(ksportLive)).toBe(false);
    // A second tab for the same account must not reset the pinned decoder.
    expect(plane.ingest({ ...sboFrame, observedAtMs: now })).toBe(false);
    expect(plane.ingest(ksportToday)).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(plane.read("catalog-source:SBOBET:FOOTBALL")).resolves.toMatchObject({ provider: "SBOBET" });

    // Once the pinned tab has been silent past the freshness window, the
    // other tab may take over.
    now = 30_000;
    expect(plane.ingest({ ...sboFrame, sequence: 5, observedAtMs: now })).toBe(false);
    now = 30_100;
    expect(plane.ingest({ ...ksportEnvelope(3, "live", [103]), observedAtMs: now })).toBe(false);
  });

  it("does not report an authenticated bridge source as active until it has a fresh decoded catalog", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      sessionState: "ACTIVE",
      acquiredAtMs: 900,
      reason: null
    };

    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED",
      reason: "PROVIDER_VALIDATION_FAILED"
    }]);

    expect(plane.ingest(envelope())).toBe(true);
    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTIVE",
      acquiredAtMs: 1_000,
      reason: null
    }]);

    now = 21_001;
    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED",
      reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("keeps a previously decoded source connected on fresh transport traffic without making stale prices executable", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      sessionState: "ACTIVE",
      acquiredAtMs: 900,
      reason: null
    };
    expect(plane.ingest(envelope())).toBe(true);

    now = 21_001;
    const heartbeat = { ...envelope(2), observedAtMs: now,
      payload: { encoding: "UTF8" as const, body: "{}" } };
    expect(plane.ingest(heartbeat)).toBe(false);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_STALE");
    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTIVE",
      acquiredAtMs: 1_000,
      reason: null
    }]);
  });

  it("does not treat a KSPORT tab heartbeat as fresh sportsbook transport", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      id: "catalog-source:SBOBET:FOOTBALL",
      alias: "K-Sports · SBOBET",
      provider: "SBOBET",
      sessionState: "ACTIVE",
      acquiredAtMs: 900,
      reason: null
    };
    expect(plane.ingest(ksportEnvelope(1, "live", [101]))).toBe(false);
    expect(plane.ingest(ksportEnvelope(2, "today", [102]))).toBe(true);

    now = 21_003;
    expect(plane.ingest({
      ...ksportEnvelope(3, "today", []),
      observedAtMs: now,
      transport: "TAB_STATE",
      request: { hostname: "zenandfe.com", pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
      payload: { encoding: "UTF8", body: "{}" }
    })).toBe(false);

    expect(plane.ingest({
      ...ksportEnvelope(4, "today", []),
      observedAtMs: now,
      payload: { encoding: "UTF8", body: `a${JSON.stringify(["\n"])}` }
    })).toBe(false);

    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTIVE",
      acquiredAtMs: 1_002,
      reason: null
    }]);
  });

  it("reports stale IM without starting an unauthorized source replacement", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      id: "catalog-source:IM:FOOTBALL",
      provider: "IM",
      sessionState: "ACTIVE",
      acquiredAtMs: 900,
      reason: null
    };
    expect(plane.ingest(imEnvelope("IM_MARKET_1", 1))).toBe(false);
    expect(plane.ingest(imEnvelope("IM_MARKET_2", 2))).toBe(true);

    now = 61_201;
    expect(plane.ingest({ ...imEnvelope("IM_MARKET_2", 3), observedAtMs: now,
      request: { hostname: "imsports.directsb.net", pathnameClass: "/__fieldline_heartbeat__",
        resourceType: "Other" },
      payload: { encoding: "UTF8", body: "{}" } })).toBe(false);
    await plane.overlayStatuses([authenticated]);
    await plane.overlayStatuses([authenticated]);
  });

  it("does not replace a source that keeps heartbeating without its first catalog", () => {
    let now = 1_000;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const heartbeat = (sequence: number): ChromeBridgeEnvelope => ({
      ...envelope(sequence), observedAtMs: now, transport: "TAB_STATE",
      request: { hostname: "prod20091.fxf774.com", pathnameClass: "/__fieldline_heartbeat__",
        resourceType: "Tab" },
      lobby: "BTI", sourceId: "chrome:BTI:9", tabId: 9,
      payload: { encoding: "UTF8", body: "{}" }
    });

    expect(plane.ingest(heartbeat(1))).toBe(false);
    now = 60_999;
    expect(plane.ingest(heartbeat(2))).toBe(false);
    now = 61_001;
    expect(plane.ingest(heartbeat(3))).toBe(false);
  });

  it("does not mistake a BTI tab heartbeat for a fresh event-list response", async () => {
    let now = 1_500;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = { ...fallbackStatus,
      id: "catalog-source:BTI:FOOTBALL", alias: "BTI Football", provider: "BTI",
      sessionState: "ACTIVE", acquiredAtMs: 900, reason: null };
    for (const [index, path] of btiPaths.entries()) {
      expect(plane.ingest(btiEnvelope(index + 1, path))).toBe(index === 3);
    }
    now = 21_005;
    expect(plane.ingest({ ...btiEnvelope(5, "live", "bti:2000:1"), observedAtMs: now,
      transport: "TAB_STATE",
      request: { hostname: "bti.example", pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
      payload: { encoding: "UTF8", body: "{}" } })).toBe(false);

    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED", acquiredAtMs: 1_004, reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("reports a missing BTI transport without automatically replacing its tab", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 61_001, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      id: "catalog-source:BTI:FOOTBALL",
      alias: "BTI Football",
      provider: "BTI",
      sessionState: "ACTIVE",
      acquiredAtMs: 1_000,
      reason: null
    };

    await expect(plane.overlayStatuses([authenticated])).resolves.toMatchObject([{
      sessionState: "ACTION_REQUIRED",
      reason: "PROVIDER_VALIDATION_FAILED"
    }]);
  });

  it("does not replace another provider tab only because the API has not received its first transport yet", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 61_001, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      id: "catalog-source:IM:FOOTBALL",
      alias: "I-Sports · IM",
      provider: "IM",
      sessionState: "ACTIVE",
      acquiredAtMs: 1_000,
      reason: null
    };

    await plane.overlayStatuses([authenticated]);
  });

  it("does not replace an existing BTI tab after an API restart", async () => {
    let now = 61_001;
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000 });
    const authenticated: CatalogSourceStatus = {
      ...fallbackStatus,
      id: "catalog-source:BTI:FOOTBALL",
      alias: "BTI Football",
      provider: "BTI",
      sessionState: "ACTIVE",
      acquiredAtMs: 1_000,
      reason: null
    };

    await plane.overlayStatuses([authenticated]);

    now += 10_001;
    await plane.overlayStatuses([authenticated]);
  });

  it("owns every configured Football source while the Chrome bridge is enabled", () => {
    const plane = new ChromeCatalogDataPlane();
    expect(plane.owns("catalog-source:CMD:FOOTBALL")).toBe(true);
    expect(plane.owns("catalog-source:IM:FOOTBALL")).toBe(true);
    expect(plane.owns("catalog-source:SABA:FOOTBALL")).toBe(true);
    expect(plane.owns("catalog-source:SBOBET:FOOTBALL")).toBe(true);
    expect(plane.owns("catalog-source:APSPORT:FOOTBALL")).toBe(true);
    expect(plane.owns("catalog-source:BTI:FOOTBALL")).toBe(true);
    expect(plane.owns("unrelated-account")).toBe(false);
  });

  it("serves and publishes a fresh CMD catalog directly from the attached Chrome tab", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, publish });
    expect(plane.ingest(envelope())).toBe(true);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({
      provider: "CMD", events: [{ providerEventId: "event-1" }]
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await plane.overlayStatuses([fallbackStatus])).toMatchObject([{
      id: "catalog-source:CMD:FOOTBALL", sessionState: "ACTIVE", acquiredAtMs: 1_000
    }]);

    // Provider HTTP feeds commonly poll every 10-15 seconds. Do not flap a
    // healthy source to stale between two legitimate polls.
    now = 20_999;
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_000 });
    now = 21_001;
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_STALE");
  });

  it("marks the old catalog stale immediately when the source epoch changes before a new baseline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const priorOnly = { ...record, matchId: "event-old",
      groups: record.groups.map((group) => ({ ...group, odds: group.odds.map((odd) => ({ ...odd,
        marketOddsId: "market-old" })) })) };
    expect(plane.ingest({ ...envelope(1, [record, priorOnly]), sourceEpoch: "observer-a:0" })).toBe(true);

    const heartbeat: ChromeBridgeEnvelope = {
      ...envelope(2), sourceEpoch: "observer-b:0", observedAtMs: 1_100, transport: "TAB_STATE",
      request: { hostname: "cgnew.fts368.com", pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
      payload: { encoding: "UTF8", body: "{}" }
    };
    expect(plane.ingest(heartbeat)).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_STALE");

    expect(plane.ingest({ ...envelope(3, [record], 0, 1, "cmd:9:dataplane-epoch-0002"),
      sourceEpoch: "observer-b:0", observedAtMs: 1_200 })).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
    plane.resetCoverage("catalog-source:CMD:FOOTBALL");
    expect(plane.ingest({ ...envelope(4, [record], 0, 1, "cmd:9:dataplane-epoch-0003"),
      sourceEpoch: "observer-b:0", observedAtMs: 1_200 })).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE", "FRESH"]);
    const current = await plane.read("catalog-source:CMD:FOOTBALL");
    expect(current).toMatchObject({ observedAtMs: 1_200 });
    expect(current.events.map((event) => event.providerEventId)).toEqual(["event-1"]);
  });

  it("restores the last durable catalog as stale and refuses repeated partial reconnect frames", async () => {
    const original = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(original.ingest(sabaEnvelope(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(true);
    const complete = await original.read("catalog-source:SABA:FOOTBALL");
    const publish = vi.fn();
    const restarted = new ChromeCatalogDataPlane({ now: () => 1_500, publish });

    restarted.restore(complete);

    expect(publish).toHaveBeenCalledWith(complete, "STALE");
    await expect(restarted.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_STALE");
    for (const sequence of [2, 3, 4, 5]) {
      expect(restarted.ingest(sabaEnvelope(sequence, [1]))).toBe(false);
    }
    expect(publish).toHaveBeenCalledTimes(1);

    restarted.resetCoverage("catalog-source:SABA:FOOTBALL");
    expect(restarted.ingest(sabaEnvelope(6, [1]))).toBe(true);
    expect(publish.mock.calls.at(-1)?.[1]).toBe("FRESH");
  });

  it("overlays a stable SABA DOM price generation onto the durable full catalog after restart", async () => {
    const original = new ChromeCatalogDataPlane({ now: () => 1_500 });
    const ids = Array.from({ length: 30 }, (_, index) => index + 1);
    expect(original.ingest(sabaEnvelope(1, ids))).toBe(true);
    const complete = await original.read("catalog-source:SABA:FOOTBALL");
    const restarted = new ChromeCatalogDataPlane({ now: () => 1_500 });
    restarted.restore(complete);

    const visible = ids.slice(0, 20);
    expect(restarted.ingest(sabaDomEnvelope(2, visible))).toBe(false);
    expect(restarted.ingest(sabaDomEnvelope(3, visible))).toBe(true);

    const current = await restarted.read("catalog-source:SABA:FOOTBALL");
    expect(current.events).toHaveLength(30);
    expect(current.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "30" })
    ]));
    expect(current.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "10:home", rawOdds: "0.77", sequence: 3 })
    ]));
  });

  it("does not replace the latest verified catalog with malformed data", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    plane.ingest(envelope());
    expect(plane.ingest({ ...envelope(2), payload: { encoding: "UTF8", body: "{}" } })).toBe(false);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({ observedAtMs: 1_000 });
  });

  it("does not replace a usable catalog with a partially rendered zero-market snapshot", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    expect(plane.ingest(envelope())).toBe(true);

    const incomplete = { ...record, groups: [] };
    expect(plane.ingest(envelope(2, [incomplete], 0, 1, "cmd:9:dataplane-0002"))).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({
      events: [{ providerEventId: "event-1" }], markets: [{ providerMarketId: "market-1" }]
    });
  });

  it("retains a complete catalog when a transient snapshot loses most events", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    expect(plane.ingest(sabaEnvelope(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(true);

    expect(plane.ingest(sabaEnvelope(2, [1]))).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ providerEventId: "1" }),
        expect.objectContaining({ providerEventId: "10" })
      ])
    });
  });

  it("accepts a completed authoritative KSPORT partition after real event coverage shrinks", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    const ten = Array.from({ length: 10 }, (_, index) => 5_600_000 + index);
    expect(plane.ingest(ksportEnvelope(1, "live", ten))).toBe(false);
    expect(plane.ingest(ksportEnvelope(2, "today", []))).toBe(true);

    expect(plane.ingest(ksportEnvelope(3, "live", [5_600_000]))).toBe(true);
    await expect(plane.read("catalog-source:SBOBET:FOOTBALL")).resolves.toMatchObject({
      events: [{ providerEventId: "5600000" }]
    });
  });

  it("marks a provider stale immediately when its catalog socket closes", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const baseline = sabaEnvelope(1, [1]);
    expect(plane.ingest(baseline)).toBe(true);
    const closed: ChromeBridgeEnvelope = { ...baseline, sequence: 2, observedAtMs: 1_100,
      receivedMonotonicMs: 60, transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } };
    expect(plane.ingest(closed)).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_STALE");
  });

  it("accepts a smaller live baseline after a catalog restored from disk or a stale retained floor", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000,
      coverageFloorMaxAgeMs: 600_000, publish });
    const big = new ChromeCatalogDataPlane({ now: () => 1_500, publish: (catalog) => plane.restore(catalog) });
    expect(big.ingest(sabaEnvelope(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "SABA" }), "STALE");

    // Hours later the provider genuinely lists far fewer matches.
    now = 5_000_000;
    expect(plane.ingest({ ...sabaEnvelope(2, [1, 2]), observedAtMs: now })).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "SABA" }), "FRESH");
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({ events: [
      { providerEventId: "1" }, { providerEventId: "2" }] });

    // A partial read moments after a complete one is still rejected.
    now += 1_000;
    expect(plane.ingest({ ...sabaEnvelope(3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), observedAtMs: now })).toBe(true);
    now += 1_000;
    expect(plane.ingest({ ...sabaEnvelope(4, [1]), observedAtMs: now })).toBe(false);
  });

  describe("automatic stall recovery", () => {
    const sbobetStatus: CatalogSourceStatus = { ...fallbackStatus, id: "catalog-source:SBOBET:FOOTBALL",
      alias: "K-Sports · SBOBET", provider: "SBOBET", sessionState: "ACTIVE", acquiredAtMs: 900, reason: null };
    const sabaStatus: CatalogSourceStatus = { ...fallbackStatus, id: "catalog-source:SABA:FOOTBALL",
      alias: "SABA", provider: "SABA", sessionState: "ACTIVE", acquiredAtMs: 900, reason: null };
    const sabaHeartbeat = (sequence: number, observedAtMs: number): ChromeBridgeEnvelope => ({
      ...sabaEnvelope(sequence, []), observedAtMs, transport: "TAB_STATE",
      request: { hostname: "sports.example", pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
      payload: { encoding: "UTF8", body: "{}" } });

    it("requests a targeted replacement once a streaming provider stays stale for the recovery window", async () => {
      let now = 1_500;
      const onSourceRecoveryNeeded = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000,
        recoveryAfterMs: 60_000, recoveryCooldownMs: 300_000, onSourceRecoveryNeeded });
      expect(plane.ingest(sabaEnvelope(1, [1]))).toBe(true);

      now = 50_000;
      expect(plane.ingest(sabaHeartbeat(2, now))).toBe(false);
      await plane.overlayStatuses([sabaStatus]);
      expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();

      now = 61_600;
      expect(plane.ingest(sabaHeartbeat(3, now))).toBe(false);
      expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith("catalog-source:SABA:FOOTBALL");

      // Cooldown: repeated status reads and heartbeats do not thrash the tab.
      now = 120_000;
      await plane.overlayStatuses([sabaStatus]);
      expect(plane.ingest(sabaHeartbeat(4, now))).toBe(false);
      expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(1);

      now = 361_700;
      await plane.overlayStatuses([sabaStatus]);
      expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(2);
    });

    it("does not request recovery for CMD or IM, which re-request their catalog in page", async () => {
      let now = 1_500;
      const onSourceRecoveryNeeded = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000, onSourceRecoveryNeeded });
      expect(plane.ingest(envelope(1))).toBe(true);
      expect(plane.ingest(imEnvelope("IM_MARKET_1", 1))).toBe(false);
      expect(plane.ingest(imEnvelope("IM_MARKET_2", 2))).toBe(true);

      now = 200_000;
      await plane.overlayStatuses([
        { ...fallbackStatus, sessionState: "ACTIVE", acquiredAtMs: 900 },
        { ...fallbackStatus, id: "catalog-source:IM:FOOTBALL", provider: "IM", sessionState: "ACTIVE",
          acquiredAtMs: 900 }
      ]);
      expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();
    });

    it("treats a quiet KSPORT sportsbook heartbeat as a live feed instead of a stall", async () => {
      let now = 1_500;
      const onSourceRecoveryNeeded = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000,
        recoveryAfterMs: 60_000, onSourceRecoveryNeeded });
      expect(plane.ingest(ksportEnvelope(1, "live", [101]))).toBe(false);
      expect(plane.ingest(ksportEnvelope(2, "today", [102]))).toBe(true);

      for (let sequence = 3; sequence <= 12; sequence += 1) {
        now += 15_000;
        expect(plane.ingest({ ...ksportEnvelope(sequence, "today", []), observedAtMs: now,
          payload: { encoding: "UTF8", body: `a${JSON.stringify(["\n"])}` } })).toBe(false);
        await plane.overlayStatuses([sbobetStatus]);
      }
      expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();

      // Once the sportsbook socket itself goes silent, recovery is requested.
      now += 61_000;
      await plane.overlayStatuses([sbobetStatus]);
      expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith("catalog-source:SBOBET:FOOTBALL");
    });

    it("gives a catalog restored from disk a full window after startup before replacing its tab", async () => {
      let now = 500_000;
      const onSourceRecoveryNeeded = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000,
        recoveryAfterMs: 60_000, onSourceRecoveryNeeded });
      const durable = new ChromeCatalogDataPlane({ now: () => 1_500,
        publish: (catalog) => plane.restore(catalog) });
      expect(durable.ingest(sabaEnvelope(1, [1]))).toBe(true);

      now = 559_999;
      await plane.overlayStatuses([sabaStatus]);
      expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();

      now = 560_000;
      await plane.overlayStatuses([sabaStatus]);
      expect(onSourceRecoveryNeeded).toHaveBeenCalledExactlyOnceWith("catalog-source:SABA:FOOTBALL");
    });

    it("never replaces a tab that has not yet produced any transport or catalog", async () => {
      const onSourceRecoveryNeeded = vi.fn();
      const plane = new ChromeCatalogDataPlane({ now: () => 900_000, freshnessMs: 20_000, onSourceRecoveryNeeded });
      await plane.overlayStatuses([sabaStatus, sbobetStatus,
        { ...fallbackStatus, id: "catalog-source:BTI:FOOTBALL", provider: "BTI", sessionState: "ACTIVE",
          acquiredAtMs: 1_000 }]);
      expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();
    });
  });

  it("drops an expired replay before decoding or publishing it", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 40_001, maxEnvelopeAgeMs: 30_000, publish });

    expect(plane.ingest(envelope())).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_NOT_FOUND");
  });

  it("rehydrates an expired retained frame as stale without pretending its timestamp is current", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 40_001, maxEnvelopeAgeMs: 30_000, publish });
    const replayed = { ...envelope(), request: { ...envelope().request, replayed: true } };

    expect(plane.ingest(replayed)).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ observedAtMs: 1_000 }), "STALE");
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_STALE");
  });

  it("does not publish a partial chunked catalog", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    const second = { ...record, matchId: "event-2" };
    const id = "cmd:9:dataplane-chunked-0001";
    expect(plane.ingest(envelope(1, [record], 0, 2, id))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_NOT_FOUND");
    expect(plane.ingest(envelope(2, [second], 1, 2, id))).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).resolves.toMatchObject({
      events: [{ providerEventId: "event-1" }, { providerEventId: "event-2" }]
    });
  });

  it("serves an IM catalog from the authenticated Chrome response instead of the legacy reader", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    expect(plane.ingest(imEnvelope("IM_MARKET_1", 1))).toBe(false);
    expect(plane.ingest(imEnvelope("IM_MARKET_2", 2))).toBe(true);
    await expect(plane.read("catalog-source:IM:FOOTBALL")).resolves.toMatchObject({
      provider: "IM", events: [{ providerEventId: "22" }]
    });
  });
});
