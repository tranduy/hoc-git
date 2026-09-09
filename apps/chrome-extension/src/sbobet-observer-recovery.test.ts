import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";
import { SbobetRequestBackoff } from "./sbobet-request-backoff.js";

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
  it.each([400, 404])("does not renew an expired HTTP %s pause without a new native response", async status => {
    vi.useFakeTimers();
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now });
    backoff.fail(status);
    const selections: number[] = [];
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ now: () => now, sbobetRequestBackoff: backoff, forward,
      sendCommand: async (_tab, method, params) => {
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          selections.push(now);
          return { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      } });
    observers.push(observer); await registerContext(observer);
    const tick = async (atMs: number) => {
      now = atMs; const work = observer.refreshCatalog(source);
      await vi.advanceTimersByTimeAsync(5_000); await work;
    };
    await tick(31_001);
    expect(backoff.paused()).toBe(false);
    expect(backoff.lastStatus()).toBe(status);
    expect(selections).toEqual([31_001, 31_001]);
    await tick(32_001);
    expect(selections).toEqual([31_001, 31_001]);
    await tick(39_001);
    expect(selections).toEqual([31_001, 31_001, 39_001, 39_001]);
    expect(forward.mock.calls.filter(([item]) => item.transport === "HTTP_RESPONSE")).toEqual([]);
    expect(backoff.paused()).toBe(false);
  });
  it.each(["complete", "complete-404", "missing-selector-ack", "detail-ineligible", "source", "bridge", "tab"] as const)(
    "waits for both native partitions before completing a delayed 400 retry: %s", async outcome => {
    vi.useFakeTimers();
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now });
    backoff.fail(outcome === "complete-404" ? 404 : 400); now = 31_001;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let publication: Promise<void> | undefined;
    let heldToday = false;
    let observer!: NetworkObserver;
    const nativePair = async () => {
      for (const timeRange of ["live", "today"] as const) {
        const url = `${origin}/api/v2/getEvent?timeRange=${timeRange}`;
        await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: timeRange, type: "Fetch",
          ...documentBinding, request: { url, method: "GET" } });
        await observer.handleEvent(source, "Network.responseReceived", { requestId: timeRange, type: "Fetch",
          response: { url, status: 200 } });
        await observer.handleEvent(source, "Network.loadingFinished", { requestId: timeRange });
      }
    };
    observer = new NetworkObserver({ now: () => now, sbobetRequestBackoff: backoff,
      forward: async envelope => {
        if (envelope.transport === "HTTP_RESPONSE" && envelope.request.providerPartition === "KSPORT_TODAY") {
          heldToday = true; await held;
        }
      }, sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: documentBinding.frameId, loaderId: documentBinding.loaderId, url: `${origin}/sport` } } };
        if (method === "Network.getResponseBody") return { body: outcome === "detail-ineligible" && params?.requestId === "today"
          ? JSON.stringify([{ "1": "League", "2": [{ "0": "2026-09-09T12:00:00", "2": "Home", "3": "Away", "8": "12345", "7": {} }] }])
          : "[]", base64Encoded: false };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          publication ??= nativePair();
          return outcome === "missing-selector-ack" ? {} : { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      } });
    observers.push(observer); await registerContext(observer);
    let settled = false;
    const work = observer.refreshCatalog(source).then(() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(heldToday).toBe(true);
      expect(settled).toBe(false);
      expect(backoff.paused()).toBe(false);
      if (outcome === "source" || outcome === "bridge" || outcome === "tab") retire(observer, outcome);
    } finally { release(); await publication; await vi.advanceTimersByTimeAsync(1_000); await work; }
    expect(backoff.lastStatus()).toBe(outcome === "source" || outcome === "bridge" || outcome === "tab" ? 400 : 0);
    expect(backoff.paused()).toBe(false);
  });
  it.each(["document", "worker", "retired-worker"])(
    "retains exact %s ownership for a native refusal arriving after the recovery wait", async surface => {
    vi.useFakeTimers();
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now }); backoff.fail(400); now = 31_001;
    const url = `${origin}/api/v2/getEvent?timeRange=today`;
    let observer!: NetworkObserver;
    observer = new NetworkObserver({ now: () => now, sbobetRequestBackoff: backoff,
      forward: async () => undefined, sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: documentBinding.frameId, loaderId: documentBinding.loaderId } } };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "late-native",
            type: "Fetch", ...(surface === "document" ? documentBinding : {}),
            request: { url, method: "GET", headers: {} } }, surface === "document" ? undefined : "native-worker-session");
          return { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      } });
    observers.push(observer); await registerContext(observer);
    if (surface !== "document") await observer.handleEvent(source, "Target.attachedToTarget", {
      sessionId: "native-worker-session", targetInfo: { type: "worker", targetId: "native-worker", url: `${origin}/worker.js` }
    });
    const work = observer.refreshCatalog(source); await vi.advanceTimersByTimeAsync(5_000); await work;
    if (surface === "retired-worker") await observer.handleEvent(source, "Target.detachedFromTarget", {
      sessionId: "native-worker-session"
    });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "late-native",
      type: "Fetch", response: { url, status: 403 } }, surface === "document" ? undefined : "native-worker-session");
    expect(backoff.lastStatus()).toBe(surface === "retired-worker" ? 400 : 403);
    expect(backoff.retryInMs()).toBe(surface === "retired-worker" ? 0 : 900_000);
  });
  it("does not share a native refusal from a replaced document after the recovery wait", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    let loaderId = documentBinding.loaderId;
    const backoff = new SbobetRequestBackoff({ now: () => now }); backoff.fail(400); now = 31_001;
    const url = `${origin}/api/v2/getEvent?timeRange=today`;
    let requested = false;
    let observer!: NetworkObserver;
    observer = new NetworkObserver({ now: () => now, sbobetRequestBackoff: backoff,
      forward: async () => undefined, sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: documentBinding.frameId, loaderId } } };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          if (!requested) {
            requested = true;
            await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "retired-native",
              type: "Fetch", ...documentBinding, request: { url, method: "GET" } });
          }
          return { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      } });
    observers.push(observer); await registerContext(observer);
    const work = observer.refreshCatalog(source); await vi.advanceTimersByTimeAsync(5_000); await work;
    expect(requested).toBe(true);
    loaderId = "replacement-document";
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "retired-native",
      type: "Fetch", response: { url, status: 403 } });
    expect(backoff.paused()).toBe(false);
    expect(backoff.lastStatus()).toBe(400);
  });
  it.each([[403, 900_000], [429, 600_000], [503, 60_000]])("honors native HTTP %s during delayed template recovery", async (status, delay) => {
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now }); backoff.fail(400); now = 31_001;
    let selections = 0;
    let observer!: NetworkObserver;
    observer = new NetworkObserver({ now: () => now, sbobetRequestBackoff: backoff,
      forward: async () => undefined, sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: documentBinding.frameId, loaderId: documentBinding.loaderId } } };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          selections++;
          const url = `${origin}/api/v2/getEvent?timeRange=today`;
          await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "native-refused",
            type: "Fetch", ...documentBinding, request: { url, method: "GET", headers: {} } });
          await observer.handleEvent(source, "Network.responseReceived", { requestId: "native-refused",
            type: "Fetch", response: { url, status, headers: status === 429 ? { "Retry-After": "600" } : {} } });
          return { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      } });
    observers.push(observer); await registerContext(observer); await observer.refreshCatalog(source);
    expect(selections).toBe(1); expect(backoff.lastStatus()).toBe(status); expect(backoff.retryInMs()).toBe(delay);
  });
  it.each(["source", "bridge", "tab"] as const)("does not turn %s retirement during a delayed 400 retry into another refusal", async kind => {
    let now = 1_000;
    const backoff = new SbobetRequestBackoff({ now: () => now });
    backoff.fail(400); now = 31_001;
    let selections = 0;
    let observer!: NetworkObserver;
    observer = new NetworkObserver({ now: () => now, sbobetRequestBackoff: backoff,
      forward: async () => undefined, sendCommand: async (_tab, method, params) => {
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          selections++; retire(observer, kind);
          return { result: { value: { status: "time-tab-selected" } } };
        }
        return {};
      } });
    observers.push(observer); await registerContext(observer);
    await observer.refreshCatalog(source);
    expect(selections).toBe(1);
    expect(backoff.paused()).toBe(false);
  });
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

  it("reacquires an expired native template once after the HTTP 400 cooldown expires", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    let expired = false;
    let nativeResponds = true;
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
        if (nativeResponds && nativeSelections.length % 2 === 1) await nativePair();
        return { result: { value: { status: "time-tab-selected" } } };
      }
      return {};
    });
    observer = new NetworkObserver({ sendCommand, now: () => now, monotonicNow: () => now,
      forward: async (envelope) => { forwarded.push(envelope); } });
    observers.push(observer);
    await registerContext(observer);
    const tick = async (atMs: number, durationMs = 1_000) => {
      now = atMs;
      const work = observer.maintainKsportFeed(source);
      await vi.advanceTimersByTimeAsync(durationMs);
      await work;
    };
    const receipts = () => forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");

    await tick(1_000);
    expect(receipts()).toHaveLength(2);
    await tick(2_000);
    expect(nativeSelections).toEqual([]);
    expired = true;
    await tick(5_000);
    expect(nativeSelections).toEqual([]);
    expect(receipts().map((envelope) => envelope.request.streamId)).toEqual([
      "ksport-http:14:1", "ksport-http:14:1"
    ]);
    await tick(9_000);
    await tick(13_000);
    expect(nativeSelections).toEqual([]);
    expect(httpAttempts).toEqual([1_000, 5_000]);
    expired = false;
    await tick(35_001);
    expect(httpAttempts).toEqual([1_000, 5_000]);
    expect(nativeSelections).toEqual([35_001, 35_001]);
    expect(await observer.sbobetRequestsPaused()).toBe(false);
    expect(receipts().slice(-2).map((envelope) => envelope.request)).toEqual([
      expect.objectContaining({ streamId: "ksport-http:14:2", providerPartition: "KSPORT_LIVE",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestFrameKey: expect.any(String),
        requestDocumentKey: expect.any(String) }),
      expect.objectContaining({ streamId: "ksport-http:14:2", providerPartition: "KSPORT_TODAY",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestFrameKey: expect.any(String),
        requestDocumentKey: expect.any(String) })
    ]);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload" || method === "Page.navigate")).toBe(false);
    expired = true;
    await tick(45_001);
    nativeResponds = false;
    await tick(75_002, 5_000);
    expect(await observer.sbobetRequestsPaused()).toBe(false);
    const attempted = nativeSelections.length;
    await tick(76_000);
    expect(nativeSelections).toHaveLength(attempted);
    await tick(83_002, 5_000);
    expect(nativeSelections).toHaveLength(attempted + 2);
    expect(receipts()).toHaveLength(4);
    expect(httpAttempts).toEqual([1_000, 5_000, 45_001]);
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
            return { result: { value: { status: "fieldline-ksport-catalog-template-missing" } } };
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
