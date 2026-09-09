import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9 } as const;
const frameTree = { frameTree: { frame: { id: "odds", loaderId: "current",
  url: "https://cgnew.fts368.com/Member/BetOdds/HdpDouble.aspx" } } };

describe("CMD recovery diagnostics", () => {
  it("keeps the last failed gate visible while a subsequent frame read is pending", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    let reads = 0;
    const observer = new NetworkObserver({ forward, now: () => 1_000, sendCommand: async (_tabId, method) => {
      if (method !== "Page.getFrameTree") return {};
      reads += 1;
      if (reads === 1) throw new Error("read failed");
      return new Promise<unknown>(() => undefined);
    } });
    await observer.recoverCmdCatalog(source);
    await new Promise(resolve => setTimeout(resolve, 0));
    const retry = observer.recoverCmdCatalog(source);
    await vi.waitFor(() => expect(reads).toBe(2));
    try {
      await observer.heartbeat(source, "cgnew.fts368.com");
      const body = JSON.parse(forward.mock.calls.at(-1)![0].payload.body);
      expect(body.catalogShape).toContain("CMD_RECOVERY_FRAME_READ_FAILED");
      expect(body.catalogShape).toContain("atMs:1000");
      expect(body.catalogShape).toContain("CMD_RECOVERY_RESOLVE_TARGET");
    } finally {
      observer.releaseTab(source.tabId);
      await retry;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    await observer.heartbeat(source, "cgnew.fts368.com");
    expect(JSON.parse(forward.mock.calls.at(-1)![0].payload.body).catalogShape).not.toContain("CMD_LAST[");
  });

  it.each([
    [{ frameTree: { frame: { id: "top", loaderId: "top", url: "https://cgnew.fts368.com/BasePage/home.aspx" } } },
      "CMD_RECOVERY_FRAME_MISSING"],
    [frameTree, "CMD_RECOVERY_CONTEXT_MISSING"]
  ])("exposes the exact recovery gate through the existing heartbeat", async (tree, expected) => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const observer = new NetworkObserver({ forward,
      sendCommand: async (_tabId, method) => method === "Page.getFrameTree" ? tree : {} });
    await observer.recoverCmdCatalog(source);
    await observer.heartbeat(source, "cgnew.fts368.com");
    const body = JSON.parse(forward.mock.calls.at(-1)![0].payload.body);
    expect(body.kind).toBe("WS_ATTACH");
    expect(body.catalogShape).toContain(expected);
    expect(observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
  });

  it("retains only bounded scalar native coverage and backoff, without promoting a baseline", async () => {
    const forward = vi.fn(async (_envelope: ChromeBridgeEnvelope) => undefined);
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Page.getFrameTree") return frameTree;
      if (method === "Runtime.evaluate") return { result: { value: {
        status: "roster-pending", requestPaused: true, requestRetryInMs: 300_000,
        requestStatus: 403, rosterActive: 0, rosterFailed: true, groups: 17,
        todayRows: 122, earlyRows: 0, runningRows: 0,
        generation: "private-generation", token: "private-token", responseText: "private-body",
        pending: -1, done: Number.POSITIVE_INFINITY
      } } };
      return {};
    });
    const observer = new NetworkObserver({ forward, sendCommand });
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 7, auxData: { frameId: "odds", isDefault: true } }
    });
    await observer.recoverCmdCatalog(source);
    await observer.heartbeat(source, "cgnew.fts368.com");
    const body = JSON.parse(forward.mock.calls.at(-1)![0].payload.body);
    expect(body.catalogShape).toContain("CMD_RECOVERY_REQUEST_PAUSED");
    expect(body.catalogShape).toContain("status:roster-pending");
    expect(body.catalogShape).toContain("requestStatus:403");
    expect(body.catalogShape).toContain("todayRows:122");
    expect(body.catalogShape).toContain("rosterFailed:1");
    expect(body.catalogShape).not.toMatch(/private|pending:-1|Infinity/u);
    expect(body.catalogShape.length).toBeLessThan(900);
    expect(observer.hasCompleteCmdBaselineSince(source.sourceId, 0)).toBe(false);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1);
  });
});
