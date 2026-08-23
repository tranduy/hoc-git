import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogSourceStatus, ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";
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
      resourceType: "WebSocket", streamId: "saba-stream-1" },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["Data", { v: 2, revision: String(sequence),
      fields: sabaFields, rows }])}` } };
}

function ksportEnvelope(sequence: number, partition: "live" | "today", eventIds: readonly number[],
  sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope {
  const events = eventIds.map((eventId) => ({ "2": `Home ${eventId}`, "3": `Away ${eventId}`, "8": eventId,
    "7": { "3": [`2.5 0.92*${eventId}0030002005h -0.98*${eventId}0030002005a ${eventId}181025`] } }));
  const destination = `/topic/sports/1_1/${partition}/ma/event/vi`;
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const frame = `MESSAGE\ndestination:${destination}\nsubscription:${subscription}\nmessage-id:socket-${sequence}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
      body: JSON.stringify([{ "1": "League", "2": events }]) })}\0`;
  return { version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8,
    sourceEpoch, sequence, observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence,
    transport: "WS_FRAME", request: { hostname: "sports.example", pathnameClass: "/sport/session/websocket",
      resourceType: "WebSocket", streamId: "ksport-stream-1" },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([frame])}` } };
}

function tabHeartbeat(base: ChromeBridgeEnvelope, observedAtMs: number, sequence: number,
  sourceEpoch = base.sourceEpoch): ChromeBridgeEnvelope {
  return { ...base, sequence, observedAtMs, ...(sourceEpoch === undefined ? {} : { sourceEpoch }),
    transport: "TAB_STATE", request: { hostname: "sports.example",
      pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
    payload: { encoding: "UTF8", body: "{}" } };
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

  it("invalidates the prior epoch before accepting a replacement source baseline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500, publish });
    plane.ingest(ksportEnvelope(1, "live", [101], "worker-a:0"));
    plane.ingest(ksportEnvelope(2, "today", [102], "worker-a:0"));

    expect(plane.ingest(tabHeartbeat(ksportEnvelope(3, "today", [], "worker-a:0"),
      1_100, 3, "worker-b:0"))).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    expect(plane.ingest(ksportEnvelope(4, "live", [103], "worker-b:0"))).toBe(false);
    expect(plane.ingest(ksportEnvelope(5, "today", [], "worker-b:0"))).toBe(true);
    await expect(plane.read(SBOBET)).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "103" })]
    });
  });

  it("keeps one pinned tab per account and invalidates before handing over", async () => {
    let now = 1_500;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, freshnessMs: 20_000, publish });
    plane.ingest(ksportEnvelope(1, "live", [101]));
    plane.ingest(ksportEnvelope(2, "today", [102]));
    const sboHeartbeat: ChromeBridgeEnvelope = { ...tabHeartbeat(ksportEnvelope(3, "today", []), now, 3),
      lobby: "SBO", sourceId: "chrome:SBO:9", tabId: 9 };

    expect(plane.ingest(sboHeartbeat)).toBe(false);
    now = 30_000;
    expect(plane.ingest({ ...sboHeartbeat, observedAtMs: now, sequence: 4 })).toBe(true);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
    await expect(plane.read(SBOBET)).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("lets a new complete authoritative generation remove old events", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_500 });
    const ten = Array.from({ length: 10 }, (_, index) => 5_600_000 + index);
    plane.ingest(ksportEnvelope(1, "live", ten));
    expect(plane.ingest(ksportEnvelope(2, "today", []))).toBe(true);

    expect(plane.ingest(ksportEnvelope(3, "live", [5_600_000]))).toBe(true);
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
});
