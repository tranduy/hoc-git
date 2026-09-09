import { setImmediate } from "node:timers";
import { runInNewContext } from "node:vm";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";
import { sbobetMoreBatchFromResponse } from "./sbobet-more-protocol.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
const binding = { frameId: "football", loaderId: "document-1" };
const backend = "https://be.sb21.net";
const origin = "https://zenandfe.com";
const wall = Date.UTC(2026, 8, 8, 12);
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const event = (id = "101", home = `Home ${id}`) => ({ "8": id, "0": "2026-09-08T15:00:00Z",
  "2": home, "3": `Away ${id}`, "7": { "3": [`2.5 0.9*${id}301h -0.9*${id}302a ${id}3001`] } });
const league = (id = 481, events: unknown[] = [event()]) => ({ "0": id, "1": `League ${id}`, "2": events });
const groups = (id = "101", price = "0.91") => ({ "0": ["2,3,4"], "21": [
  `9.5 ${price}*${id}211h -0.97*${id}212a ${id}2101`
] });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); });

function harness() {
  let now = wall;
  let loaderId = binding.loaderId;
  let frameId = binding.frameId;
  let secondDocument = false;
  let price = "0.91";
  let network = true;
  let responseUrl: ((url: string) => string) | undefined;
  let fetchGate: ReturnType<typeof deferred<void>> | undefined;
  let forwardGate: ReturnType<typeof deferred<void>> | undefined;
  let status = 200;
  let requestOrdinal = 0;
  const bodies = new Map<string, string>();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const forwarded: ChromeBridgeEnvelope[] = [];
  let observer!: NetworkObserver;
  const fetch = async (url: string, init: RequestInit, fetchBinding = { frameId, loaderId }) => {
    requests.push({ url, init });
    const requestId = `more-${++requestOrdinal}`;
    const id = new URL(url).searchParams.get("eventId")!;
    const body = JSON.stringify(groups(id, price));
    bodies.set(requestId, body);
    if (network) await observer.handleEvent(source, "Network.requestWillBeSent", { requestId,
      type: "Fetch", ...fetchBinding,
      request: { url, method: "GET", headers: {} } });
    await fetchGate?.promise;
    if (network) {
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
        response: { url: responseUrl?.(url) ?? url, status } });
      // CDP may complete independently of the page's response.text().
      void observer.handleEvent(source, "Network.loadingFinished", { requestId });
    }
    return { status, headers: { get: (name: string) => name === "retry-after" ? "2" : null },
      text: async () => body };
  };
  const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: binding.frameId,
      loaderId: secondDocument ? binding.loaderId : loaderId, url: `${origin}/sport` },
      ...(secondDocument ? { childFrames: [{ frame: { id: "football-b", loaderId: "document-b", url: `${origin}/sport` } }] } : {}) } };
    if (method === "Network.getResponseBody") return { body: bodies.get(String(params?.requestId)), base64Encoded: false };
    if (method === "Runtime.evaluate" && String(params?.expression).includes("AbortController")) {
      const value = await runInNewContext(String(params?.expression), {
        location: { origin }, fetch: (url: string, init: RequestInit) => fetch(url, init,
          params?.contextId === 92 ? { frameId: "football-b", loaderId: "document-b" }
            : { frameId: binding.frameId, loaderId: secondDocument ? binding.loaderId : loaderId }),
        AbortController, setTimeout, clearTimeout, URL
      });
      return { result: { value: JSON.parse(JSON.stringify(value)) as unknown } };
    }
    return {};
  });
  const scheduler = new ProviderWorkScheduler({ maxConcurrent: 1 });
  const held = deferred<void>();
  const holding = scheduler.run(source.sourceId, () => held.promise);
  observer = new NetworkObserver({ sendCommand, forward: async item => {
    forwarded.push(item);
    if (item.request.streamId?.startsWith("sbobet-more:")) await forwardGate?.promise;
  }, now: () => now, monotonicNow: () => now - wall + 1000,
  observerSessionId: "observer-more-refresh", workScheduler: scheduler });
  const epoch = observer.beginBridgeSourceEpoch(source.sourceId);
  const pendingMaintenance: Promise<void>[] = [];
  cleanups.push(async () => {
    observer.releaseTab(source.tabId); fetchGate?.resolve(); forwardGate?.resolve();
    scheduler.clear(source.sourceId); held.resolve(); await holding;
    await Promise.all(pendingMaintenance); await flush();
  });
  const context = () => observer.handleEvent(source, "Runtime.executionContextCreated", {
    context: { id: 91, auxData: { frameId: binding.frameId, isDefault: true } }
  });
  const partition = (part: "live" | "today", roster: unknown[], ordinal = 1,
    cutoff = 0, host = backend) => observer.ingestHttpResponse(source,
    `${host}/api/v2/getEvent?timeRange=${part}`, "Fetch", JSON.stringify(roster), {
      method: "GET", streamId: `ksport-http:7:${ordinal}`,
      providerPartition: part === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
      providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: cutoff,
      verifiedDocument: { frameId, loaderId }
    });
  const pair = async (today = [league()], live: ReturnType<typeof league>[] = [], ordinal = 1, cutoff = 0, host = backend) => {
    await partition("live", live, ordinal, cutoff, host); await partition("today", today, ordinal, cutoff, host);
  };
  const tick = async () => {
    pendingMaintenance.push(observer.maintainKsportFeed(source).catch(() => undefined)); await flush();
  };
  const more = () => forwarded.filter(item => item.request.streamId?.startsWith("sbobet-more:"));
  return { observer, epoch, context, pair, partition, tick, requests, more, forwarded, sendCommand,
    secondContext: async () => {
      secondDocument = true; frameId = "football-b"; loaderId = "document-b";
      await observer.handleEvent(source, "Runtime.executionContextCreated", {
        context: { id: 92, auxData: { frameId, isDefault: true } }
      });
    },
    setNow: (value: number) => { now = value; }, setPrice: (value: string) => { price = value; },
    setNetwork: (value: boolean) => { network = value; }, setStatus: (value: number) => { status = value; },
    setLoader: (value: string) => { loaderId = value; },
    mismatchResponse: () => { responseUrl = url => url.replace("leagueId=481", "leagueId=999"); },
    holdFetch: () => { fetchGate = deferred<void>(); return fetchGate; },
    holdForward: () => { forwardGate = deferred<void>(); return forwardGate; }
  };
}

describe("active More via the observed HTTP publication path", () => {
  it.each(["transport", "malformed"])("keeps a %s More failure from pausing main refresh", async kind => {
    const h = harness(); await h.context(); await h.pair();
    if (kind === "transport") h.setStatus(0);
    else h.setPrice("invalid");
    await h.tick(); await flush(); await flush();
    expect(h.requests).toHaveLength(1);
    expect(h.more()).toHaveLength(0);
    expect(await h.observer.sbobetRequestsPaused()).toBe(false);
    h.setNow(wall + 1_999); await h.tick(); expect(h.requests).toHaveLength(1);
    h.setNow(wall + 2_001); await h.tick(); await flush(); expect(h.requests).toHaveLength(2);
  });
  it("bootstraps the exact backend from a bound main pair and emits exactly one actual More receipt", async () => {
    const h = harness(); await h.context(); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1), { timeout: 1000 });
    expect(h.requests).toHaveLength(1);
    expect(new URL(h.requests[0]!.url).origin).toBe(backend);
    expect(new URL(h.requests[0]!.url).pathname).toBe("/api/v2/getEventBetMore");
    expect(h.requests[0]!.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
    expect(h.requests[0]!.init.headers).toBeUndefined();
    expect(JSON.parse(h.more()[0]!.payload.body)).toMatchObject({ kind: "SBOBET_EVENT_MORE",
      eventId: "101", leagueId: "481", marketContainerComplete: false, generation: h.epoch });
    await flush(); await h.tick(); expect(h.requests).toHaveLength(1);
  });

  it("requests the exact league of each owner and refreshes changed odds after TTL", async () => {
    const h = harness(); await h.context();
    await h.pair([league(), league(482, [event("202")])]); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1), { timeout: 1000 });
    h.setNow(wall + 500); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(2), { timeout: 1000 });
    expect(h.requests.map(({ url }) => [new URL(url).searchParams.get("eventId"),
      new URL(url).searchParams.get("leagueId")])).toEqual([["101", "481"], ["202", "482"]]);
    h.setPrice("0.63"); h.setNow(wall + 31_000); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(3), { timeout: 1000 });
    expect(JSON.parse(h.more()[2]!.payload.body).groups["21"][0]).toContain("0.63*");
    expect(h.more()[2]!.observedAtMs).toBe(wall + 31_000);
  });

  it.each(["host", "stream", "cutoff", "live"])("does not arm unproven or live owner input: %s", async kind => {
    const h = harness(); await h.context();
    await h.partition("live", kind === "live" ? [league()] : []);
    await h.partition("today", [league()], kind === "stream" ? 2 : 1,
      kind === "cutoff" ? 1 : 0, kind === "host" ? "https://evil.sb21.net" : backend);
    await h.tick(); expect(h.requests).toHaveLength(0);
  });

  it.each(["bridge", "context", "owner", "remove", "document"].flatMap(kind => [200, 403].map(status => ({ kind, status }))))(
    "retires pending active responses on $kind change (HTTP $status)", async ({ kind, status }) => {
    const h = harness(); await h.context(); await h.pair(); const held = h.holdFetch(); await h.tick();
    await vi.waitFor(() => expect(h.requests).toHaveLength(1), { timeout: 1000 });
    if (kind === "bridge") h.observer.beginBridgeSourceEpoch(source.sourceId);
    if (kind === "context") await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
    if (kind === "owner") await h.pair([league(482, [event("101", "Changed Home")])], [], 2, 1);
    if (kind === "remove") await h.pair([], [], 2, 1);
    if (kind === "document") h.setLoader("document-2");
    h.setStatus(status);
    held.resolve(); await flush(); await flush(); expect(h.more()).toHaveLength(0);
    expect(await h.observer.sbobetRequestsPaused()).toBe(false);
  });

  it("keeps physical capacity while publication is pending and cancels the acknowledgement on context loss", async () => {
    const h = harness(); await h.context(); await h.pair(); const held = h.holdForward(); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1), { timeout: 1000 });
    h.setNow(wall + 31_000); await h.tick(); expect(h.requests).toHaveLength(1);
    await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
    held.resolve(); await flush(); await h.tick(); expect(h.requests).toHaveLength(1);
  });

  it("does not mark page-only or mismatched response fetches as successful", async () => {
    const h = harness(); await h.context(); await h.pair(); h.mismatchResponse(); await h.tick();
    await vi.waitFor(() => expect(h.requests).toHaveLength(1), { timeout: 1000 });
    await flush(); expect(h.more()).toHaveLength(0);
    h.setNow(wall + 31_000); await h.tick(); expect(h.requests).toHaveLength(1);
  });

  it("times out an unobserved page fetch, backs off, and later succeeds only on its actual receipt", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness(); await h.context(); await h.pair(); h.setNetwork(false); await h.tick();
    expect(h.requests).toHaveLength(1); expect(h.more()).toHaveLength(0);
    h.setNow(wall + 8001); await vi.advanceTimersByTimeAsync(8001); await flush();
    h.setNetwork(true); await h.tick(); expect(h.requests).toHaveLength(1);
    expect(await h.observer.sbobetRequestsPaused()).toBe(false);
    h.setNow(wall + 10_000); await h.tick(); expect(h.requests).toHaveLength(1);
    h.setNow(wall + 10_002); await h.tick(); await flush();
    expect(h.requests).toHaveLength(2); expect(h.more()).toHaveLength(1);
    await h.tick(); expect(h.requests).toHaveLength(2);
  });

  it("retains physical forwarding capacity across repeated bridge resets", async () => {
    const h = harness(); await h.context(); await h.pair(); const held = h.holdForward(); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1), { timeout: 1000 });
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    const pendingPair = h.pair(); h.setNow(wall + 500); await h.tick();
    expect(h.more()).toHaveLength(1);
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    h.setNow(wall + 1000); await h.tick(); await flush();
    // Resets cancel pending work, but cannot allocate a second physical
    // forwarding lane while the old publication still owns its capacity.
    expect(h.requests).toHaveLength(1);
    held.resolve(); await pendingPair; await flush();
    await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(2), { timeout: 1000 });
  });

  it("backs off on provider 429 before another active request", async () => {
    const h = harness(); await h.context(); await h.pair(); h.setStatus(429); await h.tick(); await flush();
    expect(h.requests).toHaveLength(1); expect(h.more()).toHaveLength(0);
    h.setStatus(200); h.setNow(wall + 1000); await h.tick(); expect(h.requests).toHaveLength(1);
    h.setNow(wall + 2500); await h.tick(); expect(h.requests).toHaveLength(1);
    h.setNow(wall + 30_001); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1), { timeout: 1000 });
  });

  it("rejects a request object whose league differs from its bound URL", () => {
    const request = { eventId: "101", leagueId: "482",
      url: `${backend}/api/v2/getEventBetMore?eventId=101&oddsStyle=ma&leagueId=481&sportId=1&sportType=1_1` };
    expect(sbobetMoreBatchFromResponse(request, JSON.stringify(groups()), {
      generation: "epoch", requestStartSequence: 0, observedAtMs: wall
    })).toBeNull();
  });

  it("binds a newer complete roster to its own document while the old document remains alive", async () => {
    const h = harness(); await h.context(); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1), { timeout: 1000 });
    await h.secondContext(); await h.pair([league(482, [event("202")])], [], 2, 1);
    h.setNow(wall + 500); await h.tick();
    await vi.waitFor(() => expect(h.more()).toHaveLength(2), { timeout: 1000 });
    const evaluations = h.sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.evaluate" && String(params?.expression).includes("AbortController"));
    expect(evaluations.map(([, , params]) => params?.contextId)).toEqual([91, 92]);
    expect(h.more()[1]!.request.requestDocumentKey).not.toBe(h.more()[0]!.request.requestDocumentKey);
  });
});
