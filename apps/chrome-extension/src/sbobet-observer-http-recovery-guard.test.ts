import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
const observers: NetworkObserver[] = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.releaseTab(source.tabId);
  vi.useRealTimers();
});

describe("SBOBET recovery with a progressing HTTP baseline", () => {
  it("publishes a verified isolated-world pair when no default context was observed", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ forward: async item => { forwarded.push(item); },
      sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: "provider-frame", loaderId: "provider-document", url: "https://api.sb21.net/sport" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 92 };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
          expect(params?.contextId).toBe(92);
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: ["live", "today"].map(timeRange => ({ timeRange,
              url: `https://api.sb21.net/api/v2/getEvent?timeRange=${timeRange}`, body: "[]" })) } } };
        }
        return {};
      } });
    observers.push(observer); await observer.refreshCatalog(source);
    expect(forwarded.filter(item => item.transport === "HTTP_RESPONSE")).toHaveLength(2);
  });
  it.each(["source", "bridge", "tab", "context", "document"].flatMap(kind =>
    ["http", "cdp"].map(failure => ({ kind, failure }))))(
    "does not share a Main $failure failure after $kind retirement", async ({ kind, failure }) => {
    vi.useFakeTimers();
    let observer!: NetworkObserver;
    let loaderId = "provider-document";
    const forward = vi.fn(async (_item: ChromeBridgeEnvelope) => undefined);
    observer = new NetworkObserver({ forward, now: () => 1_000,
      sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: "provider-frame", loaderId, url: "https://api.sb21.net/sport" } } };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
          if (kind === "source") observer.beginSourceEpoch(source.sourceId);
          if (kind === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
          if (kind === "tab") observer.releaseTab(source.tabId);
          if (kind === "context") await observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
          if (kind === "document") loaderId = "replacement-document";
          if (failure === "cdp") throw new Error("RETIRED_CDP_REQUEST");
          return { result: { value: { status: "request-failed", code: 403 } } };
        }
        return {};
      } });
    observers.push(observer);
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "provider-frame", isDefault: true } }
    });
    const work = observer.refreshCatalog(source);
    await vi.advanceTimersByTimeAsync(5_000); await work;
    expect(await observer.sbobetRequestsPaused()).toBe(false);
    expect(forward.mock.calls.filter(([item]) => item.transport === "HTTP_RESPONSE")).toEqual([]);
  });
  it.each(["valid", "malformed", "cutoff", "document", "bridge", "older"])(
    "requires a current matching published Main pair independently of Detail eligibility: %s", async kind => {
      let now = 1_000;
      const observer = new NetworkObserver({ now: () => now, forward: async () => undefined,
        sendCommand: async (_tab, method) => method === "Page.getFrameTree" ? { frameTree: {
          frame: { id: "frame-1", loaderId: "doc-1", url: "https://zenandfe.com/sport" },
          childFrames: [{ frame: { id: "frame-2", loaderId: "doc-2", url: "https://zenandfe.com/sport" } }]
        } } : {} });
      observers.push(observer);
      const part = (timeRange: "live" | "today", ordinal: number, cutoff = 0, document = 1, malformed = false) =>
        observer.ingestHttpResponse(source, `https://api.sb21.net/api/v2/getEvent?timeRange=${timeRange}`, "Fetch",
          malformed ? '[{"1":"League","2":[{"8":"123","2":"Home","3":"Away","7":null}]}]' : "[]", {
            method: "GET", streamId: `ksport-http:14:${ordinal}`,
            providerPartition: timeRange === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
            providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: cutoff,
            verifiedDocument: { frameId: `frame-${document}`, loaderId: `doc-${document}` }
          });
      await part("live", 2);
      if (kind === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
      await part("today", 2, kind === "cutoff" ? 1 : 0, kind === "document" ? 2 : 1, kind === "malformed");
      if (kind === "older") {
        expect(await observer.ensureCompleteKsportBaseline(source)).toBe(true);
        now = 80_000;
        await part("live", 1); await part("today", 1);
      }
      expect(await observer.ensureCompleteKsportBaseline(source)).toBe(kind === "valid");
    });

  it.each([false, true])("bounds rejected execution contexts while allowing a working context: allRefuse=%s", async allRefuse => {
    const requests: number[] = [];
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ forward: async item => { forwarded.push(item); },
      sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame-1", loaderId: "doc-1",
          url: "https://zenandfe.com/sport", childFrames: [] }, childFrames: [2,3,4,5].map(id => ({ frame: {
            id: `frame-${id}`, loaderId: `doc-${id}`, url: "https://zenandfe.com/sport" } })) } };
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
          requests.push(Number(params?.contextId));
          return { result: { value: allRefuse || requests.length === 1 ? { status: "request-failed", code: 400 }
            : { status: "catalog-requested", origin: "https://api.sb21.net", responses: ["live","today"].map(timeRange => ({
              timeRange, url: `https://api.sb21.net/api/v2/getEvent?timeRange=${timeRange}`, body: "[]" })) } } };
        }
        return {};
      } });
    observers.push(observer);
    for (const id of [1,2,3,4,5]) await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id, auxData: { frameId: `frame-${id}`, isDefault: true } } });
    await observer.refreshCatalog(source);
    expect(requests).toEqual(allRefuse ? [1,2,3] : [1,2]);
    expect(await observer.sbobetRequestsPaused()).toBe(allRefuse);
    expect(forwarded.filter(item => item.transport === "HTTP_RESPONSE")).toHaveLength(allRefuse ? 0 : 2);
  });
  it("stops provider retries and native fallback after the first actual HTTP refusal", async () => {
    let now = 1_000;
    const httpAttempts: number[] = [];
    const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "provider-frame", loaderId: "provider-document", url: "https://api.sb21.net/sport" } } };
      if (method === "Target.getTargets") return { targetInfos: [] };
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        httpAttempts.push(now);
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-failed", code: 503,
          retryAfterMs: 120_000 } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, now: () => now, forward: async () => undefined });
    observers.push(observer);
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "provider-frame", isDefault: true } }
    });
    await observer.maintainKsportFeed(source);
    now = 10_000; await observer.maintainKsportFeed(source);
    observer.beginBridgeSourceEpoch(source.sourceId);
    await observer.refreshCatalog(source);
    expect(httpAttempts).toEqual([1_000]);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("sport-menu-tab"))).toBe(false);
    now = 121_001; await observer.maintainKsportFeed(source);
    expect(httpAttempts).toEqual([1_000, 121_001]);
  });

  it("keeps native sockets and period tabs intact after successful pairs and cadence skips", async () => {
    let now = 1_000;
    const forwarded: ChromeBridgeEnvelope[] = [];
    const httpAttempts: number[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "provider-frame", loaderId: "provider-document", url: "https://api.sb21.net/sport" } } };
      if (method === "Target.getTargets") return { targetInfos: [] };
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        httpAttempts.push(now);
        return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
          responses: ["live", "today"].map(timeRange => ({ timeRange,
            url: `https://api.sb21.net/api/v2/getEvent?timeRange=${timeRange}`, body: "[]" })) } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("globalThis.WebSocket")) {
        return { result: { objectId: "native-socket-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "native-socket-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, now: () => now,
      forward: async envelope => { forwarded.push(envelope); } });
    observers.push(observer);
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "provider-frame", isDefault: true } }
    });

    for (const tickAtMs of [1_000, 2_000, 5_000, 6_000, 9_000]) {
      now = tickAtMs;
      await observer.maintainKsportFeed(source);
    }

    expect(httpAttempts).toEqual([1_000, 5_000, 9_000]);
    expect(forwarded.filter(envelope => envelope.transport === "HTTP_RESPONSE")).toHaveLength(6);
    expect(sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" && String(params?.functionDeclaration).includes("fieldline-baseline-recovery")))
      .toEqual([]);
    expect(sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab"))).toEqual([]);
  });
});
