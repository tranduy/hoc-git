import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import { SbobetSocketIoCatalogAdapter } from "./sbobet-socketio-adapter.js";

function frame(rows: readonly unknown[], sequence: number, revision: number,
  lobby: ChromeLobbyId = "KSPORT", streamId = "sbo-1"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby, sourceId: `chrome:${lobby}:8`, tabId: 8,
    sequence, observedAtMs: Date.UTC(2026, 7, 21, 13), receivedMonotonicMs: sequence,
    transport: "WS_FRAME", sourceEpoch: "epoch-1",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket", streamId },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b52", rows, revision])}` }
  };
}

const fields = ["matchid", "sporttype", "hteamnameen", "ateamnameen", "kickofftime", "leagueid",
  "leaguenameen", "liveperiod", "oddsid", "bettype", "hdp1", "hdp2", "odds1a", "odds2a", "oddsstatus"];

function baseline(price = "0.91"): readonly unknown[] {
  return [
    ["c", "c2"],
    ["f", 1, fields],
    [0, "m", 1, 9001, 2, 1, 3, "Alpha", 4, "Beta", 5, 1787328000, 6, 77, 7, "League", 8, 0],
    [0, "o", 9, 7001, 1, 9001, 10, 1, 11, 0.25, 12, 0, 13, price, 14, "-0.97", 15, "running"]
  ];
}

describe("SbobetSocketIoCatalogAdapter", () => {
  it("replays the dynamic per-channel schema and publishes exact opposing handicap selections", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const update = adapter.decode(frame(baseline(), 1, 10))[0]!;
    const catalog = update.value as { events: Array<{ providerEventId: string }>;
      markets: Array<{ providerMarketId: string; line: string; scope: string }>;
      quotes: Array<{ providerSelectionId: string; selection: string; rawOdds: string }> };

    expect(catalog.events).toEqual(expect.arrayContaining([expect.objectContaining({ providerEventId: "9001" })]));
    expect(catalog.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "7001", line: "-0.25", scope: "FULL_TIME" })
    ]));
    expect(catalog.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "7001:HOME", selection: "HOME", rawOdds: "0.91" }),
      expect.objectContaining({ providerSelectionId: "7001:AWAY", selection: "AWAY", rawOdds: "-0.97" })
    ]));
  });

  it("merges partial odds deltas and rejects duplicate or older provider revisions", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline("0.80"), 1, 10));
    const changed = adapter.decode(frame([[0, "o", 9, 7001, 13, "0.96"]], 2, 11))[0]!.value as {
      quotes: Array<{ selection: string; rawOdds: string }> };
    expect(changed.quotes.find((quote) => quote.selection === "HOME")?.rawOdds).toBe("0.96");
    expect(adapter.decode(frame([[0, "o", 9, 7001, 13, "0.70"]], 3, 10))).toEqual([]);
  });

  it("keeps schemas isolated by provider channel", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10));
    const unrelated = [["c", "c7"], ["f", 1, ["streamingid", "matchid"]], [0, "o", 1, 7001, 2, 9001]];
    expect(adapter.decode(frame(unrelated, 2, 11))).toEqual([]);
  });

  it("does not mistake the Volta root socket for the SBO sportsbook", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const input = frame(baseline(), 1, 10);
    expect(adapter.fingerprint({ ...input, request: { ...input.request, pathnameClass: "/" },
      payload: { encoding: "BASE64", body: "e30=" } })).toBe(false);
  });

  it("supports the sportsbook iframe classified as the SBO lobby", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("SBO");
    expect(adapter.decode(frame(baseline(), 1, 10, "SBO"))).toHaveLength(1);
  });
});
