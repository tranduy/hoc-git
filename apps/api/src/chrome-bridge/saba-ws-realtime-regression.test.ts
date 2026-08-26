import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";

const fields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
  "enable", "odds1a", "odds2a", "hdp1", "hdp2"] as const;
const encoded = (record: Record<string, unknown>): unknown[] => Object.entries(record)
  .flatMap(([key, value]) => [fields.findIndex((field) => field === key), value]);
const eventRows = (odds1a: number, odds2a: number): unknown[][] => [
  encoded({ type: "l", leagueid: 10, leaguenameen: "League", sporttype: 1 }),
  encoded({ type: "m", matchid: 20, leagueid: 10, hteamnameen: "Home", ateamnameen: "Away",
    kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
  encoded({ type: "o", oddsid: 30, matchid: 20, bettype: 1, parenttypeid: 1,
    oddsstatus: "running", enable: 1, odds1a, odds2a, hdp1: 0.25, hdp2: 0 })
];

function envelope(rows: unknown[][], revision: string, sequence: number, sourceEpoch = "worker-a:0",
  bridgeId = "b1"):
ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7,
    sourceEpoch, sequence, observedAtMs: 1_786_449_540_000 + sequence,
    receivedMonotonicMs: sequence, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket",
      streamId: "1" },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", bridgeId, rows, revision])}` } };
}

function socketState(state: "OPEN" | "CLOSED", sequence: number,
  sourceEpoch = "worker-a:0", streamId = "1"): ChromeBridgeEnvelope {
  return { ...envelope([], "state", sequence, sourceEpoch), transport: "WS_STATE",
    request: { ...envelope([], "state", sequence, sourceEpoch).request, streamId },
    payload: { encoding: "UTF8", body: JSON.stringify({ state }) } };
}

function onStream(input: ChromeBridgeEnvelope, streamId: string): ChromeBridgeEnvelope {
  return { ...input, request: { ...input.request, streamId } };
}

function domEnvelope(sequence: number): ChromeBridgeEnvelope {
  return { ...envelope([], "dom", sequence), transport: "DOM_SNAPSHOT",
    request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
      snapshotId: `saba:7:empty-dom-${String(sequence).padStart(4, "0")}`, chunkIndex: 0, chunkCount: 1,
      records: [{ sportId: "1", leagueId: "10", leagueName: "League", matchId: "20", timeText: "LIVE",
        teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["1"], labels: ["0.25"], odds: [
          { marketOddsId: "30", priceText: "0.91", lineText: "0.25" },
          { marketOddsId: "30", priceText: "-0.99" }
        ] }] }] }) } };
}

describe("SABA websocket realtime regressions", () => {
  it("commits reset/baseline/done atomically, then applies a delta by provider odds id", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99)],
      "r0001", 1))).toEqual([]);

    const baseline = adapter.decode(envelope([[0, "done"]], "r0001", 2));
    expect(baseline).toHaveLength(1);
    expect(baseline[0]!.value).toMatchObject({
      events: [expect.objectContaining({ providerEventId: "20" })],
      markets: [expect.objectContaining({ providerMarketId: "30", scope: "FULL_TIME", line: "-0.25" })],
      quotes: [
        expect.objectContaining({ providerSelectionId: "30:home", selection: "HOME", rawOdds: "0.91" }),
        expect.objectContaining({ providerSelectionId: "30:away", selection: "AWAY", rawOdds: "-0.99" })
      ]
    });
    expect(baseline[0]).toMatchObject({
      authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
    });

    expect(adapter.decode(socketState("OPEN", 3))).toEqual([]);
    const duplicate = adapter.decode(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.91, -0.99), [0, "done"]], "r0001", 4));
    expect(duplicate).toEqual([]);

    const delta = adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.73, odds2a: -0.83 })
    ], "r0002", 5));
    expect((delta[0]!.value as { quotes: Array<{ providerSelectionId: string; rawOdds: string }> }).quotes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerSelectionId: "30:home", rawOdds: "0.73" }),
        expect.objectContaining({ providerSelectionId: "30:away", rawOdds: "-0.83" })
      ]));
    expect(adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 9.99 })
    ], "r0002", 4))).toEqual([]);
  });

  it("fails closed on an older provider revision instead of rolling the accepted quote back", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0004", 1))).toHaveLength(1);

    expect(adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.01 })
    ], "r0003", 2))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
  });

  it("discards the prior source epoch and requires a new complete baseline even at a lower envelope sequence", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100, publish });
    expect(plane.ingest(socketState("OPEN", 99, "worker-a:0"), { connectionGeneration: 1 })).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0100", 100, "worker-a:0"), { connectionGeneration: 1 })).toBe(true);

    expect(plane.ingest(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.01 })
    ], "r0001", 1, "worker-b:0"), { connectionGeneration: 2 })).toBe(false);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      quotes: expect.arrayContaining([expect.objectContaining({ providerSelectionId: "30:home", rawOdds: "0.91" })])
    });
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);

    expect(plane.ingest(socketState("OPEN", 2, "worker-b:0"), { connectionGeneration: 2 })).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.72, -0.82),
      [0, "done"]], "r0002", 3, "worker-b:0"), { connectionGeneration: 2 })).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      quotes: expect.arrayContaining([expect.objectContaining({ providerSelectionId: "30:home", rawOdds: "0.72" })])
    });
  });

  it("uses replay only to prime decoding and requires a current OPEN reset/done baseline", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100, publish });
    const replayed = { ...envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 1, "worker-b:1"), request: {
        ...envelope([], "r0001", 1).request, replayed: true
      } } satisfies ChromeBridgeEnvelope;

    expect(plane.ingest(replayed)).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow();

    expect(plane.ingest(socketState("OPEN", 2, "worker-b:1"))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.72, -0.82),
      [0, "done"]], "r0002", 3, "worker-b:1"))).toBe(true);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({
      accountId: "catalog-source:SABA:FOOTBALL"
    }), "FRESH");
  });

  it("requires another reset/done after the SABA baseline maximum age", () => {
    const adapter = new SabaWsCatalogAdapter();
    adapter.decode(socketState("OPEN", 0));
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 1))).toHaveLength(1);

    expect(adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.72, odds2a: -0.82 })
    ], "r0002", 3_600_002))).toEqual([]);
  });

  it("treats duplicate current OPEN as a no-op after a complete SABA baseline", () => {
    const adapter = new SabaWsCatalogAdapter();
    adapter.decode(socketState("OPEN", 1));
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toHaveLength(1);

    expect(adapter.decode(socketState("OPEN", 3))).toEqual([]);
    const delta = adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.72, odds2a: -0.82 })
    ], "r0002", 4));
    expect(delta).toEqual([expect.objectContaining({ evidenceMode: "DELTA", provenance: "WS" })]);
  });

  it("ignores delayed OPEN from a retired SABA stream", () => {
    const adapter = new SabaWsCatalogAdapter();
    adapter.decode(socketState("OPEN", 1, "worker-a:0", "1"));
    adapter.decode(socketState("OPEN", 2, "worker-a:0", "2"));

    expect(adapter.decode(socketState("OPEN", 3, "worker-a:0", "1"))).toEqual([]);
    const replacement = envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.72, -0.82),
      [0, "done"]], "r0001", 4);
    const update = adapter.decode({ ...replacement,
      request: { ...replacement.request, streamId: "2" } });
    expect(update).toEqual([expect.objectContaining({
      authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
    })]);
  });

  it("lets only the newer current stream done complete its pending baseline", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(socketState("OPEN", 1, "worker-a:0", "1"))).toEqual([]);
    const first = adapter.decode(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.91, -0.99), [0, "done"]], "r0001", 2));
    expect(first).toEqual([expect.objectContaining({
      evidenceMode: "BASELINE", generation: "worker-a:0:saba:1:2", provenance: "WS"
    })]);

    expect(adapter.decode(socketState("OPEN", 3, "worker-a:0", "2"))).toEqual([
      expect.objectContaining({
        invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
      })
    ]);
    expect(adapter.decode(onStream(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.72, -0.82)], "r0001", 4), "2"))).toEqual([]);
    expect(adapter.decode(onStream(envelope([[0, "done"]], "r0002", 5), "1"))).toEqual([]);

    const replacement = adapter.decode(onStream(envelope([[0, "done"]], "r0001", 6), "2"));
    expect(replacement).toEqual([expect.objectContaining({
      evidenceMode: "BASELINE", generation: "worker-a:0:saba:2:6", provenance: "WS"
    })]);
  });

  it("re-baselines the current running stream after a revision gap without another OPEN", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(socketState("OPEN", 1))).toEqual([]);
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toHaveLength(1);
    expect(adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.01, odds2a: -0.01 })
    ], "r0003", 3))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);

    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.01, -0.01),
      [0, "done"]], "r0004", 4))).toEqual([expect.objectContaining({
      authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
    })]);
    expect(adapter.decode(socketState("OPEN", 5, "worker-a:0", "2"))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
    const replacement = adapter.decode(onStream(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.72, -0.82), [0, "done"]], "r0001", 6), "2"));
    expect(replacement).toEqual([expect.objectContaining({
      evidenceMode: "BASELINE", generation: "worker-a:0:saba:2:6", provenance: "WS"
    })]);
  });

  it("re-baselines the current running stream after an A003 gap without another OPEN", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(socketState("OPEN", 1))).toEqual([]);
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toHaveLength(1);
    expect(adapter.decode(envelope([["A003"]], "r0002", 3))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);

    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.01, -0.01),
      [0, "done"]], "r0003", 4))).toEqual([expect.objectContaining({
      authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
    })]);
    expect(adapter.decode(socketState("OPEN", 5, "worker-a:0", "2"))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
    const replacement = adapter.decode(onStream(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.72, -0.82), [0, "done"]], "r0001", 6), "2"));
    expect(replacement).toEqual([expect.objectContaining({
      evidenceMode: "BASELINE", generation: "worker-a:0:saba:2:6", provenance: "WS"
    })]);
  });

  it("keeps post-baseline deltas on the committed generation and suppresses identical evidence", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(socketState("OPEN", 1))).toEqual([]);
    const baselineFrame = envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2);
    const baseline = adapter.decode(baselineFrame);
    expect(baseline).toEqual([expect.objectContaining({
      evidenceMode: "BASELINE", generation: "worker-a:0:saba:1:2", provenance: "WS"
    })]);
    expect(adapter.decode(baselineFrame)).toEqual([]);

    const deltaFrame = envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.72, odds2a: -0.82 })
    ], "r0002", 3);
    expect(adapter.decode(deltaFrame)).toEqual([expect.objectContaining({
      evidenceMode: "DELTA", generation: "worker-a:0:saba:1:2", provenance: "WS"
    })]);
    expect(adapter.decode(deltaFrame)).toEqual([]);
  });

  it("invalidates the old generation when a newer same-epoch stream opens before close", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100, publish });
    expect(plane.ingest(socketState("OPEN", 1, "worker-a:0", "1"))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toBe(true);

    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.61, -0.71)], "r0002", 3))).toBe(false);
    expect(plane.ingest(socketState("OPEN", 4, "worker-a:0", "2"))).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL"))
      .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(plane.ingest(socketState("CLOSED", 5, "worker-a:0", "1"))).toBe(false);
    expect(plane.ingest(onStream(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.01, odds2a: -0.01 })
    ], "r0003", 6), "1"))).toBe(false);

    expect(plane.ingest(onStream(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.72, -0.82), [0, "done"]], "r0001", 7), "2"))).toBe(true);
    expect(plane.ingest(socketState("CLOSED", 8, "worker-a:0", "1"))).toBe(false);
    expect(plane.ingest(onStream(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.02, odds2a: -0.02 })
    ], "r0004", 9), "1"))).toBe(false);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      quotes: expect.arrayContaining([
        expect.objectContaining({ providerSelectionId: "30:home", rawOdds: "0.72" })
      ])
    });
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE", "FRESH"]);
  });

  it("does not publish or renew freshness for identical data at a later legal revision", async () => {
    let nowMs = 1_786_449_540_002;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => nowMs, publish });
    expect(plane.ingest(socketState("OPEN", 1))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toBe(true);

    nowMs = 1_786_449_549_002;
    expect(plane.ingest(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.91, odds2a: -0.99 })
    ], "r0002", 9_002))).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);

    nowMs = 1_786_449_615_003;
    await expect(plane.read("catalog-source:SABA:FOOTBALL"))
      .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("does not publish or renew freshness for a repeated revisionless complete baseline", async () => {
    let nowMs = 1_786_449_540_002;
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => nowMs, publish });
    const rows = [["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99), [0, "done"]];
    const template = envelope(rows, "unused", 2);
    const revisionless: ChromeBridgeEnvelope = { ...template,
      payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b1", rows])}` } };
    expect(plane.ingest(socketState("OPEN", 1))).toBe(false);
    expect(plane.ingest(revisionless)).toBe(true);

    nowMs = 1_786_449_549_002;
    expect(plane.ingest({ ...revisionless, sequence: 9_002,
      observedAtMs: nowMs, receivedMonotonicMs: 9_002 })).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH"]);

    nowMs = 1_786_449_615_003;
    await expect(plane.read("catalog-source:SABA:FOOTBALL"))
      .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
  });

  it("retires current authority before malformed reset decoding can renew it", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100, publish });
    expect(plane.ingest(socketState("OPEN", 1))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toBe(true);

    expect(plane.ingest(envelope([[0, "reset"], [999, "m"]], "r0002", 3))).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL"))
      .rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(plane.ingest(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.72, odds2a: -0.82 })
    ], "r0002", 4))).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE"]);
  });

  it("keeps authority when a late-attached partition without a field table cannot decode", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 1, "worker-a:0", "b14"))).toEqual([expect.objectContaining({
      authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
    })]);

    expect(adapter.decode(envelope([[0, "o", 3, 30]], "late1", 2,
      "worker-a:0", "b21"))).toEqual([]);
    expect(adapter.decode(envelope([
      encoded({ type: "o", oddsid: 30, matchid: 20, odds1a: 0.72, odds2a: -0.82 })
    ], "r0002", 3, "worker-a:0", "b14"))).toEqual([expect.objectContaining({
      evidenceMode: "DELTA", provenance: "WS"
    })]);
  });

  it("commits a proven complete empty SABA baseline but not a partial empty reset", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100 });
    expect(plane.ingest(socketState("OPEN", 1))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2))).toBe(true);
    expect(plane.ingest(domEnvelope(3))).toBe(false);

    expect(plane.ingest(envelope([[0, "empty"]], "r0002", 4))).toBe(false);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "20" })]
    });

    expect(plane.ingest(envelope([[0, "done"]], "r0002", 5))).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      observedAtMs: 1_786_449_540_005, events: [], markets: [], quotes: []
    });
  });

  it("lets a proven complete empty replacement bridge tombstone every retained bridge partition", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100 });
    expect(plane.ingest(socketState("OPEN", 1))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.91, -0.99),
      [0, "done"]], "r0001", 2, "worker-a:0", "b1"))).toBe(true);

    expect(plane.ingest(envelope([["f", 0, fields], [0, "empty"]], "r0001", 3,
      "worker-a:0", "b2"))).toBe(false);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      events: [expect.objectContaining({ providerEventId: "20" })]
    });

    expect(plane.ingest(envelope([[0, "done"]], "r0001", 4,
      "worker-a:0", "b2"))).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      events: [], markets: [], quotes: []
    });
  });

  it("re-baselines SABA on a newer stream in the same source epoch after close", async () => {
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => 1_786_449_540_100, publish });
    expect(plane.ingest(socketState("OPEN", 1, "worker-a:0", "1"))).toBe(false);
    expect(plane.ingest(envelope([["f", 0, fields], [0, "reset"],
      ...eventRows(0.91, -0.99), [0, "done"]], "r0001", 2))).toBe(true);

    expect(plane.ingest(socketState("CLOSED", 3, "worker-a:0", "1"))).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(plane.ingest(socketState("OPEN", 4, "worker-a:0", "2"))).toBe(false);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");

    const replacement = envelope([["f", 0, fields], [0, "reset"], ...eventRows(0.72, -0.82),
      [0, "done"]], "r0002", 5);
    expect(plane.ingest({ ...replacement,
      request: { ...replacement.request, streamId: "2" } })).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).resolves.toMatchObject({
      quotes: expect.arrayContaining([expect.objectContaining({ providerSelectionId: "30:home", rawOdds: "0.72" })])
    });
    const late = envelope([encoded({ type: "o", oddsid: 30, matchid: 20,
      odds1a: 0.01, odds2a: -0.01 })], "r0003", 6);
    expect(plane.ingest(late)).toBe(false);
    expect(publish.mock.calls.map((call) => call[1])).toEqual(["FRESH", "STALE", "FRESH"]);
  });
});
