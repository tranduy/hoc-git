import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7 } as const;

describe("NetworkObserver", () => {
  it("forwards redacted WebSocket text frames with ordered sequence", async () => {
    const forward = vi.fn(async () => undefined);
    const observer = new NetworkObserver({
      sendCommand: vi.fn(async () => ({})), forward,
      now: () => 1_000, monotonicNow: () => 50
    });
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "ws-1", url: "wss://sports.example/feed?token=secret"
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "{\"eventId\":1}" }
    });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 0,
      transport: "WS_FRAME",
      request: expect.objectContaining({ hostname: "sports.example", pathnameClass: "/feed" }),
      payload: { encoding: "UTF8", body: "{\"eventId\":1}" }
    }));
    expect(JSON.stringify(forward.mock.calls)).not.toContain("secret");
  });

  it("retrieves allow-listed XHR bodies only after loadingFinished and isolates body failure", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Network.getResponseBody") return { body: "{\"odds\":1.95}", base64Encoded: false };
      return {};
    });
    const forward = vi.fn(async () => undefined);
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

  it("enables bounded network observation and non-odds page discovery", async () => {
    const sendCommand = vi.fn(async (_tabId: number, _method: string, _params?: Record<string, unknown>) => ({}));
    const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined) });
    await observer.start(source);
    expect(sendCommand).toHaveBeenCalledWith(7, "Network.enable", expect.objectContaining({ maxTotalBufferSize: 1_048_576 }));
    expect(sendCommand).toHaveBeenCalledWith(7, "Page.setLifecycleEventsEnabled", { enabled: true });
    const evaluateCall = sendCommand.mock.calls.find((call) => call[1] === "Runtime.evaluate");
    expect(evaluateCall?.[2]).toMatchObject({ returnByValue: true });
    expect(JSON.stringify(evaluateCall?.[2])).not.toMatch(/\.click\(|dispatchEvent|\[data-odds/iu);
  });

  it("drops an oversized frame without disrupting later frames", async () => {
    const forward = vi.fn(async () => undefined);
    const observer = new NetworkObserver({ sendCommand: vi.fn(async () => ({})), forward });
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "ws-1", url: "wss://sports.example/feed" });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 1, payloadData: "x".repeat(262_145) }
    });
    await observer.handleEvent(source, "Network.webSocketFrameReceived", {
      requestId: "ws-1", response: { opcode: 2, payloadData: "YWJj" }
    });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ sequence: 0, payload: { encoding: "BASE64", body: "YWJj" } }));
  });
});
