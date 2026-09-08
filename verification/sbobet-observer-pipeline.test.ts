import { setImmediate } from "node:timers";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeBridgeEnvelopeSchema, type ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "../apps/chrome-extension/src/network-observer.js";
import { ProviderWorkScheduler } from "../apps/chrome-extension/src/provider-work-scheduler.js";
import { ChromeCatalogDataPlane } from "../apps/api/src/chrome-bridge/chrome-catalog-data-plane.js";
import { CatalogRevisionStore, type StoredCatalogRevision } from "../apps/api/src/catalog/catalog-revision-store.js";
import { providerFeedPolicies } from "../apps/api/src/chrome-bridge/provider-feed-policies.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";
const EVENT_ID = "778899";
const GOAL_ID = "7788993001";
const CORNER_ID = "7788992101";
const START = Date.UTC(2026, 8, 7, 14);
const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
const origin = "https://prod20091.fxf774.com";
const observedUrl = `${origin}/api/v2/getEvent?eventId=101&timeRange=today&flag=a%20b`;
const binding = { frameId: "football", loaderId: "document-1" };
type Groups = Record<string, unknown[]>;
const goal = (price = "0.92") => `2.5 ${price}*778899301h -0.98*778899302a ${GOAL_ID}`;
const corner = (price = "0.91", line = "9.5") => `${line} ${price}*778899211h -0.97*778899212a ${CORNER_ID}`;
const event = (groups: Groups, id = EVENT_ID) => ({ "0": new Date(START + 7_200_000).toISOString(),
  "2": `Home ${id}`, "3": `Away ${id}`, "8": id, "7": groups });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function harness() {
  let now = START;
  let monotonic = 2_000;
  let generation = 0;
  let detailBody: unknown = event({ "3": [goal()], "21": [corner()] });
  let readDetail: (() => Promise<unknown>) | undefined;
  let completedEvaluations = 0;
  const revisions = new CatalogRevisionStore({ now: () => now });
  const notifications: StoredCatalogRevision[] = [];
  const delivered: Array<{ envelope: ChromeBridgeEnvelope; accepted: boolean }> = [];
  const rejected: Array<{ sequence: number; reason: string }> = [];
  const schemaErrors: unknown[] = [];
  revisions.subscribe((entry) => notifications.push(entry));
  const plane = new ChromeCatalogDataPlane({ now: () => now,
    publish: (catalog, snapshotState) => revisions.publish(catalog.accountId, catalog, {
      snapshotState, freshnessMs: providerFeedPolicies.get(catalog.accountId)!.catalogFreshnessMs
    }), onIngestRejected: (envelope, reason) => rejected.push({ sequence: envelope.sequence, reason }) });
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 200,
    text: async () => JSON.stringify(readDetail === undefined ? detailBody : await readDetail()) }));
  const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: {
      id: binding.frameId, loaderId: binding.loaderId, url: `${origin}/sport`
    } } };
    if (method === "Network.getResponseBody") return { body: JSON.stringify(event({}, "101")), base64Encoded: false };
    if (method === "Runtime.evaluate") {
      const expression = String(params?.expression);
      if (expression.includes("AbortController") && expression.includes("fetch(")) {
        const value = await runInNewContext(expression, {
          location: { origin }, AbortController, setTimeout, clearTimeout, fetch
        });
        completedEvaluations += 1;
        return { result: { type: "object", value: JSON.parse(JSON.stringify(value)) as unknown } };
      }
    }
    return {};
  });
  // Hold the real periodic-work scheduler; maintainKsportFeed must still start
  // its actual detail lane without unrelated DOM/recovery work in this test.
  const scheduler = new ProviderWorkScheduler({ maxConcurrent: 1 });
  const held = deferred<void>();
  const holding = scheduler.run(source.sourceId, () => held.promise);
  const observer = new NetworkObserver({ sendCommand, workScheduler: scheduler,
    now: () => now, monotonicNow: () => monotonic, observerSessionId: "observer-pipeline",
    forward: async (raw) => {
      try {
        const envelope = ChromeBridgeEnvelopeSchema.parse(raw);
        delivered.push({ envelope, accepted: plane.ingest(envelope, { connectionGeneration: 1 }) });
      } catch (error) { schemaErrors.push(error); throw error; }
    } });
  const sourceEpoch = observer.beginBridgeSourceEpoch(source.sourceId);
  const maintenance: Promise<unknown>[] = [];
  cleanups.push(async () => {
    observer.releaseTab(source.tabId);
    scheduler.clear(source.sourceId);
    held.resolve();
    await holding;
    await Promise.all(maintenance);
    revisions.close();
  });
  const advance = (ms: number) => { now += ms; monotonic += ms; };
  const capture = async () => {
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: binding.frameId, isDefault: true } }
    });
    await observer.handleEvent(source, "Network.requestWillBeSent", {
      requestId: "passive-detail", type: "Fetch", ...binding,
      request: { url: observedUrl, method: "GET", headers: { "X-Request-Context": "SYNTHETIC_CONTEXT" } }
    });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "passive-detail", type: "Fetch",
      response: { url: observedUrl, status: 200 } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "passive-detail" });
  };
  const pair = async (groups: Groups | null = { "3": [goal()] }) => {
    generation += 1;
    const requestStartSequence = delivered.at(-1)?.envelope.sequence ?? 0;
    for (const partition of ["live", "today"] as const) {
      advance(1);
      await observer.ingestHttpResponse(source, `${origin}/api/v2/getEvent?timeRange=${partition}`, "Fetch",
        JSON.stringify([{ "1": "Prematch league", "2": partition === "today" && groups !== null ? [event(groups)] : [] }]),
        { method: "GET", streamId: `ksport-http:7:${generation}`,
          providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
          providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence, verifiedDocument: binding });
    }
  };
  const proveForTest = () => observer.setSbobetDetailCompletenessVerified(source, {
    sourceEpoch, observedUrl, ...binding, verified: true
  });
  const tick = async () => {
    maintenance.push(observer.maintainKsportFeed(source).catch(() => undefined));
    await flush();
  };
  const details = () => delivered.filter(({ envelope }) => envelope.request.streamId?.startsWith("sbobet-detail:"));
  const seed = async () => {
    await capture(); await pair();
    expect(revisions.get(ACCOUNT_ID)?.catalog.markets.map((market) => market.providerMarketId), JSON.stringify(rejected))
      .toEqual([GOAL_ID]);
    // Synthetic endpoint-completeness proof is explicit; passive capture alone grants none.
    expect(await proveForTest()).toBe(true);
  };
  const socket = async (groups: Groups, order: number, first = false) => {
    const url = "wss://d42.sb21.net/sport/433/session/websocket";
    if (first) await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "provider-ws", url });
    const message = "MESSAGE\ndestination:/topic/sports/1_1/today/ma/event/vi\n" +
      `subscription:subSportBookToday\nmessage-id:socket-${order}\ncontent-type:application/json\n\n` +
      `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify({ "8": EVENT_ID, "7": groups }) })}\0`;
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "provider-ws",
      response: { opcode: 1, payloadData: `a${JSON.stringify([message])}` } });
  };
  return { observer, sourceEpoch, revisions, notifications, delivered, rejected, schemaErrors, fetch,
    advance, pair, tick, seed, socket, details,
    setDetail: (body: unknown) => { detailBody = body; },
    setReader: (reader: (() => Promise<unknown>) | undefined) => { readDetail = reader; },
    completedEvaluations: () => completedEvaluations };
}

describe("SBOBET observer to catalog publication", () => {
  it("publishes actual fetched hidden detail and observed STOMP price/line changes with native receipt clocks", async () => {
    const h = harness();
    await h.seed(); h.advance(100); await h.tick();
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    const detail = h.details()[0]!;
    expect(detail.accepted, JSON.stringify(h.rejected)).toBe(true);
    expect(detail.envelope.sourceEpoch).toBe(h.sourceEpoch);
    const hydrated = h.revisions.get(ACCOUNT_ID)!;
    expect(hydrated.catalog.quotes).toContainEqual(expect.objectContaining({ providerEventId: EVENT_ID,
      providerMarketId: CORNER_ID, providerSelectionId: "778899211h", line: "9.5", status: "OPEN",
      receivedMonotonicMs: detail.envelope.receivedMonotonicMs, sequence: detail.envelope.sequence }));

    h.advance(100); await h.socket({ "21": [corner("0.63", "10.5")] }, 100, true);
    const priceReceipt = h.delivered.findLast(({ envelope }) => envelope.transport === "WS_FRAME")!;
    expect(priceReceipt?.accepted, JSON.stringify(h.rejected)).toBe(true);
    const changed = h.revisions.get(ACCOUNT_ID)!;
    expect(changed.revision).not.toBe(hydrated.revision);
    expect(changed.catalog.quotes).toContainEqual(expect.objectContaining({ providerEventId: EVENT_ID,
      providerMarketId: CORNER_ID, providerSelectionId: "778899211h", rawOdds: "0.63", line: "10.5",
      receivedMonotonicMs: priceReceipt.envelope.receivedMonotonicMs, sequence: priceReceipt.envelope.sequence }));
    h.advance(100); await h.socket({ "21": [corner("0", "10.5")] }, 101);
    expect(h.revisions.get(ACCOUNT_ID)?.catalog.markets.map((market) => market.providerMarketId)).toEqual([GOAL_ID]);
    expect(h.revisions.get(ACCOUNT_ID)?.catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: CORNER_ID, disposition: "EXCLUDED"
    }));
    expect(h.notifications).toHaveLength(4);
    expect(h.schemaErrors).toEqual([]);
  });

  it("publishes a full empty fetched detail as authoritative withdrawal", async () => {
    const h = harness();
    await h.seed(); h.advance(100); await h.tick();
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    h.setDetail(event({}));
    h.advance(30_001); await h.pair(); await h.tick();
    await vi.waitFor(() => expect(h.details()).toHaveLength(2));
    expect(h.details()[1]!.accepted, JSON.stringify(h.rejected)).toBe(true);
    expect(h.revisions.get(ACCOUNT_ID)?.catalog).toMatchObject({
      events: [expect.objectContaining({ providerEventId: EVENT_ID })], markets: [], quotes: [], nativeMarketObservations: []
    });
    expect(h.notifications.at(-1)?.revision).toBe(h.revisions.get(ACCOUNT_ID)?.revision);
    expect(h.schemaErrors).toEqual([]);
  });

  it("discards an in-flight detail across roster removal and same-ID readmission", async () => {
    const h = harness();
    const pending = deferred<unknown>();
    h.setReader(() => pending.promise);
    await h.seed(); h.advance(100); await h.tick();
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    try {
      await h.pair(null); await h.pair({ "3": [goal("0.70")] });
    } finally { pending.resolve(event({ "3": [goal()], "21": [corner()] })); }
    await vi.waitFor(() => expect(h.completedEvaluations()).toBe(1));
    await flush(); await flush();
    expect(h.details()).toEqual([]);
    expect(h.revisions.get(ACCOUNT_ID)?.catalog.markets.map((market) => market.providerMarketId)).toEqual([GOAL_ID]);
    h.setReader(undefined); h.advance(300); await h.tick();
    await vi.waitFor(() => expect(h.details()).toHaveLength(1));
    expect(h.details()[0]!.accepted, JSON.stringify(h.rejected)).toBe(true);
    expect(h.revisions.get(ACCOUNT_ID)?.catalog.markets.map((market) => market.providerMarketId)).toContain(CORNER_ID);
    expect(h.schemaErrors).toEqual([]);
  });
});
