import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";

function envelope(sequence: number, body = "{}", sourceId = "chrome:SABA:7"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "SABA", sourceId, tabId: 7, sequence,
    observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/feed", resourceType: "WebSocket" },
    payload: { encoding: "UTF8", body }
  };
}

class FakeSocket implements BridgeSocket {
  readonly sent: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.onclose?.(); }
  open(): void { this.readyState = 1; this.onopen?.(); }
}

describe("LocalBridge", () => {
  it("uses one loopback socket and sends queued envelopes in sequence order", () => {
    const socket = new FakeSocket();
    const factory = vi.fn(() => socket);
    const bridge = new LocalBridge({ socketFactory: factory, installationKey: "local-key" });
    bridge.enqueue(envelope(1));
    bridge.enqueue(envelope(0));
    bridge.connect();
    bridge.connect();
    socket.open();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("ws://127.0.0.1:4310/api/chrome-bridge", ["tool-chenh.v1", "local-key"]);
    expect(socket.sent.map((value) => JSON.parse(value).sequence)).toEqual([0, 1]);
  });

  it("removes acknowledged entries and resends only unacknowledged entries after reconnect", () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let socketIndex = 0;
    const scheduled: Array<() => void> = [];
    const bridge = new LocalBridge({
      socketFactory: () => sockets[socketIndex++]!, installationKey: "local-key",
      setTimer: (callback) => { scheduled.push(callback); return scheduled.length; }, clearTimer: () => undefined
    });
    bridge.enqueue(envelope(0));
    bridge.enqueue(envelope(1));
    bridge.connect();
    sockets[0]!.open();
    sockets[0]!.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ACK", sourceId: "chrome:SABA:7", sequence: 0 }) });
    sockets[0]!.close();
    expect(scheduled).toHaveLength(1);
    scheduled[0]!();
    sockets[1]!.open();
    expect(sockets[1]!.sent.map((value) => JSON.parse(value).sequence)).toEqual([1]);
  });

  it("evicts oldest diagnostics before quote frames when the queue reaches its bound", () => {
    const bridge = new LocalBridge({
      socketFactory: () => new FakeSocket(), installationKey: "local-key", maxQueueBytes: 900
    });
    bridge.enqueue(envelope(0, "d".repeat(100)), "DIAGNOSTIC");
    bridge.enqueue(envelope(1, "q".repeat(100)), "QUOTE");
    bridge.enqueue(envelope(2, "q".repeat(100)), "QUOTE");
    expect(bridge.pendingSequences()).toEqual([1, 2]);
    expect(bridge.queueBytes).toBeLessThanOrEqual(900);
  });

  it("cleans up malformed control messages without acknowledging data", () => {
    const socket = new FakeSocket();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key" });
    bridge.enqueue(envelope(0));
    bridge.connect();
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ kind: "ACK", sourceId: "chrome:SABA:7", sequence: 0, token: "bad" }) });
    expect(bridge.pendingSequences()).toEqual([0]);
  });
});
