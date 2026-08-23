import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";

function envelope(sequence: number, body = "{}", sourceId = "chrome:SABA:7",
  sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "SABA", sourceId, tabId: 7, sequence,
    sourceEpoch,
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
  it("waits for loopback health before constructing a WebSocket", () => {
    const socket = new FakeSocket();
    const factory = vi.fn(() => socket);
    const scheduled: Array<() => void> = [];
    let ready = false;
    const bridge = new LocalBridge({
      socketFactory: factory,
      installationKey: "local-key",
      readinessProbe: () => ready,
      setTimer: (callback) => { scheduled.push(callback); return scheduled.length; },
      clearTimer: () => undefined
    });

    bridge.connect();
    expect(factory).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    ready = true;
    scheduled[0]!();
    expect(factory).toHaveBeenCalledOnce();
  });

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

  it("replaces a half-open socket when the wake-up alarm observes no server acknowledgement", () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let socketIndex = 0;
    let nowMs = 1_000;
    const bridge = new LocalBridge({
      socketFactory: () => sockets[socketIndex++]!,
      installationKey: "local-key",
      now: () => nowMs,
      livenessTimeoutMs: 25_000
    });
    bridge.enqueue(envelope(0));
    bridge.connect();
    sockets[0]!.open();

    nowMs += 25_001;
    bridge.connect();

    expect(sockets[0]!.readyState).toBe(3);
    expect(socketIndex).toBe(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent.map((value) => JSON.parse(value).sequence)).toEqual([0]);
  });

  it("drops a source's gapped backlog atomically and requests a new source epoch", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let socketIndex = 0;
    const onSourceResync = vi.fn();
    const bridge = new LocalBridge({
      socketFactory: () => sockets[socketIndex++]!, installationKey: "local-key", onSourceResync
    });
    bridge.enqueue(envelope(12, "old", "chrome:SABA:7"));
    bridge.enqueue(envelope(4, "healthy", "chrome:IM:8"));
    bridge.connect();
    sockets[0]!.open();

    sockets[0]!.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "REJECT", sourceId: "chrome:SABA:7", sequence: 12, reason: "SEQUENCE_GAP"
    }) });

    expect(bridge.pendingSequences()).toEqual([4]);
    expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
    await vi.waitFor(() => expect(socketIndex).toBe(2));
  });

  it("drops one overflowing source atomically without removing another provider", async () => {
    const onSourceResync = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => new FakeSocket(), installationKey: "local-key",
      maxQueueBytes: 700, onSourceResync });

    await bridge.enqueue(envelope(0, "x".repeat(200), "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(1, "y".repeat(200), "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(9, "z".repeat(200), "chrome:BTI:8", "worker-a:0"));

    expect(bridge.pendingSequences()).toEqual([9]);
    expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
  });

  it("refuses the old source epoch until a replacement snapshot begins", async () => {
    const bridge = new LocalBridge({ socketFactory: () => new FakeSocket(), installationKey: "local-key",
      maxQueueBytes: 1_300, onSourceResync: vi.fn() });

    await bridge.enqueue(envelope(0, "x".repeat(500), "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(1, "y".repeat(500), "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(2, "old", "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(0, "baseline", "chrome:SABA:7", "worker-a:1"));
    await bridge.enqueue(envelope(1, "replacement", "chrome:SABA:7", "worker-a:1"));
    await bridge.enqueue(envelope(3, "late-old", "chrome:SABA:7", "worker-a:0"));

    expect(bridge.pendingSequences()).toEqual([0, 1]);
  });

  it("ignores acknowledgements delivered by a retired socket generation", () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const scheduled: Array<() => void> = [];
    let index = 0;
    const bridge = new LocalBridge({
      socketFactory: () => sockets[index++]!, installationKey: "local-key",
      setTimer: (callback) => { scheduled.push(callback); return scheduled.length; }, clearTimer: () => undefined
    });
    void bridge.enqueue(envelope(0));
    bridge.connect();
    sockets[0]!.open();
    const staleMessage = sockets[0]!.onmessage!;
    sockets[0]!.close();
    scheduled[0]!();
    sockets[1]!.open();

    staleMessage({ data: JSON.stringify({
      version: 1, kind: "ACK", sourceId: "chrome:SABA:7", sequence: 0
    }) });
    expect(bridge.pendingSequences()).toEqual([0]);
    sockets[1]!.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "ACK", sourceId: "chrome:SABA:7", sequence: 0
    }) });
    expect(bridge.pendingSequences()).toEqual([]);
  });

  it("ignores rejects and gap recovery delivered by a retired socket generation", () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    const scheduled: Array<() => void> = [];
    const onSourceResync = vi.fn();
    let index = 0;
    const bridge = new LocalBridge({
      socketFactory: () => sockets[index++]!, installationKey: "local-key", onSourceResync,
      setTimer: (callback) => { scheduled.push(callback); return scheduled.length; }, clearTimer: () => undefined
    });
    void bridge.enqueue(envelope(0));
    bridge.connect();
    sockets[0]!.open();
    const staleMessage = sockets[0]!.onmessage!;
    sockets[0]!.close();
    scheduled[0]!();
    sockets[1]!.open();

    staleMessage({ data: JSON.stringify({
      version: 1, kind: "REJECT", sourceId: "chrome:SABA:7", sequence: 0, reason: "INVALID_ENVELOPE"
    }) });
    staleMessage({ data: JSON.stringify({
      version: 1, kind: "REJECT", sourceId: "chrome:SABA:7", sequence: 0, reason: "SEQUENCE_GAP"
    }) });

    expect(bridge.pendingSequences()).toEqual([0]);
    expect(onSourceResync).not.toHaveBeenCalled();
  });

  it("notifies the collector after every successful socket generation so snapshots can be replayed", () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let socketIndex = 0;
    const scheduled: Array<() => void> = [];
    const onOpen = vi.fn();
    const bridge = new LocalBridge({
      socketFactory: () => sockets[socketIndex++]!, installationKey: "local-key", onOpen,
      setTimer: (callback) => { scheduled.push(callback); return scheduled.length; }, clearTimer: () => undefined
    });

    bridge.connect();
    sockets[0]!.open();
    sockets[0]!.close();
    scheduled[0]!();
    sockets[1]!.open();

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("handles an authenticated server snapshot request without acknowledging or dropping queued data", () => {
    const socket = new FakeSocket();
    const onSnapshotRequest = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSnapshotRequest });
    bridge.enqueue(envelope(0));
    bridge.connect();
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:SABA:7" }) });

    expect(onSnapshotRequest).toHaveBeenCalledWith("chrome:SABA:7");
    expect(bridge.pendingSequences()).toEqual([0]);
  });

  it("does not let one blocked snapshot recovery delay another provider", async () => {
    const socket = new FakeSocket();
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const onSnapshotRequest = vi.fn(async (sourceId: string) => {
      started.push(sourceId);
      if (sourceId === "chrome:SABA:7") {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
    });
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key",
      onSnapshotRequest });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:SABA:7" }) });
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:IM:8" }) });
    await vi.waitFor(() => expect(started).toEqual(["chrome:SABA:7", "chrome:IM:8"]));

    releaseFirst?.();
  });

  it("forwards an explicit source reload command to the attached-tab controller", () => {
    const socket = new FakeSocket();
    const onSourceReload = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSourceReload });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:7"
    }) });

    expect(onSourceReload).toHaveBeenCalledWith("chrome:SABA:7");
  });

  it("forwards a fresh launch navigation to the attached-tab controller", () => {
    const socket = new FakeSocket();
    const onSourceNavigate = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSourceNavigate });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "NAVIGATE_SOURCE",
      sourceId: "chrome:SABA:7", url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" }) });

    expect(onSourceNavigate).toHaveBeenCalledWith("chrome:SABA:7",
      "https://c0z0ob.bpd3a3fn.com/sports?token=opaque");
  });

  it("forwards an ensure-source command even when no provider tab is attached", () => {
    const socket = new FakeSocket();
    const onSourceEnsure = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSourceEnsure });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ENSURE_SOURCE", lobby: "CMD",
      url: "https://cgnew.fts368.com/sports?opaque=1" }) });

    expect(onSourceEnsure).toHaveBeenCalledWith("CMD", "https://cgnew.fts368.com/sports?opaque=1");
  });

  it("serializes reset source recovery so provider bootstraps do not overload Chrome", async () => {
    const socket = new FakeSocket();
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: string[] = [];
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      onSourceEnsure: async (lobby) => {
        calls.push(lobby);
        if (lobby === "SABA") await first;
      }
    });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ENSURE_SOURCE", lobby: "SABA",
      url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" }) });
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ENSURE_SOURCE", lobby: "BTI",
      url: "https://prod20091.fxf774.com/sports?token=opaque" }) });

    expect(calls).toEqual(["SABA"]);
    releaseFirst?.();
    await first;
    await vi.waitFor(() => expect(calls).toEqual(["SABA", "BTI"]));
  });

  it("forwards a restore-source command for a closed provider tab", () => {
    const socket = new FakeSocket();
    const onSourceRestore = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSourceRestore });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "RESTORE_SOURCE", lobby: "CMD" }) });

    expect(onSourceRestore).toHaveBeenCalledWith("CMD");
  });

  it("forwards a strict read-only focus command without mutating queued data", () => {
    const socket = new FakeSocket();
    const onFocusSelection = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onFocusSelection });
    bridge.enqueue(envelope(0));
    bridge.connect();
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "FOCUS_SELECTION", sourceId: "chrome:CMD:7",
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "market-1:home"
    }) });
    expect(onFocusSelection).toHaveBeenCalledWith({
      sourceId: "chrome:CMD:7", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "market-1:home"
    });
    expect(bridge.pendingSequences()).toEqual([0]);
  });

  it("forwards an event-scoped CMD hidden-market probe without mutating queued data", () => {
    const socket = new FakeSocket();
    const onCmdHiddenMarketProbe = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key",
      onCmdHiddenMarketProbe });
    bridge.enqueue(envelope(0));
    bridge.connect();
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "PROBE_CMD_HIDDEN_MARKETS",
      sourceId: "chrome:CMD:7", requestId: "probe-1", providerEventId: "25250586" }) });

    expect(onCmdHiddenMarketProbe).toHaveBeenCalledWith({ sourceId: "chrome:CMD:7",
      requestId: "probe-1", providerEventId: "25250586" });
    expect(bridge.pendingSequences()).toEqual([0]);
  });

  it("forwards a correlated visible-price probe without mutating queued data", () => {
    const socket = new FakeSocket();
    const onSelectionPriceProbe = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key",
      onSelectionPriceProbe });
    bridge.enqueue(envelope(0));
    bridge.connect();
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE",
      sourceId: "chrome:TSPORT:7", requestId: "price-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" }) });

    expect(onSelectionPriceProbe).toHaveBeenCalledWith({ sourceId: "chrome:TSPORT:7", requestId: "price-1",
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "selection-1",
      eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" });
    expect(bridge.pendingSequences()).toEqual([0]);
  });

  it("retires a same-provider epoch instead of removing a sequenced diagnostic", async () => {
    const onSourceResync = vi.fn();
    const bridge = new LocalBridge({
      socketFactory: () => new FakeSocket(), installationKey: "local-key", maxQueueBytes: 900,
      onSourceResync
    });
    await bridge.enqueue(envelope(0, "d".repeat(100)), "DIAGNOSTIC");
    await bridge.enqueue(envelope(1, "q".repeat(100)), "QUOTE");
    await bridge.enqueue(envelope(2, "q".repeat(100)), "QUOTE");
    expect(bridge.pendingSequences()).toEqual([]);
    expect(bridge.queueBytes).toBeLessThanOrEqual(900);
    expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
  });

  it("never evicts another provider's diagnostic to admit an overflowing source", async () => {
    const onSourceResync = vi.fn();
    const bridge = new LocalBridge({
      socketFactory: () => new FakeSocket(), installationKey: "local-key", maxQueueBytes: 900,
      onSourceResync
    });
    await bridge.enqueue(envelope(7, "d".repeat(100), "chrome:IM:7"), "DIAGNOSTIC");
    await bridge.enqueue(envelope(0, "q".repeat(100), "chrome:SABA:8"), "QUOTE");
    await bridge.enqueue(envelope(1, "q".repeat(100), "chrome:SABA:8"), "QUOTE");

    expect(bridge.pendingSequences()).toEqual([7]);
    expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:8");
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

  it("holds one bounded all-market snapshot until loopback acknowledgements arrive", () => {
    const socket = new FakeSocket();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key" });
    bridge.connect();
    socket.open();
    expect(() => {
      for (let index = 0; index < 54; index++) {
        bridge.enqueue(envelope(index, "x".repeat(110_000), "chrome:IM:8"));
      }
    }).not.toThrow();
    expect(bridge.queueBytes).toBeGreaterThan(5 * 1024 * 1024);
    expect(bridge.queueBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it("retires an overflowing quote generation without blocking producers", async () => {
    const socket = new FakeSocket();
    const onSourceResync = vi.fn();
    const bridge = new LocalBridge({
      socketFactory: () => socket, installationKey: "local-key", maxQueueBytes: 700, onSourceResync
    });
    bridge.connect();
    socket.open();

    await bridge.enqueue(envelope(0, "x".repeat(200)));
    await expect(bridge.enqueue(envelope(1, "y".repeat(200)))).resolves.toBeUndefined();

    expect(bridge.pendingSequences()).toEqual([]);
    expect(bridge.queueBytes).toBeLessThanOrEqual(700);
    expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
  });
});
