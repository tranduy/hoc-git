import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION } from "./saba-catalog-discovery.js";
import { NetworkObserver } from "./network-observer.js";
import { SABA_NAVIGATION_PROBE_READ_EXPRESSION } from "./saba-navigation-probe.js";

const SABA = { lobby: "SABA", sourceId: "chrome:SABA:10", tabId: 10 } as const;
const FAILURE_PATH = "/__fieldline_saba_catalog_discovery_failure__";

function frameTree(frameIds: readonly string[]): unknown {
  const [root = "top", ...children] = frameIds;
  return { frameTree: { frame: { id: root },
    childFrames: children.map((id) => ({ frame: { id } })) } };
}

describe("SABA public discovery failure diagnostics", () => {
  it("reports bounded allowlisted outcomes from only the existing root and frame reads", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" &&
        params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
        const contextId = params.contextId;
        if (contextId === 106) return { exceptionDetails: { text: "private provider detail" } };
        return {};
      }
      if (method === "Page.getFrameTree") {
        return frameTree(["top", "detached", "target", "context", "timeout", "unknown", "exception",
          "no-result"]);
      }
      if (method === "Page.createIsolatedWorld") {
        switch (params?.frameId) {
          case "detached": throw new Error("Debugger is not attached to the tab");
          case "target": throw new Error("No target with given id found");
          case "context": throw new Error("Execution context was destroyed");
          case "timeout": throw new Error("frame-command-timeout");
          case "unknown": throw new Error("secret opaque provider failure");
          case "exception": return { executionContextId: 106 };
          case "no-result": return { executionContextId: 107 };
          default: return {};
        }
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => 10_000, monotonicNow: () => 20 });

    await observer.pollSabaDomChanges(SABA, "sports.example");
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === FAILURE_PATH)).toBe(true));

    const envelope = forwarded.find(({ request }) => request.pathnameClass === FAILURE_PATH)!;
    const body = JSON.parse(envelope.payload.body);
    expect(envelope).toMatchObject({ lobby: "SABA", sourceId: SABA.sourceId,
      transport: "TAB_STATE", request: { resourceType: "Diagnostic", pathnameClass: FAILURE_PATH } });
    expect(body).toEqual({ kind: "SABA_PUBLIC_CATALOG_DISCOVERY_FAILURE", version: 1,
      attempts: { evaluate: 3, frameTree: 1, isolatedWorld: 7 },
      outcomes: { DETACHED: 1, TARGET_GONE: 1, CONTEXT_GONE: 1, TIMEOUT: 1,
        EVALUATION_EXCEPTION: 1, NO_RESULT: 2, UNKNOWN: 1 } });
    expect(envelope.payload.body).not.toContain("secret opaque provider failure");
    expect(envelope.payload.body).not.toContain("private provider detail");
  });

  it("paces failures at the existing interval and drops a retired generation", async () => {
    const now = { value: 10_000 };
    const forwarded: ChromeBridgeEnvelope[] = [];
    let discoveryCalls = 0;
    let release!: (value: unknown) => void;
    const held = new Promise<unknown>((resolve) => { release = resolve; });
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      if (method === "Runtime.evaluate" &&
        params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
        discoveryCalls += 1;
        return discoveryCalls === 1 ? held : {};
      }
      if (method === "Page.getFrameTree") return frameTree(["top"]);
      return {};
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now.value, monotonicNow: () => now.value });

    await observer.pollSabaDomChanges(SABA, "sports.example");
    observer.beginSourceEpoch(SABA.sourceId);
    release({});
    await vi.waitFor(() => expect(discoveryCalls).toBe(1));
    await Promise.resolve();
    expect(forwarded.some(({ request }) => request.pathnameClass === FAILURE_PATH)).toBe(false);

    await observer.pollSabaDomChanges(SABA, "sports.example");
    await vi.waitFor(() => expect(forwarded.filter(({ request }) =>
      request.pathnameClass === FAILURE_PATH)).toHaveLength(1));
    now.value += 29_999;
    await observer.pollSabaDomChanges(SABA, "sports.example");
    expect(discoveryCalls).toBe(2);
    now.value += 1;
    await observer.pollSabaDomChanges(SABA, "sports.example");
    await vi.waitFor(() => expect(discoveryCalls).toBe(3));
  });

  it.each(["frame-tree", "isolated-world"] as const)(
    "stops discovery commands after retirement while awaiting %s",
    async (heldStage) => {
      const forwarded: ChromeBridgeEnvelope[] = [];
      let discoveryStarted = false;
      let release!: (value: unknown) => void;
      let entered!: () => void;
      const held = new Promise<unknown>((resolve) => { release = resolve; });
      const stageEntered = new Promise<void>((resolve) => { entered = resolve; });
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        params?: Record<string, unknown>) => {
        if (method === "Runtime.evaluate" &&
          params?.expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
          discoveryStarted = true;
          return {};
        }
        if (method === "Page.getFrameTree" && discoveryStarted) {
          if (heldStage === "frame-tree") {
            entered();
            return held;
          }
          return frameTree(["top", "child"]);
        }
        if (method === "Page.createIsolatedWorld" &&
          params?.worldName === "fieldline-saba-public-discovery") {
          entered();
          return held;
        }
        if (method === "Runtime.evaluate" && params?.expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
          return { result: { value: "[]" } };
        }
        if (method === "Page.getFrameTree") return frameTree(["top"]);
        return {};
      });
      const observer = new NetworkObserver({ sendCommand,
        forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }) });

      await observer.pollSabaDomChanges(SABA, "sports.example");
      await stageEntered;
      observer.beginSourceEpoch(SABA.sourceId);
      release(heldStage === "frame-tree" ? frameTree(["top", "child"]) : { executionContextId: 77 });
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

      const discoveryWorlds = sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Page.createIsolatedWorld" &&
        (params as Record<string, unknown> | undefined)?.worldName === "fieldline-saba-public-discovery");
      const childEvaluations = sendCommand.mock.calls.filter(([, method, params]) =>
        method === "Runtime.evaluate" &&
        (params as Record<string, unknown> | undefined)?.expression ===
          SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION &&
        (params as Record<string, unknown> | undefined)?.contextId === 77);
      expect(discoveryWorlds).toHaveLength(heldStage === "frame-tree" ? 0 : 1);
      expect(childEvaluations).toHaveLength(0);
      expect(forwarded.some(({ request }) => request.pathnameClass === FAILURE_PATH)).toBe(false);
    }
  );

  it("serializes a held discovery with the next poll and its queued probe", async () => {
    const now = { value: 10_000 };
    const forwarded: ChromeBridgeEnvelope[] = [];
    let mutationCalls = 0;
    let catalogCalls = 0;
    let releaseDiscovery!: (value: unknown) => void;
    let discoveryEntered!: () => void;
    const heldDiscovery = new Promise<unknown>((resolve) => { releaseDiscovery = resolve; });
    const sawDiscovery = new Promise<void>((resolve) => { discoveryEntered = resolve; });
    const records = JSON.stringify(Array.from({ length: 60 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: "League", matchId: `match-${index}`,
      timeText: "11:00PM", teamNames: ["Home", "Away"], groups: []
    })));
    const unknownProbe = { documentToken: "doc", rowCount: 60, tableCount: 1,
      activePeriod: "UNKNOWN", periodControls: [], eligibleMoreCount: 0, eligibleMoreOwners: [],
      moreCandidates: [], rosterMatchIds: ["match-0"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], fingerprint: "unknown", truncated: false };
    let holdNextDiscovery = true;
    const sendCommand = vi.fn(async (_tabId: number, method: string,
      params?: Record<string, unknown>) => {
      const expression = params?.expression;
      if (method === "Runtime.evaluate" && expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
        if (holdNextDiscovery) {
          holdNextDiscovery = false;
          discoveryEntered();
          return heldDiscovery;
        }
        return {};
      }
      if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
        catalogCalls += 1;
        return { result: { value: catalogCalls === 1 ? "[]" : records } };
      }
      if (method === "Runtime.evaluate" && expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        return { result: { value: unknownProbe } };
      }
      if (method === "Runtime.evaluate" && String(expression).includes("fieldline-saba-odds-mutation")) {
        mutationCalls += 1;
        return { result: { value: true } };
      }
      if (method === "Page.getFrameTree") return {};
      return {};
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: vi.fn(async (envelope: ChromeBridgeEnvelope) => { forwarded.push(envelope); }),
      now: () => now.value, monotonicNow: () => now.value });

    await observer.pollSabaDomChanges(SABA, "sports.example");
    await sawDiscovery;
    const mutationCallsBeforeQueuedPoll = mutationCalls;
    now.value += 5_000;
    let queuedPollComplete = false;
    const queuedPoll = observer.pollSabaDomChanges(SABA, "sports.example")
      .then(() => { queuedPollComplete = true; });
    await Promise.resolve();

    expect(mutationCalls).toBe(mutationCallsBeforeQueuedPoll);
    expect(queuedPollComplete).toBe(false);

    releaseDiscovery({});
    await queuedPoll;
    await vi.waitFor(() => expect(forwarded.some(({ request }) =>
      request.pathnameClass === "/__fieldline_saba_navigation_probe__")).toBe(true));
    expect(forwarded.map(({ sequence }) => sequence)).toEqual(
      forwarded.map((_envelope, index) => index));
    expect(forwarded.map(({ request }) => request.pathnameClass)).toEqual([
      FAILURE_PATH,
      "/__fieldline_dom_snapshot__",
      "/__fieldline_saba_navigation_probe__"
    ]);
  });

  it("releases a queued DOM poll after the five-second total discovery budget", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      let discoveryStarted = false;
      let discoveryTreeServed = false;
      let mutationCalls = 0;
      const discoveryWorlds: string[] = [];
      const sendCommand = vi.fn(async (_tabId: number, method: string,
        params?: Record<string, unknown>) => {
        const expression = params?.expression;
        if (method === "Runtime.evaluate" && expression === SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) {
          discoveryStarted = true;
          return {};
        }
        if (method === "Runtime.evaluate" && String(expression).includes("fieldline-saba-odds-mutation")) {
          mutationCalls += 1;
          return { result: { value: true } };
        }
        if (method === "Runtime.evaluate" && expression === CMD_PUBLIC_CATALOG_EXPRESSION) {
          return { result: { value: "[]" } };
        }
        if (method === "Page.getFrameTree" && discoveryStarted && !discoveryTreeServed) {
          discoveryTreeServed = true;
          return frameTree(["top", ...Array.from({ length: 12 }, (_, index) => `child-${index}`)]);
        }
        if (method === "Page.createIsolatedWorld" &&
          params?.worldName === "fieldline-saba-public-discovery") {
          discoveryWorlds.push(String(params.frameId));
          return new Promise<never>(() => undefined);
        }
        if (method === "Page.getFrameTree") return {};
        return {};
      });
      const observer = new NetworkObserver({ sendCommand, frameCommandTimeoutMs: 2_500,
        forward: vi.fn(async () => undefined), now: () => Date.now(), monotonicNow: () => Date.now() });

      await observer.pollSabaDomChanges(SABA, "sports.example");
      await vi.waitFor(() => expect(discoveryWorlds).toEqual(["child-0"]));
      const mutationCallsBeforeQueuedPoll = mutationCalls;
      let queuedPollComplete = false;
      const queuedPoll = observer.pollSabaDomChanges(SABA, "sports.example")
        .then(() => { queuedPollComplete = true; });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(discoveryWorlds).toEqual(["child-0", "child-1"]);
      expect(mutationCalls).toBe(mutationCallsBeforeQueuedPoll + 1);
      expect(queuedPollComplete).toBe(true);
      await queuedPoll;
    } finally { vi.useRealTimers(); }
  });
});
