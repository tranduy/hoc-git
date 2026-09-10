import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

describe("retained snapshot replay generations", () => {
  it.each(["TSPORT", "SBO"] as const)("fences retained %s websocket replay between frames", async lobby => {
    const source = { lobby, sourceId: `chrome:${lobby}:15`, tabId: 15 };
    const seen: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: async () => ({}), forward: async envelope => {
      if (!envelope.request?.replayed) return;
      seen.push(envelope);
      observer.beginBridgeSourceEpoch(source.sourceId);
    } });
    const url = lobby === "TSPORT" ? "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0"
      : "wss://sports.example/socket.io/";
    const bodies = lobby === "TSPORT"
      ? [1, 2].map(id => JSON.stringify({ s: 1, t: "eu", d: JSON.stringify({ "2": id, "5": "Home" }) }))
      : [`42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 1, ["matchid"]]], 1])}`,
        `42${JSON.stringify(["m", "b1", [[0, "m", 1, 99]], 2])}`];
    for (const body of bodies) await observer.ingestWebSocketFrame(source, url, body);
    try {
      // SBO refresh calls the retained WS path directly, outside replaySnapshots.
      if (lobby === "SBO") await observer.refreshCatalog(source);
      else await observer.replaySnapshots(source.sourceId);
      expect(seen.map(envelope => envelope.payload.body)).toEqual([bodies[0]]);
    } finally { observer.releaseTab(source.tabId); }
  });

  it.each(["bridge", "tab"] as const)("rejects replay queued before %s retirement", async retirement => {
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:15", tabId: 15 } as const;
    const scheduler = new ProviderWorkScheduler();
    const seen: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ workScheduler: scheduler, sendCommand: async () => ({}),
      forward: async envelope => { if (envelope.request?.replayed) seen.push(envelope); } });
    await observer.ingestHttpResponse(source,
      "https://pacific.agenate.com/__fieldline_apsport_catalog_refresh__", "Fetch",
      JSON.stringify({ schemaVersion: 1, phase: "ROSTER", complete: true, records: [] }),
      { method: "POST", currentDocumentConfirmed: true });
    let release!: () => void;
    const blocked = scheduler.run(source.sourceId, () => new Promise<void>(resolve => { release = resolve; }));
    await Promise.resolve();
    const replay = observer.replaySnapshots(source.sourceId);
    if (retirement === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
    else observer.prepareDebuggerReattach(source.tabId);
    release();
    try {
      await blocked;
      await expect(replay).resolves.toBe(false);
      expect(seen).toEqual([]);
    } finally { observer.releaseTab(source.tabId); }
  });

  it.each(["bridge", "tab", "source"] as const)(
    "stops a multipart replay when its %s retires", async retirement => {
      const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:15", tabId: 15 } as const;
      const seen: ChromeBridgeEnvelope[] = [];
      let retired = false;
      const observer = new NetworkObserver({ observerSessionId: "worker-test", now: () => 1_000,
        monotonicNow: () => 50, sendCommand: async () => ({}), forward: async envelope => {
          if (!envelope.request?.replayed) return;
          seen.push(envelope);
          if (retired) return;
          retired = true;
          if (retirement === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
          if (retirement === "tab") observer.prepareDebuggerReattach(source.tabId);
          if (retirement === "source") observer.beginSourceEpoch(source.sourceId);
        } });
      const body = JSON.stringify({ schemaVersion: 1, phase: "ROSTER", complete: true, records: [],
        padding: "x".repeat(220_000) });
      await observer.ingestHttpResponse(source,
        "https://pacific.agenate.com/__fieldline_apsport_catalog_refresh__", "Fetch", body,
        { method: "POST", currentDocumentConfirmed: true });
      try {
        await expect(observer.replaySnapshots(source.sourceId)).resolves.toBe(false);
        expect(seen.map(envelope => JSON.parse(envelope.payload.body).chunkIndex)).toEqual([0]);
        if (retirement === "bridge") {
          seen.length = 0;
          await expect(observer.replaySnapshots(source.sourceId)).resolves.toBe(true);
          expect(seen.map(envelope => JSON.parse(envelope.payload.body).chunkIndex)).toEqual([0, 1, 2]);
          expect(seen.map(envelope => envelope.sequence)).toEqual([0, 1, 2]);
          expect(new Set(seen.map(envelope => envelope.sourceEpoch))).toEqual(new Set(["worker-test:1"]));
          expect(seen.map(envelope => JSON.parse(envelope.payload.body).bodyFragment).join("")).toBe(body);
          expect(seen.every(envelope => envelope.observedAtMs === 1_000 &&
            envelope.receivedMonotonicMs === 50)).toBe(true);
        }
      } finally { observer.releaseTab(source.tabId); }
    });
});
