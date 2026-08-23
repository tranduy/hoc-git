import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";

const fields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
  "enable", "odds1a", "odds2a", "hdp1", "hdp2"];
const encoded = (record: Record<string, unknown>): unknown[] => Object.entries(record)
  .flatMap(([key, value]) => [fields.indexOf(key), value]);

function envelope(body: string, sourceId = "chrome:SABA:7"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId, tabId: 7,
    sequence: 4, observedAtMs: 1_786_449_540_000, receivedMonotonicMs: 50, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket",
      streamId: "1" },
    payload: { encoding: "UTF8", body } };
}

describe("SabaWsCatalogAdapter", () => {
  it("decodes a complete SABA push snapshot into exact live football prices", () => {
    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const adapter = new SabaWsCatalogAdapter();
    const input = envelope(`42${JSON.stringify(["m", "b1", rows, 1])}`);

    expect(adapter.fingerprint(input)).toBe(true);
    const update = adapter.decode(input)[0]!;
    expect(update.value).toMatchObject({ accountId: "catalog-source:SABA:FOOTBALL", provider: "SABA" });
    expect((update.value as { events: unknown[] }).events).toHaveLength(1);
    expect((update.value as { markets: unknown[] }).markets).toHaveLength(1);
    expect((update.value as { quotes: unknown[] }).quotes).toHaveLength(2);
  });

  it("preserves Today lifecycle in a mixed socket baseline instead of marking future events live", () => {
    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "Japan J-League Division 1", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Kashiwa Reysol",
        ateamnameen: "V-Varen Nagasaki", kickofftime: 1_786_306_400, marketid: "T", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const update = new SabaWsCatalogAdapter()
      .decode(envelope(`42${JSON.stringify(["m", "b2", rows, 1])}`))[0]!.value as {
        events: Array<{ isLive: boolean; startAtUtcMs: number; liveState: unknown }>;
        quotes: Array<{ isLive: boolean }>;
      };

    expect(update.events).toEqual([expect.objectContaining({
      isLive: false, startAtUtcMs: 1_786_306_400_000, liveState: null
    })]);
    expect(update.quotes.every((quote) => quote.isLive === false)).toBe(true);
  });

  it("ignores unrelated Socket.IO traffic", () => {
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.fingerprint(envelope('42["notice",{}]'))).toBe(false);
    expect(adapter.decode(envelope("2"))).toEqual([]);
  });

  it("retains complete events from parallel SABA catalog channels instead of replacing them", () => {
    const snapshot = (bridgeId: string, matchId: number, home: string): ChromeBridgeEnvelope => {
      const rows = [["f", 0, fields], [0, "reset"],
        encoded({ type: "l", leagueid: matchId, leaguenameen: `League ${matchId}`, sporttype: 1 }),
        encoded({ type: "m", matchid: matchId, leagueid: matchId, hteamnameen: home,
          ateamnameen: `Away ${matchId}`, kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
        encoded({ type: "o", oddsid: matchId * 10, matchid: matchId, bettype: 1, parenttypeid: 1,
          oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
        [0, "done"]];
      return envelope(`42${JSON.stringify(["m", bridgeId, rows, 1])}`);
    };
    const adapter = new SabaWsCatalogAdapter();

    const first = adapter.decode(snapshot("b1", 101, "Home 101"))[0]!.value as { events: Array<{ providerEventId: string }> };
    const second = adapter.decode(snapshot("b2", 202, "Home 202"))[0]!.value as { events: Array<{ providerEventId: string }> };

    expect(first.events.map((event) => event.providerEventId)).toEqual(["101"]);
    expect(second.events.map((event) => event.providerEventId).sort()).toEqual(["101", "202"]);
  });

  it("keeps decoder field tables and revisions isolated between attached SABA tabs", () => {
    const snapshot = (sourceId: string, matchId: number): ChromeBridgeEnvelope => {
      const rows = [["f", 0, fields], [0, "reset"],
        encoded({ type: "l", leagueid: matchId, leaguenameen: `League ${matchId}`, sporttype: 1 }),
        encoded({ type: "m", matchid: matchId, leagueid: matchId, hteamnameen: `Home ${matchId}`,
          ateamnameen: `Away ${matchId}`, kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
        encoded({ type: "o", oddsid: matchId * 10, matchid: matchId, bettype: 1, parenttypeid: 1,
          oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
        [0, "done"]];
      return envelope(`42${JSON.stringify(["m", "b1", rows, 1])}`, sourceId);
    };
    const adapter = new SabaWsCatalogAdapter();

    const first = adapter.decode(snapshot("chrome:SABA:7", 101));
    const second = adapter.decode(snapshot("chrome:SABA:8", 202));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect((second[0]!.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "202" })]);
  });

  it("does not publish a viewport-only SABA DOM before a complete socket baseline", () => {
    const adapter = new SabaWsCatalogAdapter();
    const input: ChromeBridgeEnvelope = { ...envelope(""), transport: "DOM_SNAPSHOT",
      request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2, snapshotId: "saba:7:snapshot-0001",
        chunkIndex: 0, chunkCount: 1, records: [{ sportId: "1", leagueId: "l", leagueName: "League",
          matchId: "m", timeText: "1H0'", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["1"],
            labels: ["0.5"], odds: [
              { marketOddsId: "o", priceText: "0.92", status: null, greyedOut: null, lineText: "0.5" },
              { marketOddsId: "o", priceText: "-0.98", status: null, greyedOut: null }
            ] }] }] }) } };
    expect(adapter.decode(input)).toEqual([]);
  });

  it("does not borrow socket readiness from a different source epoch for DOM fallback", () => {
    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const adapter = new SabaWsCatalogAdapter();
    adapter.decode({ ...envelope(`42${JSON.stringify(["m", "b1", rows, 1])}`), sourceEpoch: "worker-a:0" });
    const replacementRecords = Array.from({ length: 24 }, (_, index) => ({
      sportId: "1", leagueId: String(index + 1), leagueName: `League ${index}`,
      matchId: String(index + 2), timeText: "1H0'", teamNames: [`Home ${index}`, `Away ${index}`],
      groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
        { marketOddsId: String(index + 3), priceText: "0.92", lineText: "0.5" },
        { marketOddsId: String(index + 3), priceText: "-0.98" }
      ] }]
    }));
    const dom: ChromeBridgeEnvelope = { ...envelope(""), sourceEpoch: "worker-b:0", transport: "DOM_SNAPSHOT",
      request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
        snapshotId: "saba:7:replacement-epoch", chunkIndex: 0, chunkCount: 1,
        records: replacementRecords }) } };

    expect(adapter.decode(dom)).toEqual([]);
  });

  it("promotes two stable full-page DOM generations when the SABA socket is absent and rejects a later partial view", () => {
    const adapter = new SabaWsCatalogAdapter();
    const records = (priceText: string, count = 24) => Array.from({ length: count }, (_, index) => ({
      sportId: "1", leagueId: String(10_000 + index), leagueName: `League ${index}`,
      matchId: String(20_000 + index), timeText: "1H0'", teamNames: [`Home ${index}`, `Away ${index}`],
      groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
        { marketOddsId: String(30_000 + index), priceText, status: null, greyedOut: null, lineText: "0.5" },
        { marketOddsId: String(30_000 + index), priceText: "-0.98", status: null, greyedOut: null }
      ] }]
    }));
    const dom = (snapshotId: string, sequence: number, values: readonly unknown[]): ChromeBridgeEnvelope => ({
      ...envelope(""), sequence, observedAtMs: 1_786_449_540_000 + sequence * 1_000,
      transport: "DOM_SNAPSHOT",
      request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2, snapshotId,
        chunkIndex: 0, chunkCount: 1, records: values }) }
    });

    expect(adapter.decode(dom("saba-full-generation-0001", 10, records("0.92")))).toEqual([]);
    const baseline = adapter.decode(dom("saba-full-generation-0002", 11, records("0.92")));
    expect(baseline).toHaveLength(1);
    expect((baseline[0]!.value as { events: unknown[] }).events).toHaveLength(24);
    expect(baseline[0]).toMatchObject({ provenance: "DOM_FALLBACK", evidenceMode: "DELTA" });
    expect(baseline[0]).not.toHaveProperty("authoritativeBaseline");

    expect(adapter.decode(dom("saba-partial-generation-0003", 12, records("0.10", 6)))).toEqual([]);
    const changed = adapter.decode(dom("saba-full-generation-0004", 13, records("0.81")));
    expect(changed).toHaveLength(1);
    expect((changed[0]!.value as { quotes: Array<{ rawOdds: string }> }).quotes)
      .toContainEqual(expect.objectContaining({ rawOdds: "0.81" }));
  });

  it("publishes current SABA DOM only as fallback evidence after the socket bootstrap", () => {
    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(envelope(`42${JSON.stringify(["m", "b1", rows, 1])}`))).toHaveLength(1);

    const dom: ChromeBridgeEnvelope = { ...envelope(""), sequence: 5,
      observedAtMs: 1_786_449_550_000, transport: "DOM_SNAPSHOT",
      request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
        snapshotId: "saba:7:snapshot-after-ws", chunkIndex: 0, chunkCount: 1, records: [{
          sportId: "1", leagueId: "1", leagueName: "League", matchId: "2", timeText: "1H0'",
          teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
            { marketOddsId: "3", priceText: "0.92", status: null, greyedOut: null, lineText: "0.5" },
            { marketOddsId: "3", priceText: "-0.98", status: null, greyedOut: null }
          ] }]
        }] }) } };

    const refreshed = adapter.decode(dom);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({ observedAtMs: 1_786_449_550_000,
      provenance: "DOM_FALLBACK", evidenceMode: "DELTA",
      value: { observedAtMs: 1_786_449_550_000 } });
    expect(refreshed[0]).not.toHaveProperty("authoritativeBaseline");
  });

  it("retires hidden socket partitions older than SABA's maximum baseline age", () => {
    const snapshot = (bridgeId: string, matchId: number, observedAtMs: number): ChromeBridgeEnvelope => {
      const rows = [["f", 0, fields], [0, "reset"],
        encoded({ type: "l", leagueid: matchId, leaguenameen: `League ${matchId}`, sporttype: 1 }),
        encoded({ type: "m", matchid: matchId, leagueid: matchId, hteamnameen: `Home ${matchId}`,
          ateamnameen: `Away ${matchId}`, kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
        encoded({ type: "o", oddsid: matchId * 10, matchid: matchId, bettype: 1, parenttypeid: 1,
          oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
        [0, "done"]];
      return { ...envelope(`42${JSON.stringify(["m", bridgeId, rows, 1])}`), observedAtMs };
    };
    const adapter = new SabaWsCatalogAdapter();
    adapter.decode(snapshot("b1", 101, 1_000));

    const current = adapter.decode(snapshot("b2", 202, 61_001))[0]!.value as {
      events: Array<{ providerEventId: string }> };

    expect(current.events.map((event) => event.providerEventId)).toEqual(["202"]);
  });

  it("keeps the richer DOM event identity while later socket frames update SABA prices", () => {
    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "ASEAN CHAMPIONSHIP 2026", sporttype: 1 }),
      encoded({ type: "m", matchid: 132353281, leagueid: 1, hteamnameen: "Vietnam", ateamnameen: "Malaysia",
        kickofftime: 1_786_144_399, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 1051703674, matchid: 132353281, bettype: 3, parenttypeid: 3,
        oddsstatus: "running", enable: 1, odds1a: -0.74, odds2a: 0.6, hdp1: 1.75, hdp2: 0 }),
      [0, "done"]];
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(envelope(`42${JSON.stringify(["m", "b1", rows, "rev1"])}`))).toHaveLength(1);

    const dom: ChromeBridgeEnvelope = { ...envelope(""), sequence: 5,
      observedAtMs: 1_786_449_550_000, transport: "DOM_SNAPSHOT",
      request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
        snapshotId: "saba:7:snapshot-identity", chunkIndex: 0, chunkCount: 1, records: [{
          sportId: "1", leagueId: "1", leagueName: "GIẢI VÔ ĐỊCH BÓNG ĐÁ ASEAN 2026",
          matchId: "132353281", timeText: "2H12'", teamNames: ["Việt Nam", "Malaysia"],
          groups: [{ betTypeIds: ["3"], labels: ["1.75"], odds: [
            { marketOddsId: "dom-total", priceText: "-0.74", status: null, greyedOut: null },
            { marketOddsId: "dom-total", priceText: "0.6", status: null, greyedOut: null }
          ] }]
        }] }) } };
    expect(adapter.decode(dom)[0]!.value).toMatchObject({ events: [expect.objectContaining({
      providerEventId: "132353281", participantA: "Việt Nam",
      liveState: expect.objectContaining({ period: "2H", clockMs: 720_000 })
    })] });

    const delta = [encoded({ type: "o", oddsid: 1051703674, matchid: 132353281,
      bettype: 3, parenttypeid: 3, oddsstatus: "running", enable: 1,
      odds1a: -0.65, odds2a: 0.51, hdp1: 1.75, hdp2: 0 })];
    const updated = adapter.decode({
      ...envelope(`42${JSON.stringify(["m", "b1", delta, "rev2"])}`), sequence: 6,
      observedAtMs: 1_786_449_552_000
    })[0]!.value as { events: Array<{ providerEventId: string; participantA: string;
      liveState: { period: string | null; clockMs: number | null } | null }>;
      quotes: Array<{ providerMarketId: string; rawOdds: string }> };

    expect(updated.events.find((event) => event.providerEventId === "132353281")).toMatchObject({
      participantA: "Việt Nam", liveState: expect.objectContaining({ period: "2H", clockMs: 720_000 })
    });
    expect(updated.quotes.filter((quote) => quote.providerMarketId === "1051703674")
      .map((quote) => quote.rawOdds)).toEqual(["-0.65", "0.51"]);
  });

  it("invalidates SABA immediately when the active catalog socket closes", () => {
    const adapter = new SabaWsCatalogAdapter();
    const opened: ChromeBridgeEnvelope = { ...envelope(""), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } };
    const closed: ChromeBridgeEnvelope = { ...envelope(""), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } };
    expect(adapter.decode(opened)).toEqual([]);
    expect(adapter.fingerprint(closed)).toBe(true);
    expect(adapter.decode(closed)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_CLOSED"
    })]);
  });

  it("ignores frames from a retired socket after its same-epoch replacement opens", () => {
    const socketState = (streamId: string): ChromeBridgeEnvelope => ({
      ...envelope(""), transport: "WS_STATE", request: { ...envelope("").request, streamId },
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) }
    });
    const snapshot = (streamId: string, matchId: number, sequence: number): ChromeBridgeEnvelope => {
      const rows = [["f", 0, fields], [0, "reset"],
        encoded({ type: "l", leagueid: matchId, leaguenameen: `League ${matchId}`, sporttype: 1 }),
        encoded({ type: "m", matchid: matchId, leagueid: matchId, hteamnameen: `Home ${matchId}`,
          ateamnameen: `Away ${matchId}`, kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
        encoded({ type: "o", oddsid: matchId * 10, matchid: matchId, bettype: 1, parenttypeid: 1,
          oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
        [0, "done"]];
      return { ...envelope(`42${JSON.stringify(["m", "b1", rows, sequence])}`), sequence,
        request: { ...envelope("").request, streamId } };
    };
    const adapter = new SabaWsCatalogAdapter();

    adapter.decode(socketState("1"));
    expect(adapter.decode(snapshot("1", 101, 5))).toHaveLength(1);
    adapter.decode(socketState("2"));
    expect(adapter.decode(snapshot("2", 202, 6))).toHaveLength(1);

    expect(adapter.decode(snapshot("1", 303, 7))).toEqual([]);
  });

  it("does not publish a new stream until reset/done establishes a complete baseline", () => {
    const rows = [["f", 0, fields],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 })];
    const input = { ...envelope(`42${JSON.stringify(["m", "b1", rows, 1])}`),
      request: { ...envelope("").request, streamId: "1" } };
    expect(new SabaWsCatalogAdapter().decode(input)).toEqual([]);
  });

  it("ignores replayed lifecycle without mutating the active stream authority", () => {
    const fullRows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const adapter = new SabaWsCatalogAdapter();
    const opened = { ...envelope(""), transport: "WS_STATE" as const,
      payload: { encoding: "UTF8" as const, body: JSON.stringify({ state: "OPEN" }) } };
    expect(adapter.decode(opened)).toEqual([]);
    expect(adapter.decode(envelope(`42${JSON.stringify(["m", "b1", fullRows, "r1"])}`)))
      .toHaveLength(1);

    const replayedOpen = { ...opened, request: { ...opened.request, streamId: "50001", replayed: true } };
    expect(adapter.decode(replayedOpen)).toEqual([]);
    const delta = [encoded({ type: "o", oddsid: 3, matchid: 2, odds1a: 0.72, odds2a: -0.82 })];
    expect(adapter.decode({ ...envelope(`42${JSON.stringify(["m", "b1", delta, "r2"])}`), sequence: 6 }))
      .toEqual([expect.objectContaining({ evidenceMode: "DELTA", provenance: "WS" })]);
  });

  it("keeps 50,000 canonical stream replacements in one bounded high-water state", () => {
    const adapter = new SabaWsCatalogAdapter();
    const open = (streamId: string): ChromeBridgeEnvelope => ({ ...envelope(""), transport: "WS_STATE",
      request: { ...envelope("").request, streamId },
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } });
    for (let ordinal = 1; ordinal <= 50_000; ordinal += 1) {
      expect(adapter.decode(open(String(ordinal)))).toEqual([]);
    }
    expect(adapter.streamStats()).toEqual({ sourceEpochs: 1, trackedStreamIds: 1 });
    expect(adapter.decode(open("1"))).toEqual([]);
    expect(adapter.fingerprint(open("opaque-stream"))).toBe(false);

    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const oldFrame = { ...envelope(`42${JSON.stringify(["m", "b1", rows, "r1"])}`),
      request: { ...envelope("").request, streamId: "1" } };
    expect(adapter.decode(oldFrame)).toEqual([]);
    expect(adapter.decode(open("50001"))).toEqual([]);
    const currentFrame = { ...oldFrame, request: { ...oldFrame.request, streamId: "50001" } };
    expect(adapter.decode(currentFrame)).toEqual([expect.objectContaining({
      authoritativeBaseline: true, evidenceMode: "BASELINE"
    })]);
  }, 15_000);

  it("invalidates SABA on a provider revision gap instead of retaining old prices", () => {
    const fullRows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Home", ateamnameen: "Away",
        kickofftime: 1_786_449_540, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(envelope(`42${JSON.stringify(["m", "b1", fullRows, "rev1"])}`))).toHaveLength(1);
    const gapRows = [encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
      oddsstatus: "running", enable: 1, odds1a: 0.5, odds2a: -0.5, hdp1: 0.5, hdp2: 0 })];
    const gap = { ...envelope(`42${JSON.stringify(["m", "b1", gapRows, "rev3"])}`), sequence: 5 };
    expect(adapter.decode(gap)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
  });

  it("invalidates an A003 provider refusal instead of treating it as a catalog delta", () => {
    const adapter = new SabaWsCatalogAdapter();
    const refused = envelope(`42${JSON.stringify(["m", "b1", [["A003"]], "r2"])}`);

    expect(adapter.decode(refused)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SABA:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
  });

});
