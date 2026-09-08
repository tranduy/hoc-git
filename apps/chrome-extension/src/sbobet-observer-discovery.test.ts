import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
const origin = "https://prod20091.fxf774.com";
const url = `${origin}/api/v2/getEvent?eventId=123&timeRange=today&operatorToken=PRIVATE_SENTINEL`;
const body = JSON.stringify({ "8": "123", "7": { "901": ["opaque row"], "3": [] } });
const tree = { frameTree: { frame: { id: "football", loaderId: "document-1", url: `${origin}/sport` } } };
function harness(readBody: () => Promise<unknown> = async () => ({ body, base64Encoded: false }), now = () => 1_000) {
  const forwarded: ChromeBridgeEnvelope[] = [];
  const sendCommand = vi.fn(async (_tab: number, method: string) =>
    method === "Page.getFrameTree" ? tree : method === "Network.getResponseBody" ? readBody() : {});
  const observer = new NetworkObserver({ sendCommand, forward: async (item) => { forwarded.push(item); },
    observerSessionId: "observer-sbobet-discovery", now });
  return { observer, sendCommand, forwarded };
}
async function request(observer: NetworkObserver, bound = true) {
  await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "detail", type: "Fetch",
    ...(bound ? { frameId: "football", loaderId: "document-1" } : {}),
    request: { url, method: "GET", headers: { Authorization: "PRIVATE_SENTINEL" } } });
  await observer.handleEvent(source, "Network.responseReceived", { requestId: "detail", type: "Fetch",
    response: { url, status: 200 } });
}
function shape(forwarded: ChromeBridgeEnvelope[]): string {
  const heartbeats = forwarded.filter((item) => item.transport === "TAB_STATE");
  return String(JSON.parse(heartbeats.at(-1)!.payload.body).catalogShape);
}

describe("SBOBET passive observer discovery", () => {
  it("reports a bound observed detail shape without publishing it as a catalog or replaying a request", async () => {
    const { observer, forwarded, sendCommand } = harness();
    await request(observer);
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    await observer.heartbeat(source, "prod20091.fxf774.com");
    expect(shape(forwarded)).toContain("SBO_DISCOVERY");
    expect(shape(forwarded)).toContain("UNPROVEN");
    expect(shape(forwarded)).toContain("901");
    expect(JSON.stringify(forwarded)).not.toContain("PRIVATE_SENTINEL");
    expect(forwarded.some((item) => item.transport === "HTTP_RESPONSE")).toBe(false);
    expect(sendCommand.mock.calls.map(([, method]) => method)).not.toContain("Runtime.evaluate");
  });

  it("never reads a response without an exact frame/document binding", async () => {
    const { observer, forwarded, sendCommand } = harness();
    await request(observer, false);
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    await observer.heartbeat(source, "prod20091.fxf774.com");
    expect(shape(forwarded)).not.toContain("SBO_DISCOVERY");
    expect(sendCommand.mock.calls.map(([, method]) => method)).not.toContain("Network.getResponseBody");
  });

  it("does not read bodies queued before epoch retirement or after the probe deadline", async () => {
    for (const reason of ["epoch", "deadline"] as const) {
      let now = 1_000;
      const { observer, sendCommand } = harness(undefined, () => now);
      await request(observer);
      if (reason === "epoch") observer.beginBridgeSourceEpoch(source.sourceId);
      else now += 120_001;
      await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
      expect(sendCommand.mock.calls.map(([, method]) => method)).not.toContain("Network.getResponseBody");
    }
  });

  it("discards a response completing after bridge epoch change", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => { resolve = done; });
    const { observer, forwarded, sendCommand } = harness(() => pending);
    await request(observer);
    const finishing = observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    await vi.waitFor(() => expect(sendCommand.mock.calls.some(([, method]) => method === "Network.getResponseBody")).toBe(true));
    observer.beginBridgeSourceEpoch(source.sourceId);
    resolve({ body, base64Encoded: false });
    await finishing;
    await observer.heartbeat(source, "prod20091.fxf774.com");
    expect(shape(forwarded)).not.toContain("SBO_DISCOVERY");
  });

  it("retires prior discovery on source and bridge lifecycle boundaries", async () => {
    for (const reset of ["source", "bridge", "tab"] as const) {
      const { observer, forwarded } = harness();
      await request(observer);
      await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
      await observer.heartbeat(source, "prod20091.fxf774.com");
      expect(shape(forwarded)).toContain("SBO_DISCOVERY");
      if (reset === "source") observer.beginSourceEpoch(source.sourceId);
      else if (reset === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
      else observer.prepareDebuggerReattach(source.tabId);
      await observer.heartbeat(source, "prod20091.fxf774.com");
      expect(shape(forwarded)).not.toContain("SBO_DISCOVERY");
    }
  });

  it("bounds passive response reads to 24 requests and 120 seconds per epoch", async () => {
    let now = 1_000;
    const { observer, sendCommand } = harness(undefined, () => now);
    for (let index = 0; index < 26; index += 1) {
      await request(observer);
      await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    }
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Network.getResponseBody")).toHaveLength(24);
    observer.beginBridgeSourceEpoch(source.sourceId);
    await request(observer);
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    now += 120_001;
    await request(observer);
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Network.getResponseBody")).toHaveLength(25);
  });

  it("keeps the existing main baseline when the passive probe expires during document verification", async () => {
    let now = 1_000;
    let expireOnCheck = false;
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") {
        if (expireOnCheck) { expireOnCheck = false; now = 122_001; }
        return tree;
      }
      if (method === "Runtime.evaluate" && String(params?.expression).includes("time-tab-container")) {
        return { result: { value: { status: "time-tab-selected", step: "tab", groups: 1, scopes: 1, periods: 2 } } };
      }
      if (method === "Network.getResponseBody") return { body: '[{"1":"League","2":[]}]', base64Encoded: false };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: async (item) => { forwarded.push(item); }, now: () => now });
    await request(observer);
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "detail" });
    now = 119_000;
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "catalog", url: "wss://d42.sb21.net/sport/538/session/websocket"
    }, "sportsbook-child");
    await observer.handleEvent(source, "Network.webSocketFrameSent", { requestId: "catalog",
      response: { opcode: 1, payloadData: "SUBSCRIBE\nid:subSportBookLive\ndestination:/topic/sports/1_1/live/ma/event/vi\n\n\u0000" } }, "sportsbook-child");
    await observer.ensureCompleteKsportBaseline(source);
    for (const partition of ["live", "today"] as const) {
      const requestId = `main-${partition}`;
      const requestUrl = `${origin}/api/v2/getEvent?timeRange=${partition}`;
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
        frameId: "football", loaderId: "document-1", request: { url: requestUrl, method: "GET" } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId, type: "Fetch",
        response: { url: requestUrl, status: 200 } });
      if (partition === "live") expireOnCheck = true;
      await observer.handleEvent(source, "Network.loadingFinished", { requestId });
    }
    expect(forwarded.filter((item) => item.transport === "HTTP_RESPONSE").map((item) => item.request.providerPartition))
      .toEqual(["KSPORT_LIVE", "KSPORT_TODAY"]);
  });

  it("reads only an existing bound provider context and sanitizes its DOM result", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return tree;
      if (method === "Runtime.evaluate") {
        expect(params?.contextId).toBe(91);
        expect(String(params?.expression)).toContain("SBOBET_PASSIVE_DOM_DISCOVERY");
        return { result: { value: { kind: "SBOBET_PASSIVE_DOM_DISCOVERY", status: "INSPECTED",
          labels: [], attributes: [], selectorShapes: [], classes: ["PRIVATE_SENTINEL"],
          moreControlCount: 2, inspectedNodeCount: 10, totalCandidateCount: 10 } } };
      }
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: async (item) => { forwarded.push(item); }, now: () => 1_000 });
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "football", isDefault: true } } });
    await observer.probeSbobetDiscovery(source);
    await observer.probeSbobetDiscovery(source);
    await observer.heartbeat(source, "prod20091.fxf774.com");
    expect(shape(forwarded)).toContain("sbo-dom[");
    expect(shape(forwarded)).toContain("more=2");
    expect(JSON.stringify(forwarded)).not.toContain("PRIVATE_SENTINEL");
    expect(sendCommand.mock.calls.map(([, method]) => method)).toEqual([
      "Page.getFrameTree", "Page.getFrameTree", "Runtime.evaluate", "Page.getFrameTree"
    ]);
  });

  it("does not probe an unrelated frame or publish a late DOM result", async () => {
    for (const scenario of ["other-frame", "late"] as const) {
      const forwarded: ChromeBridgeEnvelope[] = [];
      let observer!: NetworkObserver;
      const sendCommand = vi.fn(async (_tab: number, method: string) => {
        if (method === "Page.getFrameTree") return scenario === "other-frame"
          ? { frameTree: { frame: { id: "football", loaderId: "document-1", url: "https://other.invalid/" } } } : tree;
        if (method === "Runtime.evaluate") observer.beginBridgeSourceEpoch(source.sourceId);
        return { result: { value: { kind: "SBOBET_PASSIVE_DOM_DISCOVERY", labels: [], attributes: [], selectorShapes: [], classes: [] } } };
      });
      observer = new NetworkObserver({ sendCommand, forward: async (item) => { forwarded.push(item); }, now: () => 1_000 });
      await observer.handleEvent(source, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: "football", isDefault: true } } });
      await observer.probeSbobetDiscovery(source);
      // Prevent heartbeat from scheduling a fresh epoch read in this test.
      observer.prepareDebuggerReattach(source.tabId);
      await observer.heartbeat(source, "prod20091.fxf774.com");
      expect(shape(forwarded)).not.toContain("sbo-dom[");
      if (scenario === "other-frame") expect(sendCommand.mock.calls.map(([, method]) => method)).toEqual(["Page.getFrameTree"]);
    }
  });

  it("selects the provider context even when unrelated root/ad contexts were discovered first", async () => {
    const sendCommand = vi.fn(async (_tab: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: {
        frame: { id: "root", loaderId: "root-loader", url: "https://unrelated.invalid/" }, childFrames: [
          { frame: { id: "ad", loaderId: "ad-loader", url: "https://ads.invalid/" } }, tree.frameTree
        ]
      } };
      if (method === "Runtime.evaluate") expect(params?.contextId).toBe(91);
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: async () => undefined, now: () => 1_000 });
    for (const [id, frameId] of [[1, "root"], [2, "ad"], [91, "football"]] as const) {
      await observer.handleEvent(source, "Runtime.executionContextCreated", {
        context: { id, auxData: { frameId, isDefault: true } } });
    }
    await observer.probeSbobetDiscovery(source);
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.evaluate")).toHaveLength(1);
  });
});
