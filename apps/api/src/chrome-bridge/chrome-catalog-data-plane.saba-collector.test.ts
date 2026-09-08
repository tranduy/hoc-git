import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import type { SabaCollectorDomItem } from "./saba-collector-dom.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";

const SOURCE = "chrome:SABA:7";
const EPOCH = "worker-a:0";
const WALL = Date.UTC(2026, 8, 8, 10);

const group = (marketOddsId: string, nativeType = "1") => ({ betTypeIds: [nativeType],
  labels: ["0.5"], odds: [
    { marketOddsId, priceText: "0.91", status: null, greyedOut: null, lineText: "0.5" },
    { marketOddsId, priceText: "-0.93", status: null, greyedOut: null }
  ] });
const record = (matchId: string, timeText = "09/08 08:00PM", nativeType = "1") => ({
  sportId: "1" as const, leagueId: "league", leagueName: "League", matchId, timeText,
  teamNames: [`${matchId} home`, `${matchId} away`], groups: [group(`${matchId}-market`, nativeType)]
});

function domEnvelope(sequence: number, records: readonly unknown[]): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: SOURCE, sourceEpoch: EPOCH,
    tabId: 7, sequence, observedAtMs: WALL + sequence, receivedMonotonicMs: 100 + sequence,
    transport: "DOM_SNAPSHOT", request: { hostname: "sports.example",
      pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
      snapshotId: `saba:7:legacy-snapshot-${sequence}`, chunkIndex: 0, chunkCount: 1, records }) } };
}

function collectorEnvelope(sequence = 2): ChromeBridgeEnvelope {
  const generation = "saba:collector:dataplane";
  const owners = ["legacy-0", "hidden", "unknown"] as const;
  const captures: SabaCollectorDomItem[] = owners.map((ownerMatchId, captureOrdinal) => ({
    kind: "CAPTURE", collectorGeneration: generation, period: captureOrdinal === 2 ? "EARLY" : "TODAY",
    ownerMatchId, captureKind: "ROSTER", kickoffDate: captureOrdinal === 2
      ? { kind: "UNKNOWN" } : { kind: "EXPLICIT", isoDate: "2026-09-08" },
    capturedAtMs: WALL + captureOrdinal, capturedMonotonicMs: 150.5 + captureOrdinal,
    captureOrdinal, record: captureOrdinal === 2 ? record(ownerMatchId, "01:45AM", "999") :
      record(ownerMatchId)
  }));
  const today = owners.slice(0, 2);
  const early = owners.slice(2);
  const items: SabaCollectorDomItem[] = [...captures,
    ...owners.map((ownerMatchId, index) => ({ kind: "OWNER_COMPLETE" as const,
      collectorGeneration: generation, period: index === 2 ? "EARLY" as const : "TODAY" as const,
      ownerMatchId, safeControlOutcome: "NO_ELIGIBLE_CONTROL" as const, restored: true })),
    { kind: "PERIOD_COMPLETE", collectorGeneration: generation, period: "TODAY",
      rosterMatchIds: today, rosterCount: today.length },
    { kind: "PERIOD_COMPLETE", collectorGeneration: generation, period: "EARLY",
      rosterMatchIds: early, rosterCount: early.length },
    { kind: "TERMINAL", collectorGeneration: generation,
      periods: [{ period: "TODAY", rosterMatchIds: today, rosterCount: today.length },
        { period: "EARLY", rosterMatchIds: early, rosterCount: early.length }],
      owners: [{ period: "TODAY", ownerMatchId: "legacy-0" },
        { period: "TODAY", ownerMatchId: "hidden" },
        { period: "EARLY", ownerMatchId: "unknown" }],
      todayRestoration: { selected: true, rosterMatchIds: today, rosterCount: today.length },
      unresolvedOwners: [], failedOwners: [] }
  ];
  return { ...domEnvelope(sequence, []), receivedMonotonicMs: 300.5,
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
      snapshotId: `saba:collector:snapshot-${sequence}`, chunkIndex: 0, chunkCount: 1,
      sweepId: generation, sweepComplete: true, sweepFrameKey: "sports-frame",
      sweepDocumentKey: "document-1", records: items }) } };
}

function largeCollectorEnvelope(sequence = 2): ChromeBridgeEnvelope {
  const envelope = collectorEnvelope(sequence);
  const body = JSON.parse(envelope.payload.body);
  const generation = body.sweepId;
  const owners = Array.from({ length: 50 }, (_, index) => `retained-${index}`);
  body.records = [
    ...owners.map((ownerMatchId, captureOrdinal) => ({ kind: "CAPTURE", collectorGeneration: generation,
      period: "TODAY", ownerMatchId, captureKind: "ROSTER", kickoffDate: { kind: "UNKNOWN" },
      capturedAtMs: WALL + captureOrdinal, capturedMonotonicMs: 150.5 + captureOrdinal, captureOrdinal,
      record: record(ownerMatchId) })),
    ...owners.map((ownerMatchId) => ({ kind: "OWNER_COMPLETE", collectorGeneration: generation,
      period: "TODAY", ownerMatchId, safeControlOutcome: "NO_ELIGIBLE_CONTROL", restored: true })),
    ...["TODAY", "EARLY"].map((period) => ({ kind: "PERIOD_COMPLETE", collectorGeneration: generation,
      period, rosterMatchIds: period === "TODAY" ? owners : [], rosterCount: period === "TODAY" ? 50 : 0 })),
    { kind: "TERMINAL", collectorGeneration: generation,
      periods: [{ period: "TODAY", rosterMatchIds: owners, rosterCount: 50 },
        { period: "EARLY", rosterMatchIds: [], rosterCount: 0 }],
      owners: owners.map((ownerMatchId) => ({ period: "TODAY", ownerMatchId })),
      todayRestoration: { selected: true, rosterMatchIds: owners, rosterCount: 50 },
      unresolvedOwners: [], failedOwners: [] }
  ];
  return { ...envelope, observedAtMs: WALL + 100, payload: { encoding: "UTF8", body: JSON.stringify(body) } };
}

function smallWsBaseline(sequence: number): ChromeBridgeEnvelope {
  const fields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
    "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
    "enable", "odds1a", "odds2a", "hdp1", "hdp2"];
  const encode = (value: Record<string, unknown>) => Object.entries(value).flatMap(([key, item]) => [fields.indexOf(key), item]);
  const rows = [["f", 0, fields], [0, "reset"],
    encode({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
    encode({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "2 home", ateamnameen: "2 away",
      kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
    encode({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
      oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }), [0, "done"]];
  return { ...domEnvelope(sequence, []), sourceEpoch: "worker-a:1", observedAtMs: WALL + 100 + sequence,
    receivedMonotonicMs: 400 + sequence, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket",
      streamId: "1" }, payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b1", rows, `r${sequence}`])}` } };
}

describe("ChromeCatalogDataPlane SABA collector boundary", () => {
  it.each([
    [1_000_000, 50], [10, 1_000_000]
  ])("localizes SABA source clock %s into API clock %s without hiding receipt age", async (sourceClock, apiClock) => {
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 135, monotonicNow: () => apiClock });
    const ws = { ...smallWsBaseline(5), receivedMonotonicMs: sourceClock };
    plane.ingest({ ...ws, sequence: 4, transport: "WS_STATE", payload: { encoding: "UTF8", body: '{"state":"OPEN"}' } });
    expect(plane.ingest(ws)).toBe(true);
    const catalog = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(catalog.quotes).toHaveLength(2);
    expect(catalog.quotes.map(({ receivedMonotonicMs }) => receivedMonotonicMs)).toEqual([apiClock - 30, apiClock - 30]);
  });

  it.each([false, true])("does not let pre-DOM WS use retained inventory for promotion (failed prior DOM=%s)", async (failDom) => {
    const coordinator = new ProviderAuthorityCoordinator();
    const rejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000, authorityCoordinator: coordinator,
      onIngestRejected: rejected });
    const baseline = Array.from({ length: 50 }, (_, index) => record(`legacy-${index}`));
    expect(plane.ingest(domEnvelope(1, baseline), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(largeCollectorEnvelope(), { connectionGeneration: 1 }), rejected.mock.calls.at(-1)?.[1]).toBe(true);
    const before = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(before.events).toHaveLength(50);
    if (failDom) {
      const promote = vi.spyOn(coordinator, "promote").mockReturnValueOnce({ promoted: false, reason: "PROMOTION_TRANSACTION_FAILED" });
      expect(plane.ingest({ ...domEnvelope(3, baseline), sourceEpoch: "worker-a:1" }, { connectionGeneration: 1 })).toBe(false);
      expect(rejected.mock.calls.at(-1)?.[1]).toContain("CANDIDATE_PROMOTION_REJECTED");
      promote.mockRestore();
    }
    const ws = smallWsBaseline(5);
    plane.ingest({ ...ws, sequence: 4, transport: "WS_STATE", payload: { encoding: "UTF8", body: '{"state":"OPEN"}' } },
      { connectionGeneration: 1 });
    expect(plane.ingest(ws, { connectionGeneration: 1 })).toBe(false);
    expect(rejected.mock.calls.at(-1)?.[1]).toBe("SABA_REPLACEMENT_COVERAGE_INCOMPLETE");
    expect(coordinator.snapshot("catalog-source:SABA:FOOTBALL").active?.sourceEpoch).toBe(EPOCH);
    expect((await plane.read("catalog-source:SABA:FOOTBALL")).events).toEqual(before.events);
    const promoted = plane.ingest({ ...domEnvelope(6, baseline), sourceEpoch: "worker-a:1",
      observedAtMs: WALL + 106, receivedMonotonicMs: 406 }, { connectionGeneration: 1 });
    expect(promoted, rejected.mock.calls.at(-1)?.[1]).toBe(true);
    expect((await plane.read("catalog-source:SABA:FOOTBALL")).quotes
      .filter(({ providerEventId }) => providerEventId.startsWith("retained-"))).toEqual(before.quotes);
  });

  it.each([
    ["same-worker epoch replacement", "worker-a:1", 1],
    ["same epoch connection replacement", EPOCH, 2]
  ] as const)("retains completed hidden inventory through %s without renewing quote clocks", async (_label, epoch, connection) => {
    const rejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000,
      onIngestRejected: rejected });
    const baseline = Array.from({ length: 50 }, (_, index) => record(`legacy-${index}`));
    expect(plane.ingest(domEnvelope(1, baseline), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(collectorEnvelope(), { connectionGeneration: 1 })).toBe(true);
    const previous = await plane.read("catalog-source:SABA:FOOTBALL");
    const oldHidden = previous.quotes.filter(({ providerEventId }) => providerEventId === "hidden");
    expect(oldHidden).toHaveLength(2);

    expect(plane.ingest({ ...domEnvelope(3, baseline), sourceEpoch: epoch },
      { connectionGeneration: connection }), rejected.mock.calls.at(-1)?.[1]).toBe(true);
    const retained = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(retained.quotes.filter(({ providerEventId }) => providerEventId === "hidden")).toEqual(oldHidden);
    expect(retained.nativeMarketObservations?.filter(({ providerEventId }) => providerEventId === "unknown"))
      .toEqual(previous.nativeMarketObservations?.filter(({ providerEventId }) => providerEventId === "unknown"));
    expect(retained.events.map(({ providerEventId }) => providerEventId).sort()).toEqual(["hidden", "legacy-0"]);
  });

  it.each([
    ["different source", "chrome:SABA:8", 8, "worker-a:1"],
    ["different monotonic clock lineage", SOURCE, 7, "worker-b:0"]
  ] as const)("does not import collector inventory from a %s", async (_label, sourceId, tabId, epoch) => {
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000 });
    const baseline = Array.from({ length: 50 }, (_, index) => record(`legacy-${index}`));
    expect(plane.ingest(domEnvelope(1, baseline), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest(collectorEnvelope(), { connectionGeneration: 1 })).toBe(true);
    expect(plane.ingest({ ...domEnvelope(3, baseline), sourceId, tabId, sourceEpoch: epoch },
      { connectionGeneration: 2 })).toBe(true);
    const current = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(current.events.some(({ providerEventId }) => providerEventId === "hidden")).toBe(false);
    expect(current.nativeMarketObservations?.some(({ providerEventId }) => providerEventId === "unknown")).toBe(false);
  });

  it("uses a terminal collector as the qualified DOM replacement without overlay resurrection", async () => {
    const publish = vi.fn();
    const rejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000, publish,
      onIngestRejected: rejected });
    const legacy = Array.from({ length: 50 }, (_, index) => record(`legacy-${index}`));
    expect(plane.ingest(domEnvelope(1, legacy), { connectionGeneration: 1 }),
      rejected.mock.calls.at(-1)?.[1]).toBe(true);

    expect(plane.ingest(collectorEnvelope(), { connectionGeneration: 1 })).toBe(true);
    const catalog = await plane.read("catalog-source:SABA:FOOTBALL");

    expect(catalog.events.map(({ providerEventId }) => providerEventId).sort())
      .toEqual(["hidden", "legacy-0"]);
    expect(catalog.events.map(({ providerEventId }) => providerEventId)).not.toContain("unknown");
    expect(catalog.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "unknown", disposition: "EXCLUDED" })
    ]));
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ events: expect.any(Array) }), "FRESH");
  });

  it("does not establish initial provider authority from a collector without qualified DOM evidence", () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000, publish });

    expect(plane.ingest(collectorEnvelope(1), { connectionGeneration: 1 })).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});
