import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { BTI_CATALOG_REFRESH_EXPRESSION, CMD_CATALOG_DISCOVERY_EXPRESSION,
  IM_CATALOG_DISCOVERY_EXPRESSION, KEEP_ACTIVE_EXPRESSION, NetworkObserver } from "./network-observer.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;

describe("NetworkObserver", () => {
  it("keeps provider pages active and scrolls their real nested frames without clicking odds", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" }, childFrames: [{ frame: { id: "child" } }] } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 9 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain(source);

    expect(sendCommand).toHaveBeenCalledWith(7, "Emulation.setFocusEmulationEnabled", { enabled: true });
    expect(sendCommand).toHaveBeenCalledWith(7, "Page.setWebLifecycleState", { state: "active" });
    const evaluations = sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate");
    expect(evaluations).toHaveLength(2);
    expect(String(evaluations[0]?.[2]?.expression)).toContain("scrollHeight");
    expect(String(evaluations[0]?.[2]?.expression)).toContain("unsafeSelector");
    expect(String(evaluations[0]?.[2]?.expression)).toContain("slice(0, 12)");
  });

  it("refreshes only IM's public football/live navigation without touching an odds cell", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, _params?: Record<string, unknown>) => method === "Page.getFrameTree"
      ? { frameTree: { frame: { id: "top" } } }
      : method === "Page.createIsolatedWorld" ? { executionContextId: 9 } : {});
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });

    await observer.maintain({ lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 });

    const evaluation = sendCommand.mock.calls.find(([, method]) => method === "Runtime.evaluate");
    expect(evaluation?.[2]?.expression).toBe(IM_CATALOG_DISCOVERY_EXPRESSION);
    // IM's request signer and platform globals live in the page's main world.
    // An isolated world can see the DOM but cannot call that signer, which
    // silently leaves the catalog on StatusCode 500 responses.
    expect(evaluation?.[2]).not.toHaveProperty("contextId");
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
    expect(IM_CATALOG_DISCOVERY_EXPRESSION).not.toMatch(/odds?|price|stake/iu);
    expect(() => new Function(`return ${IM_CATALOG_DISCOVERY_EXPRESSION}`)).not.toThrow();
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
        `return ${IM_CATALOG_DISCOVERY_EXPRESSION}`) as (...args: unknown[]) => string;

      expect(execute(
        { documentElement: { dataset: {} }, querySelectorAll: () => [] },
        { hostname: "imsports.directsb.net", search: "" },
        windowStub,
        { getItem: () => "token" },
        class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
          get detail(): { c: string } { return this.init.detail; } },
        async (_path: string, init: { body: string }) => { requests.push(JSON.parse(init.body)); return {}; }
      )).toBe("catalog-requested");
      await vi.runAllTimersAsync();

      expect(requests).toHaveLength(2);
      expect(requests.map(({ DateFrom, DateTo, Market }) => ({ DateFrom, DateTo, Market }))).toEqual([
        { DateFrom: "2026/08/19", DateTo: "2026/08/21", Market: 1 },
        { DateFrom: "2026/08/19", DateTo: "2026/08/21", Market: 2 }
      ]);
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
    expect(BTI_CATALOG_REFRESH_EXPRESSION).toContain("slice(0, 12)");
    expect(BTI_CATALOG_REFRESH_EXPRESSION).not.toMatch(/cookie|authorization|password/iu);
    expect(() => new Function(`return ${BTI_CATALOG_REFRESH_EXPRESSION}`)).not.toThrow();
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
      frameCommandTimeoutMs: 10 });
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

  it("captures a complete T-Sports DOM baseline instead of waiting for WebSocket price deltas", async () => {
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain(".match__team-name");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain("25|5|75");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain("CORNER_");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain("CARD_");
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).toContain('secondHalf ? "SH"');
    expect(TSPORT_PUBLIC_CATALOG_EXPRESSION).not.toMatch(/cookie|localStorage|sessionStorage|password|token/iu);
    expect(() => new Function(`return ${TSPORT_PUBLIC_CATALOG_EXPRESSION}`)).not.toThrow();
    const records = JSON.stringify([{ eventId: "event-1", leagueName: "League", timeText: "LIVE",
      scoreText: "0 - 0", teamNames: ["Home", "Away"], markets: [{ marketId: "market-1",
        marketType: "FT_AH", lineText: "-0.5", selections: [
          { selectionId: "home", selection: "HOME", priceText: "0.82", locked: false, lineText: "-0.5" },
          { selectionId: "away", selection: "AWAY", priceText: "-0.9", locked: false, lineText: "+0.5" }
        ] }] }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
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

  it("retrieves allow-listed XHR bodies only after loadingFinished and isolates body failure", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getResponseBody") return { body: "{\"odds\":1.95}", base64Encoded: false };
      return {};
    });
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });
    await observer.handleEvent(source, "Network.responseReceived", {
      requestId: "xhr-1", type: "XHR", response: { url: "https://sports.example/api/odds?token=secret", mimeType: "application/json" }
    });
    expect(forward).not.toHaveBeenCalled();
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "xhr-1" });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "HTTP_RESPONSE", sequence: 0 }));

    sendCommand.mockRejectedValueOnce(new Error("body unavailable"));
    await observer.handleEvent(source, "Network.responseReceived", {
      requestId: "xhr-2", type: "Fetch", response: { url: "https://sports.example/api/feed", mimeType: "application/json" }
    });
    await expect(observer.handleEvent(source, "Network.loadingFinished", { requestId: "xhr-2" })).resolves.toBeUndefined();
    expect(forward).toHaveBeenCalledTimes(1);
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
      request: { url: "https://imsports.directsb.net/api/EventV6/GetSE",
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

  it("redacts and forwards a large UTF8 HTTP response as ordered wire-safe chunks", async () => {
    const largeBody = JSON.stringify({ StatusCode: 100, token: "super-secret",
      sel: Array.from({ length: 5_000 }, (_, index) => ({ eid: index + 1, name: `event-${index}`, pad: "x".repeat(80) })) });
    const sendCommand = vi.fn(async (_tabId: number, method: string) => method === "Network.getResponseBody"
      ? { body: largeBody, base64Encoded: false }
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 50 });

    await observer.handleEvent({ lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 }, "Network.responseReceived", {
      requestId: "xhr-large", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE", mimeType: "application/json" }
    });
    await observer.handleEvent({ lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 },
      "Network.loadingFinished", { requestId: "xhr-large" });

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

  it("queues every snapshot chunk before later delta traffic can interleave", async () => {
    const snapshot = JSON.stringify({ StatusCode: 100,
      sel: Array.from({ length: 5_000 }, (_, index) => ({ eid: index, pad: "x".repeat(80) })) });
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method !== "Network.getResponseBody") return {};
      return { body: params?.requestId === "snapshot" ? snapshot : '{"StatusCode":100,"dc":[]}',
        base64Encoded: false };
    });
    const observer = new NetworkObserver({ sendCommand, forward: async (envelope) => {
      forwarded.push(envelope);
      if (envelope.sequence === 0) await firstBlocked;
    }, now: () => 1_000, monotonicNow: () => 50 });
    const im = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(im, "Network.responseReceived", { requestId: "snapshot", type: "XHR",
      response: { url: "https://imsports.directsb.net/api/EventV6/GetSE" } });
    const snapshotRead = observer.handleEvent(im, "Network.loadingFinished", { requestId: "snapshot" });
    await Promise.resolve();
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
    const evaluateCall = sendCommand.mock.calls.find((call) => call[1] === "Runtime.evaluate");
    expect(evaluateCall?.[2]).toMatchObject({ returnByValue: true });
    expect(JSON.stringify(evaluateCall?.[2])).not.toMatch(/\.click\(|dispatchEvent|\[data-odds/iu);
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
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let now = 1_000;
    const observer = new NetworkObserver({ sendCommand, forward, now: () => now, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "snapshot",
      request: { url: "https://imsports.directsb.net/api/EventV6/GetSE",
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
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 1_000, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    for (const market of [1, 2] as const) {
      const requestId = `snapshot-${market}`;
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId,
        request: { url: "https://imsports.directsb.net/api/EventV6/GetSE",
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
      : {});
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ sendCommand, forward, now: () => 2_000, monotonicNow: () => 60 });
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
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
      '{"StatusCode":100,"sel":[]}');

    expect(sendCommand).not.toHaveBeenCalled();
    expect(forward.mock.calls.map(([message]) => message.transport)).toEqual(["WS_FRAME", "HTTP_RESPONSE"]);
    expect(forward.mock.calls.map(([message]) => message.sequence)).toEqual([0, 1]);
  });
});
