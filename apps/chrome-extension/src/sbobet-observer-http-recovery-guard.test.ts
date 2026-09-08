import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
const observers: NetworkObserver[] = [];
afterEach(() => {
  for (const observer of observers.splice(0)) observer.releaseTab(source.tabId);
  vi.useRealTimers();
});

describe("SBOBET recovery with a progressing HTTP baseline", () => {
  it("keeps native sockets and period tabs intact after successful pairs and cadence skips", async () => {
    let now = 1_000;
    const forwarded: ChromeBridgeEnvelope[] = [];
    const httpAttempts: number[] = [];
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: "provider-frame", loaderId: "provider-document", url: "https://api.sb21.net/sport" } } };
      if (method === "Target.getTargets") return { targetInfos: [] };
      const expression = String(params?.expression ?? "");
      if (method === "Runtime.evaluate" && expression.includes("fieldline-ksport-catalog-refresh")) {
        httpAttempts.push(now);
        return { result: { value: { status: "catalog-requested", origin: "https://api.sb21.net",
          responses: ["live", "today"].map(timeRange => ({ timeRange,
            url: `https://api.sb21.net/api/v2/getEvent?timeRange=${timeRange}`, body: "[]" })) } } };
      }
      if (method === "Runtime.evaluate" && expression.includes("globalThis.WebSocket")) {
        return { result: { objectId: "native-socket-prototype" } };
      }
      if (method === "Runtime.queryObjects") return { objects: { objectId: "native-socket-instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, now: () => now,
      forward: async envelope => { forwarded.push(envelope); } });
    observers.push(observer);
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "provider-frame", isDefault: true } }
    });

    for (const tickAtMs of [1_000, 2_000, 5_000, 6_000, 9_000]) {
      now = tickAtMs;
      await observer.maintainKsportFeed(source);
    }

    expect(httpAttempts).toEqual([1_000, 5_000, 9_000]);
    expect(forwarded.filter(envelope => envelope.transport === "HTTP_RESPONSE")).toHaveLength(6);
    expect(sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.callFunctionOn" && String(params?.functionDeclaration).includes("fieldline-baseline-recovery")))
      .toEqual([]);
    expect(sendCommand.mock.calls.filter(([, method, params]) =>
      method === "Runtime.evaluate" && String(params?.expression).includes("sport-menu-tab"))).toEqual([]);
  });
});
