import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
const baseline = `42${JSON.stringify(["m", "b1", [
  ["f", 0, ["type", "matchid"]], [0, "reset"], [0, "m", 1, 20], [0, "done"]
], "r0001"])}`;
const domRecords = JSON.stringify([{ sportId: "1", leagueId: "l", leagueName: "League", matchId: "m",
  timeText: "LIVE", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
    { marketOddsId: "o", priceText: "0.92", lineText: "0.5" },
    { marketOddsId: "o", priceText: "-0.98" }
  ] }] }]);

function recoveryCommand(_tabId: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
  if (method === "Page.getFrameTree") return Promise.resolve({ frameTree: { frame: { id: "top" } } });
  if (method === "Page.createIsolatedWorld") return Promise.resolve({ executionContextId: 71 });
  if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
    return Promise.resolve({ result: { type: "string", value: domRecords } });
  }
  if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: "1787250000000.5" } });
  return Promise.resolve({});
}

describe("SABA light snapshot recovery", () => {
  it("persists a completed socket baseline and replays it after extension worker restart without tab mutation", async () => {
    let stored: unknown = null;
    const markerCommand = vi.fn(recoveryCommand);
    const first = new NetworkObserver({ sendCommand: markerCommand,
      forward: vi.fn(async () => undefined),
      saveSabaWsSnapshots: async (value) => { stored = value; } });
    await first.handleEvent(source, "Network.webSocketCreated", {
      requestId: "socket-1", url: "https://sports.example/socket.io/"
    });
    await first.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "socket-1", response: { opcode: 1, payloadData: baseline }
    });
    await vi.waitFor(() => expect(stored).not.toBeNull());

    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(recoveryCommand);
    const restarted = new NetworkObserver({ sendCommand, forward,
      loadSabaWsSnapshots: async () => stored });
    await restarted.refreshCatalog(source);

    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toBe(true);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      lobby: "SABA", sourceId: source.sourceId, tabId: source.tabId, transport: "WS_FRAME",
      request: expect.objectContaining({ replayed: true }),
      payload: expect.objectContaining({ body: baseline })
    }));
    expect(forward.mock.calls.filter(([envelope]) => envelope.transport === "DOM_SNAPSHOT")).toHaveLength(2);
  });

  it("fails closed without a retained complete baseline and never reloads the tab", async () => {
    const sendCommand = vi.fn(recoveryCommand);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward,
      loadSabaWsSnapshots: async () => null });

    await observer.refreshCatalog(source);

    expect(forward.mock.calls.filter(([envelope]) => envelope.transport === "DOM_SNAPSHOT")).toHaveLength(2);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
  });

  it("does not replay a baseline persisted by a different SABA page document", async () => {
    const sendCommand = vi.fn(async (tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression !== CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: "1787250000001.5" } };
      }
      return recoveryCommand(tabId, method, params);
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, loadSabaWsSnapshots: async () => ({
      version: 1, sourceId: source.sourceId, documentMarker: "1787250000000.5", partitions: []
    }) });

    await observer.refreshCatalog(source);

    expect(forward.mock.calls.some(([envelope]) => envelope.transport === "WS_FRAME")).toBe(false);
    expect(forward.mock.calls.filter(([envelope]) => envelope.transport === "DOM_SNAPSHOT")).toHaveLength(2);
    expect(sendCommand.mock.calls.every(([, method]) => method !== "Page.reload" &&
      method !== "Network.emulateNetworkConditions")).toBe(true);
  });

  it("keeps the durable baseline across a worker reattach context-clear and reloads it only for the same document", async () => {
    const stored = {
      version: 1 as const, sourceId: source.sourceId, documentMarker: "1787250000000.5",
      partitions: [{ partition: "1:b1", frames: [{
        url: "https://sports.example/socket.io/", body: baseline, streamId: "1",
        observedAtMs: 1_000, receivedMonotonicMs: 10
      }] }]
    };
    const clear = vi.fn(async (_sourceId: string) => undefined);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(recoveryCommand);
    const observer = new NetworkObserver({ sendCommand, forward,
      loadSabaWsSnapshots: async () => stored, clearSabaWsSnapshots: clear });

    await observer.handleEvent(source, "Runtime.executionContextsCleared", {});
    await observer.refreshCatalog(source);

    expect(clear).toHaveBeenCalledWith(source.sourceId);
    expect(forward.mock.calls.some(([envelope]) => envelope.transport === "WS_FRAME")).toBe(false);
    expect(forward.mock.calls.filter(([envelope]) => envelope.transport === "DOM_SNAPSHOT")).toHaveLength(2);
  });
});

describe("KSPORT light snapshot recovery", () => {
  const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:9", tabId: 9 } as const;
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: "[]" });
  const live = "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n" +
    `subscription:subSportBookLive\nmessage-id:socket-100\n\n${wrapper}\u0000`;
  const today = "MESSAGE\ndestination:/topic/sports/1_11/today/ma/event/vi\n" +
    `subscription:subSportBookToday\nmessage-id:socket-104\n\n${wrapper}\u0000`;

  it("replays a KSPORT baseline only within its current worker", async () => {
    const saveSabaWsSnapshots = vi.fn(async () => undefined);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const marker = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: "1787251000000.5" } } : {});
    const current = new NetworkObserver({ sendCommand: marker, forward, saveSabaWsSnapshots });
    await current.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "ksocket-1", url: "wss://d42.sb21.net/sport/socket"
    });
    for (const payloadData of [live, today]) {
      await current.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "ksocket-1", response: { opcode: 1, payloadData }
      });
    }

    expect(saveSabaWsSnapshots).not.toHaveBeenCalled();
    forward.mockClear();
    await expect(current.replaySnapshots(ksport.sourceId)).resolves.toBe(true);
    expect(forward.mock.calls.map(([envelope]) => envelope.payload.body)).toEqual([live, today]);

    const loadSabaWsSnapshots = vi.fn(async () => ({ version: 1, sourceId: ksport.sourceId,
      documentMarker: "1787251000000.5", partitions: [{ partition: "1", frames: [
        { url: "wss://d42.sb21.net/sport/socket", body: live, streamId: "1", recoveryGeneration: 1,
          observedAtMs: 1_000, receivedMonotonicMs: 10 },
        { url: "wss://d42.sb21.net/sport/socket", body: today, streamId: "1", recoveryGeneration: 1,
          observedAtMs: 1_001, receivedMonotonicMs: 11 }
      ] }] }));
    const restartedForward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const restarted = new NetworkObserver({ sendCommand: marker, forward: restartedForward, loadSabaWsSnapshots });
    await restarted.refreshCatalog(ksport);

    expect(loadSabaWsSnapshots).not.toHaveBeenCalled();
    expect(restartedForward.mock.calls.some(([envelope]) => envelope.transport === "WS_FRAME")).toBe(false);
  });
});
