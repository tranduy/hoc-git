import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { SabaRecoveryBudget } from "./saba-recovery-budget.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;
function recoveryCommands(query: () => Promise<unknown> = async () => ({ objects: { objectId: "instances" } })) {
  return vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Runtime.evaluate" && String(params?.expression).includes("Socket.prototype")) {
      return { result: { objectId: "prototype" } };
    }
    if (method === "Runtime.queryObjects") return query();
    if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
    return {};
  });
}
const orphan = (observer: NetworkObserver) => observer.handleEvent(source, "Network.webSocketFrameReceived", {
  requestId: "surviving-socket", response: { opcode: 1, payloadData: "2" }
});
afterEach(() => vi.useRealTimers());

function freshDomRecords(): string {
  return JSON.stringify(Array.from({ length: 50 }, (_, index) => ({
      sportId: "1", leagueId: "league", leagueName: "League", matchId: `match-${index}`,
      timeText: "LIVE", teamNames: ["Home", "Away"], groups: [{
        betTypeIds: ["3"], labels: ["2.5"], odds: [
          { marketOddsId: `home-${index}`, priceText: "0.91" },
          { marketOddsId: `away-${index}`, priceText: "0.99" }
        ]
      }]
  })));
}

describe("SABA maintenance", () => {
  it.each(["root", "iframe", "worker"] as const)(
    "recovers a missing socket baseline despite a fresh partial DOM: %s", async (targetType) => {
    let now = 5_000;
    const records = freshDomRecords();
    const recovery = recoveryCommands();
    const sendCommand = vi.fn(async (tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: records } };
      }
      return recovery(tab, method, params);
    });
    const budget = new SabaRecoveryBudget({ now: () => now });
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined,
      now: () => now, sabaRecoveryBudget: budget });
    if (targetType !== "root") await observer.handleEvent(source, "Target.attachedToTarget", {
      sessionId: "child", targetInfo: { targetId: "child-target", type: targetType }
    });
    await observer.pollSabaDomChanges(source, "sports.example");
    expect(observer.hasUsableSabaCatalog(source.sourceId)).toBe(true);
    await orphan(observer);
    const initialQueries = 1;
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects")).toHaveLength(initialQueries);
    expect(budget.snapshot().attempts).toBe(initialQueries);
    now += 30_001;
    await orphan(observer);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects")).toHaveLength(initialQueries + 1);
    expect(budget.snapshot().attempts).toBe(initialQueries + 1);
  });

  it.each(["prototype", "query"] as const)(
    "does not let a new partial DOM cancel admitted socket recovery: %s", async (boundary) => {
    let prototypeStarted = false;
    let catalogReady = false;
    let releasePrototype!: (value: unknown) => void;
    const prototype = new Promise<unknown>(resolve => { releasePrototype = resolve; });
    const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { value: catalogReady ? freshDomRecords() : "[]" } };
      }
      if (method === "Runtime.evaluate" && String(params?.expression).includes("Socket.prototype")) {
        if (boundary === "prototype") { prototypeStarted = true; return prototype; }
        return { result: { objectId: "prototype" } };
      }
      if (method === "Runtime.queryObjects") {
        prototypeStarted = true;
        return boundary === "query" ? prototype : { objects: { objectId: "instances" } };
      }
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const budget = new SabaRecoveryBudget({ now: () => 5_000 });
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined,
      now: () => 5_000, sabaRecoveryBudget: budget });
    await observer.refreshCatalog(source);
    try {
      await vi.waitFor(() => expect(prototypeStarted).toBe(true));
      catalogReady = true;
      await observer.pollSabaDomChanges(source, "sports.example");
      expect(observer.hasUsableSabaCatalog(source.sourceId)).toBe(true);
    } finally { releasePrototype(boundary === "prototype" ? { result: { objectId: "prototype" } }
      : { objects: { objectId: "instances" } }); }
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method]) =>
      method === "Runtime.releaseObjectGroup")).toBe(true));
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects"))
      .toHaveLength(1);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(1);
    expect(budget.snapshot().attempts).toBe(1);
  });

  it("caps each recovery at three physical scans and resumes at the remaining socket owners", async () => {
    let now = 1_000;
    const scans: string[] = [];
    const closed: string[] = [];
    const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" && String(params?.expression).includes("Socket.prototype")) {
        return { result: { objectId: `${params?.contextId}:${String(params?.expression).includes("WebSocket") ? "native" : "io"}` } };
      }
      if (method === "Runtime.queryObjects") {
        scans.push(String(params?.prototypeObjectId));
        return { objects: { objectId: params?.prototypeObjectId } };
      }
      if (method === "Runtime.callFunctionOn") {
        if (params?.objectId === "3:native") { closed.push(String(params.objectId)); return { result: { value: 1 } }; }
        return { result: { value: 0 } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => now });
    for (const id of [1, 2, 3]) await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id, auxData: { frameId: `frame-${id}`, isDefault: true } }
    });
    await orphan(observer);
    expect(scans).toHaveLength(3);
    expect(closed).toHaveLength(0);
    now += 30_000;
    await orphan(observer);
    expect(scans).toHaveLength(6);
    expect(new Set(scans).size).toBe(6);
    expect(closed).toEqual(["3:native"]);
  });

  it("preserves a live complete socket but does not let its old baseline prove liveness forever", async () => {
    let now = 1_000;
    const sendCommand = recoveryCommands();
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => now });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "current", url: "wss://sports.example/socket.io/"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "current", response: { opcode: 1, payloadData:
        `42${JSON.stringify(["m", "b1", [["c", "c2"], ["f", 0, ["type", "matchid"]],
          [0, "reset"], [0, "o"], [0, "done"]], "r1"])}` }
    });
    expect(observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
    expect(observer.hasResponsiveSabaDocument(source.sourceId)).toBe(true);
    await observer.refreshCatalog(source);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects")).toHaveLength(0);
    now += 30_001;
    expect(observer.hasCompleteSabaBaseline(source.sourceId)).toBe(true);
    expect(observer.hasResponsiveSabaDocument(source.sourceId)).toBe(false);
  });

  it("coalesces bootstrap callers and cancels delayed work when the source changes", async () => {
    vi.useFakeTimers();
    const observer = new NetworkObserver({ sendCommand: recoveryCommands(), forward: async () => undefined });
    const refresh = vi.spyOn(observer, "refreshCatalog").mockResolvedValue(undefined);
    const first = observer.bootstrapSabaCatalog(source);
    const second = observer.bootstrapSabaCatalog(source);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    observer.beginSourceEpoch(source.sourceId);
    await vi.advanceTimersByTimeAsync(50_000);
    await Promise.all([first, second]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shares three paced heavy recoveries across repeated orphan and refresh requests", async () => {
    let now = 1_000;
    const sendCommand = recoveryCommands();
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => now });
    const queries = () => sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects").length;
    await orphan(observer);
    expect(queries()).toBe(1);
    now += 5_000;
    await orphan(observer);
    expect(queries()).toBe(1);
    now = 31_000;
    await orphan(observer);
    now = 61_000;
    await orphan(observer);
    expect(queries()).toBe(3);
    now = 100_000;
    await observer.refreshCatalog(source);
    await orphan(observer);
    expect(queries()).toBe(3);
    now = 361_000;
    await orphan(observer);
    expect(queries()).toBe(4);
  });

  it("keeps ownership of a timed-out heap query until Chrome actually settles it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let resolveQuery!: (value: unknown) => void;
    const pending = new Promise<unknown>(resolve => { resolveQuery = resolve; });
    const sendCommand = recoveryCommands(() => pending);
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined, frameCommandTimeoutMs: 10 });
    const first = orphan(observer);
    await vi.advanceTimersByTimeAsync(10_100);
    const queries = () => sendCommand.mock.calls.filter(([, method]) => method === "Runtime.queryObjects").length;
    try {
      expect(queries()).toBe(1);
      observer.beginSourceEpoch(source.sourceId);
      await vi.advanceTimersByTimeAsync(30_000);
      const retry = orphan(observer);
      await vi.advanceTimersByTimeAsync(0);
      expect(queries()).toBe(1);
      resolveQuery({ objects: { objectId: "late-instances" } });
      await vi.advanceTimersByTimeAsync(0);
      await Promise.all([first, retry]);
      expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(0);
      expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.releaseObjectGroup")).toBe(true);
    } finally {
      resolveQuery({ objects: { objectId: "late-instances" } });
      await vi.advanceTimersByTimeAsync(20_000);
      await first;
    }
  });
});
