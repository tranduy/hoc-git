import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
const baseline = `42${JSON.stringify(["m", "b1", [
  ["f", 0, ["type", "matchid"]], [0, "reset"], [0, "m", 1, 20], [0, "done"]
], "r0001"])}`;

describe("SABA light snapshot recovery", () => {
  it("persists a completed socket baseline and replays it after extension worker restart without tab mutation", async () => {
    let stored: unknown = null;
    const markerCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: "1787250000000.5" } } : {});
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
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: "1787250000000.5" } } : {});
    const restarted = new NetworkObserver({ sendCommand, forward,
      loadSabaWsSnapshots: async () => stored });
    await restarted.refreshCatalog(source);

    expect(sendCommand.mock.calls.map(([, method]) => method)).toEqual(["Runtime.evaluate"]);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      lobby: "SABA", sourceId: source.sourceId, tabId: source.tabId, transport: "WS_FRAME",
      request: expect.objectContaining({ replayed: true }),
      payload: expect.objectContaining({ body: baseline })
    }));
  });

  it("fails closed without a retained complete baseline and never disconnects or reloads the tab", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: "1787250000000.5" } } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      loadSabaWsSnapshots: async () => null });

    await observer.refreshCatalog(source);

    expect(sendCommand.mock.calls.map(([, method]) => method)).toEqual(["Runtime.evaluate"]);
  });

  it("does not replay a baseline persisted by a different SABA page document", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: "1787250000001.5" } } : {});
    const forward = vi.fn(async () => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, loadSabaWsSnapshots: async () => ({
      version: 1, sourceId: source.sourceId, documentMarker: "1787250000000.5", partitions: []
    }) });

    await observer.refreshCatalog(source);

    expect(forward).not.toHaveBeenCalled();
    expect(sendCommand.mock.calls.every(([, method]) => method !== "Page.reload" &&
      method !== "Network.emulateNetworkConditions")).toBe(true);
  });
});

describe("KSPORT light snapshot recovery", () => {
  const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:9", tabId: 9 } as const;
  const live = "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n\n[]\u0000";
  const today = "MESSAGE\ndestination:/topic/sports/1_1/today/ma/event/vi\n\n[]\u0000";

  it("persists both STOMP baseline partitions and replays them after worker restart", async () => {
    let stored: unknown = null;
    const marker = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: "1787251000000.5" } } : {});
    const first = new NetworkObserver({ sendCommand: marker, forward: vi.fn(async () => undefined),
      saveSabaWsSnapshots: async (value) => { stored = value; } });
    await first.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "ksocket-1", url: "https://sports.example/sport/socket"
    });
    await first.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "ksocket-1", response: { opcode: 1, payloadData: live }
    });
    await first.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "ksocket-1", response: { opcode: 1, payloadData: today }
    });
    await vi.waitFor(() => expect(stored).not.toBeNull());

    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const restarted = new NetworkObserver({ sendCommand: marker, forward,
      loadSabaWsSnapshots: async () => stored });
    await restarted.refreshCatalog(ksport);

    expect(forward.mock.calls.map(([envelope]) => envelope.payload.body)).toEqual([live, today]);
    expect(forward.mock.calls.every(([envelope]) => envelope.request.replayed === true)).toBe(true);
  });

  it("clears a persisted KSPORT baseline when its authoritative socket closes", async () => {
    const clear = vi.fn(async (_sourceId: string) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({
      result: { value: "1787251000000.5" }
    })), forward: vi.fn(async () => undefined), clearSabaWsSnapshots: clear });
    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "ksocket-2", url: "https://sports.example/sport/socket"
    });
    await observer.handleEvent(ksport, "Network.webSocketClosed", { requestId: "ksocket-2" });

    expect(clear).toHaveBeenCalledWith(ksport.sourceId);
  });
});
