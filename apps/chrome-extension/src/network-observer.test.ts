import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION } from "./saba-catalog-discovery.js";
import { SABA_NAVIGATION_PROBE_READ_EXPRESSION } from "./saba-navigation-probe.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { TSPORT_CATALOG_SHAPE_EXPRESSION } from "./tsport-catalog-shape.js";
import { buildImExactSelectionPriceExpression } from "./im-selection-price.js";
import { ksportTimeTabExpressionForTest } from "./network-observer.js";
import { BTI_CATALOG_REFRESH_EXPRESSION, CMD_CATALOG_DISCOVERY_EXPRESSION,
  CMD_FULL_BASELINE_EXPRESSION, IM_CATALOG_DISCOVERY_EXPRESSION, KEEP_ACTIVE_EXPRESSION,
  NetworkObserver, type NetworkObserverDependencies, type PersistedSabaWsSnapshots } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";
import type { ApsportCatalogBatch, CollectApsportCatalogOptions,
  CollectApsportEventDetailOptions } from "./apsport-catalog-refresh.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;

async function settleObserverBackgroundTasks(turns = 100): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function attachSabaRecoveryWorker(observer: NetworkObserver,
  source: { readonly lobby: "SABA"; readonly sourceId: string; readonly tabId: number }): Promise<void> {
  await observer.handleEvent(source, "Target.attachedToTarget", {
    sessionId: "saba-recovery-worker", targetInfo: { targetId: "recovery-worker", type: "worker" }
  });
}

function sabaUnknownProbeState(documentToken: string): Record<string, unknown> {
  return { documentToken, rowCount: 50, tableCount: 1, activePeriod: "UNKNOWN",
    periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [], moreCandidates: [],
    rosterMatchIds: ["match-1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
    headerControls: [], fingerprint: "unknown", truncated: false };
}

function ksportFullReceipt(partition: "live" | "today", order: number): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const body = [{ "1": `${partition} league`,
    "2": [{ "8": `${order}`, "2": "Home", "3": "Away",
      "7": { "3": [`2.5 0.91*${order}h -0.99*${order}a ${order}0001`] } }] }];
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
    body: JSON.stringify(body) });
  return `MESSAGE\ndestination:/topic/sports/${path}/ma/event/vi\n` +
    `subscription:${subscription}\nmessage-id:socket-${order}\n\n${wrapper}\u0000`;
}

function ksportSubscribe(partition: "live" | "today"): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  return `SUBSCRIBE\nid:${subscription}\ndestination:/topic/sports/${path}/ma/event/vi\n\n\u0000`;
}

function ksportDeltaReceipt(partition: "live" | "today", order: number): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const body = { "8": `${order}`, "2": "Home", "3": "Away",
    "7": { "3": [`2.5 0.91*${order}h -0.99*${order}a ${order}0001`] } };
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
    body: JSON.stringify(body) });
  return `MESSAGE\ndestination:/topic/sports/${path}/ma/event/vi\n` +
    `subscription:${subscription}\nmessage-id:socket-${order}\n\n${wrapper}\u0000`;
}

describe("NetworkObserver", () => {
  it("reports a bounded responsive SABA document without promoting a small DOM receipt to catalog authority", async () => {
    let now = 10_000;
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined),
      now: () => now,
      monotonicNow: () => now
    });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:71", tabId: 71 } as const;
    const smallFootballRoster = JSON.stringify([{
      sportId: "1", leagueId: "league-1", leagueName: "League", matchId: "match-1",
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: "small-over", priceText: "0.91", status: null, greyedOut: null },
          { marketOddsId: "small-under", priceText: "-0.93", status: null, greyedOut: null }
        ]
      }]
    }]);

    await observer.ingestDomSnapshot(saba, "sports.example", smallFootballRoster);

    expect(observer.hasCompleteSabaBaseline(saba.sourceId)).toBe(false);
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(false);
    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(true);

    now += 60_001;
    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(false);

    await observer.ingestDomSnapshot(saba, "sports.example", smallFootballRoster);
    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(true);
    observer.beginSourceEpoch(saba.sourceId);
    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(false);

    await observer.ingestDomSnapshot(saba, "sports.example", smallFootballRoster);
    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(true);
    observer.releaseTab(saba.tabId);
    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(false);
  });

  it("does not admit a SABA receipt retired by a new source epoch before forwarding completes", async () => {
    let releaseForward!: () => void;
    let forwardStarted = false;
    const heldForward = new Promise<void>((resolve) => { releaseForward = resolve; });
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => { forwardStarted = true; await heldForward; }),
      now: () => 10_000,
      monotonicNow: () => 10_000
    });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:72", tabId: 72 } as const;
    const ingest = observer.ingestDomSnapshot(saba, "sports.example", JSON.stringify([{
      sportId: "1", leagueId: "league-1", leagueName: "League", matchId: "match-1", timeText: "11:00PM",
      teamNames: ["Home", "Away"], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: "retired-over", priceText: "0.91", status: null, greyedOut: null },
          { marketOddsId: "retired-under", priceText: "-0.93", status: null, greyedOut: null }
        ]
      }]
    }]));
    await vi.waitFor(() => expect(forwardStarted).toBe(true));

    observer.beginSourceEpoch(saba.sourceId);
    releaseForward();
    await ingest;

    expect(observer.hasResponsiveSabaDocument(saba.sourceId)).toBe(false);
  });

  it.each(["TODAY_SELECTION", "DOM_CAPTURE"] as const)(
    "retires an old SABA refresh after its awaited %s boundary", async (boundary) => {
    let releaseHeld!: (value: unknown) => void;
    let heldStarted = false;
    const held = new Promise<unknown>((resolve) => { releaseHeld = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-time-baseline")) {
        if (boundary === "TODAY_SELECTION") {
          heldStarted = true;
          return held;
        }
        return { result: { value: { status: "today-tab-active" } } };
      }
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        if (boundary === "DOM_CAPTURE") {
          heldStarted = true;
          return held;
        }
        return { result: { value: "[]" } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 10_000 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:73", tabId: 73 } as const;

    const refresh = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(heldStarted).toBe(true));
    observer.beginSourceEpoch(saba.sourceId);
    releaseHeld(boundary === "TODAY_SELECTION"
      ? { result: { value: { status: "today-tab-active" } } }
      : { result: { value: "[]" } });
    await refresh;

    const heapCalls = sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      /window\.(?:io|WebSocket)/u.test(String(params?.expression ?? "")));
    expect(heapCalls).toHaveLength(0);
    if (boundary === "TODAY_SELECTION") {
      expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
        params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toBe(false);
    }
  });

  it("stops SABA Today target discovery inside the selector when its source epoch retires", async () => {
    let releaseToday!: (value: unknown) => void;
    let todayStarted = false;
    const heldToday = new Promise<unknown>((resolve) => { releaseToday = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-time-baseline")) {
        todayStarted = true;
        return heldToday;
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", childFrames: [{ frame: { id: "child" } }] } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 91 };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 10_000 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:74", tabId: 74 } as const;

    const refresh = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(todayStarted).toBe(true));
    observer.beginSourceEpoch(saba.sourceId);
    releaseToday({ result: { value: null } });
    await refresh;

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Page.getFrameTree")).toHaveLength(0);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Page.createIsolatedWorld")).toHaveLength(0);
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      /window\.(?:io|WebSocket)/u.test(String(params?.expression ?? "")))).toHaveLength(0);
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression ?? "").includes("fieldline-saba-time-baseline"))).toHaveLength(1);
  });

  it("does not retain a Today-selected latch returned by a retired SABA source epoch", async () => {
    let releaseToday!: (value: unknown) => void;
    let holdFirst = true;
    const heldToday = new Promise<unknown>((resolve) => { releaseToday = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-time-baseline")) {
        if (holdFirst) return heldToday;
        return { result: { value: { status: "today-tab-selected" } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 10_000 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:75", tabId: 75 } as const;
    const firstRefresh = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method, params]) =>
      method === "Runtime.evaluate" && String(params?.expression ?? "")
        .includes("fieldline-saba-time-baseline"))).toBe(true));
    observer.beginSourceEpoch(saba.sourceId);
    releaseToday({ result: { value: { status: "today-tab-selected" } } });
    await firstRefresh;

    holdFirst = false;
    sendCommand.mockClear();
    await observer.refreshCatalog(saba);

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression ?? "").includes("fieldline-saba-time-baseline"))).toHaveLength(1);
  });

  it("publishes APSPORT API roster and hidden-detail batches without using the virtualized DOM", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    // OOPIF Page.getFrameTree can be unavailable even though the exact
    // main-world context just completed the authenticated page fetch.
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      expect(options.prematchWindowHours).toBe(24);
      expect(options.template).toMatchObject({
        origin: "https://pacific.agenate.com",
        headers: { "content-type": "application/json", authorization: "Bearer private" },
        body: { si: 1, mno: 2 }
      });
      const record = { "1": "league-1", "2": "event-1", "5": "Home", "6": true,
        "10": "Active", "11": null, "22": "Away", "50": [], "53": "League" };
      const batch = (phase: ApsportCatalogBatch["phase"]): ApsportCatalogBatch => ({
        schemaVersion: 1, generation: options.generation, phase, complete: true,
        prematchWindowHours: 24, records: [record]
      });
      await options.onRoster(batch("ROSTER"));
      await options.onDetail(batch("DETAIL"));
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: async (envelope) => { forwarded.push(envelope); },
      collectApsportCatalog: collect, observerSessionId: "observer-ap" });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", Authorization: "Bearer private",
          Cookie: "must-not-be-copied", Origin: "https://pacific.agenate.com" },
        postData: JSON.stringify({ si: 1, mno: 2 }) }
    });

    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });

    expect(collect).toHaveBeenCalledOnce();
    expect(forwarded).toHaveLength(2);
    expect(forwarded.every((envelope) => envelope.transport === "HTTP_RESPONSE" &&
      envelope.request.pathnameClass === "/__fieldline_apsport_catalog_refresh__")).toBe(true);
    expect(forwarded.map((envelope) => JSON.parse(envelope.payload.body).phase)).toEqual(["ROSTER", "DETAIL"]);
    expect(JSON.stringify(forwarded)).not.toMatch(/Bearer private|must-not-be-copied/iu);
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("fieldlineTsport"))).toHaveLength(0);

    forwarded.length = 0;
    await observer.replaySnapshots(apsport.sourceId);
    expect(forwarded).toHaveLength(1);
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ phase: "ROSTER", complete: true });
    expect(forwarded[0]!.request).toMatchObject({ replayed: true });
  });

  it("reports APSPORT detail completion and preserves only current prematch success across roster renewal", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let nowMs = 10_000;
    let invocation = 0;
    const prematch = (eventId: string) => ({ "1": "league-1", "2": eventId, "5": "Home", "6": false,
      "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League" });
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      invocation += 1;
      const records = invocation === 1
        ? [prematch("with-markets"), prematch("failed")]
        : [prematch("with-markets"), { ...prematch("failed"), "6": true }];
      await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
        complete: true, prematchWindowHours: 24, records });
      if (invocation !== 1) return;
      options.onDetailState?.({ eventId: "with-markets", state: "QUEUED" });
      options.onDetailState?.({ eventId: "failed", state: "QUEUED" });
      options.onDetailState?.({ eventId: "with-markets", state: "IN_FLIGHT" });
      options.onDetailState?.({ eventId: "with-markets", state: "SUCCESS", hasMarkets: true });
      options.onDetailState?.({ eventId: "failed", state: "IN_FLIGHT" });
      options.onDetailState?.({ eventId: "failed", state: "FAILURE" });
    });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const observer = new NetworkObserver({ sendCommand, now: () => nowMs,
      forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    await observer.refreshCatalog(apsport);
    await observer.heartbeat(apsport, "pacific.agenate.com");
    const firstHeartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(firstHeartbeat?.apsportDetail).toEqual({
      rosterEvents: 2, successfulEvents: 1, withMarketsEvents: 1, emptyEvents: 0,
      pendingEvents: 1, failedEvents: 1, queuedEvents: 0, inFlightEvents: 0,
      complete: false, oldestSuccessAgeMs: 0
    });

    nowMs = 12_000;
    observer.resetApsportRefreshCooldown(apsport.sourceId);
    await observer.refreshCatalog(apsport);
    await observer.heartbeat(apsport, "pacific.agenate.com");
    const renewedHeartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(renewedHeartbeat?.apsportDetail).toEqual({
      rosterEvents: 1, successfulEvents: 1, withMarketsEvents: 1, emptyEvents: 0,
      pendingEvents: 0, failedEvents: 0, queuedEvents: 0, inFlightEvents: 0,
      complete: true, oldestSuccessAgeMs: 2_000
    });
  });

  it("invalidates an old APSPORT in-flight success on source cleanup", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const record = { "1": "league-1", "2": "old", "5": "Home", "6": false,
      "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League" };
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
        complete: true, prematchWindowHours: 24, records: [record] });
      options.onDetailState?.({ eventId: "old", state: "IN_FLIGHT" });
      await blocked;
      options.onDetailState?.({ eventId: "old", state: "SUCCESS", hasMarkets: false });
    });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const observer = new NetworkObserver({ sendCommand, now: () => 10_000,
      forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    const refresh = observer.refreshCatalog(apsport);
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
    observer.beginSourceEpoch(apsport.sourceId);
    release();
    await refresh;
    await observer.heartbeat(apsport, "pacific.agenate.com");

    const heartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat?.apsportDetail).toBeUndefined();
  });

  it("does not let a failed APSPORT roster-only refresh poison independent detail work", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const records = ["event-1", "event-2"].map((eventId) => ({ "1": "league-1", "2": eventId,
        "5": `Home ${eventId}`, "6": false, "10": "Active", "11": "2026-09-06T01:00:00.000Z",
        "22": `Away ${eventId}`, "50": [], "53": "League" }));
      let invocation = 0;
      const observer = new NetworkObserver({
        sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
        forward: async (envelope) => { forwarded.push(envelope); },
        collectApsportCatalog: async (options) => {
          invocation += 1;
          if (invocation === 2) throw new Error("periodic roster request failed");
          await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
            complete: true, prematchWindowHours: 24, records });
        },
        collectApsportEventDetail: async (options) =>
          records.find((record) => record["2"] === options.eventId) ?? null,
        now: () => 10_000
      });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(400);
      observer.resetApsportRefreshCooldown(apsport.sourceId);
      await expect(observer.refreshCatalog(apsport, { rosterOnly: true }))
        .rejects.toThrow("APSPORT_REFRESH_FAILED");
      await observer.heartbeat(apsport, "pacific.agenate.com");

      const heartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
        .reverse().find((body) => body.kind === "WS_ATTACH");
      expect(heartbeat?.apsportDetail).toMatchObject({
        rosterEvents: 2, successfulEvents: 1, pendingEvents: 1,
        failedEvents: 0, queuedEvents: 1, inFlightEvents: 0
      });
      expect(heartbeat?.catalogShape).toContain("APSPORT_REFRESH_FAILED");
      expect(heartbeat?.catalogShape).not.toContain("periodic roster request failed");
      observer.beginSourceEpoch(apsport.sourceId);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a current failed APSPORT full sweep incomplete and lets its replacement recover", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let invocation = 0;
    const record = { "1": "league-1", "2": "event-1", "5": "Home", "6": false,
      "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League" };
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      invocation += 1;
      await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
        complete: true, prematchWindowHours: 24, records: [record] });
      options.onDetailState?.({ eventId: "event-1", state: "IN_FLIGHT" });
      if (invocation === 1) throw new Error("transient collector failure");
      options.onDetailState?.({ eventId: "event-1", state: "SUCCESS", hasMarkets: false });
    });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const observer = new NetworkObserver({ sendCommand, now: () => 10_000,
      forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    await expect(observer.refreshCatalog(apsport)).rejects.toThrow("APSPORT_REFRESH_FAILED");
    await observer.heartbeat(apsport, "pacific.agenate.com");
    const failed = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(failed?.apsportDetail).toMatchObject({ failedEvents: 1, complete: false });

    observer.resetApsportRefreshCooldown(apsport.sourceId);
    await expect(observer.refreshCatalog(apsport)).resolves.toBeUndefined();
    await observer.heartbeat(apsport, "pacific.agenate.com");
    const recovered = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(recovered?.apsportDetail).toMatchObject({ successfulEvents: 1, emptyEvents: 1,
      failedEvents: 0, complete: true });
  });

  it.each(["APSPORT_ROSTER_HTTP_0", "APSPORT_ROSTER_HTTP_503", "APSPORT_ROSTER_DATA_SHAPE"])(
    "propagates the allowlisted APSPORT roster failure %s", async (safeCode) => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({
      sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
      forward: async (envelope) => { forwarded.push(envelope); },
      collectApsportCatalog: async () => { throw new Error(safeCode); }
    });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    await expect(observer.refreshCatalog(apsport, { rosterOnly: true })).rejects.toThrow(safeCode);
    await observer.heartbeat(apsport, "pacific.agenate.com");
    const heartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat?.catalogShape).toContain(safeCode);
  });

  it("does not let a cancelled APSPORT generation poison newer detail evidence", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let invocation = 0;
    let releaseOld!: () => void;
    let signalOldReady!: () => void;
    const oldBlocked = new Promise<void>((resolve) => { releaseOld = resolve; });
    const oldReady = new Promise<void>((resolve) => { signalOldReady = resolve; });
    const record = { "1": "league-1", "2": "event-1", "5": "Home", "6": false,
      "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League" };
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      invocation += 1;
      await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
        complete: true, prematchWindowHours: 24, records: [record] });
      options.onDetailState?.({ eventId: "event-1", state: "QUEUED" });
      if (invocation !== 1) return;
      signalOldReady();
      await oldBlocked;
      options.onDetailState?.({ eventId: "event-1", state: "FAILURE" });
      throw new Error("cancelled generation finished late");
    });
    const observer = new NetworkObserver({
      sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
      forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect,
      collectApsportEventDetail: async () => record, now: () => 10_000
    });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    const oldRefresh = observer.refreshCatalog(apsport);
    await oldReady;
    const currentRefresh = observer.refreshCatalog(apsport, { rosterOnly: true });
    releaseOld();
    await Promise.all([oldRefresh, currentRefresh]);
    await observer.heartbeat(apsport, "pacific.agenate.com");

    const heartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .reverse().find((body) => body.kind === "WS_ATTACH");
    expect(heartbeat?.apsportDetail).toMatchObject({
      rosterEvents: 1, successfulEvents: 0, pendingEvents: 1,
      failedEvents: 0, queuedEvents: 1, inFlightEvents: 0
    });
    observer.beginSourceEpoch(apsport.sourceId);
  });

  it("holds a transient 451-to-266 APSPORT roster collapse without losing detail progress or queue", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const records = Array.from({ length: 451 }, (_, index) => ({ "1": "league-1", "2": `event-${index}`,
        "5": `Home ${index}`, "6": false, "10": "Active", "11": "2026-09-06T01:00:00.000Z",
        "22": `Away ${index}`, "50": [], "53": "League" }));
      let invocation = 0;
      const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
        invocation += 1;
        const roster = invocation === 2 ? records.slice(0, 266) : records;
        await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
          complete: true, prematchWindowHours: 24, records: roster });
      });
      const observer = new NetworkObserver({
        sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
        forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect,
        collectApsportEventDetail: async (options) => records[Number(options.eventId.slice(6))] ?? null,
        now: () => 10_000, monotonicNow: () => 500
      });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(400);
      observer.resetApsportRefreshCooldown(apsport.sourceId);
      await expect(observer.refreshCatalog(apsport, { rosterOnly: true }))
        .rejects.toThrow("APSPORT_ROSTER_COVERAGE_REJECTED_266_OF_451");
      await observer.heartbeat(apsport, "pacific.agenate.com");
      const rejectedHeartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
        .reverse().find((body) => body.kind === "WS_ATTACH");
      expect(rejectedHeartbeat?.catalogShape).toContain("APSPORT_ROSTER_COVERAGE_REJECTED_266_OF_451");

      observer.resetApsportRefreshCooldown(apsport.sourceId);
      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await observer.heartbeat(apsport, "pacific.agenate.com");

      const bodies = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>);
      expect(bodies.filter((body) => body.phase === "ROSTER")
        .map((body) => (body.records as unknown[]).length)).toEqual([451, 451]);
      expect(bodies.reverse().find((body) => body.kind === "WS_ATTACH")?.apsportDetail).toMatchObject({
        rosterEvents: 451, successfulEvents: 1, pendingEvents: 450, queuedEvents: 450
      });
      observer.beginSourceEpoch(apsport.sourceId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts initial, exact-ninety-percent, and verified-empty APSPORT rosters", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const all = Array.from({ length: 100 }, (_, index) => ({ "1": "league-1", "2": `event-${index}`,
      "5": `Home ${index}`, "6": false, "10": "Active", "11": "2026-09-06T01:00:00.000Z",
      "22": `Away ${index}`, "50": [], "53": "League" }));
    const rosters = [all.slice(0, 10), all, all.slice(0, 90), []] as const;
    let invocation = 0;
    const observer = new NetworkObserver({
      sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
      forward: async (envelope) => { forwarded.push(envelope); },
      collectApsportCatalog: async (options) => {
        const records = rosters[invocation++]!;
        await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
          complete: true, ...(records.length === 0 ? { verifiedEmpty: true as const } : {}),
          prematchWindowHours: 24, records });
      }
    });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    for (let index = 0; index < rosters.length; index += 1) {
      if (index > 0) observer.resetApsportRefreshCooldown(apsport.sourceId);
      await observer.refreshCatalog(apsport);
    }

    expect(forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
      .filter((body) => body.phase === "ROSTER").map((body) => (body.records as unknown[]).length))
      .toEqual([10, 100, 90, 0]);
  });

  it("subtracts exact inactive APSPORT details before judging the next roster baseline", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const all = Array.from({ length: 100 }, (_, index) => ({ "1": "league-1", "2": `event-${index}`,
        "5": `Home ${index}`, "6": false, "10": "Active", "11": "2026-09-06T01:00:00.000Z",
        "22": `Away ${index}`, "50": [], "53": "League" }));
      let invocation = 0;
      const observer = new NetworkObserver({
        sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
        forward: async (envelope) => { forwarded.push(envelope); },
        collectApsportCatalog: async (options) => {
          const records = invocation++ === 0 ? all : all.slice(30);
          await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
            complete: true, prematchWindowHours: 24, records });
        },
        collectApsportEventDetail: async (options) => {
          const index = Number(options.eventId.slice(6));
          const record = all[index];
          return record === undefined ? null : { ...record, "10": index < 30 ? "Suspended" : "Active" };
        },
        now: () => 10_000
      });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
        .filter((body) => body.phase === "DETAIL" &&
          ((body.records as Array<Record<string, unknown>>)[0]?.["10"] === "Suspended"))).toHaveLength(30);

      observer.resetApsportRefreshCooldown(apsport.sourceId);
      await observer.refreshCatalog(apsport, { rosterOnly: true });
      expect(forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
        .filter((body) => body.phase === "ROSTER").map((body) => (body.records as unknown[]).length))
        .toEqual([100, 70]);
      observer.beginSourceEpoch(apsport.sourceId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preempts a long APSPORT detail sweep and completes a roster-only bridge resync", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let invocation = 0;
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      invocation += 1;
      const record = { "1": "league-1", "2": "event-1", "5": "Home", "6": true,
        "10": "Active", "11": null, "22": "Away", "50": [], "53": "League" };
      await options.onRoster({ schemaVersion: 1, generation: options.generation,
        phase: "ROSTER", complete: true, prematchWindowHours: 24, records: [record] });
      if (invocation === 1) {
        await firstBlocked;
        if (!options.isCurrent()) return;
      }
      if (options.isCurrent()) {
        await options.onDetail({ schemaVersion: 1, generation: options.generation,
          phase: "DETAIL", complete: true, prematchWindowHours: 24, records: [record] });
      }
    });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const observer = new NetworkObserver({ sendCommand,
      forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    const detailSweep = observer.refreshCatalog(apsport, { prematchWindowHours: 24 });
    await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(1));
    const resync = observer.refreshCatalog(apsport, { prematchWindowHours: 24, rosterOnly: true });
    releaseFirst();
    await Promise.all([detailSweep, resync]);

    expect(collect).toHaveBeenCalledTimes(2);
    expect(forwarded.map((envelope) => JSON.parse(envelope.payload.body).phase))
      .toEqual(["ROSTER", "ROSTER"]);
  });

  it("coalesces repeated APSPORT roster-only recovery while the current roster is still loading", async () => {
    let finishRoster!: () => void;
    const blocked = new Promise<void>((resolve) => { finishRoster = resolve; });
    const collect = vi.fn(async () => blocked);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => { forwarded.push(envelope); },
      collectApsportCatalog: collect });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://spbui.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    const first = observer.refreshCatalog(apsport, { prematchWindowHours: 24, rosterOnly: true });
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
    const second = observer.refreshCatalog(apsport, { prematchWindowHours: 24, rosterOnly: true });
    await Promise.resolve();
    expect(collect).toHaveBeenCalledOnce();

    finishRoster();
    await Promise.all([first, second]);
    expect(collect).toHaveBeenCalledOnce();
  });

  it("queues only APSPORT prematch roster events for hidden-detail enrichment after a roster-only refresh", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const records = [
        { "1": "league-live", "2": "event-live", "5": "Home live", "6": true,
          "10": "Active", "11": null, "22": "Away live", "50": [], "53": "League" },
        { "1": "league-soon", "2": "event-soon", "5": "Home soon", "6": false,
          "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away soon", "50": [], "53": "League" },
        { "1": "league-far", "2": "event-far", "5": "Home far", "6": false,
          "10": "Active", "11": "2026-09-07T01:00:00.000Z", "22": "Away far", "50": [], "53": "League" }
      ];
      const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
        await options.onRoster({ schemaVersion: 1, generation: options.generation,
          phase: "ROSTER", complete: true, prematchWindowHours: 24, records });
      });
      const requested: string[] = [];
      const collectDetail = vi.fn(async (options: CollectApsportEventDetailOptions) => {
        requested.push(options.eventId);
        return records.find((record) => record["2"] === options.eventId) ?? null;
      });
      const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
        : {});
      const observer = new NetworkObserver({ sendCommand,
        forward: async (envelope) => { forwarded.push(envelope); },
        collectApsportCatalog: collect, collectApsportEventDetail: collectDetail,
        now: () => 10_000, monotonicNow: () => 500 });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
          postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(500);
      expect(collectDetail).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(collectDetail).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(500);

      expect(collectDetail).toHaveBeenCalledTimes(2);
      expect(requested.sort()).toEqual(["event-far", "event-soon"]);
      await observer.heartbeat(apsport, "pacific.agenate.com");
      const heartbeat = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
        .reverse().find((body) => body.kind === "WS_ATTACH");
      expect(heartbeat?.apsportDetail).toMatchObject({ rosterEvents: 2, successfulEvents: 2,
        emptyEvents: 2, pendingEvents: 0, failedEvents: 0, complete: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards a valid live transition without counting it or malformed detail as prematch success", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const records = ["turned-live", "malformed"].map((eventId) => ({
        "1": "league-1", "2": eventId, "5": "Home", "6": false, "10": "Active",
        "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League"
      }));
      const observer = new NetworkObserver({
        sendCommand: async (_tabId, method) => method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } } : {},
        forward: async (envelope) => { forwarded.push(envelope); },
        collectApsportCatalog: async (options) => {
          await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
            complete: true, prematchWindowHours: 24, records });
        },
        collectApsportEventDetail: async (options) => options.eventId === "turned-live"
          ? { ...records[0]!, "6": true }
          : { ...records[1]!, "50": [{ "3": 999, "9": [null] }] },
        now: () => 10_000, monotonicNow: () => 500
      });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(1_500);
      await observer.heartbeat(apsport, "pacific.agenate.com");

      const bodies = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>);
      expect(bodies.filter((body) => body.phase === "DETAIL")).toEqual([expect.objectContaining({
        trigger: "EVENT_CHANGE", records: [expect.objectContaining({ "2": "turned-live", "6": true })]
      })]);
      expect(bodies.reverse().find((body) => body.kind === "WS_ATTACH")?.apsportDetail).toMatchObject({
        rosterEvents: 1, successfulEvents: 0, pendingEvents: 1, failedEvents: 1, complete: false
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an empty APSPORT page only when a completed API roster proves matches exist", async () => {
    const healthSamples: unknown[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } };
      }
      if (method === "Runtime.evaluate" && params?.expression === TSPORT_CATALOG_SHAPE_EXPRESSION) {
        return { result: { value: JSON.stringify({ matchRows: 0 }) } };
      }
      return {};
    });
    const records = [{ "2": "event-1" }, { "2": "event-2" }];
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      onApsportPageHealth: (health: unknown) => { healthSamples.push(health); },
      collectApsportCatalog: async (options) => {
        await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
          complete: true, prematchWindowHours: 24, records });
      } });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://spbui.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });
    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });

    await observer.heartbeat(apsport, "pacific.agenate.com");

    expect(healthSamples).toEqual([{
      sourceId: "chrome:TSPORT:7", tabId: 7, rosterCount: 2, matchRows: 0
    }]);
  });

  it("refetches prematch APSPORT detail after an eu socket frame but skips live detail", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const live = { "1": "league-live", "2": "event-live", "5": "Home live", "6": true,
        "10": "Active", "11": null, "22": "Away live", "50": [], "53": "League" };
      const prematch = { "1": "league-prematch", "2": "event-prematch", "5": "Home prematch", "6": false,
        "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away prematch", "50": [], "53": "League" };
      const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
        await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
          complete: true, prematchWindowHours: 24, records: [live, prematch] });
      });
      const collectDetail = vi.fn(async (options: CollectApsportEventDetailOptions) => {
        expect(options.eventId).toBe("event-prematch");
        expect(options.leagueId).toBe("league-prematch");
        return prematch;
      });
      const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
        : {});
      const observer = new NetworkObserver({ sendCommand,
        forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect,
        collectApsportEventDetail: collectDetail, now: () => 10_000, monotonicNow: () => 500 });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
          postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });
      await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });
      await observer.handleEvent(apsport, "Network.webSocketCreated", {
        requestId: "ap-socket", url: "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0"
      });

      await observer.handleEvent(apsport, "Network.webSocketFrameReceived", {
        requestId: "ap-socket", response: { opcode: 1,
          payloadData: JSON.stringify({ s: 1, t: "eu", d: JSON.stringify(live) }) }
      });
      await observer.handleEvent(apsport, "Network.webSocketFrameReceived", {
        requestId: "ap-socket", response: { opcode: 1,
          payloadData: JSON.stringify({ s: 1, t: "eu", d: JSON.stringify(prematch) }) }
      });
      await vi.advanceTimersByTimeAsync(500);

      expect(collectDetail).toHaveBeenCalledOnce();
      const targeted = forwarded.map((envelope) => {
        try { return JSON.parse(envelope.payload.body) as Record<string, unknown>; } catch { return {}; }
      }).find((body) => body.trigger === "EVENT_CHANGE");
      expect(targeted).toMatchObject({ phase: "DETAIL", complete: false, trigger: "EVENT_CHANGE",
        records: [expect.objectContaining({ "2": "event-prematch" })] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one queued APSPORT event detail across a roster-only bootstrap", async () => {
    vi.useFakeTimers();
    try {
      const record = { "1": "league-1", "2": "event-42", "5": "Home", "6": false,
        "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League" };
      const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
        await options.onRoster({ schemaVersion: 1, generation: options.generation,
          phase: "ROSTER", complete: true, prematchWindowHours: 24, records: [record] });
      });
      const collectDetail = vi.fn(async () => record);
      const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
        : {});
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        collectApsportCatalog: collect, collectApsportEventDetail: collectDetail,
        now: () => 10_000, monotonicNow: () => 500 });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
          postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });
      await observer.refreshCatalog(apsport);
      await observer.handleEvent(apsport, "Network.webSocketCreated", {
        requestId: "ap-socket", url: "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0"
      });
      await observer.handleEvent(apsport, "Network.webSocketFrameReceived", {
        requestId: "ap-socket", response: { opcode: 1,
          payloadData: JSON.stringify({ s: 1, t: "eu", d: JSON.stringify(record) }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(500);

      expect(collect).toHaveBeenCalledTimes(2);
      expect(collectDetail).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an in-flight APSPORT event detail when a newer roster still contains the event", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const record = { "1": "league-1", "2": "event-42", "5": "Home", "6": false,
        "10": "Active", "11": "2026-09-06T01:00:00.000Z", "22": "Away", "50": [], "53": "League" };
      const generations: string[] = [];
      const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
        generations.push(options.generation);
        await options.onRoster({ schemaVersion: 1, generation: options.generation,
          phase: "ROSTER", complete: true, prematchWindowHours: 24, records: [record] });
      });
      let releaseDetail!: (value: typeof record) => void;
      const pendingDetail = new Promise<typeof record>((resolve) => { releaseDetail = resolve; });
      const collectDetail = vi.fn(async () => pendingDetail);
      const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
        : {});
      const observer = new NetworkObserver({ sendCommand,
        forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect,
        collectApsportEventDetail: collectDetail, now: () => 10_000, monotonicNow: () => 500 });
      const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
      await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
      });
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
          postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
      });

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      await vi.advanceTimersByTimeAsync(400);
      expect(collectDetail).toHaveBeenCalledOnce();

      await observer.refreshCatalog(apsport, { rosterOnly: true });
      releaseDetail(record);
      await vi.advanceTimersByTimeAsync(500);

      expect(generations).toHaveLength(2);
      const detail = forwarded.map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>)
        .find((body) => body.phase === "DETAIL");
      expect(detail).toMatchObject({ generation: generations[1], phase: "DETAIL",
        trigger: "EVENT_CHANGE", records: [expect.objectContaining({ "2": "event-42" })] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("bootstraps a cookie-bound APSPORT API template after an extension-worker reload", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldlineApsportBootstrap")) {
        return { result: { type: "object", value: { origin: "https://spbui.agenate.com",
          language: "vi", timeZone: "Asia/Bangkok" } } };
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } };
      }
      return {};
    });
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      expect(options.template).toEqual({
        origin: "https://spbui.agenate.com",
        headers: { "content-type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        body: { mno: 2, si: 1, mg: 1 }
      });
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      collectApsportCatalog: collect, observerSessionId: "observer-ap" });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });

    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });

    expect(collect).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenCalledWith(7, "Runtime.evaluate", expect.objectContaining({
      expression: expect.stringContaining("fieldlineApsportBootstrap"), contextId: 91,
      returnByValue: true, awaitPromise: false
    }));
  });

  it("bootstraps APSPORT from a discovered frame when Chrome does not replay existing contexts", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "ap-shell", loaderId: "loader-shell", url: "https://pacific.agenate.com/"
      }, childFrames: [{ frame: { id: "ap-app", loaderId: "loader-app",
        url: "https://spbui.agenate.com/" } }] } };
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: params?.frameId === "ap-app" ? 102 : 101 };
      }
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldlineApsportBootstrap")) {
        return { result: { type: "object", value: params?.contextId === 102
          ? { origin: "https://spbui.agenate.com", language: "vi", timeZone: "Asia/Bangkok" }
          : null } };
      }
      return {};
    });
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      expect(options.template).toEqual({
        origin: "https://spbui.agenate.com",
        headers: { "content-type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        body: { mno: 2, si: 1, mg: 1 }
      });
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      collectApsportCatalog: collect, observerSessionId: "observer-ap-discovery" });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;

    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });

    expect(collect).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenCalledWith(7, "Page.createIsolatedWorld", {
      frameId: "ap-app", worldName: "fieldline-apsport-catalog-refresh", grantUniveralAccess: false
    });
  });

  it("does not let its own APSPORT fetch replace and cancel the active request template", async () => {
    let finishEvaluation!: (value: unknown) => void;
    const evaluation = new Promise<unknown>((resolve) => { finishEvaluation = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fetch(input.url")) {
        return evaluation;
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    let observer!: NetworkObserver;
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      const pending = options.request({ kind: "EVENTS", mode: 2,
        url: "https://spbui.agenate.com/be-ui/pac/api/v3/events",
        body: { mno: "2", si: 1, mg: "1", do: "1" } });
      await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("fetch(input.url"))).toBe(true));
      await observer.handleEvent(apsport, "Network.requestWillBeSent", {
        requestId: "collector-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
        request: { method: "POST", url: "https://spbui.agenate.com/be-ui/pac/api/v3/events",
          headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
          postData: JSON.stringify({ mno: "2", si: 1, mg: "1", do: "1" }) }
      });
      finishEvaluation({ result: { value: { status: 200, data: [] } } });
      expect((await pending).status).toBe(200);
      expect(options.isCurrent()).toBe(true);
      await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
        complete: true, prematchWindowHours: 24, records: [] });
    });
    observer = new NetworkObserver({ sendCommand,
      forward: async (envelope) => { forwarded.push(envelope); }, collectApsportCatalog: collect });
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://spbui.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });

    expect(collect).toHaveBeenCalledOnce();
  });

  it("coalesces overlapping APSPORT refresh requests into one catalog generation", async () => {
    let finishCollect!: () => void;
    const blocked = new Promise<void>((resolve) => { finishCollect = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const collect = vi.fn(async () => blocked);
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      collectApsportCatalog: collect });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://spbui.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi", tz: "Asia/Bangkok" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });

    const first = observer.refreshCatalog(apsport, { prematchWindowHours: 24 });
    const second = observer.refreshCatalog(apsport, { prematchWindowHours: 24 });
    await vi.waitFor(() => expect(collect).toHaveBeenCalledOnce());
    let maintenanceSettled = false;
    const maintenance = observer.maintain(apsport).then(() => { maintenanceSettled = true; });
    await vi.waitFor(() => expect(maintenanceSettled).toBe(true));
    finishCollect();
    await Promise.all([first, second, maintenance]);

    expect(collect).toHaveBeenCalledOnce();
    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });
    expect(collect).toHaveBeenCalledOnce();
    observer.resetApsportRefreshCooldown(apsport.sourceId);
    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("keeps APSPORT active without walking its virtualized DOM", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "TSPORT", sourceId: "chrome:TSPORT:8", tabId: 8 });

    expect(sendCommand).toHaveBeenCalledWith(8, "Emulation.setFocusEmulationEnabled", { enabled: true });
    expect(sendCommand).toHaveBeenCalledWith(8, "Page.setWebLifecycleState", { state: "active" });
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.getFrameTree" ||
      method === "Page.createIsolatedWorld" || method === "Runtime.evaluate")).toBe(false);
  });

  it("does not start a background APSPORT DOM sweep from socket diagnostics", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:8", tabId: 8 } as const;

    await observer.heartbeat(apsport, "pacific.agenate.com");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION)).toBe(false);
  });

  it("keeps provider pages active and scrolls their real nested frames without clicking odds", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" }, childFrames: [{ frame: { id: "child" } }] } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 9 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "BTI", sourceId: "chrome:BTI:7", tabId: 7 });

    expect(sendCommand).toHaveBeenCalledWith(7, "Emulation.setFocusEmulationEnabled", { enabled: true });
    expect(sendCommand).toHaveBeenCalledWith(7, "Page.setWebLifecycleState", { state: "active" });
    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations).toHaveLength(2);
    expect(String(evaluations[0]?.[2]?.expression)).toContain("scrollHeight");
    expect(String(evaluations[0]?.[2]?.expression)).toContain("unsafeSelector");
    expect(String(evaluations[0]?.[2]?.expression)).toContain("slice(0, 12)");
  });

  it("keeps IM active without racing its explicit two-part snapshot recovery", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" } } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 9 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 });

    expect(sendCommand).toHaveBeenCalledWith(8, "Emulation.setFocusEmulationEnabled", { enabled: true });
    expect(sendCommand).toHaveBeenCalledWith(8, "Page.setWebLifecycleState", { state: "active" });
    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations).toHaveLength(0);
    // IM's request signer and platform globals live in the page's main world.
    // An isolated world can see the DOM but cannot call that signer, which
    // silently leaves the catalog on StatusCode 500 responses.
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Page.createIsolatedWorld")).toHaveLength(0);
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("truc tiep");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("bong da");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("/api/EventV6/GetSE");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("new CustomEvent('helo'");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("'x-sc': encodeURI(signature)");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("'x-v': '91938'");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("'x-platform': String(window.global?.PlatForm || '')");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("sessionStorage.getItem('to' + 'ken')");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).not.toContain("new URLSearchParams(location.search).get('to' + 'ken')");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("profile?.StatusCode === 100 && profile.im === true");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("credentials: 'omit'");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("SportId: 1");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("const betTypeIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 18, 19, 20, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 38, 39, 42, 43, 44, 45, 78, 79, 80, 158, 159, 160, 161, 299, 306, 313]");
    // The provider refuses a Market 1 query over its own budget, so that market
    // asks for a bounded prefix while Market 2 still carries the whole set.
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("betTypeIds.slice(0, MARKET_1_BET_TYPE_LIMIT)");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("GamePeriods: [1, 2, 3]");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("IsCombo: false");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("SortType: 2");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("CompetitionIds: []");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("const pair = [1, 2].map");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("Promise.all(pair)");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("StatusCode: catalog.parsed.StatusCode, sel:");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("new AbortController()");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("signal: controller.signal");
    // Native odds-format headers are required for the signed read request.
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).not.toMatch(/placebet|stake/iu);
    expect(() => new Function(`return ${IM_CATALOG_DISCOVERY_EXPRESSION}`)).not.toThrow();
  });

  it("requests both IM catalog partitions in page when snapshot recovery is requested", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" }, childFrames: [{ frame: { id: "im-app" } }] } }
      : method === "Runtime.evaluate"
        ? { result: { value: params?.contextId === 82
          ? { status: "catalog-requested", responses: [
            { market: 1, body: '{"sel":[],"StatusCode":100}' },
            { market: 2, body: '{"sel":[],"StatusCode":100}' }
          ] }
          : { status: "navigation-not-found", responses: [] } } }
        : {});
    const forwarded: ChromeBridgeEnvelope[] = [];
    const forward = vi.fn(async (message: ChromeBridgeEnvelope) => { forwarded.push(message); });
    const observer = new NetworkObserver({ sendCommand, forward });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Runtime.executionContextCreated", {
      context: { id: 81, auxData: { frameId: "top", isDefault: true } }
    });
    await observer.handleEvent(im, "Runtime.executionContextCreated", {
      context: { id: 82, auxData: { frameId: "im-app", isDefault: true } }
    });

    await observer.refreshCatalog(im);

    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.evaluate", {
      expression: expect.stringContaining("__fieldlineImNativeCatalogV1"),
      returnByValue: true,
      awaitPromise: true
    });
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.evaluate", {
      expression: expect.stringContaining("__fieldlineImNativeCatalogV1"),
      contextId: 82,
      returnByValue: true,
      awaitPromise: true
    });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "TAB_STATE",
      request: expect.objectContaining({ pathnameClass: "/__fieldline_im_catalog_refresh__" }),
      payload: expect.objectContaining({
        body: JSON.stringify({ results: ["top:navigation-not-found", "im-app:catalog-requested"] })
      })
      }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "HTTP_RESPONSE",
      request: expect.objectContaining({
        pathnameClass: "/api/EventV6/GetSE", providerPartition: "IM_MARKET_1",
        streamId: expect.stringMatching(/^im:8:/u)
      }),
      payload: expect.objectContaining({ body: '{"sel":[],"StatusCode":100}' })
    }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "HTTP_RESPONSE",
      request: expect.objectContaining({
        pathnameClass: "/api/EventV6/GetSE", providerPartition: "IM_MARKET_2",
        streamId: expect.stringMatching(/^im:8:/u)
      }),
      payload: expect.objectContaining({ body: '{"sel":[],"StatusCode":100}' })
    }));
    const partitions = forwarded
      .filter((message) => message.transport === "HTTP_RESPONSE");
    expect(new Set(partitions.map((message) => message.request.streamId)).size).toBe(1);
  });

  it("forwards a large IM in-page snapshot when the live frame tree omits loader ids", async () => {
    const largeBody = JSON.stringify({ StatusCode: 100,
      sel: [{ eid: 1, pad: "x".repeat(230_000) }] });
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" }, childFrames: [{ frame: { id: "im-app" } }] } }
      : method === "Runtime.evaluate"
        ? { result: { value: params?.contextId === 82
          ? { status: "catalog-requested", responses: [
            { market: 1, body: largeBody }, { market: 2, body: largeBody }
          ] }
          : { status: "navigation-not-found", responses: [] } } }
        : {});
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: async (message) => { forwarded.push(message); } });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Runtime.executionContextCreated", {
      context: { id: 82, auxData: { frameId: "im-app", isDefault: true } }
    });

    await observer.refreshCatalog(im);

    const chunks = forwarded.filter((message) => message.transport === "HTTP_RESPONSE");
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((message) => typeof message.request.requestFrameKey === "string" &&
      typeof message.request.requestDocumentKey === "string")).toBe(true);
    expect(new Set(chunks.map((message) => message.request.providerPartition)))
      .toEqual(new Set(["IM_MARKET_1", "IM_MARKET_2"]));
  });

  it("does not forward IM recovery after its owning OOPIF detaches during evaluation", async () => {
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top" }, childFrames: [{ frame: {
      id: "im-app", loaderId: "loader-im"
    } }] } };
    let observer!: NetworkObserver;
    let detached = false;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      if (method === "Page.getFrameTree") {
        if (sessionId === "im-child" && detached) throw new Error("detached");
        return frameTree;
      }
      if (method === "Runtime.evaluate" && params?.contextId === 82 && sessionId === "im-child") {
        detached = true;
        await observer.handleEvent(im, "Target.detachedFromTarget", { sessionId: "im-child" });
        return { result: { value: { status: "catalog-requested", responses: [
          { market: 1, body: '{"sel":[],"StatusCode":100}' },
          { market: 2, body: '{"sel":[],"StatusCode":100}' }
        ] } } };
      }
      return { result: { value: { status: "navigation-not-found", responses: [] } } };
    });
    const forward = vi.fn(async (_message: ChromeBridgeEnvelope) => undefined);
    observer = new NetworkObserver({ sendCommand, forward });
    await observer.handleEvent(im, "Runtime.executionContextCreated", {
      context: { id: 82, auxData: { frameId: "im-app", isDefault: true } }
    }, "im-child");

    await observer.refreshCatalog(im);

    expect(sendCommand.mock.calls.some(([, method, params, sessionId]) => method === "Runtime.evaluate" &&
      params?.contextId === 82 && sessionId === "im-child")).toBe(true);
    expect(forward.mock.calls.some(([message]) => message.transport === "HTTP_RESPONSE")).toBe(false);
  });

  it("coalesces concurrent IM snapshot recovery so both large partitions are fetched once", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Runtime.evaluate") {
        await pending;
        return { result: { value: { status: "catalog-requested", responses: [] } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    const first = observer.refreshCatalog(im);
    const second = observer.refreshCatalog(im);
    await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate"))
      .toHaveLength(1));
    release();
    await Promise.all([first, second]);

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1);
  });

  it("forwards CMD native Early scope and exact More owner without request credentials", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const group = "fa97fe7b-13d3-4b03-96db-68aca62dd73f";
    const frameTree = { frameTree: { frame: { id: "odds", loaderId: "loader",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx" } } };
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Network.getResponseBody") return { body: JSON.stringify({ d: [group, 25403104, [], []] }), base64Encoded: false };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward });
    const paths = ["/Member/BetsView/BetLight/DataOdds.ashx", "/Member/BetsView/BetLight/DataOdds.asmx/GetAllOdds"];
    const bodies = ["fc=6&TimeFilter=0&m_gameType=S_&SingleDouble=double&m_sp=0&m_LeagueList=&fav=&keywords=&exlist=0",
      JSON.stringify({ m_groupId: group, isPar: 0, m_accId: "private-account" })];
    for (let index = 0; index < paths.length; index += 1) {
      const url = "https://cgnew.fts368.com" + paths[index];
      const requestId = "cmd-native-" + index;
      await observer.handleEvent(cmd, "Network.requestWillBeSent", { requestId, frameId: "odds", loaderId: "loader",
        type: "XHR", request: { url, method: "POST", postData: bodies[index] } });
      await observer.handleEvent(cmd, "Network.responseReceived", { requestId, type: "XHR", response: { url, status: 200 } });
      await observer.handleEvent(cmd, "Network.loadingFinished", { requestId });
    }
    const requests = forward.mock.calls.map(([envelope]) => envelope.request);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ cmdFullScope: true, providerFunctionCode: 6, reconcileCutoffSequence: 0 });
    expect(requests[1]).toMatchObject({ providerGroupId: group, requestDocumentKey: expect.any(String) });
    expect(JSON.stringify(requests)).not.toContain("private-account");
  });

  it("keeps CMD fallback and recovery quiet for the native request cooldown", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    let nowMs = 1_000;
    const frameTree = { frameTree: { frame: { id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx" } } };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate" && String(params?.expression).includes("__fieldlineCmdNativeCatalogV1")) {
        return { result: { value: { status: "ready", requestPaused: true, requestRetryInMs: 120_000 } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => nowMs });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    });
    await observer.recoverCmdCatalog(cmd);
    expect(observer.cmdRequestsPaused(cmd.sourceId)).toBe(true);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_FULL_BASELINE_EXPRESSION)).toBe(false);
    nowMs += 120_001;
    expect(observer.cmdRequestsPaused(cmd.sourceId)).toBe(false);
  });

  it("blocks the legacy CMD request in the page even before the observer learns of HTTP backoff", () => {
    let calls = 0;
    const run = new Function("location", "document", "globalThis", "Date", `return ${CMD_FULL_BASELINE_EXPRESSION}`);
    const location = { hostname: "cgnew.fts368.com", pathname: "/Member/BetOdds/HdpDouble.aspx" };
    const document = { documentElement: { __fieldlineCmdNativeCatalogV1: { retryAtMs: 120_000 } } };
    const globals = { LoadFullRunningTodayData: () => { calls += 1; } };
    expect(run(location, document, globals, { now: () => 119_999 })).toBe("busy");
    expect(calls).toBe(0);
    expect(run(location, document, globals, { now: () => 120_000 })).toBe("baseline-requested");
    expect(calls).toBe(1);
  });

  it("checks the actual CMD document for cooldown before recovery can navigate", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const frameTree = { frameTree: { frame: { id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx" } } };
    const observer = new NetworkObserver({ now: () => 1_000, forward: async () => undefined,
      sendCommand: async (_tabId, method, _params, sessionId) => {
        if (method === "Page.getFrameTree") return frameTree;
        if (method === "Runtime.evaluate") {
          expect(sessionId).toBe("child-session");
          return { result: { value: 120_000 } };
        }
        return {};
      } });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");
    expect(observer.cmdRequestsPaused(cmd.sourceId)).toBe(false);
    expect(await observer.probeCmdRequestsPaused(cmd)).toBe(true);
    expect(observer.cmdRequestsPaused(cmd.sourceId)).toBe(true);
  });

  it("evaluates CMD recovery on the owning child session and completes only a matching current-loader fc=1", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    let nowMs = 1_000;
    const row = Array<unknown>(91).fill(null);
    Object.assign(row, { 0: 25299763, 3: 108007, 10: 0.25, 12: 2.5, 25: 1,
      37: "League", 38: "Home", 39: "Away", 40: 0.8, 41: -0.9, 42: 0.8, 43: -0.9,
      53: "1H 4", 56: "08/24", 79: 0 });
    const metadataRow = Array.from({ length: 128 }, (_value, index) =>
      index % 2 === 0 ? (index / 2) + 1 : `Public ${index}`);
    const bodies = new Map<string, string>();
    let evaluations = 0;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top",
      url: "https://cgnew.fts368.com/root" }, childFrames: [{ frame: {
      id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
    } }] } };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      _sessionId?: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate" && params?.expression === CMD_FULL_BASELINE_EXPRESSION) {
        evaluations += 1;
        return { result: { value: evaluations === 1 ? "busy" : "baseline-requested" } };
      }
      if (method === "Network.getResponseBody") {
        return { body: bodies.get(String(params?.requestId)) ?? "{}", base64Encoded: false };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "observer-cmd", now: () => nowMs,
      cmdRecoveryMaxAttempts: 20, cmdRecoveryDeadlineMs: 2_000, cmdRecoveryRetryMs: 50 });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");
    expect(observer.hasCompleteCmdBaselineSince(cmd.sourceId, nowMs)).toBe(false);

    let settled = 0;
    const recovery = observer.refreshCatalog(cmd).finally(() => { settled += 1; });
    await vi.waitFor(() => expect(evaluations).toBeGreaterThanOrEqual(2));
    expect(settled).toBe(0);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")
      .every((call) => call[3] === "child-session")).toBe(true);

    const completeRequest = async (requestId: string, functionCode: number, body: string,
      loaderId = "loader-current"): Promise<void> => {
      bodies.set(requestId, body);
      const providerUrl = `https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx?fc=${functionCode}`;
      await observer.handleEvent(cmd, "Network.requestWillBeSent", { requestId, type: "XHR",
        frameId: "odds-frame", loaderId,
        request: { url: providerUrl, method: "GET", headers: {} } }, "child-session");
      await observer.handleEvent(cmd, "Network.responseReceived", { requestId, type: "XHR",
        response: { url: providerUrl, mimeType: "application/json" } }, "child-session");
      await observer.handleEvent(cmd, "Network.loadingFinished", { requestId }, "child-session");
    };

    await completeRequest("wrong-function", 3, JSON.stringify({ t: 101, a: true, data: [] }));
    await completeRequest("wrong-loader", 1,
      JSON.stringify({ t: 102, a: true, data: [], today: [row], f: [] }), "loader-old");
    await completeRequest("partial-full", 1, JSON.stringify({ t: 103, a: true, data: [] }));
    expect(settled).toBe(0);

    await completeRequest("malformed-full", 1,
      JSON.stringify({ t: "104", a: true, data: [], today: [Array(91).fill(null)], f: [] }));
    expect(settled).toBe(0);

    const recoveryStartedAtMs = nowMs;
    nowMs += 1;
    await completeRequest("matching-full", 1,
      JSON.stringify({ t: "105", a: true, data: [metadataRow], today: [row], f: [] }));
    await Promise.resolve();
    expect(settled).toBe(1);
    await recovery;
    await observer.handleEvent(cmd, "Network.loadingFinished", { requestId: "matching-full" }, "child-session");

    expect(settled).toBe(1);
    expect(observer.hasCompleteCmdBaselineSince(cmd.sourceId, recoveryStartedAtMs)).toBe(true);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
    expect(CMD_FULL_BASELINE_EXPRESSION).toContain("LoadFullRunningTodayData()");
    observer.beginSourceEpoch(cmd.sourceId);
    expect(observer.hasCompleteCmdBaselineSince(cmd.sourceId, recoveryStartedAtMs)).toBe(false);
  });

  it("replays sticky CMD root contexts and recovers its same-process odds frame after worker restart", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const row = Array<unknown>(91).fill(null);
    Object.assign(row, { 0: 25299763, 3: 108007, 10: 0.25, 12: 2.5, 25: 1,
      37: "League", 38: "Home", 39: "Away", 40: 0.8, 41: -0.9, 42: 0.8, 43: -0.9,
      53: "1H 4", 56: "08/24", 79: 0 });
    const metadataRow = Array.from({ length: 128 }, (_value, index) =>
      index % 2 === 0 ? (index / 2) + 1 : `Public ${index}`);
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top",
      url: "https://cgnew.fts368.com/root" }, childFrames: [{ frame: {
      id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
    } }] } };
    const childFrameTree = { frameTree: { frame: { id: "unrelated-oopif", loaderId: "loader-child",
      url: "https://cgnew.fts368.com/unrelated" } } };
    const bodies = new Map<string, string>();
    let observer!: NetworkObserver;
    let runtimeReset = false;
    let evaluations = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      if (method === "Runtime.disable" && sessionId === undefined) {
        runtimeReset = true;
        await observer.handleEvent(cmd, "Runtime.executionContextsCleared", {});
      }
      if (method === "Runtime.enable" && sessionId === undefined && runtimeReset) {
        await observer.handleEvent(cmd, "Runtime.executionContextCreated", { context: { id: 91,
          auxData: { frameId: "odds-frame", isDefault: true } } });
      }
      if (method === "Page.getFrameTree") return sessionId === "child-session" ? childFrameTree : frameTree;
      if (method === "Runtime.evaluate" && params?.expression === CMD_FULL_BASELINE_EXPRESSION) {
        evaluations += 1;
        return { result: { value: "baseline-requested" } };
      }
      if (method === "Network.getResponseBody") {
        return { body: bodies.get(String(params?.requestId)) ?? "{}", base64Encoded: false };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "observer-cmd-root",
      cmdRecoveryMaxAttempts: 20, cmdRecoveryDeadlineMs: 2_000, cmdRecoveryRetryMs: 10 });

    await observer.start(cmd);
    // CDP execution-context ids are scoped to each target session. This child
    // deliberately reuses the root odds-frame id to prove ownership remains
    // bound to the frame + session tuple rather than the bare numeric id.
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", { context: { id: 91,
      auxData: { frameId: "retired-oopif", isDefault: true } } }, "retired-child-session");
    await observer.handleEvent(cmd, "Runtime.executionContextDestroyed", { executionContextId: 91 },
      "retired-child-session");
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", { context: { id: 91,
      auxData: { frameId: "unrelated-oopif", isDefault: true } } }, "child-session");
    let settled = 0;
    const recovery = observer.recoverCmdCatalog(cmd).finally(() => { settled += 1; });
    await vi.waitFor(() => expect(evaluations).toBeGreaterThan(0));
    expect(settled).toBe(0);

    const completeRequest = async (requestId: string, functionCode: number, body: string,
      loaderId = "loader-current"): Promise<void> => {
      bodies.set(requestId, body);
      const providerUrl = "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx";
      await observer.handleEvent(cmd, "Network.requestWillBeSent", { requestId, type: "XHR",
        frameId: "odds-frame", loaderId,
        request: { url: providerUrl, method: "POST", postData: `fc=${functionCode}`, headers: {
          "content-type": "application/x-www-form-urlencoded"
        } } });
      await observer.handleEvent(cmd, "Network.responseReceived", { requestId, type: "XHR",
        response: { url: providerUrl, mimeType: "application/json" } });
      await observer.handleEvent(cmd, "Network.loadingFinished", { requestId });
    };

    await completeRequest("root-wrong-function", 3,
      JSON.stringify({ t: 201, a: true, data: [], today: [row], f: [] }));
    await completeRequest("root-stale-loader", 1,
      JSON.stringify({ t: 202, a: true, data: [], today: [row], f: [] }), "loader-old");
    expect(settled).toBe(0);

    await completeRequest("root-matching-full", 1,
      JSON.stringify({ t: "203", a: true, data: [metadataRow], today: [row], f: [] }));
    await vi.waitFor(() => expect(settled).toBe(1));
    await recovery;

    const rootMethods = sendCommand.mock.calls.filter(([, , , sessionId]) => sessionId === undefined)
      .map(([, method]) => method);
    expect(rootMethods.indexOf("Runtime.disable")).toBeLessThan(rootMethods.indexOf("Runtime.enable"));
    expect(rootMethods.indexOf("Runtime.enable")).toBeLessThan(rootMethods.indexOf("Target.setAutoAttach"));
    expect(sendCommand).toHaveBeenCalledWith(9, "Runtime.evaluate", expect.objectContaining({
      expression: CMD_FULL_BASELINE_EXPRESSION, contextId: 91
    }), undefined);
    expect(sendCommand.mock.calls.some(([, method, params, sessionId]) =>
      method === "Runtime.evaluate" && params?.expression === CMD_FULL_BASELINE_EXPRESSION &&
      sessionId === "child-session")).toBe(false);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "HTTP_RESPONSE",
      request: expect.objectContaining({ method: "POST", providerFunctionCode: 1,
        requestFrameKey: expect.any(String), requestDocumentKey: expect.any(String) }),
      payload: expect.objectContaining({ body: expect.stringContaining('"t":"203"') }) }));
  });

  it("bounds CMD recovery by its absolute deadline while Runtime.evaluate is still pending", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top",
      url: "https://cgnew.fts368.com/root" }, childFrames: [{ frame: {
      id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
    } }] } };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate") return new Promise<unknown>(() => undefined);
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      frameCommandTimeoutMs: 80, cmdRecoveryMaxAttempts: 2,
      cmdRecoveryDeadlineMs: 20, cmdRecoveryRetryMs: 1 });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");

    const outcome = await Promise.race([
      observer.refreshCatalog(cmd).then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 60))
    ]);

    expect(outcome).toBe("resolved");
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
  });

  it("retires an in-flight CMD recovery before starting the replacement source epoch", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top",
      url: "https://cgnew.fts368.com/root" }, childFrames: [{ frame: {
      id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
    } }] } };
    let evaluations = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate" && params?.expression === CMD_FULL_BASELINE_EXPRESSION) {
        evaluations += 1;
        if (evaluations === 1) return new Promise<unknown>(() => undefined);
        return { result: { value: "function-unavailable" } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "observer-cmd", frameCommandTimeoutMs: 200,
      cmdRecoveryDeadlineMs: 200, cmdRecoveryMaxAttempts: 2, cmdRecoveryRetryMs: 1 });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");

    const retired = observer.recoverCmdCatalog(cmd);
    await vi.waitFor(() => expect(evaluations).toBe(1));
    observer.beginSourceEpoch(cmd.sourceId);
    const replacement = observer.recoverCmdCatalog(cmd);

    expect(replacement).not.toBe(retired);
    await retired;
    await replacement;
    expect(evaluations).toBe(2);
  });

  it("releases an in-flight CMD recovery synchronously when its tab detaches", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top",
      url: "https://cgnew.fts368.com/root" }, childFrames: [{ frame: {
      id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
    } }] } };
    let evaluations = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate") {
        evaluations += 1;
        return new Promise<unknown>(() => undefined);
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "observer-cmd", frameCommandTimeoutMs: 200,
      cmdRecoveryDeadlineMs: 200, cmdRecoveryMaxAttempts: 2, cmdRecoveryRetryMs: 1 });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");

    const retired = observer.recoverCmdCatalog(cmd);
    await vi.waitFor(() => expect(evaluations).toBe(1));
    observer.releaseTab(cmd.tabId);

    await expect(Promise.race([retired.then(() => "released"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 40))])).resolves.toBe("released");
  });

  it("releases an in-flight CMD recovery when its exact child session or context detaches", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top",
      url: "https://cgnew.fts368.com/root" }, childFrames: [{ frame: {
      id: "odds-frame", loaderId: "loader-current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
    } }] } };
    let evaluations = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate") {
        evaluations += 1;
        return new Promise<unknown>(() => undefined);
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "observer-cmd", frameCommandTimeoutMs: 200,
      cmdRecoveryDeadlineMs: 200, cmdRecoveryMaxAttempts: 2, cmdRecoveryRetryMs: 1 });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");

    const retired = observer.recoverCmdCatalog(cmd);
    await vi.waitFor(() => expect(evaluations).toBe(1));
    await observer.handleEvent(cmd, "Target.detachedFromTarget", { sessionId: "child-session" });

    await expect(Promise.race([retired.then(() => "released"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 40))])).resolves.toBe("released");

    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 92, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "replacement-child-session");
    const contextRetired = observer.recoverCmdCatalog(cmd);
    await vi.waitFor(() => expect(evaluations).toBe(2));
    await observer.handleEvent(cmd, "Runtime.executionContextDestroyed", { executionContextId: 92 },
      "replacement-child-session");
    await expect(Promise.race([contextRetired.then(() => "released"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 40))])).resolves.toBe("released");
  });

  it("announces an IM generation cutoff before the signed page fetch begins", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Runtime.evaluate") {
        await blocked;
        return { result: { value: { status: "catalog-requested", responses: [] } } };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000,
      monotonicNow: () => 50, observerSessionId: "observer-im" });
    const refreshing = observer.refreshCatalog({ lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "TAB_STATE", sequence: 0,
      request: expect.objectContaining({ pathnameClass: "/__fieldline_im_reconciliation_start__",
        streamId: "im:8:1", reconcileCutoffSequence: 0 }) }));
    release();
    await refreshing;
  });

  it("falls back to retained SBOBET STOMP partitions when a fresh same-tab request is unavailable", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    const live = ksportFullReceipt("live", 100);
    const today = ksportFullReceipt("today", 104);
    await observer.ingestWebSocketFrame(source, "wss://d42.sb21.net/sport/socket", live);
    await observer.ingestWebSocketFrame(source, "wss://d42.sb21.net/sport/socket", today);
    forward.mockClear();

    await observer.refreshCatalog(source);

    expect(sendCommand.mock.calls.map(([, method]) => method))
      .toEqual(["Runtime.evaluate", "Page.getFrameTree", "Target.getTargets"]);
    expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
    expect(forward).toHaveBeenCalledTimes(3);
    expect(forward.mock.calls.map(([envelope]) => envelope.transport))
      .toEqual(["TAB_STATE", "WS_FRAME", "WS_FRAME"]);
    expect(forward.mock.calls[0]![0].payload.body).toContain("KSPORT_REFRESH_FAILED");
    expect(forward.mock.calls.slice(1).every(([envelope]) => envelope.request.replayed === true)).toBe(true);
  });

  it("keeps the bounded HTTP status and partition when a KSPORT target rejects recovery", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression ?? "")
        .includes("fieldline-ksport-catalog-refresh")) {
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-failed",
          timeRange: "live", code: 401, page: "https://zenandfe.com/", method: "POST",
          rangeCarrier: "BODY", hasPostData: true } } };
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
      if (method === "Target.getTargets") return { targetInfos: [] };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

    await observer.refreshCatalog(source);

    const failure = forwarded.find((envelope) => envelope.request.pathnameClass ===
      "/__fieldline_ksport_refresh__");
    expect(JSON.parse(failure?.payload.body ?? "null")).toEqual({ kind: "KSPORT_REFRESH_FAILED",
      attempts: [{ target: "CONTEXT", status: "fieldline-ksport-catalog-refresh-failed",
        page: "https://zenandfe.com/", timeRange: "live", code: 401, method: "POST",
        rangeCarrier: "BODY", hasPostData: true }] });
  });

  it("does not fall back to the virtualized TSPORT DOM when no safe API template exists", async () => {
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        params?: Record<string, unknown>, _sessionId?: string) => {
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
        }
        if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
        return {};
      });
      const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
      const observer = new NetworkObserver({ sendCommand, forward });
      const provider = { lobby: "TSPORT", sourceId: "chrome:TSPORT:8", tabId: 8 } as const;
      await observer.handleEvent(provider, "Network.webSocketCreated", {
        requestId: "tsport-catalog", url: "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0"
      }, "tsport-child");
      await observer.handleEvent(provider, "Network.webSocketCreated", {
        requestId: "tsport-auxiliary", url: "wss://spws.agenate.com/ln/en/notifications"
      }, "tsport-child");
      forward.mockClear();

      await observer.refreshCatalog(provider);

      expect(forward).not.toHaveBeenCalled();
      expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
        params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION)).toBe(false);
      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.closeWebSocket")).toBe(false);
      expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects" ||
        method === "Runtime.callFunctionOn")).toBe(false);
      expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
  });

  it("leaves an unchanged completed TSPORT sweep to bounded hard recovery", async () => {
    const snapshot = JSON.stringify([{ eventId: "event-1", markets: [{ marketId: "market-1" }] },
      { __fieldlineSweep: { sweepId: "tsport-refresh-sweep", complete: true } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
      if (method === "Runtime.evaluate" && params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: snapshot } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:8", tabId: 8 } as const;
    await observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    await observer.handleEvent(tsport, "Network.webSocketCreated", {
      requestId: "tsport-current", url: "wss://spws.racern.com/ln/en/s/1/mg/0/tr/0"
    });
    sendCommand.mockClear();

    await observer.refreshCatalog(tsport);

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.closeWebSocket")).toBe(false);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects" ||
      method === "Runtime.callFunctionOn")).toBe(false);
  });

  it("never starts a heap-wide TSPORT socket query when the observed socket is unavailable", async () => {
    const snapshot = JSON.stringify([{ eventId: "event-1", markets: [{ marketId: "market-1" }] },
      { __fieldlineSweep: { sweepId: "tsport-orphan-sweep", complete: true } }]);
    const never = new Promise<unknown>(() => undefined);
    const sendCommand = vi.fn(async (tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: `top-${tabId}`, loaderId: `loader-${tabId}` } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: tabId };
      if (method === "Runtime.evaluate" && params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: snapshot } };
      }
      if (tabId === 8 && method === "Runtime.evaluate") return { result: { objectId: "tsport-prototype" } };
      if (method === "Runtime.queryObjects") return never;
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      frameCommandTimeoutMs: 5, btiCatalogRefreshTimeoutMs: 5 });

    await Promise.all([
      observer.refreshCatalog({ lobby: "TSPORT", sourceId: "chrome:TSPORT:orphan", tabId: 8 }),
      observer.refreshCatalog({ lobby: "BTI", sourceId: "chrome:BTI:healthy", tabId: 9 })
    ]);

    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(false);
    expect(sendCommand.mock.calls.some(([tabId]) => tabId === 9)).toBe(true);
  });

  it("fails closed instead of reconnecting TSPORT from an incomplete sweep", async () => {
    const snapshot = JSON.stringify([{ eventId: "event-1", markets: [{ marketId: "market-1" }] },
      { __fieldlineSweep: { sweepId: "tsport-incomplete-sweep", complete: false } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
      if (method === "Runtime.evaluate" && params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: snapshot } };
      }
      if (method === "Runtime.evaluate") return { result: { objectId: "tsport-websocket-prototype" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "tsport-websocket-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.refreshCatalog({ lobby: "TSPORT", sourceId: "chrome:TSPORT:8", tabId: 8 });

    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.callFunctionOn")).toBe(false);
  });

  it("reconnects a silently dead SABA socket before 30s freshness expires, with bounded retries", async () => {
    let now = 1_000;
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression ===
        "window.io && window.io.Socket && window.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => now });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    const reconnects = () => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" &&
      String(params?.functionDeclaration).includes("socket.disconnect(); socket.connect()")).length;

    // First poll seeds the silence clock; no reconnect yet.
    await observer.pollSabaDomChanges(source, "push.example");
    expect(reconnects()).toBe(0);

    now = 15_000;
    await observer.pollSabaDomChanges(source, "push.example");
    expect(reconnects()).toBe(0);

    now = 22_000;
    await observer.pollSabaDomChanges(source, "push.example");
    await vi.waitFor(() => expect(reconnects()).toBe(1));

    now = 30_000;
    await observer.pollSabaDomChanges(source, "push.example");
    expect(reconnects()).toBe(1);

    now = 43_000;
    await observer.pollSabaDomChanges(source, "push.example");
    expect(reconnects()).toBe(1);
    now = 52_000;
    await observer.pollSabaDomChanges(source, "push.example");
    await vi.waitFor(() => expect(reconnects()).toBe(2));
  });

  it("does not force a SABA reconnect while catalog frames keep arriving", async () => {
    let now = 1_000;
    const sendCommand = vi.fn(async (_tabId: number, _method: string) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => now });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    const frame = (sequence: number) => observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "saba-ws", response: { opcode: 1,
        payloadData: `42${JSON.stringify(["m", "b11", [[0, "o", 2, 1, 1, sequence]], sequence])}` } });

    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "saba-ws", url: "wss://push.example/socket.io/" });
    await observer.pollSabaDomChanges(source, "push.example");
    await frame(1);
    now = 55_000;
    await frame(2);
    now = 100_000;
    await observer.pollSabaDomChanges(source, "push.example");
    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(false);
  });

  it("retains TSPORT event frames from the live-view socket path (p/2, mg/1) for replay", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9 } as const;
    const url = "wss://spws.agenate.com/ln/en/p/2/u/MxcZnFVvGKUOdnHngKzURw==/s/1/mg/1/tr/0";
    const body = JSON.stringify({ s: 1, t: "eu", tmrg: "0", d: JSON.stringify({ "2": 5659739 }) });

    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "ts-ws", url });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "ts-ws",
      response: { opcode: 1, payloadData: body } });
    forward.mockClear();

    await observer.replaySnapshots(source.sourceId);

    expect(forward.mock.calls.some(([envelope]) => envelope.transport === "WS_FRAME" &&
      envelope.payload.body === body)).toBe(true);
  });

  it("escalates a SABA source once when heap reconnect cannot recreate an owned socket", async () => {
    let now = 1_000;
    const onSabaSocketUnavailable = vi.fn(async () => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined),
      now: () => now,
      monotonicNow: () => now,
      onSabaSocketUnavailable
    });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    await observer.pollSabaDomChanges(source, "push.example");
    now = 47_000;
    await observer.pollSabaDomChanges(source, "push.example");
    await vi.waitFor(() => expect(onSabaSocketUnavailable).toHaveBeenCalledExactlyOnceWith(source));

    now = 68_000;
    await observer.pollSabaDomChanges(source, "push.example");
    await Promise.resolve();
    expect(onSabaSocketUnavailable).toHaveBeenCalledTimes(1);
  });

  it("keeps SABA DOM authority through a measured 120-second sweep gap before bounded recovery", async () => {
    vi.useFakeTimers();
    let now = 5_000;
    let catalogReady = false;
    const records = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `market-${index}`, priceText: "0.91" },
          { marketOddsId: `market-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: catalogReady ? records : "[]" } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const onSabaSocketUnavailable = vi.fn(async () => undefined);
    const observer = new NetworkObserver({
      sendCommand,
      forward: vi.fn(async () => undefined),
      now: () => now,
      monotonicNow: () => now,
      onSabaSocketUnavailable
    });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    const advance = async (delayMs: number): Promise<void> => {
      now += delayMs;
      await vi.advanceTimersByTimeAsync(delayMs);
    };

    try {
      // Seed the missing-baseline watchdog before the first usable DOM sweep
      // completes, matching a worker that attaches partway through a sweep.
      await observer.pollSabaDomChanges(source, "sports.example");
      catalogReady = true;
      await advance(15_000);
      await observer.pollSabaDomChanges(source, "sports.example");
      expect(observer.hasUsableSabaCatalog(source.sourceId)).toBe(true);

      // The measured complete DOM cadence reaches p95=122.54 s and the API
      // keeps that authority fresh for 150 s. A watchdog whose phase began
      // before this capture must not destroy the tab at its 120 s firing.
      await advance(30_000);
      await advance(45_000);
      await advance(45_000);
      expect(onSabaSocketUnavailable).not.toHaveBeenCalled();

      // Once the 150 s authority budget is genuinely exceeded with no
      // replacement catalog, recover once and retain the five-minute cooldown.
      catalogReady = false;
      await advance(45_000);
      expect(onSabaSocketUnavailable).toHaveBeenCalledExactlyOnceWith(source);
      await observer.pollSabaDomChanges(source, "sports.example");
      await advance(299_999);
      expect(onSabaSocketUnavailable).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(onSabaSocketUnavailable).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to SABA's current main world when its isolated frame has no catalog", async () => {
    const records = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `over-${index}`, priceText: "0.91" },
          { marketOddsId: `under-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "saba-frame", loaderId: "saba-loader" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 71 };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION &&
        params.contextId === 71) return { result: { value: "[]" } };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION &&
        params.contextId === undefined) return { result: { value: records } };
      return {};
    });
    const forward = vi.fn(async () => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000, monotonicNow: () => 10 });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    await observer.pollSabaDomChanges(source, "sports.example");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      lobby: "SABA", transport: "DOM_SNAPSHOT"
    }));
    expect(observer.hasUsableSabaCatalog(source.sourceId)).toBe(true);
  });

  it("escalates SABA even when the DOM probe never settles", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const onSabaSocketUnavailable = vi.fn(async () => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") {
        return await new Promise<never>(() => undefined);
      }
      return {};
    });
    const observer = new NetworkObserver({
      sendCommand,
      forward: vi.fn(async () => undefined),
      now: () => now,
      monotonicNow: () => now,
      onSabaSocketUnavailable
    });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    try {
      void observer.pollSabaDomChanges(source, "push.example");
      await Promise.resolve();
      now = 47_000;
      await vi.advanceTimersByTimeAsync(46_000);
      expect(onSabaSocketUnavailable).toHaveBeenCalledExactlyOnceWith(source);
    } finally {
      vi.useRealTimers();
    }
  });

  it("arms SABA recovery before debugger attachment can hang", async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    const onSabaSocketUnavailable = vi.fn(async () => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => await new Promise<never>(() => undefined)),
      forward: vi.fn(async () => undefined),
      now: () => now,
      monotonicNow: () => now,
      onSabaSocketUnavailable
    });

    try {
      void observer.start(source).catch(() => undefined);
      await Promise.resolve();
      now = 47_000;
      await vi.advanceTimersByTimeAsync(46_000);
      expect(onSabaSocketUnavailable).toHaveBeenCalledExactlyOnceWith(source);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotates only the bridge epoch during resync and keeps the live TSPORT socket owned", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: async (envelope) => { forwarded.push(envelope); }, observerSessionId: "worker-a" });
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9 } as const;
    const url = "wss://spws.agenate.com/ln/en/p/2/u/MxcZnFVvGKUOdnHngKzURw==/s/1/mg/1/tr/0";

    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "ts-ws", url });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "ts-ws",
      response: { opcode: 1, payloadData: JSON.stringify({ s: 1, t: "pong" }) } });
    expect(forwarded.at(-1)).toMatchObject({ sourceEpoch: "worker-a:0", sequence: 1,
      transport: "WS_FRAME" });

    expect(observer.beginBridgeSourceEpoch(source.sourceId)).toBe("worker-a:1");
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "ts-ws",
      response: { opcode: 1, payloadData: JSON.stringify({ s: 2, t: "pong" }) } });

    expect(forwarded.at(-1)).toMatchObject({ sourceEpoch: "worker-a:1", sequence: 0,
      transport: "WS_FRAME" });
  });

  it("reconnects only SABA Socket.IO after an epoch bump discards its retired baseline", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression ===
        "window.io && window.io.Socket && window.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    observer.beginSourceEpoch(source.sourceId);
    await observer.refreshCatalog(source);
    await settleObserverBackgroundTasks();

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.queryObjects", {
      prototypeObjectId: "socket-io-prototype", objectGroup: expect.stringMatching(/^fieldline-baseline-recovery-8-\d+$/u)
    });
    expect(sendCommand.mock.calls.find(([, method]) => method === "Runtime.callFunctionOn")?.[2])
      .toMatchObject({ objectId: "socket-io-instances",
        functionDeclaration: expect.stringContaining("socket.disconnect(); socket.connect()") });
    expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
  });

  it("does not treat SABA c0 configuration reset/done as a football catalog baseline", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000,
      monotonicNow: () => 60 });
    const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    const configOnly = `42${JSON.stringify(["m", "b0", [
      ["c", "c0", "session"], ["f", 0, ["type", "siteid"]],
      [0, "reset"], [0, 15, 1], [0, "done"]
    ], "r1"])}`;
    await observer.ingestWebSocketFrame(source, "wss://sports.example/socket.io/", configOnly);
    forward.mockClear();
    sendCommand.mockClear();

    await observer.refreshCatalog(source);

    expect(forward.mock.calls.some(([message]) => message.request.replayed === true)).toBe(false);
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
  });

  it("reports SABA ready only while the current socket owns a complete football baseline", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), now: () => 1_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    const readiness = observer as NetworkObserver & {
      hasCompleteSabaBaseline?(sourceId: string): boolean;
    };

    expect(readiness.hasCompleteSabaBaseline?.(saba.sourceId)).toBe(false);
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "saba-current", url: "wss://sports.example/socket.io/"
    });
    expect(readiness.hasCompleteSabaBaseline?.(saba.sourceId)).toBe(false);
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "saba-current", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });
    expect(readiness.hasCompleteSabaBaseline?.(saba.sourceId)).toBe(true);

    await observer.handleEvent(saba, "Network.webSocketClosed", { requestId: "saba-current" });
    expect(readiness.hasCompleteSabaBaseline?.(saba.sourceId)).toBe(false);
  });

  it("disconnects the SABA DOM watcher once current WS authority is complete and restores it after close", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        return { result: { value: "1787432000000" } };
      }
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes("delete globalThis.__fieldlineSabaOddsMutationV1")) {
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate") return { result: { value: false } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "saba-current", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "saba-current", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });
    sendCommand.mockClear();
    forward.mockClear();

    await observer.pollSabaDomChanges(saba, "sports.example");
    const cleanupCalls = sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("delete globalThis.__fieldlineSabaOddsMutationV1"));
    expect(cleanupCalls).toHaveLength(1);
    expect(String(cleanupCalls[0]?.[2]?.expression)).toContain("observer.disconnect()");
    expect(String(cleanupCalls[0]?.[2]?.expression)).toContain("delete globalThis.__fieldlineSabaOddsMutationV1");
    expect(forward).not.toHaveBeenCalled();

    sendCommand.mockClear();
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(sendCommand).not.toHaveBeenCalled();

    await observer.handleEvent(saba, "Network.webSocketClosed", { requestId: "saba-current" });
    sendCommand.mockClear();
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("fieldline-saba-odds-mutation"))).toBe(true);
  });

  it("retries SABA watcher cleanup when the page did not confirm disconnection", async () => {
    let cleanupAttempts = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        return { result: { value: "1787432000000" } };
      }
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes("delete globalThis.__fieldlineSabaOddsMutationV1")) {
        cleanupAttempts += 1;
        return cleanupAttempts === 1 ? { exceptionDetails: { text: "detached" } } : { result: { value: true } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "saba-current", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "saba-current", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });

    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    await observer.pollSabaDomChanges(saba, "sports.example");
    await observer.pollSabaDomChanges(saba, "sports.example");

    expect(cleanupAttempts).toBe(2);
  });

  it.each(["normal", "cleanup"] as const)(
    "bounds SABA %s mutation reads to twelve contexts in one concurrent timeout window", async (mode) => {
    vi.useFakeTimers();
    let releaseReads!: () => void;
    const heldReads = new Promise<void>((resolve) => { releaseReads = resolve; });
    try {
      let mutationReads = 0;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression === "String(performance.timeOrigin)") {
          return { result: { value: "1787432000000" } };
        }
        if (method === "Runtime.evaluate" && expression.includes("__fieldlineSabaOddsMutationV1")) {
          mutationReads += 1;
          return heldReads.then(() => ({ result: { value: mode === "cleanup" } }));
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        frameCommandTimeoutMs: 25 });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
      for (let index = 0; index < 14; index += 1) {
        await observer.handleEvent(saba, "Runtime.executionContextCreated", {
          context: { id: index + 1, auxData: { frameId: `frame-${index}`, isDefault: true } }
        });
      }
      if (mode === "cleanup") {
        await observer.handleEvent(saba, "Network.webSocketCreated", {
          requestId: "saba-current", url: "wss://sports.example/socket.io/"
        });
        await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
          requestId: "saba-current", response: { opcode: 1, payloadData:
            `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type"]],
              [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
        });
      }

      const poll = observer.pollSabaDomChanges(saba, "sports.example");
      await Promise.resolve();
      await Promise.resolve();

      expect(mutationReads).toBe(13);
      await vi.advanceTimersByTimeAsync(25);
      await poll;
    } finally {
      releaseReads();
      vi.useRealTimers();
    }
  });

  it("renews SABA from the DOM before a completed socket baseline can miss the realtime deadline", async () => {
    let now = 1_000;
    const records = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["3"], labels: ["2.5"],
        odds: [{ marketOddsId: `market-${index}`, priceText: "0.91", status: null, greyedOut: null },
          { marketOddsId: `market-${index}`, priceText: "0.99", status: null, greyedOut: null }] }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("delete globalThis.__fieldlineSabaOddsMutationV1")) {
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: sabaUnknownProbeState("backoff-close") } };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "window.io && window.io.Socket && window.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "saba-current", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "saba-current", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });
    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    forward.mockClear();

    now = 22_000;
    await observer.pollSabaDomChanges(saba, "sports.example");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "SABA", transport: "DOM_SNAPSHOT" }));
  });

  it("renews SABA from the DOM after a worker reload has no in-memory socket baseline", async () => {
    let now = 1_000;
    const records = JSON.stringify([{
      sportId: "1", leagueId: "league-1", leagueName: "League", matchId: "match-1",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["3"], labels: ["2.5"],
        odds: [{ marketOddsId: "market-1", priceText: "0.91" },
          { marketOddsId: "market-1", priceText: "0.99" }] }]
    }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    now = 22_000;
    await observer.pollSabaDomChanges(saba, "sports.example");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "SABA", transport: "DOM_SNAPSHOT" }));
  });

  it("progressively backs off SABA baseline recovery while fresh DOM authority keeps renewing", async () => {
    let now = 5_000;
    let catalogReady = true;
    const records = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `market-${index}`, priceText: "0.91" },
          { marketOddsId: `market-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: catalogReady ? records : "[]" } };
      }
      if (method === "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        // This test isolates recovery backoff after a safe no-action probe.
        return { result: { value: sabaUnknownProbeState("healthy-backoff") } };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await attachSabaRecoveryWorker(observer, saba);
    const pollAfterDiscovery = async (): Promise<void> => {
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
      // Drain a read-only non-admission, then evaluate recovery at the same
      // boundary clock. This fixture tests backoff, not scheduler cadence.
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
    };
    const reconnects = (): number => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" &&
      String(params?.functionDeclaration).includes("socket.disconnect(); socket.connect()"))
      .length;
    const completedRecoveries = (): number => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.releaseObjectGroup" && String(params?.objectGroup).startsWith("fieldline-baseline-recovery-8-"))
      .length;
    const sendDelta = async (revision: number): Promise<void> => {
      await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
        requestId: "saba-delta-only", response: { opcode: 1, payloadData:
          `42${JSON.stringify(["m", "b1", [["f", 0, ["type"]], [0, "o"]], `r${revision}`])}` }
      });
    };
    const pollAt = async (atMs: number, revision?: number): Promise<void> => {
      now = atMs;
      if (revision !== undefined) await sendDelta(revision);
      await pollAfterDiscovery();
      await settleObserverBackgroundTasks();
    };
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "saba-delta-only", url: "wss://sports.example/socket.io/"
    });

    await pollAt(5_000);
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    await pollAt(25_001, 1);
    await vi.waitFor(() => expect(reconnects()).toBe(1));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(1));

    // A quiet catalog is normal while the public DOM remains current. It must
    // not collapse the healthy-source delay back to the old 20-second loop.
    await pollAt(45_002);
    expect(reconnects()).toBe(1);

    await pollAt(65_001, 2);
    await vi.waitFor(() => expect(reconnects()).toBe(2));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(2));
    await pollAt(145_001, 3);
    await vi.waitFor(() => expect(reconnects()).toBe(3));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(3));
    await pollAt(305_001, 4);
    expect(reconnects()).toBe(3);
    await pollAt(445_001);
    await vi.waitFor(() => expect(reconnects()).toBe(4));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(4));
    await pollAt(744_999);
    expect(reconnects()).toBe(4);
    await pollAt(745_001, 5);
    await vi.waitFor(() => expect(reconnects()).toBe(5));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(5));
    await pollAt(1_045_000);
    expect(reconnects()).toBe(5);
    await pollAt(1_045_001, 6);
    await vi.waitFor(() => expect(reconnects()).toBe(6));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(6));

    expect(forward.mock.calls.filter(([envelope]) => envelope.transport === "DOM_SNAPSHOT").length)
      .toBeGreaterThanOrEqual(7);
    expect(observer.hasCompleteSabaBaseline(saba.sourceId)).toBe(false);

    // Once the last usable DOM authority expires with no replacement, the
    // urgent soft path still honors the shared heavy-recovery batch pause.
    catalogReady = false;
    await pollAt(1_195_002);
    expect(reconnects()).toBe(6);
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(false);
    await pollAt(1_345_001);
    await vi.waitFor(() => expect(reconnects()).toBe(7));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(7));
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(false);

    observer.beginSourceEpoch(saba.sourceId);
    await attachSabaRecoveryWorker(observer, saba);
    catalogReady = true;
    await pollAt(1_390_000, 7);
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    await pollAt(1_410_001, 8);
    await vi.waitFor(() => expect(reconnects()).toBe(8));
    await vi.waitFor(() => expect(completedRecoveries()).toBe(8));
  });

  it("keeps SABA backoff across an old close and restarts the initial window after reset done", async () => {
    let now = 5_000;
    const records = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `market-${index}`, priceText: "0.91" },
          { marketOddsId: `market-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: sabaUnknownProbeState("backoff-overtake") } };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await attachSabaRecoveryWorker(observer, saba);
    const pollAfterDiscovery = async (): Promise<void> => {
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
      // Drain a read-only non-admission, then evaluate recovery at the same
      // boundary clock. This fixture tests backoff, not scheduler cadence.
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
    };
    const reconnects = (): number => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" &&
      String(params?.functionDeclaration).includes("socket.disconnect(); socket.connect()"))
      .length;
    const waitForRecoveries = async (count: number): Promise<void> => {
      await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.releaseObjectGroup" &&
        String(params?.objectGroup).startsWith("fieldline-baseline-recovery-8-"))).toHaveLength(count));
    };
    const delta = (revision: string) => `42${JSON.stringify(
      ["m", "b1", [["f", 0, ["type"]], [0, "o"]], revision])}`;

    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "old-socket", url: "wss://sports.example/socket.io/"
    });
    await pollAfterDiscovery();
    await settleObserverBackgroundTasks();
    now = 25_001;
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "old-socket", response: { opcode: 1, payloadData: delta("r1") }
    });
    await pollAfterDiscovery();
    await waitForRecoveries(1);
    await settleObserverBackgroundTasks();

    now = 45_002;
    await observer.handleEvent(saba, "Network.webSocketClosed", { requestId: "old-socket" });
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "new-socket", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "new-socket", response: { opcode: 1, payloadData: delta("r2") }
    });
    await pollAfterDiscovery();
    await Promise.resolve();
    expect(reconnects()).toBe(1);

    now = 65_001;
    await pollAfterDiscovery();
    await waitForRecoveries(2);
    now = 70_000;
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "new-socket", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r3"])}` }
    });
    expect(observer.hasCompleteSabaBaseline(saba.sourceId)).toBe(true);

    now = 110_000;
    await observer.handleEvent(saba, "Network.webSocketClosed", { requestId: "new-socket" });
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "replacement-socket", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "replacement-socket", response: { opcode: 1, payloadData: delta("r4") }
    });
    await pollAfterDiscovery();
    await Promise.resolve();
    expect(reconnects()).toBe(2);

    now = 130_001;
    await pollAfterDiscovery();
    await waitForRecoveries(3);
  });

  it("restarts SABA missing-baseline age when reset done and close overtake deferred DOM work", async () => {
    let now = 5_000;
    let holdMutation = false;
    let mutationHeld = false;
    let releaseMutation!: () => void;
    const deferredMutation = new Promise<unknown>((resolve) => {
      releaseMutation = () => resolve({ result: { value: false } });
    });
    const records = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `market-${index}`, priceText: "0.91" },
          { marketOddsId: `market-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        if (holdMutation) { mutationHeld = true; return deferredMutation; }
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: sabaUnknownProbeState("backoff-inflight") } };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await attachSabaRecoveryWorker(observer, saba);
    const pollAfterDiscovery = async (): Promise<void> => {
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
      // Drain a read-only non-admission, then evaluate recovery at the same
      // boundary clock. This fixture tests backoff, not scheduler cadence.
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
    };
    const reconnects = (): number => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" &&
      String(params?.functionDeclaration).includes("socket.disconnect(); socket.connect()"))
      .length;
    const delta = (revision: string) => `42${JSON.stringify(
      ["m", "b1", [["f", 0, ["type"]], [0, "o"]], revision])}`;

    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "aged-socket", url: "wss://sports.example/socket.io/"
    });
    await pollAfterDiscovery();
    await settleObserverBackgroundTasks();
    now = 25_001;
    holdMutation = true;
    const agedPoll = observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(mutationHeld).toBe(true));

    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "aged-socket", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });
    expect(observer.hasCompleteSabaBaseline(saba.sourceId)).toBe(true);
    await observer.handleEvent(saba, "Network.webSocketClosed", { requestId: "aged-socket" });
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "replacement-socket", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "replacement-socket", response: { opcode: 1, payloadData: delta("r2") }
    });
    releaseMutation();
    await agedPoll;
    await settleObserverBackgroundTasks();
    expect(reconnects()).toBe(0);

    holdMutation = false;
    now = 45_001;
    await pollAfterDiscovery();
    expect(reconnects()).toBe(0);
    now = 45_002;
    await pollAfterDiscovery();
    await vi.waitFor(() => expect(reconnects()).toBe(1));
  });

  it("does not spend SABA backoff on in-flight skips or retired recovery completion", async () => {
    let now = 5_000;
    let queryCount = 0;
    let releaseFirstQuery!: () => void;
    let releaseRetiredQuery!: () => void;
    const firstQuery = new Promise<unknown>((resolve) => {
      releaseFirstQuery = () => resolve({ objects: { objectId: "socket-io-instances" } });
    });
    const retiredQuery = new Promise<unknown>((resolve) => {
      releaseRetiredQuery = () => resolve({ objects: { objectId: "socket-io-instances" } });
    });
    const records = JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `market-${index}`, priceText: "0.91" },
          { marketOddsId: `market-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: sabaUnknownProbeState("backoff-retired") } };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.queryObjects") {
        queryCount += 1;
        if (queryCount === 1) return firstQuery;
        if (queryCount === 3) return retiredQuery;
        return { objects: { objectId: "socket-io-instances" } };
      }
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await attachSabaRecoveryWorker(observer, saba);
    const pollAfterDiscovery = async (): Promise<void> => {
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
      // Drain a read-only non-admission, then evaluate recovery at the same
      // boundary clock. This fixture tests backoff, not scheduler cadence.
      await observer.pollSabaDomChanges(saba, "sports.example");
      await settleObserverBackgroundTasks();
    };
    const waitForReconnects = async (count: number): Promise<void> => {
      await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.callFunctionOn" &&
        String(params?.functionDeclaration).includes("socket.disconnect(); socket.connect()")))
        .toHaveLength(count));
    };
    const waitForReleased = async (count: number): Promise<void> => {
      await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.releaseObjectGroup" &&
        String(params?.objectGroup).startsWith("fieldline-baseline-recovery-8-"))).toHaveLength(count));
      await Promise.resolve();
    };

    await pollAfterDiscovery();
    await settleObserverBackgroundTasks();
    now = 25_001;
    await pollAfterDiscovery();
    await vi.waitFor(() => expect(queryCount).toBe(1));
    await settleObserverBackgroundTasks();
    now = 65_001;
    await pollAfterDiscovery();
    expect(queryCount).toBe(1);
    releaseFirstQuery();
    await waitForReconnects(1);
    await waitForReleased(1);
    await settleObserverBackgroundTasks();
    now = 70_001;
    await pollAfterDiscovery();
    await waitForReconnects(2);
    await waitForReleased(2);
    await settleObserverBackgroundTasks();

    now = 150_001;
    await pollAfterDiscovery();
    await vi.waitFor(() => expect(queryCount).toBe(3));
    observer.beginSourceEpoch(saba.sourceId);
    await attachSabaRecoveryWorker(observer, saba);
    now = 155_000;
    await pollAfterDiscovery();
    await settleObserverBackgroundTasks();
    now = 175_001;
    await pollAfterDiscovery();
    expect(queryCount).toBe(3);
    releaseRetiredQuery();
    await waitForReleased(3);
    now = 215_001;
    await pollAfterDiscovery();
    expect(queryCount).toBe(3);
    now = 450_001;
    await pollAfterDiscovery();
    await waitForReconnects(3);
    await waitForReleased(4);
    now = 490_001;
    await pollAfterDiscovery();
    await waitForReconnects(4);
    await waitForReleased(5);
    expect(queryCount).toBe(5);
  });

  it("pauses background SABA recovery during a probe without blocking manual recovery", async () => {
    let now = 5_000;
    let probeEnabled = false;
    let advanceProbeClock = false;
    let probeReads = 0;
    let helperReadHeld = false;
    let releaseHelperRead!: () => void;
    const heldHelperRead = new Promise<void>((resolve) => { releaseHelperRead = resolve; });
    const rosterMatchIds = Array.from({ length: 50 }, (_, index) => `match-${index}`);
    const records = JSON.stringify(rosterMatchIds.map((matchId, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId,
      timeText: "09/08 08:00PM", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `market-${index}`, priceText: "0.91" },
          { marketOddsId: `market-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const pageState = () => ({ documentToken: "doc-1", rowCount: 50, tableCount: 1,
      eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds, rosterSamples: [],
      timeShapes: {}, dateContexts: [], headerControls: [], fingerprint: "TODAY",
      activePeriod: "TODAY", activePeriodEvidence: "FOOTBALL_PAGE_HEADING", truncated: false });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype") {
        return { result: { objectId: "socket-io-prototype" } };
      }
      if (method === "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        if (!probeEnabled) return { result: { value: null } };
        probeReads += 1;
        if (probeReads === 2) { helperReadHeld = true; await heldHelperRead; }
        return { result: { value: pageState() } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-io-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      // This fixture deliberately holds an action while awaiting manual recovery.
      frameCommandTimeoutMs: 2_500,
      forward: async (envelope) => { forwarded.push(envelope); },
      now: () => advanceProbeClock ? (now += 100) : now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
    await attachSabaRecoveryWorker(observer, saba);
    const reconnects = (): number => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" &&
      String(params?.functionDeclaration).includes("socket.disconnect(); socket.connect()"))
      .length;
    const waitForRecoveries = async (count: number): Promise<void> => {
      await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.releaseObjectGroup" &&
        String(params?.objectGroup).startsWith("fieldline-baseline-recovery-8-"))).toHaveLength(count));
    };

    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "saba-delta", url: "wss://sports.example/socket.io/"
    });
    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    observer.beginSourceEpoch(saba.sourceId);
    await attachSabaRecoveryWorker(observer, saba);
    now = 35_001;
    probeEnabled = true;
    advanceProbeClock = true;
    const probingPoll = observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(helperReadHeld).toBe(true));
    expect(reconnects()).toBe(0);

    // Explicit refresh remains available during the probe. Its recovery owns
    // the shared five-second throttle, but does not spend a healthy poll slot.
    await observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(reconnects()).toBe(1));
    await waitForRecoveries(1);
    await Promise.resolve();
    await Promise.resolve();
    releaseHelperRead();
    await probingPoll;
    await vi.waitFor(() => expect(forwarded.some((envelope) => {
      try { return JSON.parse(envelope.payload.body).kind === "SABA_NAVIGATION_PROBE"; }
      catch { return false; }
    })).toBe(true), { timeout: 5_000 });
    advanceProbeClock = false;
    const probeResult = forwarded.map((envelope) => {
      try { return JSON.parse(envelope.payload.body) as Record<string, unknown>; } catch { return null; }
    }).find((body) => body?.kind === "SABA_NAVIGATION_PROBE");
    expect(probeResult).toMatchObject({ viewRestored: true });
    expect(reconnects()).toBe(1);
  });

  it("does not mistake a partial SABA DOM cache for a complete socket baseline", async () => {
      const sendCommand = vi.fn(async (_tabId: number, _method: string,
        _params?: Record<string, unknown>) => ({}));
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const source = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;
      await observer.ingestDomSnapshot(source, "sports.example", JSON.stringify([{
        sportId: "1", leagueId: "league-1", leagueName: "League", matchId: "match-1",
        timeText: "LIVE", teamNames: ["Alpha", "Beta"], groups: [{
          betTypeIds: ["1"], labels: ["0.5"], odds: [
            { marketOddsId: "m-1", priceText: "0.91", lineText: "0.5" },
            { marketOddsId: "m-1", priceText: "-0.99" }
          ]
        }]
      }]));
      sendCommand.mockClear();

      await observer.refreshCatalog(source);

      expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
        params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
      expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(false);
      expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
  });

  it("requests IM prematch events without an upper date bound", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));
    try {
      const listeners = new Map<string, (event: { detail: string }) => void>();
      const requests: Array<Record<string, unknown>> = [];
      const windowStub = {
        global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "token" } },
        addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name),
        dispatchEvent: (event: { type: string; detail: { c: string } }) => {
          if (event.type === "helo") listeners.get(`halo_${event.detail.c}`)?.({ detail: "signed" });
        }
      };
      const execute = new Function("document", "location", "window", "sessionStorage", "CustomEvent", "fetch",
        `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => Promise<unknown>;

      const result = await execute(
        { documentElement: { dataset: {} }, querySelectorAll: () => [] },
        { hostname: "imsports.directsb.net", search: "" },
        windowStub,
        { getItem: () => "token" },
        class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
          get detail(): { c: string } { return this.init.detail; } },
        async (_path: string, init: { body: string }) => {
          const request = JSON.parse(init.body) as Record<string, unknown>;
          requests.push(request);
          return { text: async () => JSON.stringify({ sel: [], StatusCode: 100 }) };
        }
      );

      expect(requests).toHaveLength(2);
      expect(requests.map(({ DateFrom, Market }) => ({ DateFrom, Market }))).toEqual([
        { DateFrom: "2026/08/19", Market: 1 },
        { DateFrom: "2026/08/19", Market: 2 }
      ]);
      expect(requests.every((request) => !Object.prototype.hasOwnProperty.call(request, "DateTo"))).toBe(true);
      expect(buildImExactSelectionPriceExpression({
        providerEventId: "event", providerMarketId: "market", providerSelectionId: "selection",
        eventLabel: "Home vs Away", participantA: "Home", participantB: "Away",
        marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "0.5"
      })).not.toContain("DateTo");
      expect(result).toMatchObject({ status: "catalog-requested", responses: [
        { market: 1, body: '{"StatusCode":100,"sel":[]}' },
        { market: 2, body: '{"StatusCode":100,"sel":[]}' }
      ] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns only IM fields consumed by the strict football adapter", async () => {
    const listeners = new Map<string, (event: { detail: string }) => void>();
    const windowStub = {
      global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "token" } },
      addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      dispatchEvent: (event: { type: string; detail: { c: string } }) => {
        if (event.type === "helo") listeners.get(`halo_${event.detail.c}`)?.({ detail: "signed" });
      }
    };
    const execute = new Function("document", "location", "window", "sessionStorage", "CustomEvent", "fetch",
      `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => Promise<unknown>;
    const rich = { StatusCode: 100, serverTrace: "discard", sel: [{
      eid: 11, edt: "2026-09-05T01:00:00Z", htn: "Home", atn: "Away", cn: "League",
      isrbt: false, iscyb: false, hs: 0, as: 0, rbt: "", eventTrace: "discard",
      mls: [
        { mi: 21, bti: 1, gp: 1, marketTrace: "discard", ws: [
          { wsi: 31, si: 1, hdp: 0.5, dih: "0.5", o: 0.91, ot: 2, selectionTrace: "discard" },
          { wsi: 32, si: 2, hdp: -0.5, dih: "-0.5", o: -0.99, ot: 1, selectionTrace: "discard" }
        ] },
        { mi: 22, bti: 5, gp: 1, ws: [], unsupportedTrace: "discard" },
        { mi: 23, bti: 24, gp: 1, ws: [
          { wsi: 33, si: 101, o: 3.2, ot: 3, s: "total=1.5", selectionTrace: "discard" },
          { wsi: 34, si: 102, o: 1.3, ot: 3, s: "total=1.5", selectionTrace: "discard" }
        ] }
      ]
    }] };

    const result = await execute(
      { documentElement: { dataset: {} }, querySelectorAll: () => [] },
      { hostname: "imsports.directsb.net", search: "" }, windowStub, { getItem: () => "token" },
      class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
        get detail(): { c: string } { return this.init.detail; } },
      async () => ({ text: async () => JSON.stringify(rich) })
    ) as { responses: Array<{ body: string }> };

    expect(JSON.parse(result.responses[0]!.body)).toEqual({ StatusCode: 100, sel: [{
      eid: 11, edt: "2026-09-05T01:00:00Z", htn: "Home", atn: "Away", cn: "League",
      isrbt: false, iscyb: false, hs: 0, as: 0, rbt: "", mls: [{
        mi: 21, bti: 1, gp: 1, fieldlineObservedAtMs: expect.any(Number), ws: [
          { wsi: 31, si: 1, hdp: 0.5, dih: "0.5", o: 0.91, ot: 2 },
          { wsi: 32, si: 2, hdp: -0.5, dih: "-0.5", o: -0.99, ot: 1 }
        ]
      }, { mi: 22, bti: 5, gp: 1, fieldlineObservedAtMs: expect.any(Number), ws: [] },
      { mi: 23, bti: 24, gp: 1, fieldlineObservedAtMs: expect.any(Number), ws: [
        { wsi: 33, si: 101, o: 3.2, ot: 3, s: "total=1.5" },
        { wsi: 34, si: 102, o: 1.3, ot: 3, s: "total=1.5" }
      ] }]
    }] });
  });

  it("hydrates all IM prematch owners through the unfiltered event route", async () => {
    const listeners = new Map<string, (event: { detail: string }) => void>();
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const windowStub: Record<string, unknown> = {
      global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "token" } },
      addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      dispatchEvent: (event: { type: string; detail: { c: string } }) => {
        if (event.type === "helo") listeners.get(`halo_${event.detail.c}`)?.({ detail: "signed" });
      }
    };
    const execute = new Function("document", "location", "window", "sessionStorage", "CustomEvent", "fetch",
      `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => Promise<unknown>;
    const events = Array.from({ length: 12 }, (_, index) => ({
      eid: index + 1, edt: "2026-09-07T12:00:00Z", htn: `Home ${index + 1}`,
      atn: `Away ${index + 1}`, cn: "League", isrbt: false, iscyb: false, hs: 0, as: 0,
      rbt: "", mls: [{ mi: 1000 + index, bti: 1, gp: 1, ws: [] }]
    }));

    const result = await execute(
      { documentElement: { dataset: {} }, querySelectorAll: () => [] },
      { hostname: "imsports.directsb.net", search: "" }, windowStub, { getItem: () => "token" },
      class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
        get detail(): { c: string } { return this.init.detail; } },
      async (path: string, init: { body?: string }) => {
        const body = init.body === undefined ? {} : JSON.parse(init.body) as Record<string, unknown>;
        requests.push({ path, body });
        if (path.startsWith("/api/EventV6/GetEBI/1/")) {
          const eid = Number(path.split("/")[5]);
          return { text: async () => JSON.stringify({ StatusCode: 100, e: {
            ...events.find(event => event.eid === eid),
            mls: eid === 1 ? [{ mi: 9001, bti: 5, gp: 1, ws: [
              { wsi: 9101, si: 10, o: 0.91 }, { wsi: 9102, si: 11, o: -0.99 }
            ] }] : []
          } }) };
        }
        return { text: async () => JSON.stringify({ StatusCode: 100, sel: body.Market === 1 ? events : [] }) };
      }
    ) as { responses: Array<{ market: number; body: string }> };

    const detailRequests = requests.filter(request => request.path.startsWith("/api/EventV6/GetEBI/1/"));
    expect(detailRequests.map(request => request.path)).toEqual(events.map(event =>
      `/api/EventV6/GetEBI/1/${event.eid}/false/2/false`));
    expect(detailRequests.every(request => Object.keys(request.body).length === 0)).toBe(true);
    const marketOne = JSON.parse(result.responses.find((item) => item.market === 1)!.body) as {
      sel: Array<{ eid: number; mls: Array<{ mi: number }> }> };
    expect(marketOne.sel[0]?.mls.map((item) => item.mi)).toEqual([1000, 9001]);
    expect(detailRequests).toHaveLength(12);
  });

  it("marks its compact IM catalog fetch so CDP does not forward the same raw body", async () => {
    const listeners = new Map<string, (event: { detail: string }) => void>();
    const sentHeaders: Record<string, string>[] = [];
    const windowStub = {
      global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "token" } },
      addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      dispatchEvent: (event: { type: string; detail: { c: string } }) => {
        if (event.type === "helo") listeners.get(`halo_${event.detail.c}`)?.({ detail: "signed" });
      }
    };
    const execute = new Function("document", "location", "window", "sessionStorage", "CustomEvent", "fetch",
      `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => Promise<unknown>;

    await execute(
      { documentElement: { dataset: {} }, querySelectorAll: () => [] },
      { hostname: "imsports.directsb.net", search: "" }, windowStub, { getItem: () => "token" },
      class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
        get detail(): { c: string } { return this.init.detail; } },
      async (_path: string, init: { headers: Record<string, string> }) => {
        sentHeaders.push(init.headers);
        return { text: async () => JSON.stringify({ StatusCode: 100, sel: [] }) };
      }
    );

    expect(sentHeaders).toHaveLength(2);
    expect(sentHeaders.every((headers) => headers["x-fieldline-catalog-probe"] === "compact-v1")).toBe(true);
  });

  it("uses the IM session token exchanged by the native bootstrap ahead of the launch URL", async () => {
    const listeners = new Map<string, (event: { detail: string }) => void>();
    const sentTokens: string[] = [];
    const windowStub = {
      global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "4-stale" } },
      addEventListener: (name: string, listener: (event: { detail: string }) => void) =>
        listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      dispatchEvent: (event: { type: string; detail: { c: string } }) => {
        if (event.type === "helo") listeners.get(`halo_${event.detail.c}`)?.({ detail: "signed" });
      }
    };
    const execute = new Function("document", "location", "window", "sessionStorage", "CustomEvent", "fetch",
      `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => Promise<unknown>;

    await execute(
      { documentElement: { dataset: {} }, querySelectorAll: () => [] },
      { hostname: "imsports.directsb.net", search: "?languageCode=vi&token=4-fresh" },
      windowStub,
      { getItem: () => "4-stale" },
      class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
        get detail(): { c: string } { return this.init.detail; } },
      async (_path: string, init: { headers: Record<string, string> }) => {
        sentTokens.push(init.headers["x-token"]!);
        return { text: async () => '{"StatusCode":100,"sel":[]}' };
      }
    );

    expect(sentTokens).toEqual(["4-stale", "4-stale"]);
  });

  it("keeps CMD on the unfiltered football catalog before advancing its virtualized table", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) =>
      method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "top" }, childFrames: [{ frame: { id: "sports" } }] } }
        : method === "Page.createIsolatedWorld" ? { executionContextId: 9 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 });

    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations).toHaveLength(2);
    expect(evaluations.every(([, , params]) => params?.expression === CMD_CATALOG_DISCOVERY_EXPRESSION)).toBe(true);
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain(".c-iconcolor-sport1");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain("fieldlineCmdFootballSelected");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain("fieldlineCmdSearchCleared");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain("scrollHeight");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).not.toMatch(/\.c-odds(?:\[|\s)|data-moid|stake|bet-slip/iu);
    expect(() => new Function(`return ${CMD_CATALOG_DISCOVERY_EXPRESSION}`)).not.toThrow();
  });

  it("probes one exact CMD event and emits sanitized sent-frame evidence", async () => {
    let releaseEvaluation: ((value: unknown) => void) | undefined;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 21 };
      if (method === "Runtime.evaluate") return new Promise((resolve) => { releaseEvaluation = resolve; });
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;

    const probing = observer.probeCmdHiddenMarkets(cmd, { requestId: "probe-1", providerEventId: "25250586" });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(9, "Runtime.evaluate", expect.any(Object)));
    await observer.handleEvent(cmd, "Network.webSocketFrameSent", { requestId: "socket-1",
      response: { opcode: 1, payloadData: JSON.stringify({ command: "subscribe",
        channel: "/event/25250586/markets", token: "secret" }) } });
    releaseEvaluation?.({ result: { value: { found: true, beforeMarketIds: ["visible:1"],
      afterMarketIds: ["hidden:1", "visible:1"], clickedControls: ["View details"],
      candidateControls: ["button.detail View details"], marketStructures: [], visibleEventIds: ["25250586"], stablePasses: 2 } } });
    await probing;

    expect(forward).toHaveBeenCalledOnce();
    const envelope = forward.mock.calls[0]?.[0] as ChromeBridgeEnvelope;
    expect(envelope.request.pathnameClass).toBe("/__fieldline_cmd_hidden_probe__");
    const result = JSON.parse(envelope.payload.body) as Record<string, unknown>;
    expect(result).toMatchObject({ requestId: "probe-1", providerEventId: "25250586", status: "EXPANDED" });
    expect(JSON.stringify(result)).toContain("/event/25250586/markets");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("prefers the visible CMD event frame with market evidence over an empty hidden duplicate", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "hidden" },
        childFrames: [{ frame: { id: "visible" } }] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: params?.frameId === "hidden" ? 21 : 22 };
      if (method === "Runtime.evaluate") return params?.contextId === 21
        ? { result: { value: { found: true, beforeMarketIds: [], afterMarketIds: [],
          clickedControls: [], candidateControls: [], marketStructures: [], visibleEventIds: [], stablePasses: 2 } } }
        : { result: { value: { found: true, beforeMarketIds: ["visible:1"], afterMarketIds: ["visible:1"],
          clickedControls: [], candidateControls: ["button.c-match__detail View details"], marketStructures: [],
          visibleEventIds: ["25250586"], stablePasses: 2 } } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.probeCmdHiddenMarkets({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      { requestId: "probe-visible", providerEventId: "25250586" });

    const result = JSON.parse(forwarded[0]!.payload.body) as Record<string, unknown>;
    expect(result.beforeMarketIds).toEqual(["visible:1"]);
    expect(result.candidateControls).toEqual(["button.c-match__detail View details"]);
  });

  it("reads one exact visible bookmaker price from DOM and emits only correlated price evidence", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "sports" } }] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: params?.frameId === "top" ? 21 : 22 };
      if (method === "Runtime.evaluate") return params?.contextId === 22
        ? { result: { value: { ok: true, rawOdds: "0.17", observedAtMs: 1_100 } } }
        : { result: { value: { ok: false, reason: "EXACT_SELECTION_NOT_FOUND" } } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.probeSelectionPrice({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 },
      { requestId: "price-1", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
        participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection: "UNDER", line: "2.5" });

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.request.pathnameClass).toBe("/__fieldline_selection_price_probe__");
    expect(JSON.parse(forwarded[0]!.payload.body)).toEqual({ requestId: "price-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", status: "FOUND",
      rawOdds: "0.17", observedAtMs: 1_100, method: "DOM" });
    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(String(evaluations[0]?.[2]?.expression)).not.toContain(".click(");
    expect(String(evaluations[0]?.[2]?.expression)).toContain("TSPORT_SELECTION_NOT_FOUND");
    expect(evaluations.every(([, , params]) => params?.awaitPromise === true)).toBe(true);
  });

  it("reads an exact hidden APSPORT price with its roster league from authenticated event detail", async () => {
    const detailed = { "1": "league-1", "2": "event-hidden", "5": "Alpha", "6": true,
      "10": "Active", "11": null, "22": "Beta", "53": "League", "50": [{
        "3": 80, "10": "Active", "9": [{ "0": "hidden-over", "2": "hidden-under",
          "6": "hidden-market", "7": "1.5", "8": { "2": "-0.45" }, "9": { "2": "0.35" } }]
      }] };
    const collect = vi.fn(async (options: CollectApsportCatalogOptions) => {
      await options.onRoster({ schemaVersion: 1, generation: options.generation, phase: "ROSTER",
        complete: true, prematchWindowHours: 24, records: [detailed] });
    });
    const collectDetail = vi.fn(async (options: CollectApsportEventDetailOptions) => {
      expect(options.leagueId).toBe("league-1");
      return detailed;
    });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "ap-app", loaderId: "loader-ap" } } }
      : {});
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      collectApsportCatalog: collect, collectApsportEventDetail: collectDetail,
      forward: async (envelope) => { forwarded.push(envelope); } });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json", lng: "vi" },
        postData: JSON.stringify({ mno: 2, si: 1, mg: 1 }) }
    });
    await observer.refreshCatalog(apsport, { prematchWindowHours: 24 });

    await observer.probeSelectionPrice(apsport, {
      requestId: "price-hidden", providerEventId: "event-hidden", providerMarketId: "tsport:80:hidden-market",
      providerSelectionId: "hidden-under", eventLabel: "Alpha vs Beta", participantA: "Alpha",
      participantB: "Beta", marketType: "SH_TOTAL", scope: "SECOND_HALF", selection: "UNDER", line: "1.5"
    });

    expect(collectDetail).toHaveBeenCalledOnce();
    const resultEnvelope = forwarded.find((envelope) =>
      envelope.request.pathnameClass === "/__fieldline_selection_price_probe__");
    expect(JSON.parse(resultEnvelope!.payload.body)).toMatchObject({ requestId: "price-hidden", status: "FOUND",
      rawOdds: "0.35", method: "IN_PAGE_FETCH" });
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.evaluate")).toBe(false);
  });

  it("serializes concurrent APSPORT detail probes in the authenticated provider page", async () => {
    const detailed = { "1": "league-1", "2": "event-hidden", "5": "Alpha", "6": true,
      "10": "Active", "11": null, "22": "Beta", "53": "League", "50": [{
        "3": 80, "10": "Active", "9": [{ "0": "hidden-over", "2": "hidden-under",
          "6": "hidden-market", "7": "1.5", "8": { "2": "-0.45" }, "9": { "2": "0.35" } }]
      }] };
    let active = 0;
    let maximumActive = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method !== "Runtime.evaluate") return {};
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { result: { value: { status: 200, data: null } } };
    });
    const collectDetail = vi.fn(async (options: CollectApsportEventDetailOptions) => {
      await options.request({ kind: "DETAIL", eventId: options.eventId,
        url: `https://pacific.agenate.com/be-ui/pac/api/v3/events/${options.eventId}`, body: {} });
      return detailed;
    });
    const observer = new NetworkObserver({ sendCommand, collectApsportEventDetail: collectDetail,
      forward: async () => undefined });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(apsport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } }
    });
    await observer.handleEvent(apsport, "Network.requestWillBeSent", {
      requestId: "native-events", type: "Fetch", frameId: "ap-app", loaderId: "loader-ap",
      request: { method: "POST", url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
        headers: { "Content-Type": "application/json" }, postData: JSON.stringify({ mno: 2, si: 1 }) }
    });
    const identity = { providerEventId: "event-hidden", providerMarketId: "hidden-market",
      providerSelectionId: "hidden-under", eventLabel: "Alpha vs Beta", participantA: "Alpha",
      participantB: "Beta", marketType: "SH_TOTAL", scope: "SECOND_HALF", selection: "UNDER", line: "1.5" };

    await Promise.all([
      observer.probeSelectionPrice(apsport, { ...identity, requestId: "price-one" }),
      observer.probeSelectionPrice(apsport, { ...identity, requestId: "price-two" })
    ]);

    expect(collectDetail).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
  });

  it("reports TSPORT's fresh same-tab resolver method instead of labelling it as DOM", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 21 };
      if (method === "Runtime.evaluate") return { result: { value: { ok: true, rawOdds: "0.93",
        observedAtMs: 1_100, method: "IN_PAGE_FETCH" } } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });
    await observer.handleEvent({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 },
      "Network.requestWillBeSent", { requestId: "tsport-current", type: "Fetch",
        request: { method: "GET", url: "https://pacific.agenate.com/event/778899" } });

    await observer.probeSelectionPrice({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 },
      { requestId: "price-fetch", providerEventId: "778899", providerMarketId: "market-1",
        providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
        participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection: "UNDER", line: "2.5" });

    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "FOUND", rawOdds: "0.93",
      method: "IN_PAGE_FETCH" });
    const evaluation = sendCommand.mock.calls.find(([, method]) => method === "Runtime.evaluate")?.[2];
    expect(String(evaluation?.expression)).toContain("https://pacific.agenate.com/event/778899");
    expect(String(evaluation?.expression)).toContain("cache: 'no-store'");
  });

  it("fails closed when more than one frame resolves the requested selection", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "sports" } }] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: params?.frameId === "top" ? 21 : 22 };
      if (method === "Runtime.evaluate") return { result: { value: { ok: true,
        rawOdds: params?.contextId === 21 ? "0.17" : "0.36", observedAtMs: 1_100 } } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.probeSelectionPrice({ lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 },
      { requestId: "price-ambiguous", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
        participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection: "UNDER", line: "2.5" });

    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "AMBIGUOUS", rawOdds: null,
      method: "DOM", reason: "VISIBLE_PRICE_AMBIGUOUS" });
  });

  it("checks IM once in existing main worlds without requesting event navigation", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "im-app" } }] } };
      if (method === "Runtime.evaluate") return params?.contextId === 21
        ? { result: { value: { ok: true, rawOdds: "0.91", observedAtMs: 1_100,
          method: "IN_PAGE_FETCH" } } }
        : { result: { value: { ok: false, reason: "IM_DIRECT_SELECTION_NOT_FOUND" } } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });
    await observer.handleEvent({ lobby: "IM", sourceId: "chrome:IM:7", tabId: 7 },
      "Runtime.executionContextCreated", { context: { id: 21,
        auxData: { frameId: "im-app", isDefault: true } } });

    await observer.probeSelectionPrice({ lobby: "IM", sourceId: "chrome:IM:7", tabId: 7 },
      { requestId: "price-im", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1", eventLabel: "KaPa vs JIPPO",
        participantA: "KaPa", participantB: "JIPPO", marketType: "FT_AH",
        scope: "FULL_TIME", selection: "AWAY", line: "0.75" });

    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations).toHaveLength(2);
    expect(evaluations.every(([, , params]) => params?.awaitPromise === true)).toBe(true);
    expect(evaluations.every(([, , params]) => !String(params?.expression).includes(".click("))).toBe(true);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.createIsolatedWorld")).toBe(false);
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "FOUND", rawOdds: "0.91",
      method: "IN_PAGE_FETCH" });
  });

  it("checks BTI through a fresh awaited exact event-detail read instead of visible DOM", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Runtime.evaluate") {
        return { result: { value: { ok: true, rawOdds: "-0.29", observedAtMs: 1_100 } } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.probeSelectionPrice({ lobby: "BTI", sourceId: "chrome:BTI:7", tabId: 7 },
      { requestId: "price-bti", providerEventId: "877857668386287616",
        providerMarketId: "0OU877857669225148454:2.5",
        providerSelectionId: "0OU877857669225148454OMM",
        eventLabel: "Polisi Tanzania vs JKT Tanzania", participantA: "Polisi Tanzania",
        participantB: "JKT Tanzania", marketType: "FT_TOTAL",
        scope: "FULL_TIME", selection: "OVER", line: "2.5" });

    const evaluation = sendCommand.mock.calls.find(([, method]) => method === "Runtime.evaluate")?.[2];
    expect(evaluation?.awaitPromise).toBe(true);
    expect(String(evaluation?.expression)).toContain("/api/eventpage/events/");
    expect(String(evaluation?.expression)).toContain("cache: 'no-store'");
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "FOUND", rawOdds: "-0.29",
      method: "IN_PAGE_FETCH" });
  });

  it("reports a timed-out BTI detail request as unavailable instead of a false identity miss", async () => {
    vi.useFakeTimers();
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Runtime.evaluate") return new Promise<never>(() => undefined);
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 5, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });

    const pending = observer.probeSelectionPrice({ lobby: "BTI", sourceId: "chrome:BTI:7", tabId: 7 },
      { requestId: "price-bti-timeout", providerEventId: "event-1", providerMarketId: "market-1:2.5",
        providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta", participantA: "Alpha",
        participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5" });
    await vi.advanceTimersByTimeAsync(8_001);
    await pending;

    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "NOT_FOUND",
      reason: "BTI_DETAIL_REQUEST_FAILED", method: "IN_PAGE_FETCH" });
    vi.useRealTimers();
  });

  it("stops BTI after one authoritative same-origin detail result instead of double-counting frames", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "child" } }] } };
      if (method === "Runtime.evaluate") return {
        result: { value: { ok: true, rawOdds: "0.17", observedAtMs: 1_100 } }
      };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });
    const source = { lobby: "BTI", sourceId: "chrome:BTI:7", tabId: 7 } as const;
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 72, auxData: { frameId: "child", isDefault: true } }
    });
    await observer.probeSelectionPrice(source, { requestId: "price-bti-one", providerEventId: "event-1",
      providerMarketId: "market-1:2.5", providerSelectionId: "selection-1",
      eventLabel: "Alpha vs Beta", participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5" });

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1);
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({ status: "FOUND", rawOdds: "0.17" });
  });

  it("names a probe that could not run instead of leaving the check to time out", async () => {
    // A throw here emitted nothing, so the API waited its ten seconds and told
    // the operator TIMEOUT - the one verdict that says nothing about whether the
    // ticket still stands. Measured 2026-09-01: SABA and SBOBET answered TIMEOUT
    // on three of seventeen checks and never once said why.
    const sendCommand = vi.fn(async () => ({}));
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.probeSelectionPrice({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      { requestId: "price-unaddressable", providerEventId: "25310330",
        providerMarketId: "25310330:1",
        // Neither :home nor :away, so the expression cannot be built at all.
        providerSelectionId: "25310330:1:sideways",
        eventLabel: "A vs B", participantA: "A", participantB: "B",
        marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "-0.5" });

    const probe = forwarded.find((envelope) =>
      envelope.request.pathnameClass === "/__fieldline_selection_price_probe__");
    expect(probe).toBeDefined();
    expect(JSON.parse(probe!.payload.body)).toMatchObject({
      requestId: "price-unaddressable", status: "NOT_FOUND", reason: "SELECTION_IDENTITY_MISMATCH"
    });
  });

  it("checks SBOBET's exact selection across every sportsbook frame", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "provider-child" } }] } };
      if (method === "Page.createIsolatedWorld") return {
        executionContextId: params?.frameId === "top" ? 71 : 72
      };
      if (method === "Runtime.evaluate") {
        return params?.contextId === 72
          ? { result: { value: { ok: true, rawOdds: "0.17", observedAtMs: 1_100, method: "DOM" } } }
          : { result: { value: { ok: false, reason: "SBOBET_SELECTION_NOT_FOUND" } } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 1_100,
      forward: async (envelope) => { forwarded.push(envelope); } });
    await observer.handleEvent({ lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 },
      "Runtime.executionContextCreated", { context: { id: 71,
        auxData: { frameId: "provider-child", isDefault: true } } });
    await observer.handleEvent({ lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 },
      "Network.requestWillBeSent", { requestId: "sbobet-current", type: "Fetch",
        request: { method: "GET", url: "https://sbobet.example/api/v2/getEvent?live=1&lang=en",
          headers: { "x-session-proof": "current-tab-session", Cookie: "must-not-be-copied" } } });
    await observer.handleEvent({ lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 },
      "Network.responseReceived", { requestId: "sbobet-current", type: "Fetch",
        response: { url: "https://sbobet.example/api/v2/getEvent?live=1&lang=en" } });

    await observer.probeSelectionPrice({ lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 },
      { requestId: "price-sbobet", providerEventId: "5643423", providerMarketId: "7307800681810075",
        providerSelectionId: "56434230030000075h", eventLabel: "El Daklyeh vs Mega Sport Club",
        participantA: "El Daklyeh", participantB: "Mega Sport Club",
        marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "0.75" });

    const evaluation = sendCommand.mock.calls.find(([, method, params]) =>
      method === "Runtime.evaluate" && params?.contextId === 72)?.[2];
    expect(evaluation?.awaitPromise).toBe(true);
    expect(String(evaluation?.expression)).toContain('const probeMode = "DOM_ONLY"');
    expect(String(evaluation?.expression)).not.toContain("live=1&lang=en");
    expect(String(evaluation?.expression)).not.toContain("current-tab-session");
    expect(String(evaluation?.expression)).not.toContain("must-not-be-copied");
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(2);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.getFrameTree")).toBe(true);
    expect(JSON.parse(forwarded[0]!.payload.body)).toMatchObject({
      status: "FOUND", rawOdds: "0.17", method: "DOM"
    });
  });

  it("keeps a KSPORT request template in the current worker without a durable save", async () => {
    const saveLegacyTemplate = vi.fn(async (_request: {
      readonly url: string; readonly headers: Readonly<Record<string, string>>;
    }) => undefined);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let refreshExpression = "";
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "root", loaderId: "document" } } };
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        refreshExpression = String(params?.expression);
        return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net", responses: [
          { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live",
            body: '[{"event":"live"}]' },
          { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today",
            body: '[{"event":"today"}]' }
        ] } } };
      }
      return {};
    });
    const dependencies: NetworkObserverDependencies & { readonly saveSbobetEventRequest: typeof saveLegacyTemplate } = {
      sendCommand, forward, saveSbobetEventRequest: saveLegacyTemplate
    };
    const observer = new NetworkObserver(dependencies);
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
    const rawUrl = "https://api.sb21.net/api/v2/getEvent?timeRange=live&ticket=raw-ticket";
    const authorization = "Bearer raw-authorization";
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 71,
      auxData: { frameId: "root", isDefault: true } } });
    await observer.handleEvent(ksport, "Network.requestWillBeSent", { requestId: "catalog", type: "Fetch",
      request: { method: "GET", url: rawUrl, headers: { Authorization: authorization } } });
    await observer.handleEvent(ksport, "Network.responseReceived", { requestId: "catalog", type: "Fetch",
      response: { url: rawUrl, status: 200 } });

    await observer.refreshCatalog(ksport);

    expect(saveLegacyTemplate).not.toHaveBeenCalled();
    expect(refreshExpression).toContain(rawUrl);
    expect(refreshExpression).toContain(authorization);
    expect(forward.mock.calls.filter(([message]) => message.transport === "HTTP_RESPONSE")).toHaveLength(2);
  });

  it("does not let a KSPORT hidden-detail request replace the live list template", async () => {
    let refreshExpression = "";
    const body = JSON.stringify([{ "1": "League", "2": [{ "8": "event-1", "2": "Home",
      "3": "Away", "7": { "3": ["2.5 0.91*home -0.99*away market-1"] } }] }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "root", loaderId: "document" } } };
      }
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        refreshExpression = String(params?.expression);
        return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
          responses: [
            { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body },
            { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body }
          ] } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 71,
      auxData: { frameId: "root", isDefault: true } } });
    await observer.handleEvent(ksport, "Network.requestWillBeSent", { requestId: "list", type: "Fetch",
      request: { method: "GET",
        url: "https://api.sb21.net/api/v2/getEvent?timeRange=live&listProof=keep",
        headers: { "x-list-proof": "keep" } } });
    await observer.handleEvent(ksport, "Network.responseReceived", { requestId: "list", type: "Fetch",
      response: { url: "https://api.sb21.net/api/v2/getEvent?timeRange=live&listProof=keep", status: 200 } });
    await observer.handleEvent(ksport, "Network.requestWillBeSent", { requestId: "detail", type: "Fetch",
      request: { method: "GET",
        url: "https://api.sb21.net/api/v2/getEvent?timeRange=live&eventId=event-1&detailProof=drop",
        headers: { "x-detail-proof": "drop" } } });
    await observer.handleEvent(ksport, "Network.responseReceived", { requestId: "detail", type: "Fetch",
      response: { url: "https://api.sb21.net/api/v2/getEvent?timeRange=live&eventId=event-1&detailProof=drop", status: 200 } });

    await observer.refreshCatalog(ksport);

    expect(refreshExpression).toContain("listProof=keep");
    expect(refreshExpression).toContain("x-list-proof");
    expect(refreshExpression).not.toContain("detailProof=drop");
    expect(refreshExpression).not.toContain("x-detail-proof");
    expect(refreshExpression).toContain('!url.searchParams.has("eventId")');
    expect(refreshExpression).toContain('url.searchParams.delete("eventId")');
  });

  it("pairs page-native KSPORT live and today responses only after a recovery tab selection", async () => {
    const liveBody = '[{"1":"Live League","2":[]}]';
    const todayBody = '[{"1":"Today League","2":[]}]';
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("time-tab-container")) {
        return { result: { value: { status: "time-tab-selected", step: "tab",
          groups: 1, scopes: 1, periods: 2 } } };
      }
      if (method === "Network.getResponseBody") {
        return { body: params?.requestId === "native-live" ? liveBody : todayBody,
          base64Encoded: false };
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "current-document" } } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 10_000, monotonicNow: () => 50 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "catalog", url: "wss://d42.sb21.net/sport/538/session/websocket"
    }, "sportsbook-child");
    await observer.handleEvent(source, "Network.webSocketFrameSent", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportSubscribe("live") } }, "sportsbook-child");
    await observer.ensureCompleteKsportBaseline(source);
    forwarded.length = 0;

    for (const partition of ["live", "today"] as const) {
      const requestId = `native-${partition}`;
      const url = `https://api.sb21.net/api/v2/getEvent?timeRange=${partition}`;
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
        frameId: "top", loaderId: "current-document",
        request: { method: "GET", url, headers: {} } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
        response: { url } });
      await observer.handleEvent(source, "Network.loadingFinished", { requestId });
    }

    const paired = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");
    expect(paired).toHaveLength(2);
    expect(paired.map((envelope) => envelope.request.providerPartition)).toEqual([
      "KSPORT_LIVE", "KSPORT_TODAY"
    ]);
    expect(new Set(paired.map((envelope) => envelope.request.streamId)).size).toBe(1);
    expect(paired.every((envelope) => (envelope.request as Record<string, unknown>).providerContentIntent ===
      "FOOTBALL_FULL_CATALOG")).toBe(true);
    expect(paired.map((envelope) => envelope.payload.body)).toEqual([liveBody, todayBody]);
  });

  it("keeps a native KSPORT capture open until an error partition is replaced by a full snapshot", async () => {
    const errorBody = '{"status":"error","errorCode":500,"values":null}';
    const liveBody = '[[{"1":"Live League","2":[]}]]';
    const todayBody = '[[{"1":"Today League","2":[]}]]';
    const bodies = new Map([
      ["native-live-error", errorBody], ["native-live-valid", liveBody], ["native-today", todayBody]
    ]);
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("time-tab-container")) {
        return { result: { value: { status: "time-tab-selected", step: "tab",
          groups: 1, scopes: 1, periods: 2 } } };
      }
      if (method === "Network.getResponseBody") {
        return { body: bodies.get(String(params?.requestId)) ?? "", base64Encoded: false };
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "current-document" } } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 10_000, monotonicNow: () => 50 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "catalog", url: "wss://d42.sb21.net/sport/538/session/websocket"
    }, "sportsbook-child");
    await observer.handleEvent(source, "Network.webSocketFrameSent", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportSubscribe("live") } }, "sportsbook-child");
    await observer.ensureCompleteKsportBaseline(source);
    forwarded.length = 0;

    const capture = async (requestId: string, partition: "live" | "today") => {
      const url = `https://api.sb21.net/api/v2/getEvent?timeRange=${partition}`;
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
        frameId: "top", loaderId: "current-document", request: { method: "GET", url, headers: {} } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
        response: { url } });
      await observer.handleEvent(source, "Network.loadingFinished", { requestId });
    };
    await capture("native-live-error", "live");
    await capture("native-today", "today");
    expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(0);

    await capture("native-live-valid", "live");
    const paired = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");
    expect(paired).toHaveLength(2);
    expect(paired.map((envelope) => envelope.payload.body)).toEqual([liveBody, todayBody]);
  });

  it("drops auxiliary KSPORT sockets and passive unpaired getEvent bodies before bridge forwarding", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) =>
      method === "Network.getResponseBody" ? { body: "[]", base64Encoded: false } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000,
      monotonicNow: () => 1_000 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;

    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "auxiliary", url: "wss://aux.ksport.example/realtime"
    });
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "auxiliary",
      response: { opcode: 1, payloadData: '{"t":"top","d":[]}' } });
    for (const [requestId, url] of [
      ["wrong-protocol", "ws://d42.sb21.net/sport/538/session"],
      ["wrong-prefix", "wss://d42.sb21.net/foo/sport/538/session"],
      ["wrong-name", "wss://d42.sb21.net/sporting/538/session"],
      ["wrong-host", "wss://sports.example/sport/538/session"],
      ["deceptive-host", "wss://sb21.net.sports.example/sport/538/session"],
      ["credentials", "wss://user:password@d42.sb21.net/sport/538/session"]
    ] as const) {
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId, url });
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId,
        response: { opcode: 1,
          payloadData: "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n\nignored\u0000" } });
    }
    await observer.handleEvent(ksport, "Network.requestWillBeSent", { requestId: "native-today",
      type: "Fetch", frameId: "sportsbook-frame", loaderId: "sportsbook-document",
      request: { method: "GET",
        url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", headers: {} } });
    await observer.handleEvent(ksport, "Network.responseReceived", { requestId: "native-today", type: "Fetch",
      response: { url: "https://api.sb21.net/api/v2/getEvent?timeRange=today" } });
    await observer.handleEvent(ksport, "Network.loadingFinished", { requestId: "native-today" });

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.getResponseBody")).toBe(false);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.evaluate" ||
      method === "Runtime.callFunctionOn" || method === "Runtime.queryObjects")).toBe(false);
    expect(forward).not.toHaveBeenCalled();

    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "catalog", url: "wss://d42.sb21.net/sport/538/session/websocket"
    });
    await observer.handleEvent(ksport, "Network.webSocketFrameSent", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportSubscribe("live") } });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "WS_STATE",
      request: expect.objectContaining({ streamId: "1" }) }));
  });

  it("does not restore a KSPORT request template after a worker restart", async () => {
    const loadLegacyTemplate = vi.fn(async () => ({
      url: "https://api.sb21.net/api/v2/getEvent?timeRange=live&ticket=raw-ticket",
      headers: { Authorization: "Bearer raw-authorization" }
    }));
    let refreshExpression = "";
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "root", loaderId: "document" } } };
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        refreshExpression = String(params?.expression);
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-template-missing" } } };
      }
      return {};
    });
    const dependencies: NetworkObserverDependencies & { readonly loadSbobetEventRequest: typeof loadLegacyTemplate } = {
      sendCommand, forward: vi.fn(async () => undefined), loadSbobetEventRequest: loadLegacyTemplate
    };
    const observer = new NetworkObserver(dependencies);
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 71,
      auxData: { frameId: "root", isDefault: true } } });

    await observer.refreshCatalog(ksport);

    expect(loadLegacyTemplate).not.toHaveBeenCalled();
    expect(refreshExpression).toContain("const capturedUrl = null");
    expect(refreshExpression).not.toContain("raw-ticket");
    expect(refreshExpression).not.toContain("raw-authorization");
  });

  it("requests a fresh BTI football catalog in the attached authenticated tab", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "sports-frame" } }] } };
      if (method === "Page.createIsolatedWorld") return {
        executionContextId: params?.frameId === "top" ? 21 : 22
      };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.refreshCatalog({ lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 });

    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations).toHaveLength(2);
    expect(evaluations.map(([, , params]) => params?.contextId)).toEqual([undefined, 22]);
    expect(evaluations.every(([, , params]) => params?.expression === BTI_CATALOG_REFRESH_EXPRESSION &&
      params?.awaitPromise === true)).toBe(true);
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("/api/eventlist/asia/leagues/v2/1/");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("['live', 'prematch']");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("&leagueIds=01");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("/api/eventpage/events/");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("hideX25X75Selections=false");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("credentials: 'include'");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("cache: 'no-store'");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("X-Fieldline-Generation");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).not.toMatch(/cookie|authorization|password/iu);
    expect(() => new Function(`return ${BTI_CATALOG_REFRESH_EXPRESSION}`)).not.toThrow();
  });

  it("hydrates every BTI league advertised by the initial roster before publishing the generation", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = (leagueId: string, eventIds: readonly string[] = []): unknown[] => {
      const value = Array.from({ length: 13 }, () => null) as unknown[];
      value[0] = leagueId;
      value[12] = eventIds.map((eventId) => [eventId]);
      return value;
    };
    const liveLeagueIds = Array.from({ length: 12 }, (_unused, index) => `live-league-${index + 1}`);
    const prematchLeagueIds = ["prematch-league-1", "prematch-league-2"];
    const requested: string[] = [];
    const fetcher = async (path: string) => {
      requested.push(path);
      if (path.startsWith("/api/eventpage/")) return { ok: true, text: async () => '{"data":[]}' };
      if (path.includes("/early/initial?")) return { ok: true, text: async () => '{"serializedData":[]}' };
      if (path === "/api/eventlist/asia/leagues/v2/1/live/initial?regionCode=VN&leagueIds=01") {
        const leagues = liveLeagueIds.map((leagueId) => league(leagueId));
        (leagues[0]![12] as unknown[]) = [["live-event-live-league-1", "richer-initial-market-data"]];
        return { ok: true, text: async () => JSON.stringify({ serializedData: leagues }) };
      }
      if (path === "/api/eventlist/asia/leagues/v2/1/prematch/initial?regionCode=VN&leagueIds=01") {
        return { ok: true, text: async () => JSON.stringify({
          serializedData: prematchLeagueIds.map((leagueId) => league(leagueId))
        }) };
      }
      const match = /^\/api\/eventlist\/asia\/leagues\/v2\/1\/(live|prematch)\?leagueIds=(.+)$/u.exec(path);
      if (match !== null) {
        const eventPrefix = match[1] === "live" ? "live" : "prematch";
        return { ok: true, text: async () => JSON.stringify({
          serializedData: match[2]!.split(",").map((leagueId) => league(leagueId,
            leagueId === "live-league-12" ? [] : [`${eventPrefix}-event-${leagueId}`]))
        }) };
      }
      return { ok: false, text: async () => "" };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (
        document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string },
        fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }
      ) => Promise<{ readonly responses: readonly { readonly url: string; readonly body: string }[] }>;

    const result = await evaluate({ documentElement: root }, {
      pathname: "/sports", hostname: "bti.test", origin: "https://bti.test"
    }, fetcher, { getItem: () => null });

    expect(requested.filter((path) => path.includes("/live?leagueIds="))).toEqual([
      `/api/eventlist/asia/leagues/v2/1/live?leagueIds=${liveLeagueIds.slice(0, 10).join(",")}`,
      `/api/eventlist/asia/leagues/v2/1/live?leagueIds=${liveLeagueIds.slice(10).join(",")}`
    ]);
    expect(requested.filter((path) => path.includes("/prematch?leagueIds="))).toEqual([
      `/api/eventlist/asia/leagues/v2/1/prematch?leagueIds=${prematchLeagueIds.join(",")}`
    ]);
    const live = result.responses.find(({ url }) =>
      url === "/api/eventlist/asia/leagues/v2/1/live");
    const prematch = result.responses.find(({ url }) =>
      url === "/api/eventlist/asia/leagues/v2/1/prematch/initial");
    expect((JSON.parse(live!.body) as { serializedData: unknown[][] }).serializedData
      .flatMap((item) => item[12] as string[][]).map(([eventId]) => eventId)).toEqual([
      ...liveLeagueIds.slice(0, 11).map((leagueId) => `live-event-${leagueId}`)
    ]);
    expect((JSON.parse(live!.body) as { serializedData: unknown[][] }).serializedData).toHaveLength(11);
    expect(((JSON.parse(live!.body) as { serializedData: unknown[][] }).serializedData[0]![12] as unknown[][])[0])
      .toEqual(["live-event-live-league-1"]);
    expect((JSON.parse(prematch!.body) as { serializedData: unknown[][] }).serializedData
      .flatMap((item) => item[12] as string[][]).map(([eventId]) => eventId)).toEqual([
      ...prematchLeagueIds.map((leagueId) => `prematch-event-${leagueId}`)
    ]);
  });

  it("reuses one in-page BTI roster worker when a later refresh joins the unfinished generation", async () => {
    const root = { dataset: {} as Record<string, string> };
    const releases: Array<() => void> = [];
    const requested: string[] = [];
    const fetcher = (path: string) => {
      requested.push(path);
      return new Promise((resolve) => releases.push(() => resolve({
        ok: true, text: async () => '{"serializedData":[]}'
      })));
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (
        document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string },
        fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }
      ) => Promise<{ readonly generation: string }>;
    const location = { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" };

    const first = evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    const second = evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requested).toHaveLength(3);
    for (const release of releases) release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult.generation).toBe(firstResult.generation);
  });

  it("forwards one complete BTI generation directly when CDP does not retain the fetch bodies", async () => {
    const generation = "bti:1720000000000:17";
    const responses = [
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch",
      "/api/eventpage/events/event-hidden"
    ].map((url, index) => ({ url, body: JSON.stringify({ serializedData: [], index }) }));
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Runtime.evaluate") return {
        result: { value: { status: "catalog-requested", generation, origin: "https://sports.bti.test", responses } }
      };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, now: () => 2_001,
      forward: async (envelope) => { forwarded.push(envelope); } });

    await observer.refreshCatalog({ lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 });

    expect(forwarded).toHaveLength(5);
    expect(forwarded.map(({ transport }) => transport)).toEqual([
      "HTTP_RESPONSE", "HTTP_RESPONSE", "HTTP_RESPONSE", "HTTP_RESPONSE", "HTTP_RESPONSE"
    ]);
    expect(forwarded.map(({ request }) => request.pathnameClass)).toEqual([
      "/api/eventpage/events/event-hidden",
      "/api/eventlist/asia/leagues/v2/1/prematch",
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
    ]);
    expect(forwarded.map(({ request }) => request.streamId)).toEqual([
      generation, generation, generation, generation, generation
    ]);
    expect(forwarded.map(({ payload }) => payload.body)).toEqual([
      responses[4]!.body, responses[3]!.body, responses[0]!.body, responses[1]!.body,
      responses[2]!.body
    ]);
  });

  it("waits long enough for a bounded BTI fetch generation that completes after the generic frame timeout", async () => {
    vi.useFakeTimers();
    try {
      const paths = [
        "/api/eventlist/asia/leagues/v2/1/live",
        "/api/eventlist/asia/leagues/v2/1/live/initial",
        "/api/eventlist/asia/leagues/v2/1/prematch/initial"
      ];
      const sendCommand = vi.fn(async (_tabId: number, method: string) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
        if (method !== "Runtime.evaluate") return {};
        return await new Promise((resolve) => setTimeout(() => resolve({ result: { value: {
          status: "catalog-requested", generation: "bti:1720000000000:19",
          origin: "https://sports.bti.test", responses: paths.map((url) => ({
            url, body: '{"serializedData":[]}'
          }))
        } } }), 3_000));
      });
      const forward = vi.fn(async () => undefined);
      const observer = new NetworkObserver({ sendCommand, forward });

      const refresh = observer.refreshCatalog({ lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 });
      await vi.advanceTimersByTimeAsync(3_001);
      await refresh;

      expect(forward).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a hung BTI list request so a partial refresh cannot block the next generation", async () => {
    vi.useFakeTimers();
    try {
      const root = { dataset: {} as Record<string, string> };
      const requests: Array<{ path: string; generation?: string }> = [];
      const fetcher = (path: string, init?: { headers?: Record<string, string> }) => {
        const generation = init?.headers?.["X-Fieldline-Generation"];
        requests.push({ path, ...(generation === undefined ? {} : { generation }) });
        if (path.includes("/live/initial?")) return new Promise<never>(() => undefined);
        return Promise.resolve({ ok: true, json: async () => ({ serializedData: [] }) });
      };
      const evaluate = new Function("document", "location", "fetch", "localStorage",
        `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
          location: { pathname: string; hostname: string }, fetch: typeof fetcher,
          localStorage: { getItem: (_key: string) => null }) => Promise<string>;
      const refresh = evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" },
        fetcher, { getItem: () => null });
      await vi.advanceTimersByTimeAsync(10_002);
      await expect(refresh).resolves.toMatchObject({ status: "catalog-failed", responses: [] });
      const listRequests = requests.filter(({ path }) => path.startsWith("/api/eventlist/"));
      expect(listRequests).toHaveLength(4);
      expect(listRequests.filter(({ path }) => path.includes("/live/initial?"))).toHaveLength(2);
      expect(listRequests.filter(({ path }) => path.includes("/prematch/initial?"))).toHaveLength(1);
      expect(new Set(listRequests.map(({ generation }) => generation)).size).toBe(1);
      expect(listRequests[0]!.generation).toMatch(/^bti:\d+:\d+$/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the complete BTI list generation without waiting for slow detail requests", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league: unknown[] = [];
    league[12] = [["event-1", null, null, null, null, false]];
    const fetcher = (path: string) => path.startsWith("/api/eventpage/")
      ? new Promise<never>(() => undefined)
      : Promise.resolve({ ok: true, status: 200,
        json: async () => ({ serializedData: path.includes("/prematch/") ? [league] : [] }) });
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<unknown>;

    const refresh = evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" },
      fetcher, { getItem: () => null });

    await expect(Promise.race([refresh, new Promise((resolve) => setTimeout(() => resolve("timed-out"), 25))]))
      .resolves.toMatchObject({ status: "catalog-requested", responses: expect.any(Array) });
  });

  it("hydrates BTI hidden detail only for current prematch events and evicts stale detail", async () => {
    const root = { dataset: {} as Record<string, string>,
      __fieldlineBtiDetailBodiesV10: [{
        path: "/api/eventpage/events/stale-event",
        body: '{"data":[["stale-event"]]}'
      }] };
    const league = (eventId: string) => {
      const value = Array.from({ length: 13 }, () => null) as unknown[];
      value[12] = [[eventId, null, null, null, null, eventId === "live-event"]];
      return value;
    };
    const requested: string[] = [];
    const fetcher = async (path: string) => {
      if (path.startsWith("/api/eventpage/events/")) {
        requested.push(decodeURIComponent(path.slice("/api/eventpage/events/".length).split("?")[0]!));
        return { ok: true, text: async () => '{"data":[]}' };
      }
      const serializedData = path.includes("/live/") ? [league("live-event")]
        : path.includes("/prematch/") ? [league("prematch-event")] : [];
      return { ok: true, text: async () => JSON.stringify({ serializedData }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<unknown>;

    await evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" }, fetcher,
      { getItem: () => null });
    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined());

    expect(requested).toEqual(["prematch-event"]);
    expect(root.__fieldlineBtiDetailBodiesV10).toEqual([expect.objectContaining({
      path: "/api/eventpage/events/prematch-event", empty: true
    })]);
  });

  it("returns completed BTI detail bodies directly on the next catalog generation", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = [["event-direct", null, null, null, null, false]];
    const detailSelection = Array.from({ length: 30 }, () => null) as unknown[];
    detailSelection[0] = "selection-direct";
    detailSelection[2] = { VI: "Tài" };
    detailSelection[5] = false;
    detailSelection[8] = ["", "1.90", "", "", "", "0.90"];
    detailSelection[9] = 1;
    detailSelection[13] = false;
    detailSelection[16] = 2.75;
    detailSelection[29] = "selection-private-canary";
    const opposingSelection = [...detailSelection];
    opposingSelection[0] = "selection-opposing";
    opposingSelection[2] = { VI: "Xỉu" };
    opposingSelection[9] = 3;
    const detailMarket = Array.from({ length: 30 }, () => null) as unknown[];
    detailMarket[0] = "market-direct";
    detailMarket[1] = "OU1";
    detailMarket[5] = ["OU1", "First Half Total"];
    detailMarket[13] = [detailSelection, opposingSelection];
    detailMarket[29] = "market-private-canary";
    const homeHandicap = [...detailSelection];
    homeHandicap[0] = "home-handicap";
    homeHandicap[2] = { VI: "Home" };
    homeHandicap[9] = 1;
    homeHandicap[16] = -0.5;
    const awayHandicap = [...detailSelection];
    awayHandicap[0] = "away-handicap";
    awayHandicap[2] = { VI: "Away" };
    awayHandicap[9] = 3;
    awayHandicap[16] = 0.5;
    const detailHandicap = Array.from({ length: 30 }, () => null) as unknown[];
    detailHandicap[0] = "handicap-direct";
    detailHandicap[1] = "HC0";
    detailHandicap[5] = ["HC0", "Asian Handicap"];
    detailHandicap[13] = [homeHandicap, awayHandicap];
    const unknownYes = [...detailSelection];
    unknownYes[0] = "unknown-yes";
    unknownYes[2] = { EN: "Yes" };
    unknownYes[9] = 7;
    unknownYes[16] = 0;
    const unknownNo = [...unknownYes];
    unknownNo[0] = "unknown-no";
    unknownNo[2] = { EN: "No" };
    unknownNo[9] = 8;
    const unknownMarket = Array.from({ length: 30 }, () => null) as unknown[];
    unknownMarket[0] = "unknown-card-market";
    unknownMarket[1] = { VI: "Thẻ phạt bí ẩn", EN: "Mystery cards" };
    unknownMarket[5] = ["ZZ999", { EN: "Mystery cards" }];
    unknownMarket[13] = [unknownYes, unknownNo];
    const detailEvent = Array.from({ length: 39 }, () => null) as unknown[];
    detailEvent[0] = "event-direct";
    detailEvent[2] = "Direct League";
    detailEvent[8] = [["home", { VI: "Home" }, { VI: "Alpha" }],
      ["away", { VI: "Away" }, { VI: "Beta" }]];
    detailEvent[11] = "2026-09-07T00:15:00.000Z";
    detailEvent[13] = false;
    detailEvent[20] = [detailMarket, detailHandicap, unknownMarket];
    detailEvent[38] = "event-private-canary";
    let detailRead = 0;
    const fetcher = async (path: string) => {
      if (!path.startsWith("/api/eventpage/")) {
        return { ok: true, text: async () => JSON.stringify({ serializedData: path.includes("/prematch/") ? [league] : [] }) };
      }
      const currentDetail = [...detailEvent];
      currentDetail[34] = ++detailRead;
      return { ok: true, text: async () => JSON.stringify({ data: [currentDetail],
        unrelatedProviderMetadata: "must-not-cross-the-bridge" }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<{
          responses: Array<{ url: string; body: string }>;
        }>;
    const location = { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" };

    await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });
    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined());
    root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    delete (root as unknown as Record<string, unknown>).__fieldlineBtiRosterWorkerV10;
    await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });
    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined());
    root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    delete (root as unknown as Record<string, unknown>).__fieldlineBtiRosterWorkerV10;
    const next = await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });

    const batch = next.responses.find(({ url }) =>
      url.startsWith("/api/eventpage/events/__fieldline_batch_"));
    expect(batch).toBeDefined();
    const compactEvent = JSON.parse(batch!.body).data[0] as unknown[];
    expect(compactEvent[0]).toBe("event-direct");
    expect(compactEvent[2]).toBe("Direct League");
    expect((compactEvent[8] as unknown[][]).map((participant) => participant[1])).toEqual([
      { VI: "Alpha" }, { VI: "Beta" }
    ]);
    expect(compactEvent[11]).toBe("2026-09-07T00:15:00.000Z");
    expect(compactEvent[13]).toBe(false);
    expect((compactEvent[20] as unknown[][])[0]?.[13]).toHaveLength(2);
    expect(compactEvent[20]).toEqual(expect.arrayContaining([expect.arrayContaining([
      "unknown-card-market"
    ])]));
    const retainedUnknown = (compactEvent[20] as unknown[][]).find((market) =>
      market[0] === "unknown-card-market")!;
    expect((retainedUnknown[13] as unknown[][]).map((selection) => [selection[0], selection[9], selection[16]]))
      .toEqual([["unknown-yes", 7, 0], ["unknown-no", 8, 0]]);
    expect(batch!.body).not.toContain("must-not-cross-the-bridge");
    expect(batch!.body).not.toContain("private-canary");
    expect(next.responses.indexOf(batch!)).toBeLessThan(next.responses.findIndex(({ url }) =>
      url === "/api/eventlist/asia/leagues/v2/1/live"));
    expect((root as unknown as Record<string, Array<unknown>>).__fieldlineBtiDetailBodiesV10).toHaveLength(1);
  });

  it("caches authoritative empty BTI detail for later catalog removal", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = [["event-empty", null, null, null, null, false]];
    const fetcher = async (path: string) => path.startsWith("/api/eventpage/")
      ? { ok: true, text: async () => '{"data":[]}' }
      : { ok: true, text: async () => JSON.stringify({ serializedData: path.includes("/prematch/") ? [league] : [] }) };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<{
          responses: Array<{ url: string; body: string }>;
        }>;
    const location = { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" };

    await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });
    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined());
    root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    delete (root as unknown as Record<string, unknown>).__fieldlineBtiRosterWorkerV10;
    const next = await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null });

    expect(next.responses.some(({ url }) =>
      url.startsWith("/api/eventpage/events/__fieldline_batch_"))).toBe(true);
  });

  it("bounds BTI detail enrichment to three concurrent requests", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = ["event-1", "event-2", "event-3"].map((id) => [id, null, null, null, null, false]);
    let activeDetails = 0;
    let maxActiveDetails = 0;
    const releases: Array<() => void> = [];
    const fetcher = (path: string) => {
      if (!path.startsWith("/api/eventpage/")) {
        return Promise.resolve({ ok: true, text: async () => JSON.stringify({ serializedData: path.includes("/prematch/") ? [league] : [] }) });
      }
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      return new Promise((resolve) => releases.push(() => {
        activeDetails -= 1;
        resolve({ ok: true, text: async () => '{"data":[]}' });
      }));
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<unknown>;

    await evaluate({ documentElement: root }, {
      pathname: "/sports", hostname: "bti.test", origin: "https://bti.test"
    }, fetcher, { getItem: () => null });
    expect(releases).toHaveLength(3);
    expect(maxActiveDetails).toBe(3);
    for (const release of releases.splice(0)) release();
    await vi.waitFor(() => expect(activeDetails).toBe(0));
    expect(maxActiveDetails).toBe(3);
  });

  it("requests hidden BTI detail for every event when the roster exceeds the former batch cap", async () => {
    const eventIds = Array.from({ length: 20 }, (_unused, index) => `event-${index + 1}`);
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = eventIds.map((eventId) => [eventId, null, null, null, null, false]);
    const requested: string[] = [];
    const fetcher = async (path: string) => {
      if (path.startsWith("/api/eventpage/events/")) {
        requested.push(decodeURIComponent(path.slice("/api/eventpage/events/".length).split("?")[0]!));
        return { ok: true, text: async () => '{"data":[]}' };
      }
      return { ok: true, text: async () => JSON.stringify({ serializedData: path.includes("/prematch/initial?")
        ? [league] : [] }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<unknown>;

    await evaluate({ documentElement: root }, {
      pathname: "/sports", hostname: "bti.test", origin: "https://bti.test"
    }, fetcher, { getItem: () => null });
    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined(), { timeout: 4_000 });

    expect(requested).toEqual(eventIds);
  });

  it("finishes the complete BTI detail queue while adopting the newest generation headers", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = ["event-1", "event-2", "event-3", "event-4"].map((id) => [id, null, null, null, null, false]);
    let detailRequests = 0;
    let activeBodies = 0;
    let maxActiveBodies = 0;
    const detailGenerations: string[] = [];
    const releases: Array<() => void> = [];
    const fetcher = async (path: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
      if (!path.startsWith("/api/eventpage/")) {
        return { ok: true, text: async () => JSON.stringify({ serializedData: path.includes("/prematch/") ? [league] : [] }) };
      }
      detailRequests += 1;
      detailGenerations.push(init?.headers?.["X-Fieldline-Generation"] ?? "");
      return { ok: true, text: async () => {
        activeBodies += 1;
        maxActiveBodies = Math.max(maxActiveBodies, activeBodies);
        return new Promise<string>((resolve) => { releases.push(() => {
          activeBodies -= 1;
          resolve("");
        }); });
      } };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string; origin: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<unknown>;
    const location = { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" };

    const first = await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null }) as {
      generation: string;
    };
    await vi.waitFor(() => expect(detailRequests).toBe(3));
    root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    delete (root as unknown as Record<string, unknown>).__fieldlineBtiRosterWorkerV10;
    const second = await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null }) as {
      generation: string;
    };
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(detailRequests).toBe(3);
    releases.shift()?.();
    await vi.waitFor(() => expect(detailRequests).toBe(4));
    for (const release of releases.splice(0)) release();

    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined());
    expect(first.generation).not.toBe(second.generation);
    expect(detailGenerations).toEqual([
      first.generation, first.generation, first.generation, second.generation
    ]);
    expect(maxActiveBodies).toBe(3);
  });

  it("stops BTI frame discovery after the first complete authenticated generation", async () => {
    const generation = "bti:1720000000000:27";
    const paths = [
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
    ];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "doc" },
        childFrames: [{ frame: { id: "unused-child", loaderId: "child-doc" } }] } };
      if (method === "Runtime.evaluate" && params?.contextId === undefined) return { result: { value: {
        status: "catalog-requested", generation, origin: "https://sports.bti.test",
        responses: paths.map((url) => ({ url, body: '{"serializedData":[]}' }))
      } } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.refreshCatalog({ lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 });

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Page.createIsolatedWorld")).toHaveLength(0);
  });

  it("uses the current in-page BTI session headers for every fresh event-list request", async () => {
    const root = { dataset: {} as Record<string, string> };
    const listHeaders: Array<Record<string, string>> = [];
    const fetcher = async (path: string, init?: { headers?: Record<string, string> }) => {
      if (path.startsWith("/api/eventlist/")) listHeaders.push(init?.headers ?? {});
      return { ok: true, json: async () => ({ serializedData: [] }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (
        document: { documentElement: typeof root },
        location: { pathname: string; hostname: string },
        fetch: typeof fetcher,
        localStorage: { getItem: (key: string) => string | null }
      ) => Promise<unknown>;

    await evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" }, fetcher, {
      getItem: (key) => key === "CT_APP_AUTHORIZATION" ? "opaque-session-token"
        : key === "CT_APP_SERVICE_CONTEXT" ? "opaque-service-context" : null
    });

    expect(listHeaders).toHaveLength(3);
    expect(listHeaders).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({
      authorization: "opaque-session-token",
      "service-context": "opaque-service-context"
    })));
  });

  it("does not starve a BTI event when the provider reorders the event list between detail batches", async () => {
    const sourceClock = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const orders = [
      ["a", "b", "c", "d", "e", "f", "g"],
      ["g", "a", "b", "c", "d", "e", "f"],
      ["a", "b", "c", "d", "e", "f", "g"]
    ];
    const requested = new Set<string>();
    const requestCounts = [0, 0, 0];
    const root = { dataset: {} as Record<string, string> };
    let round = 0;
    const fetcher = async (path: string) => {
      if (path.startsWith("/api/eventpage/events/")) {
        requestCounts[round]! += 1;
        requested.add(decodeURIComponent(path.slice("/api/eventpage/events/".length).split("?")[0]!));
        return { ok: true, json: async () => ({ data: [] }) };
      }
      const league = Array.from({ length: 13 }, () => null) as unknown[];
      league[12] = path.includes("/prematch/initial?")
        ? orders[Math.min(round, orders.length - 1)]!.map((id) => [id, null, null, null, null, false])
        : [];
      return { ok: true, json: async () => ({ serializedData: path.includes("/prematch/") ? [league] : [] }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (
        document: { documentElement: typeof root },
        location: { pathname: string; hostname: string },
        fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }
      ) => Promise<string>;

    for (round = 0; round < orders.length; round += 1) {
      sourceClock.mockReturnValue(1_800_000_000_000 + round * 13_000);
      root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    delete (root as unknown as Record<string, unknown>).__fieldlineBtiRosterWorkerV10;
      await evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" }, fetcher,
        { getItem: () => null });
      await vi.waitFor(() => expect(requestCounts[round]).toBe(7), { timeout: 2_000 });
    }

    expect([...requested].sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(requestCounts).toEqual([7, 7, 7]);
    sourceClock.mockRestore();
  });

  it("remembers BTI detail visits when prematch pages temporarily disappear from the list", async () => {
    const orders = [
      ["a", "b", "c", "d", "e", "f", "g"],
      ["h", "i", "j", "k", "l", "m", "n"],
      ["a", "b", "c", "d", "e", "f", "g"],
      ["h", "i", "j", "k", "l", "m", "n"]
    ];
    const requested = new Set<string>();
    const root = { dataset: {} as Record<string, string> };
    let round = 0;
    const fetcher = async (path: string) => {
      if (path.startsWith("/api/eventpage/events/")) {
        requested.add(decodeURIComponent(path.slice("/api/eventpage/events/".length).split("?")[0]!));
        return { ok: true, json: async () => ({ data: [] }) };
      }
      const league = Array.from({ length: 13 }, () => null) as unknown[];
      league[12] = path.includes("/prematch/initial?") ? orders[round]!.map((id) => [id, null, null, null, null, false]) : [];
      return { ok: true, json: async () => ({ serializedData: path.includes("/prematch/") ? [league] : [] }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (
        document: { documentElement: typeof root },
        location: { pathname: string; hostname: string },
        fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }
      ) => Promise<string>;

    for (round = 0; round < orders.length; round += 1) {
      root.dataset.fieldlineBtiCatalogRefreshAt = "0";
      delete (root as unknown as Record<string, unknown>).__fieldlineBtiRosterWorkerV10;
      await evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" }, fetcher,
        { getItem: () => null });
      await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV10).toBeUndefined(), { timeout: 2_000 });
    }

    expect([...requested].sort()).toEqual(["a", "b", "c", "d", "e", "f", "g",
      "h", "i", "j", "k", "l", "m", "n"]);
  });

  it("refreshes BTI in each frame main world so page auth and origin are preserved", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" }, childFrames: [{ frame: { id: "sports-frame" } }] } }
      : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;
    await observer.handleEvent(bti, "Runtime.executionContextCreated", {
      context: { id: 61, auxData: { frameId: "top", isDefault: true } }
    });
    await observer.handleEvent(bti, "Runtime.executionContextCreated", {
      context: { id: 62, auxData: { frameId: "sports-frame", isDefault: true } }
    });

    await observer.refreshCatalog(bti);

    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations.map(([, , params]) => params?.contextId)).toEqual([undefined, 62]);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Page.createIsolatedWorld")).toHaveLength(0);
  });

  it("does not forward BTI recovery after its owning OOPIF detaches during evaluation", async () => {
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;
    const frameTree = { frameTree: { frame: { id: "top", loaderId: "loader-top" }, childFrames: [{ frame: {
      id: "sports-frame", loaderId: "loader-sports"
    } }] } };
    let observer!: NetworkObserver;
    let detached = false;
    const responses = [
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
    ].map((url) => ({ url, body: '{"events":[]}' }));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      if (method === "Page.getFrameTree") {
        if (sessionId === "bti-child" && detached) throw new Error("detached");
        return frameTree;
      }
      if (method === "Runtime.evaluate" && params?.contextId === 62 && sessionId === "bti-child") {
        detached = true;
        await observer.handleEvent(bti, "Target.detachedFromTarget", { sessionId: "bti-child" });
        return { result: { value: { status: "catalog-requested", generation: "bti:1787557000000:1",
          origin: "https://bti.example", responses } } };
      }
      return { result: { value: { status: "unavailable" } } };
    });
    const forward = vi.fn(async (_message: ChromeBridgeEnvelope) => undefined);
    observer = new NetworkObserver({ sendCommand, forward });
    await observer.handleEvent(bti, "Runtime.executionContextCreated", {
      context: { id: 62, auxData: { frameId: "sports-frame", isDefault: true } }
    }, "bti-child");

    await observer.refreshCatalog(bti);

    expect(sendCommand.mock.calls.some(([, method, params, sessionId]) => method === "Runtime.evaluate" &&
      params?.contextId === 62 && sessionId === "bti-child")).toBe(true);
    expect(forward.mock.calls.some(([message]) => message.transport === "HTTP_RESPONSE")).toBe(false);
  });

  it("bounds BTI child-frame discovery to two concurrent evaluations", async () => {
    let active = 0;
    let maxActive = 0;
    let childEvaluations = 0;
    const releases: Array<() => void> = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" }, childFrames: [
        { frame: { id: "a" } }, { frame: { id: "b" } }, { frame: { id: "c" } }
      ] } };
      if (method === "Runtime.evaluate" && params?.contextId !== undefined) {
        childEvaluations += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (childEvaluations === 3) {
          active -= 1;
          return {};
        }
        return new Promise((resolve) => releases.push(() => { active -= 1; resolve({}); }));
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      btiCatalogRefreshTimeoutMs: 1_000 });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;
    for (const [frameId, id] of [["a", 61], ["b", 62], ["c", 63]] as const) {
      await observer.handleEvent(bti, "Runtime.executionContextCreated", {
        context: { id, auxData: { frameId, isDefault: true } }
      });
    }

    const refresh = observer.refreshCatalog(bti);
    await vi.waitFor(() => expect(active).toBe(2));
    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => expect(childEvaluations).toBe(3));
    await refresh;

    expect(maxActive).toBe(2);
  });

  it("does not let a hung BTI child frame block later catalog refreshes", async () => {
    let refreshRound = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "hung" } }] } };
      if (method === "Page.createIsolatedWorld") return {
        executionContextId: params?.frameId === "top" ? 41 : 42
      };
      if (method === "Runtime.evaluate" && params?.contextId === 42 && refreshRound === 0) {
        return new Promise<never>(() => undefined);
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      frameCommandTimeoutMs: 10, btiCatalogRefreshTimeoutMs: 10 });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;

    await observer.refreshCatalog(bti);
    refreshRound = 1;
    await observer.refreshCatalog(bti);

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(4);
  });

  it("falls back to BTI's top world when frame discovery hangs", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return new Promise<never>(() => undefined);
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      frameCommandTimeoutMs: 10 });

    await observer.refreshCatalog({ lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 });

    expect(sendCommand).toHaveBeenCalledWith(6, "Runtime.evaluate", expect.objectContaining({
      expression: BTI_CATALOG_REFRESH_EXPRESSION
    }));
  });

  it("does not run the CMD DOM collector for websocket-authoritative SABA", async () => {
    const sendCommand = vi.fn(async () => ({}));
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });

    await observer.captureCmdSnapshot(
      { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 }, "sports.example"
    );

    expect(sendCommand).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("keeps SABA active without scanning, scrolling, or clicking its entire DOM", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.maintain(saba);

    expect(sendCommand).toHaveBeenCalledWith(10, "Emulation.setFocusEmulationEnabled", { enabled: true });
    expect(sendCommand).toHaveBeenCalledWith(10, "Page.setWebLifecycleState", { state: "active" });
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.getFrameTree")).toBe(false);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      typeof params?.expression === "string" && params.expression.includes("querySelectorAll('body *')"))).toBe(false);
  });

  it("emits a SABA public discovery diagnostic without holding the normal catalog capture", async () => {
    const discoveryBody = JSON.stringify({ kind: "SABA_PUBLIC_CATALOG_DISCOVERY", version: 1,
      scope: "LEGACY_SPORTS", navControls: [{ period: "EARLY", label: "Sớm", tag: "button",
        classes: ["c-side-nav__tab"], selected: false, expanded: null, visible: true }],
      counts: { footballTables: 1, compactRows: 1, legacyLeagues: 0, legacyRows: 0, prematchRows: 1 },
      matches: [{ matchId: "match-1", shape: "COMPACT", controls: [] }], scroll: [], truncated: false });
    const records = JSON.stringify([{ sportId: "1", leagueId: "league-1", leagueName: "League",
      matchId: "match-1", timeText: "Tomorrow", teamNames: ["Home", "Away"], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: "home-1", priceText: "0.91" },
          { marketOddsId: "away-1", priceText: "0.99" }
        ]
      }] }]);
    let resolveDiscovery!: (value: unknown) => void;
    const pendingDiscovery = new Promise<unknown>((resolve) => { resolveDiscovery = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
        return pendingDiscovery;
      }
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: records } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 10_000, monotonicNow: () => 20 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");

    expect(forwarded.some(({ transport }) => transport === "DOM_SNAPSHOT")).toBe(true);
    expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_catalog_discovery__")).toBe(false);
    resolveDiscovery({ result: { type: "string", value: discoveryBody } });
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_catalog_discovery__")).toBe(true));
    expect(forwarded.find(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_catalog_discovery__")).toEqual(expect.objectContaining({
        lobby: "SABA", transport: "TAB_STATE", payload: { encoding: "UTF8", body: discoveryBody },
        request: expect.objectContaining({ resourceType: "Diagnostic",
          pathnameClass: "/__fieldline_saba_catalog_discovery__" })
      }));

    const before = sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION).length;
    await observer.pollSabaDomChanges({ lobby: "CMD", sourceId: "chrome:CMD:10", tabId: 10 }, "sports.example");
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION)).toHaveLength(before);
  });

  it("rate-limits SABA public discovery and rejects a result from a retired source generation", async () => {
    const now = { value: 10_000 };
    const discoveryBody = JSON.stringify({ kind: "SABA_PUBLIC_CATALOG_DISCOVERY", version: 1,
      scope: "COMPACT", navControls: [], counts: { footballTables: 1, compactRows: 0,
        legacyLeagues: 0, legacyRows: 0, prematchRows: 0 }, matches: [], scroll: [], truncated: false });
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve; });
    let discoveryCalls = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
        discoveryCalls += 1;
        return discoveryCalls === 1 ? first : { result: { type: "string", value: discoveryBody } };
      }
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: "[]" } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now.value, monotonicNow: () => now.value });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    observer.beginSourceEpoch(saba.sourceId);
    resolveFirst({ result: { type: "string", value: discoveryBody } });
    await Promise.resolve();
    await Promise.resolve();
    expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_catalog_discovery__")).toBe(false);

    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(forwarded.filter(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_catalog_discovery__")).toHaveLength(1));
    expect(discoveryCalls).toBe(2);

    now.value += 29_999;
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(discoveryCalls).toBe(2);
    now.value += 1;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(discoveryCalls).toBe(3));
  });

  it("paces SABA discovery from successful completion after a delayed evaluation", async () => {
    const now = { value: 10_000 };
    const body = JSON.stringify({ kind: "SABA_PUBLIC_CATALOG_DISCOVERY", version: 1,
      scope: "COMPACT", navControls: [], counts: { footballTables: 1, compactRows: 1,
        legacyLeagues: 0, legacyRows: 0, prematchRows: 1 }, matches: [], scroll: [], truncated: false });
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve; });
    let calls = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
        calls += 1;
        return calls === 1 ? first : { result: { value: body } };
      }
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        return { result: { value: false } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now.value, monotonicNow: () => now.value });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    now.value = 15_000;
    resolveFirst({ result: { value: body } });
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_catalog_discovery__")).toBe(true));
    now.value = 40_000;
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(calls).toBe(1);
    now.value = 45_000;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(calls).toBe(2));
  });

  it("runs one bounded SABA probe after a usable DOM baseline without publishing probe views", async () => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    let period: "today" | "early" = "today";
    const probeState = () => ({ documentToken: "doc-1", rowCount: period === "today" ? 20 : 3,
      tableCount: 1, activePeriod: period === "today" ? "TODAY" : "EARLY",
      eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: Array.from({ length: period === "today" ? 20 : 3 }, (_, i) => `${period}-${i}`),
      rosterSamples: [], timeShapes: { DATED_KICKOFF: period === "today" ? 20 : 3,
        PREFIXED_KICKOFF: 0, UNDATED_KICKOFF: 0, BARE_LIVE: 0, LIVE_CLOCK: 0, UNKNOWN: 0 },
      dateContexts: [], headerControls: [], fingerprint: `${period}:${period === "today" ? 20 : 3}`,
      truncated: false });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: probeState() } };
      }
      if (method === "Runtime.evaluate" && expression.includes(".c-side-nav__tab") && expression.includes(".click()")) {
        period = expression.includes('===\"SOM\"') ? "early" : "today";
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) return {};
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");

    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method, params]) => method ===
      "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION)).toBe(true));
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true), { timeout: 5_000 });

    expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(1);
    const diagnostic = forwarded.find(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__");
    expect(diagnostic).toEqual(expect.objectContaining({ lobby: "SABA", transport: "TAB_STATE" }));
    expect(JSON.parse(diagnostic?.payload.body ?? "{}")).toMatchObject({
      kind: "SABA_NAVIGATION_PROBE", status: "NO_ACTION_COLLECTOR_TARGET_BOUND",
      mutated: false, viewRestored: true,
      initial: { activePeriod: "TODAY" }
    });
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(forwarded.filter(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toHaveLength(1);
    observer.beginSourceEpoch(saba.sourceId);
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(forwarded.filter(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toHaveLength(2), { timeout: 5_000 });
  });

  it("publishes usable SABA DOM before a held probe and skips overlapping polls without another lane job", async () => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const unknown = { documentToken: "held-probe", rowCount: 60, tableCount: 1,
      activePeriod: "UNKNOWN", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["match-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "unknown", truncated: false };
    let releaseProbe!: (value: unknown) => void;
    let probeStarted = false;
    let mutationReads = 0;
    const heldProbe = new Promise<unknown>((resolve) => { releaseProbe = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        mutationReads += 1;
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeStarted = true;
        return heldProbe;
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    const poll = observer.pollSabaDomChanges(saba, "sports.example");
    let pollResolved = false;
    void poll.then(() => { pollResolved = true; });
    try {
      await vi.waitFor(() => expect(probeStarted).toBe(true));
      await Promise.resolve();

      expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(1);
      expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
      expect(pollResolved).toBe(true);

      const before = mutationReads;
      await expect(observer.pollSabaDomChanges(saba, "sports.example")).resolves.toBeUndefined();
      expect(mutationReads).toBe(before);
    } finally {
      releaseProbe({ result: { value: unknown } });
      await poll;
    }
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true), { timeout: 5_000 });
  });

  it("refuses a queued SABA probe whose DOM lease expires before execution", async () => {
    let now = 10_000;
    let probeReads = 0;
    let scheduledJobs = 0;
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => { releaseProbe = resolve; });
    const scheduler = new ProviderWorkScheduler({ maxConcurrent: 2, maxQueuedPerSource: 2 });
    const run = scheduler.run.bind(scheduler);
    vi.spyOn(scheduler, "run").mockImplementation(<T>(sourceId: string, operation: () => Promise<T>) => {
      scheduledJobs += 1;
      return scheduledJobs === 2
        ? run(sourceId, async () => { await probeGate; return operation(); })
        : run(sourceId, operation);
    });
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        return { result: { value: sabaUnknownProbeState("lease-expired") } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      workScheduler: scheduler, now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    try {
      await observer.pollSabaDomChanges(saba, "sports.example");
      expect(scheduledJobs).toBeGreaterThanOrEqual(2);
      expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
      expect(probeReads).toBe(0);
      now = 160_001;
      expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(false);
    } finally {
      releaseProbe();
    }
    await settleObserverBackgroundTasks();
    expect(probeReads).toBe(0);
    now += 34_000;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(2);
  });

  it.each(["PROBE_FIRST", "RECOVERY_FIRST"] as const)(
    "orders SABA probe and recovery ownership: %s", async (order) => {
    let now = 5_000;
    let probeReads = 0;
    let recoveryEntered = false;
    let releaseRecovery!: (value: unknown) => void;
    const heldRecovery = new Promise<unknown>((resolve) => { releaseRecovery = resolve; });
    const scheduler = new ProviderWorkScheduler({ maxConcurrent: 1 });
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" &&
        expression === "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype") {
        recoveryEntered = true;
        return heldRecovery;
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        return { result: { value: sabaUnknownProbeState("after-owned-recovery") } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => {
        forwarded.push(envelope);
        if (envelope.transport === "DOM_SNAPSHOT" && now === 5_000) now = 25_001;
      }), workScheduler: scheduler, now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    await attachSabaRecoveryWorker(observer, saba);
    try {
      if (order === "RECOVERY_FIRST") {
        await observer.refreshCatalog(saba);
        await vi.waitFor(() => expect(recoveryEntered).toBe(true));
      }
      await observer.pollSabaDomChanges(saba, "sports.example");
      await vi.waitFor(() => expect(scheduler.isBusy(saba.sourceId)).toBe(false));
      expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
      expect(recoveryEntered).toBe(order === "RECOVERY_FIRST");
      expect(probeReads).toBe(order === "RECOVERY_FIRST" ? 0 : 2);
      expect(forwarded.some(({ request }) =>
        request.pathnameClass === "/__fieldline_saba_navigation_probe__"))
        .toBe(order === "PROBE_FIRST");
      if (order === "PROBE_FIRST") {
        // A due read-only retry owns this poll without spending recovery budget.
        now = 55_002;
        await observer.pollSabaDomChanges(saba, "sports.example");
        await vi.waitFor(() => expect(probeReads).toBe(4));
        await vi.waitFor(() => expect(scheduler.isBusy(saba.sourceId)).toBe(false));
        await settleObserverBackgroundTasks();
        expect(recoveryEntered).toBe(false);
        now = 58_002;
        await observer.pollSabaDomChanges(saba, "sports.example");
        await vi.waitFor(() => expect(recoveryEntered).toBe(true));
      }
    } finally {
      releaseRecovery({});
    }
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method, params]) =>
      method === "Runtime.releaseObjectGroup" &&
      String(params?.objectGroup).startsWith("fieldline-baseline-recovery-10-"))).toBe(true));
    await settleObserverBackgroundTasks();
    if (order === "RECOVERY_FIRST") {
      now = 55_003;
      await observer.pollSabaDomChanges(saba, "sports.example");
      // One discovery read finds the target, then the helper reads its initial state.
      await vi.waitFor(() => expect(probeReads).toBe(2));
    } else {
      expect(probeReads).toBe(4);
    }
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));
    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype")).toHaveLength(1);
  });

  it("does not probe from old usable DOM after a failed renewal capture", async () => {
    let now = 10_000;
    let catalogReady = true;
    let probeReads = 0;
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return catalogReady ? { result: { value: records } } : {};
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        return {};
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    expect(probeReads).toBe(1);
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);

    now = 44_000;
    catalogReady = false;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    expect(probeReads).toBe(1);
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
  });

  it("paces no-target SABA probe retries and retries a read-only non-Today target", async () => {
    let now = 10_000;
    let targetReady = false;
    let probeReads = 0;
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const unknown = { documentToken: "paced", rowCount: 60, tableCount: 1,
      activePeriod: "UNKNOWN", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["match-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "unknown", truncated: false };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        return targetReady ? { result: { value: unknown } } : {};
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    expect(probeReads).toBe(1);

    now = 39_999;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    expect(probeReads).toBe(1);

    now = 44_000;
    targetReady = true;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));
    const firstReadOnlyTargetReads = probeReads;

    now = 84_000;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();
    expect(probeReads).toBe(firstReadOnlyTargetReads + 2);
    expect(forwarded.filter(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toHaveLength(2);
  });

  it.each(["source", "tab"] as const)(
    "does not act on a SABA probe after %s retirement and allows the replacement poll", async (retirement) => {
    let now = 10_000;
    let holdFirstRead = true;
    let releaseFirstRead!: (value: unknown) => void;
    let actions = 0;
    const firstRead = new Promise<unknown>((resolve) => { releaseFirstRead = resolve; });
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const unknown = { documentToken: "retired", rowCount: 60, tableCount: 1,
      activePeriod: "UNKNOWN", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["match-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "unknown", truncated: false };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        if (holdFirstRead) return firstRead;
        return { result: { value: unknown } };
      }
      if (method === "Runtime.evaluate" && expression.includes(".click()")) {
        actions += 1;
        return { result: { value: true } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now, monotonicNow: () => now });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method, params]) => method ===
      "Runtime.evaluate" && params?.expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION)).toBe(true));
    if (retirement === "source") observer.beginSourceEpoch(saba.sourceId);
    else observer.prepareDebuggerReattach(saba.tabId);
    releaseFirstRead({ result: { value: unknown } });
    await settleObserverBackgroundTasks();
    expect(actions).toBe(0);
    expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(false);

    holdFirstRead = false;
    now += 4_000;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));
  });

  it("finds the SABA probe document in a child isolated world when root and known contexts are empty", async () => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    let period: "today" | "early" = "today";
    let nowMs = 10_000;
    const probeState = () => ({ documentToken: "child-sports-doc", rowCount: period === "today" ? 20 : 3,
      tableCount: 1, activePeriod: period === "today" ? "TODAY" : "EARLY",
      eligibleMoreCount: 0, eligibleMoreOwners: [], moreCandidates: [],
      rosterMatchIds: Array.from({ length: period === "today" ? 20 : 3 }, (_, index) => `${period}-${index}`),
      rosterSamples: [], timeShapes: { DATED_KICKOFF: period === "today" ? 20 : 3,
        PREFIXED_KICKOFF: 0, UNDATED_KICKOFF: 0, BARE_LIVE: 0, LIVE_CLOCK: 0, UNKNOWN: 0 },
      dateContexts: [], headerControls: [], periodControls: [],
      fingerprint: `${period}:${period === "today" ? 20 : 3}`, truncated: false });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" }, childFrames: [
        { frame: { id: "known-empty" } }, { frame: { id: "sports-frame" } }
      ] } };
      if (method === "Page.createIsolatedWorld") {
        if (params?.worldName === "fieldline-saba-navigation-probe") {
          return { executionContextId: params.frameId === "sports-frame" ? 73 : 72 };
        }
        return { executionContextId: 71 };
      }
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return params?.contextId === 73 ? { result: { value: probeState() } } : { result: { value: null } };
      }
      if (method === "Runtime.evaluate" && expression.includes(".c-side-nav__tab") && expression.includes(".click()")) {
        if (params?.contextId !== 73) return { result: { value: false } };
        period = expression.includes('==="SOM"') ? "early" : "today";
        return { result: { value: true } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => { nowMs += 100; return nowMs; }, monotonicNow: () => nowMs });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    await observer.handleEvent(saba, "Runtime.executionContextCreated", {
      context: { id: 61, auxData: { frameId: "known-empty", isDefault: true } }
    });

    await observer.pollSabaDomChanges(saba, "sports.example");

    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));

    const diagnostic = forwarded.find(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__");
    expect(JSON.parse(diagnostic?.payload.body ?? "{}")).toMatchObject({
      kind: "SABA_NAVIGATION_PROBE", status: "NO_ACTION_COLLECTOR_TARGET_BOUND",
      mutated: false, viewRestored: true,
      initial: { activePeriod: "TODAY" }
    });
    expect(sendCommand).toHaveBeenCalledWith(10, "Page.createIsolatedWorld", expect.objectContaining({
      frameId: "sports-frame", worldName: "fieldline-saba-navigation-probe", grantUniveralAccess: false
    }));
  });

  it("blocks SABA DOM and native reset/done while read-only target binding is in flight", async () => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, matchId: `m-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const state = { documentToken: "doc-guard", rowCount: 60, tableCount: 1,
      activePeriod: "TODAY", activePeriodEvidence: "FOOTBALL_PAGE_HEADING",
      eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: Array.from({ length: 60 }, (_, index) => `m-${index}`), rosterSamples: [],
      timeShapes: { DATED_KICKOFF: 60, PREFIXED_KICKOFF: 0, UNDATED_KICKOFF: 0,
        BARE_LIVE: 0, LIVE_CLOCK: 0, UNKNOWN: 0 }, dateContexts: [], headerControls: [],
      fingerprint: "TODAY-60", truncated: false } as const;
    let probeReads = 0;
    let helperReadHeld = false;
    let releaseHelperRead!: () => void;
    const heldHelperRead = new Promise<void>((resolve) => { releaseHelperRead = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        if (probeReads === 2) { helperReadHeld = true; await heldHelperRead; }
        return { result: { value: state } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "probe-ws", url: "wss://socket.saba.test/socket.io/"
    });
    forwarded.length = 0;

    const poll = observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(helperReadHeld).toBe(true));
    expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(1);
    await observer.ingestDomSnapshot(saba, "sports.example", records);
    const nativeBaseline = `42${JSON.stringify(["m", "b1", [["c", "c2"],
      ["f", 0, ["type", "matchid"]], [0, "reset"], [0, "o"], [0, "done"]], "probe"])}`;
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "probe-ws", response: { opcode: 1,
        payloadData: nativeBaseline }
    });
    expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(1);
    expect(forwarded.some(({ transport }) => transport === "WS_FRAME")).toBe(false);
    expect(observer.hasCompleteSabaBaseline(saba.sourceId)).toBe(false);

    releaseHelperRead();
    await poll;
    await vi.waitFor(() => expect(forwarded.some(({ request, payload }) => request.pathnameClass ===
      "/__fieldline_saba_navigation_probe__" &&
      JSON.parse(payload.body).status === "NO_ACTION_COLLECTOR_TARGET_BOUND")).toBe(true),
    { timeout: 5_000 });
    await observer.ingestDomSnapshot(saba, "sports.example", records);
    expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(2);
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "probe-ws", response: { opcode: 1,
        payloadData: nativeBaseline.replace('"probe"', '"normal"') }
    });
    expect(forwarded.some(({ transport }) => transport === "WS_FRAME")).toBe(true);
    expect(observer.hasCompleteSabaBaseline(saba.sourceId)).toBe(true);
  });

  it("keeps an initial Early discovery read-only without starting unsafe recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, matchId: `m-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const earlyState = { documentToken: "doc-fail", rowCount: 60, tableCount: 1,
      activePeriod: "EARLY", eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: Array.from({ length: 60 }, (_, index) => `m-${index}`), rosterSamples: [],
      timeShapes: { DATED_KICKOFF: 60, PREFIXED_KICKOFF: 0, UNDATED_KICKOFF: 0,
        BARE_LIVE: 0, LIVE_CLOCK: 0, UNKNOWN: 0 }, dateContexts: [], headerControls: [],
      fingerprint: "TODAY-60", truncated: false };
    let viewUnverifiable = false;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return viewUnverifiable ? {} : { result: { value: earlyState } };
      }
      if (method === "Runtime.evaluate" && expression.includes(".c-side-nav__tab") &&
        expression.includes(".click()")) {
        if (expression.includes('===\"SOM\"')) viewUnverifiable = true;
        return { result: { value: true } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    let observer!: NetworkObserver;
    const recover = vi.fn(() => { observer.beginSourceEpoch("chrome:SABA:10"); });
    observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      onSabaSocketUnavailable: recover });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");

    await vi.advanceTimersByTimeAsync(46_000);
    expect(recover).not.toHaveBeenCalled();
    expect(viewUnverifiable).toBe(false);
    expect(forwarded.some(({ request, payload }) => request.pathnameClass ===
      "/__fieldline_saba_navigation_probe__" &&
      JSON.parse(payload.body).status === "NO_ACTION_UNCONFIRMED_SELECTION")).toBe(true);
    const before = forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
    await observer.ingestDomSnapshot(saba, "sports.example", records);
    expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(before + 1);
    } finally { vi.useRealTimers(); }
  });

  it("spends one total deadline on target discovery and emits a safe no-action terminal", async () => {
    const now = { value: 1_000 };
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, matchId: `m-${index}`,
      timeText: "11:00PM", teamNames: ["H", "A"], groups: []
    })));
    const candidate = { documentToken: "slow", rowCount: 60, tableCount: 1,
      activePeriod: "TODAY", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], fingerprint: "today", truncated: false };
    let resolveDiscovery!: (value: unknown) => void;
    let discoveryStarted = false;
    const actions: string[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        discoveryStarted = true;
        return new Promise((resolve) => { resolveDiscovery = resolve; });
      }
      if (method === "Runtime.evaluate" && expression.includes('.click()')) {
        actions.push(expression); return { result: { value: true } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now.value, monotonicNow: () => now.value });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    const poll = observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(discoveryStarted).toBe(true));
    now.value = 61_001;
    resolveDiscovery({ result: { value: candidate } });
    await poll;
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true), { timeout: 5_000 });

    expect(actions).toEqual([]);
    expect(JSON.parse(forwarded.find(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")?.payload.body ?? "{}"))
      .toMatchObject({ status: "NO_ACTION_DEADLINE_EXHAUSTED", mutated: false, viewRestored: true });
  });

  it("returns read-only Early no-action within the remaining total deadline", async () => {
    const wallStarted = Date.now();
    let offsetMs = 0;
    const now = () => 1_000 + offsetMs + (Date.now() - wallStarted);
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ sportId: "1",
      leagueId: `l-${index}`, matchId: `m-${index}`, timeText: "11:00PM",
      teamNames: ["H", "A"], groups: [] })));
    const state = { documentToken: "remaining", pageNowMs: Date.now(), rowCount: 60, tableCount: 1,
      activePeriod: "EARLY", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "early", truncated: false };
    let readCalls = 0;
    const actions: string[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) return { result: { value: true } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) return { result: { value: records } };
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        readCalls += 1;
        if (readCalls === 1) offsetMs = 59_980;
        return { result: { value: state } };
      }
      if (method === "Runtime.evaluate" && expression.includes('.click()')) {
        actions.push(expression);
        return new Promise<never>(() => undefined);
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 2_500, now,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    const realStarted = Date.now();

    await observer.pollSabaDomChanges(saba, "sports.example");
    await settleObserverBackgroundTasks();

    expect(Date.now() - realStarted).toBeLessThan(500);
    expect(actions).toEqual([]);
    expect(forwarded.filter(({ request }) => request.pathnameClass ===
      "/__fieldline_saba_navigation_probe__").map(({ payload }) => JSON.parse(payload.body).status))
      .toEqual(["NO_ACTION_UNCONFIRMED_SELECTION"]);
  });

  it("allows a slow SABA probe read to finish beyond the ordinary frame timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
        sportId: "1", leagueId: `l-${index}`, matchId: `m-${index}`,
        timeText: "11:00PM", teamNames: ["H", "A"], groups: []
      })));
      const unknown = { documentToken: "slow-read", rowCount: 60, tableCount: 1,
        activePeriod: "UNKNOWN", eligibleMoreCount: 0, eligibleMoreOwners: [],
        moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
        dateContexts: [], headerControls: [], periodControls: [], fingerprint: "unknown", truncated: false };
      let reads = 0;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) return { result: { value: true } };
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
        if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) return { result: { value: records } };
        if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          reads += 1;
          if (reads === 1) return await new Promise<{ result: { value: typeof unknown } }>((resolve) => {
            setTimeout(() => resolve({ result: { value: unknown } }), 4_000);
          });
          return { result: { value: unknown } };
        }
        return {};
      });
      const forwarded: ChromeBridgeEnvelope[] = [];
      const recover = vi.fn();
      const observer = new NetworkObserver({ sendCommand, now: () => Date.now(),
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        onSabaSocketUnavailable: recover });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

      await observer.pollSabaDomChanges(saba, "sports.example");
      await vi.advanceTimersByTimeAsync(4_100);

      const diagnostic = forwarded.find(({ request }) =>
        request.pathnameClass === "/__fieldline_saba_navigation_probe__");
      expect(JSON.parse(diagnostic?.payload.body ?? "{}"))
        .toMatchObject({ status: "NO_ACTION_UNCONFIRMED_SELECTION", mutated: false, viewRestored: true });
      expect(recover).not.toHaveBeenCalled();
      expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("keeps a valid DOM lease when UNKNOWN selected-state evidence causes a no-action probe", async () => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, matchId: `m-${index}`,
      timeText: "11:00PM", teamNames: ["H", "A"], groups: []
    })));
    const unknown = { documentToken: "unknown", rowCount: 60, tableCount: 1,
      activePeriod: "UNKNOWN", periodControls: [{ tag: "div", classes: ["c-side-nav__tab"],
        text: "Hôm Nay", parentTag: "div", parentClasses: ["period-wrap"], ariaSelected: "" }],
      eligibleMoreCount: 0, eligibleMoreOwners: [], moreCandidates: [], rosterMatchIds: ["m-1"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [],
      fingerprint: "unknown", truncated: false };
    const actions: string[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: unknown } };
      }
      if (method === "Runtime.evaluate" && expression.includes('.click()')) actions.push(expression);
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const recover = vi.fn();
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      onSabaSocketUnavailable: recover });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true), { timeout: 5_000 });

    expect(actions).toEqual([]);
    expect(recover).not.toHaveBeenCalled();
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    expect(JSON.parse(forwarded.find(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")?.payload.body ?? "{}"))
      .toMatchObject({ status: "NO_ACTION_UNCONFIRMED_SELECTION", mutated: false,
        periodControls: [expect.objectContaining({ parentClasses: ["period-wrap"] })] });
  });

  it("does not recover when the pre-action initial probe read is unavailable on a current source", async () => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: "l-" + index, matchId: "m-" + index,
      timeText: "11:00PM", teamNames: ["H", "A"], groups: []
    })));
    const candidate = { documentToken: "initial-null", rowCount: 60, tableCount: 1,
      activePeriod: "TODAY", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "today", truncated: false };
    let probeReads = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        return probeReads === 1 ? { result: { value: candidate } } : {};
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const recover = vi.fn();
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      onSabaSocketUnavailable: recover });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));

    expect(recover).not.toHaveBeenCalled();
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    expect(JSON.parse(forwarded.find(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")?.payload.body ?? "{}"))
      .toMatchObject({ status: "NO_ACTION_INITIAL_STATE_UNAVAILABLE", mutated: false,
        viewRestored: true, failureTrace: [expect.objectContaining({
          stage: "INITIAL_READ", outcome: "LAST_READ_ABSENT", evaluationFailure: "PAGE_NULL"
        })] });
  });

  it.each(["FRAME_COMMAND_TIMEOUT", "CONTEXT_UNAVAILABLE", "CDP_REJECTED", "EXCEPTION_DETAILS"] as const)(
    "sanitizes the %s category for an unavailable initial probe evaluation", async (category) => {
      const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
        sportId: "1", leagueId: "l-" + index, matchId: "m-" + index,
        timeText: "11:00PM", teamNames: ["H", "A"], groups: []
      })));
      const candidate = { documentToken: "eval-category", rowCount: 60, tableCount: 1,
        activePeriod: "TODAY", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
        moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
        dateContexts: [], headerControls: [], fingerprint: "today", truncated: false };
      let probeReads = 0;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
          return { result: { value: true } };
        }
        if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
          return { result: { value: records } };
        }
        if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          probeReads += 1;
          if (probeReads === 1) return { result: { value: candidate } };
          if (category === "FRAME_COMMAND_TIMEOUT") return new Promise<never>(() => undefined);
          if (category === "CONTEXT_UNAVAILABLE") throw new Error("Cannot find context with specified id");
          if (category === "CDP_REJECTED") throw new Error("secret https://account.invalid/token");
          return { exceptionDetails: { text: "secret https://account.invalid/token" } };
        }
        return {};
      });
      const forwarded: ChromeBridgeEnvelope[] = [];
      const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 10,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

      await observer.pollSabaDomChanges(saba, "sports.example");
      await vi.waitFor(() => expect(forwarded.some(({ request }) =>
        request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));
      const body = JSON.parse(forwarded.find(({ request }) =>
        request.pathnameClass === "/__fieldline_saba_navigation_probe__")?.payload.body ?? "{}");

      expect(body.failureTrace).toEqual([expect.objectContaining({
        stage: "INITIAL_READ", outcome: "LAST_READ_ABSENT", evaluationFailure: category,
        evaluationTarget: expect.objectContaining({ kind: "ROOT", contextIdPresent: false })
      })]);
      expect(JSON.stringify(body)).not.toMatch(/secret|account\.invalid|Runtime\.evaluate|c-side-nav/iu);
    });

  it.each(["REJECTED", "NO_EPOCH"] as const)(
    "keeps a read-only Early probe out of the unsafe %s recovery handoff", async (outcome) => {
    vi.useFakeTimers();
    try {
      const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
        sportId: "1", leagueId: `l-${index}`, matchId: `m-${index}`,
        timeText: "11:00PM", teamNames: ["H", "A"], groups: []
      })));
      const state = { documentToken: "recovery", rowCount: 60, tableCount: 1,
        activePeriod: "EARLY", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
        rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
        headerControls: [], fingerprint: "early", truncated: false };
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
          return { result: { value: true } };
        }
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
        if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
          return { result: { value: records } };
        }
        if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          return { result: { value: state } };
        }
        if (method === "Runtime.evaluate" && expression.includes('.c-side-nav__tab') &&
          expression.includes('.click()')) return {};
        return {};
      });
      const forwarded: ChromeBridgeEnvelope[] = [];
      const recover = vi.fn(() => outcome === "REJECTED"
        ? Promise.reject(new Error("reload rejected")) : Promise.resolve());
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        onSabaSocketUnavailable: recover });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

      await observer.pollSabaDomChanges(saba, "sports.example");
      await vi.advanceTimersByTimeAsync(0);
      const statuses = () => forwarded.filter(({ request }) =>
        request.pathnameClass === "/__fieldline_saba_navigation_probe__")
        .map(({ payload }) => JSON.parse(payload.body).status);
      expect(statuses()).toEqual(["NO_ACTION_UNCONFIRMED_SELECTION"]);
      expect(recover).not.toHaveBeenCalled();
      await observer.ingestDomSnapshot(saba, "sports.example", records);
      expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(2);

      const beforeEpoch = forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT").length;
      observer.beginSourceEpoch(saba.sourceId);
      await observer.ingestDomSnapshot(saba, "sports.example", records);
      expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(beforeEpoch + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pre-probe multi-chunk DOM ingest after the probe version changes", async () => {
    const baseline = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, matchId: `baseline-${index}`,
      timeText: "11:00PM", teamNames: ["H", "A"], groups: []
    })));
    const oldLarge = JSON.stringify(Array.from({ length: 500 }, (_, index) => ({
      sportId: "1", leagueId: "old-large", matchId: `old-large-${index}`,
      timeText: "11:00PM", teamNames: ["X".repeat(400), "Y".repeat(400)], groups: []
    })));
    let probeReads = 0;
    let releaseProbeRead!: () => void;
    const probeReadBlocked = new Promise<void>((resolve) => { releaseProbeRead = resolve; });
    let period: "TODAY" | "EARLY" = "EARLY";
    let periodActions = 0;
    const state = () => ({ documentToken: "version", rowCount: 60, tableCount: 1,
      activePeriod: period, periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: Array.from({ length: 60 }, (_, index) => `baseline-${index}`),
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [],
      fingerprint: `${period}:baseline`, truncated: false });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: baseline } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        if (probeReads === 1) await probeReadBlocked;
        return { result: { value: state() } };
      }
      if (method === "Runtime.evaluate" && expression.includes('.c-side-nav__tab') &&
        expression.includes('.click()')) {
        period = expression.includes('===\"SOM\"') ? "EARLY" : "TODAY";
        periodActions += 1;
        return { result: { value: true } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    let holdOld = false;
    let releaseOld!: () => void;
    const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => {
      if (holdOld && envelope.transport === "DOM_SNAPSHOT") {
        const chunk = JSON.parse(envelope.payload.body) as { snapshotId?: string; chunkIndex?: number };
        if (chunk.snapshotId?.startsWith("dom:") && chunk.chunkIndex === 0) {
          holdOld = false;
          await new Promise<void>((resolve) => { releaseOld = resolve; });
        }
      }
      forwarded.push(envelope);
    });
    const observer = new NetworkObserver({ sendCommand, forward });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(probeReads).toBe(1));

    holdOld = true;
    const oldIngest = observer.ingestDomSnapshot(saba, "sports.example", oldLarge);
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf("function"));
    releaseProbeRead();
    await vi.waitFor(() => expect(probeReads).toBe(2), { timeout: 5_000 });
    expect(periodActions).toBe(0);
    releaseOld();
    await oldIngest;

    const oldChunks = forwarded.filter(({ transport, payload }) => transport === "DOM_SNAPSHOT" &&
      String((JSON.parse(payload.body) as { snapshotId?: string }).snapshotId).startsWith("dom:"));
    expect(oldChunks).toHaveLength(1);
    forwarded.length = 0;
    await observer.replaySnapshots(saba.sourceId);
    expect(JSON.stringify(forwarded)).not.toContain("old-large");
  });

  it("cancels the first old DOM chunk while it is queued behind an earlier emission tail", async () => {
    const baseline = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, matchId: `base-${index}`,
      timeText: "11:00PM", teamNames: ["H", "A"], groups: []
    })));
    const oldLarge = JSON.stringify(Array.from({ length: 500 }, (_, index) => ({
      sportId: "1", leagueId: "queued-old", matchId: `queued-old-${index}`,
      timeText: "11:00PM", teamNames: ["X".repeat(400), "Y".repeat(400)], groups: []
    })));
    let probeReads = 0;
    let releaseProbeRead!: () => void;
    const probeReadBlocked = new Promise<void>((resolve) => { releaseProbeRead = resolve; });
    let period: "TODAY" | "EARLY" = "EARLY";
    let actions = 0;
    const state = () => ({ documentToken: "queued", rowCount: 60, tableCount: 1,
      activePeriod: period, periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["base-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: `${period}:base`, truncated: false });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: baseline } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        probeReads += 1;
        if (probeReads === 1) await probeReadBlocked;
        return { result: { value: state() } };
      }
      if (method === "Runtime.evaluate" && expression.includes('.c-side-nav__tab') &&
        expression.includes('.click()')) {
        period = expression.includes('===\"SOM\"') ? "EARLY" : "TODAY";
        actions += 1;
        return { result: { value: true } };
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    let blockPrior = false;
    let priorEntered = false;
    let releasePrior!: () => void;
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async (envelope) => {
      if (blockPrior) {
        blockPrior = false;
        priorEntered = true;
        await new Promise<void>((resolve) => { releasePrior = resolve; });
      }
      forwarded.push(envelope);
    }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
    await observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(probeReads).toBe(1));
    forwarded.length = 0;

    blockPrior = true;
    const prior = observer.heartbeat(saba, "sports.example");
    await vi.waitFor(() => expect(priorEntered).toBe(true));
    const oldIngest = observer.ingestDomSnapshot(saba, "sports.example", oldLarge);
    releaseProbeRead();
    await vi.waitFor(() => expect(probeReads).toBe(2), { timeout: 5_000 });
    expect(actions).toBe(0);
    releasePrior();
    await Promise.all([prior, oldIngest]);

    expect(forwarded.some(({ transport, payload }) => transport === "DOM_SNAPSHOT" &&
      String((JSON.parse(payload.body) as { snapshotId?: string }).snapshotId).startsWith("dom:"))).toBe(false);
    forwarded.length = 0;
    await observer.replaySnapshots(saba.sourceId);
    expect(JSON.stringify(forwarded)).not.toContain("queued-old");
  });

  it.each(["REJECT", "HANG"] as const)(
    "releases a safe UNKNOWN probe when its diagnostic forward will %s", async (mode) => {
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ sportId: "1",
      leagueId: `l-${index}`, matchId: `m-${index}`, timeText: "11:00PM",
      teamNames: ["H", "A"], groups: [] })));
    const unknown = { documentToken: "unknown-diag", rowCount: 60, tableCount: 1,
      activePeriod: "UNKNOWN", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "unknown", truncated: false };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) return { result: { value: true } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) return { result: { value: records } };
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return { result: { value: unknown } };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    let diagnosticAttempts = 0;
    let releaseDiagnostic: (() => void) | undefined;
    const heldDiagnostic = new Promise<void>((resolve) => { releaseDiagnostic = resolve; });
    const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 25,
      forward: vi.fn(async (envelope) => {
        if (envelope.request.pathnameClass === "/__fieldline_saba_navigation_probe__") {
          diagnosticAttempts += 1;
          if (mode === "REJECT") throw new Error("diagnostic rejected");
          return heldDiagnostic;
        }
        forwarded.push(envelope);
      }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await expect(observer.pollSabaDomChanges(saba, "sports.example")).resolves.toBeUndefined();
    await vi.waitFor(() => expect(diagnosticAttempts).toBe(1), { timeout: 5_000 });
    expect(observer.hasUsableSabaCatalog(saba.sourceId)).toBe(true);
    if (mode === "REJECT") {
      await settleObserverBackgroundTasks();
      await observer.ingestDomSnapshot(saba, "sports.example", records);
      expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(2);
    } else {
      expect(forwarded.filter(({ transport }) => transport === "DOM_SNAPSHOT")).toHaveLength(1);
      releaseDiagnostic!();
    }
  });

  it("keeps queued DOM behind a hung probe diagnostic and forwards contiguous sequences after release", async () => {
    vi.useFakeTimers();
    try {
      const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ sportId: "1",
        leagueId: `l-${index}`, matchId: `m-${index}`, timeText: "11:00PM",
        teamNames: ["H", "A"], groups: [] })));
      const unknown = { documentToken: "unknown-serial", rowCount: 60, tableCount: 1,
        activePeriod: "UNKNOWN", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
        moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
        dateContexts: [], headerControls: [], fingerprint: "unknown", truncated: false };
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
          return { result: { value: true } };
        }
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
        if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
          return { result: { value: records } };
        }
        if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          return { result: { value: unknown } };
        }
        return {};
      });
      let releaseDiagnostic!: () => void;
      let diagnosticEntered!: () => void;
      const diagnosticHeld = new Promise<void>((resolve) => { releaseDiagnostic = resolve; });
      const sawDiagnostic = new Promise<void>((resolve) => { diagnosticEntered = resolve; });
      const entered: Array<{ sequence: number; transport: ChromeBridgeEnvelope["transport"];
        pathnameClass: string }> = [];
      let active = 0;
      let maximumActive = 0;
      const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 25,
        forward: vi.fn(async (envelope) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          entered.push({ sequence: envelope.sequence, transport: envelope.transport,
            pathnameClass: envelope.request.pathnameClass });
          try {
            if (envelope.request.pathnameClass === "/__fieldline_saba_navigation_probe__") {
              diagnosticEntered();
              await diagnosticHeld;
            }
          } finally { active -= 1; }
        }) });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

      await observer.pollSabaDomChanges(saba, "sports.example");
      await sawDiagnostic;
      let queuedComplete = false;
      const queuedDom = observer.ingestDomSnapshot(saba, "sports.example", records)
        .then(() => { queuedComplete = true; });
      await vi.advanceTimersByTimeAsync(25);

      expect(queuedComplete).toBe(false);
      expect(maximumActive).toBe(1);
      expect(entered).toEqual([
        { sequence: 0, transport: "DOM_SNAPSHOT", pathnameClass: "/__fieldline_dom_snapshot__" },
        { sequence: 1, transport: "TAB_STATE", pathnameClass: "/__fieldline_saba_navigation_probe__" }
      ]);

      releaseDiagnostic();
      await queuedDom;
      expect(maximumActive).toBe(1);
      expect(entered).toEqual([
        { sequence: 0, transport: "DOM_SNAPSHOT", pathnameClass: "/__fieldline_dom_snapshot__" },
        { sequence: 1, transport: "TAB_STATE", pathnameClass: "/__fieldline_saba_navigation_probe__" },
        { sequence: 2, transport: "DOM_SNAPSHOT", pathnameClass: "/__fieldline_dom_snapshot__" },
        { sequence: 3, transport: "TAB_STATE",
          pathnameClass: "/__fieldline_saba_catalog_discovery_failure__" }
      ]);
    } finally { vi.useRealTimers(); }
  });

  it("does not arm unsafe recovery while a read-only diagnostic remains pending", async () => {
    vi.useFakeTimers();
    try {
      const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ sportId: "1",
        leagueId: `l-${index}`, matchId: `m-${index}`, timeText: "11:00PM",
        teamNames: ["H", "A"], groups: [] })));
      const state = { documentToken: "pending", rowCount: 60, tableCount: 1,
        activePeriod: "EARLY", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
        moreCandidates: [], rosterMatchIds: ["m-1"], rosterSamples: [], timeShapes: {},
        dateContexts: [], headerControls: [], fingerprint: "early", truncated: false };
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) return { result: { value: true } };
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
        if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) return { result: { value: records } };
        if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return { result: { value: state } };
        if (method === "Runtime.evaluate" && expression.includes('.click()')) return {};
        return {};
      });
      const recover = vi.fn(() => new Promise<never>(() => undefined));
      const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 25,
        forward: vi.fn(async (envelope) => envelope.request.pathnameClass ===
          "/__fieldline_saba_navigation_probe__" ? new Promise<never>(() => undefined) : undefined),
        onSabaSocketUnavailable: recover });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

      const poll = observer.pollSabaDomChanges(saba, "sports.example");
      await vi.advanceTimersByTimeAsync(25);
      await poll;
      expect(recover).not.toHaveBeenCalled();
      observer.beginSourceEpoch(saba.sourceId);
      await vi.advanceTimersByTimeAsync(25);
      expect(recover).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("bootstraps missing SABA authority from DOM and still captures later price mutations", async () => {
    const records = (priceText: string) => JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["3"], labels: ["2.5"],
        odds: [{ marketOddsId: `market-${index}`, priceText, status: null, greyedOut: null },
          { marketOddsId: `market-${index}`, priceText: "0.99", status: null, greyedOut: null }] }]
    })));
    let dirty = false;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        return { result: { value: dirty } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: records(dirty ? "0.85" : "0.91") } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "SABA", transport: "DOM_SNAPSHOT" }));
    const watcherExpression = String(sendCommand.mock.calls.find(([, method, params]) => method ===
      "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation"))?.[2]?.expression);
    expect(watcherExpression).toContain("characterData: true");
    expect(watcherExpression).toContain("'class'");
    expect(watcherExpression).toContain("'aria-disabled'");

    // A small but current football table now admits read-only target discovery.
    // Let that bounded background attempt finish before testing the next poll.
    await settleObserverBackgroundTasks();
    dirty = true;
    forward.mockClear();
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "SABA", transport: "DOM_SNAPSHOT" }));
  });

  it("ignores SABA hover animation classes but observes semantic disabled transitions", async () => {
    let watcher = "";
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        watcher = String(params?.expression ?? "");
      }
      return { result: { value: false } };
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    await observer.pollSabaDomChanges({ lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 }, "sports.example");
    let mutationCallback!: (mutations: unknown[]) => void;
    const MutationObserver = class {
      constructor(callback: (mutations: unknown[]) => void) { mutationCallback = callback; }
      observe(): void {}
    };
    const element = { nodeType: 1, className: "odds hover", ariaDisabled: "false",
      closest: () => element, querySelector: () => null,
      getAttribute(name: string) { return name === "class" ? this.className
        : name === "aria-disabled" ? this.ariaDisabled : null; } };
    const document = { documentElement: element };
    const Node = { ELEMENT_NODE: 1 };
    const execute = new Function("document", "MutationObserver", "Node", `return ${watcher}`) as
      (...args: unknown[]) => boolean;
    delete (globalThis as Record<string, unknown>).__fieldlineSabaOddsMutationV1;
    expect(execute(document, MutationObserver, Node)).toBe(true);
    expect(execute(document, MutationObserver, Node)).toBe(false);
    mutationCallback([{ type: "attributes", attributeName: "class", oldValue: "odds",
      target: element, addedNodes: [], removedNodes: [] }]);
    expect(execute(document, MutationObserver, Node)).toBe(false);
    element.className = "odds no-hover";
    mutationCallback([{ type: "attributes", attributeName: "class", oldValue: "odds hover",
      target: element, addedNodes: [], removedNodes: [] }]);
    expect(execute(document, MutationObserver, Node)).toBe(true);
    delete (globalThis as Record<string, unknown>).__fieldlineSabaOddsMutationV1;
  });

  it("propagates an explicit CMD DOM sweep boundary without retaining its diagnostic record", async () => {
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "m",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const body = JSON.stringify([publicRecord, { __fieldlineSweep: {
      sweepId: "cmd:9:sweep-1", complete: true
    } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top", loaderId: "loader-top" } } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 1 }
      : method === "Runtime.evaluate" ? { result: { value: body } } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000, monotonicNow: () => 50 });
    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");
    const chunk = JSON.parse(String((forward.mock.calls[0]?.[0] as ChromeBridgeEnvelope).payload.body));
    expect(chunk).toMatchObject({ sweepId: "cmd:9:sweep-1", sweepComplete: true,
      sweepFrameKey: "top", sweepDocumentKey: expect.any(String) });
    expect(JSON.stringify(chunk.records)).not.toContain("__fieldlineSweep");
  });

  it("emits CMD records without completion metadata when the frame loader is missing", async () => {
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "odds-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "odds-frame" } } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 1 }
      : method === "Runtime.evaluate" ? { result: { value: JSON.stringify([publicRecord,
        { __fieldlineSweep: { sweepId: "cmd:odds:unbound", complete: true } }]) } } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");

    expect(forward).toHaveBeenCalledOnce();
    const chunk = JSON.parse(String(forward.mock.calls[0]![0].payload.body));
    expect(JSON.stringify(chunk.records)).toContain("odds-event");
    expect(chunk).not.toHaveProperty("sweepId");
    expect(chunk).not.toHaveProperty("sweepComplete");
    expect(chunk).not.toHaveProperty("sweepDocumentKey");
  });

  it("drops a CMD frame result when its loader changes during evaluation", async () => {
    let loaderId = "loader-old";
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "old-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "odds-frame", loaderId } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") {
        loaderId = "loader-new";
        return { result: { value: JSON.stringify([publicRecord,
          { __fieldlineSweep: { sweepId: "cmd:odds:old", complete: true } }]) } };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");

    expect(forward).not.toHaveBeenCalled();
  });

  it("stops a bound multi-chunk CMD snapshot when its loader changes between emits", async () => {
    let loaderId = "loader-old";
    const publicRecords = Array.from({ length: 300 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, leagueName: `League ${index}`, matchId: `m-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [], padding: "x".repeat(500)
    }));
    const body = JSON.stringify([...publicRecords,
      { __fieldlineSweep: { sweepId: "cmd:odds:multi", complete: true } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "odds-frame", loaderId } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: body } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => { loaderId = "loader-new"; });
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");

    expect(JSON.parse(String(forward.mock.calls[0]![0].payload.body)).chunkCount).toBeGreaterThan(1);
    expect(forward).toHaveBeenCalledOnce();
  });

  it("keeps a no-frame-tree CMD result partial and unbound", async () => {
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "fallback-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? {}
      : method === "Runtime.evaluate" ? { result: { value: JSON.stringify([publicRecord,
        { __fieldlineSweep: { sweepId: "cmd:fallback:complete", complete: true } }]) } } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");

    expect(forward).toHaveBeenCalledOnce();
    const chunk = JSON.parse(String(forward.mock.calls[0]![0].payload.body));
    expect(JSON.stringify(chunk.records)).toContain("fallback-event");
    expect(chunk).not.toHaveProperty("sweepId");
    expect(chunk).not.toHaveProperty("sweepComplete");
    expect(chunk).not.toHaveProperty("sweepDocumentKey");
  });

  it("does not let a top-frame sweep completion tombstone odds-frame records", async () => {
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "odds-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "loader-top" },
        childFrames: [{ frame: { id: "odds-frame", loaderId: "loader-odds" } }] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: params?.frameId === "top" ? 1 : 2 };
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify(Number(params?.contextId) === 1
        ? [{ __fieldlineDiagnostic: { frame: "top" } },
          { __fieldlineSweep: { sweepId: "cmd:top:sweep-1", complete: true } }]
        : [publicRecord, { __fieldlineSweep: { sweepId: "cmd:odds:sweep-1", complete: false } }]) } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000, monotonicNow: () => 50 });
    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");
    const oddsChunk = forward.mock.calls.map(([message]) =>
      JSON.parse(String(message.payload.body)) as Record<string, unknown>)
      .find((chunk) => JSON.stringify(chunk.records).includes("odds-event"));
    expect(oddsChunk).toMatchObject({ sweepId: "cmd:odds:sweep-1", sweepComplete: false,
      sweepFrameKey: "odds-frame", sweepDocumentKey: expect.any(String) });
  });

  it("accepts completion only from the same odds-frame document as its records", async () => {
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "odds-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "loader-top" },
        childFrames: [{ frame: { id: "odds-frame", loaderId: "loader-odds" } }] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: params?.frameId === "top" ? 1 : 2 };
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify(Number(params?.contextId) === 1
        ? [{ __fieldlineDiagnostic: { frame: "top" } },
          { __fieldlineSweep: { sweepId: "cmd:top:sweep-1", complete: false } }]
        : [publicRecord, { __fieldlineSweep: { sweepId: "cmd:odds:sweep-1", complete: true } }]) } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000, monotonicNow: () => 50 });
    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");
    const oddsChunk = forward.mock.calls.map(([message]) =>
      JSON.parse(String(message.payload.body)) as Record<string, unknown>)
      .find((chunk) => JSON.stringify(chunk.records).includes("odds-event"));
    expect(oddsChunk).toMatchObject({ sweepId: "cmd:odds:sweep-1", sweepComplete: true,
      sweepFrameKey: "odds-frame", sweepDocumentKey: expect.any(String) });
  });

  it("emits false-to-true sweep completion with unchanged records and deduplicates its repeat", async () => {
    let complete = false;
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "odds-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "odds-frame", loaderId: "loader-one" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify([publicRecord,
        { __fieldlineSweep: { sweepId: "cmd:odds:sweep-1", complete } }]) } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000,
      monotonicNow: () => 50, observerSessionId: "worker-a" });
    const source = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");
    complete = true;
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");
    expect(forward).toHaveBeenCalledTimes(2);
    const chunks = forward.mock.calls.map(([message]) => JSON.parse(String(message.payload.body)));
    expect(chunks.map((chunk) => chunk.sweepComplete)).toEqual([false, true]);
    expect(chunks[0].sweepDocumentKey).toBe(chunks[1].sweepDocumentKey);
  });

  it("emits an explicit zero-record completed sweep", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "odds-frame", loaderId: "loader-one" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify([
        { __fieldlineSweep: { sweepId: "cmd:odds:empty", complete: true } }
      ]) } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");
    expect(forward).toHaveBeenCalledOnce();
    const chunk = JSON.parse(String(forward.mock.calls[0]![0].payload.body));
    expect(chunk).toMatchObject({ records: [], sweepId: "cmd:odds:empty", sweepComplete: true,
      sweepFrameKey: "odds-frame", sweepDocumentKey: expect.any(String) });
  });

  it("changes sweep document identity when the same frame gets a new loader", async () => {
    let loaderId = "loader-old";
    const publicRecord = { sportId: "1", leagueId: "l", leagueName: "League", matchId: "odds-event",
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "odds-frame", loaderId } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify([publicRecord,
        { __fieldlineSweep: { sweepId: "cmd:odds:sweep-1", complete: true } }]) } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 5_000,
      observerSessionId: "worker-a" });
    const source = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");
    loaderId = "loader-new";
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");
    expect(forward).toHaveBeenCalledTimes(2);
    const documentKeys = forward.mock.calls.map(([message]) =>
      JSON.parse(String(message.payload.body)).sweepDocumentKey as string);
    expect(documentKeys[0]).not.toBe(documentKeys[1]);
  });

  it("does not emit an old-document sweep marker after the source epoch changes", async () => {
    let releaseOld!: () => void;
    const oldBlocked = new Promise<void>((resolve) => { releaseOld = resolve; });
    let evaluations = 0;
    const recordFor = (matchId: string) => ({ sportId: "1", leagueId: "l", leagueName: "League", matchId,
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "top", loaderId: "loader-top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") {
        const old = evaluations === 0;
        evaluations += 1;
        if (old) await oldBlocked;
        return { result: { value: JSON.stringify([recordFor(old ? "old-event" : "new-event"),
          { __fieldlineSweep: { sweepId: old ? "cmd:old:sweep" : "cmd:new:sweep", complete: old } }]) } };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const oldCapture = observer.captureCmdSnapshot(cmd, "cgnew.fts368.com");
    await vi.waitFor(() => expect(evaluations).toBe(1));
    observer.beginSourceEpoch(cmd.sourceId);
    const replacement = observer.captureCmdSnapshot(cmd, "cgnew.fts368.com");
    releaseOld();
    await Promise.all([oldCapture, replacement]);
    expect(evaluations).toBe(2);
    expect(forward).toHaveBeenCalledOnce();
    const chunk = JSON.parse(String(forward.mock.calls[0]![0].payload.body));
    expect(chunk).toMatchObject({ sweepId: "cmd:new:sweep", sweepComplete: false, sweepFrameKey: "top",
      sweepDocumentKey: expect.any(String) });
    expect(JSON.stringify(chunk.records)).toContain("new-event");
    expect(JSON.stringify(chunk)).not.toContain("old-event");
  });

  it("reads independent CMD frames concurrently so one slow frame cannot expire the catalog", async () => {
    let evaluationsInFlight = 0;
    let maximumInFlight = 0;
    const records = JSON.stringify([{ sportId: "1", leagueId: "l", leagueName: "League",
      matchId: "m", timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "child-a" } }, { frame: { id: "child-b" } }] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId:
        params?.frameId === "top" ? 1 : params?.frameId === "child-a" ? 2 : 3 };
      if (method === "Runtime.evaluate") {
        evaluationsInFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, evaluationsInFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        evaluationsInFlight -= 1;
        return { result: { type: "string", value: records } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com");

    expect(maximumInFlight).toBe(3);
  });

  it("does not let a blocked CMD lane delay BTI", async () => {
    let releaseFirstScan: (() => void) | undefined;
    const firstScanBlocked = new Promise<void>((resolve) => { releaseFirstScan = resolve; });
    const startedTabs: number[] = [];
    const sendCommand = vi.fn(async (tabId: number, method: string) => {
      if (method === "Page.getFrameTree") {
        startedTabs.push(tabId);
        if (tabId === 9) await firstScanBlocked;
        return { frameTree: { frame: { id: `top-${tabId}` } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: tabId };
      if (method === "Runtime.evaluate") return { result: { type: "string", value: "[]" } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    const cmdMaintenance = observer.maintain(
      { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }
    );
    await vi.waitFor(() => expect(startedTabs).toEqual([9]));
    const btiRefresh = observer.refreshCatalog(
      { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 }
    );
    await vi.waitFor(() => expect(startedTabs).toEqual([9, 6]));

    releaseFirstScan?.();
    await Promise.all([cmdMaintenance, btiRefresh]);
  });

  it("aborts a hung IM partition at the bounded deadline before a later generation starts", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, (event: { detail: string }) => void>();
      let aborted = false;
      const windowStub: Record<string, unknown> & { global: { PlatForm: string;
        SiteProfile: { StatusCode: number; im: boolean; t: string } } } = {
        global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "public-test-value" } },
        addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
        removeEventListener: (name: string) => listeners.delete(name),
        dispatchEvent: (event: { type: string; detail: { c: string } }) => {
          if (event.type === "helo") listeners.get(`halo_${event.detail.c}`)?.({ detail: "signed" });
        }
      };
      const execute = new Function("document", "location", "window", "sessionStorage", "CustomEvent", "fetch",
        `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => Promise<unknown>;
      const pending = execute({ documentElement: { dataset: {} }, querySelectorAll: () => [] },
        { hostname: "imsports.directsb.net", search: "" }, windowStub, { getItem: () => "public-test-value" },
        class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
          get detail(): { c: string } { return this.init.detail; } },
        async (_path: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); });
        }));
      await vi.advanceTimersByTimeAsync(8_001);
      await expect(pending).resolves.toMatchObject({ status: "request-failed", responses: [] });
      expect(aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("begins a new public epoch and discards pending old-epoch bodies", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: '{"StatusCode":100,"sel":[]}', base64Encoded: false } : {});
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.heartbeat(im, "imsports.directsb.net");
    await observer.handleEvent(im, "Network.responseReceived", {
      requestId: "old-body", type: "XHR", response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" }
    });
    expect(observer.beginSourceEpoch(im.sourceId)).toBe("worker-a:1");
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "old-body" });
    await observer.heartbeat(im, "imsports.directsb.net");

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.getResponseBody")).toBe(false);
    expect(forward.mock.calls.map(([message]) => [message.sourceEpoch, message.sequence])).toEqual([
      ["worker-a:0", 0], ["worker-a:1", 0]
    ]);
  });

  it("assigns public epoch ordinals across source handovers without changing provider-local cancellation", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      observerSessionId: "worker-a" });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;

    await observer.heartbeat(im, "imsports.directsb.net");
    await observer.heartbeat(cmd, "cgnew.fts368.com");
    expect(observer.beginSourceEpoch(im.sourceId)).toBe("worker-a:2");
    await observer.heartbeat(im, "imsports.directsb.net");
    await observer.heartbeat(cmd, "cgnew.fts368.com");

    expect(forward.mock.calls.map(([message]) => [message.sourceId, message.sourceEpoch, message.sequence]))
      .toEqual([
        ["chrome:IM:8", "worker-a:0", 0],
        ["chrome:CMD:9", "worker-a:1", 0],
        ["chrome:IM:8", "worker-a:2", 0],
        ["chrome:CMD:9", "worker-a:1", 1]
      ]);
  });

  it("does not stamp a scan started in a retired epoch as replacement-epoch data", async () => {
    let releaseOldScan: (() => void) | undefined;
    const oldScanBlocked = new Promise<void>((resolve) => { releaseOldScan = resolve; });
    let scans = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") {
        scans += 1;
        if (scans === 1) await oldScanBlocked;
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify([
        { eventId: scans === 1 ? "old-event" : "new-event" },
        { __fieldlineSweep: { sweepId: "tsport-epoch-sweep", complete: true } }
      ]) } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;

    const oldScan = observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    await vi.waitFor(() => expect(scans).toBe(1));
    expect(observer.beginSourceEpoch(tsport.sourceId)).toBe("worker-a:1");
    const replacementScan = observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    releaseOldScan?.();
    await Promise.all([oldScan, replacementScan]);

    expect(forward).toHaveBeenCalledOnce();
    expect(forward.mock.calls[0]![0]).toMatchObject({ sourceEpoch: "worker-a:1", sequence: 0 });
    expect(forward.mock.calls[0]![0].payload.body).toContain("new-event");
    expect(forward.mock.calls[0]![0].payload.body).not.toContain("old-event");
  });

  it("does not restore a durable socket baseline into a replacement source epoch", async () => {
    const loadSabaWsSnapshots = vi.fn(async () => ({ version: 1 }));
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) =>
        method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)"
          ? { result: { value: "1787432000000" } } : {}),
      forward: vi.fn(async () => undefined),
      observerSessionId: "worker-a",
      loadSabaWsSnapshots
    });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;

    observer.beginSourceEpoch(saba.sourceId);
    await observer.refreshCatalog(saba);

    expect(loadSabaWsSnapshots).not.toHaveBeenCalled();
  });

  it("fences a response body whose CDP read completes after its source epoch retires", async () => {
    let releaseBody!: () => void;
    const bodyBlocked = new Promise<void>((resolve) => { releaseBody = resolve; });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getResponseBody") {
        await bodyBlocked;
        return { body: '{"StatusCode":100,"sel":[]}', base64Encoded: false };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "old-body",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", {
      requestId: "old-body", type: "XHR", response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" }
    });

    const loading = observer.handleEvent(im, "Network.loadingFinished", { requestId: "old-body" });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(8, "Network.getResponseBody",
      { requestId: "old-body" }));
    observer.beginSourceEpoch(im.sourceId);
    releaseBody();
    await loading;

    expect(forward).not.toHaveBeenCalled();
    await expect(observer.replaySnapshots(im.sourceId)).resolves.toBe(false);
  });

  it("fences a socket frame across its awaited document marker", async () => {
    let releaseMarker!: () => void;
    const markerBlocked = new Promise<void>((resolve) => { releaseMarker = resolve; });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        await markerBlocked;
        return { result: { value: "1787432000000" } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "ws-old", url: "wss://sports.example/socket.io/"
    });
    forward.mockClear();

    const frame = observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "ws-old", response: { opcode: 1, payloadData: '42["m","b1",[[0,"reset"],[0,"e"],[0,"done"]],"r1"]' }
    });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalled());
    observer.beginSourceEpoch(saba.sourceId);
    releaseMarker();
    await frame;

    expect(forward).not.toHaveBeenCalled();
    await expect(observer.replaySnapshots(saba.sourceId)).resolves.toBe(false);
  });

  it("does not continue durable restore after the marker await retires its epoch", async () => {
    let releaseMarker!: () => void;
    const markerBlocked = new Promise<void>((resolve) => { releaseMarker = resolve; });
    const loadSabaWsSnapshots = vi.fn(async () => null);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        await markerBlocked;
        return { result: { value: "1787432000000" } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "worker-a", loadSabaWsSnapshots });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;

    const restore = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalled());
    observer.beginSourceEpoch(saba.sourceId);
    releaseMarker();
    await restore;

    expect(loadSabaWsSnapshots).not.toHaveBeenCalled();
  });

  it("does not install or replay a durable baseline loaded after its epoch retires", async () => {
    let releaseLoad!: (value: unknown) => void;
    const loadBlocked = new Promise<unknown>((resolve) => { releaseLoad = resolve; });
    const loadSabaWsSnapshots = vi.fn(async () => loadBlocked);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) =>
        method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)"
          ? { result: { value: "1787432000000" } } : {}),
      forward, observerSessionId: "worker-a", loadSabaWsSnapshots
    });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
    const body = '42["m","b1",[[0,"reset"],[0,"e"],[0,"done"]],"r1"]';

    const restore = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(loadSabaWsSnapshots).toHaveBeenCalledOnce());
    observer.beginSourceEpoch(saba.sourceId);
    releaseLoad({ version: 1, sourceId: saba.sourceId, documentMarker: "1787432000000",
      partitions: [{ partition: "1:b1", frames: [{ url: "wss://sports.example/socket.io/", body,
        streamId: "1", observedAtMs: 1_000, receivedMonotonicMs: 60 }] }] });
    await restore;

    expect(forward.mock.calls.some(([message]) => message.payload.body === body)).toBe(false);
    await expect(observer.replaySnapshots(saba.sourceId)).resolves.toBe(false);
  });

  it("orders a durable clear after an already-started old-epoch save", async () => {
    let releaseSave!: () => void;
    const saveBlocked = new Promise<void>((resolve) => { releaseSave = resolve; });
    const events: string[] = [];
    const saveSabaWsSnapshots = vi.fn(async () => { events.push("save:start"); await saveBlocked; events.push("save:end"); });
    const clearSabaWsSnapshots = vi.fn(async () => { events.push("clear"); });
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) =>
        method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)"
          ? { result: { value: "1787432000000" } } : {}),
      forward: vi.fn(async () => undefined), saveSabaWsSnapshots, clearSabaWsSnapshots
    });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
    await observer.handleEvent(saba, "Network.webSocketCreated", {
      requestId: "ws", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", { requestId: "ws", response: {
      opcode: 1, payloadData: '42["m","b1",[["f",0,["type","matchid"]],[0,"reset"],[0,"e"],[0,"done"]],"r1"]'
    } });
    await vi.waitFor(() => expect(saveSabaWsSnapshots).toHaveBeenCalledOnce());

    observer.beginSourceEpoch(saba.sourceId);
    await Promise.resolve();
    expect(clearSabaWsSnapshots).not.toHaveBeenCalled();
    releaseSave();
    await vi.waitFor(() => expect(events).toEqual(["save:start", "save:end", "clear"]));
  });

  it("persists a complete SABA baseline for worker recovery", async () => {
    const saveSabaWsSnapshots = vi.fn(async (_snapshots: PersistedSabaWsSnapshots) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) =>
        method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)"
          ? { result: { value: "1787432000000" } } : {}),
      forward: vi.fn(async () => undefined), saveSabaWsSnapshots
    });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
    const url = "wss://sports.example/socket.io/";
    const body = '42["m","b1",[["f",0,["type","matchid"]],[0,"reset"],[0,"e"],[0,"done"]],"r1"]';

    await observer.handleEvent(saba, "Network.webSocketCreated", { requestId: "ws", url });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "ws", response: { opcode: 1, payloadData: body }
    });

    await vi.waitFor(() => expect(saveSabaWsSnapshots).toHaveBeenCalledOnce());
    expect(saveSabaWsSnapshots.mock.calls[0]?.[0]).toMatchObject({ sourceId: saba.sourceId,
      partitions: [{ frames: [{ url, body }] }] });
  });

  it("keeps a complete KSPORT baseline in memory without saving its raw frames", async () => {
    const saveSabaWsSnapshots = vi.fn(async (_snapshots: PersistedSabaWsSnapshots) => undefined);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) =>
        method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)"
          ? { result: { value: "1787432000000" } } : {}),
      forward, saveSabaWsSnapshots
    });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/socket";
    const live = ksportFullReceipt("live", 100);
    const today = ksportFullReceipt("today", 104);

    await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "ws", url });
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "ws", response: { opcode: 1, payloadData: live }
    });
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "ws", response: { opcode: 1, payloadData: today }
    });
    await Promise.resolve();

    expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);
    expect(saveSabaWsSnapshots).not.toHaveBeenCalled();
    expect(saveSabaWsSnapshots.mock.calls.some(([snapshot]) =>
      JSON.stringify(snapshot).includes(url) || JSON.stringify(snapshot).includes(live) ||
      JSON.stringify(snapshot).includes(today))).toBe(false);
    forward.mockClear();

    await expect(observer.replaySnapshots(ksport.sourceId)).resolves.toBe(true);
    expect(forward.mock.calls.map(([message]) => message.payload.body)).toEqual([live, today]);
  });

  it("does not load durable snapshots for KSPORT recovery", async () => {
    const loadSabaWsSnapshots = vi.fn(async () => null);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) =>
        method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)"
          ? { result: { value: "1787432000000" } } : {}),
      forward: vi.fn(async () => undefined), loadSabaWsSnapshots
    });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;

    await observer.refreshCatalog(ksport);

    expect(loadSabaWsSnapshots).not.toHaveBeenCalled();
  });

  it("fences direct HTTP ingest while async IM baseline recovery crosses an epoch", async () => {
    let releaseRecovery!: () => void;
    const recoveryBlocked = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const recoverImBaseline = vi.fn(async () => recoveryBlocked);
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      observerSessionId: "worker-a", recoverImBaseline });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    const ingest = observer.ingestHttpResponse(im,
      "https://imsports.directsb.net/api/EventV6/GetSEDelta", "Fetch", '{"delta":true}', { method: "POST" });
    await vi.waitFor(() => expect(recoverImBaseline).toHaveBeenCalledOnce());
    observer.beginSourceEpoch(im.sourceId);
    releaseRecovery();
    await ingest;

    expect(forward).not.toHaveBeenCalled();
    await expect(observer.replaySnapshots(im.sourceId)).resolves.toBe(false);
  });

  it("routes SABA mutation polling through its provider lane without consuming another provider's permit", async () => {
    let releaseSaba!: () => void;
    const sabaBlocked = new Promise<void>((resolve) => { releaseSaba = resolve; });
    let firstSaba = true;
    const sendCommand = vi.fn(async (tabId: number, method: string) => {
      if (tabId === 7 && method === "Runtime.evaluate" && firstSaba) {
        firstSaba = false;
        await sabaBlocked;
        return { result: { value: false } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: `top-${tabId}` } } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      workScheduler: new ProviderWorkScheduler({ maxConcurrent: 2 }) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;

    const mutation = observer.pollSabaDomChanges(saba, "sports.example");
    await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([tabId]) => tabId === 7)).toHaveLength(1));
    const sameProviderRefresh = observer.refreshCatalog(saba);
    const isolatedRefresh = observer.refreshCatalog(bti);
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([tabId]) => tabId === 6)).toBe(true));
    expect(sendCommand.mock.calls.filter(([tabId]) => tabId === 7)).toHaveLength(1);
    releaseSaba();
    await Promise.all([mutation, sameProviderRefresh, isolatedRefresh]);
  });

  it("serializes KSPORT maintenance and explicit refresh in one provider lane", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let first = true;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Runtime.evaluate" && first) { first = false; await firstBlocked; }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;

    const maintenance = observer.maintainKsportFeed(ksport);
    await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1));
    const refresh = observer.refreshCatalog(ksport);
    await Promise.resolve();
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1);
    releaseFirst();
    await Promise.all([maintenance, refresh]);
  });

  it("routes TSPORT replay/recovery behind an active operation for the same provider", async () => {
    let releaseCapture!: () => void;
    const captureBlocked = new Promise<void>((resolve) => { releaseCapture = resolve; });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") { await captureBlocked; return { frameTree: { frame: { id: "top" } } }; }
      if (method === "Runtime.evaluate") return { result: { value: "[]" } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward });
    await observer.ingestWebSocketFrame(tsport,
      "wss://spws.agenate.com/ln/a/p/1/u/b/c/s/1/mg/0/tr/0", '{"eventId":"old"}');
    forward.mockClear();

    const capture = observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(11, "Page.getFrameTree"));
    let refreshSettled = false;
    const refresh = observer.refreshCatalog(tsport).finally(() => { refreshSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refreshSettled).toBe(false);
    expect(forward).not.toHaveBeenCalled();
    releaseCapture();
    await Promise.all([capture, refresh]);
  });

  it("does not reuse a retired TSPORT API request template in a replacement epoch", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;

    expect(observer.beginSourceEpoch(tsport.sourceId)).toBe("worker-a:1");
    await observer.refreshCatalog(tsport);

    expect(forward).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalledWith(11, "Runtime.evaluate", expect.anything(), expect.anything());
  });

  it("keeps replacement capture ownership when the retired scan finishes first", async () => {
    const releases: Array<() => void> = [];
    let scans = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") {
        scans += 1;
        await new Promise<void>((resolve) => { releases.push(resolve); });
        return { frameTree: { frame: { id: "top" } } };
      }
      if (method === "Runtime.evaluate") return { result: { value: JSON.stringify([{ eventId: `event-${scans}` }]) } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;

    const oldCapture = observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    await vi.waitFor(() => expect(scans).toBe(1));
    observer.beginSourceEpoch(tsport.sourceId);
    const replacement = observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    releases.shift()?.();
    await vi.waitFor(() => expect(scans).toBe(2));
    const duplicate = observer.captureCmdSnapshot(tsport, "pacific.agenate.com");
    releases.shift()?.();
    await Promise.all([oldCapture, replacement, duplicate]);

    expect(scans).toBe(2);
  });

  it.each(["Emulation.setFocusEmulationEnabled", "Page.setWebLifecycleState",
    "Page.createIsolatedWorld", "Runtime.evaluate"])(
    "releases the shared provider lane when %s never settles", async (blockedMethod) => {
    vi.useFakeTimers();
    try {
      const records = JSON.stringify([{ eventId: "event-1", leagueName: "League", timeText: "LIVE",
        scoreText: "0 - 0", teamNames: ["Home", "Away"], markets: [{ marketId: "market-1",
          marketType: "FT_TOTAL", lineText: "2.5", selections: [
            { selectionId: "over", selection: "OVER", priceText: "0.82", locked: false },
            { selectionId: "under", selection: "UNDER", priceText: "-0.9", locked: false }
          ] }] }, { __fieldlineSweep: { sweepId: "tsport-timeout-sweep", complete: true } }]);
      const sendCommand = vi.fn(async (tabId: number, method: string) => {
        if (tabId === 9 && method === blockedMethod) {
          return await new Promise<never>(() => undefined);
        }
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: `top-${tabId}`, loaderId: `loader-${tabId}` } } };
        }
        if (method === "Page.createIsolatedWorld") return { executionContextId: tabId };
        if (method === "Runtime.evaluate") return { result: { type: "string", value: records } };
        return {};
      });
      const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
      const observer = new NetworkObserver({ sendCommand, forward, frameCommandTimeoutMs: 10 });

      const blocked = observer.maintain({ lobby: "SABA", sourceId: "chrome:SABA:9", tabId: 9 });
      const capture = observer.captureCmdSnapshot(
        { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 }, "pacific.agenate.com");
      await vi.advanceTimersByTimeAsync(11);
      await Promise.all([blocked, capture]);

      expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "TSPORT", transport: "DOM_SNAPSHOT" }));
    } finally {
      vi.useRealTimers();
    }
    });

  it("captures a complete T-Sports DOM baseline instead of waiting for WebSocket price deltas", async () => {
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain(".match__team-name");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain("25|5|75");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain("CORNER_");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain("CARD_");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain('secondHalf ? "SH"');
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).not.toContain('eventId + ":" + marketType + ":" + groupIndex + ":" + index');
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).not.toMatch(/cookie|localStorage|sessionStorage|password|token/iu);
    expect(() => new Function(`return ${TSPORT_PUBLIC_CATALOG_EXPRESSION}`)).not.toThrow();
    const records = JSON.stringify([{ eventId: "event-1", leagueName: "League", timeText: "LIVE",
      scoreText: "0 - 0", teamNames: ["Home", "Away"], markets: [{ marketId: "market-1",
        marketType: "FT_AH", lineText: "-0.5", selections: [
          { selectionId: "home", selection: "HOME", priceText: "0.82", locked: false, lineText: "-0.5" },
          { selectionId: "away", selection: "AWAY", priceText: "-0.9", locked: false, lineText: "+0.5" }
        ] }] }, { __fieldlineSweep: { sweepId: "tsport-catalog-sweep", complete: true } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 71 };
      if (method === "Runtime.evaluate") {
        expect(String(params?.expression)).toContain(".match__team-name");
        return { result: { type: "string", value: records } };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });

    await observer.captureCmdSnapshot(
      { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 }, "pacific.agenate.com"
    );

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      lobby: "TSPORT", transport: "DOM_SNAPSHOT",
      request: expect.objectContaining({ pathnameClass: "/__fieldline_dom_snapshot__" })
    }));
  });

  it("expands only bounded structural market controls and excludes odds and bet-slip controls", () => {
    expect(KEEP_ACTIVE_EXPRESSION).toContain("fieldlineMarketExpandedAt");
    expect(KEEP_ACTIVE_EXPRESSION).toContain("fieldlineMarketExpandSignature");
    expect(KEEP_ACTIVE_EXPRESSION).toContain("slice(0, 12)");
    expect(KEEP_ACTIVE_EXPRESSION).toContain("closest(unsafeSelector)");
    expect(KEEP_ACTIVE_EXPRESSION).toContain("more markets");
    expect(KEEP_ACTIVE_EXPRESSION).not.toContain("fieldlineMarketExpanded = '1'");
    expect(() => new Function(`return ${KEEP_ACTIVE_EXPRESSION}`)).not.toThrow();
  });

  it("does not click APSPORT-specific controls from another provider's maintenance", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" } } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 19 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "BTI", sourceId: "chrome:BTI:19", tabId: 19 });

    const evaluation = sendCommand.mock.calls.find(([, method]) => method === "Runtime.evaluate");
    const expression = String(evaluation?.[2]?.expression ?? "");
    const clicks: string[] = [];
    const owner = {
      id: "match-778899",
      getAttribute: (name: string) => name === "data-event-id" ? "778899" : null,
      querySelector: () => null
    };
    const control = (className: string, label: string, unsafe = false) => ({
      className, textContent: label, dataset: {} as Record<string, string>,
      getClientRects: () => [{}], hasAttribute: () => false,
      getAttribute: (name: string) => name === "aria-expanded" ? "false" : null,
      matches: () => false,
      closest: (selector: string) => selector.includes("selection") ? (unsafe ? {} : null)
        : selector === ".match" || selector.startsWith("[data-event-id]") ? owner : null,
      click: () => { clicks.push(label); }
    });
    const numericDetail = control("c-btn c-btn--more c-is-close", "27");
    const otherAsian = control("c-btn c-btn--more-lines c-is-close", "Các loại cược Châu Á khác");
    const viewMore = control("view-more center-absolute", "Xem thêm (+1) các loại cược khác");
    const oddsLike = control("c-btn c-btn--more c-is-close selection-price", "1.92", true);
    const controls = [numericDetail, otherAsian, viewMore, oddsLike];
    const document = {
      scrollingElement: { scrollTop: 0, scrollHeight: 100, clientHeight: 100 },
      documentElement: { dataset: {} as Record<string, string> },
      querySelectorAll: (selector: string) => selector === "body *" ? [] : controls
    };

    const result = new Function("document", "Date", `return ${expression}`)(document, { now: () => 100_000 });

    expect(result).toMatchObject({ expanded: 0 });
    expect(clicks).toEqual([]);
  });

  it("uses the same bounded hidden-market expansion while walking the virtualized CMD catalog", () => {
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain("fieldlineCmdMarketExpandedAt");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain("slice(0, 12)");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).toContain("fieldlineMarketExpandSignature");
    expect(CMD_CATALOG_DISCOVERY_EXPRESSION).not.toContain("fieldlineMarketExpanded = '1'");
    expect(() => new Function(`return ${CMD_CATALOG_DISCOVERY_EXPRESSION}`)).not.toThrow();
  });

  it("skips a hung CMD frame before it can delay a valid catalog past freshness", async () => {
    const records = JSON.stringify([{ sportId: "1", leagueId: "l", leagueName: "League",
      matchId: "m", timeText: "LIVE", teamNames: ["Home", "Away"], groups: [] }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" },
        childFrames: [{ frame: { id: "hung" } }] } };
      if (method === "Page.createIsolatedWorld") return {
        executionContextId: params?.frameId === "top" ? 31 : 32
      };
      if (method === "Runtime.evaluate" && params?.contextId === 32) {
        return new Promise<never>(() => undefined);
      }
      if (method === "Runtime.evaluate") return { result: { type: "string", value: records } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, frameCommandTimeoutMs: 10 });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 },
      "cgnew.fts368.com");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "DOM_SNAPSHOT" }));
  });

  it("includes a credential-free selector diagnostic when CMD rows are not recognized", () => {
    expect(CMD_PUBLIC_CATALOG_EXPRESSION).toContain("__fieldlineDiagnostic");
    expect(CMD_PUBLIC_CATALOG_EXPRESSION).toContain("innerText");
    expect(CMD_PUBLIC_CATALOG_EXPRESSION).not.toMatch(/cookie|localStorage|sessionStorage|password|token/iu);
    expect(CMD_PUBLIC_CATALOG_EXPRESSION).not.toMatch(/(?:result\.length|records\.size)\s*>=\s*500/iu);
    expect(CMD_PUBLIC_CATALOG_EXPRESSION).not.toContain('["1", "3"].includes(group.betTypeIds[0])');
    expect(() => new Function(`return ${CMD_PUBLIC_CATALOG_EXPRESSION}`)).not.toThrow();
    expect(CMD_PUBLIC_CATALOG_EXPRESSION).toContain("/(\\d)H\\s*(\\d+)/iu");
  });

  it("forwards redacted WebSocket text frames with ordered sequence", async () => {
    const sbo = { lobby: "SBO", sourceId: "chrome:SBO:7", tabId: 7 } as const;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50, observerSessionId: "observer-a"
    });
    await observer.handleEvent(sbo, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://sports.example/socket.io/?token=secret"
    });
    await observer.handleEvent(sbo, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "{\"eventId\":1}" }
    });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sourceEpoch: "observer-a:0", sequence: 0, transport: "WS_STATE",
      request: expect.objectContaining({ streamId: "1" }),
      payload: { encoding: "UTF8", body: '{"state":"OPEN"}' }
    }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sourceEpoch: "observer-a:0", sequence: 1,
      transport: "WS_FRAME",
      request: expect.objectContaining({ hostname: "sports.example", pathnameClass: "/socket.io/", streamId: "1" }),
      payload: { encoding: "UTF8", body: "{\"eventId\":1}" }
    }));
    await observer.handleEvent(sbo, "Network.webSocketClosed", { requestId: "ws-1" });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, transport: "WS_STATE", request: expect.objectContaining({ streamId: "1" }),
      payload: { encoding: "UTF8", body: '{"state":"CLOSED"}' }
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("secret");
  });

  it("correlates a SABA frame emitted from a child session with its root socket creation", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50 });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "provider-ws", url: "wss://socket.saba.test/socket.io/"
    });
    forward.mockClear();

    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "provider-ws", response: { opcode: 1,
        payloadData: '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]' }
    }, "saba-child-session");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      lobby: "SABA", transport: "WS_FRAME",
      request: expect.objectContaining({ streamId: "1" }),
      payload: { encoding: "UTF8",
        body: '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]' }
    }));
  });

  it("adopts a strict SABA catalog frame when CDP did not replay its socket creation", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50, observerSessionId: "observer-a" });
    const body = '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]';

    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker", response: { opcode: 1, payloadData: body }
    }, "saba-child-session");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sourceEpoch: "observer-a:0", sequence: 0, lobby: "SABA", transport: "WS_STATE",
      request: expect.objectContaining({ pathnameClass: "/socket.io/", streamId: "1" }),
      payload: { encoding: "UTF8", body: '{"state":"OPEN"}' }
    }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sourceEpoch: "observer-a:0", sequence: 1, lobby: "SABA", transport: "WS_FRAME",
      request: expect.objectContaining({ pathnameClass: "/socket.io/", streamId: "1" }),
      payload: { encoding: "UTF8", body }
    }));
  });

  it("preserves SABA frame arrival order while the first frame resolves its document marker", async () => {
    const markerResolvers: Array<(value: unknown) => void> = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>): Promise<unknown> => {
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        return new Promise((resolve) => markerResolvers.push(resolve));
      }
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (value: ChromeBridgeEnvelope) => { forwarded.push(value); }) });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "ordered-provider-ws", url: "wss://socket.saba.test/socket.io/"
    });

    const firstBody = '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]';
    const secondBody = '42["m","b1",[[0,"reset"],[0,"done"]],"r2"]';
    const first = observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ordered-provider-ws", response: { opcode: 1, payloadData: firstBody }
    });
    const second = observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ordered-provider-ws", response: { opcode: 1, payloadData: secondBody }
    });
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();

    expect(markerResolvers).toHaveLength(1);
    markerResolvers[0]!({ result: { value: "1000" } });
    await Promise.all([first, second]);

    expect(forwarded.filter((value) => value.transport === "WS_FRAME")
      .map((value) => value.payload.body)).toEqual([firstBody, secondBody]);
  });

  it("does not create a second SABA stream when CDP repeats one socket creation in a child session", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 1_000, monotonicNow: () => 50 });
    const created = { requestId: "provider-ws", url: "wss://socket.saba.test/socket.io/" };

    await observer.handleEvent(source, "Network.webSocketCreated", created);
    await observer.handleEvent(source, "Network.webSocketCreated", created, "saba-child-session");
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "provider-ws", response: { opcode: 1,
        payloadData: '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]' }
    }, "saba-child-session");
    await observer.heartbeat(source, "socket.saba.test");

    const opened = forwarded.filter((envelope) => envelope.transport === "WS_STATE" &&
      envelope.payload.body === '{"state":"OPEN"}');
    expect(opened).toHaveLength(1);
    expect(opened[0]?.request.streamId).toBe("1");
    expect(forwarded).toContainEqual(expect.objectContaining({
      lobby: "SABA", transport: "WS_FRAME", request: expect.objectContaining({ streamId: "1" })
    }));
    const heartbeat = forwarded.at(-1);
    expect(heartbeat?.transport).toBe("TAB_STATE");
    expect(JSON.parse(heartbeat?.payload.body ?? "{}")).toMatchObject({ webSockets: 1 });
  });

  it("does not let an auxiliary SABA Socket.IO connection retire the catalog stream", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 1_000, monotonicNow: () => 50 });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "catalog", url: "wss://socket.saba.test/socket.io/"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1,
        payloadData: '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]' }
    });

    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "auxiliary", url: "wss://socket.saba.test/socket.io/"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "auxiliary", response: { opcode: 1, payloadData: '42["notice",{}]' }
    });

    const opened = forwarded.filter((envelope) => envelope.transport === "WS_STATE" &&
      envelope.payload.body === '{"state":"OPEN"}');
    expect(opened).toHaveLength(1);
    expect(opened[0]?.request.streamId).toBe("1");
    expect(forwarded.some((envelope) => envelope.request.streamId === "2")).toBe(false);
  });

  it("retires a root-created SABA socket when its close arrives from a child session", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 1_000, monotonicNow: () => 50 });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "provider-ws", url: "wss://socket.saba.test/socket.io/"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "provider-ws", response: { opcode: 1,
        payloadData: '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]' }
    });

    await observer.handleEvent(source, "Network.webSocketClosed", {
      requestId: "provider-ws"
    }, "saba-child-session");
    await observer.heartbeat(source, "socket.saba.test");

    expect(forwarded).toContainEqual(expect.objectContaining({
      transport: "WS_STATE", request: expect.objectContaining({ streamId: "1" }),
      payload: { encoding: "UTF8", body: '{"state":"CLOSED"}' }
    }));
    const heartbeat = forwarded.at(-1);
    expect(heartbeat?.transport).toBe("TAB_STATE");
    expect(JSON.parse(heartbeat?.payload.body ?? "{}")).toMatchObject({ webSockets: 0 });
  });

  it("preserves a current SABA socket while its debugger target is reattached", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50, observerSessionId: "worker-a" });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "provider-ws", url: "wss://socket.saba.test/socket.io/"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "provider-ws", response: { opcode: 1,
        payloadData: '42["m","b1",[[0,"reset"],[0,"done"]],"r1"]' }
    });
    forward.mockClear();

    observer.prepareDebuggerReattach(source.tabId);
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "provider-ws", response: { opcode: 1,
        payloadData: '42["m","b1",[[0,"reset"],[0,"done"]],"r2"]' }
    }, "replacement-child-session");

    expect(forward).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sourceEpoch: "worker-a:0", lobby: "SABA", transport: "WS_FRAME",
      request: expect.objectContaining({ streamId: "1" })
    }));
  });

  it("emits a lightweight ordered heartbeat so an idle attached tab stays live", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50
    });

    await observer.heartbeat(source, "sports.example");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 0,
      transport: "TAB_STATE",
      request: {
        hostname: "sports.example",
        pathnameClass: "/__fieldline_heartbeat__",
        resourceType: "Tab"
      },
      // SABA reads its catalog from the page, so its heartbeat now carries the
      // attach diagnostic: without it a tab selector that never found its tab
      // could not be told from a day list the page never sent.
      payload: { encoding: "UTF8", body: expect.stringContaining('"kind":"WS_ATTACH"') as unknown as string }
    }));
  });

  it("does not create replacement source epochs when child execution contexts clear", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), observerSessionId: "worker-a" });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;

    await observer.handleEvent(apsport, "Runtime.executionContextsCleared", {}, "child-one");
    await observer.handleEvent(apsport, "Runtime.executionContextsCleared", {}, "child-two");

    expect(observer.beginSourceEpoch(apsport.sourceId)).toBe("worker-a:1");
  });

  it("does not create a replacement epoch when Runtime.enable clears an unchanged root context", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), observerSessionId: "worker-a" });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;

    await observer.handleEvent(apsport, "Runtime.executionContextsCleared", {});

    expect(observer.beginSourceEpoch(apsport.sourceId)).toBe("worker-a:1");
  });

  it("reports a BTI 1008 page as an auth failure instead of a healthy tab heartbeat", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const onBtiPageHealth = vi.fn();
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { value: { status: "AUTH_ERROR", code: "1008" } } }
      : {});
    const observer = new NetworkObserver({ sendCommand, forward, onBtiPageHealth });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:18", tabId: 18 } as const;

    await observer.heartbeat(bti, "prod20091.fxf774.com");

    expect(sendCommand).toHaveBeenCalledWith(18, "Runtime.evaluate", expect.objectContaining({
      returnByValue: true
    }));
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "TAB_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({
        kind: "PAGE_HEALTH", status: "AUTH_ERROR", code: "1008"
      }) }
    }));
    expect(onBtiPageHealth).toHaveBeenCalledExactlyOnceWith({
      sourceId: "chrome:BTI:18", tabId: 18, status: "AUTH_ERROR", code: "1008"
    });
  });

  it("reports socket-created, retained-socket, and KSPORT child-target attach counts", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Target.getTargets") return { targetInfos: [
        { type: "iframe", targetId: "sb-a", url: "https://a.sb21.net/sport" },
        { type: "iframe", targetId: "sb-b", url: "https://b.sb21.net/sport" },
        { type: "iframe", targetId: "foreign", url: "https://example.test/frame" }
      ] };
      if (method === "Target.attachToTarget") return { sessionId: `session-${String(params?.targetId)}` };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:15", tabId: 15 } as const;

    await observer.start(ksport);
    await observer.start(tsport);
    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "sports", url: "wss://a.sb21.net/sport/538/session/websocket"
    }, "session-sb-a");
    await observer.heartbeat(ksport, "a.sb21.net");
    await observer.heartbeat(tsport, "sports.example");

    const diagnostics = forwarded.filter((envelope) => envelope.transport === "TAB_STATE")
      .map((envelope) => JSON.parse(envelope.payload.body) as Record<string, unknown>);
    expect(diagnostics).toEqual([
      { kind: "WS_ATTACH", sourceGeneration: 0, webSocketCreated: 1, webSockets: 1,
        ksportTargets: 2, attachedTargets: 2,
        framesReceived: 0, framesOrphan: 0, framesForwarded: 0, ignoredSockets: 0,
        framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0,
        framesDecoderFailed: 0, sockjsOpen: 0, sockjsHeartbeat: 0, sockjsArray: 0,
        sockjsClose: 0, sockjsOther: 0, decoderFailCode: "NONE",
        stompFrames: 0, stompMessages: 0, stompPartitionRejected: 0, snapshotRejections: "", destinationShapes: "",
        stompPendingChars: 0, stompCommandFragments: 0, stompFragments: 0,
        destLiveLike: 0, destTodayLike: 0, destSportsLike: 0, subSportLike: 0,
        // Three targets are offered, all three are iframes, two are on the
        // provider host. Separating these tells a missing target from a
        // rejected host.
        targetsTotal: 3, targetsIframe: 3, autoAttachEvents: 0,
        baselineLive: 0, baselineToday: 0, baselineTabSelections: 0,
        baselineTabStatus: "NONE", reconnectAttempts: 0, reconnectOutcomes: "",
        baselineTabTargets: 0, baselineTabStep: "NONE",
        baselineTabGroups: 0, baselineTabScopes: 0, baselineTabPeriods: 0, baselineTabLabels: "",
        catalogShape: expect.stringContaining("targets[") as unknown as string },
      { kind: "WS_ATTACH", sourceGeneration: 0, webSocketCreated: 0, webSockets: 0,
        ksportTargets: 0, attachedTargets: 0,
        framesReceived: 0, framesOrphan: 0, framesForwarded: 0, ignoredSockets: 0,
        framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0,
        framesDecoderFailed: 0, sockjsOpen: 0, sockjsHeartbeat: 0, sockjsArray: 0,
        sockjsClose: 0, sockjsOther: 0, decoderFailCode: "NONE",
        stompFrames: 0, stompMessages: 0, stompPartitionRejected: 0, snapshotRejections: "", destinationShapes: "",
        stompPendingChars: 0, stompCommandFragments: 0, stompFragments: 0,
        destLiveLike: 0, destTodayLike: 0, destSportsLike: 0, subSportLike: 0,
        targetsTotal: 0, targetsIframe: 0, autoAttachEvents: 0,
        baselineLive: 0, baselineToday: 0, baselineTabSelections: 0,
        baselineTabStatus: "NONE", reconnectAttempts: 0, reconnectOutcomes: "",
        baselineTabTargets: 0, baselineTabStep: "NONE",
        baselineTabGroups: 0, baselineTabScopes: 0, baselineTabPeriods: 0, baselineTabLabels: "",
        catalogShape: expect.stringContaining("targets[") as unknown as string }
    ]);
  });

  it("emits only sanitized poller work health as TAB_STATE diagnostic", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50
    });
    const health = {
      kind: "WORK_HEALTH" as const,
      counters: { OK: 2, ERROR: 1, TIMEOUT: 1, SKIPPED_INFLIGHT: 3, forcedUnlocks: 1 },
      lastOutcome: { workItem: "refreshCatalog", outcome: "TIMEOUT", durationMs: 30_001 },
      lastErrorCode: "WORK_ITEM_TIMEOUT",
      inFlightAgeMs: 0
    };

    await observer.emitWorkHealth(source, health);

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "TAB_STATE",
      request: expect.objectContaining({ pathnameClass: "/__fieldline_work_health__",
        resourceType: "Diagnostic" }),
      payload: { encoding: "UTF8", body: JSON.stringify(health) }
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toMatch(/token|cookie|authorization|launchUrl/iu);
  });

  it("does not read or forward XHR bodies that no provider adapter can consume", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: '{"analytics":true}', base64Encoded: false } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "analytics",
      request: { method: "POST", url: "https://sports.example/api/analytics" } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "analytics", type: "Fetch",
      response: { url: "https://sports.example/api/analytics" } });

    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "analytics" });

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.getResponseBody")).toBe(false);
    expect(forward).not.toHaveBeenCalled();
  });

  it("does not forward BTI sockets because BTI authority is authenticated HTTP only", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;
    await observer.handleEvent(bti, "Network.webSocketCreated", {
      requestId: "bti-revision", url: "wss://sports.example/revisions"
    });
    await observer.handleEvent(bti, "Network.webSocketFrameReceived", { requestId: "bti-revision",
      response: { opcode: 1, payloadData: '{"revision":2}' } });

    expect(forward).not.toHaveBeenCalled();
  });

  it("retrieves allow-listed XHR bodies only after loadingFinished and isolates body failure", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getResponseBody") return { body: "{\"odds\":1.95}", base64Encoded: false };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const deltaUrl = "https://imsports.directsb.net/api/EventV6/GetSEDelta";
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-1",
      request: { method: "GET", url: deltaUrl } });
    await observer.handleEvent(im, "Network.responseReceived", {
      requestId: "xhr-1", type: "XHR", response: { url: deltaUrl, mimeType: "application/json" }
    });
    expect(forward).not.toHaveBeenCalled();
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "xhr-1" });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "HTTP_RESPONSE", sequence: 0 }));

    sendCommand.mockRejectedValueOnce(new Error("body unavailable"));
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-2",
      request: { method: "POST", url: deltaUrl } });
    await observer.handleEvent(im, "Network.responseReceived", {
      requestId: "xhr-2", type: "Fetch", response: { url: deltaUrl, mimeType: "application/json" }
    });
    await expect(observer.handleEvent(im, "Network.loadingFinished", { requestId: "xhr-2" })).resolves.toBeUndefined();
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("emits opaque bound frame and document provenance and rotates it with either CDP identity", async () => {
    let currentFrame = { id: "raw-frame-secret-a", loaderId: "raw-loader-secret-a" };
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: currentFrame } };
      if (method === "Network.getResponseBody") return { body: "{\"odds\":1.95}", base64Encoded: false };
      return {};
    });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => { forwarded.push(envelope); },
      now: () => 1_000, monotonicNow: () => 50, observerSessionId: "observer-provenance" });
    const im = { lobby: "IM", sourceId: "chrome:IM:7", tabId: 7 } as const;
    const deltaUrl = "https://imsports.directsb.net/api/EventV6/GetSEDelta";

    const capture = async (requestId: string): Promise<void> => {
      await observer.handleEvent(im, "Network.requestWillBeSent", { requestId,
        frameId: currentFrame.id, loaderId: currentFrame.loaderId,
        request: { method: "GET", url: deltaUrl } });
      await observer.handleEvent(im, "Network.responseReceived", { requestId, type: "XHR",
        response: { url: deltaUrl } });
      await observer.handleEvent(im, "Network.loadingFinished", { requestId });
    };

    await capture("document-a");
    currentFrame = { id: "raw-frame-secret-a", loaderId: "raw-loader-secret-b" };
    await capture("document-b");
    currentFrame = { id: "raw-frame-secret-b", loaderId: "raw-loader-secret-c" };
    await capture("frame-b");

    const identities = forwarded.map((envelope) => ({
      frame: (envelope.request as Record<string, unknown>).requestFrameKey,
      document: (envelope.request as Record<string, unknown>).requestDocumentKey
    }));
    expect(identities).toHaveLength(3);
    expect(identities.every(({ frame, document }) =>
      typeof frame === "string" && /^http-frame:[a-z0-9]+$/u.test(frame) &&
      typeof document === "string" && /^http-document:[a-z0-9]+$/u.test(document))).toBe(true);
    expect(identities[0]!.frame).toBe(identities[1]!.frame);
    expect(identities[0]!.document).not.toBe(identities[1]!.document);
    expect(identities[1]!.frame).not.toBe(identities[2]!.frame);
    expect(JSON.stringify(forwarded)).not.toContain("raw-frame-secret");
    expect(JSON.stringify(forwarded)).not.toContain("raw-loader-secret");
  });

  it("propagates only CMD's numeric DataOdds fc request metadata", async () => {
    const full = JSON.stringify({ t: 10, a: true, data: [], today: [], f: [] });
    const sendCommand = vi.fn(async (_tabId: number, method: string) =>
      method === "Network.getResponseBody" ? { body: full, base64Encoded: false } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const providerUrl = "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx?fc=1&opaque=secret";
    await observer.handleEvent(cmd, "Network.requestWillBeSent", { requestId: "cmd-full", type: "XHR",
      request: { url: providerUrl, method: "GET", headers: {} } });
    await observer.handleEvent(cmd, "Network.responseReceived", { requestId: "cmd-full", type: "XHR",
      response: { url: providerUrl, mimeType: "application/json" } });
    await observer.handleEvent(cmd, "Network.loadingFinished", { requestId: "cmd-full" });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({
      hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      resourceType: "XHR", providerFunctionCode: 1, method: "GET",
      observerRequestId: expect.stringMatching(/:request:0$/u)
    }) }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("opaque=secret");
  });

  it("reads CMD's full-baseline function code from the current POST form body", async () => {
    const full = JSON.stringify({ t: "10", a: true, data: [], today: [], f: [] });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getResponseBody") return { body: full, base64Encoded: false };
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "cmd-frame", loaderId: "cmd-document", url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx"
      } } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    const providerUrl = "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx";
    await observer.handleEvent(cmd, "Network.requestWillBeSent", { requestId: "cmd-post-full", type: "XHR",
      frameId: "cmd-frame", loaderId: "cmd-document",
      request: { url: providerUrl, method: "POST", headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      postData: "fc=1&clientTime=1787610000000" } });
    await observer.handleEvent(cmd, "Network.responseReceived", { requestId: "cmd-post-full", type: "XHR",
      response: { url: providerUrl, mimeType: "application/json" } });
    await observer.handleEvent(cmd, "Network.loadingFinished", { requestId: "cmd-post-full" });

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({
      providerFunctionCode: 1, method: "POST"
    }) }));
  });

  it("does not passively copy a generated BTI detail body that the direct refresh cache already owns", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: JSON.stringify({ data: [] }), base64Encoded: false }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;
    const detailUrl = "https://bti.test/api/eventpage/events/event-1";
    await observer.handleEvent(bti, "Network.requestWillBeSent", { requestId: "bti-detail", type: "Fetch",
      request: { method: "GET", url: detailUrl,
        headers: { "X-Fieldline-Generation": "bti:2000:7" } } });
    await observer.handleEvent(bti, "Network.responseReceived", { requestId: "bti-detail", type: "Fetch",
      response: { url: detailUrl } });
    await observer.handleEvent(bti, "Network.loadingFinished", { requestId: "bti-detail" });

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.getResponseBody")).toBe(false);
    expect(forward).not.toHaveBeenCalled();
  });

  it("does not passively copy a generated BTI list body that the direct complete generation already owns", async () => {
    const generation = "bti:1720000000000:37";
    const paths = [
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
    ];
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "doc" } } };
      if (method === "Runtime.evaluate") return { result: { value: {
        status: "catalog-requested", generation, origin: "https://sports.bti.test",
        responses: paths.map((url) => ({ url, body: '{"serializedData":[]}' }))
      } } };
      if (method === "Network.getResponseBody") return { body: '{"serializedData":[]}', base64Encoded: false };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;
    await observer.refreshCatalog(bti);
    expect(forward).toHaveBeenCalledTimes(3);
    sendCommand.mockClear();

    const url = "https://sports.bti.test/api/eventlist/asia/leagues/v2/1/live";
    await observer.handleEvent(bti, "Network.requestWillBeSent", { requestId: "duplicate-list", type: "Fetch",
      request: { method: "GET", url, headers: { "X-Fieldline-Generation": generation } } });
    await observer.handleEvent(bti, "Network.responseReceived", { requestId: "duplicate-list", type: "Fetch",
      response: { url } });
    await observer.handleEvent(bti, "Network.loadingFinished", { requestId: "duplicate-list" });

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.getResponseBody")).toBe(false);
    expect(forward).toHaveBeenCalledTimes(3);
  });

  it("retains only the safe IM Market partition from request post data", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: JSON.stringify({ StatusCode: 100, sel: [] }), base64Encoded: false }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000,
      monotonicNow: () => 50, observerSessionId: "observer-im" });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-im",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE",
        postData: JSON.stringify({ SportId: 1, Market: 2, token: "must-not-leak" }) } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "xhr-im", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "xhr-im" });

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sourceEpoch: "observer-im:0",
      request: expect.objectContaining({ providerPartition: "IM_MARKET_2" })
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("must-not-leak");
  });

  it("recovers an omitted IM partition from CDP request post data", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getRequestPostData") {
        return { postData: JSON.stringify({ SportId: 1, Market: 1, token: "must-not-leak" }) };
      }
      if (method === "Network.getResponseBody") {
        return { body: JSON.stringify({ StatusCode: 100, sel: [] }), base64Encoded: false };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000,
      monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-im",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "xhr-im", type: "Fetch",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "xhr-im" });

    expect(sendCommand).toHaveBeenCalledWith(8, "Network.getRequestPostData", { requestId: "xhr-im" });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ providerPartition: "IM_MARKET_1" })
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("must-not-leak");
  });

  it("emits a credential-free diagnostic when Chrome evicts an IM snapshot body", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getRequestPostData") {
        return { postData: JSON.stringify({ Market: 1 }) };
      }
      if (method === "Network.getResponseBody") throw new Error("body evicted");
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000,
      monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-im",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "xhr-im", type: "Fetch",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", {
      requestId: "xhr-im", encodedDataLength: 13 * 1024 * 1024
    });

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "TAB_STATE",
      request: expect.objectContaining({ pathnameClass: "/__fieldline_http_body_unavailable__" }),
      payload: { encoding: "UTF8", body: JSON.stringify({
        path: "/api/EventV6/GetSE", providerPartition: "IM_MARKET_1", encodedDataLength: 13 * 1024 * 1024
      }) }
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("body evicted");
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Network.getResponseBody"))
      .toHaveLength(3);
  });

  it("retries a transient IM body miss without reloading its tab", async () => {
    let bodyAttempts = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getRequestPostData") {
        return { postData: JSON.stringify({ Market: 1 }) };
      }
      if (method === "Network.getResponseBody" && ++bodyAttempts < 3) throw new Error("body not ready");
      if (method === "Network.getResponseBody") {
        return { body: JSON.stringify({ StatusCode: 100, sel: [] }), base64Encoded: false };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000,
      monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-im",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "xhr-im", type: "Fetch",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "xhr-im", encodedDataLength: 471_781 });

    expect(bodyAttempts).toBe(3);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      transport: "HTTP_RESPONSE",
      request: expect.objectContaining({ providerPartition: "IM_MARKET_1" })
    }));
    expect(forward.mock.calls.some(([message]) =>
      message.request.pathnameClass === "/__fieldline_http_body_unavailable__")).toBe(false);
  });

  it("redacts and forwards a large UTF8 HTTP response as ordered wire-safe chunks", async () => {
    const largeBody = JSON.stringify({ StatusCode: 100, token: "super-secret",
      sel: Array.from({ length: 5_000 }, (_, index) => ({ eid: index + 1, name: `event-${index}`, pad: "x".repeat(80) })) });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: largeBody, base64Encoded: false }
      : method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } }
        : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });

    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "xhr-large",
      frameId: "im-frame", loaderId: "im-document",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", {
      requestId: "xhr-large", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE", mimeType: "application/json" }
    });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "xhr-large" });

    expect(forward.mock.calls.length).toBeGreaterThan(1);
    const chunks = forward.mock.calls.map(([envelope]) => JSON.parse(envelope.payload.body));
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(new Set(chunks.map((chunk) => chunk.snapshotId)).size).toBe(1);
    expect(chunks.every((chunk) => chunk.chunkCount === chunks.length)).toBe(true);
    expect(chunks.every((chunk) => new TextEncoder().encode(JSON.stringify(chunk)).byteLength < 256 * 1024)).toBe(true);
    const reconstructed = chunks.map((chunk) => chunk.bodyFragment).join("");
    expect(JSON.parse(reconstructed).sel).toHaveLength(5_000);
    expect(reconstructed).not.toContain("super-secret");
  });

  it("allocates direct HTTP request identities before awaits so concurrent large bodies cannot collide", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } }
        : {}),
      forward: async (message) => { forwarded.push(message); },
      now: () => 1_000,
      monotonicNow: () => 50,
      observerSessionId: "observer-concurrent"
    });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const large = (label: string) => JSON.stringify({ StatusCode: 100,
      sel: [{ label, pad: "x".repeat(230_000) }] });
    type DirectHttpIngest = (source: typeof im, url: string, resourceType: "Fetch", body: string,
      request: { readonly method: "GET" | "POST"; readonly verifiedDocument: {
        readonly frameId: string; readonly loaderId: string } }) => Promise<void>;
    const ingest = observer.ingestHttpResponse.bind(observer) as unknown as DirectHttpIngest;

    await Promise.all([
      ingest(im, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch", large("A"), {
        method: "GET", verifiedDocument: { frameId: "im-frame", loaderId: "im-document" }
      }),
      ingest(im, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch", large("B"), {
        method: "POST", verifiedDocument: { frameId: "im-frame", loaderId: "im-document" }
      })
    ]);

    const chunks = forwarded.map((message) => ({ message, wrapper: JSON.parse(message.payload.body) as {
      snapshotId: string; chunkIndex: number; bodyFragment: string
    } }));
    expect(new Set(chunks.map(({ message }) => message.request.observerRequestId)).size).toBe(2);
    expect(new Set(chunks.map(({ wrapper }) => wrapper.snapshotId)).size).toBe(2);
    const requests = new Map<string, ChromeBridgeEnvelope[]>();
    for (const { message } of chunks) {
      const id = String(message.request.observerRequestId);
      requests.set(id, [...(requests.get(id) ?? []), message]);
    }
    expect([...requests.values()].map((messages) => messages[0]!.request.method).sort())
      .toEqual(["GET", "POST"]);
    expect([...requests.values()].every((messages) => {
      const ordered = [...messages].sort((left, right) => {
        const leftChunk = JSON.parse(left.payload.body) as { chunkIndex: number };
        const rightChunk = JSON.parse(right.payload.body) as { chunkIndex: number };
        return leftChunk.chunkIndex - rightChunk.chunkIndex;
      });
      const body = ordered.map((message) => (JSON.parse(message.payload.body) as { bodyFragment: string })
        .bodyFragment).join("");
      return JSON.parse(body).sel.length === 1;
    })).toBe(true);
  });

  it("does not copy the raw response body from its own compact IM recovery fetch", async () => {
    const sendCommand = vi.fn(async () => ({ body: "raw-body-must-not-be-read", base64Encoded: false }));
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const request = { requestId: "compact-probe", type: "Fetch", request: {
      method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE",
      headers: { "X-Fieldline-Catalog-Probe": "compact-v1" },
      postData: JSON.stringify({ Market: 1 })
    } };

    await observer.handleEvent(im, "Network.requestWillBeSent", request);
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "compact-probe", type: "Fetch",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "compact-probe" });

    expect(sendCommand).not.toHaveBeenCalledWith(8, "Network.getResponseBody", expect.anything());
    expect(forward).not.toHaveBeenCalled();
  });

  it("delivers every quote-heavy HTTP fragment through the serialized envelope limit", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const onForwardOverflow = vi.fn();
    const observer = new NetworkObserver({ observerSessionId: "test-worker", now: () => 1_000,
      monotonicNow: () => 50, sendCommand: vi.fn(async () => ({})),
      forward: async message => { forwarded.push(message); }, onForwardOverflow });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const body = JSON.stringify({ StatusCode: 100, sel: [], before: "x".repeat(110_000),
      empty: Array(40_000).fill(""), after: "x".repeat(110_000) });
    await observer.ingestHttpResponse(im, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch", body,
      { method: "POST", currentDocumentConfirmed: true });
    const chunks = forwarded.map(message => JSON.parse(message.payload.body));
    expect(chunks.map(chunk => chunk.bodyFragment).join("")).toBe(body);
    expect(chunks.map(chunk => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every(chunk => chunk.chunkCount === chunks.length)).toBe(true);
    expect(forwarded.every(message => new TextEncoder().encode(JSON.stringify(message)).byteLength <= 256 * 1024)).toBe(true);
    expect(onForwardOverflow).not.toHaveBeenCalled();
    observer.releaseTab(8);
  });

  it("retires an undeliverable HTTP body immediately instead of silently sending its suffix", async () => {
    const onForwardOverflow = vi.fn();
    const forward = vi.fn(async (_message: ChromeBridgeEnvelope) => {
      if (forward.mock.calls.length === 2) throw new Error("BRIDGE_PAYLOAD_TOO_LARGE");
    });
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward, onForwardOverflow });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.ingestHttpResponse(im, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
      JSON.stringify({ pad: "x".repeat(340_000) }), { method: "POST", currentDocumentConfirmed: true });
    expect(forward).toHaveBeenCalledTimes(2);
    expect(onForwardOverflow).toHaveBeenCalledOnce();
    observer.releaseTab(8);
  });

  it("validates one direct IM document once before forwarding all of its snapshot chunks", async () => {
    const largeBody = JSON.stringify({ StatusCode: 100,
      sel: Array.from({ length: 5_000 }, (_, index) => ({ eid: index + 1, pad: "x".repeat(80) })) });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } } : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.ingestHttpResponse(im, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch", largeBody, {
      method: "POST", providerPartition: "IM_MARKET_1", streamId: "im:8:1", reconcileCutoffSequence: 0,
      verifiedDocument: { frameId: "im-frame", loaderId: "im-document" }
    });

    expect(forward.mock.calls.length).toBeGreaterThan(1);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Page.getFrameTree")).toHaveLength(1);
  });

  it("keeps unverified direct HTTP diagnostic-only and never emits authority-bearing chunks", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: async (message) => { forwarded.push(message); }, now: () => 1_000, monotonicNow: () => 50 });
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:8", tabId: 8 } as const;

    await observer.ingestHttpResponse(bti, "https://sports.example/api/catalog", "Fetch",
      JSON.stringify({ rows: [{ pad: "x".repeat(230_000) }] }), { method: "GET" });
    expect(forwarded).toEqual([]);

    await observer.ingestHttpResponse(bti, "https://sports.example/api/catalog", "Fetch",
      JSON.stringify({ rows: [] }), { method: "GET" });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.request).toMatchObject({ method: "GET",
      observerRequestId: expect.stringMatching(/:request:\d+$/u) });
    expect(forwarded[0]!.request).not.toHaveProperty("requestFrameKey");
    expect(forwarded[0]!.request).not.toHaveProperty("requestDocumentKey");
  });

  it("queues every snapshot chunk before later delta traffic can interleave", async () => {
    const snapshot = JSON.stringify({ StatusCode: 100,
      sel: Array.from({ length: 5_000 }, (_, index) => ({ eid: index, pad: "x".repeat(80) })) });
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } };
      }
      if (method !== "Network.getResponseBody") return {};
      return { body: params?.requestId === "snapshot" ? snapshot : '{"StatusCode":100,"dc":[]}',
        base64Encoded: false };
    });
    const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => {
      forwarded.push(envelope);
      if (envelope.sequence === 0) await firstBlocked;
    }, now: () => 1_000, monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "snapshot",
      frameId: "im-frame", loaderId: "im-document",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "snapshot", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    const snapshotRead = observer.handleEvent(im, "Network.loadingFinished", { requestId: "snapshot" });
    await vi.waitFor(() => expect(forwarded).toHaveLength(1));
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "delta",
      frameId: "im-frame", loaderId: "im-document",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSEDelta" } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "delta", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSEDelta" } });
    const deltaRead = observer.handleEvent(im, "Network.loadingFinished", { requestId: "delta" });
    releaseFirst?.();
    await Promise.all([snapshotRead, deltaRead]);

    const paths = forwarded.map((envelope) => envelope.request.pathnameClass);
    const firstDelta = paths.indexOf("/api/EventV6/GetSEDelta");
    expect(firstDelta).toBeGreaterThan(1);
    expect(paths.slice(0, firstDelta).every((path) => path === "/api/EventV6/GetSE")).toBe(true);
  });

  it("enables bounded network observation and non-odds page discovery", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string, _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    await observer.start(source);
    expect(sendCommand).toHaveBeenCalledWith(7, "Network.enable", expect.objectContaining({
      maxTotalBufferSize: 16 * 1024 * 1024,
      maxResourceBufferSize: 12 * 1024 * 1024
    }));
    expect(sendCommand).toHaveBeenCalledWith(7, "Page.setLifecycleEventsEnabled", { enabled: true });
    expect(sendCommand).toHaveBeenCalledWith(7, "Target.setAutoAttach", {
      autoAttach: true, waitForDebuggerOnStart: true, flatten: true
    });
    const autoAttachCalls = sendCommand.mock.calls.filter(([, method]) => method === "Target.setAutoAttach");
    expect(autoAttachCalls.map(([, , params]) => params?.autoAttach)).toEqual([false, true]);
    const evaluateCall = sendCommand.mock.calls.find((call) => call[1] === "Runtime.evaluate");
    expect(evaluateCall?.[2]).toMatchObject({ returnByValue: true });
    expect(JSON.stringify(evaluateCall?.[2])).not.toMatch(/\.click\(|dispatchEvent|\[data-odds/iu);
  });

  it("replays APSPORT's sticky root runtime context after a worker restart", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:14", tabId: 14 } as const;

    await observer.start(apsport);

    const methods = sendCommand.mock.calls.map(([, method]) => method);
    expect(methods.indexOf("Runtime.disable")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("Runtime.disable")).toBeLessThan(methods.indexOf("Runtime.enable"));
    expect(methods.filter((method) => method === "Runtime.enable")).toHaveLength(1);
  });

  it("bounds every startup CDP command by the configured frame command timeout", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, method: string) => {
        if (method === "Target.setAutoAttach") return new Promise<never>(() => undefined);
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        frameCommandTimeoutMs: 10 });
      let outcome = "pending";
      void observer.start(source).then(
        () => { outcome = "resolved"; },
        (error: unknown) => { outcome = error instanceof Error ? error.message : "rejected"; }
      );

      await vi.advanceTimersByTimeAsync(11);

      expect(outcome).toBe("frame-command-timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { failure: "rejection", expected: "disable-rejected" },
    { failure: "timeout", expected: "frame-command-timeout" }
  ] as const)("does not mark a sticky-runtime tab started after Runtime.disable $failure", async ({ failure, expected }) => {
    vi.useFakeTimers();
    try {
      let disableAttempts = 0;
      const sendCommand = vi.fn(async (_tabId: number, method: string) => {
        if (method !== "Runtime.disable") return {};
        disableAttempts += 1;
        if (disableAttempts > 1) return {};
        if (failure === "rejection") throw new Error("disable-rejected");
        return new Promise<never>(() => undefined);
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        frameCommandTimeoutMs: 10 });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
      const first = observer.start(saba).then(
        () => "resolved",
        (error: unknown) => error instanceof Error ? error.message : "rejected"
      );
      if (failure === "timeout") await vi.advanceTimersByTimeAsync(11);

      expect(await first).toBe(expected);
      await observer.start(saba);

      expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.disable")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("enables and routes KSPORT sportsbook traffic from an OOPIF child CDP session", async () => {
    const sendCommand = vi.fn(async () => ({}));
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

    await observer.handleEvent(ksport, "Target.attachedToTarget", {
      sessionId: "sportsbook-child", targetInfo: { type: "iframe" }
    });
    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "socket-1", url: "wss://d42.sb21.net/sport/538/session/websocket"
    }, "sportsbook-child");
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "socket-1", response: { opcode: 1,
        payloadData: `a${JSON.stringify([ksportFullReceipt("live", 100)])}` }
    }, "sportsbook-child");

    expect(sendCommand).toHaveBeenCalledWith(8, "Network.enable", expect.any(Object), "sportsbook-child");
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.enable", {}, "sportsbook-child");
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "KSPORT", transport: "WS_FRAME",
      payload: expect.objectContaining({ body: expect.stringContaining("/topic/sports/1_1/live/") }) }));
  });

  it("enables SABA worker observation before releasing its paused bootstrap", async () => {
    const operations: string[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      _params?: Record<string, unknown>, sessionId?: string) => {
      if (sessionId === "saba-worker") operations.push(method);
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    await observer.handleEvent(saba, "Target.attachedToTarget", {
      sessionId: "saba-worker",
      targetInfo: { type: "worker", targetId: "saba-worker-target" }
    });

    expect(operations).toEqual(["Network.enable", "Runtime.enable", "Runtime.runIfWaitingForDebugger"]);
  });

  it("always releases a paused SABA worker when Network observation is unavailable", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      _params?: Record<string, unknown>, sessionId?: string) => {
      if (sessionId === "saba-worker" && method === "Network.enable") {
        throw new Error("Network domain unavailable");
      }
      if (method === "Target.getTargets") return { targetInfos: [] };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:8", tabId: 8 } as const;

    await observer.handleEvent(saba, "Target.attachedToTarget", {
      sessionId: "saba-worker",
      targetInfo: { type: "worker", targetId: "saba-worker-target" }
    });

    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.enable", {}, "saba-worker");
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.runIfWaitingForDebugger", {}, "saba-worker");
    await expect(observer.resetSabaSocketWorker(saba)).resolves.toBe(1);
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.evaluate", expect.objectContaining({
      expression: expect.stringContaining("self.close")
    }), "saba-worker");
  });

  it("observes and then releases an attached paused KSPORT worker target", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>,
      sessionId?: string) => {
      if (sessionId === "sportsbook-worker" && method === "Target.setAutoAttach") {
        throw new Error("WORKER_TARGET_PAUSE_COMMAND_UNSUPPORTED");
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

    await observer.handleEvent(ksport, "Target.attachedToTarget", {
      sessionId: "sportsbook-worker",
      targetInfo: { type: "worker", targetId: "sportsbook-worker-target" }
    });

    expect(sendCommand).toHaveBeenCalledWith(8, "Network.enable", expect.any(Object), "sportsbook-worker");
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.enable", {}, "sportsbook-worker");
    expect(sendCommand).not.toHaveBeenCalledWith(8, "Target.setAutoAttach", expect.any(Object), "sportsbook-worker");
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.runIfWaitingForDebugger", {}, "sportsbook-worker");
  });

  it("pauses new KSPORT child targets until network observation is armed", async () => {
    const sendCommand = vi.fn(async () => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

    await observer.start(ksport);

    expect(sendCommand).toHaveBeenCalledWith(8, "Target.setAutoAttach", {
      autoAttach: true, waitForDebuggerOnStart: true, flatten: true
    });
  });

  it("reconnects a pre-existing KSPORT socket owned by a dedicated worker", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (sessionId !== "sportsbook-worker") return {};
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("globalThis.WebSocket.prototype")) {
          return { result: { objectId: "worker-websocket-prototype" } };
        }
        if (method === "Runtime.queryObjects") return { objects: { objectId: "worker-websocket-instances" } };
        if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-worker",
        targetInfo: { type: "worker", targetId: "sportsbook-worker-target" }
      });
      await vi.advanceTimersByTimeAsync(8_001);

      expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.callFunctionOn", expect.objectContaining({
        objectId: "worker-websocket-instances",
        functionDeclaration: expect.stringContaining("socket.close(4000")
      }), "sportsbook-worker");
      expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  it("prioritizes a KSPORT socket worker before a slow page heap", async () => {
    vi.useFakeTimers();
    try {
      const blockedPageQuery = new Promise<never>(() => undefined);
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (sessionId === "sportsbook-worker") {
          if (method === "Runtime.evaluate" &&
            String(params?.expression).includes("globalThis.WebSocket.prototype")) {
            return { result: { objectId: "worker-websocket-prototype" } };
          }
          if (method === "Runtime.queryObjects") {
            return { objects: { objectId: "worker-websocket-instances" } };
          }
          if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
          return {};
        }
        if (method === "Runtime.evaluate" && params?.contextId === 91) {
          return { result: { objectId: "page-websocket-prototype" } };
        }
        if (method === "Runtime.queryObjects") return blockedPageQuery;
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        frameCommandTimeoutMs: 60_000 });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
      await observer.handleEvent(ksport, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "provider-page", isDefault: true } }
      });
      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-worker",
        targetInfo: { type: "worker", targetId: "sportsbook-worker-target" }
      });

      await vi.advanceTimersByTimeAsync(8_001);

      expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.callFunctionOn", expect.objectContaining({
        objectId: "worker-websocket-instances",
        functionDeclaration: expect.stringContaining("socket.close(4000")
      }), "sportsbook-worker");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([500, null])("keeps an existing KSPORT worker as fallback while honoring a page refusal: %s", async pageFailure => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      const expression = String(params?.expression ?? "");
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "provider-page", loaderId: "provider-document", url: "https://zenandfe.com/" } } };
      if (method === "Target.getTargets") return { targetInfos: [{
        targetId: "sportsbook-worker-target", type: "worker",
        url: "https://zenandfe.com/js/wk.js", attached: false
      }] };
      if (method === "Target.attachToTarget" && params?.targetId === "sportsbook-worker-target") {
        return { sessionId: "sportsbook-worker" };
      }
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        if (sessionId !== "sportsbook-worker") {
          return { result: { value: pageFailure === null
            ? { status: "fieldline-ksport-catalog-refresh-template-missing" }
            : { status: "fieldline-ksport-catalog-refresh-failed", timeRange: "live", code: pageFailure } } };
        }
        return { result: { value: { status: "catalog-requested", executionSurface: "WORKER",
          executionOrigin: "https://zenandfe.com", origin: "https://be.sb21.net", responses: [
            { timeRange: "live", url: "https://be.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
            { timeRange: "today", url: "https://be.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
          ] } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 1_000, monotonicNow: () => 50 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "provider-page", isDefault: true } }
    });

    await observer.refreshCatalog(ksport);

    expect(sendCommand).toHaveBeenCalledWith(8, "Target.attachToTarget", {
      targetId: "sportsbook-worker-target", flatten: true
    });
    const catalogEvaluations = sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh"));
    expect(catalogEvaluations.map((call) => call[3])).toEqual(pageFailure === null
      ? [undefined, "sportsbook-worker"] : [undefined]);
    expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(pageFailure === null ? 2 : 0);
    expect(await observer.sbobetRequestsPaused()).toBe(pageFailure !== null);
    expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
  });

  it("falls back to page-native KSPORT period requests when URL-only recovery loses authentication", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let observer!: NetworkObserver;
    let publishNativeCatalog!: () => Promise<void>;
    let publishedNativeCatalog = false;
    let nativePublishCount = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        if (!expression.includes("current-page-session")) return {};
        return { result: { value: { status: "catalog-requested", origin: "https://be.sb21.net",
          responses: [
            { timeRange: "live", url: "https://be.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
            { timeRange: "today", url: "https://be.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
          ] } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("const primary") &&
        expression.includes(".sport-type-group-item")) {
        return { result: { value: { status: "football-active" } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("sport-menu-tab")) {
        if (!publishedNativeCatalog) {
          publishedNativeCatalog = true;
          nativePublishCount += 1;
          queueMicrotask(() => { void publishNativeCatalog(); });
        }
        return { result: { value: { status: "time-tab-selected", step: "tab",
          groups: 1, scopes: 1, periods: 2 } } };
      }
      if (method === "Network.getResponseBody") {
        return { body: params?.requestId === "native-live" ? '[{"1":"Live","2":[]}]' :
          '[{"1":"Today","2":[]}]', base64Encoded: false };
      }
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "provider-page", loaderId: "provider-document" } } };
      }
      if (method === "Target.getTargets") return { targetInfos: [] };
      return {};
    });
    observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 10_000, monotonicNow: () => 50 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "provider-page", isDefault: true } }
    });
    publishNativeCatalog = async () => {
      for (const partition of ["live", "today"] as const) {
        const requestId = `native-${partition}`;
        const url = `https://be.sb21.net/api/v2/getEvent?agentId=4&sportId=1&sportType=1_1&timeRange=${partition}`;
        await observer.handleEvent(ksport, "Network.requestWillBeSent", { requestId, type: "Fetch",
          frameId: "provider-page", loaderId: "provider-document",
          request: { method: "GET", url, headers: { Authorization: "current-page-session" } } });
        await observer.handleEvent(ksport, "Network.responseReceived", { requestId, type: "Fetch",
          response: { url, status: 200 } });
        await observer.handleEvent(ksport, "Network.loadingFinished", { requestId });
      }
    };

    await observer.refreshCatalog(ksport);
    await observer.refreshCatalog(ksport);

    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("fieldline-ksport-catalog-refresh"))).toBe(true);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
      String(params?.expression).includes("current-page-session"))).toBe(true);
    expect(publishedNativeCatalog).toBe(true);
    expect(nativePublishCount).toBe(1);
    expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(4);
    expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
  });

  it("recursively observes a KSPORT OOPIF without changing browser network conditions", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        params?: Record<string, unknown>, sessionId?: string) => {
        if (sessionId !== "sportsbook-child") return {};
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-child",
        targetInfo: { type: "iframe", targetId: "sportsbook-target" }
      });

      expect(sendCommand).toHaveBeenCalledWith(8, "Target.setAutoAttach", {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true
      }, "sportsbook-child");
      expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.runIfWaitingForDebugger", {}, "sportsbook-child");

      await vi.advanceTimersByTimeAsync(9_201);

      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { lobby: "KSPORT" as const, sourceId: "chrome:KSPORT:18", tabId: 18 },
    { lobby: "TSPORT" as const, sourceId: "chrome:TSPORT:19", tabId: 19 }
  ])("never changes browser network conditions while recovering a pre-existing $lobby socket", async (provider) => {
    vi.useFakeTimers();
    try {
      const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
      const sendCommand = vi.fn(async (_tabId: number, _method: string,
        _params?: Record<string, unknown>, _sessionId?: string) => ({}));
      const observer = new NetworkObserver({ sendCommand, forward });

      await observer.start(provider);
      await vi.advanceTimersByTimeAsync(9_201);

      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
      expect(forward.mock.calls.some(([envelope]) => envelope.transport === "WS_FRAME")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers a pre-existing SABA socket without changing browser network conditions", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, _method: string,
        _params?: Record<string, unknown>, _sessionId?: string) => ({}));
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:20", tabId: 20 } as const;

      await observer.start(saba);
      await vi.advanceTimersByTimeAsync(9_201);

      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
      expect(sendCommand).toHaveBeenCalledWith(20, "Runtime.evaluate", expect.objectContaining({
        expression: "window.io && window.io.Socket && window.io.Socket.prototype",
        objectGroup: expect.stringMatching(/^fieldline-baseline-recovery-20-\d+$/u)
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("discovers an already-running SABA socket worker before reconnecting a root orphan", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Target.getTargets") return { targetInfos: [{
        targetId: "saba-worker-target", type: "worker",
        url: "", attached: false
      }] };
      if (method === "Target.attachToTarget" && params?.targetId === "saba-worker-target") {
        return { sessionId: "saba-worker-session" };
      }
      if (method === "Runtime.evaluate" && sessionId === "saba-worker-session" &&
        String(params?.expression).includes("globalThis.WebSocket.prototype")) {
        return { result: { objectId: "saba-worker-websocket-prototype" } };
      }
      if (method === "Runtime.queryObjects" && sessionId === "saba-worker-session") {
        return { objects: { objectId: "saba-worker-websocket-instances" } };
      }
      if (method === "Runtime.callFunctionOn" && sessionId === "saba-worker-session") {
        return { result: { value: 1 } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:24", tabId: 24 } as const;

    await observer.start(saba);
    sendCommand.mockClear();
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker",
      response: { opcode: 1, payloadData: "42[]" }
    });

    expect(sendCommand).toHaveBeenCalledWith(24, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "saba-worker-websocket-instances",
      functionDeclaration: expect.stringContaining("socket.close(4000")
    }), "saba-worker-session");
  });

  it("terminates only SABA socket workers before an attached hard reload", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Target.getTargets") return { targetInfos: [
        { targetId: "saba-worker-target", type: "worker",
          url: "blob:https://c0z0oa.bpd3a3fn.com/worker-id" },
        { targetId: "saba-frame-target", type: "iframe",
          url: "https://c0z0oa.bpd3a3fn.com/frame" }
      ] };
      if (method === "Target.attachToTarget" && params?.targetId === "saba-worker-target") {
        return { sessionId: "saba-worker-session" };
      }
      if (method === "Target.attachToTarget" && params?.targetId === "saba-frame-target") {
        return { sessionId: "saba-frame-session" };
      }
      if (method === "Runtime.evaluate" && sessionId === "saba-worker-session" &&
        String(params?.expression).includes("self.close")) return { result: { value: true } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:24", tabId: 24 } as const;

    await observer.start(saba);
    sendCommand.mockClear();
    await expect(observer.resetSabaSocketWorker(saba)).resolves.toBe(1);

    expect(sendCommand).toHaveBeenCalledWith(24, "Runtime.evaluate", expect.objectContaining({
      expression: expect.stringContaining("self.close")
    }), "saba-worker-session");
    expect(sendCommand).toHaveBeenCalledWith(24, "Target.closeTarget", {
      targetId: "saba-worker-target"
    });
    expect(sendCommand.mock.calls.some(([, method, params, sessionId]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("self.close") && sessionId === "saba-frame-session")).toBe(false);
  });

  it("closes a surviving SABA worker target even when Chrome refuses to attach its old session", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Target.getTargets") return { targetInfos: [
        { targetId: "surviving-saba-worker", type: "shared_worker",
          url: "blob:https://c0z0oa.bpd3a3fn.com/worker-id" },
        { targetId: "other-worker", type: "worker", url: "blob:https://example.com/worker-id" }
      ] };
      if (method === "Target.attachToTarget") throw new Error("Already attached");
      if (method === "Target.closeTarget" && params?.targetId === "surviving-saba-worker") {
        return { success: true };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:24", tabId: 24 } as const;

    await observer.start(saba);
    sendCommand.mockClear();

    await expect(observer.resetSabaSocketWorker(saba)).resolves.toBe(1);
    expect(sendCommand).toHaveBeenCalledWith(24, "Target.closeTarget", {
      targetId: "surviving-saba-worker"
    });
    expect(sendCommand).not.toHaveBeenCalledWith(24, "Target.closeTarget", {
      targetId: "other-worker"
    });
  });

  it("uses an attached KSPORT OOPIF session for targeted socket recovery", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        _params?: Record<string, unknown>, _sessionId?: string) => {
        if (method === "Target.getTargets") return { targetInfos: [{ targetId: "sportsbook-target",
          type: "iframe", url: "https://d42.sb21.net/sport/538/session" }] };
        if (method === "Target.attachToTarget") return { sessionId: "sportsbook-child" };
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:21", tabId: 21 } as const;

      await observer.start(ksport);
      await vi.advanceTimersByTimeAsync(9_201);

      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
      expect(sendCommand).toHaveBeenCalledWith(21, "Runtime.evaluate", expect.objectContaining({
        expression: "globalThis.WebSocket && globalThis.WebSocket.prototype",
        objectGroup: "fieldline-baseline-recovery-21"
      }), "sportsbook-child");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops pre-existing socket retries after the first forwarded WS frame", async () => {
    vi.useFakeTimers();
    try {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, _method: string,
        _params?: Record<string, unknown>, _sessionId?: string) => ({}));
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:22", tabId: 22 } as const;

      await observer.start(ksport);
      await vi.advanceTimersByTimeAsync(9_201);
      await observer.handleEvent(ksport, "Network.webSocketCreated", {
        requestId: "event-socket", url: "wss://d42.sb21.net/sport/538/session/websocket"
      });
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "event-socket", response: { opcode: 1,
          payloadData: `a${JSON.stringify([ksportFullReceipt("live", 100)])}` }
      });
      await vi.advanceTimersByTimeAsync(90_000);

      expect(forwarded.some((envelope) => envelope.transport === "WS_FRAME")).toBe(true);
      expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.releaseObjectGroup" &&
        params?.objectGroup === "fieldline-baseline-recovery-22")).toHaveLength(1);
      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off pre-existing socket retries, caps them at five, and resets for a new source generation", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, _method: string,
        _params?: Record<string, unknown>, _sessionId?: string) => ({}));
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:23", tabId: 23 } as const;
      const reconnectCount = (): number => sendCommand.mock.calls.filter(([, method]) =>
        method === "Runtime.releaseObjectGroup").length;

      await observer.start(ksport);
      await vi.advanceTimersByTimeAsync(9_201);
      expect(reconnectCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(reconnectCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(reconnectCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(3 * 61_200 + 120_000);
      expect(reconnectCount()).toBe(5);

      observer.releaseTab(ksport.tabId);
      await observer.start(ksport);
      await vi.advanceTimersByTimeAsync(9_201);
      expect(reconnectCount()).toBe(6);
      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discovers an already-running KSPORT OOPIF when auto-attach emits no child event", async () => {
    vi.useFakeTimers();
    try {
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        params?: Record<string, unknown>, sessionId?: string) => {
        if (method === "Target.getTargets") return { targetInfos: [{
          targetId: "sportsbook-target", type: "iframe",
          url: "https://d42.sb21.net/sport/538/session"
        }] };
        if (method === "Target.attachToTarget") return { sessionId: "sportsbook-child" };
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
      const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

      await observer.start(ksport);

      expect(sendCommand).toHaveBeenCalledWith(8, "Target.attachToTarget", {
        targetId: "sportsbook-target", flatten: true
      });
      expect(sendCommand).toHaveBeenCalledWith(8, "Network.enable", expect.any(Object), "sportsbook-child");

      await vi.advanceTimersByTimeAsync(9_201);

      expect(sendCommand.mock.calls.some(([, method]) => method === "Network.emulateNetworkConditions"))
        .toBe(false);
      expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.evaluate", expect.objectContaining({
        expression: "globalThis.WebSocket && globalThis.WebSocket.prototype",
        objectGroup: "fieldline-baseline-recovery-8"
      }), "sportsbook-child");
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects KSPORT's main Football group on attach without touching an odds control", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

    await observer.start(ksport);

    const evaluation = sendCommand.mock.calls.find(([, method]) => method === "Runtime.evaluate")?.[2];
    const expression = String(evaluation?.expression);
    expect(expression).toContain(".sport-type-group-item");
    expect(expression).toContain("active-type");
    expect(expression).toContain("control.click()");
    expect(expression).toContain("sport-odds-boosts");
    expect(expression).not.toContain(".c-odds");
  });

  it("does not re-enable debugger network buffers for an already started tab", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string, _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    await observer.start(source);
    await observer.start(source);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Network.enable")).toHaveLength(1);
  });

  it("releases request, socket and replay caches when an attached tab goes away", async () => {
    const snapshot = JSON.stringify({ StatusCode: 100, sel: [{ eid: 1, htn: "Alpha", atn: "Beta" }] });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: snapshot, base64Encoded: false }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.start(im);
    await observer.handleEvent(im, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://imsports.directsb.net/feed"
    });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "snapshot", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "snapshot" });

    await observer.stop(im);
    forward.mockClear();
    expect(await observer.replaySnapshots(im.sourceId)).toBe(false);
    expect(forward).not.toHaveBeenCalled();
    expect(sendCommand).toHaveBeenCalledWith(8, "Network.disable", {});
  });

  it("fences a request identity when releaseTab happens before response and completion events", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: "{\"StatusCode\":100,\"sel\":[]}", base64Encoded: false }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "released-request",
      frameId: "frame-a", loaderId: "loader-a",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    observer.releaseTab(im.tabId);
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "released-request", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.loadingFinished", { requestId: "released-request" });

    expect(sendCommand).not.toHaveBeenCalledWith(8, "Network.getResponseBody", expect.anything());
    expect(forward).not.toHaveBeenCalled();
  });

  it("fences an already-awaiting response body when releaseTab retires its tab lifetime", async () => {
    let releaseBody!: () => void;
    const bodyBlocked = new Promise<void>((resolve) => { releaseBody = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "frame-a", loaderId: "loader-a" } } };
      }
      if (method === "Network.getResponseBody") {
        await bodyBlocked;
        return { body: "{\"StatusCode\":100,\"sel\":[]}", base64Encoded: false };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Network.requestWillBeSent", { requestId: "awaiting-request",
      frameId: "frame-a", loaderId: "loader-a",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "awaiting-request", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });

    const loading = observer.handleEvent(im, "Network.loadingFinished", { requestId: "awaiting-request" });
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(8, "Network.getResponseBody",
      { requestId: "awaiting-request" }));
    observer.releaseTab(im.tabId);
    releaseBody();
    await loading;

    expect(forward).not.toHaveBeenCalled();
  });

  it("forgets failed response requests instead of retaining them indefinitely", async () => {
    const sendCommand = vi.fn(async () => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "failed", type: "XHR",
      response: { url: "https://sports.example/catalog" } });
    await observer.handleEvent(source, "Network.loadingFailed", { requestId: "failed" });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "failed" });
    expect(sendCommand).not.toHaveBeenCalledWith(7, "Network.getResponseBody", expect.anything());
  });

  it("drops an oversized frame without disrupting later frames", async () => {
    const genericSocketSource = { lobby: "SBO", sourceId: "chrome:SBO:7", tabId: 7 } as const;
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward });
    await observer.handleEvent(genericSocketSource, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://sports.example/feed" });
    await observer.handleEvent(genericSocketSource, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "x".repeat(262_145) }
    });
    await observer.handleEvent(genericSocketSource, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 2, payloadData: "YWJj" }
    });
    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1,
      transport: "WS_FRAME", payload: { encoding: "BASE64", body: "YWJj" } }));
  });

  it("serializes concurrent frames from one source without duplicating sequence numbers", async () => {
    const genericSocketSource = { lobby: "SBO", sourceId: "chrome:SBO:7", tabId: 7 } as const;
    let releaseFirst: (() => void) | undefined;
    const firstForwarded = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const forwarded: number[] = [];
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})),
      forward: async (envelope) => {
        forwarded.push(envelope.sequence);
        if (envelope.sequence === 1) await firstForwarded;
      }
    });
    await observer.handleEvent(genericSocketSource, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://sports.example/feed"
    });

    const first = observer.handleEvent(genericSocketSource, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "{\"price\":1.9}" }
    });
    const second = observer.handleEvent(genericSocketSource, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "{\"price\":2.1}" }
    });

    await Promise.resolve();
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(forwarded).toEqual([0, 1, 2]);
  });

  it("renews an unchanged CMD catalog before backend freshness expires", async () => {
    const publicRecords = JSON.stringify([{ sportId: "1", leagueId: "league-1", leagueName: "League",
      matchId: "match-1", timeText: "TRá»°C TIáº¾P", teamNames: ["Alpha", "Beta"], groups: [] }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { type: "string", value: publicRecords } }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => 50 });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com");
    now = 11_000;
    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com");

    expect(forward).toHaveBeenCalledTimes(2);
    const sent = forward.mock.calls[0]![0];
    const chunk = JSON.parse(sent.payload.body);
    expect(sent).toEqual(expect.objectContaining({
      transport: "DOM_SNAPSHOT",
      request: { hostname: "cgnew.fts368.com", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: expect.objectContaining({ encoding: "UTF8" })
    }));
    expect(chunk).toMatchObject({ schemaVersion: 2, chunkIndex: 0, chunkCount: 1,
      records: JSON.parse(publicRecords) });
    expect(JSON.stringify(forward.mock.calls)).not.toMatch(/token|cookie|authorization/iu);
  });

  it("replays the last complete CMD snapshot after the loopback API reconnects", async () => {
    const records = [{ sportId: "1", leagueId: "league-1", leagueName: "League",
      matchId: "match-1", timeText: "LIVE", teamNames: ["Alpha", "Beta"], groups: [{
        betTypeIds: ["1"], labels: ["0.5"], odds: [
          { marketOddsId: "m-1", priceText: "0.91", lineText: "0.5" },
          { marketOddsId: "m-1", priceText: "-0.99" }
        ]
      }] }];
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { type: "string", value: JSON.stringify(records) } }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => 50 });
    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 }, "cgnew.fts368.com");

    forward.mockClear();
    now = 2_000;
    await observer.replaySnapshots();

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0]![0]).toMatchObject({
      sourceId: "chrome:CMD:9", sequence: 1, observedAtMs: 1_000, transport: "DOM_SNAPSHOT",
      request: expect.objectContaining({ replayed: true })
    });
    expect(JSON.parse(forward.mock.calls[0]![0].payload.body).records).toEqual(records);
  });

  it("does not replace the replayable CMD catalog with a transient event-shell snapshot", async () => {
    const complete = [{ sportId: "1", leagueId: "league-1", leagueName: "League",
      matchId: "match-1", timeText: "LIVE", teamNames: ["Alpha", "Beta"], groups: [{
        betTypeIds: ["1"], labels: ["0.5"], odds: [
          { marketOddsId: "m-1", priceText: "0.91", lineText: "0.5" },
          { marketOddsId: "m-1", priceText: "-0.99" }
        ]
      }] }];
    const shell = [{ ...complete[0], groups: [] }];
    let evaluated: unknown[] = complete;
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { type: "string", value: JSON.stringify(evaluated) } }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    const source = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");
    evaluated = shell;
    await observer.captureCmdSnapshot(source, "cgnew.fts368.com");

    forward.mockClear();
    await observer.replaySnapshots();

    expect(JSON.parse(forward.mock.calls[0]![0].payload.body).records).toEqual(complete);
  });

  it("replays the last complete IM GetSE snapshot before later deltas after reconnect", async () => {
    const snapshot = JSON.stringify({ StatusCode: 100, sel: [{ eid: 1, htn: "Alpha", atn: "Beta" }] });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: snapshot, base64Encoded: false }
      : method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } }
        : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "snapshot",
      frameId: "im-frame", loaderId: "im-document",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE",
        postData: JSON.stringify({ SportId: 1, Market: 2 }) } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "snapshot", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "snapshot" });

    forward.mockClear();
    now = 2_000;
    await observer.replaySnapshots();

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0]![0]).toMatchObject({ sourceId: "chrome:IM:8", sequence: 1,
      observedAtMs: 1_000, transport: "HTTP_RESPONSE",
      request: { hostname: "imsports.directsb.net", pathnameClass: "/api/EventV6/GetSE", resourceType: "XHR",
        providerPartition: "IM_MARKET_2", replayed: true } });
    expect(forward.mock.calls[0]![0].payload.body).toBe(snapshot);
  });

  it("retains both IM partitions even when their response bodies are identical", async () => {
    const snapshot = JSON.stringify({ StatusCode: 100, sel: [] });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: snapshot, base64Encoded: false }
      : method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } }
        : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    for (const market of [1, 2] as const) {
      const requestId = `snapshot-${market}`;
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId,
        frameId: "im-frame", loaderId: "im-document",
        request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE",
          postData: JSON.stringify({ SportId: 1, Market: market }) } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "XHR",
        response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
      await observer.handleEvent(source, "Network.loadingFinished", { requestId });
    }
    forward.mockClear();

    await observer.replaySnapshots(source.sourceId);

    expect(forward).toHaveBeenCalledTimes(2);
    expect(new Set(forward.mock.calls.map(([message]) => message.request.providerPartition)))
      .toEqual(new Set(["IM_MARKET_1", "IM_MARKET_2"]));
  });

  it("replays retained T-Sports football event frames after the local API restarts", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => now, monotonicNow: () => 60 });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:10", tabId: 10 } as const;
    const socketUrl = "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0";
    const body = JSON.stringify({ s: 1, t: "eu", d: JSON.stringify({ "2": 5557168, "5": "Home" }) });
    await observer.handleEvent(tsport, "Network.webSocketCreated", { requestId: "ws-1", url: socketUrl });
    await observer.handleEvent(tsport, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: body }
    });
    forward.mockClear();
    now = 2_000;

    await observer.replaySnapshots(tsport.sourceId);

    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0]![0]).toMatchObject({ lobby: "TSPORT", sourceId: tsport.sourceId,
      observedAtMs: 1_000, transport: "WS_FRAME", request: expect.objectContaining({ replayed: true }),
      payload: { encoding: "UTF8", body } });
  });

  it.each([
    { lobby: "SABA" as const, sourceId: "chrome:SABA:13", url: "wss://sports.example/socket.io/",
      bodies: [
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]], [0, "reset"],
          [0, "o"], [0, "done"]], "r1"])}`,
        `42${JSON.stringify(["m", "b1", [[0, "o", 1, 2]], "r2"])}`
      ] },
    { lobby: "KSPORT" as const, sourceId: "chrome:KSPORT:14", url: "wss://d42.sb21.net/sport/socket",
      bodies: [
        ksportFullReceipt("live", 100),
        ksportFullReceipt("today", 104)
      ] }
    ,{ lobby: "SBO" as const, sourceId: "chrome:SBO:15", url: "wss://sports.example/socket.io/",
      bodies: [
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 1, ["matchid"]]], 1])}`,
        `42${JSON.stringify(["m", "b1", [[0, "m", 1, 99]], 2])}`
      ] }
  ])("replays retained $lobby baseline and deltas after only the local API restarts", async (input) => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => now, monotonicNow: () => now / 10 });
    const observed = { lobby: input.lobby, sourceId: input.sourceId, tabId: 13 } as const;
    for (const body of input.bodies) {
      await observer.ingestWebSocketFrame(observed, input.url, body);
      now += 100;
    }
    forward.mockClear();
    now = 120_000;

    await observer.replaySnapshots(input.sourceId);

    expect(forward.mock.calls.map(([message]) => message.payload.body)).toEqual(input.bodies);
    expect(forward.mock.calls.every(([message]) => message.request.replayed === true)).toBe(true);
    expect(forward.mock.calls.map(([message]) => message.observedAtMs)).toEqual([1_000, 1_100]);
  });

  it("accounts retained catalog websocket usage without rescanning full history on every append", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), now: () => 1_000, monotonicNow: () => 60 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/socket";
    const nativeValues = Map.prototype.values;
    let mapHistoryScans = 0;
    const valuesSpy = vi.spyOn(Map.prototype, "values").mockImplementation(function <K, V>(this: Map<K, V>) {
      mapHistoryScans += 1;
      return nativeValues.call(this);
    });

    try {
      for (let index = 0; index < 32; index += 1) {
        await observer.ingestWebSocketFrame(ksport, url, ksportFullReceipt("live", 100 + index));
      }
    } finally {
      valuesSpy.mockRestore();
    }

    expect(mapHistoryScans).toBeLessThanOrEqual(2);
  });

  it("recovers a SABA baseline after worker restart by reconnecting its page-owned socket", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.io.Socket.prototype")) return { result: { objectId: "prototype-1" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-1" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "sports-frame", isDefault: true } } });
    sendCommand.mockClear();

    await observer.refreshCatalog(saba);

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
    await settleObserverBackgroundTasks();
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(true);
    expect(sendCommand.mock.calls.find(([, method]) => method === "Runtime.callFunctionOn")?.[2])
      .toMatchObject({ functionDeclaration: expect.stringContaining("socket.disconnect(); socket.connect()") });
  });

  it("re-arms debugger observation before a replacement SABA document starts", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>, _sessionId?: string) => ({}));
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined) });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:24", tabId: 24 } as const;
    await observer.start(saba);
    sendCommand.mockClear();

    observer.prepareSourceNavigation(saba.sourceId);
    await observer.start(saba);

    expect(sendCommand.mock.calls.some(([, method]) => method === "Network.enable")).toBe(true);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Target.setAutoAttach" &&
      params?.autoAttach === true && params?.waitForDebuggerOnStart === true)).toBe(true);
  });

  it("does not block SABA DOM renewal behind a slow socket heap query", async () => {
    let resolveQuery!: (value: unknown) => void;
    const query = new Promise<unknown>((resolve) => { resolveQuery = resolve; });
    let queryCount = 0;
    let now = 1_000;
    const records = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `over-${index}`, priceText: "0.91" },
          { marketOddsId: `under-${index}`, priceText: "0.99" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "today-tab-active" } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("fieldline-saba-odds-mutation")) {
        return { result: { value: true } };
      }
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: records } };
      }
      if (method === "Runtime.evaluate" && (expression.includes("window.io.Socket.prototype") ||
        expression.includes("window.WebSocket.prototype"))) {
        return { result: { objectId: "slow-saba-prototype" } };
      }
      if (method === "Runtime.queryObjects") {
        queryCount += 1;
        return query;
      }
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now,
      monotonicNow: () => now, frameCommandTimeoutMs: 10 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    const refresh = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(queryCount).toBe(1));
    let refreshResolved = false;
    void refresh.then(() => { refreshResolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      expect(refreshResolved).toBe(true);
      forward.mockClear();
      now = 6_000;
      await observer.pollSabaDomChanges(saba, "sports.example");
      expect(forward).toHaveBeenCalledWith(expect.objectContaining({
        lobby: "SABA", transport: "DOM_SNAPSHOT"
      }));
      expect(queryCount).toBe(1);
    } finally {
      resolveQuery({ objects: { objectId: "slow-saba-instances" } });
      await refresh;
    }
  });

  it("waits for one slow SABA heap query instead of timing out and starting overlapping scans", async () => {
    let resolveQuery!: (value: unknown) => void;
    const query = new Promise<unknown>((resolve) => { resolveQuery = resolve; });
    let queryCount = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        (params.expression.includes("window.io.Socket.prototype") ||
          params.expression.includes("window.WebSocket.prototype"))) {
        return { result: { objectId: "slow-saba-prototype" } };
      }
      if (method === "Runtime.queryObjects") {
        queryCount += 1;
        return query;
      }
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const now = { value: 1_000 };
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now.value, monotonicNow: () => 60, frameCommandTimeoutMs: 10 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "sports-frame", isDefault: true } } });

    const first = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(queryCount).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const scansAfterGenericTimeout = queryCount;
    now.value = 7_000;
    const queuedOrphan = observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "surviving-saba-socket", response: { opcode: 1, payloadData: "2" }
    });
    resolveQuery({ objects: { objectId: "slow-saba-instances" } });
    await Promise.all([first, queuedOrphan]);

    expect(scansAfterGenericTimeout).toBe(1);
    expect(queryCount).toBe(1);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn"))
      .toEqual([expect.arrayContaining([13, "Runtime.callFunctionOn", expect.objectContaining({
        objectId: "slow-saba-instances"
      })])]);
  });

  it("releases a SABA heap object group when its source epoch retires during the query", async () => {
    let resolveQuery!: (value: unknown) => void;
    const query = new Promise<unknown>((resolve) => { resolveQuery = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.io.Socket.prototype")) {
        return { result: { objectId: "retired-saba-prototype" } };
      }
      if (method === "Runtime.queryObjects") return query;
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60, frameCommandTimeoutMs: 10 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "sports-frame", isDefault: true } } });
    const recovery = observer.refreshCatalog(saba);
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method]) =>
      method === "Runtime.queryObjects")).toBe(true));

    observer.beginSourceEpoch(saba.sourceId);
    resolveQuery({ objects: { objectId: "retired-saba-instances" } });
    await recovery;

    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.releaseObjectGroup", {
      objectGroup: expect.stringMatching(/^fieldline-baseline-recovery-13-\d+$/u)
    }));

    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.callFunctionOn")).toBe(false);
  });

  it("bounds SABA heap cleanup when the query fails and object-group release never settles", async () => {
    vi.useFakeTimers();
    try {
      let releaseStarted = false;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
          (params.expression.includes("window.io.Socket.prototype") ||
            params.expression.includes("window.WebSocket.prototype"))) {
          return { result: { objectId: "saba-prototype" } };
        }
        if (method === "Runtime.queryObjects") throw new Error("query-failed");
        if (method === "Runtime.releaseObjectGroup") {
          releaseStarted = true;
          return new Promise<never>(() => undefined);
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        now: () => 1_000, monotonicNow: () => 60, frameCommandTimeoutMs: 10 });
      const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
      await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 17,
        auxData: { frameId: "sports-frame", isDefault: true } } });
      let outcome = "pending";
      void observer.refreshCatalog(saba).then(
        () => { outcome = "resolved"; },
        () => { outcome = "rejected"; }
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(releaseStarted).toBe(true);
      await vi.advanceTimersByTimeAsync(11);

      expect(outcome).toBe("resolved");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets sticky SABA Runtime before auto-attach so the replayed child context owns orphan recovery", async () => {
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    let observer!: NetworkObserver;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      if (method === "Runtime.disable" && sessionId === undefined) {
        await observer.handleEvent(saba, "Runtime.executionContextsCleared", {});
      }
      if (method === "Runtime.enable" && sessionId === undefined) {
        await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 70,
          auxData: { frameId: "root", isDefault: true } } });
      }
      if (method === "Target.setAutoAttach" && params?.autoAttach === true) {
        await observer.handleEvent(saba, "Target.attachedToTarget", {
          sessionId: "saba-child", targetInfo: { type: "iframe" }
        });
      }
      if (method === "Runtime.enable" && sessionId === "saba-child") {
        await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 71,
          auxData: { frameId: "football-child", isDefault: true } } }, "saba-child");
      }
      if (method === "Runtime.evaluate" && sessionId === "saba-child" && params?.contextId === 71 &&
        typeof params.expression === "string" && params.expression.includes("window.WebSocket.prototype")) {
        return { result: { objectId: "child-websocket-prototype" } };
      }
      if (method === "Runtime.queryObjects" && sessionId === "saba-child") {
        return { objects: { objectId: "child-websocket-instances" } };
      }
      if (method === "Runtime.callFunctionOn" && sessionId === "saba-child") {
        return { result: { value: 1 } };
      }
      return {};
    });
    observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });

    await observer.start(saba);
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "surviving-child-socket",
      response: { opcode: 1, payloadData: "2" }
    }, "saba-child");

    const rootMethods = sendCommand.mock.calls.filter(([, , , sessionId]) => sessionId === undefined)
      .map(([, method]) => method);
    expect(rootMethods.indexOf("Runtime.disable")).toBeLessThan(rootMethods.indexOf("Runtime.enable"));
    expect(rootMethods.indexOf("Runtime.enable")).toBeLessThan(rootMethods.indexOf("Target.setAutoAttach"));
    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "child-websocket-instances",
      functionDeclaration: expect.stringContaining("socket.close(4000")
    }), "saba-child");
    expect(rootMethods).not.toContain("Page.reload");
  });

  it("replays sticky KSPORT root contexts and reconnects its same-process sportsbook frame", async () => {
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    let observer!: NetworkObserver;
    let runtimeReset = false;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      if (method === "Runtime.disable" && sessionId === undefined) {
        runtimeReset = true;
        await observer.handleEvent(ksport, "Runtime.executionContextsCleared", {});
      }
      if (method === "Runtime.enable" && sessionId === undefined && runtimeReset) {
        await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 72,
          auxData: { frameId: "sportsbook-frame", isDefault: true } } });
      }
      if (method === "Runtime.evaluate" && params?.contextId === 72 &&
        String(params.expression).includes("WebSocket.prototype")) {
        return { result: { objectId: "sportsbook-websocket-prototype" } };
      }
      if (method === "Runtime.queryObjects" && params?.prototypeObjectId === "sportsbook-websocket-prototype") {
        return { objects: { objectId: "sportsbook-websocket-instances" } };
      }
      if (method === "Runtime.callFunctionOn" && params?.objectId === "sportsbook-websocket-instances") {
        return { result: { value: 1 } };
      }
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-template-missing" } } };
      }
      return {};
    });
    observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });

    await observer.start(ksport);
    sendCommand.mockClear();
    await observer.refreshCatalog(ksport);

    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.evaluate", expect.objectContaining({
      contextId: 72, expression: expect.stringContaining("WebSocket.prototype")
    }));
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "sportsbook-websocket-instances",
      functionDeclaration: expect.stringContaining("socket.close(4000")
    }));
    const rootMethods = sendCommand.mock.calls.filter(([, , , sessionId]) => sessionId === undefined)
      .map(([, method]) => method);
    expect(runtimeReset).toBe(true);
    expect(rootMethods).not.toContain("Page.reload");
  });

  it("retries a missed SABA orphan reconnect after thirty seconds without a frame-driven storm", async () => {
    const now = { value: 1_000 };
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>, _sessionId?: string) => {
      if (_method === "Runtime.evaluate" && String(_params?.expression).includes("Socket.prototype")) {
        return { result: { objectId: "socket-prototype" } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now.value, monotonicNow: () => now.value });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    const orphan = () => observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "surviving-socket", response: { opcode: 1, payloadData: "2" }
    }, "saba-child");
    const attempts = () => sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.evaluate" && params?.expression ===
        "window.io && window.io.Socket && window.io.Socket.prototype").length;

    await orphan();
    expect(attempts()).toBe(1);
    await orphan();
    now.value = 5_999;
    await orphan();
    expect(attempts()).toBe(1);

    now.value = 6_000;
    await orphan();
    expect(attempts()).toBe(1);
    now.value = 31_000;
    await orphan();
    expect(attempts()).toBe(2);
  });

  it("reconnects a SABA orphan in its owning child session when no context event was replayed", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Runtime.evaluate" && sessionId === "saba-child" &&
        typeof params?.expression === "string" && params.expression.includes("window.WebSocket.prototype")) {
        return { result: { objectId: "child-websocket-prototype" } };
      }
      if (method === "Runtime.queryObjects" && sessionId === "saba-child") {
        return { objects: { objectId: "child-websocket-instances" } };
      }
      if (method === "Runtime.callFunctionOn" && sessionId === "saba-child") {
        return { result: { value: 1 } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "root", isDefault: true } } });
    sendCommand.mockClear();

    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker",
      response: { opcode: 1, payloadData: "42[]" }
    }, "saba-child");

    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "child-websocket-instances",
      functionDeclaration: expect.stringContaining("socket.close(4000")
    }), "saba-child");
  });

  it("reconnects a root-attributed SABA orphan through its attached socket worker", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Runtime.evaluate" && sessionId === "saba-socket-worker" &&
        typeof params?.expression === "string" && params.expression.includes("globalThis.WebSocket.prototype")) {
        return { result: { objectId: "worker-websocket-prototype" } };
      }
      if (method === "Runtime.queryObjects" && sessionId === "saba-socket-worker") {
        return { objects: { objectId: "worker-websocket-instances" } };
      }
      if (method === "Runtime.callFunctionOn" && sessionId === "saba-socket-worker") {
        return { result: { value: 1 } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Target.attachedToTarget", {
      sessionId: "saba-socket-worker",
      targetInfo: { type: "worker", targetId: "saba-socket-worker-target" }
    });
    sendCommand.mockClear();

    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker",
      response: { opcode: 1, payloadData: "42[]" }
    });

    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "worker-websocket-instances",
      functionDeclaration: expect.stringContaining("socket.close(4000")
    }), "saba-socket-worker");
  });

  it("requests one bounded APSPORT tab renewal when its sockets predate the worker", async () => {
    const now = { value: 10_000 };
    const renew = vi.fn(async () => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), onApsportOrphanSocket: renew,
      now: () => now.value, monotonicNow: () => now.value });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:14", tabId: 14 } as const;
    const orphan = () => observer.handleEvent(apsport, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker", response: { opcode: 1, payloadData: "{}" }
    });

    await orphan();
    observer.beginSourceEpoch(apsport.sourceId);
    await orphan();
    now.value = 39_999;
    await orphan();
    expect(renew).toHaveBeenCalledExactlyOnceWith(apsport, expect.objectContaining({ isCurrent: expect.any(Function) }));

    now.value = 40_000;
    await orphan();
    expect(renew).toHaveBeenCalledTimes(2);

    await observer.handleEvent(apsport, "Network.webSocketCreated", {
      requestId: "current-football-socket", url: "wss://spws.agenate.com/ln/en/s/1/mg/1/tr/0"
    });
    now.value = 70_000;
    await orphan();
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("does not restart APSPORT again while a replacement document is still establishing its roster", async () => {
    const now = { value: 10_000 };
    const renew = vi.fn(async () => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), onApsportOrphanSocket: renew,
      now: () => now.value, monotonicNow: () => now.value });
    const apsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:14", tabId: 14 } as const;
    const orphan = () => observer.handleEvent(apsport, "Network.webSocketFrameReceived", {
      requestId: "socket-from-retired-document", response: { opcode: 1, payloadData: "{}" }
    });

    observer.prepareSourceNavigation(apsport.sourceId);
    await orphan();
    now.value = 69_999;
    await orphan();
    expect(renew).not.toHaveBeenCalled();

    now.value = 70_000;
    await orphan();
    expect(renew).toHaveBeenCalledExactlyOnceWith(apsport, expect.objectContaining({ isCurrent: expect.any(Function) }));
  });

  it("reconnects SABA's native Socket.IO transport when window.io is not global", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.WebSocket.prototype")) {
        return { result: { objectId: "native-websocket-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "native-websockets" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method]) =>
      method === "Runtime.callFunctionOn")).toBe(true));

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(true);
    expect(sendCommand.mock.calls.find(([, method]) => method === "Runtime.callFunctionOn")?.[2])
      .toMatchObject({ functionDeclaration: expect.stringContaining("/\\/socket\\.io\\/?$/u") });
    expect(sendCommand).not.toHaveBeenCalledWith(13, "Page.reload", expect.anything());
  });

  it("selects SABA Hôm Nay before requesting a recovery snapshot", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "today-tab-selected" } } };
      }
      if (method === "Runtime.evaluate") return { result: { value: "1787250000000.5" } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      typeof params?.expression === "string" && params.expression.includes("fieldline-saba-time-baseline"))).toBe(true);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      typeof params?.expression === "string" && params.expression.includes(".menu-item"))).toBe(true);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      typeof params?.expression === "string" &&
      params.expression.includes("fieldline-saba-sports-scope") &&
      params.expression.includes(".c-side-nav__header"))).toBe(true);
    const sabaBaselineExpression = sendCommand.mock.calls.find(([, method, params]) =>
      method === "Runtime.evaluate" && typeof params?.expression === "string" &&
      params.expression.includes("fieldline-saba-time-baseline"))?.[2]?.expression;
    expect(() => new Function(`return ${String(sabaBaselineExpression)}`)).not.toThrow();
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toBe(false);
    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(false);
  });

  it("does not replay stale SABA socket history into the sequenced bridge before a fresh Today selection", async () => {
    const body = '42["m","b1",[["f",0,["type","matchid"]],[0,"reset"],[0,"m",1,55],[0,"done"]],"r1"]';
    const loadSabaWsSnapshots = vi.fn(async (): Promise<PersistedSabaWsSnapshots> => ({
      version: 1, sourceId: "chrome:SABA:13", documentMarker: "1787250000000.5",
      partitions: [{ partition: "1:b1", frames: [{ url: "wss://sports.example/socket.io/", body,
        streamId: "1", observedAtMs: 9_000, receivedMonotonicMs: 50 }] }]
    }));
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "today-tab-selected" } } };
      }
      if (method === "Runtime.evaluate" && params?.expression === "String(performance.timeOrigin)") {
        return { result: { value: "1787250000000.5" } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward, loadSabaWsSnapshots,
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    expect(loadSabaWsSnapshots).toHaveBeenCalledExactlyOnceWith(saba.sourceId);
    expect(forward.mock.calls.map(([message]) => message).filter((message) =>
      message.transport === "WS_FRAME" && message.payload.body === body)).toHaveLength(0);
  });

  it("falls through to the socket reconnect when SABA Hôm Nay is already active", async () => {
    // Clicking a period tab that is already active is not a page selection the
    // provider answers with reset/done. Treating it as one returned early and
    // skipped the reconnect that actually reseeds the lane, costing the first
    // recovery of every source one extra starvation window.
    let selections = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        selections += 1;
        return { result: { value: { status: "today-tab-reselected" } } };
      }
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.WebSocket.prototype")) {
        return { result: { objectId: "native-websocket-prototype" } };
      }
      if (method === "Runtime.evaluate") return { result: { value: "1787250000000.5" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "native-websockets" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    let now = 10_000;
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);
    expect(selections).toBeGreaterThan(0);
    await settleObserverBackgroundTasks();
    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(true);

    // The control was reached once; a later refresh must not click it again.
    const before = selections;
    now = 20_000;
    await observer.refreshCatalog(saba);
    expect(selections).toBe(before);
  });

  it("still reconnects the SABA socket when the DOM capture before it fails", async () => {
    // Measured 2026-09-01: reconnectAttempts stayed at 0 through four API
    // recovery rounds while the socket streamed deltas without a reset. The
    // DOM generations are evidence priming; their failure must not swallow the
    // one step that reseeds the lane, and must be named in the diagnostic.
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "today-tab-active" } } };
      }
      if (method === "Page.getFrameTree") throw new Error("frame-command-timeout");
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.WebSocket.prototype")) {
        return { result: { objectId: "native-websocket-prototype" } };
      }
      if (method === "Runtime.evaluate") throw new Error("Cannot find context with specified id");
      if (method === "Runtime.queryObjects") return { objects: { objectId: "native-websockets" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const forward = vi.fn(async () => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    await vi.waitFor(() => expect(sendCommand.mock.calls.some((call) =>
      call[1] === "Runtime.callFunctionOn")).toBe(true));

    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(true);
    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.callFunctionOn")).toBe(true);
  });

  it("discovers SABA Hôm Nay inside a current child frame when no execution context event was observed", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" }, childFrames: [
        { frame: { id: "sports-frame" } }
      ] } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 71 };
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        return params.contextId === 71
          ? { result: { value: { status: "today-tab-selected" } } }
          : { result: { value: { status: "today-tab-unavailable", tabs: 0 } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    expect(sendCommand).toHaveBeenCalledWith(13, "Page.createIsolatedWorld", expect.objectContaining({
      frameId: "sports-frame", worldName: "fieldline-saba-time-baseline"
    }));
    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.evaluate", expect.objectContaining({
      contextId: 71, expression: expect.stringContaining("fieldline-saba-time-baseline")
    }));
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toBe(false);
  });

  it("takes only two bounded SABA DOM snapshots after checking the current provider view", async () => {
    const records = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
      sportId: "1", leagueId: "league", leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: [`Home ${index}`, `Away ${index}`], groups: [{
        betTypeIds: ["1"], labels: ["0.25"], odds: [
          { marketOddsId: `home-${index}`, priceText: "0.91", lineText: "-0.25" },
          { marketOddsId: `away-${index}`, priceText: "0.95" }
        ]
      }]
    })));
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "requested", clicked: ["ngay mai", "hom nay"] } } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 71 };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: records } };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 10_000,
      monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    expect(forward.mock.calls.filter(([message]) => message.transport === "DOM_SNAPSHOT")).toHaveLength(2);
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      typeof params?.expression === "string" && params.expression.includes("fieldline-saba-time-baseline"))).toBe(true);
    expect(sendCommand.mock.calls.some((call) => call[1] === "Runtime.queryObjects")).toBe(false);
  });

  it("recovers a missed SABA baseline by reconnecting inside the owning OOPIF", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (sessionId !== "saba-child") return {};
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.io.Socket.prototype")) {
        return { result: { objectId: "prototype-child" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-child" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Target.attachedToTarget", {
      sessionId: "saba-child", targetInfo: { type: "iframe" }
    });
    await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 31,
      auxData: { frameId: "saba-frame", isDefault: true } } }, "saba-child");
    sendCommand.mockClear();

    await observer.refreshCatalog(saba);

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
    expect(sendCommand.mock.calls.some(([, method, , sessionId]) =>
      method === "Runtime.queryObjects" && sessionId === "saba-child")).toBe(true);
  });

  it("requests one SABA socket reconnect when a post-restart frame has no creation event", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.io.Socket.prototype")) return { result: { objectId: "prototype-1" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-1" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward,
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;
    await observer.handleEvent(saba, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "sports-frame", isDefault: true } } });
    sendCommand.mockClear();

    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker", response: { opcode: 1, payloadData: "42[]" }
    });
    await observer.handleEvent(saba, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker", response: { opcode: 1, payloadData: "42[]" }
    });

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(1);
    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.callFunctionOn", expect.objectContaining({
      functionDeclaration: expect.stringContaining("socket.disconnect()")
    }));
    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toBe(false);
    expect(forward).not.toHaveBeenCalled();
  });

  it("paces SBO orphan-frame recovery so provider traffic cannot cause a reconnect loop", async () => {
    const now = { value: 10_000 };
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("window.io.Socket.prototype")) return { result: { objectId: "prototype-1" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-1" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => now.value, monotonicNow: () => 60 });
    const sbobet = { lobby: "SBO", sourceId: "chrome:SBO:15", tabId: 15 } as const;
    await observer.handleEvent(sbobet, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "sports-frame", isDefault: true } } });
    sendCommand.mockClear();

    const orphan = () => observer.handleEvent(sbobet, "Network.webSocketFrameReceived", {
      requestId: "socket-created-before-worker", response: { opcode: 1, payloadData: "42[]" }
    });
    await orphan();
    now.value = 16_000;
    await orphan();
    now.value = 69_999;
    await orphan();

    const reconnects = () => sendCommand.mock.calls.filter(([, method]) =>
      method === "Runtime.callFunctionOn");
    expect(reconnects()).toHaveLength(1);

    now.value = 70_000;
    await orphan();
    expect(reconnects()).toHaveLength(2);
  });

  it.each([
    { lobby: "KSPORT" as const, sourceId: "chrome:KSPORT:14", url: "wss://d42.sb21.net/sport/socket" },
    { lobby: "SBO" as const, sourceId: "chrome:SBO:15", url: "wss://sports.example/socket.io/" }
  ])("requests a fresh $lobby baseline by reconnecting only its provider socket", async (input) => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes(".prototype")) return { result: { objectId: "prototype-1" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-1" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const observed = { lobby: input.lobby, sourceId: input.sourceId, tabId: 13 } as const;
    await observer.handleEvent(observed, "Runtime.executionContextCreated", { context: { id: 17,
      auxData: { frameId: "sports-frame", isDefault: true } } });
    await observer.handleEvent(observed, "Network.webSocketCreated", { requestId: "provider-ws", url: input.url });
    sendCommand.mockClear();

    await observer.refreshCatalog(observed);

    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.queryObjects", expect.objectContaining({
      prototypeObjectId: "prototype-1"
    }));
    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "instances-1", functionDeclaration: expect.stringContaining(input.lobby !== "KSPORT"
        ? "socket.disconnect()" : "socket.close(4000")
    }));
    expect(sendCommand).not.toHaveBeenCalledWith(13, "Page.reload", expect.anything());
  });

  it("reconnects the KSPORT catalog socket inside its OOPIF CDP session", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (sessionId !== "sportsbook-child") return {};
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("WebSocket.prototype")) return { result: { objectId: "prototype-child" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-child" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.handleEvent(ksport, "Target.attachedToTarget", {
      sessionId: "sportsbook-child", targetInfo: { type: "iframe" }
    });
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 23,
      auxData: { frameId: "sportsbook-frame", isDefault: true } } }, "sportsbook-child");
    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "provider-ws", url: "wss://d42.sb21.net/sport/538/session/websocket"
    }, "sportsbook-child");
    sendCommand.mockClear();

    await observer.refreshCatalog(ksport);

    expect(sendCommand).toHaveBeenCalledWith(14, "Runtime.evaluate", expect.objectContaining({
      expression: expect.stringContaining("WebSocket.prototype")
    }), "sportsbook-child");
    expect(sendCommand).toHaveBeenCalledWith(14, "Runtime.queryObjects", expect.objectContaining({
      prototypeObjectId: "prototype-child"
    }), "sportsbook-child");
    expect(sendCommand).toHaveBeenCalledWith(14, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "instances-child", functionDeclaration: expect.stringContaining("socket.close(4000")
    }), "sportsbook-child");
  });

  it("keeps a subscribed KSPORT socket open during same-tab catalog recovery", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-template-missing" } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("sport-menu-tab")) {
        return { result: { value: { status: expression.includes("hom nay")
          ? "time-tab-active" : "time-tab-selected", groups: 21, scopes: 2, periods: 24 } } };
      }
      if (method === "Runtime.evaluate" && expression.includes(".sport-type-group-item")) {
        return { result: { value: { status: "football-active" } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("WebSocket.prototype")) {
        return { result: { objectId: "prototype-root" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-root" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 2_000, monotonicNow: () => 60 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "provider-ws", url: "wss://d42.sb21.net/sport/538/session/websocket"
    });
    await observer.handleEvent(ksport, "Network.webSocketFrameSent", {
      requestId: "provider-ws", response: { opcode: 1, payloadData: ksportSubscribe("live") }
    });
    sendCommand.mockClear();

    await observer.refreshCatalog(ksport);

    const periodSelections = sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("sport-menu-tab")).map((call) => String(call[2]?.expression));
    expect(periodSelections).toHaveLength(2);
    expect(periodSelections[0]).toContain("hom nay");
    expect(periodSelections[1]).toContain("truc tiep");
    expect(periodSelections.every((expression) => expression.includes("if (!false)"))).toBe(true);
    expect(sendCommand.mock.calls.some(([, method]) =>
      method === "Runtime.queryObjects" || method === "Runtime.callFunctionOn")).toBe(false);
  });

  it("discovers and reconnects the KSPORT OOPIF after worker restart even when the root context exists", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Target.getTargets") return { targetInfos: [{ targetId: "sportsbook-target",
        type: "iframe", url: "https://d42.sb21.net/sport/538/session", attached: false }] };
      if (method === "Target.attachToTarget") return { sessionId: "sportsbook-child" };
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-failed" } } };
      }
      if (sessionId === "sportsbook-child" && method === "Runtime.evaluate" &&
        String(params?.expression).includes("WebSocket.prototype")) {
        return { result: { objectId: "prototype-child" } };
      }
      if (sessionId === "sportsbook-child" && method === "Runtime.queryObjects") {
        return { objects: { objectId: "instances-child" } };
      }
      if (sessionId === "sportsbook-child" && method === "Runtime.callFunctionOn") {
        return { result: { value: 1 } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 7,
      auxData: { frameId: "root", isDefault: true } } });
    sendCommand.mockClear();

    await observer.refreshCatalog(ksport);

    expect(sendCommand).toHaveBeenCalledWith(14, "Target.getTargets");
    expect(sendCommand).toHaveBeenCalledWith(14, "Runtime.callFunctionOn", expect.objectContaining({
      objectId: "instances-child", functionDeclaration: expect.stringContaining("socket.close(4000")
    }), "sportsbook-child");
    expect(sendCommand).not.toHaveBeenCalledWith(14, "Page.reload", expect.anything());
  });

  it("recovers a fresh KSPORT live and today baseline inside its OOPIF without reloading the tab", async () => {
    const liveBody = JSON.stringify([{ "1": "Live league", "2": [{ "8": "101", "2": "Live Home",
      "3": "Live Away", "7": { "3": ["2.5 0.91*101h -0.99*101a 9001"] } }] }]);
    const todayBody = JSON.stringify([{ "1": "Today league", "2": [{ "8": "102", "2": "Today Home",
      "3": "Today Away", "7": { "3": ["2.5 0.92*102h -0.98*102a 9002"] } }] }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "top", loaderId: "sportsbook-document" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 21 };
      if (method === "Target.getTargets") return { targetInfos: [{ targetId: "sportsbook-target",
        type: "iframe", url: "https://d42.sb21.net/sport/538/session", attached: false }] };
      if (method === "Target.attachToTarget" && params?.targetId === "sportsbook-target") {
        return { sessionId: "sportsbook-child" };
      }
      if (method === "Runtime.evaluate" && sessionId === "sportsbook-child" &&
        String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net", responses: [
          { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: liveBody },
          { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: todayBody }
        ] } } };
      }
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 2_000 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.ingestWebSocketFrame(ksport, "wss://d42.sb21.net/sport/socket",
      "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n\n{\"event\":\"stale-live\"}\u0000");
    await observer.ingestWebSocketFrame(ksport, "wss://d42.sb21.net/sport/socket",
      "MESSAGE\ndestination:/topic/sports/1_1/today/ma/event/vi\n\n{\"event\":\"stale-today\"}\u0000");
    forward.mockClear();
    sendCommand.mockClear();

    await observer.refreshCatalog(ksport);

    expect(sendCommand).toHaveBeenCalledWith(14, "Target.attachToTarget", {
      targetId: "sportsbook-target", flatten: true
    });
    expect(sendCommand).toHaveBeenCalledWith(14, "Runtime.evaluate", expect.objectContaining({
      expression: expect.stringContaining("fieldline-ksport-catalog-refresh"), awaitPromise: true
    }), "sportsbook-child");
    const childEvaluation = sendCommand.mock.calls.find(([, method, , sessionId]) =>
      method === "Runtime.evaluate" && sessionId === "sportsbook-child")?.[2];
    expect(String(childEvaluation?.expression)).toContain("observedRange.toLowerCase()");
    expect(String(childEvaluation?.expression)).toContain("providerRangeStyle");
    const catalogResponses = forward.mock.calls.map(([message]) => message)
      .filter((message) => message.transport === "HTTP_RESPONSE");
    expect(catalogResponses.map((message) => message.request)).toEqual([
      expect.objectContaining({ streamId: "ksport-http:14:1", providerPartition: "KSPORT_LIVE",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: expect.any(Number) }),
      expect.objectContaining({ streamId: "ksport-http:14:1", providerPartition: "KSPORT_TODAY",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: expect.any(Number) })
    ]);
    expect(catalogResponses.map((message) => message.payload.body)).toEqual([liveBody, todayBody]);
    expect(forward.mock.calls.some(([message]) => message.request.replayed === true)).toBe(false);
    expect(sendCommand).not.toHaveBeenCalledWith(14, "Page.reload", expect.anything());
  });

  it("retries the structural KSPORT football selection before catalog recovery", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes(".sport-type-group-item")) {
        return { result: { value: { status: "football-selected" } } };
      }
      if (method === "Runtime.evaluate" &&
        String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        return { result: { value: { status: "fieldline-ksport-catalog-refresh-failed" } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined), now: () => 2_000 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;

    await observer.refreshCatalog(ksport);

    expect(sendCommand).toHaveBeenCalledWith(14, "Runtime.evaluate", expect.objectContaining({
      expression: expect.stringContaining(".sport-type-group-item")
    }));
    const selection = sendCommand.mock.calls.find(([, method, params]) => method === "Runtime.evaluate" &&
      String(params?.expression).includes(".sport-type-group-item"))?.[2];
    expect(String(selection?.expression)).toContain("[data-sport-id]");
    expect(String(selection?.expression)).toContain("sport-odds-boosts");
    expect(sendCommand).not.toHaveBeenCalledWith(14, "Page.reload", expect.anything());
  });

  it("retains every fragment of the current SBOBET STOMP stream and drops a retired stream", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/socket";
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "old", url });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "old",
      response: { opcode: 1, payloadData: "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n\nold" } });
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "current", url });
    const live = ksportFullReceipt("live", 100);
    const halfway = Math.floor(live.length / 2);
    const fragments = [live.slice(0, halfway), live.slice(halfway), ksportFullReceipt("today", 104)];
    for (const payloadData of fragments) await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "current", response: { opcode: 1, payloadData }
    });
    forward.mockClear();

    await observer.replaySnapshots(source.sourceId);

    expect(forward.mock.calls.map(([message]) => message.payload.body)).toEqual(fragments);
    expect(forward.mock.calls.every(([message]) => message.request.streamId === "2")).toBe(true);
  });

  it("keeps the first catalog-evidenced KSPORT socket when later sport sockets are idle", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/socket";

    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "service", url });
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "catalog", url });
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "idle-late", url });
    await observer.handleEvent(source, "Network.webSocketFrameSent", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportSubscribe("live") } });
    await observer.handleEvent(source, "Network.webSocketFrameSent", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportSubscribe("today") } });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportFullReceipt("live", 100) } });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "catalog",
      response: { opcode: 1, payloadData: ksportFullReceipt("today", 104) } });

    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(true);
    const opens = forward.mock.calls.map(([message]) => message)
      .filter((message) => message.transport === "WS_STATE" && message.payload.body.includes("OPEN"));
    expect(opens).toHaveLength(1);
    expect(opens[0]?.request.streamId).toBe("2");
    const catalogFrames = forward.mock.calls.map(([message]) => message)
      .filter((message) => message.transport === "WS_FRAME");
    expect(catalogFrames).toHaveLength(2);
    expect(catalogFrames.every((message) => message.request.streamId === "2")).toBe(true);
  });

  it("retires a stale KSPORT owner before a later evidenced socket opens and forwards its baseline", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/socket";
    const contenderLive = ksportFullReceipt("live", 200);
    const contenderToday = ksportFullReceipt("today", 204);

    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "owner", url });
    for (const payloadData of [ksportFullReceipt("live", 100), ksportFullReceipt("today", 104)]) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", {
        requestId: "owner", response: { opcode: 1, payloadData }
      });
    }
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "contender", url });
    for (const payloadData of [ksportSubscribe("live"), ksportSubscribe("today")]) {
      await observer.handleEvent(source, "Network.webSocketFrameSent", {
        requestId: "contender", response: { opcode: 1, payloadData }
      });
    }
    forwarded.length = 0;

    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "contender", response: { opcode: 1, payloadData: contenderLive }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "owner", response: { opcode: 1, payloadData: ksportDeltaReceipt("live", 205) }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "contender", response: { opcode: 1, payloadData: contenderToday }
    });

    expect(forwarded.map((envelope) => [envelope.transport, envelope.request.streamId,
      envelope.payload.body])).toEqual([
      ["WS_STATE", "1", '{"state":"CLOSED"}'],
      ["WS_STATE", "2", '{"state":"OPEN"}'],
      ["WS_FRAME", "2", contenderLive],
      ["WS_FRAME", "2", contenderToday]
    ]);
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(true);
  });

  describe("KSPORT periodic maintenance", () => {
    const url = "wss://d42.sb21.net/sport/538/session/websocket";
    const liveFrame = ksportFullReceipt("live", 100);
    const todayFrame = ksportFullReceipt("today", 104);
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;

    function setup(now: { value: number }) {
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
          params.expression.includes("sport-menu-tab")) return { result: { value: { status: "time-tab-selected" } } };
        return {};
      });
      const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
      const observer = new NetworkObserver({ sendCommand, forward, now: () => now.value,
        monotonicNow: () => now.value });
      return { sendCommand, forward, observer };
    }

    function setupHttpFallback(now: { value: number }) {
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 21 };
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        if (method === "Runtime.evaluate" && expression.includes("globalThis.WebSocket")) {
          return { result: { objectId: "websocket-prototype" } };
        }
        if (method === "Runtime.queryObjects") return { objects: { objectId: "websocket-instances" } };
        if (method === "Runtime.callFunctionOn") return { result: { value: 0 } };
        return {};
      });
      const forwarded: ChromeBridgeEnvelope[] = [];
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => now.value, monotonicNow: () => now.value });
      return { sendCommand, forwarded, observer };
    }

    async function openSocket(observer: NetworkObserver, frames: readonly string[]): Promise<void> {
      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-child", targetInfo: { type: "iframe" } });
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "provider-ws", url },
        "sportsbook-child");
      for (const body of frames) {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
          response: { opcode: 1, payloadData: body } }, "sportsbook-child");
      }
    }

    it("publishes a bound paired HTTP baseline from a KSPORT snapshot request inside its worker", async () => {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Runtime.evaluate" && sessionId === "sportsbook-worker" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
          return { result: { value: { status: "catalog-requested", executionSurface: "WORKER",
            executionOrigin: "https://rotated-ksport.example", origin: "https://rotated-ksport.example", responses: [
              { timeRange: "live", url: "https://rotated-ksport.example/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://rotated-ksport.example/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => 1_000, monotonicNow: () => 50, observerSessionId: "observer-worker" });
      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-worker",
        targetInfo: { type: "worker", targetId: "sportsbook-worker-target" }
      });

      await observer.refreshCatalog(ksport);

      const responses = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");
      expect(responses).toHaveLength(2);
      expect(responses.map((envelope) => envelope.request.providerPartition)).toEqual([
        "KSPORT_LIVE", "KSPORT_TODAY"
      ]);
      expect(responses.every((envelope) => envelope.request.requestFrameKey !== undefined &&
        envelope.request.requestDocumentKey !== undefined)).toBe(true);
      expect(sendCommand).not.toHaveBeenCalledWith(14, "Page.reload", expect.anything());
    });

    it("rejects a paired HTTP result when its KSPORT worker is replaced during fetch", async () => {
      let releaseFetch!: () => void;
      let sawFetch!: () => void;
      const fetchStarted = new Promise<void>((resolve) => { sawFetch = resolve; });
      const blockedFetch = new Promise<void>((resolve) => { releaseFetch = resolve; });
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Runtime.evaluate" && (sessionId === "sportsbook-worker-old" || sessionId === "sportsbook-worker-new") &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
          if (sessionId === "sportsbook-worker-old") { sawFetch(); await blockedFetch; }
          return { result: { value: { status: "catalog-requested", executionSurface: "WORKER",
            origin: "https://api.sb21.net", responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => 1_000, monotonicNow: () => 50, observerSessionId: "observer-worker" });
      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-worker-old",
        targetInfo: { type: "worker", targetId: "sportsbook-worker-target" }
      });

      const maintenance = observer.maintainKsportFeed(ksport);
      await fetchStarted;
      await observer.handleEvent(ksport, "Target.detachedFromTarget", {
        sessionId: "sportsbook-worker-old"
      });
      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-worker-new",
        targetInfo: { type: "worker", targetId: "sportsbook-worker-target" }
      });
      releaseFetch();
      await maintenance;

      expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(0);
      expect(forwarded.some((envelope) => envelope.request.pathnameClass ===
        "/__fieldline_ksport_refresh__")).toBe(false);
      await observer.refreshCatalog(ksport);
      expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(2);
    });

    it("leaves a healthy complete sportsbook feed untouched", async () => {
      const now = { value: 1_000 };
      const { sendCommand, forward, observer } = setup(now);
      await openSocket(observer, [liveFrame, todayFrame]);
      sendCommand.mockClear();
      forward.mockClear();

      now.value = 20_000;
      await observer.maintainKsportFeed(ksport);

      expect(sendCommand).not.toHaveBeenCalled();
      expect(forward).not.toHaveBeenCalled();
    });

    it("paces page-native Live/Today recovery every eight seconds while no catalog socket exists", async () => {
      vi.useFakeTimers();
      try {
        const now = { value: 1_000 };
        const { sendCommand, observer } = setup(now);
        const selectionCalls = () => sendCommand.mock.calls.filter(([, method, params]) =>
          method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")).length;

        const first = observer.maintainKsportFeed(ksport);
        await vi.advanceTimersByTimeAsync(4_000);
        await first;
        expect(selectionCalls()).toBe(2);

        now.value = 8_999;
        await observer.maintainKsportFeed(ksport);
        expect(selectionCalls()).toBe(2);

        now.value = 9_000;
        const second = observer.maintainKsportFeed(ksport);
        await vi.advanceTimersByTimeAsync(4_000);
        await second;
        expect(selectionCalls()).toBe(4);
        expect(sendCommand).not.toHaveBeenCalledWith(14, "Page.reload", expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses a validated sportsbook heartbeat for local and API liveness without running recovery", async () => {
      const now = { value: 1_000 };
      const { sendCommand, forward, observer } = setup(now);
      await openSocket(observer, [liveFrame, todayFrame]);
      sendCommand.mockClear();
      forward.mockClear();

      now.value = 20_000;
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: 'a["\\n"]' } }, "sportsbook-child");
      now.value = 40_000;
      await observer.maintainKsportFeed(ksport);

      expect(sendCommand).not.toHaveBeenCalled();
      expect(forward).toHaveBeenCalledTimes(1);
      expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "KSPORT",
        transport: "WS_FRAME", request: expect.objectContaining({ recoveryGeneration: 1 }) }));
    });

    it("does not trim a large KSPORT catalog frame while classifying transport heartbeats", async () => {
      const now = { value: 1_000 };
      const { observer } = setup(now);
      await openSocket(observer, []);
      const payload = `a${JSON.stringify([
        ksportFullReceipt("live", 100).replace("live league", "x".repeat(300_000))
      ])}`;
      const nativeTrim = String.prototype.trim;
      const trim = vi.spyOn(String.prototype, "trim").mockImplementation(function(this: string) {
        if (String(this).length === payload.length) throw new Error("LARGE_KSPORT_HEARTBEAT_TRIM");
        return nativeTrim.call(this);
      });

      try {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
          response: { opcode: 1, payloadData: payload } }, "sportsbook-child");
      } finally {
        trim.mockRestore();
      }
    });

    it("parses a large KSPORT SockJS catalog envelope only once", async () => {
      const now = { value: 1_000 };
      const { observer } = setup(now);
      await openSocket(observer, []);
      const payload = `a${JSON.stringify([
        ksportFullReceipt("live", 100).replace("live league", "x".repeat(300_000))
      ])}`;
      const sockJsEnvelope = payload.slice(1);
      const parse = vi.spyOn(JSON, "parse");
      let envelopeParses = 0;

      try {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
          response: { opcode: 1, payloadData: payload } }, "sportsbook-child");
        envelopeParses = parse.mock.calls.filter(([candidate]) => candidate === sockJsEnvelope).length;
      } finally {
        parse.mockRestore();
      }

      expect(envelopeParses).toBe(1);
    });

    it("does not let incomplete-stream heartbeats postpone the fixed HTTP fallback deadline", async () => {
      const now = { value: 1_000 };
      const { sendCommand, forward, observer } = setup(now);
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();
      forward.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      for (const tick of [5_500, 6_000, 6_500]) {
        now.value = tick;
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
          response: { opcode: 1, payloadData: 'a["\\n"]' } }, "sportsbook-child");
      }
      expect(forward).not.toHaveBeenCalled();

      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);
      expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
        String(params?.expression).includes("fieldline-ksport-catalog-refresh"))).toBe(true);
    });

    it("only selects the missing time tab while the socket streams a single partition", async () => {
      const now = { value: 1_000 };
      const { sendCommand, forward, observer } = setup(now);
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();
      forward.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);

      expect(sendCommand.mock.calls.some(([tabId, method, params]) => tabId === 14 &&
        method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab"))).toBe(true);
      expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.callFunctionOn" ||
        (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh"))))
        .toBe(false);
      expect(forward.mock.calls.some(([envelope]) => envelope.request.replayed === true)).toBe(false);
    });

    it("addresses the canonical sportsbook socket owner before root contexts when selecting a missing partition", async () => {
      const now = { value: 1_000 };
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: sessionId === "sportsbook-child"
            ? "time-tab-selected" : "time-tab-active" } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        now: () => now.value, monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);

      const selection = sendCommand.mock.calls.find(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab"));
      expect(selection?.[3]).toBe("sportsbook-child");
    });

    it("selects the provider period item inside the KSPORT time-tab container", async () => {
      const now = { value: 1_000 };
      const { sendCommand, observer } = setup(now);
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);

      const selection = sendCommand.mock.calls.find(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab"));
      expect(String(selection?.[2]?.expression)).toContain(".sport-menu-tab .period-item");
      expect(String(selection?.[2]?.expression)).toContain(".sport-type-group-item");
      expect(String(selection?.[2]?.expression)).toContain(".closest('.header-tab-content')");
      expect(String(selection?.[2]?.expression)).toContain(".sport-odds-boosts");
      expect(String(selection?.[2]?.expression)).toContain("scope.querySelectorAll");
      expect(String(selection?.[2]?.expression)).not.toContain("group.querySelectorAll('.sport-menu-tab .period-item')");
      expect(String(selection?.[2]?.expression)).toContain(".period-tab");
      expect(String(selection?.[2]?.expression)).toContain("active-period");
    });

    it("requests a missing partition once per socket instead of poisoning the tracker with a duplicate subscribe", async () => {
      const now = { value: 1_000 };
      const { sendCommand, observer } = setup(now);
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      const selectionCalls = () => sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")).length;
      expect(selectionCalls()).toBeGreaterThan(0);
      const afterFirst = selectionCalls();

      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 14_999;
      await observer.maintainKsportFeed(ksport);
      expect(selectionCalls()).toBe(afterFirst);

      now.value = 15_000;
      await observer.maintainKsportFeed(ksport);
      expect(selectionCalls()).toBe(afterFirst);

      await observer.handleEvent(ksport, "Network.webSocketFrameSent", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: ksportSubscribe("today") } }, "sportsbook-child");
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: todayFrame } }, "sportsbook-child");
      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);
    });

    it("retries the provider time tab after the paired HTTP fallback fails", async () => {
      const now = { value: 1_000 };
      const { sendCommand, observer } = setup(now);
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();
      const selectionCalls = () => sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")).length;

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      expect(selectionCalls()).toBe(1);
      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);

      now.value = 50_000;
      await observer.maintainKsportFeed(ksport);

      expect(selectionCalls()).toBe(2);
    });

    it("does not thrash period tabs when a selection opens a replacement KSPORT socket", async () => {
      const now = { value: 1_000 };
      const { sendCommand, observer } = setup(now);
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      const selectionCalls = () => sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")).length;
      expect(selectionCalls()).toBe(1);

      await observer.handleEvent(ksport, "Network.webSocketCreated", {
        requestId: "provider-ws-replacement", url
      }, "sportsbook-child");
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "provider-ws-replacement", response: { opcode: 1, payloadData: liveFrame }
      }, "sportsbook-child");
      now.value = 6_000;
      await observer.maintainKsportFeed(ksport);

      expect(selectionCalls()).toBe(1);
    });

    it("falls back to one canonical paired HTTP baseline when the requested WS partition stays incomplete", async () => {
      const now = { value: 1_000 };
      const liveBody = JSON.stringify([{ "1": "live league",
        "2": [{ "8": "101", "2": "Live Home", "3": "Live Away",
          "7": { "3": ["2.5 0.91*101h -0.99*101a 9001"] } }] }]);
      const todayBody = JSON.stringify([{ "1": "today league",
        "2": [{ "8": "102", "2": "Today Home", "3": "Today Away",
          "7": { "3": ["2.5 0.92*102h -0.98*102a 9002"] } }] }]);
      const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: "time-tab-selected" } } };
        }
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
          sessionId === "sportsbook-child") {
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live",
                body: liveBody },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today",
                body: todayBody }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward, now: () => now.value,
        monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);
      sendCommand.mockClear();
      forward.mockClear();

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);

      const responses = forward.mock.calls.filter(([envelope]) => envelope.transport === "HTTP_RESPONSE")
        .map(([envelope]) => envelope);
      expect(responses.map((envelope) => envelope.request)).toEqual([
        expect.objectContaining({ streamId: "ksport-http:14:1", providerPartition: "KSPORT_LIVE",
          providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: 2 }),
        expect.objectContaining({ streamId: "ksport-http:14:1", providerPartition: "KSPORT_TODAY",
          providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: 2 })
      ]);
    });

    it("ignores an unbound successful KSPORT HTTP target and emits only a later bound pair", async () => {
      const now = { value: 1_000 };
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Page.getFrameTree") return { frameTree: {
          frame: { id: "root-frame", loaderId: "root-document" },
          childFrames: [
            { frame: { id: "unbound-frame" } },
            { frame: { id: "bound-frame", loaderId: "bound-document" } }
          ]
        } };
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
          const target = params?.contextId === 31 ? "unbound" : "bound";
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live",
                body: `[{"target":"${target}-live"}]` },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today",
                body: `[{"target":"${target}-today"}]` }
            ] } } };
        }
        if (method === "Runtime.evaluate" && expression.includes("window.WebSocket")) {
          return { result: { objectId: "websocket-prototype" } };
        }
        if (method === "Runtime.queryObjects") return { objects: { objectId: "websocket-instances" } };
        if (method === "Runtime.callFunctionOn") return { result: { value: 0 } };
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => now.value, monotonicNow: () => now.value });
      await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 31,
        auxData: { frameId: "unbound-frame", isDefault: true } } });
      await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 32,
        auxData: { frameId: "bound-frame", isDefault: true } } });

      await observer.maintainKsportFeed(ksport);

      const responses = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");
      expect(responses.map((envelope) => envelope.payload.body)).toEqual([
        '[{"target":"bound-live"}]', '[{"target":"bound-today"}]'
      ]);
      expect(responses.map((envelope) => envelope.request)).toEqual([
        expect.objectContaining({ providerPartition: "KSPORT_LIVE",
          requestFrameKey: expect.stringMatching(/^http-frame:/u),
          requestDocumentKey: expect.stringMatching(/^http-document:/u) }),
        expect.objectContaining({ providerPartition: "KSPORT_TODAY",
          requestFrameKey: expect.stringMatching(/^http-frame:/u),
          requestDocumentKey: expect.stringMatching(/^http-document:/u) })
      ]);
    });

    it("emits no KSPORT HTTP authority from all-unbound targets and retries after four seconds", async () => {
      const now = { value: 1_000 };
      const forwarded: ChromeBridgeEnvelope[] = [];
      let catalogEvaluations = 0;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Page.getFrameTree") return { frameTree: {
          frame: { id: "root-frame", loaderId: "root-document" },
          childFrames: [{ frame: { id: "unbound-frame" } }]
        } };
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
          catalogEvaluations += 1;
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        if (method === "Runtime.evaluate" && expression.includes("window.WebSocket")) {
          return { result: { objectId: "websocket-prototype" } };
        }
        if (method === "Runtime.queryObjects") return { objects: { objectId: "websocket-instances" } };
        if (method === "Runtime.callFunctionOn") return { result: { value: 0 } };
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => now.value, monotonicNow: () => now.value });
      await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 31,
        auxData: { frameId: "unbound-frame", isDefault: true } } });

      await observer.maintainKsportFeed(ksport);
      now.value = 4_999;
      await observer.maintainKsportFeed(ksport);
      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);

      expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(0);
      expect(catalogEvaluations).toBe(2);
    });

    it("refreshes every successful paired HTTP fallback on the four-second start cadence", async () => {
      const now = { value: 1_000 };
      const forwarded: ChromeBridgeEnvelope[] = [];
      const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); });
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
          return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        }
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: "time-tab-selected" } } };
        }
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
          sessionId === "sportsbook-child") {
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward, now: () => now.value,
        monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 11_000;
      await observer.maintainKsportFeed(ksport);
      const generationAtFourSeconds = new Set(forwarded
        .filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request.streamId));

      expect([...generationAtFourSeconds]).toEqual(["ksport-http:14:1", "ksport-http:14:2"]);

      now.value = 15_000;
      await observer.maintainKsportFeed(ksport);
      const generationAtEightSeconds = new Set(forwarded
        .filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request.streamId));
      expect([...generationAtEightSeconds]).toEqual([
        "ksport-http:14:1", "ksport-http:14:2", "ksport-http:14:3"
      ]);
    });

    it("keeps four-second HTTP authority without socket recovery while the catalog socket is missing", async () => {
      const now = { value: 1_000 };
      const { sendCommand, forwarded, observer } = setupHttpFallback(now);

      for (const tick of [1_000, 5_000, 9_000, 13_000]) {
        now.value = tick;
        await observer.maintainKsportFeed(ksport);
      }

      const requests = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request);
      expect(requests.map((request) => request.streamId)).toEqual([
        "ksport-http:14:1", "ksport-http:14:1", "ksport-http:14:2", "ksport-http:14:2",
        "ksport-http:14:3", "ksport-http:14:3", "ksport-http:14:4", "ksport-http:14:4"
      ]);
      expect(requests.map((request) => request.providerPartition)).toEqual([
        "KSPORT_LIVE", "KSPORT_TODAY", "KSPORT_LIVE", "KSPORT_TODAY",
        "KSPORT_LIVE", "KSPORT_TODAY", "KSPORT_LIVE", "KSPORT_TODAY"
      ]);
      expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(0);
    });

    it("keeps four-second HTTP authority without socket recovery after the socket turns silent", async () => {
      const now = { value: 1_000 };
      const { sendCommand, forwarded, observer } = setupHttpFallback(now);
      await openSocket(observer, [liveFrame, todayFrame]);
      forwarded.length = 0;
      sendCommand.mockClear();

      for (const tick of [14_000, 18_000, 22_000, 26_000]) {
        now.value = tick;
        await observer.maintainKsportFeed(ksport, { quietMs: 12_000 });
      }

      const requests = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request);
      expect(requests.map((request) => request.streamId)).toEqual([
        "ksport-http:14:1", "ksport-http:14:1", "ksport-http:14:2", "ksport-http:14:2",
        "ksport-http:14:3", "ksport-http:14:3", "ksport-http:14:4", "ksport-http:14:4"
      ]);
      expect(requests.map((request) => request.providerPartition)).toEqual([
        "KSPORT_LIVE", "KSPORT_TODAY", "KSPORT_LIVE", "KSPORT_TODAY",
        "KSPORT_LIVE", "KSPORT_TODAY", "KSPORT_LIVE", "KSPORT_TODAY"
      ]);
      expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(0);
    });

    it("retries a failed paired HTTP fallback after four seconds", async () => {
      const now = { value: 1_000 };
      const forwarded: ChromeBridgeEnvelope[] = [];
      const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); });
      let fallbackAttempt = 0;
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
          return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        }
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: "time-tab-selected" } } };
        }
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
          sessionId === "sportsbook-child") {
          fallbackAttempt += 1;
          if (fallbackAttempt === 1) return { result: { value: { status: "catalog-request-failed" } } };
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward, now: () => now.value,
        monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 10_999;
      await observer.maintainKsportFeed(ksport);
      expect(forwarded.some((envelope) => envelope.transport === "HTTP_RESPONSE")).toBe(false);

      now.value = 11_000;
      await observer.maintainKsportFeed(ksport);
      expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(2);
    });

    it("clears a successful HTTP cooldown when a replacement KSPORT socket opens", async () => {
      const now = { value: 1_000 };
      const forwarded: ChromeBridgeEnvelope[] = [];
      const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); });
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
          return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        }
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: "time-tab-selected" } } };
        }
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
          sessionId === "sportsbook-child") {
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward, now: () => now.value,
        monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);
      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);

      now.value = 8_000;
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "replacement-ws", url },
        "sportsbook-child");
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "replacement-ws",
        response: { opcode: 1, payloadData: liveFrame } }, "sportsbook-child");
      now.value = 9_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 11_000;
      await observer.maintainKsportFeed(ksport);

      const generations = new Set(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request.streamId));
      expect([...generations]).toEqual(["ksport-http:14:1", "ksport-http:14:2"]);
    });

    it("keeps HTTP fallback authoritative until a newer complete WS generation takes over", async () => {
      const now = { value: 1_000 };
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
          return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        }
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: "time-tab-selected" } } };
        }
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
          sessionId === "sportsbook-child") {
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => now.value, monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);

      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 7_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 8_000;
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: todayFrame } }, "sportsbook-child");

      now.value = 15_000;
      await observer.maintainKsportFeed(ksport);
      expect(new Set(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request.streamId))).toEqual(
          new Set(["ksport-http:14:1", "ksport-http:14:2"]));

      await observer.handleEvent(ksport, "Network.webSocketFrameSent", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: ksportSubscribe("live") } }, "sportsbook-child");
      await observer.handleEvent(ksport, "Network.webSocketFrameSent", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: ksportSubscribe("today") } }, "sportsbook-child");
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: ksportFullReceipt("live", 200) } }, "sportsbook-child");
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: ksportFullReceipt("today", 204) } }, "sportsbook-child");
      now.value = 23_000;
      await observer.maintainKsportFeed(ksport);

      expect(new Set(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request.streamId))).toEqual(
          new Set(["ksport-http:14:1", "ksport-http:14:2"]));
    });

    it("keeps a current-document paired HTTP fallback when an incomplete-stream heartbeat arrives during fetch",
      async () => {
        const now = { value: 1_000 };
        let releaseEvaluation!: () => void;
        let evaluationStarted!: () => void;
        const evaluationBlocked = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
        const sawEvaluation = new Promise<void>((resolve) => { evaluationStarted = resolve; });
        const forwarded: ChromeBridgeEnvelope[] = [];
        const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
          sessionId?: string) => {
          if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
            return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
          }
          if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
            return { result: { value: { status: "time-tab-selected" } } };
          }
          if (method === "Runtime.evaluate" &&
            String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
            sessionId === "sportsbook-child") {
            evaluationStarted();
            await evaluationBlocked;
            return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
              responses: [
                { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
                { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
              ] } } };
          }
          return {};
        });
        const observer = new NetworkObserver({ sendCommand,
          forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
          now: () => now.value, monotonicNow: () => now.value });
        await openSocket(observer, [liveFrame]);
        now.value = 5_000;
        await observer.maintainKsportFeed(ksport);
        now.value = 7_000;
        const fallback = observer.maintainKsportFeed(ksport);
        await sawEvaluation;
        const heartbeat = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "provider-ws", response: { opcode: 1, payloadData: 'a["\\n"]' }
        }, "sportsbook-child");
        releaseEvaluation();
        await Promise.all([fallback, heartbeat]);

        const responses = forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE");
        expect(responses).toHaveLength(2);
        expect(responses.map((envelope) => envelope.request.providerPartition))
          .toEqual(["KSPORT_LIVE", "KSPORT_TODAY"]);
        expect(new Set(responses.map((envelope) => envelope.request.streamId)))
          .toEqual(new Set(["ksport-http:14:1"]));
        expect(responses.every((envelope) => "requestStartSequence" in envelope.request &&
          typeof envelope.request.requestStartSequence === "number")).toBe(true);
        expect(new Set(responses.map((envelope) => "requestStartSequence" in envelope.request
          ? envelope.request.requestStartSequence : undefined)).size).toBe(1);
        expect(responses.every((envelope) => /^http-frame:/u.test(envelope.request.requestFrameKey ?? "") &&
          /^http-document:/u.test(envelope.request.requestDocumentKey ?? ""))).toBe(true);
        expect(new Set(responses.map((envelope) => envelope.request.requestFrameKey)).size).toBe(1);
        expect(new Set(responses.map((envelope) => envelope.request.requestDocumentKey)).size).toBe(1);
      });

    it("discards a paired HTTP fallback when the active WS baseline completes during fetch", async () => {
      const now = { value: 1_000 };
      let releaseEvaluation!: () => void;
      let evaluationStarted!: () => void;
      const evaluationBlocked = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
      const sawEvaluation = new Promise<void>((resolve) => { evaluationStarted = resolve; });
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
          return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        }
        if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
          return { result: { value: { status: "time-tab-selected" } } };
        }
        if (method === "Runtime.evaluate" &&
          String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
          sessionId === "sportsbook-child") {
          evaluationStarted();
          await evaluationBlocked;
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => now.value, monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame]);
      now.value = 5_000;
      await observer.maintainKsportFeed(ksport);
      now.value = 7_000;
      const fallback = observer.maintainKsportFeed(ksport);
      await sawEvaluation;
      const completingFrame = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "provider-ws", response: { opcode: 1,
          payloadData: todayFrame } }, "sportsbook-child");
      releaseEvaluation();
      await Promise.all([fallback, completingFrame]);

      expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")).toHaveLength(0);
    });

    it("keeps paired HTTP when an incomplete-stream catalog delta arrives during fetch",
      async () => {
        const now = { value: 1_000 };
        let releaseEvaluation!: () => void;
        let evaluationStarted!: () => void;
        const evaluationBlocked = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
        const sawEvaluation = new Promise<void>((resolve) => { evaluationStarted = resolve; });
        const forwarded: ChromeBridgeEnvelope[] = [];
        const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
          sessionId?: string) => {
          if (method === "Page.getFrameTree" && sessionId === "sportsbook-child") {
            return { frameTree: { frame: { id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
          }
          if (method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab")) {
            return { result: { value: { status: "time-tab-selected" } } };
          }
          if (method === "Runtime.evaluate" &&
            String(params?.expression).includes("fieldline-ksport-catalog-refresh") &&
            sessionId === "sportsbook-child") {
            evaluationStarted();
            await evaluationBlocked;
            return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
              responses: [
                { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
                { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
              ] } } };
          }
          return {};
        });
        const observer = new NetworkObserver({ sendCommand,
          forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
          now: () => now.value, monotonicNow: () => now.value });
        await openSocket(observer, [liveFrame]);
        now.value = 5_000;
        await observer.maintainKsportFeed(ksport);
        forwarded.length = 0;
        now.value = 7_000;
        const fallback = observer.maintainKsportFeed(ksport);
        await sawEvaluation;
        const pendingDelta = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "provider-ws", response: { opcode: 1,
            payloadData: ksportDeltaReceipt("live", 200) }
        }, "sportsbook-child");
        releaseEvaluation();
        await Promise.all([fallback, pendingDelta]);

        const catalogTraffic = forwarded.filter((envelope) =>
          envelope.transport === "HTTP_RESPONSE" || envelope.transport === "WS_FRAME");
        expect(catalogTraffic.map((envelope) => envelope.transport))
          .toEqual(["HTTP_RESPONSE", "HTTP_RESPONSE", "WS_FRAME"]);
        expect(catalogTraffic.slice(0, 2).map((envelope) => envelope.request.providerPartition))
          .toEqual(["KSPORT_LIVE", "KSPORT_TODAY"]);
        expect(new Set(catalogTraffic.slice(0, 2).map((envelope) => envelope.request.streamId)))
          .toEqual(new Set(["ksport-http:14:1"]));
        expect(catalogTraffic.map((envelope) => envelope.sequence))
          .toEqual([...catalogTraffic.map((envelope) => envelope.sequence)].sort((left, right) => left - right));
      });

    it("does not retire current KSPORT authority for a later socket without catalog evidence", async () => {
      const now = { value: 1_000 };
      const { forward, observer } = setup(now);
      await openSocket(observer, [liveFrame, todayFrame]);
      await observer.handleEvent(ksport, "Network.webSocketCreated", {
        requestId: "replacement-ws", url }, "sportsbook-child");
      forward.mockClear();

      now.value = 2_000;
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: "h" } }, "sportsbook-child");

      expect(forward).toHaveBeenCalledTimes(1);
      expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "WS_FRAME",
        request: expect.objectContaining({ streamId: "1" }) }));
    });

    it("orders an active KSPORT heartbeat behind the socket frame tail", async () => {
      const now = { value: 1_000 };
      let releaseFrame!: () => void;
      let frameStarted!: () => void;
      const frameBlocked = new Promise<void>((resolve) => { releaseFrame = resolve; });
      const sawFrame = new Promise<void>((resolve) => { frameStarted = resolve; });
      const bodies: string[] = [];
      const nextLive = ksportFullReceipt("live", 105);
      const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => {
          bodies.push(envelope.payload.body);
          if (envelope.transport === "WS_FRAME" && envelope.payload.body === nextLive) {
            frameStarted();
            await frameBlocked;
          }
        }), now: () => now.value, monotonicNow: () => now.value });
      await openSocket(observer, [liveFrame, todayFrame]);
      bodies.length = 0;

      const frame = observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: nextLive } }, "sportsbook-child");
      await sawFrame;
      now.value = 7_000;
      const heartbeat = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "provider-ws", response: { opcode: 1, payloadData: "h" } }, "sportsbook-child");
      await Promise.resolve();
      expect(bodies).toEqual([nextLive]);

      releaseFrame();
      await Promise.all([frame, heartbeat]);
      expect(bodies).toEqual([nextLive, "h"]);
    });

    it("paces targeted socket recovery every five seconds after the socket quiet window", async () => {
      const now = { value: 1_000 };
      const { sendCommand, observer } = setup(now);
      await openSocket(observer, [liveFrame, todayFrame]);
      sendCommand.mockClear();

      const fullRecoveryCalls = () => sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")).length;

      // This case is about the five-second pacing between recovery attempts, not
      // about the default quiet window, so the window is stated explicitly.
      const quietMs = 30_000;

      now.value = 20_000;
      await observer.maintainKsportFeed(ksport, { quietMs });
      expect(fullRecoveryCalls()).toBe(0);

      now.value = 40_000;
      await observer.maintainKsportFeed(ksport, { quietMs });
      expect(fullRecoveryCalls()).toBeGreaterThan(0);
      const afterFirst = fullRecoveryCalls();

      now.value = 43_000;
      await observer.maintainKsportFeed(ksport, { quietMs });
      expect(fullRecoveryCalls()).toBe(afterFirst);

      now.value = 45_000;
      await observer.maintainKsportFeed(ksport, { quietMs });
      expect(fullRecoveryCalls()).toBeGreaterThan(afterFirst);
    });

    it("closes the sportsbook sockets of a detached OOPIF so the stream is retired", async () => {
      const now = { value: 1_000 };
      const { forward, observer } = setup(now);
      await openSocket(observer, [liveFrame, todayFrame]);
      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);
      forward.mockClear();

      await observer.handleEvent(ksport, "Target.detachedFromTarget", { sessionId: "sportsbook-child" });

      expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "KSPORT", transport: "WS_STATE",
        payload: expect.objectContaining({ body: '{"state":"CLOSED"}' }) }));
      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(false);
    });

    it("requests one socket reconnect when frames arrive for a socket created before Network was enabled", async () => {
      const now = { value: 1_000 };
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
        sessionId?: string) => {
        if (sessionId !== "sportsbook-child") return {};
        if (method === "Runtime.evaluate" && String(params?.expression).includes("WebSocket.prototype")) {
          return { result: { objectId: "prototype-child" } };
        }
        if (method === "Runtime.queryObjects") return { objects: { objectId: "instances-child" } };
        if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
        now: () => now.value, monotonicNow: () => now.value });
      await observer.handleEvent(ksport, "Target.attachedToTarget", {
        sessionId: "sportsbook-child", targetInfo: { type: "iframe" } });
      await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 23,
        auxData: { frameId: "sportsbook-frame", isDefault: true } } }, "sportsbook-child");
      sendCommand.mockClear();

      const orphan = () => observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "pre-existing-ws", response: { opcode: 1, payloadData: liveFrame } }, "sportsbook-child");
      await orphan();
      await orphan();
      now.value = 10_000;
      await orphan();

      const reconnects = sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.callFunctionOn" && String(params?.functionDeclaration).includes("socket.close(4000"));
      expect(reconnects).toHaveLength(1);
    });
  });

  it("reports KSPORT ready only after the current socket has both live and today baselines", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";

    await observer.ingestWebSocketFrame(source, url, ksportFullReceipt("live", 100));
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(false);

    await observer.ingestWebSocketFrame(source, url, ksportFullReceipt("today", 104));
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(true);
  });

  it("reselects a KSPORT period when retention evicts its full snapshot", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => method === "Runtime.evaluate" &&
        String(params?.expression).includes("sport-menu-tab")
      ? { result: { value: { status: "time-tab-selected" } } }
      : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";

    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "provider-ws", url });
    for (const payloadData of [ksportFullReceipt("live", 100), ksportFullReceipt("today", 104)]) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData } });
    }
    for (let order = 105; order < 2_152; order += 1) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "provider-ws",
        response: { opcode: 1, payloadData: ksportDeltaReceipt("live", order) } });
    }

    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(false);
    await expect(observer.ensureCompleteKsportBaseline(source)).resolves.toBe(false);
    const periodSelections = sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab"));
    expect(periodSelections).toHaveLength(1);
    expect(String(periodSelections[0]?.[2]?.expression)).toContain("truc tiep");
  });

  it("does not report a manual KSPORT stream ready from destination labels without full snapshots", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";

    await observer.ingestWebSocketFrame(source, url,
      "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\nsubscription:subSportBookLive\n\n{}\u0000");
    await observer.ingestWebSocketFrame(source, url,
      "MESSAGE\ndestination:/topic/sports/1_11/today/ma/event/vi\nsubscription:subSportBookToday\n\n{}\u0000");

    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(false);
  });

  it("selects KSPORT today once live is present without restarting a completed baseline", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>) => ({ result: { value: { status: "time-tab-selected" } } }));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";
    await observer.ingestWebSocketFrame(source, url, ksportFullReceipt("live", 100));

    await expect(observer.ensureCompleteKsportBaseline(source)).resolves.toBe(false);
    expect(String(sendCommand.mock.calls.at(-1)?.[2]?.expression)).toContain("hom nay");

    await observer.ingestWebSocketFrame(source, url, ksportFullReceipt("today", 104));
    const selectionsAtCompletion = sendCommand.mock.calls.length;
    await expect(observer.ensureCompleteKsportBaseline(source)).resolves.toBe(true);
    expect(sendCommand).toHaveBeenCalledTimes(selectionsAtCompletion);
  });

  it("attempts a missing KSPORT partition once when the provider tab lookup fails", async () => {
    let attempts = 0;
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>, sessionId?: string) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("truc tiep")) {
        attempts += 1;
        return { result: { value: { status: attempts === 1 ? "time-tab-not-found" : "time-tab-selected" } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";
    await observer.ingestWebSocketFrame(source, url,
      "MESSAGE\ndestination:/topic/sports/1_11/today/ma/event/vi\nsubscription:subSportBookToday\n\n{}\u0000");

    await expect(observer.ensureCompleteKsportBaseline(source)).resolves.toBe(false);
    await expect(observer.ensureCompleteKsportBaseline(source)).resolves.toBe(false);

    expect(attempts).toBe(1);
  });

  it("does not replay a closed SBOBET socket baseline", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:15", tabId: 15 } as const;
    const url = "wss://d42.sb21.net/sport/socket";
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "sports", url });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", { requestId: "sports",
      response: { opcode: 1, payloadData:
        "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n\ncurrent\u0000" } });
    await observer.handleEvent(source, "Network.webSocketClosed", { requestId: "sports" });
    forward.mockClear();

    await observer.replaySnapshots(source.sourceId);

    expect(forward).not.toHaveBeenCalled();
  });

  it("replays retained T-Sports frames after the provider rotates to racern.com", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => now, monotonicNow: () => 60 });
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;
    const body = JSON.stringify({ s: 1, t: "eu", d: JSON.stringify({ "2": 5557169, "5": "Home" }) });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "ws-2", url: "wss://spws.racern.com/ln/en/s/1/mg/0/tr/0"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-2", response: { opcode: 1, payloadData: body }
    });
    forward.mockClear();
    now = 2_000;

    await observer.replaySnapshots(source.sourceId);

    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("retains T-Sports frames from the current one-token authenticated socket path", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 60 });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:12", tabId: 12 } as const;
    const body = JSON.stringify({ s: 1, t: "eu", d: JSON.stringify({ "2": 5557172, "5": "Home" }) });
    await observer.handleEvent(tsport, "Network.webSocketCreated", {
      requestId: "ws-current", url: "wss://spws.agenate.com/ln/en/p/1/u/opaque-token/s/1/mg/0/tr/0"
    });
    await observer.handleEvent(tsport, "Network.webSocketFrameReceived", {
      requestId: "ws-current", response: { opcode: 1, payloadData: body }
    });
    forward.mockClear();

    await observer.replaySnapshots(tsport.sourceId);

    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("replays a large IM baseline as wire-safe ordered chunks", async () => {
    const snapshot = JSON.stringify({ StatusCode: 100,
      sel: Array.from({ length: 5_000 }, (_, index) => ({ eid: index, pad: "x".repeat(80) })) });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: snapshot, base64Encoded: false }
      : method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "im-frame", loaderId: "im-document" } } }
        : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 2_000, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "snapshot",
      frameId: "im-frame", loaderId: "im-document",
      request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "snapshot", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "snapshot" });
    forward.mockClear();

    await observer.replaySnapshots(source.sourceId);

    expect(forward.mock.calls.length).toBeGreaterThan(1);
    const chunks = forward.mock.calls.map(([message]) => JSON.parse(message.payload.body));
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(new Set(chunks.map((chunk) => chunk.snapshotId)).size).toBe(1);
    expect(chunks.map((chunk) => chunk.bodyFragment).join("")).toBe(snapshot);
    expect(forward.mock.calls.every(([message]) => new TextEncoder().encode(JSON.stringify(message)).byteLength < 256 * 1024)).toBe(true);
  });

  it("requests a bounded IM baseline recovery when deltas arrive without GetSE", async () => {
    let now = 1_000;
    const recoverImBaseline = vi.fn(async () => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: '{"StatusCode":100,"dc":[]}', base64Encoded: false }
      : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      recoverImBaseline, now: () => now });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const delta = async (requestId: string) => {
      await observer.handleEvent(im, "Network.requestWillBeSent", { requestId,
        request: { method: "POST", url: "https://imsports.directsb.net/api/EventV6/GetSEDelta" } });
      await observer.handleEvent(im, "Network.responseReceived", { requestId, type: "XHR",
        response: { url: "https://imsports.directsb.net/api/EventV6/GetSEDelta" } });
      await observer.handleEvent(im, "Network.loadingFinished", { requestId });
    };

    await delta("delta-1");
    now = 30_000;
    await delta("delta-2");
    expect(recoverImBaseline).toHaveBeenCalledTimes(1);
    now = 61_001;
    await delta("delta-3");
    expect(recoverImBaseline).toHaveBeenCalledTimes(2);
    expect(recoverImBaseline).toHaveBeenCalledWith(im);
  });

  it("sends every CMD record across bounded ordered chunks without truncating at 500", async () => {
    const publicRecords = Array.from({ length: 783 }, (_, index) => ({
      sportId: "1", leagueId: `l-${index}`, leagueName: `League ${index}`, matchId: `m-${index}`,
      timeText: "1H12'", teamNames: [`Home ${index}`, `Away ${index}`], groups: [], padding: "x".repeat(500)
    }));
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { type: "string", value: JSON.stringify(publicRecords) } }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 2_000, monotonicNow: () => 60 });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:11", tabId: 11 }, "cgnew.fts368.com");

    const chunks = forward.mock.calls.map(([envelope]) => JSON.parse(envelope.payload.body));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((chunk) => chunk.records)).toEqual(publicRecords);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => new TextEncoder().encode(JSON.stringify(chunk)).byteLength <= 240_000)).toBe(true);
  });

  it("forwards a safe CMD DOM diagnostic when the known catalog selector matches nothing", async () => {
    const diagnostic = JSON.stringify([{ __fieldlineDiagnostic: {
      matchCount: 0, dataMatchIdCount: 0, oddsIdCount: 0, tableCount: 3,
      classNames: ["odds-table", "match-row"]
    } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
      ? { result: { type: "string", value: diagnostic } }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });

    await observer.captureCmdSnapshot({ lobby: "CMD", sourceId: "chrome:CMD:10", tabId: 10 }, "cgnew.fts368.com");

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "DOM_SNAPSHOT" }));
    const chunk = JSON.parse(forward.mock.calls[0]![0].payload.body);
    expect(chunk).toMatchObject({ schemaVersion: 2, chunkIndex: 0, chunkCount: 1,
      records: JSON.parse(diagnostic) });
  });

  it("accepts content-script WebSocket and HTTP captures without debugger commands", async () => {
    const sendCommand = vi.fn(async () => { throw new Error("must not run"); });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 2_000, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

    await observer.ingestWebSocketFrame(source, "wss://imsports.directsb.net/feed", '{"odds":1.9}');
    await observer.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
      '{"StatusCode":100,"sel":[]}', { method: "POST" });

    expect(sendCommand).not.toHaveBeenCalled();
    expect(forward.mock.calls.map(([message]) => message.transport)).toEqual(["WS_FRAME", "HTTP_RESPONSE"]);
    expect(forward.mock.calls.map(([message]) => message.sequence)).toEqual([0, 1]);
  });

  it("does not let a retired socket close delete a replacement KSPORT stream with the reused ordinal", async () => {
    let releaseClosed!: () => void;
    let closedObserved!: () => void;
    const closedBlocked = new Promise<void>((resolve) => { releaseClosed = resolve; });
    const sawClosed = new Promise<void>((resolve) => { closedObserved = resolve; });
    const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => {
      if (envelope.transport === "WS_STATE" && envelope.payload.body === '{"state":"CLOSED"}') {
        closedObserved();
        await closedBlocked;
      }
    });
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 60 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";
    const live = ksportFullReceipt("live", 100);
    const today = ksportFullReceipt("today", 104);

    await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "sports", url });
    await observer.handleEvent(ksport, "Network.webSocketFrameSent", { requestId: "sports",
      response: { opcode: 1, payloadData: ksportSubscribe("live") } });
    const retiredClose = observer.handleEvent(ksport, "Network.webSocketClosed", { requestId: "sports" });
    await sawClosed;

    observer.beginSourceEpoch(ksport.sourceId);
    await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "sports", url });
    const replacementLive = observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "sports",
      response: { opcode: 1, payloadData: live } });
    // Replacement work shares the bounded physical lane with the retiring
    // forward. Release that head before waiting for the new baseline.
    releaseClosed();
    await Promise.all([retiredClose, replacementLive]);
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "sports",
      response: { opcode: 1, payloadData: today } });
    expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);

    releaseClosed();
    await retiredClose;

    expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);
    forward.mockClear();
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "sports",
      response: { opcode: 1, payloadData: live } });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "WS_FRAME",
      request: expect.objectContaining({ streamId: "1" }) }));
  });

  it("abandons a retired socket-baseline recovery but releases its remote object group", async () => {
    let releaseEvaluation!: () => void;
    let evaluationObserved!: () => void;
    const evaluationBlocked = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
    const sawEvaluation = new Promise<void>((resolve) => { evaluationObserved = resolve; });
    let blockFirstEvaluation = true;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("WebSocket.prototype") &&
        blockFirstEvaluation) {
        blockFirstEvaluation = false;
        evaluationObserved();
        await evaluationBlocked;
        return { result: { objectId: "retired-prototype" } };
      }
      if (method === "Runtime.evaluate") return { result: { objectId: "replacement-prototype" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "socket-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined), now: () => 1_000 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    await observer.handleEvent(ksport, "Target.attachedToTarget", {
      sessionId: "sportsbook-child", targetInfo: { type: "iframe" }
    });
    await observer.handleEvent(ksport, "Runtime.executionContextCreated", { context: { id: 23,
      auxData: { frameId: "sportsbook-frame", isDefault: true } } }, "sportsbook-child");
    sendCommand.mockClear();

    const retiredRecovery = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "orphan-old", response: { opcode: 1,
        payloadData: "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n\nold\u0000" }
    }, "sportsbook-child");
    await sawEvaluation;
    observer.beginSourceEpoch(ksport.sourceId);
    await observer.handleEvent(ksport, "Network.webSocketCreated", {
      requestId: "replacement", url: "wss://d42.sb21.net/sport/538/session/websocket"
    }, "sportsbook-child");
    releaseEvaluation();
    await retiredRecovery;

    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects" ||
      method === "Runtime.callFunctionOn")).toHaveLength(0);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.releaseObjectGroup"))
      .toHaveLength(1);
  });

  it("queues orphan KSPORT recovery behind its lane while another provider still progresses", async () => {
    let releaseKsport!: () => void;
    let ksportObserved!: () => void;
    const ksportBlocked = new Promise<void>((resolve) => { releaseKsport = resolve; });
    const sawKsport = new Promise<void>((resolve) => { ksportObserved = resolve; });
    let firstKsportEvaluation = true;
    const sendCommand = vi.fn(async (tabId: number, method: string) => {
      if (tabId === 14 && method === "Runtime.evaluate" && firstKsportEvaluation) {
        firstKsportEvaluation = false;
        ksportObserved();
        await ksportBlocked;
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined), now: () => 1_000 });
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const bti = { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 } as const;

    const maintenance = observer.maintainKsportFeed(ksport);
    await sawKsport;
    const blockedKsportCallCount = sendCommand.mock.calls.filter(([tabId]) => tabId === 14).length;
    const orphan = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
      requestId: "pre-existing", response: { opcode: 1, payloadData: "orphan" }
    });
    const btiRefresh = observer.refreshCatalog(bti);
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([tabId]) => tabId === 6)).toBe(true));

    expect(sendCommand.mock.calls.filter(([tabId]) => tabId === 14)).toHaveLength(blockedKsportCallCount);
    releaseKsport();
    await Promise.all([maintenance, orphan, btiRefresh]);
  });

  describe("KSPORT ownership regressions", () => {
    const ksport = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";

    it("does not let a detached old session clear a replacement epoch with the reused stream ordinal", async () => {
      let releaseClosed!: () => void;
      let closedObserved!: () => void;
      const closedBlocked = new Promise<void>((resolve) => { releaseClosed = resolve; });
      const sawClosed = new Promise<void>((resolve) => { closedObserved = resolve; });
      const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => {
        if (envelope.transport === "WS_STATE" && envelope.payload.body === '{"state":"CLOSED"}') {
          closedObserved();
          await closedBlocked;
        }
      });
      const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
        now: () => 1_000, monotonicNow: () => 60 });

      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "retired", url },
        "retired-session");
      for (const payloadData of [ksportFullReceipt("live", 100), ksportFullReceipt("today", 104)]) {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "retired", response: { opcode: 1, payloadData }
        }, "retired-session");
      }
      const detached = observer.handleEvent(ksport, "Target.detachedFromTarget", {
        sessionId: "retired-session"
      });
      await sawClosed;

      observer.beginSourceEpoch(ksport.sourceId);
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "replacement", url },
        "replacement-session");
      // A new epoch cannot allocate another physical forwarding lane behind
      // the deliberately blocked old session.
      releaseClosed();
      await detached;
      for (const payloadData of [ksportFullReceipt("live", 200), ksportFullReceipt("today", 204)]) {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "replacement", response: { opcode: 1, payloadData }
        }, "replacement-session");
      }
      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);

      releaseClosed();
      await detached;

      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);
    });

    it("uses paired HTTP fallback when canonical sport sockets exist without an owner", async () => {
      const forwarded: ChromeBridgeEnvelope[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        const expression = String(params?.expression ?? "");
        if (method === "Page.getFrameTree") return { frameTree: { frame: {
          id: "sportsbook-frame", loaderId: "sportsbook-document" } } };
        if (method === "Page.createIsolatedWorld") return { executionContextId: 21 };
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
          return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
            responses: [
              { timeRange: "live", url: "https://api.sb21.net/api/v2/getEvent?timeRange=live", body: "[]" },
              { timeRange: "today", url: "https://api.sb21.net/api/v2/getEvent?timeRange=today", body: "[]" }
            ] } } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
        now: () => 1_000, monotonicNow: () => 60 });
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "candidate", url });

      await observer.maintainKsportFeed(ksport);

      expect(forwarded.filter((envelope) => envelope.transport === "HTTP_RESPONSE")
        .map((envelope) => envelope.request.providerPartition)).toEqual([
          "KSPORT_LIVE", "KSPORT_TODAY"
        ]);
    });

    it("promotes an attributable contender baseline and ignores the retired owner thereafter", async () => {
      const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
        forward: vi.fn(async () => undefined), now: () => 1_000, monotonicNow: () => 60 });
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "owner", url });
      for (const payloadData of [ksportFullReceipt("live", 100), ksportFullReceipt("today", 104)]) {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "owner", response: { opcode: 1, payloadData }
        });
      }
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "contender", url });
      for (const payloadData of [ksportFullReceipt("live", 200), ksportFullReceipt("today", 204)]) {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "contender", response: { opcode: 1, payloadData }
        });
      }

      await observer.handleEvent(ksport, "Network.webSocketClosed", { requestId: "owner" });
      await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "contender", response: { opcode: 1, payloadData: ksportDeltaReceipt("live", 205) }
      });

      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(true);
    });

    it("forwards the activating KSPORT frame before a concurrently arriving second frame", async () => {
      let releaseOpen!: () => void;
      let openObserved!: () => void;
      const openBlocked = new Promise<void>((resolve) => { releaseOpen = resolve; });
      const sawOpen = new Promise<void>((resolve) => { openObserved = resolve; });
      const bodies: string[] = [];
      const forward = vi.fn(async (envelope: ChromeBridgeEnvelope) => {
        if (envelope.transport === "WS_STATE" && envelope.payload.body === '{"state":"OPEN"}') {
          openObserved();
          await openBlocked;
        }
        if (envelope.transport === "WS_FRAME") bodies.push(envelope.payload.body);
      });
      const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
        now: () => 1_000, monotonicNow: () => 60 });
      const live = ksportFullReceipt("live", 100);
      const today = ksportFullReceipt("today", 104);
      await observer.handleEvent(ksport, "Network.webSocketCreated", { requestId: "catalog", url });

      const first = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData: live }
      });
      await sawOpen;
      const second = observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData: today }
      });
      releaseOpen();
      await Promise.all([first, second]);

      expect(bodies).toEqual([live, today]);
    });

    it("rejects an exact sport path that the API and reconnect allowlists cannot consume", async () => {
      const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
      const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward,
        now: () => 1_000, monotonicNow: () => 60 });
      await observer.handleEvent(ksport, "Network.webSocketCreated", {
        requestId: "exact-sport", url: "wss://d42.sb21.net/sport"
      });
      for (const payloadData of [ksportFullReceipt("live", 100), ksportFullReceipt("today", 104)]) {
        await observer.handleEvent(ksport, "Network.webSocketFrameReceived", {
          requestId: "exact-sport", response: { opcode: 1, payloadData }
        });
      }

      expect(forward).not.toHaveBeenCalled();
      expect(observer.hasCompleteKsportBaseline(ksport.sourceId)).toBe(false);
    });
  });
});

describe("KSPORT football group label", () => {
  const expression = ksportTimeTabExpressionForTest(["truc tiep", "live"]);

  function evaluate(headers: readonly string[], periodLabel = "truc tiep"): {
    status: string;
    step?: string;
    groups?: number;
    scopes?: number;
    periods?: number;
  } {
    // Minimal DOM stand-in: the expression only reads header text, the
    // .header-tab-content ancestor and the period tabs.
    const groups = headers.map((text) => {
      const period = { textContent: periodLabel, classList: { contains: () => false },
        querySelector: () => null, click: (): void => undefined };
      const scope = { querySelectorAll: () => [period] };
      return { textContent: text, closest: (selector: string) =>
        selector === ".header-tab-content" ? scope : null,
        querySelector: () => null };
    });
    const document = {
      querySelectorAll: (selector: string) =>
        selector === ".sport-type-group-item" ? groups : selector === ".header-tab-content" ? [{}] : [{}]
    };
    return Function("document", `return ${expression};`)(document) as {
      status: string;
      step?: string;
      groups?: number;
      scopes?: number;
      periods?: number;
    };
  }

  it("reports structural counts when a period selection succeeds", () => {
    expect(evaluate(["Football"], "live")).toMatchObject({
      status: "time-tab-selected", groups: 1, scopes: 1, periods: 1
    });
  });

  it("selects the football group whichever language the page renders", () => {
    // Measured 2026-08-26: 21 groups were present and none matched, because the
    // predicate only accepted the Vietnamese label while the page rendered
    // English. Every class name in the selector was still correct.
    expect(evaluate(["Bóng đá"]).status).not.toBe("time-tab-not-found");
    expect(evaluate(["Football"]).status).not.toBe("time-tab-not-found");
  });

  it("finds the live tab when the page appends a running-match count", () => {
    // Measured 2026-08-26: the tab text is "truc tiep42", not "truc tiep".
    expect(evaluate(["Bóng đá"], "truc tiep42").status).not.toBe("time-tab-not-found");
    expect(evaluate(["Bóng đá"], "truc tiep 7").status).not.toBe("time-tab-not-found");
  });

  it("does not accept a different tab that merely starts with the label", () => {
    expect(evaluate(["Bóng đá"], "truc tiep sau").status).toBe("time-tab-not-found");
  });

  it.each(["Bóng đá GS", "Football GS LIVE 12", "Bóng đá điện tử", "Football Virtual"])(
    "rejects another football product before selecting its period: %s", label => {
      expect(evaluate([label]).status).toBe("time-tab-not-found");
    });

  it("re-selects an already-active tab so the page re-emits its table", () => {
    // Measured 2026-08-26: the selector reached time-tab-active, meaning the
    // live tab was already selected, so no click happened and the provider
    // never re-sent a full partition table. Without that table the feed has no
    // complete baseline and can never be promoted.
    const forcing = ksportTimeTabExpressionForTest(["truc tiep", "live"], true);
    const clicks: string[] = [];
    const scheduled: Array<() => void> = [];
    const makeTab = (text: string, active: boolean) => ({
      textContent: text, classList: { contains: (name: string) => active && name === "active-period" },
      querySelector: () => null, click: (): void => { clicks.push(text); }
    });
    const target = makeTab("truc tiep42", true);
    const sibling = makeTab("hom nay", false);
    const scope = { querySelectorAll: () => [sibling, target] };
    const group = { textContent: "Bóng đá", querySelector: () => null,
      closest: (selector: string) => selector === ".header-tab-content" ? scope : null };
    const document = { querySelectorAll: (selector: string) =>
      selector === ".sport-type-group-item" ? [group] : [{}] };
    const setTimeoutStub = (callback: () => void): number => scheduled.push(callback);

    const result = Function("document", "setTimeout", `return ${forcing};`)(
      document, setTimeoutStub) as { status: string };

    expect(result.status).toBe("time-tab-reselected");
    expect(clicks).toEqual(["hom nay"]);
    for (const callback of scheduled) callback();
    expect(clicks).toEqual(["hom nay", "truc tiep42"]);
  });

  it("finds the period tab in either language", () => {
    // The group step passing is not enough: the period tab is named in the site
    // language too, and 24 tabs were present with none matching Vietnamese.
    expect(evaluate(["Football"], "live").status).not.toBe("time-tab-not-found");
    expect(evaluate(["Football"], "truc tiep").status).not.toBe("time-tab-not-found");
  });

  it("still refuses the promotional second football group in either language", () => {
    expect(evaluate(["Bóng đá 2"]).status).toBe("time-tab-not-found");
    expect(evaluate(["Football 2"]).status).toBe("time-tab-not-found");
  });
});
