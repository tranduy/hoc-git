import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
const documentBinding = { frameId: "provider-frame", loaderId: "provider-document" };
const origin = "https://api.sb21.net";
const observers: NetworkObserver[] = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.releaseTab(source.tabId);
  vi.useRealTimers();
});

async function registerContext(observer: NetworkObserver): Promise<void> {
  await observer.handleEvent(source, "Runtime.executionContextCreated", {
    context: { id: 91, auxData: { frameId: documentBinding.frameId, isDefault: true } }
  });
}

describe("SBOBET observer recovery after a missed socket lifecycle", () => {
  it("reconnects the exact orphan receipt session even when target discovery cannot recover it", async () => {
    let now = 1_000;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Target.getTargets") return { targetInfos: [] };
      if (sessionId !== "orphan-worker") return {};
      if (method === "Runtime.evaluate" && String(params?.expression).includes("globalThis.WebSocket")) {
        return { result: { objectId: "worker-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "worker-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now });
    observers.push(observer);
    await registerContext(observer);
    const receive = () => observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "preexisting-socket", response: { opcode: 1,
        payloadData: 'a["MESSAGE\\ndestination:/topic/sports/live\\n\\n{}\\u0000"]' }
    }, "orphan-worker");

    await receive();

    expect(sendCommand).toHaveBeenCalledWith(source.tabId, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "worker-instances", functionDeclaration: expect.stringContaining("fieldline-baseline-recovery")
    }), "orphan-worker");
    const probes = sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("globalThis.WebSocket"));
    expect(probes.map((call) => call[3])).toEqual(["orphan-worker"]);
    expect(forward).not.toHaveBeenCalled();
    now = 2_000;
    await receive();
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(1);
    now = 30_000;
    await receive();
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(1);
    now = 31_000;
    await receive();
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(2);
    expect(forward).not.toHaveBeenCalled();
  });

  it("reacquires a native pair when an established HTTP fallback fails, preserving both retry cadences", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    let expired = false;
    let observer!: NetworkObserver;
    const nativeSelections: number[] = [];
    const httpAttempts: number[] = [];
    const forwarded: ChromeBridgeEnvelope[] = [];
    const nativePair = async () => {
      for (const timeRange of ["live", "today"] as const) {
        const requestId = `native-${timeRange}-${now}`;
        const url = `${origin}/api/v2/getEvent?timeRange=${timeRange}`;
        await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
          ...documentBinding, request: { method: "GET", url } });
        await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
          response: { url, status: 200 } });
        await observer.handleEvent(source, "Network.loadingFinished", { requestId });
      }
    };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: documentBinding.frameId, loaderId: documentBinding.loaderId, url: `${origin}/sport` } } };
      if (method === "Target.getTargets") return { targetInfos: [] };
      if (method === "Network.getResponseBody") return { body: "[]", base64Encoded: false };
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        httpAttempts.push(now);
        return { result: { value: expired
          ? { status: "fieldline-ksport-catalog-refresh-failed", timeRange: "live", code: 400 }
          : { status: "catalog-requested", origin, responses: ["live", "today"].map((timeRange) => ({
            timeRange, url: `${origin}/api/v2/getEvent?timeRange=${timeRange}`, body: "[]" })) } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("sport-menu-tab")) {
        nativeSelections.push(now);
        if (nativeSelections.length % 2 === 1) await nativePair();
        return { result: { value: { status: "time-tab-selected" } } };
      }
      return {};
    });
    observer = new NetworkObserver({ sendCommand, now: () => now, monotonicNow: () => now,
      forward: async (envelope) => { forwarded.push(envelope); } });
    observers.push(observer);
    await registerContext(observer);
    const tick = async (atMs: number) => {
      now = atMs;
      const work = observer.maintainKsportFeed(source);
      await vi.advanceTimersByTimeAsync(1_000);
      await work;
    };
    const receipts = () => forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");

    await tick(1_000);
    expect(receipts()).toHaveLength(2);
    await tick(2_000);
    expect(nativeSelections).toEqual([]);
    expired = true;
    await tick(5_000);
    expect(nativeSelections).toEqual([5_000, 5_000]);
    expect(receipts().map((envelope) => envelope.request.streamId)).toEqual([
      "ksport-http:14:1", "ksport-http:14:1", "ksport-http:14:2", "ksport-http:14:2"
    ]);
    await tick(9_000);
    expect(nativeSelections).toEqual([5_000, 5_000]);
    await tick(13_000);
    expect(nativeSelections).toEqual([5_000, 5_000, 13_000, 13_000]);
    expect(httpAttempts).toEqual([1_000, 5_000, 9_000, 13_000]);
    expect(receipts().slice(-2).map((envelope) => envelope.request)).toEqual([
      expect.objectContaining({ streamId: "ksport-http:14:3", providerPartition: "KSPORT_LIVE",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestFrameKey: expect.any(String),
        requestDocumentKey: expect.any(String) }),
      expect.objectContaining({ streamId: "ksport-http:14:3", providerPartition: "KSPORT_TODAY",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestFrameKey: expect.any(String),
        requestDocumentKey: expect.any(String) })
    ]);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload" || method === "Page.navigate")).toBe(false);
  });

  it.each(["source", "bridge", "tab"] as const)(
    "does not reuse an orphan session after %s retirement during target discovery", async (kind) => {
      let observer!: NetworkObserver;
      const sendCommand = vi.fn(async (_tabId: number, method: string) => {
        if (method === "Target.getTargets") {
          retire(observer, kind);
          return { targetInfos: [] };
        }
        return {};
      });
      observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => 1_000 });
      observers.push(observer);
      await registerContext(observer);
      await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "orphan",
        response: { opcode: 1, payloadData: "MESSAGE\ndestination:/topic/sports/live\n\n{}" } }, "retired-worker");
      expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.evaluate")).toBe(false);
    });

  it.each((["source", "bridge", "tab"] as const).flatMap((kind) =>
    (["http", "native"] as const).map((boundary) => ({ kind, boundary }))))(
    "stops retired fallback recovery after $kind retirement at $boundary", async ({ kind, boundary }) => {
      vi.useFakeTimers();
      let now = 1_000;
      let expired = false;
      let nativeSelections = 0;
      let observer!: NetworkObserver;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: documentBinding.frameId, loaderId: documentBinding.loaderId, url: `${origin}/sport` } } };
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
          if (expired) {
            if (boundary === "http") retire(observer, kind);
            return { result: { value: { status: "fieldline-ksport-catalog-refresh-failed", code: 400 } } };
          }
          return { result: { value: { status: "catalog-requested", origin,
            responses: ["live", "today"].map((timeRange) => ({ timeRange,
              url: `${origin}/api/v2/getEvent?timeRange=${timeRange}`, body: "[]" })) } } };
        }
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          nativeSelections += 1;
          if (boundary === "native" && nativeSelections === 1) retire(observer, kind);
          return { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      });
      observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => now });
      observers.push(observer);
      await registerContext(observer);
      await observer.maintainKsportFeed(source);
      sendCommand.mockClear();
      expired = true; now = 9_000;
      const work = observer.maintainKsportFeed(source);
      await vi.advanceTimersByTimeAsync(5_000);
      await work;
      expect(nativeSelections).toBe(boundary === "native" ? 1 : 0);
      expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
        String(params?.expression).includes("globalThis.WebSocket"))).toBe(false);
    });

  it.each(["bridge", "tab"] as const)(
    "does not reconnect an orphan session retired by %s while provider work is queued", async (kind) => {
      const scheduler = new ProviderWorkScheduler({ maxConcurrent: 1 });
      let release!: () => void;
      const held = scheduler.run(source.sourceId, () => new Promise<void>((resolve) => { release = resolve; }));
      const sendCommand = vi.fn(async (_tabId: number, method: string) =>
        method === "Target.getTargets" ? { targetInfos: [] } : {});
      const observer = new NetworkObserver({ sendCommand, forward: async () => undefined,
        workScheduler: scheduler, now: () => 1_000 });
      observers.push(observer);
      await registerContext(observer);
      const receipt = observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "orphan",
        response: { opcode: 1, payloadData: "MESSAGE\ndestination:/topic/sports/live\n\n{}" } }, "retired-worker");
      try {
        await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(source.tabId, "Target.getTargets"));
        // Let the completed discovery enqueue its single-flight recovery behind held work.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        retire(observer, kind);
      } finally { release(); await held; await receipt; }
      expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.evaluate")).toBe(false);
    });
});

function retire(observer: NetworkObserver, kind: "source" | "bridge" | "tab"): void {
  if (kind === "source") observer.beginSourceEpoch(source.sourceId);
  if (kind === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
  if (kind === "tab") observer.prepareDebuggerReattach(source.tabId);
}
