import { setImmediate } from "node:timers";
import { runInNewContext } from "node:vm";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
const binding = { frameId: "football", loaderId: "document-1" };
const origin = "https://zenandfe.com";
const backend = "https://be.sb21.net";
const todayUrl = `${backend}/api/v2/getEvent?agentId=4&timeRange=today&sportType=1_1&sportId=1&oddsStyle=ma`;
const earlyUrl = todayUrl.replace("timeRange=today", "timeRange=early");
const wall = Date.UTC(2026, 8, 8, 12);
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const event = (id = "101", start = "2026-09-08T15:00:00Z") => ({ "8": Number(id), "0": start,
  "2": `Home ${id}`, "3": `Away ${id}`, "7": { "3": [`2.5 0.9*${id}301h -0.9*${id}302a ${id}3001`] } });
const league = (id = 481, events: unknown[] = [event()]) => ({ "0": id, "1": `League ${id}`, "2": events });
const earlyBody = [[league(482, [event("202", "2026-09-10T15:00:00Z")])]];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });

function harness() {
  let now = wall, loaderId = binding.loaderId, ordinal = 0, status = 200, network = true;
  let body: unknown = earlyBody;
  let responseUrl: ((url: string) => string) | undefined;
  let fetchGate: ReturnType<typeof deferred<void>> | undefined;
  let forwardGate: ReturnType<typeof deferred<void>> | undefined;
  let documentGate: ReturnType<typeof deferred<void>> | undefined;
  const bodies = new Map<string, string>();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const forwarded: ChromeBridgeEnvelope[] = [];
  let observer!: NetworkObserver;
  const receive = async (url: string, value: unknown, code = 200) => {
    const requestId = `receipt-${++ordinal}`;
    bodies.set(requestId, JSON.stringify(value));
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
      frameId: binding.frameId, loaderId, request: { url, method: "GET", headers: { lng: "vi" } } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
      response: { url: responseUrl?.(url) ?? url, status: code } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId });
  };
  const fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    const isEarly = new URL(url).searchParams.get("timeRange") === "early";
    const id = new URL(url).searchParams.get("eventId") ?? "101";
    const value = isEarly ? body : { "21": [`9.5 0.91*${id}211h -0.97*${id}212a ${id}2101`] };
    const requestId = `active-${++ordinal}`;
    bodies.set(requestId, JSON.stringify(value));
    if (network) await observer.handleEvent(source, "Network.requestWillBeSent", { requestId,
      type: "Fetch", frameId: binding.frameId, loaderId,
      request: { url, method: "GET", headers: init.headers ?? {} } });
    if (isEarly) await fetchGate?.promise;
    if (network) {
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
        response: { url: responseUrl?.(url) ?? url, status: isEarly ? status : 200 } });
      void observer.handleEvent(source, "Network.loadingFinished", { requestId });
    }
    return new Response(JSON.stringify(value), { status: isEarly ? status : 200, headers: { "retry-after": "2" } });
  };
  const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") {
      await documentGate?.promise;
      return { frameTree: { frame: { id: binding.frameId, loaderId, url: `${origin}/sport` } } };
    }
    if (method === "Network.getResponseBody") return { body: bodies.get(String(params?.requestId)), base64Encoded: false };
    if (method === "Runtime.evaluate" && String(params?.expression).includes("AbortController")) {
      const value = await runInNewContext(String(params?.expression), {
        location: { origin }, fetch, AbortController, setTimeout, clearTimeout, URL, Date, TextEncoder, TextDecoder
      });
      return { result: { value: JSON.parse(JSON.stringify(value)) as unknown } };
    }
    return {};
  });
  const scheduler = new ProviderWorkScheduler({ maxConcurrent: 1 });
  const held = deferred<void>();
  const holding = scheduler.run(source.sourceId, () => held.promise);
  observer = new NetworkObserver({ sendCommand, forward: async envelope => {
    forwarded.push(envelope);
    if (envelope.request.streamId?.startsWith("sbobet-early:")) await forwardGate?.promise;
  }, now: () => now, monotonicNow: () => now - wall + 1000,
  observerSessionId: "observer-early", workScheduler: scheduler });
  const epoch = observer.beginBridgeSourceEpoch(source.sourceId);
  const maintenance: Promise<void>[] = [];
  cleanups.push(async () => {
    observer.releaseTab(source.tabId); fetchGate?.resolve(); forwardGate?.resolve(); documentGate?.resolve();
    scheduler.clear(source.sourceId); held.resolve(); await holding;
    await Promise.all(maintenance); await flush(); await flush();
  });
  const context = () => observer.handleEvent(source, "Runtime.executionContextCreated", {
    context: { id: 91, auxData: { frameId: binding.frameId, isDefault: true } }
  });
  const pair = async (today: unknown[] = [league()], live: unknown[] = [], pairOrdinal = 1) => {
    for (const [part, value] of [["live", live], ["today", today]] as const) {
      await observer.ingestHttpResponse(source, todayUrl.replace("timeRange=today", `timeRange=${part}`),
        "Fetch", JSON.stringify(value), { method: "GET", streamId: `ksport-http:7:${pairOrdinal}`,
          providerPartition: part === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
          providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: 0,
          verifiedDocument: { frameId: binding.frameId, loaderId } });
    }
  };
  const template = async (code = 200, url = todayUrl) => {
    const requestId = `main-${++ordinal}`;
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
      frameId: binding.frameId, loaderId,
      request: { url, method: "GET", headers: { Authorization: "private-sentinel", lng: "vi" } } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch", response: { url, status: code } });
  };
  const tick = async () => { maintenance.push(observer.maintainKsportFeed(source).catch(() => undefined)); await flush(); await flush(); };
  return { observer, epoch, context, pair, template, tick, receive, requests, forwarded, sendCommand,
    early: () => forwarded.filter(x => x.request.streamId?.startsWith("sbobet-early:")),
    activeEarly: () => requests.filter(x => new URL(x.url).searchParams.get("timeRange") === "early"),
    moreIds: () => requests.filter(x => new URL(x.url).pathname.endsWith("getEventBetMore"))
      .map(x => new URL(x.url).searchParams.get("eventId")),
    setNow: (v: number) => { now = v; }, setStatus: (v: number) => { status = v; },
    setBody: (v: unknown) => { body = v; }, setNetwork: (v: boolean) => { network = v; },
    setLoader: (v: string) => { loaderId = v; },
    mismatchResponse: () => { responseUrl = url => url.replace("agentId=4", "agentId=99"); },
    holdFetch: () => { fetchGate = deferred<void>(); return fetchGate; },
    holdForward: () => { forwardGate = deferred<void>(); return forwardGate; },
    holdDocument: () => { documentGate = deferred<void>(); return documentGate; }
  };
}

describe("SBOBET All Dates observer lane", () => {
  it("uses the successful bound main template and publishes only the actual Early receipt", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.early()).toHaveLength(1));
    expect(h.activeEarly()).toHaveLength(1);
    expect(h.activeEarly()[0]).toMatchObject({ url: earlyUrl,
      init: { method: "GET", credentials: "include", redirect: "error",
        headers: { Authorization: "private-sentinel", lng: "vi" } } });
    const envelope = h.early()[0]!;
    expect(envelope.sourceEpoch).toBe(h.epoch);
    expect(envelope.request).toMatchObject({ method: "GET", requestFrameKey: expect.any(String),
      requestDocumentKey: expect.any(String), reconcileCutoffSequence: expect.any(Number) });
    expect(envelope.request.providerPartition).toBeUndefined();
    expect(JSON.parse(envelope.payload.body)).toEqual({ kind: "SBOBET_EARLY_CATALOG", generation: h.epoch,
      requestStartSequence: envelope.request.reconcileCutoffSequence, observedAtMs: wall,
      rosterComplete: true, body: earlyBody });
    expect(envelope.observedAtMs).toBe(wall);
    expect(JSON.stringify(envelope)).not.toContain("private-sentinel");
  });

  it.each(["missing", "failed", "unpaired"])("does not actively fetch from %s authority", async kind => {
    const h = harness(); await h.context();
    if (kind !== "missing") await h.template(kind === "failed" ? 400 : 200);
    if (kind !== "unpaired") await h.pair();
    await h.tick(); expect(h.activeEarly()).toHaveLength(0);
  });

  it("keeps Early owners through Today refresh and excludes every current Live owner from More", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.early()).toHaveLength(1));
    h.setNow(wall + 500); await h.tick();
    await vi.waitFor(() => expect(h.moreIds()).toContain("202"));
    await h.pair([league(481, [event("303")])], [league(482, [event("202")])], 2);
    h.setNow(wall + 31_000); await h.tick(); await flush();
    expect(h.moreIds().filter(id => id === "202")).toHaveLength(1);
    expect(h.moreIds()).toContain("303");
  });

  it("retains Early membership when ordinary Today snapshots omit it", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.early()).toHaveLength(1));
    await h.pair([], [], 2); h.setNow(wall + 500); await h.tick();
    await vi.waitFor(() => expect(h.moreIds()).toContain("202"));
  });

  it.each(["bridge", "context", "document"])("rejects the pending Early receipt after %s retirement", async kind => {
    const h = harness(); await h.context(); await h.template(); await h.pair();
    const held = h.holdFetch(); await h.tick();
    await vi.waitFor(() => expect(h.activeEarly()).toHaveLength(1));
    if (kind === "bridge") h.observer.beginBridgeSourceEpoch(source.sourceId);
    if (kind === "context") await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
    if (kind === "document") h.setLoader("document-2");
    held.resolve(); await flush(); await flush(); expect(h.early()).toHaveLength(0);
  });

  it("paces successful All snapshots at 120 seconds independently of the held DOM scheduler", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.early()).toHaveLength(1)); await flush();
    h.setNow(wall + 119_999); await h.tick(); expect(h.activeEarly()).toHaveLength(1);
    h.setNow(wall + 120_001); await h.tick();
    await vi.waitFor(() => expect(h.early()).toHaveLength(2));
  });

  it("does not publish a Runtime-only response without its real Network receipt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness(); await h.context(); await h.template(); await h.pair(); h.setNetwork(false); await h.tick();
    expect(h.activeEarly()).toHaveLength(1); expect(h.early()).toHaveLength(0);
    h.setNow(wall + 8001); await vi.advanceTimersByTimeAsync(8001); await flush();
    h.setNetwork(true); await h.tick(); expect(h.activeEarly()).toHaveLength(1);
    h.setNow(wall + 11_001); await h.tick(); await flush();
    expect(h.early()).toHaveLength(1);
  });

  it("retains physical capacity across cancellation while an uncooperative CDP call is pending", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair();
    const held = h.holdFetch(); await h.tick();
    await vi.waitFor(() => expect(h.activeEarly()).toHaveLength(1));
    h.observer.beginBridgeSourceEpoch(source.sourceId); await h.template(); await h.pair();
    h.setNow(wall + 130_000); await h.tick(); expect(h.activeEarly()).toHaveLength(1);
    held.resolve(); await flush(); await flush(); await h.tick();
    await vi.waitFor(() => expect(h.activeEarly()).toHaveLength(2));
  });

  it("backs off after HTTP 429 and retries an actual successful receipt", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair(); h.setStatus(429); await h.tick();
    await flush(); expect(h.activeEarly()).toHaveLength(1); expect(h.early()).toHaveLength(0);
    h.setStatus(200); h.setNow(wall + 1000); await h.tick(); expect(h.activeEarly()).toHaveLength(1);
    h.setNow(wall + 5000); await h.tick();
    await vi.waitFor(() => expect(h.early()).toHaveLength(1));
  });

  it("rejects redirected or malformed native bodies without updating More membership", async () => {
    const h = harness(); await h.context(); await h.template(); await h.pair();
    h.setBody({ error: "not a roster" }); await h.tick(); await flush();
    expect(h.early()).toHaveLength(0); expect(h.moreIds()).not.toContain("202");
    h.setNow(wall + 5000); h.setBody(earlyBody); h.mismatchResponse(); await h.tick(); await flush();
    expect(h.early()).toHaveLength(0);
  });

  it("keeps genuine receipt clocks while document verification waits", async () => {
    const h = harness(); await h.context(); await h.pair();
    const held = h.holdDocument();
    const receipt = h.receive(earlyUrl, earlyBody);
    await flush(); h.setNow(wall + 5000); held.resolve(); await receipt;
    expect(h.early()).toHaveLength(1);
    expect(h.early()[0]!.observedAtMs).toBe(wall);
    expect(JSON.parse(h.early()[0]!.payload.body).observedAtMs).toBe(wall);
  });

  it("chunks full native wrappers without truncating unknown market groups", async () => {
    const h = harness(); await h.context(); await h.pair();
    const captured = [[league(482, [{ ...event("202", "2026-09-10T15:00:00Z"),
      "7": { "999": Array.from({ length: 4500 }, () => "0 1.9*202999001h 1.91*202999001a 20299901") } }])]];
    await h.receive(earlyUrl, captured);
    expect(h.early().length).toBeGreaterThan(1);
    const chunks = h.early().map(x => JSON.parse(x.payload.body)).sort((a, b) => a.chunkIndex - b.chunkIndex);
    expect(chunks.every(x => x.chunkCount === chunks.length)).toBe(true);
    expect(JSON.parse(chunks.map(x => x.bodyFragment).join("")).body).toEqual(captured);
    expect(new Set(h.early().map(x => x.request.streamId)).size).toBe(1);
  });

  it("withdraws omitted Early owners only on a complete empty Early receipt, keeping Today", async () => {
    const h = harness(); await h.context(); await h.pair();
    await h.receive(earlyUrl, earlyBody); await h.tick();
    h.setNow(wall + 500); await h.tick();
    await vi.waitFor(() => expect(h.moreIds()).toContain("202"));
    await h.receive(earlyUrl, [[]]); h.setNow(wall + 1000); await h.tick();
    await vi.waitFor(() => expect(h.moreIds()).toContain("101"));
    h.setNow(wall + 31_000); await h.tick();
    expect(h.moreIds().filter(id => id === "202")).toHaveLength(1);
    expect(JSON.parse(h.early().at(-1)!.payload.body)).toMatchObject({ rosterComplete: true, body: [[]] });
  });

  it("cannot forward queued chunks after the original context is retired", async () => {
    const h = harness(); await h.context(); await h.pair();
    const held = h.holdForward();
    const captured = [[league(482, [{ ...event("202", "2026-09-10T15:00:00Z"),
      "7": { "999": Array.from({ length: 4500 }, () => "0 1.9*202999001h 1.91*202999001a 20299901") } }])]];
    const receipt = h.receive(earlyUrl, captured);
    await vi.waitFor(() => expect(h.early()).toHaveLength(1));
    await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
    held.resolve(); await receipt;
    expect(h.early()).toHaveLength(1);
  });
});
