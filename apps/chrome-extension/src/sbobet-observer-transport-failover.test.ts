import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
const documentBinding = { frameId: "provider-frame", loaderId: "provider-document" };
const origin = "https://be.sb21.net";
const observers: NetworkObserver[] = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.releaseTab(source.tabId);
  vi.useRealTimers();
});

async function harness(nativeStatus: number | null = 200, failingMore = false, failedCdp = false) {
  vi.useFakeTimers();
  let now = 1_000;
  let observer!: NetworkObserver;
  const httpAttempts: number[] = [];
  const nativeSelections: number[] = [];
  const moreAttempts: number[] = [];
  let publishNative = true;
  const forwarded: ChromeBridgeEnvelope[] = [];
  const nativePair = async () => {
    if (nativeStatus === null || !publishNative) return;
    for (const timeRange of ["live", "today"] as const) {
      const requestId = `native-${timeRange}-${now}`;
      const url = `${origin}/api/v2/getEvent?timeRange=${timeRange}`;
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
        ...documentBinding, request: { method: "GET", url } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
        response: { url, status: nativeStatus, headers: { "Retry-After": "120" } } });
      await observer.handleEvent(source, "Network.loadingFinished", { requestId });
      if (nativeStatus !== 200) return;
    }
  };
  observer = new NetworkObserver({ now: () => now, monotonicNow: () => now,
    forward: async envelope => { forwarded.push(envelope); },
    sendCommand: async (_tab, method, params) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: documentBinding.frameId, loaderId: documentBinding.loaderId, url: `${origin}/sport` } } };
      if (method === "Target.getTargets") return { targetInfos: [] };
      if (method === "Network.getResponseBody") return {
        body: failingMore && String(params?.requestId).includes("today") ? JSON.stringify([
          { "0": 481, "1": "League", "2": [{ "8": "101", "0": "2026-09-09T15:00:00Z",
            "2": "Home", "3": "Away", "7": { "3": ["2.5 0.9*101301h -0.9*101302a 1013001"] } }] }
        ]) : "[]", base64Encoded: false };
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("getEventBetMore")) {
        moreAttempts.push(now);
        return { result: { value: { status: 200, body: '{"error":["not a market"]}' } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        httpAttempts.push(now);
        if (failedCdp) throw new Error("CDP_REQUEST_FAILED");
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-failed", code: 0 } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("sport-menu-tab")) {
        nativeSelections.push(now);
        if (nativeSelections.length % 2 === 1) await nativePair();
        return { result: { value: { status: "time-tab-selected" } } };
      }
      return {};
    }
  });
  observers.push(observer);
  await observer.handleEvent(source, "Runtime.executionContextCreated", { context: {
    id: 91, auxData: { frameId: documentBinding.frameId, isDefault: true } } });
  return { observer, httpAttempts, nativeSelections, moreAttempts,
    stopNative: () => { publishNative = false; },
    receipts: () => forwarded.filter(item => item.transport === "HTTP_RESPONSE"),
    tick: async (atMs: number) => {
      now = atMs;
      const work = observer.maintainKsportFeed(source);
      await vi.advanceTimersByTimeAsync(5_000);
      await work;
    }
  };
}

describe("SBOBET local fetch failure uses bounded native refresh", () => {
  it("keeps a failed Main CDP command local while actual native pairs continue", async () => {
    const h = await harness(200, false, true);
    for (const atMs of [1_000, 9_000, 17_000]) await h.tick(atMs);
    expect(await h.observer.sbobetRequestsPaused()).toBe(false);
    expect(h.httpAttempts).toEqual([1_000]);
    expect(h.receipts()).toHaveLength(6);
  });
  it("keeps the working native route beyond the failed replay cooldown", async () => {
    const h = await harness();
    await h.tick(1_000);
    expect(h.receipts()).toHaveLength(2);
    expect(await h.observer.sbobetRequestsPaused()).toBe(false);
    await h.tick(5_000);
    expect(h.receipts()).toHaveLength(2);
    for (const atMs of [9_000, 17_000, 25_000, 33_000]) await h.tick(atMs);
    expect(h.httpAttempts).toEqual([1_000]);
    expect(h.receipts().map(item => item.observedAtMs)).toEqual([
      1_000, 1_000, 9_000, 9_000, 17_000, 17_000, 25_000, 25_000, 33_000, 33_000
    ]);
    expect(h.receipts().map(item => item.request.streamId)).toEqual(
      [1, 2, 3, 4, 5].flatMap(id => [`ksport-http:14:${id}`, `ksport-http:14:${id}`]));
    expect(h.receipts().map(item => item.request.providerPartition)).toEqual(
      Array.from({ length: 5 }, () => ["KSPORT_LIVE", "KSPORT_TODAY"]).flat());
  });

  it("does not publish or advance evidence when native requests produce no bodies", async () => {
    const h = await harness(null);
    for (const atMs of [1_000, 9_000, 17_000]) await h.tick(atMs);
    expect(h.httpAttempts).toEqual([1_000]);
    expect(h.nativeSelections).toEqual([1_000, 1_000, 9_000, 9_000, 17_000, 17_000]);
    expect(h.receipts()).toEqual([]);
    expect(await h.observer.ensureCompleteKsportBaseline(source)).toBe(false);
  });

  it("retries the replay route after native publication stops and the cooldown has elapsed", async () => {
    const h = await harness();
    await h.tick(1_000);
    h.stopNative();
    await h.tick(9_000);
    expect(h.httpAttempts).toEqual([1_000]);
    await h.tick(33_000);
    expect(h.httpAttempts).toEqual([1_000, 33_000]);
    expect(h.receipts()).toHaveLength(2);
  });

  it.each([403, 429, 503])("keeps shared provider backoff when the native route returns HTTP %s", async status => {
    const h = await harness(status);
    await h.tick(1_000);
    expect(h.nativeSelections).toEqual([1_000]);
    expect(await h.observer.sbobetRequestsPaused()).toBe(true);
    await h.tick(17_000);
    expect(h.httpAttempts).toEqual([1_000]);
    expect(h.nativeSelections).toEqual([1_000]);
    expect(h.receipts()).toEqual([]);
  });

  it("does not transfer the failed replay route cooldown to a replacement bridge epoch", async () => {
    const h = await harness();
    await h.tick(1_000);
    expect(h.receipts()).toHaveLength(2);
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    await h.tick(9_000);
    expect(h.httpAttempts).toEqual([1_000, 9_000]);
    expect(h.receipts()).toHaveLength(4);
  });

  it("continues complete native Main refresh while independent More responses are invalid", async () => {
    const h = await harness(200, true);
    for (const atMs of [1_000, 9_000, 17_000, 25_000, 33_000]) await h.tick(atMs);
    expect(h.moreAttempts.length).toBeGreaterThan(0);
    expect(await h.observer.sbobetRequestsPaused()).toBe(false);
    expect(h.receipts()).toHaveLength(10);
    expect(h.receipts().map(item => item.request.streamId)).toEqual(
      [1, 2, 3, 4, 5].flatMap(id => [`ksport-http:14:${id}`, `ksport-http:14:${id}`]));
    expect(h.receipts().filter(item => item.request.providerPartition === "KSPORT_TODAY")
      .every(item => item.payload.body.includes('"101"'))).toBe(true);
  });
});
