import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;

describe("IM refresh diagnostics", () => {
  it("does not publish an earlier frame diagnostic after a bridge epoch changes while its sibling is pending", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    let release!: (value: unknown) => void;
    const child = new Promise<unknown>(resolve => { release = resolve; });
    const observer = new NetworkObserver({ now: () => 100_000,
      forward: async envelope => { forwarded.push(envelope); },
      sendCommand: vi.fn(async (_tab, method, params) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "top", loaderId: "top-doc" }, childFrames: [{ frame: { id: "im-app", loaderId: "child-doc" } }] } }
        : method === "Runtime.evaluate" && params?.contextId === 82 ? child
        : { result: { value: { status: "rate-limited", responses: [], coverage: {
          gateReason: "COOLDOWN", diagnosticAtMs: 100_000, retryInMs: 22_000, failureCount: 1,
          lastFailureAtMs: 92_000, failureStage: "NETWORK" } } } }) });
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 82, auxData: { frameId: "im-app", isDefault: true } }
    });
    const running = observer.refreshCatalog(source);
    for (let index = 0; index < 30; index++) await Promise.resolve();
    observer.beginBridgeSourceEpoch(source.sourceId);
    release({ result: { value: { status: "rate-limited", responses: [], coverage: { gateReason: "LOCK_HELD" } } } });
    await running;
    expect(forwarded.filter(envelope => envelope.request.pathnameClass === "/__fieldline_im_catalog_refresh__")).toEqual([]);
  });

  it("reports cooldown separately from its historical timeout, with bounded original failure metadata", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ now: () => 100_000,
      forward: async envelope => { forwarded.push(envelope); },
      sendCommand: vi.fn(async (_tab, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "top", loaderId: "doc" } } }
        : { result: { value: { status: "rate-limited", responses: [], coverage: {
          gateReason: "COOLDOWN", retryInMs: 22_000, diagnosticAtMs: 95_000, failureCount: 1,
          lastFailureAtMs: 92_000, failureStage: "BODY_READ",
          localFailureCount: 1, elapsedMs: 15_000, headAtMs: 900,
          lastFailure: { errorCategory: "REQUEST_TIMEOUT", observedAtMs: 92_000, failureStage: "BODY_READ" }
        } } } }) });
    await observer.refreshCatalog(source);
    const payload = forwarded.find(envelope => envelope.request.pathnameClass === "/__fieldline_im_catalog_refresh__")!.payload;
    expect(payload.encoding).toBe("UTF8");
    expect(JSON.parse(payload.body)).toEqual({ results: ["top:gate-cooldown"], imRefresh: {
      observedAtMs: 100_000, evaluations: [{ target: "top", status: "gate-cooldown", gateReason: "COOLDOWN",
        retryInMs: 17_000, failureCount: 1, lastFailureAtMs: 92_000, failureStage: "BODY_READ",
        localFailureCount: 1, elapsedMs: 15_000, headAtMs: 900 }]
    } });
  });

  it("does not forward malformed or unbounded diagnostic values", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ now: () => 100_000,
      forward: async envelope => { forwarded.push(envelope); },
      sendCommand: vi.fn(async (_tab, method) => method === "Page.getFrameTree"
        ? { frameTree: { frame: { id: "top", loaderId: "doc" } } }
        : { result: { value: { status: "rate-limited", responses: [], coverage: {
          gateReason: "COOLDOWN", retryInMs: -1, failureCount: "unsafe", lastFailureAtMs: 100_001,
          failureStage: "unsafe private value", localFailureCount: -1, elapsedMs: 1.5,
          headAtMs: "private", lastFailure: { path: "private", errorCategory: "REQUEST_TIMEOUT" }
        } } } }) });
    await observer.refreshCatalog(source);
    const payload = forwarded.find(envelope => envelope.request.pathnameClass === "/__fieldline_im_catalog_refresh__")!.payload;
    expect(JSON.parse(payload.body).imRefresh.evaluations).toEqual([{ target: "top", status: "gate-cooldown",
      gateReason: "COOLDOWN", retryInMs: null, failureCount: null, lastFailureAtMs: null, failureStage: null,
      localFailureCount: null, elapsedMs: null, headAtMs: null }]);
    expect(payload.body).not.toContain("private");
  });
});
