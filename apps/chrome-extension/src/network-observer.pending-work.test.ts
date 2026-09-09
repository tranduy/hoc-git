import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver, type ObservedSource, type PersistedSabaWsSnapshots } from "./network-observer.js";

async function drain() { for (let index = 0; index < 30; index++) await Promise.resolve(); }

function frame(lobby: string, index = 0) {
  return { requestId: "first", response: { opcode: 1, payloadData: lobby === "SABA"
    ? `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
      [0, "reset"], [0, "o"], [0, "done"]], `r${index}`])}`
    : JSON.stringify({ index, price: 1.9 }) } };
}

describe("observer pending forwarding", () => {
  it("retires a partially forwarded CMD body when a later document read times out", async () => {
    vi.useFakeTimers();
    const source: ObservedSource = { lobby: "CMD", sourceId: "chrome:CMD:8", tabId: 8 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const body = JSON.stringify({ padding: "x".repeat(220_000) });
    let frameReads = 0;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const resync = vi.fn(() => observer.beginBridgeSourceEpoch(source.sourceId));
    const observer = new NetworkObserver({ forward, onForwardOverflow: resync,
      sendCommand: async (_tabId, method) => {
        if (method === "Network.getResponseBody") return { body, base64Encoded: false };
        if (method === "Page.getFrameTree") {
          frameReads += 1;
          if (frameReads === 4) await blocked;
          return { frameTree: { frame: { id: "frame", loaderId: "document" } } };
        }
        return {};
      } });
    const url = "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx?fc=1";
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "http", frameId: "frame",
      loaderId: "document", request: { method: "POST", url } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "http", type: "XHR",
      response: { url, mimeType: "application/json" } });
    const receipt = observer.handleEvent(source, "Network.loadingFinished", { requestId: "http" });
    try {
      await drain();
      await vi.advanceTimersByTimeAsync(2_501);
      expect(resync).toHaveBeenCalledTimes(1);
      // The current-loader check gates final assembly; only the incomplete
      // prefix may cross before that check times out.
      expect(forward.mock.calls.map(([envelope]) => JSON.parse(envelope.payload.body).chunkIndex)).toEqual([0, 1]);
      await observer.emitWorkHealth(source, { kind: "WORK_HEALTH", counters: {}, lastOutcome: null,
        lastErrorCode: null, inFlightAgeMs: 0 });
      expect(forward.mock.calls[2]?.[0]).toMatchObject({ sequence: 0, transport: "TAB_STATE" });
    } finally {
      release();
      await receipt;
      vi.useRealTimers();
    }
  });

  it.each(["CMD", "IM"] as const)("releases a hung %s multipart document check before forwarding a replacement epoch", async (lobby) => {
    vi.useFakeTimers();
    const source: ObservedSource = { lobby, sourceId: `chrome:${lobby}:8`, tabId: 8 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const body = JSON.stringify({ padding: "x".repeat(220_000) });
    let frameReads = 0;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ forward, sendCommand: async (_tabId, method) => {
      if (method === "Network.getResponseBody") return { body, base64Encoded: false };
      if (method === "Page.getFrameTree") {
        frameReads += 1;
        // The two receipt checks pass; the first fragment's final admission
        // read never responds, even when the bridge replaces its source epoch.
        if (frameReads === 3) await blocked;
        return { frameTree: { frame: { id: "frame", loaderId: "document" } } };
      }
      return {};
    } });
    const url = lobby === "CMD"
      ? "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx?fc=1"
      : "https://imsports.directsb.net/api/EventV6/GetSE";
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "http", frameId: "frame",
      loaderId: "document", request: { method: "POST", url } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "http", type: "XHR",
      response: { url, mimeType: "application/json" } });
    const receipt = observer.handleEvent(source, "Network.loadingFinished", { requestId: "http" });
    await drain();
    expect(frameReads).toBe(3);
    observer.beginBridgeSourceEpoch(source.sourceId);
    let replacementForwarded = false;
    const replacement = observer.emitWorkHealth(source, { kind: "WORK_HEALTH", counters: {},
      lastOutcome: null, lastErrorCode: null, inFlightAgeMs: 0 })
      .then(() => { replacementForwarded = true; });
    try {
      await vi.advanceTimersByTimeAsync(2_501);
      expect(replacementForwarded).toBe(true);
      expect(forward).toHaveBeenCalledTimes(1);
      expect(forward.mock.calls[0]?.[0]).toMatchObject({ sequence: 0, transport: "TAB_STATE" });
    } finally {
      release();
      await Promise.all([receipt, replacement]);
      vi.useRealTimers();
    }
  });

  it.each(["direct", "CDP"] as const)("discards an old %s HTTP receipt held across bridge epoch replacement", async (mode) => {
    const source: ObservedSource = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const body = JSON.stringify({ StatusCode: 100, sel: [{ eid: 1 }] });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getResponseBody") { await blocked; return { body, base64Encoded: false }; }
      if (method === "Page.getFrameTree") { if (mode === "direct") await blocked;
        return { frameTree: { frame: { id: "frame", loaderId: "document" } } }; }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward });
    const url = "https://imsports.directsb.net/api/EventV6/GetSE";
    let request: Promise<void>;
    if (mode === "direct") request = observer.ingestHttpResponse(source, url, "Fetch", body, {
      method: "POST", verifiedDocument: { frameId: "frame", loaderId: "document" }
    });
    else {
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "http", frameId: "frame",
        loaderId: "document", request: { method: "POST", url } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId: "http", type: "XHR",
        response: { url, mimeType: "application/json" } });
      request = observer.handleEvent(source, "Network.loadingFinished", { requestId: "http" });
    }
    await drain();
    observer.beginBridgeSourceEpoch(source.sourceId);
    release();
    await request;
    expect(forward).not.toHaveBeenCalled();
    await expect(observer.replaySnapshots(source.sourceId)).resolves.toBe(false);
    expect(forward).not.toHaveBeenCalled();
  });

  it.each([false, true])("coalesces blocked durable SABA writes and fences retired pending snapshots (reset=%s)", async (reset) => {
    const source: ObservedSource = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const saves: PersistedSabaWsSnapshots[] = [];
    const observer = new NetworkObserver({ forward: async () => undefined,
      sendCommand: async (_tabId, method, params) => method === "Runtime.evaluate" &&
        params?.expression === "String(performance.timeOrigin)" ? { result: { value: "1787432000000" } } : {},
      saveSabaWsSnapshots: async (snapshot) => {
        saves.push(snapshot); events.push("save"); if (saves.length === 1) await blocked;
      }, clearSabaWsSnapshots: async () => { events.push("clear"); } });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "first", url: "wss://sports.example/socket.io/"
    });
    for (let index = 0; index < 8; index++) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", frame("SABA", index));
    }
    expect(saves).toHaveLength(1);
    if (reset) observer.beginSourceEpoch(source.sourceId);
    release();
    await drain();
    expect(saves).toHaveLength(reset ? 1 : 2);
    if (reset) expect(events).toEqual(["save", "clear"]);
    else expect(saves[1]?.partitions[0]?.frames.at(-1)?.body).toContain('"r7"');
  });

  it("does not publish a held SABA receipt into an immediately recovered bridge epoch", async () => {
    const source: ObservedSource = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => { await blocked; });
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      maxPendingForwardBytes: 8_192, onForwardOverflow: () => { observer.beginBridgeSourceEpoch(source.sourceId); } });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "first", url: "wss://sports.example/socket.io/"
    });
    const first = observer.handleEvent(source, "Network.webSocketFrameReceived", frame("SABA"));
    await drain();
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "first", response: { opcode: 1, payloadData: "x".repeat(8_192) }
    });
    release();
    await first;
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it.each(["direct", "CDP"] as const)("forwards an entire %s HTTP snapshot larger than its pending cap", async (mode) => {
    const source: ObservedSource = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 };
    const body = JSON.stringify({ StatusCode: 100, sel: [], padding: "x".repeat(500_000) });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body, base64Encoded: false } : method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "frame", loaderId: "document" } } } : {});
    const forwarded: ChromeBridgeEnvelope[] = [];
    const onForwardOverflow = vi.fn();
    const observer = new NetworkObserver({ sendCommand, maxPendingForwardBytes: 300_000, onForwardOverflow,
      forward: async (envelope) => { forwarded.push(envelope); } });
    const url = "https://imsports.directsb.net/api/EventV6/GetSE";
    if (mode === "direct") await observer.ingestHttpResponse(source, url, "Fetch", body, {
      method: "POST", verifiedDocument: { frameId: "frame", loaderId: "document" }
    });
    else {
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "http", frameId: "frame",
        loaderId: "document", request: { method: "POST", url } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId: "http", type: "XHR",
        response: { url, mimeType: "application/json" } });
      await observer.handleEvent(source, "Network.loadingFinished", { requestId: "http" });
    }
    expect(onForwardOverflow).not.toHaveBeenCalled();
    const chunks = forwarded.map((envelope) => JSON.parse(envelope.payload.body));
    expect(chunks).toHaveLength(5);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(chunks.map((chunk) => chunk.bodyFragment).join("")).toBe(body);
    expect(forwarded.map((envelope) => envelope.sequence)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each(["SBO", "SABA"] as const)("releases pending %s input immediately when its source epoch changes", async (lobby) => {
    const source: ObservedSource = { lobby, sourceId: `chrome:${lobby}:7`, tabId: 7 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let hold = false;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => { if (hold) await blocked; });
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "first", url: "wss://sports.example/socket.io/"
    });
    forward.mockClear();
    hold = true;
    const first = observer.handleEvent(source, "Network.webSocketFrameReceived", frame(lobby));
    await drain();
    const pending = observer.handleEvent(source, "Network.webSocketFrameReceived", frame(lobby, 1));
    let settled = false;
    void pending.then(() => { settled = true; });
    await drain();
    observer.beginSourceEpoch(source.sourceId);
    await drain();
    expect(settled).toBe(true);
    expect(forward).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, pending]);
  });

  it.each(["SBO", "SABA"] as const)("retires overflowing %s work and blocks deltas until a new epoch", async (lobby) => {
    const source: ObservedSource = { lobby, sourceId: `chrome:${lobby}:7`, tabId: 7 };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let hold = false;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => { if (hold) await blocked; });
    const onForwardOverflow = vi.fn();
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      maxPendingForwardBytes: 8_192, onForwardOverflow });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "first", url: "wss://sports.example/socket.io/"
    });
    forward.mockClear();
    hold = true;
    const first = observer.handleEvent(source, "Network.webSocketFrameReceived", frame(lobby));
    await drain();
    const pending = Array.from({ length: 20 }, (_, index) => observer.handleEvent(source,
      "Network.webSocketFrameReceived", {
        requestId: "first", response: { opcode: 1, payloadData: JSON.stringify({ index, data: "x".repeat(1_000) }) }
      }));
    await drain();
    expect(onForwardOverflow).toHaveBeenCalledTimes(1);
    expect(onForwardOverflow).toHaveBeenCalledWith(source);
    release();
    await Promise.all([first, ...pending]);
    expect(forward).toHaveBeenCalledTimes(1);
    observer.beginBridgeSourceEpoch(source.sourceId);
    await observer.emitWorkHealth(source, { kind: "WORK_HEALTH", counters: {}, lastOutcome: null,
      lastErrorCode: null, inFlightAgeMs: 0 });
    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward.mock.calls[1]?.[0]).toMatchObject({ sequence: 0 });
  });
});
