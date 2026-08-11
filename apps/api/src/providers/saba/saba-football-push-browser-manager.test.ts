import { describe, expect, it } from "vitest";
import {
  isSabaPushSocketUrl, markSabaLiveContextRecords, SabaSocketSnapshots, SabaViewDecoder
} from "./saba-football-push-browser-manager.js";

describe("isSabaPushSocketUrl", () => {
  it("accepts only the verified Socket.IO transport and ignores unrelated sockets", () => {
    expect(isSabaPushSocketUrl("wss://safe.example/socket.io/?EIO=4&transport=websocket")).toBe(true);
    expect(isSabaPushSocketUrl("wss://safe.example/chat")).toBe(false);
    expect(isSabaPushSocketUrl("https://safe.example/socket.io/")).toBe(false);
    expect(isSabaPushSocketUrl("not-a-url")).toBe(false);
  });
});

describe("markSabaLiveContextRecords", () => {
  it("uses the verified Live tab as lifecycle evidence when SABA leaves marketid at Today", () => {
    const records = [
      { type: "l", leagueid: 1, leaguenameen: "Today league" },
      { type: "l", leagueid: 2, leaguenameen: "Live league" },
      { type: "m", matchid: 10, leagueid: 1, marketid: "T" },
      { type: "o", oddsid: 100, matchid: 10 },
      { type: "m", matchid: 20, leagueid: 2, marketid: "L" },
      { type: "o", oddsid: 200, matchid: 20 }
    ];

    expect(markSabaLiveContextRecords(records)).toEqual([
      records[0], records[1], { ...records[2], marketid: "L" }, records[3], records[4], records[5]
    ]);
  });
});

describe("SabaSocketSnapshots", () => {
  it("rejects delayed frames from an old socket after reconnect", () => {
    const snapshots = new SabaSocketSnapshots();
    const first = snapshots.beginSocket();
    expect(snapshots.replace(first, "sports", [{ matchid: "old" }])).toBe(true);
    const second = snapshots.beginSocket();
    expect(snapshots.replace(first, "sports", [{ matchid: "late-old" }])).toBe(false);
    expect(snapshots.replace(second, "sports", [{ matchid: "new" }])).toBe(true);
    expect(snapshots.records()).toEqual([{ matchid: "new" }]);
  });

  it("discards only the active malformed channel", () => {
    const snapshots = new SabaSocketSnapshots();
    const generation = snapshots.beginSocket();
    snapshots.replace(generation, "sports", [{ matchid: "safe" }]);
    snapshots.replace(generation, "other", [{ matchid: "bad" }]);
    expect(snapshots.discard(generation, "other")).toBe(true);
    expect(snapshots.records()).toEqual([{ matchid: "safe" }]);
  });

  it("keeps the actual frame receipt clock instead of refreshing age on every read", () => {
    const snapshots = new SabaSocketSnapshots();
    const generation = snapshots.beginSocket();
    snapshots.replace(generation, "sports", [{ matchid: "safe" }], 1234, 56);
    expect(snapshots.latestClock()).toBeNull();
    snapshots.replace(generation, "sports", [{ type: "m", matchid: "safe" }], 1234, 56);
    snapshots.replace(generation, "configuration", [{ type: 16, siteid: "safe" }], 9999, 999);
    expect(snapshots.latestClock()).toEqual({ observedAtMs: 1234, receivedMonotonicMs: 56 });
    expect(snapshots.latestClock()).toEqual({ observedAtMs: 1234, receivedMonotonicMs: 56 });
  });

  it("clears an active disconnected socket without letting an old close clear its replacement", () => {
    const snapshots = new SabaSocketSnapshots();
    const first = snapshots.beginSocket();
    snapshots.replace(first, "sports", [{ matchid: "old" }]);
    expect(snapshots.endSocket(first)).toBe(true);
    expect(snapshots.records()).toEqual([]);
    expect(snapshots.replace(first, "sports", [{ matchid: "late" }])).toBe(false);
    const second = snapshots.beginSocket();
    snapshots.replace(second, "sports", [{ matchid: "new" }]);
    expect(snapshots.endSocket(first)).toBe(false);
    expect(snapshots.records()).toEqual([{ matchid: "new" }]);
  });
});

describe("SabaViewDecoder", () => {
  it("requires a fresh full snapshot and cannot carry Today records into Live", () => {
    const decoder = new SabaViewDecoder();
    const fields = ["type", "matchid"];
    expect(decoder.apply(0, { bridgeId: "b1", revision: "r1", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, "today"], [0, "done"]
    ] }).records).toEqual([{ type: "m", matchid: "today" }]);
    expect(() => decoder.apply(1, { bridgeId: "b1", revision: "r2", rows: [
      [0, "m", 1, "live-delta"]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED");
    expect(decoder.apply(1, { bridgeId: "b1", revision: "r3", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, "live"], [0, "done"]
    ] }).records).toEqual([{ type: "m", matchid: "live" }]);
  });

  it("fails closed on a sequence gap and recovers only from a complete snapshot", () => {
    const decoder = new SabaViewDecoder();
    const fields = ["type", "matchid"];
    expect(decoder.apply(1, { bridgeId: "b1", revision: "r1", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, "accepted"], [0, "done"]
    ] }).records).toEqual([{ type: "m", matchid: "accepted" }]);
    expect(() => decoder.apply(1, { bridgeId: "b1", revision: "r3", rows: [
      [0, "m", 1, "must-not-publish"]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:SEQUENCE_GAP");
    expect(decoder.apply(1, { bridgeId: "b1", revision: "r4", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, "recovered"], [0, "done"]
    ] }).records).toEqual([{ type: "m", matchid: "recovered" }]);
  });
});
