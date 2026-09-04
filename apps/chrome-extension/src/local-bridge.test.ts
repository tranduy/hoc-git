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

function ksportCatalogChunk(sequence: number, partition: "KSPORT_LIVE" | "KSPORT_TODAY",
  chunkIndex: number, chunkCount: number): ChromeBridgeEnvelope {
  const partitionName = partition === "KSPORT_LIVE" ? "live" : "today";
  return {
    version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000, receivedMonotonicMs: 50,
    transport: "HTTP_RESPONSE",
    request: {
      hostname: "sb21.net", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch", method: "GET",
      observerRequestId: `worker-a:request:${sequence}`, requestFrameKey: "worker-a:frame:14",
      requestDocumentKey: "worker-a:document:14", streamId: "ksport-http:14:1", providerPartition: partition,
      providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: 0
    },
    payload: { encoding: "UTF8", body: JSON.stringify({
      schemaVersion: 1, snapshotId: `ksport-http:14:1:${partitionName}`, chunkIndex, chunkCount,
      bodyEncoding: "UTF8", bodyFragment: "x".repeat(110_000)
    }) }
  };
}

function btiAuthFailure(sequence = 0): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "BTI", sourceId: "chrome:BTI:18", tabId: 18,
    sourceEpoch: "worker-a:0", sequence, observedAtMs: 1_000, receivedMonotonicMs: 50,
    transport: "TAB_STATE", request: { hostname: "prod20091.fxf774.com",
      pathnameClass: "/__fieldline_heartbeat__", resourceType: "Tab" },
    payload: { encoding: "UTF8", body: JSON.stringify({
      kind: "PAGE_HEALTH", status: "AUTH_ERROR", code: "1008"
    }) }
  };
}

class FakeSocket implements BridgeSocket {
  readonly sent: string[] = [];
  readonly sentSourceIds: string[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
    this.sentSourceIds.push((JSON.parse(data) as ChromeBridgeEnvelope).sourceId);
  }
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

  it("purges a removed tab source and rejects its late in-flight envelopes", async () => {
    const bridge = new LocalBridge({ socketFactory: () => new FakeSocket(), installationKey: "local-key" });
    await bridge.enqueue(envelope(1, "{}", "chrome:SABA:7"));
    await bridge.enqueue(envelope(9, "{}", "chrome:CMD:8"));

    bridge.releaseSource("chrome:SABA:7");
    await bridge.enqueue(envelope(2, "{}", "chrome:SABA:7", "worker-b:0"));

    expect(bridge.pendingSequences()).toEqual([9]);
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

  it("resyncs a discontinuous source backlog instead of replaying a manufactured gap", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let socketIndex = 0;
    const scheduled: Array<() => void> = [];
    const onSourceResync = vi.fn();
    const bridge = new LocalBridge({
      socketFactory: () => sockets[socketIndex++]!, installationKey: "local-key", onSourceResync,
      setTimer: (callback) => { scheduled.push(callback); return scheduled.length; },
      clearTimer: () => undefined
    });
    bridge.enqueue(envelope(0));
    bridge.enqueue(envelope(1));
    bridge.enqueue(envelope(2));
    bridge.connect();
    sockets[0]!.open();

    // A control from the retiring API process can acknowledge a middle
    // entry immediately before the local socket is replaced. Replaying the
    // remaining [0, 2] to the fresh process manufactures a sequence gap.
    sockets[0]!.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "ACK", sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0", sequence: 1
    }) });
    sockets[0]!.close();
    scheduled[0]!();
    sockets[1]!.open();

    expect(sockets[1]!.sent).toEqual([]);
    expect(bridge.pendingSequences()).toEqual([]);
    expect(onSourceResync).toHaveBeenCalledExactlyOnceWith("chrome:SABA:7");
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

  it("keeps the bridge socket when a replacement epoch is already admitted during resync", async () => {
    const sockets = [new FakeSocket(), new FakeSocket()];
    let socketIndex = 0;
    let finishResync!: () => void;
    const resync = new Promise<void>((resolve) => { finishResync = resolve; });
    const onSourceResync = vi.fn(async () => resync);
    const bridge = new LocalBridge({
      socketFactory: () => sockets[socketIndex++]!, installationKey: "local-key",
      onSourceResync
    });
    await bridge.enqueue(envelope(0, "old-head", "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(12, "old", "chrome:SABA:7", "worker-a:0"));
    await bridge.enqueue(envelope(13, "old-tail", "chrome:SABA:7", "worker-a:0"));
    bridge.connect();
    sockets[0]!.open();

    sockets[0]!.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "REJECT", sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0",
      sequence: 12, reason: "SEQUENCE_GAP"
    }) });
    await bridge.enqueue(envelope(0, "replacement", "chrome:SABA:7", "worker-b:0"));
    finishResync();
    await resync;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(socketIndex).toBe(1);
    expect(sockets[0]!.readyState).toBe(1);
    expect(sockets[0]!.sent.map((value) => JSON.parse(value).sourceEpoch))
      .toContain("worker-b:0");

    sockets[0]!.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "ACK", sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0", sequence: 0
    }) });
    expect(bridge.pendingSequences()).toEqual([0]);

    // The server may already have rejected more than one old queued frame
    // before it receives sequence zero of the replacement epoch. A delayed
    // reject for that removed old sequence must not retire the replacement.
    sockets[0]!.onmessage?.({ data: JSON.stringify({
      version: 1, kind: "REJECT", sourceId: "chrome:SABA:7", sourceEpoch: "worker-a:0",
      sequence: 13, reason: "SEQUENCE_GAP"
    }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSourceResync).toHaveBeenCalledTimes(1);
    expect(bridge.pendingSequences()).toEqual([0]);
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

    expect(onSnapshotRequest).toHaveBeenCalledWith({
      sourceId: "chrome:SABA:7", prematchWindowHours: undefined
    });
    expect(bridge.pendingSequences()).toEqual([0]);
  });

  it("does not starve one provider's snapshot request behind unfinished recoveries of other providers", () => {
    // Measured 2026-09-01: the default three shared lanes left SABA's request
    // queued for twenty minutes while its socket never reconnected.
    const socket = new FakeSocket();
    const onSnapshotRequest = vi.fn(() => new Promise<void>(() => undefined));
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSnapshotRequest });
    bridge.connect();
    socket.open();
    for (const sourceId of ["chrome:KSPORT:1", "chrome:TSPORT:2", "chrome:IM:3", "chrome:BTI:4", "chrome:CMD:5"]) {
      socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT", sourceId }) });
    }
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:7" }) });

    expect(onSnapshotRequest).toHaveBeenCalledTimes(6);
    expect(onSnapshotRequest).toHaveBeenLastCalledWith({ sourceId: "chrome:SABA:7", prematchWindowHours: undefined });
  });

  it("releases a recovery lane whose operation never settles so the next request for that source runs", async () => {
    const socket = new FakeSocket();
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const onSnapshotRequest = vi.fn(() => new Promise<void>(() => undefined));
    const bridge = new LocalBridge({
      socketFactory: () => socket, installationKey: "local-key", onSnapshotRequest,
      setTimer: (callback, delayMs) => { scheduled.push({ callback, delayMs }); return scheduled.length; },
      clearTimer: () => undefined
    });
    bridge.connect();
    socket.open();
    const request = { version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:SABA:7" };
    socket.onmessage?.({ data: JSON.stringify(request) });
    socket.onmessage?.({ data: JSON.stringify(request) });
    expect(onSnapshotRequest).toHaveBeenCalledTimes(1);

    const bound = scheduled.find((entry) => entry.delayMs === 90_000);
    expect(bound).toBeDefined();
    bound!.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSnapshotRequest).toHaveBeenCalledTimes(2);
  });

  it("forwards APSPORT's bounded prematch window with the snapshot request", () => {
    const socket = new FakeSocket();
    const onSnapshotRequest = vi.fn();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSnapshotRequest });
    bridge.connect();
    socket.open();
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: "chrome:TSPORT:7", prematchWindowHours: 24 }) });

    expect(onSnapshotRequest).toHaveBeenCalledWith({ sourceId: "chrome:TSPORT:7", prematchWindowHours: 24 });
  });

  it("does not let one blocked snapshot recovery delay another provider", async () => {
    const socket = new FakeSocket();
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const onSnapshotRequest = vi.fn(async (request: { readonly sourceId: string }) => {
      const sourceId = request.sourceId;
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

  it("does not let a stuck provider bootstrap block SABA restore", async () => {
    const socket = new FakeSocket();
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: string[] = [];
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      onSourceEnsure: async (lobby) => {
        calls.push(`ensure:${lobby}`);
        if (lobby === "BTI") await first;
      },
      onSourceRestore: async (lobby) => { calls.push(`restore:${lobby}`); }
    });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ENSURE_SOURCE", lobby: "BTI",
      url: "https://prod20091.fxf774.com/vi/asian-view/today" }) });
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "RESTORE_SOURCE", lobby: "SABA" }) });

    await vi.waitFor(() => expect(calls).toEqual(["ensure:BTI", "restore:SABA"]));
    releaseFirst?.();
    await first;
  });

  it("drops a duplicate SABA restore but accepts a fresh retry after the stuck lane times out", async () => {
    const socket = new FakeSocket();
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const onSourceRestore = vi.fn(() => new Promise<void>(() => undefined));
    const bridge = new LocalBridge({
      socketFactory: () => socket, installationKey: "local-key", onSourceRestore,
      setTimer: (callback, delayMs) => { scheduled.push({ callback, delayMs }); return scheduled.length; },
      clearTimer: () => undefined
    });
    bridge.connect();
    socket.open();
    const restore = { version: 1, kind: "RESTORE_SOURCE", lobby: "SABA" };
    socket.onmessage?.({ data: JSON.stringify(restore) });
    socket.onmessage?.({ data: JSON.stringify(restore) });
    expect(onSourceRestore).toHaveBeenCalledTimes(1);

    const bound = scheduled.find((entry) => entry.delayMs === 90_000);
    expect(bound).toBeDefined();
    bound!.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSourceRestore).toHaveBeenCalledTimes(1);
    socket.onmessage?.({ data: JSON.stringify(restore) });
    expect(onSourceRestore).toHaveBeenCalledTimes(2);
  });

  it("does not let BTI renewal retire its auth-failure signal before the API acknowledges it", async () => {
    const socket = new FakeSocket();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key" });
    bridge.connect();
    socket.open();
    let settled = false;
    const pending = bridge.enqueue(btiAuthFailure()).then(() => { settled = true; });
    await Promise.resolve();

    expect(settled).toBe(false);
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ACK",
      sourceId: "chrome:BTI:18", sequence: 0 }) });
    await pending;
    expect(settled).toBe(true);
  });

  it("does not queue exact-tab CMD restore behind a slow provider bootstrap", async () => {
    const socket = new FakeSocket();
    let releaseBootstrap: (() => void) | undefined;
    const bootstrap = new Promise<void>((resolve) => { releaseBootstrap = resolve; });
    const onSourceRestore = vi.fn(async () => undefined);
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      onSourceEnsure: async () => bootstrap,
      onSourceRestore
    });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ENSURE_SOURCE", lobby: "SABA",
      url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" }) });
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "RESTORE_SOURCE", lobby: "CMD" }) });

    expect(onSourceRestore).toHaveBeenCalledExactlyOnceWith("CMD");
    releaseBootstrap?.();
    await bootstrap;
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

  it("backpressures a paired KSPORT catalog larger than 16 MiB without resyncing or dropping another provider",
    async () => {
      const socket = new FakeSocket();
      const onSourceResync = vi.fn();
      const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key", onSourceResync });
      bridge.connect();
      socket.open();
      const chunks = (["KSPORT_LIVE", "KSPORT_TODAY"] as const).flatMap((partition, partitionIndex) =>
        Array.from({ length: 77 }, (_, chunkIndex) =>
          ksportCatalogChunk(partitionIndex * 77 + chunkIndex, partition, chunkIndex, 77)));
      expect(chunks.length * 110_000).toBeGreaterThan(16 * 1024 * 1024);

      const publish = (async () => {
        for (const chunk of chunks) await bridge.enqueue(chunk);
      })();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const sentKsportCount = () => socket.sentSourceIds
        .filter((sourceId) => sourceId === "chrome:KSPORT:14").length;
      expect(sentKsportCount()).toBe(1);
      expect(onSourceResync).not.toHaveBeenCalled();
      await bridge.enqueue(envelope(7, "healthy", "chrome:IM:8"));
      expect(socket.sentSourceIds).toContain("chrome:IM:8");

      let maximumQueueBytes = bridge.queueBytes;
      for (let index = 0; index < chunks.length; index += 1) {
        socket.onmessage?.({ data: JSON.stringify({
          version: 1, kind: "ACK", sourceId: "chrome:KSPORT:14", sequence: index
        }) });
        if (index + 1 < chunks.length) {
          for (let turn = 0; turn < 4 && sentKsportCount() < index + 2; turn += 1) {
            await Promise.resolve();
          }
          expect(sentKsportCount()).toBe(index + 2);
        }
        maximumQueueBytes = Math.max(maximumQueueBytes, bridge.queueBytes);
      }
      await publish;

      expect(maximumQueueBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
      expect(bridge.pendingSequences()).toEqual([7]);
      expect(onSourceResync).not.toHaveBeenCalled();
      expect(socket.readyState).toBe(1);
    });

  it("releases an acknowledged KSPORT producer when the bridge is closed", async () => {
    const socket = new FakeSocket();
    const bridge = new LocalBridge({ socketFactory: () => socket, installationKey: "local-key" });
    bridge.connect();
    socket.open();
    let settled = false;
    const pending = bridge.enqueue(ksportCatalogChunk(0, "KSPORT_LIVE", 0, 2))
      .then(() => { settled = true; });

    bridge.close();
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();

    expect(settled).toBe(true);
    await pending;
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

describe("RELOAD_EXTENSION control message", () => {
  it("reloads only when the deployed bundle differs from the running one", () => {
    const reloads: string[] = [];
    const socket = new FakeSocket();
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      buildIdentity: `sha256:${"a".repeat(64)}`,
      onExtensionReload: (identity: string) => { reloads.push(identity); }
    });
    bridge.connect();
    socket.open();

    // Its own bundle must never trigger a reload, or a server that keeps
    // announcing the current build turns every message into a reload loop.
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "RELOAD_EXTENSION",
      buildIdentity: `sha256:${"a".repeat(64)}` }) });
    expect(reloads).toEqual([]);

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "RELOAD_EXTENSION",
      buildIdentity: `sha256:${"b".repeat(64)}` }) });
    expect(reloads).toEqual([`sha256:${"b".repeat(64)}`]);
  });

  it("ignores a reload request when the worker does not know its own build", () => {
    const reloads: string[] = [];
    const socket = new FakeSocket();
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      onExtensionReload: (identity: string) => { reloads.push(identity); }
    });
    bridge.connect();
    socket.open();

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "RELOAD_EXTENSION",
      buildIdentity: `sha256:${"c".repeat(64)}` }) });
    expect(reloads).toEqual([]);
  });
});

describe("bridge must always be able to reconnect", () => {
  it("releases the readiness latch even when the connect token moved on", async () => {
    // The whole bridge dies together and never returns: every source goes stale
    // within seconds of the others and no reconnect follows. A readiness probe
    // whose resolution is discarded on a token mismatch leaves #probeInFlight
    // set, and connect() returns early on it for the life of the worker, so the
    // 30 s wake alarm can no longer do anything.
    let settleProbe!: (ready: boolean) => void;
    const socket = new FakeSocket();
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      readinessProbe: () => new Promise<boolean>((resolve) => { settleProbe = resolve; }),
      setTimer: () => 1,
      clearTimer: () => undefined
    });

    bridge.connect();
    bridge.close();
    settleProbe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.readinessLatched()).toBe(false);
  });

  it("reports how long the bridge has been out of contact", () => {
    let nowMs = 1_000;
    const socket = new FakeSocket();
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      now: () => nowMs
    });

    bridge.connect();
    socket.open();
    nowMs = 200_000;

    expect(bridge.serverContactAgeMs()).toBe(199_000);
  });
});

describe("keepalive from the server", () => {
  it("refreshes the contact clock without disturbing anything else", () => {
    let nowMs = 1_000;
    const socket = new FakeSocket();
    const bridge = new LocalBridge({
      socketFactory: () => socket,
      installationKey: "local-key",
      now: () => nowMs,
      onSourceReload: () => { throw new Error("must not run"); }
    });
    bridge.connect();
    socket.open();

    nowMs = 61_000;
    expect(bridge.serverContactAgeMs()).toBe(60_000);

    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "KEEPALIVE" }) });

    expect(bridge.serverContactAgeMs()).toBe(0);
  });
});
