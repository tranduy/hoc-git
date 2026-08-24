import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";

function ksportReceipt(partition: "live" | "today", order: number, full = true): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const body = full ? [{ "1": `${partition} league`,
    "2": [{ "8": `${order}`, "2": "Home", "3": "Away", "7": {} }] }]
    : [{ "8": `${order}`, "7": {} }];
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify(body) });
  const stomp = `MESSAGE\ndestination:/topic/sports/${path}/ma/event/vi\n` +
    `subscription:${subscription}\nmessage-id:socket-${order}\n\n${wrapper}\u0000`;
  return `a${JSON.stringify([stomp])}`;
}

function ksportSubscribe(partition: "live" | "today"): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  return JSON.stringify([
    `SUBSCRIBE\nid:${subscription}\ndestination:/topic/sports/${path}/ma/event/vi\n\n\u0000`
  ]);
}

function tsportMatch(eventId: string | null): unknown {
  const textNode = (textContent: string) => ({ textContent });
  return {
    id: "",
    getAttribute: () => null,
    querySelector: (selector: string) => selector === ".match-favorite"
      ? eventId === null ? null : { id: `eventId-main-1-${eventId}` }
      : selector === ".league-name" ? textNode("League")
        : selector === ".match__status, .match__time, .match-time" ? textNode("12:00") : null,
    querySelectorAll: (selector: string) => selector === ".match__team-name"
      ? [textNode("Home"), textNode("Away")] : [],
  };
}

function evaluateTsportDocument(candidates: readonly unknown[], options: {
  readonly busy?: boolean;
  readonly explicitEmpty?: boolean;
  readonly unrelatedNoData?: boolean;
  readonly includeRoot?: boolean;
} = {}): unknown[] {
  const root = {
    getAttribute: (name: string) => name === "data-loaded" ? "true"
      : name === "aria-busy" ? options.busy === true ? "true" : "false" : null,
    matches: (selector: string) => options.explicitEmpty === true && selector.includes('[data-empty="true"]'),
    querySelector: (selector: string) => options.explicitEmpty === true && selector.includes('[data-empty="true"]')
      ? {} : options.unrelatedNoData === true && selector.includes(".no-data") ? {} : null,
    querySelectorAll: (selector: string) => selector === ".match" ? candidates : []
  };
  const includeRoot = options.includeRoot !== false;
  const fakeDocument = {
    documentElement: { dataset: {} },
    querySelector: () => includeRoot ? root : null,
    querySelectorAll: (selector: string) => selector === ".match" ? candidates : includeRoot ? [root] : []
  };
  const evaluate = new Function("document", `return ${TSPORT_PUBLIC_CATALOG_EXPRESSION}`) as
    (document: unknown) => string;
  return JSON.parse(evaluate(fakeDocument)) as unknown[];
}

describe("five-provider shared runtime wiring", () => {
  it("binds every KSPORT socket envelope to its immutable recovery generation", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: async (envelope) => { forwarded.push(envelope); }, observerSessionId: "worker-a" });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;

    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "old", url: "wss://d42.sb21.net/sport/538/session/websocket"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "old", response: { opcode: 1, payloadData: "h" }
    });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "current", url: "wss://d42.sb21.net/sport/538/session/websocket"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "old", response: { opcode: 1, payloadData: "h" }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "current", response: { opcode: 1, payloadData: "h" }
    });

    expect(forwarded.filter((envelope) => envelope.request.streamId === "1")
      .map((envelope) => envelope.request.recoveryGeneration)).toEqual([1, 1, 1]);
    expect(forwarded.filter((envelope) => envelope.request.streamId === "2")
      .map((envelope) => envelope.request.recoveryGeneration)).toEqual([1, 1]);
  });

  it("attributes newer same-socket KSPORT baselines without relabelling a delayed old partition", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: async (envelope) => { forwarded.push(envelope); }, observerSessionId: "worker-a" });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "catalog", url });
    for (const payloadData of [ksportReceipt("live", 100), ksportReceipt("today", 104)]) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData }
      });
    }
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(true);
    await observer.handleEvent(source, "Network.webSocketFrameSent", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportSubscribe("live") }
    });
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(false);
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportReceipt("live", 200) }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportReceipt("today", 103) }
    });
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(false);
    await observer.handleEvent(source, "Network.webSocketFrameSent", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportSubscribe("today") }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportReceipt("today", 204) }
    });
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(true);

    expect(forwarded.filter((envelope) => envelope.transport === "WS_FRAME")
      .map((envelope) => envelope.request.recoveryGeneration)).toEqual([1, 1, 2, 1, 2]);

    forwarded.length = 0;
    await observer.replaySnapshots(source.sourceId);
    expect(forwarded.filter((envelope) => envelope.transport === "WS_FRAME" &&
      envelope.request.replayed === true)
      .map((envelope) => envelope.request.recoveryGeneration)).toEqual([2, 2]);
  });

  it("does not report KSPORT ready from live and today deltas without full partitions", async () => {
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})),
      forward: vi.fn(async () => undefined), observerSessionId: "worker-a" });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "catalog",
      url: "wss://d42.sb21.net/sport/538/session/websocket" });
    for (const payloadData of [ksportReceipt("live", 100, false), ksportReceipt("today", 104, false)]) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData }
      });
    }

    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(false);
  });

  it("does not replay a KSPORT generation after cache eviction removes either full partition", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({ sendCommand: vi.fn(async (_tabId, method) =>
      method === "Runtime.evaluate" ? { result: { value: "1787555000000" } } : {}),
    forward: async (envelope) => { forwarded.push(envelope); }, observerSessionId: "worker-a" });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "catalog", url });
    for (const payloadData of [ksportReceipt("live", 100), ksportReceipt("today", 104)]) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData }
      });
    }
    expect(observer.hasCompleteKsportBaseline(source.sourceId)).toBe(true);

    for (let index = 0; index < 2_047; index += 1) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData: `heartbeat-${index}` }
      });
    }

    forwarded.length = 0;
    await expect(observer.replaySnapshots(source.sourceId)).resolves.toBe(false);
    expect(forwarded.filter((envelope) => envelope.transport === "WS_FRAME" &&
      envelope.request.replayed === true)).toEqual([]);
  }, 15_000);

  it("reconnects the exact KSPORT socket when attempt attribution fails closed", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      _sessionId?: string) => {
      if (method === "Runtime.evaluate" && params?.expression ===
        "window.WebSocket && window.WebSocket.prototype") return { result: { objectId: "prototype" } };
      if (method === "Runtime.evaluate") return { result: { value: "1787555000000" } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "worker-a", now: () => 10_000 });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    const url = "wss://d42.sb21.net/sport/538/session/websocket";

    // Consume the generic source-wide recovery and its five-second cooldown.
    // A tracker failure on the subsequently observed socket must bypass both.
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "orphan", response: { opcode: 1, payloadData: "orphan" }
    });
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(1);

    const ownerSession = "sportsbook-owner";
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "catalog", url }, ownerSession);
    for (const payloadData of [ksportReceipt("live", 100), ksportReceipt("today", 104)]) {
      await observer.handleEvent(source, "Network.webSocketFrameReceived", {
        requestId: "catalog", response: { opcode: 1, payloadData }
      }, ownerSession);
    }
    await observer.handleEvent(source, "Network.webSocketFrameSent", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportSubscribe("live") }
    }, ownerSession);

    await observer.handleEvent(source, "Network.webSocketFrameSent", {
      requestId: "catalog", response: { opcode: 1, payloadData: ksportSubscribe("live") }
    }, ownerSession);

    await vi.waitFor(() => expect(sendCommand.mock.calls.filter(([, method]) =>
      method === "Runtime.callFunctionOn")).toHaveLength(2));
    const reconnect = sendCommand.mock.calls.filter(([, method]) =>
      method === "Runtime.callFunctionOn").at(-1);
    expect(reconnect?.[3]).toBe(ownerSession);
    expect(reconnect?.[2]?.arguments).toEqual([{ value: url }]);
    expect(reconnect?.[2]?.functionDeclaration).toContain("String(socket.url) !== expectedUrl");
    expect(reconnect?.[2]?.functionDeclaration).not.toContain("/\\/sport\\//u");

    // Once the same tracker is failed, later frames cannot fan out reconnects.
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1, payloadData: "post-failure" }
    }, ownerSession);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sendCommand.mock.calls.filter(([, method]) => method === "Runtime.callFunctionOn")).toHaveLength(2);
  });

  it("fences late KSPORT frames as soon as the exact child session starts detaching", async () => {
    let releaseFrame!: () => void;
    let observeFrame!: () => void;
    const blockedFrame = new Promise<void>((resolve) => { releaseFrame = resolve; });
    const frameObserved = new Promise<void>((resolve) => { observeFrame = resolve; });
    const forwarded: ChromeBridgeEnvelope[] = [];
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async (_tabId: number, method: string) => method === "Runtime.evaluate"
        ? { result: { value: "1787555000000" } } : {}),
      forward: async (envelope) => {
        forwarded.push(envelope);
        if (envelope.transport === "WS_FRAME" && envelope.payload.body === "h-first") {
          observeFrame();
          await blockedFrame;
        }
      },
      observerSessionId: "worker-a"
    });
    const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8 } as const;
    const sessionId = "sportsbook-child";
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "catalog",
      url: "wss://d42.sb21.net/sport/538/session/websocket" }, sessionId);

    const first = observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1, payloadData: "h-first" }
    }, sessionId);
    await frameObserved;
    const detach = observer.handleEvent(source, "Target.detachedFromTarget", { sessionId });
    const late = observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "catalog", response: { opcode: 1, payloadData: "h-late" }
    }, sessionId);

    await expect(Promise.race([late.then(() => "dropped"),
      new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 20))]))
      .resolves.toBe("dropped");
    releaseFrame();
    await Promise.all([first, detach, late]);
    expect(forwarded.filter((envelope) => envelope.transport === "WS_FRAME")
      .map((envelope) => envelope.payload.body)).toEqual(["h-first"]);
  });

  it("captures TSPORT coverage then reconnects only its exact event socket after an epoch bump", async () => {
    const forwarded: ChromeBridgeEnvelope[] = [];
    const snapshot = JSON.stringify([
      { eventId: "event-1" },
      { __fieldlineSweep: { sweepId: "tsport-sweep-1", complete: true } }
    ]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "loader" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
      if (method === "Runtime.evaluate" && params?.expression === "window.WebSocket && window.WebSocket.prototype") {
        return { result: { objectId: "prototype" } };
      }
      if (method === "Runtime.evaluate") return { result: { type: "string", value: snapshot } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand,
      forward: async (envelope) => { forwarded.push(envelope); },
      observerSessionId: "worker-a" });
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;

    observer.beginSourceEpoch(source.sourceId);
    await observer.refreshCatalog(source);

    const domEnvelope = forwarded.find((envelope) => envelope.transport === "DOM_SNAPSHOT");
    expect(JSON.parse(domEnvelope?.payload.body ?? "null")).toMatchObject({
      sweepId: "tsport-sweep-1",
      sweepComplete: true,
      sweepFrameKey: "top",
      sweepDocumentKey: expect.stringMatching(/^cmd-document:[a-z0-9]+:[a-z0-9]+$/u),
      records: [{ eventId: "event-1" }]
    });
    const reconnect = sendCommand.mock.calls.find(([, method]) => method === "Runtime.callFunctionOn");
    expect(reconnect?.[2]?.functionDeclaration).toContain("spws\\.(?:agenate|racern)\\.com");
    expect(reconnect?.[2]?.functionDeclaration).toContain("\\/ln\\/");
    expect(reconnect?.[2]?.functionDeclaration).not.toContain("/sport/");
    expect(sendCommand.mock.calls.some(([, method]) => method === "Page.reload")).toBe(false);
  });

  it("keeps the TSPORT socket open when a complete sweep cannot be bound to one document", async () => {
    const marker = JSON.stringify([
      { __fieldlineSweep: { sweepId: "tsport-ambiguous", complete: true } }
    ]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.getFrameTree") return { frameTree: {
        frame: { id: "top", loaderId: "loader-top" },
        childFrames: [{ frame: { id: "child", loaderId: "loader-child" } }]
      } };
      if (method === "Page.createIsolatedWorld") {
        return { executionContextId: params?.frameId === "top" ? 11 : 12 };
      }
      if (method === "Runtime.evaluate" && params?.expression ===
        "window.WebSocket && window.WebSocket.prototype") return { result: { objectId: "prototype" } };
      if (method === "Runtime.evaluate") return { result: { type: "string", value: marker } };
      if (method === "Runtime.queryObjects") return { objects: { objectId: "instances" } };
      if (method === "Runtime.callFunctionOn") return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "worker-a" });
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;

    await observer.refreshCatalog(source);

    expect(sendCommand.mock.calls.some(([, method]) => method === "Runtime.callFunctionOn")).toBe(false);
  });

  it("reconnects a root TSPORT socket even when only an unrelated child context is known", async () => {
    const snapshot = JSON.stringify([{ eventId: "event-1" },
      { __fieldlineSweep: { sweepId: "tsport-root-sweep", complete: true } }]);
    const sendCommand = vi.fn(async (_tabId: number, method: string, params?: Record<string, unknown>,
      sessionId?: string) => {
      if (method === "Page.getFrameTree") {
        return { frameTree: { frame: { id: "top", loaderId: "loader-top" } } };
      }
      if (method === "Page.createIsolatedWorld") return { executionContextId: 11 };
      if (method === "Runtime.evaluate" && params?.expression === TSPORT_PUBLIC_CATALOG_EXPRESSION) {
        return { result: { type: "string", value: snapshot } };
      }
      if (method === "Runtime.evaluate" && sessionId === undefined) {
        return { result: { objectId: "root-prototype" } };
      }
      if (method === "Runtime.queryObjects" && sessionId === undefined) {
        return { objects: { objectId: "root-instances" } };
      }
      if (method === "Runtime.callFunctionOn" && sessionId === undefined) return { result: { value: 1 } };
      return {};
    });
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
      observerSessionId: "worker-a" });
    const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:11", tabId: 11 } as const;
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "unrelated", isDefault: true } }
    }, "unrelated-child");
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "event-socket",
      url: "wss://spws.agenate.com/ln/en/s/1/mg/0/tr/0" });

    await observer.refreshCatalog(source);

    expect(sendCommand.mock.calls.some(([, method, , sessionId]) =>
      method === "Runtime.callFunctionOn" && sessionId === undefined)).toBe(true);
  });

  it("marks an explicitly empty-ready TSPORT football document as one complete bounded sweep", () => {
    const records = evaluateTsportDocument([], { explicitEmpty: true });

    expect(records).toEqual([{ __fieldlineSweep: {
      sweepId: expect.stringMatching(/^tsport-sweep-[1-9]\d*$/u), complete: true
    } }]);
  });

  it("does not mark a TSPORT login or shell document as a completed football sweep", () => {
    const fakeDocument = {
      documentElement: { dataset: {} },
      querySelectorAll: () => [],
      querySelector: () => null
    };
    const evaluate = new Function("document", `return ${TSPORT_PUBLIC_CATALOG_EXPRESSION}`) as
      (document: unknown) => string;

    expect(JSON.parse(evaluate(fakeDocument))).toEqual([]);
  });

  it("withholds TSPORT completion when any football event candidate is still incomplete", () => {
    const records = evaluateTsportDocument([tsportMatch("12345"), tsportMatch(null)]);

    expect(records).not.toContainEqual(expect.objectContaining({ __fieldlineSweep: expect.anything() }));
  });

  it("withholds TSPORT completion while the football event-list root is busy", () => {
    const records = evaluateTsportDocument([tsportMatch("12345")], { busy: true });

    expect(records).not.toContainEqual(expect.objectContaining({ __fieldlineSweep: expect.anything() }));
  });

  it("does not treat an unrelated no-data descendant as an empty football event list", () => {
    const records = evaluateTsportDocument([], { unrelatedNoData: true });

    expect(records).not.toContainEqual(expect.objectContaining({ __fieldlineSweep: expect.anything() }));
  });
});
