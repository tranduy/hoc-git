import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CMD_FULL_BASELINE_EXPRESSION, NetworkObserver } from "./network-observer.js";
import { CmdPageKeepalive } from "./cmd-page-keepalive.js";

const source = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
const url = "https://cgnew.fts368.com/Member/BetsView/BetLight/DataOdds.ashx";
const fullScope = "fc=1&TimeFilter=0&m_gameType=S_&SingleDouble=double&m_sp=0&m_LeagueList=&fav=&keywords=&exlist=0";
const row = Array<unknown>(91).fill(null);
Object.assign(row, { 0: 25299763, 3: 108007, 10: 0.25, 12: 2.5, 25: 1,
  37: "League", 38: "Home", 39: "Away", 40: 0.8, 41: -0.9, 42: 0.8, 43: -0.9,
  53: "1H 4", 56: "08/24", 79: 0 });
const body = JSON.stringify({ t: 100, a: true, data: [], today: [row], f: [] });

function harness(options: { body?: string; forward?: (value: ChromeBridgeEnvelope) => Promise<void> } = {}) {
  const forward = vi.fn(options.forward ?? (async (_value: ChromeBridgeEnvelope) => undefined));
  const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "odds", loaderId: "current",
      url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx" } } };
    if (method === "Network.getResponseBody") return { body: options.body ?? body, base64Encoded: false };
    if (method === "Runtime.evaluate" && params?.expression === CMD_FULL_BASELINE_EXPRESSION)
      return { result: { value: "baseline-requested" } };
    return {};
  });
  const observer = new NetworkObserver({ sendCommand, forward, observerSessionId: "cmd-health",
    now: () => Date.now(), cmdRecoveryDeadlineMs: 100, cmdRecoveryRetryMs: 10, cmdRecoveryMaxAttempts: 20 });
  const request = async (postData = fullScope, loaderId = "current") => {
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "full", type: "XHR",
      frameId: "odds", loaderId, request: { url, method: "POST", postData } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "full", type: "XHR",
      response: { url, mimeType: "application/json", status: 200 } });
  };
  const finish = () => observer.handleEvent(source, "Network.loadingFinished", { requestId: "full" });
  return { observer, forward, sendCommand, request, finish };
}

describe("CMD completed baseline health", () => {
  afterEach(() => vi.useRealTimers());

  it.each([false, true])("defers keepalive for a complete current full independently of recovery deadline (expired=%s)", async expired => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const h = harness();
    await h.observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 7, auxData: { frameId: "odds", isDefault: true } }
    });
    const recovery = expired ? h.observer.recoverCmdCatalog(source) : null;
    if (recovery !== null) await vi.advanceTimersByTimeAsync(1);
    await h.request();
    if (recovery !== null) { await vi.advanceTimersByTimeAsync(100); await recovery; }
    const receiptAtMs = Date.now();
    await h.finish();
    expect(h.forward).toHaveBeenCalledWith(expect.objectContaining({ transport: "HTTP_RESPONSE",
      request: expect.objectContaining({ cmdFullScope: true, providerFunctionCode: 1 }) }));
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, receiptAtMs)).toBe(true);
    const reload = vi.fn(async () => undefined);
    const keepalive = new CmdPageKeepalive({ now: () => Date.now(), listAttached: () => [source],
      isBusy: () => false, isLoading: async () => false, loadState: async () => ({ lastCompletedAtMs: 0, nextAttemptAtMs: 0 }),
      saveState: async () => undefined, reload,
      shouldDeferReload: s => h.observer.hasCompleteCmdBaselineSince(s.sourceId, Date.now() - 30_000) });
    await keepalive.tick();
    expect(reload).not.toHaveBeenCalled();
    vi.setSystemTime(receiptAtMs + 30_001);
    await keepalive.tick();
    expect(reload).toHaveBeenCalledTimes(1);
    h.observer.releaseTab(source.tabId);
  });

  it("records the genuine receipt clock only after forwarding and never renews it from replay", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const h = harness({ forward: async () => held });
    await h.request();
    const receipt = h.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
    vi.setSystemTime(2_000); release(); await receipt;
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 1_000)).toBe(true);
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 1_001)).toBe(false);
    await h.observer.replaySnapshots(source.sourceId);
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 1_001)).toBe(false);
  });

  it("does not replace the receipt clock with active recovery completion time", async () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const h = harness({ forward: async () => held });
    await h.observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 7, auxData: { frameId: "odds", isDefault: true } }
    });
    const recovery = h.observer.recoverCmdCatalog(source);
    await vi.advanceTimersByTimeAsync(1);
    await h.request();
    const receiptAtMs = Date.now();
    const receipt = h.finish();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(receiptAtMs + 50); release(); await receipt; await recovery;
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, receiptAtMs)).toBe(true);
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, receiptAtMs + 1)).toBe(false);
  });

  it.each(["epoch", "rejected-forward"] as const)("does not count a full after %s", async failure => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const h = harness({ forward: async () => { await held; if (failure === "rejected-forward") throw new Error("not delivered"); } });
    await h.request();
    const receipt = h.finish();
    await vi.waitFor(() => expect(h.forward).toHaveBeenCalled());
    if (failure === "epoch") h.observer.beginBridgeSourceEpoch(source.sourceId);
    release(); await receipt;
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
  });

  it.each([false, true])("requires every multipart fragment to be forwarded (last fragment rejected=%s)", async rejected => {
    const rows = Array.from({ length: 400 }, (_, index) => { const value = [...row]; value[0] = 25299763 + index; return value; });
    const largeBody = JSON.stringify({ t: 100, a: true, data: [], today: rows, f: [] });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let lastFragmentStarted = false;
    const h = harness({ body: largeBody, forward: async value => {
      const chunk = JSON.parse(value.payload.body);
      if (chunk.chunkIndex !== chunk.chunkCount - 1) return;
      lastFragmentStarted = true;
      await held;
      if (rejected) throw new Error("fragment not delivered");
    } });
    await h.request();
    const receipt = h.finish();
    await vi.waitFor(() => expect(lastFragmentStarted).toBe(true));
    expect(h.forward.mock.calls.length).toBeGreaterThan(1);
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
    release(); await receipt;
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(!rejected);
  });

  it.each([
    { kind: "filtered", postData: fullScope.replace("m_LeagueList=", "m_LeagueList=99") },
    { kind: "delta", postData: fullScope.replace("fc=1", "fc=3") },
    { kind: "old loader", loaderId: "retired" },
    { kind: "incomplete", body: JSON.stringify({ t: 100, a: true, data: [] }) }
  ])("does not count $kind responses as complete baseline health", async options => {
    const h = harness("body" in options ? { body: options.body } : {});
    await h.request("postData" in options ? options.postData : fullScope,
      "loaderId" in options ? options.loaderId : "current");
    await h.finish();
    expect(h.observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
  });
});
