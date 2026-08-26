import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { BTI_CATALOG_REFRESH_EXPRESSION, CMD_CATALOG_DISCOVERY_EXPRESSION,
  CMD_FULL_BASELINE_EXPRESSION, IM_CATALOG_DISCOVERY_EXPRESSION, KEEP_ACTIVE_EXPRESSION,
  NetworkObserver, type NetworkObserverDependencies, type PersistedSabaWsSnapshots } from "./network-observer.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;

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
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("'x-v': '91460'");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("'x-platform': String(window.global?.PlatForm || '')");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("sessionStorage.getItem('to' + 'ken')");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("new URLSearchParams(location.search).get('to' + 'ken')");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("credentials: 'omit'");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("SportId: 1");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("BetTypeIds: [1, 2, 3, 5]");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("GamePeriods: [1, 2, 3]");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("IsCombo: false");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("SortType: 2");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("CompetitionIds: []");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("for (const Market of [1, 2])");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("new AbortController()");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).toContain("signal: controller.signal");
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).not.toMatch(/odds?|price|stake/iu);
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
      expression: IM_CATALOG_DISCOVERY_EXPRESSION,
      returnByValue: true,
      awaitPromise: true
    });
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.evaluate", {
      expression: IM_CATALOG_DISCOVERY_EXPRESSION,
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

  it("evaluates CMD recovery on the owning child session and completes only a matching current-loader fc=1", async () => {
    const cmd = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
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
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "observer-cmd",
      cmdRecoveryMaxAttempts: 20, cmdRecoveryDeadlineMs: 2_000, cmdRecoveryRetryMs: 50 });
    await observer.handleEvent(cmd, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "odds-frame", isDefault: true } }
    }, "child-session");

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

    await completeRequest("matching-full", 1,
      JSON.stringify({ t: "105", a: true, data: [metadataRow], today: [row], f: [] }));
    await Promise.resolve();
    expect(settled).toBe(1);
    await recovery;
    await observer.handleEvent(cmd, "Network.loadingFinished", { requestId: "matching-full" }, "child-session");

    expect(settled).toBe(1);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
    expect(CMD_FULL_BASELINE_EXPRESSION).toContain("LoadFullRunningTodayData()");
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
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate") {
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

  it("captures TSPORT coverage without starting an unsupported socket-close or heap scan", async () => {
      const events: string[] = [];
      const snapshot = JSON.stringify([{ eventId: "event-1" },
        { __fieldlineSweep: { sweepId: "tsport-refresh-sweep", complete: true } }]);
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        params?: Record<string, unknown>, _sessionId?: string) => {
        if (method === "Page.getFrameTree") {
          return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
        }
        if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
        if (method === "Runtime.evaluate" && params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION) {
          return { result: { type: "string", value: snapshot } };
        }
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async (envelope) => {
        if (envelope.transport === "DOM_SNAPSHOT") events.push("sweep");
      }) });
      const provider = { lobby: "TSPORT", sourceId: "chrome:TSPORT:8", tabId: 8 } as const;
      await observer.handleEvent(provider, "Network.webSocketCreated", {
        requestId: "tsport-catalog", url: "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0"
      }, "tsport-child");
      await observer.handleEvent(provider, "Network.webSocketCreated", {
        requestId: "tsport-auxiliary", url: "wss://spws.agenate.com/ln/en/notifications"
      }, "tsport-child");
      events.length = 0;

      await observer.refreshCatalog(provider);

      expect(events).toEqual(["sweep"]);
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

    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(false);
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

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
    expect(sendCommand).toHaveBeenCalledWith(8, "Runtime.queryObjects", {
      prototypeObjectId: "socket-io-prototype", objectGroup: "fieldline-baseline-recovery-8"
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
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type"]],
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
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });
    sendCommand.mockClear();
    forward.mockClear();

    await observer.pollSabaDomChanges(saba, "sports.example");
    const cleanupCalls = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
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
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });

    await observer.pollSabaDomChanges(saba, "sports.example");
    await observer.pollSabaDomChanges(saba, "sports.example");
    await observer.pollSabaDomChanges(saba, "sports.example");

    expect(cleanupAttempts).toBe(2);
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
      expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(false);
      expect(sendCommand).not.toHaveBeenCalledWith(8, "Page.reload", expect.anything());
  });

  it("requests only IM prematch events in the next 48-hour UTC window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));
    try {
      const listeners = new Map<string, (event: { detail: string }) => void>();
      const requests: Array<Record<string, unknown>> = [];
      const windowStub = {
        global: { PlatForm: "web" },
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
          return { text: async () => JSON.stringify({ Market: request.Market, StatusCode: 100 }) };
        }
      );

      expect(requests).toHaveLength(2);
      expect(requests.map(({ DateFrom, DateTo, Market }) => ({ DateFrom, DateTo, Market }))).toEqual([
        { DateFrom: "2026/08/19", DateTo: "2026/08/21", Market: 1 },
        { DateFrom: "2026/08/19", DateTo: "2026/08/21", Market: 2 }
      ]);
      expect(result).toEqual({ status: "catalog-requested", responses: [
        { market: 1, body: '{"Market":1,"StatusCode":100}' },
        { market: 2, body: '{"Market":2,"StatusCode":100}' }
      ] });
    } finally {
      vi.useRealTimers();
    }
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

    await observer.refreshCatalog(ksport);

    expect(saveLegacyTemplate).not.toHaveBeenCalled();
    expect(refreshExpression).toContain(rawUrl);
    expect(refreshExpression).toContain(authorization);
    expect(forward.mock.calls.filter(([message]) => message.transport === "HTTP_RESPONSE")).toHaveLength(2);
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
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("/api/eventlist/asia/leagues/v2/1/live");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("/api/eventlist/asia/leagues/v2/1/prematch");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("/api/eventpage/events/");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("hideX25X75Selections=false");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("credentials: 'include'");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("cache: 'no-store'");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("X-Fieldline-Generation");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("slice(0, 12)");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).not.toMatch(/cookie|authorization|password/iu);
    expect(() => new Function(`return ${BTI_CATALOG_REFRESH_EXPRESSION}`)).not.toThrow();
  });

  it("forwards one complete BTI generation directly when CDP does not retain the fetch bodies", async () => {
    const generation = "bti:1720000000000:17";
    const responses = [
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
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

    expect(forwarded).toHaveLength(3);
    expect(forwarded.map(({ transport }) => transport)).toEqual([
      "HTTP_RESPONSE", "HTTP_RESPONSE", "HTTP_RESPONSE"
    ]);
    expect(forwarded.map(({ request }) => request.pathnameClass)).toEqual(responses.map(({ url }) => url));
    expect(forwarded.map(({ request }) => request.streamId)).toEqual([
      generation, generation, generation
    ]);
    expect(forwarded.map(({ payload }) => payload.body)).toEqual(responses.map(({ body }) => body));
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
        if (path.endsWith("/live")) return new Promise<never>(() => undefined);
        return Promise.resolve({ ok: true, json: async () => ({ serializedData: [] }) });
      };
      const evaluate = new Function("document", "location", "fetch", "localStorage",
        `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
          location: { pathname: string; hostname: string }, fetch: typeof fetcher,
          localStorage: { getItem: (_key: string) => null }) => Promise<string>;
      const refresh = evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" },
        fetcher, { getItem: () => null });
      await vi.advanceTimersByTimeAsync(5_001);
      await expect(refresh).resolves.toMatchObject({ status: "catalog-requested",
        responses: expect.arrayContaining([expect.objectContaining({
          url: "/api/eventlist/asia/leagues/v2/1/prematch/initial"
        })]) });
      const listRequests = requests.filter(({ path }) => path.startsWith("/api/eventlist/"));
      expect(listRequests).toHaveLength(3);
      expect(new Set(listRequests.map(({ generation }) => generation)).size).toBe(1);
      expect(listRequests[0]!.generation).toMatch(/^bti:\d+:\d+$/u);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the complete BTI list generation without waiting for slow detail requests", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league: unknown[] = [];
    league[12] = [["event-1"]];
    const fetcher = (path: string) => path.startsWith("/api/eventpage/")
      ? new Promise<never>(() => undefined)
      : Promise.resolve({ ok: true, status: 200,
        json: async () => ({ serializedData: [league] }) });
    const evaluate = new Function("document", "location", "fetch", "localStorage",
      `return ${BTI_CATALOG_REFRESH_EXPRESSION}`) as (document: { documentElement: typeof root },
        location: { pathname: string; hostname: string }, fetch: typeof fetcher,
        localStorage: { getItem: (_key: string) => null }) => Promise<unknown>;

    const refresh = evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" },
      fetcher, { getItem: () => null });

    await expect(Promise.race([refresh, new Promise((resolve) => setTimeout(() => resolve("timed-out"), 25))]))
      .resolves.toMatchObject({ status: "catalog-requested", responses: expect.any(Array) });
  });

  it("serializes BTI detail enrichment instead of starting a concurrent request burst", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = [["event-1"], ["event-2"], ["event-3"]];
    let activeDetails = 0;
    let maxActiveDetails = 0;
    const releases: Array<() => void> = [];
    const fetcher = (path: string) => {
      if (!path.startsWith("/api/eventpage/")) {
        return Promise.resolve({ ok: true, text: async () => JSON.stringify({ serializedData: [league] }) });
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
    expect(maxActiveDetails).toBe(1);
    for (let index = 0; index < 3; index += 1) {
      releases.shift()?.();
      if (index < 2) await vi.waitFor(() => expect(releases).toHaveLength(1));
      else await vi.waitFor(() => expect(activeDetails).toBe(0));
    }
    expect(maxActiveDetails).toBe(1);
  });

  it("retires slow BTI detail work when a newer list generation arrives", async () => {
    const root = { dataset: {} as Record<string, string> };
    const league = Array.from({ length: 13 }, () => null) as unknown[];
    league[12] = [["event-1"]];
    let detailRequests = 0;
    let activeBodies = 0;
    let maxActiveBodies = 0;
    const detailGenerations: string[] = [];
    const fetcher = async (path: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
      if (!path.startsWith("/api/eventpage/")) {
        return { ok: true, text: async () => JSON.stringify({ serializedData: [league] }) };
      }
      detailRequests += 1;
      detailGenerations.push(init?.headers?.["X-Fieldline-Generation"] ?? "");
      return { ok: true, text: async () => {
        activeBodies += 1;
        maxActiveBodies = Math.max(maxActiveBodies, activeBodies);
        if (detailRequests > 1) {
          activeBodies -= 1;
          return "";
        }
        return new Promise<string>((_resolve, reject) => init?.signal?.addEventListener("abort", () => {
          activeBodies -= 1;
          reject(new Error("retired-generation"));
        }, { once: true }));
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
    await vi.waitFor(() => expect(detailRequests).toBe(1));
    root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    const second = await evaluate({ documentElement: root }, location, fetcher, { getItem: () => null }) as {
      generation: string;
    };
    await vi.waitFor(() => expect(detailRequests).toBe(2));

    await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
      .__fieldlineBtiDetailWorkerV1).toBeUndefined());
    expect(first.generation).not.toBe(second.generation);
    expect(detailGenerations).toEqual([first.generation, second.generation]);
    expect(maxActiveBodies).toBe(1);
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
      league[12] = path.endsWith("/live")
        ? orders[Math.min(round, orders.length - 1)]!.map((id) => [id])
        : [];
      return { ok: true, json: async () => ({ serializedData: [league] }) };
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
      await evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" }, fetcher,
        { getItem: () => null });
      await vi.waitFor(() => expect(requestCounts[round]).toBe(7));
    }

    expect([...requested].sort()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(requestCounts).toEqual([7, 7, 7]);
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
      league[12] = path.endsWith("/live") ? orders[round]!.map((id) => [id]) : [];
      return { ok: true, json: async () => ({ serializedData: [league] }) };
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
      await evaluate({ documentElement: root }, { pathname: "/sports", hostname: "bti.test" }, fetcher,
        { getItem: () => null });
      await vi.waitFor(() => expect((root as unknown as Record<string, unknown>)
        .__fieldlineBtiDetailWorkerV1).toBeUndefined());
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

  it("captures SABA only after its page-side odds observer reports a price mutation", async () => {
    const records = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["3"], labels: ["2.5"],
        odds: [{ marketOddsId: `market-${index}`, priceText: "0.91", status: null, greyedOut: null },
          { marketOddsId: `market-${index}`, priceText: "0.99", status: null, greyedOut: null }] }]
    })));
    let dirty = false;
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation")) {
        return { result: { value: dirty } };
      }
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate") return { result: { value: records } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;

    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(forward).not.toHaveBeenCalled();
    const watcherExpression = String(sendCommand.mock.calls.find(([, method, params]) => method ===
      "Runtime.evaluate" && String(params?.expression).includes("fieldline-saba-odds-mutation"))?.[2]?.expression);
    expect(watcherExpression).toContain("characterData: true");
    expect(watcherExpression).toContain("'class'");
    expect(watcherExpression).toContain("'aria-disabled'");

    dirty = true;
    await observer.pollSabaDomChanges(saba, "sports.example");
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ lobby: "SABA", transport: "DOM_SNAPSHOT" }));
  });

  it("ignores SABA hover animation classes but observes semantic disabled transitions", async () => {
    let watcher = "";
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") watcher = String(params?.expression ?? "");
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

  it("does not let a blocked TSPORT lane delay BTI", async () => {
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

    const tsportMaintenance = observer.maintain(
      { lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9 }
    );
    await vi.waitFor(() => expect(startedTabs).toEqual([9]));
    const btiRefresh = observer.refreshCatalog(
      { lobby: "BTI", sourceId: "chrome:BTI:6", tabId: 6 }
    );
    await vi.waitFor(() => expect(startedTabs).toEqual([9, 6]));

    releaseFirstScan?.();
    await Promise.all([tsportMaintenance, btiRefresh]);
  });

  it("aborts a hung IM partition at the bounded deadline before a later generation starts", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, (event: { detail: string }) => void>();
      let aborted = false;
      const windowStub: Record<string, unknown> & { global: { PlatForm: string } } = {
        global: { PlatForm: "web" },
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
      await expect(pending).resolves.toEqual({ status: "request-timeout", responses: [] });
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
      opcode: 1, payloadData: '42["m","b1",[[0,"reset"],[0,"e"],[0,"done"]],"r1"]'
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
    const body = '42["m","b1",[[0,"reset"],[0,"e"],[0,"done"]],"r1"]';

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
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    const refresh = observer.refreshCatalog(ksport);
    await Promise.resolve();
    expect(sendCommand).toHaveBeenCalledTimes(1);
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

  it("starts a fresh TSPORT DOM baseline for a replacement epoch", async () => {
    const records = JSON.stringify([{ eventId: "replacement-event", markets: [] },
      { __fieldlineSweep: { sweepId: "tsport-replacement-sweep", complete: true } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
      if (method === "Runtime.evaluate") return { result: { type: "string", value: records } };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "worker-a" });
    const tsport = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;

    expect(observer.beginSourceEpoch(tsport.sourceId)).toBe("worker-a:1");
    await observer.refreshCatalog(tsport);

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sourceEpoch: "worker-a:1", sequence: 0, transport: "DOM_SNAPSHOT",
      payload: expect.objectContaining({ body: expect.stringContaining("replacement-event") })
    }));
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

  it("opens APSPORT's numeric and view-more detail controls without touching an odds-like control", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" } } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 19 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "TSPORT", sourceId: "chrome:TSPORT:19", tabId: 19 });

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

    expect(result).toMatchObject({ expanded: 3 });
    expect(clicks).toEqual(["27", "Các loại cược Châu Á khác", "Xem thêm (+1) các loại cược khác"]);
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
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50, observerSessionId: "observer-a"
    });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://sports.example/feed?token=secret"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
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
      request: expect.objectContaining({ hostname: "sports.example", pathnameClass: "/feed", streamId: "1" }),
      payload: { encoding: "UTF8", body: "{\"eventId\":1}" }
    }));
    await observer.handleEvent(source, "Network.webSocketClosed", { requestId: "ws-1" });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, transport: "WS_STATE", request: expect.objectContaining({ streamId: "1" }),
      payload: { encoding: "UTF8", body: '{"state":"CLOSED"}' }
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("secret");
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
      payload: { encoding: "UTF8", body: "{}" }
    }));
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
        framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0 },
      { kind: "WS_ATTACH", sourceGeneration: 0, webSocketCreated: 0, webSockets: 0,
        ksportTargets: 0, attachedTargets: 0,
        framesReceived: 0, framesOrphan: 0, framesForwarded: 0, ignoredSockets: 0,
        framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0 }
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

  it("carries the BTI refresh generation from request headers into the HTTP response envelope", async () => {
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

    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      lobby: "BTI", transport: "HTTP_RESPONSE",
      request: expect.objectContaining({ streamId: "bti:2000:7" })
    }));
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
      autoAttach: true, waitForDebuggerOnStart: false, flatten: true
    });
    const autoAttachCalls = sendCommand.mock.calls.filter(([, method]) => method === "Target.setAutoAttach");
    expect(autoAttachCalls.map(([, , params]) => params?.autoAttach)).toEqual([false, true]);
    const evaluateCall = sendCommand.mock.calls.find((call) => call[1] === "Runtime.evaluate");
    expect(evaluateCall?.[2]).toMatchObject({ returnByValue: true });
    expect(JSON.stringify(evaluateCall?.[2])).not.toMatch(/\.click\(|dispatchEvent|\[data-odds/iu);
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
        objectGroup: "fieldline-baseline-recovery-20"
      }));
    } finally {
      vi.useRealTimers();
    }
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
        expression: "window.WebSocket && window.WebSocket.prototype",
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
        expression: "window.WebSocket && window.WebSocket.prototype",
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
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward });
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "ws-1", url: "wss://sports.example/feed" });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "x".repeat(262_145) }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 2, payloadData: "YWJj" }
    });
    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1,
      transport: "WS_FRAME", payload: { encoding: "BASE64", body: "YWJj" } }));
  });

  it("serializes concurrent frames from one source without duplicating sequence numbers", async () => {
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
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://sports.example/feed"
    });

    const first = observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "{\"price\":1.9}" }
    });
    const second = observer.handleEvent(source, "Network.webSocketFrameReceived", {
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
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type"]], [0, "reset"],
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
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(true);
    expect(sendCommand.mock.calls.find(([, method]) => method === "Runtime.callFunctionOn")?.[2])
      .toMatchObject({ functionDeclaration: expect.stringContaining("socket.disconnect(); socket.connect()") });
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

    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.callFunctionOn")).toBe(false);
    expect(sendCommand).toHaveBeenCalledWith(13, "Runtime.releaseObjectGroup", {
      objectGroup: "fieldline-baseline-recovery-13"
    });
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

  it("retries a missed SABA orphan reconnect after five seconds without a frame-driven storm", async () => {
    const now = { value: 1_000 };
    const sendCommand = vi.fn(async (_tabId: number, _method: string,
      _params?: Record<string, unknown>, _sessionId?: string) => ({}));
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
    expect(attempts()).toBe(2);
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

    expect(sendCommand.mock.calls.filter(([, method, params]) => method === "Runtime.evaluate" &&
      params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION)).toHaveLength(1);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(true);
    expect(sendCommand.mock.calls.find(([, method]) => method === "Runtime.callFunctionOn")?.[2])
      .toMatchObject({ functionDeclaration: expect.stringContaining("/\\/socket\\.io\\/?$/u") });
    expect(sendCommand).not.toHaveBeenCalledWith(13, "Page.reload", expect.anything());
  });

  it("does not change SABA time filters while requesting a recovery snapshot", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && typeof params?.expression === "string" &&
        params.expression.includes("fieldline-saba-time-baseline")) {
        return { result: { value: { status: "requested", clicked: ["truc tiep", "hom nay"] } } };
      }
      if (method === "Runtime.evaluate") return { result: { value: "1787250000000.5" } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      now: () => 10_000, monotonicNow: () => 60 });
    const saba = { lobby: "SABA", sourceId: "chrome:SABA:13", tabId: 13 } as const;

    await observer.refreshCatalog(saba);

    expect(sendCommand.mock.calls.some(([, method, params]) => method === "Runtime.evaluate" &&
      typeof params?.expression === "string" && params.expression.includes("fieldline-saba-time-baseline"))).toBe(false);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(false);
  });

  it("takes only two bounded SABA DOM snapshots without changing the current provider view", async () => {
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
      typeof params?.expression === "string" && params.expression.includes("fieldline-saba-time-baseline"))).toBe(false);
    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.queryObjects")).toBe(false);
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
        if (method === "Runtime.evaluate" && expression.includes("window.WebSocket")) {
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

    it("keeps four-second HTTP authority and bounded WS recovery while the catalog socket is missing", async () => {
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
      expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(2);
    });

    it("keeps four-second HTTP authority and bounded WS recovery after the socket turns silent", async () => {
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
      expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(2);
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

      now.value = 20_000;
      await observer.maintainKsportFeed(ksport);
      expect(fullRecoveryCalls()).toBe(0);

      now.value = 40_000;
      await observer.maintainKsportFeed(ksport);
      expect(fullRecoveryCalls()).toBeGreaterThan(0);
      const afterFirst = fullRecoveryCalls();

      now.value = 43_000;
      await observer.maintainKsportFeed(ksport);
      expect(fullRecoveryCalls()).toBe(afterFirst);

      now.value = 45_000;
      await observer.maintainKsportFeed(ksport);
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

  it("selects KSPORT today once live is present, then restores the live tab after baseline completion", async () => {
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
    await expect(observer.ensureCompleteKsportBaseline(source)).resolves.toBe(true);
    expect(String(sendCommand.mock.calls.at(-1)?.[2]?.expression)).toContain("truc tiep");
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
    await observer.handleEvent(ksport, "Network.webSocketFrameReceived", { requestId: "sports",
      response: { opcode: 1, payloadData: live } });
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
