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
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket" },
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

  it("decodes the SABA public DOM when the socket field table predates attachment", () => {
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
    const value = adapter.decode(input)[0]!.value as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(value.events).toHaveLength(1);
    expect(value.markets).toHaveLength(1);
    expect(value.quotes).toHaveLength(2);
  });

});
