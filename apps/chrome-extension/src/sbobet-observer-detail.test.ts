import { setImmediate } from "node:timers";
import { runInNewContext } from "node:vm";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
const origin = "https://prod20091.fxf774.com";
const observedUrl = `${origin}/api/v2/getEvent?eventId=101&timeRange=today&flag=a%20b`;
const documentBinding = { frameId: "football", loaderId: "document-1" };
const native = (id = "202", groups: Record<string, unknown[]> = {
  "31": ["4.5 0.91*202h -0.97*202a 20231"], "777": [{ native: "retained" }], "500": []
}) => ({ "0": "2026-09-08T12:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`, "8": id, "7": groups });
const leagues = (events: readonly unknown[]) => [{ "1": "Prematch league", "2": events }];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function harness() {
  let now = 1_000;
  let loaderId = documentBinding.loaderId;
  let executionOrigin = origin;
  let observedBody: unknown = native("101");
  let detailBody: unknown = native();
  let detailResponseReturned = false;
  let afterResponseDocumentCheck: (() => void | Promise<void>) | undefined;
  let forwardHook: ((envelope: ChromeBridgeEnvelope) => void | Promise<void>) | undefined;
  let readDetail: (() => Promise<unknown>) | undefined;
  const forwarded: ChromeBridgeEnvelope[] = [];
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 200,
    text: async () => JSON.stringify(readDetail === undefined ? detailBody : await readDetail()) }));
  const sendCommand = vi.fn(async (_tabId: number, method: string,
    params?: Record<string, unknown>, _sessionId?: string) => {
    if (method === "Page.getFrameTree") {
      if (detailResponseReturned) await afterResponseDocumentCheck?.();
      return { frameTree: { frame: { id: documentBinding.frameId, loaderId, url: `${origin}/sport` } } };
    }
    if (method === "Network.getResponseBody") return { body: JSON.stringify(observedBody), base64Encoded: false };
    if (method === "Runtime.evaluate") {
      const expression = String(params?.expression);
      if (expression.includes("AbortController") && expression.includes("fetch(")) {
        const value = await runInNewContext(expression, {
          location: { origin: executionOrigin }, AbortController, setTimeout, clearTimeout, fetch
        });
        detailResponseReturned = true;
        // Real CDP returnByValue serializes away the VM realm's prototypes.
        return { result: { type: "object", value: JSON.parse(JSON.stringify(value)) as unknown } };
      }
    }
    return {};
  });
  // Hold the existing periodic DOM lane to prove detail work has its own caller-driven path.
  const scheduler = new ProviderWorkScheduler({ maxConcurrent: 1 });
  const held = deferred<void>();
  const holding = scheduler.run(source.sourceId, () => held.promise);
  const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => {
    forwarded.push(envelope); await forwardHook?.(envelope);
  },
    now: () => now, monotonicNow: () => now / 2, observerSessionId: "observer-detail", workScheduler: scheduler });
  const sourceEpoch = observer.beginBridgeSourceEpoch(source.sourceId);
  const maintenance: Promise<unknown>[] = [];
  cleanups.push(async () => {
    observer.releaseTab(source.tabId);
    scheduler.clear(source.sourceId);
    held.resolve();
    await holding;
    await Promise.all(maintenance);
  });
  const tick = async () => {
    maintenance.push(observer.maintainKsportFeed(source).catch(() => undefined));
    await flush();
  };
  const capture = async (options: { readonly status?: number; readonly url?: string;
    readonly method?: string; readonly bound?: boolean } = {}) => {
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: documentBinding.frameId, isDefault: true } }
    });
    const url = options.url ?? observedUrl;
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "native-detail", type: "Fetch",
      ...(options.bound === false ? {} : documentBinding),
      request: { url, method: options.method ?? "GET", headers: {
        "X-Request-Context": "PRIVATE_SENTINEL", Cookie: "PRIVATE_COOKIE" } } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "native-detail", type: "Fetch",
      response: { url, status: options.status ?? 200 } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "native-detail" });
  };
  type Metadata = Parameters<NetworkObserver["ingestHttpResponse"]>[4];
  const partition = async (part: "live" | "today", events: readonly unknown[], overrides: Partial<Metadata> = {},
    omitIntent = false) => {
    await observer.ingestHttpResponse(source, `${origin}/api/v2/getEvent?timeRange=${part}`, "Fetch",
      JSON.stringify(leagues(events)), { method: "GET", streamId: "ksport-http:7:1",
        providerPartition: part === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
        ...(omitIntent ? {} : { providerContentIntent: "FOOTBALL_FULL_CATALOG" }), requestStartSequence: 0,
        verifiedDocument: documentBinding, ...overrides });
  };
  const pair = async (today: readonly unknown[] = [native()], live: readonly unknown[] = []) => {
    await partition("live", live);
    await partition("today", today);
  };
  const proof = (override: Partial<Parameters<NetworkObserver["setSbobetDetailCompletenessVerified"]>[1]> = {}) =>
    observer.setSbobetDetailCompletenessVerified(source, {
      sourceEpoch, observedUrl, ...documentBinding, verified: true, ...override
    });
  const details = () => forwarded.filter((item) => item.transport === "HTTP_RESPONSE" &&
    item.request.streamId?.startsWith("sbobet-detail:") === true);
  return { observer, sourceEpoch, forwarded, sendCommand, fetch, capture, pair, partition, proof, tick, details,
    setNow: (value: number) => { now = value; },
    setLoader: (value: string) => { loaderId = value; },
    setOrigin: (value: string) => { executionOrigin = value; },
    setObservedBody: (value: unknown) => { observedBody = value; },
    setDetailBody: (value: unknown) => { detailBody = value; },
    setDetailReader: (reader: () => Promise<unknown>) => { readDetail = reader; },
    onPostflight: (callback: () => void | Promise<void>) => { afterResponseDocumentCheck = callback; },
    onForward: (callback: (envelope: ChromeBridgeEnvelope) => void | Promise<void>) => { forwardHook = callback; } };
}

describe("SBOBET detail through NetworkObserver", () => {
  it("makes no detail fetch without the exact privately observed template and explicit proof", async () => {
    const h = harness();
    await h.pair();
    expect(await h.proof()).toBe(false);
    await h.tick();
    await h.capture();
    await h.tick();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.details()).toEqual([]);
  });

  it.each([
    { sourceEpoch: "observer-detail:retired" }, { observedUrl: `${observedUrl}&extra=1` },
    { frameId: "another-frame" }, { loaderId: "document-old" }, { sessionId: "another-session" }
  ])("does not grant proof to a mismatched observed identity %j", async (override) => {
    const h = harness();
    await h.capture(); await h.pair();
    expect(await h.proof(override)).toBe(false);
    await h.tick();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([{ status: 500 }, { method: "POST" }, { bound: false },
    { url: `${origin}/api/v2/getEvent?timeRange=today` }])(
    "cannot turn an unsuccessful or non-detail capture into a template %j", async (options) => {
      const h = harness();
      await h.capture(options); await h.pair();
      expect(await h.proof({ observedUrl: "url" in options ? options.url : observedUrl })).toBe(false);
      await h.tick(); expect(h.fetch).not.toHaveBeenCalled();
    });

  it("runs the actual fetch expression before the busy maintenance gate and emits a canonical detail receipt", async () => {
    const h = harness();
    await h.capture(); await h.pair();
    expect(await h.proof()).toBe(true);
    await h.tick();
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    expect(h.fetch).toHaveBeenCalledWith(observedUrl.replace("eventId=101", "eventId=202"),
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store",
        headers: { "X-Request-Context": "PRIVATE_SENTINEL" } }));
    expect(h.sendCommand).toHaveBeenCalledWith(source.tabId, "Runtime.evaluate", expect.objectContaining({
      contextId: 91, awaitPromise: true, returnByValue: true }), undefined);
    const receipt = h.details()[0]!;
    expect(receipt).toMatchObject({ sourceEpoch: h.sourceEpoch, sequence: 2,
      observedAtMs: 1_000, receivedMonotonicMs: 500,
      request: { method: "GET", resourceType: "Fetch", pathnameClass: "/api/v2/getEvent",
        streamId: expect.stringMatching(/^sbobet-detail:7:\d+$/u), observerRequestId: expect.any(String),
        requestFrameKey: expect.any(String), requestDocumentKey: expect.any(String), reconcileCutoffSequence: 1 } });
    expect(receipt.request.providerPartition).toBeUndefined();
    expect(receipt.request).not.toHaveProperty("providerContentIntent");
    expect(JSON.parse(receipt.payload.body)).toEqual({ kind: "SBOBET_EVENT_DETAIL", generation: h.sourceEpoch,
      eventId: "202", requestStartSequence: 1, observedAtMs: 1_000, marketContainerComplete: true, event: native() });
    expect(JSON.stringify(h.forwarded)).not.toMatch(/PRIVATE_SENTINEL|PRIVATE_COOKIE|flag=a/);
  });

  it("waits for a complete canonical pair and excludes any ID still present in Live", async () => {
    const h = harness();
    await h.capture(); expect(await h.proof()).toBe(true);
    await h.partition("today", [native("303"), native()]);
    await h.tick(); expect(h.fetch).not.toHaveBeenCalled();
    await h.partition("live", [native("303")]);
    await h.tick();
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    expect(h.fetch.mock.calls.map(([url]) => new URL(url).searchParams.get("eventId"))).toEqual(["202"]);
  });

  it.each(["different-generation", "different-cutoff", "missing-intent", "invalid-roster"] as const)(
    "rejects partial or unproven roster membership: %s", async (kind) => {
      const h = harness();
      await h.capture(); expect(await h.proof()).toBe(true);
      await h.partition("live", []);
      await h.partition("today", kind === "invalid-roster" ? [{ ...native(), "0": "unknown" }] : [native()],
        kind === "different-generation" ? { streamId: "ksport-http:7:2" } :
          kind === "different-cutoff" ? { requestStartSequence: 1 } : {}, kind === "missing-intent");
      await h.tick(); expect(h.fetch).not.toHaveBeenCalled(); expect(h.details()).toEqual([]);
    });

  it("keeps response receipt clocks across asynchronous postflight document checks", async () => {
    const h = harness();
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    h.onPostflight(() => h.setNow(9_000));
    await h.tick(); await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    expect(h.details()[0]).toMatchObject({ observedAtMs: 1_000, receivedMonotonicMs: 500 });
    expect(JSON.parse(h.details()[0]!.payload.body).observedAtMs).toBe(1_000);
  });

  it("chunks a large native detail as one receipt with identical clocks and identity", async () => {
    const h = harness();
    const large = native("202", { "777": ["native-".repeat(16_000)], "500": [] });
    h.setDetailBody(large);
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    h.onPostflight(() => h.setNow(9_000));
    await h.tick(); await vi.waitFor(() => expect(h.details().length).toBeGreaterThan(1));
    const receipts = h.details();
    const chunks = receipts.map((item) => JSON.parse(item.payload.body));
    expect(chunks.map((item) => item.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(new Set(chunks.map((item) => item.snapshotId)).size).toBe(1);
    expect(chunks.every((item) => item.chunkCount === chunks.length)).toBe(true);
    expect(new Set(receipts.map((item) => item.request.observerRequestId)).size).toBe(1);
    expect(receipts.every((item) => item.observedAtMs === 1_000 && item.receivedMonotonicMs === 500 &&
      item.sourceEpoch === h.sourceEpoch && item.request.providerPartition === undefined &&
      !("providerContentIntent" in item.request))).toBe(true);
    expect(JSON.parse(chunks.map((item) => item.bodyFragment).join(""))).toEqual({ kind: "SBOBET_EVENT_DETAIL",
      generation: h.sourceEpoch, eventId: "202", requestStartSequence: 1, observedAtMs: 1_000,
      marketContainerComplete: true, event: large });
  });

  it.each(["bridge", "source", "tab", "document", "revoke", "live"] as const)(
    "discards an actual fetch completing after %s retirement", async (kind) => {
      const h = harness();
      const response = deferred<unknown>();
      h.setDetailReader(() => response.promise);
      await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
      try {
        await h.tick(); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
        if (kind === "bridge") h.observer.beginBridgeSourceEpoch(source.sourceId);
        if (kind === "source") h.observer.beginSourceEpoch(source.sourceId);
        if (kind === "tab") h.observer.prepareDebuggerReattach(source.tabId);
        if (kind === "document") h.setLoader("document-2");
        if (kind === "revoke") expect(await h.proof({ verified: false })).toBe(true);
        if (kind === "live") {
          await h.partition("live", [native()], { streamId: "ksport-http:7:2", requestStartSequence: 1 });
          await h.partition("today", [native()], { streamId: "ksport-http:7:2", requestStartSequence: 1 });
        }
      } finally { response.resolve(native()); }
      await flush(); await flush();
      expect(h.details()).toEqual([]);
    });

  it("rejects a changed execution origin before network fetch", async () => {
    const h = harness();
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    h.setOrigin("https://other.sb21.net");
    await h.tick(); expect(h.fetch).not.toHaveBeenCalled(); expect(h.details()).toEqual([]);
  });

  it("keeps remote document checks outside the price forwarding tail", async () => {
    const h = harness();
    const checked = deferred<void>();
    let checks = 0;
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    h.onPostflight(() => { if (++checks === 3) return checked.promise; });
    let price: Promise<void> | undefined;
    try {
      await h.tick(); await vi.waitFor(() => expect(checks).toBe(3));
      price = h.observer.ingestWebSocketFrame(source, "wss://d42.sb21.net/sport", "h");
      await flush();
      expect(h.forwarded.some((envelope) => envelope.transport === "WS_FRAME")).toBe(true);
      expect(h.details()).toEqual([]);
    } finally { checked.resolve(); await price; }
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
  });

  it("uses a constant number of document reads for a large multi-chunk detail", async () => {
    const h = harness();
    h.setDetailBody(native("202", { "777": ["native-".repeat(160_000)] }));
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    const before = h.sendCommand.mock.calls.filter(([, method]) => method === "Page.getFrameTree").length;
    await h.tick(); await vi.waitFor(() => expect(h.details()).toHaveLength(11));
    const after = h.sendCommand.mock.calls.filter(([, method]) => method === "Page.getFrameTree").length;
    expect(after - before).toBe(4);
  });

  it.each(["bridge", "context", "revoke"] as const)(
    "starts fetch while the price tail is busy and withdraws queued detail after %s retirement", async (kind) => {
      const h = harness();
      const blocked = deferred<void>();
      await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
      h.onForward((envelope) => { if (envelope.transport === "WS_FRAME") return blocked.promise; });
      const price = h.observer.ingestWebSocketFrame(source, "wss://d42.sb21.net/sport", "h");
      try {
        await flush(); await h.tick();
        await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
        await flush(); expect(h.details()).toEqual([]);
        if (kind === "bridge") h.observer.beginBridgeSourceEpoch(source.sourceId);
        if (kind === "context") await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
        if (kind === "revoke") expect(await h.proof({ verified: false })).toBe(true);
      } finally { blocked.resolve(); await price; }
      await flush(); await flush(); expect(h.details()).toEqual([]);
    });

  it("withdraws remaining detail chunks after context retirement between forwards", async () => {
    const h = harness();
    h.setDetailBody(native("202", { "777": ["native-".repeat(16_000)] }));
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    h.onForward(async (envelope) => {
      if (envelope.request.streamId?.startsWith("sbobet-detail:")) {
        await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
      }
    });
    await h.tick(); await flush();
    expect(h.details()).toHaveLength(1);
    expect(JSON.parse(h.details()[0]!.payload.body)).toMatchObject({ chunkIndex: 0, chunkCount: 2 });
  });

  it("does not replace its proven template or publish a main receipt from its own captured fetch", async () => {
    const h = harness();
    const response = deferred<unknown>();
    h.setDetailReader(() => response.promise);
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    try {
      await h.tick(); await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
      h.setObservedBody(native());
      await h.capture({ url: observedUrl.replace("eventId=101", "eventId=202") });
      expect(h.forwarded).toHaveLength(2);
    } finally { response.resolve(native()); }
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    h.setNow(121_001);
    await h.tick(); await vi.waitFor(() => expect(h.details()).toHaveLength(2));
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });

  it("requires fresh independent proof when a different passive template is observed", async () => {
    const h = harness();
    await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
    const changed = `${observedUrl}&version=2`;
    await h.capture({ url: changed });
    await h.tick(); expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.proof()).toBe(false);
    expect(await h.proof({ observedUrl: changed })).toBe(true);
    await h.tick(); await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    expect(h.fetch.mock.calls[0]![0]).toBe(changed.replace("eventId=101", "eventId=202"));
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])(
    "never forwards after context retirement at emission microtask boundary %i", async (offset) => {
      const h = harness();
      let retired = false;
      let forwardedAfterRetirement = false;
      let checks = 0;
      await h.capture(); await h.pair(); expect(await h.proof()).toBe(true);
      h.onForward((envelope) => {
        if (envelope.request.streamId?.startsWith("sbobet-detail:")) forwardedAfterRetirement = retired;
      });
      h.onPostflight(() => {
        if (++checks !== 3) return;
        const retire = (remaining: number) => queueMicrotask(() => {
          if (remaining > 0) { retire(remaining - 1); return; }
          retired = true;
          void h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
        });
        retire(offset);
      });
      await h.tick(); await flush();
      expect(retired).toBe(true);
      expect(forwardedAfterRetirement).toBe(false);
    });
});
