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
      providerPartition },
    payload: { encoding: "UTF8", body: JSON.stringify({ StatusCode: 100, sel: [{ eid: 22,
      htn: "Home", atn: "Away", cn: "League", edt: "2026-08-16T20:00:00Z", isrbt: false,
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

const fallbackStatus: CatalogSourceStatus = { id: "catalog-source:CMD:FOOTBALL", alias: "T-Sports · CMD",
  provider: "CMD", category: "FOOTBALL", sessionState: "UNCONFIGURED", acquiredAtMs: null, reason: null };

describe("ChromeCatalogDataPlane", () => {
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

  it("requests one bounded recovery when IM transport stays live but its decoded catalog stops", async () => {
    let now = 1_500;
    const onSourceRecoveryNeeded = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000,
      recoveryAfterMs: 60_000, recoveryCooldownMs: 300_000, onSourceRecoveryNeeded });
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
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(1);
    await plane.overlayStatuses([authenticated]);
    await plane.overlayStatuses([authenticated]);

    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(1);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledWith("catalog-source:IM:FOOTBALL");
  });

  it("requests recovery when a bridge keeps heartbeating but never produces its first catalog", () => {
    let now = 1_000;
    const onSourceRecoveryNeeded = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000,
      recoveryAfterMs: 60_000, recoveryCooldownMs: 300_000, onSourceRecoveryNeeded });
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
    expect(onSourceRecoveryNeeded).not.toHaveBeenCalled();
    now = 61_001;
    expect(plane.ingest(heartbeat(3))).toBe(false);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledTimes(1);
    expect(onSourceRecoveryNeeded).toHaveBeenCalledWith("catalog-source:BTI:FOOTBALL");
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
      sourceEpoch: "observer-b:0", observedAtMs: 1_200 })).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE", "FRESH"]);
    const current = await plane.read("catalog-source:CMD:FOOTBALL");
    expect(current).toMatchObject({ observedAtMs: 1_200 });
    expect(current.events.map((event) => event.providerEventId)).toEqual(["event-1"]);
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

  it("drops an expired replay before decoding or publishing it", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 40_001, maxEnvelopeAgeMs: 30_000, publish });

    expect(plane.ingest(envelope())).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read("catalog-source:CMD:FOOTBALL")).rejects.toThrow("CHROME_CATALOG_NOT_FOUND");
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
