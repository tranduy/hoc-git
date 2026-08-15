import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import { redactNetworkEnvelope } from "./redactor.js";

export interface ObservedSource {
  readonly lobby: ChromeLobbyId;
  readonly sourceId: string;
  readonly tabId: number;
}

export interface NetworkObserverDependencies {
  readonly sendCommand: (tabId: number, method: string, params?: Record<string, unknown>) => Promise<unknown>;
  readonly forward: (envelope: ChromeBridgeEnvelope) => Promise<void>;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
}

interface PendingRequest {
  readonly source: ObservedSource;
  readonly url: string;
  readonly resourceType: string;
}

const DISCOVERY_EXPRESSION = `(() => {
  const roots = [document.scrollingElement, ...document.querySelectorAll('[role="main"], main, .content, .sports-content')]
    .filter(Boolean);
  for (const root of roots) root.scrollTop = Math.min(root.scrollTop + root.clientHeight, root.scrollHeight);
  return roots.length;
})()`;

export class NetworkObserver {
  readonly #sendCommand: NetworkObserverDependencies["sendCommand"];
  readonly #forward: NetworkObserverDependencies["forward"];
  readonly #now: () => number;
  readonly #monotonicNow: () => number;
  readonly #sequences = new Map<string, number>();
  readonly #webSockets = new Map<string, { source: ObservedSource; url: string }>();
  readonly #pending = new Map<string, PendingRequest>();

  constructor(dependencies: NetworkObserverDependencies) {
    this.#sendCommand = dependencies.sendCommand;
    this.#forward = dependencies.forward;
    this.#now = dependencies.now ?? Date.now;
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  }

  async start(source: ObservedSource): Promise<void> {
    await this.#sendCommand(source.tabId, "Network.enable", {
      maxTotalBufferSize: 1_048_576,
      maxResourceBufferSize: 262_144,
      maxPostDataSize: 0
    });
    await this.#sendCommand(source.tabId, "Page.setLifecycleEventsEnabled", { enabled: true });
    await this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: DISCOVERY_EXPRESSION,
      returnByValue: true,
      awaitPromise: false
    });
  }

  async handleEvent(source: ObservedSource, method: string, rawParams: unknown): Promise<void> {
    const params = isRecord(rawParams) ? rawParams : {};
    const requestId = typeof params.requestId === "string" ? params.requestId : null;
    const key = requestId ? `${source.tabId}:${requestId}` : null;

    if (method === "Network.webSocketCreated" && key && typeof params.url === "string") {
      this.#webSockets.set(key, { source, url: params.url });
      return;
    }
    if (method === "Network.webSocketClosed" && key) {
      this.#webSockets.delete(key);
      return;
    }
    if (method === "Network.webSocketFrameReceived" && key) {
      const socket = this.#webSockets.get(key);
      const response = isRecord(params.response) ? params.response : null;
      if (!socket || !response || typeof response.payloadData !== "string") return;
      const opcode = typeof response.opcode === "number" ? response.opcode : 1;
      await this.#emit(socket.source, socket.url, "WebSocket", "WS_FRAME", {
        encoding: opcode === 2 ? "BASE64" : "UTF8",
        body: response.payloadData
      });
      return;
    }
    if (method === "Network.responseReceived" && key) {
      const response = isRecord(params.response) ? params.response : null;
      const resourceType = typeof params.type === "string" ? params.type : "";
      if (!response || !/^(?:XHR|Fetch)$/u.test(resourceType) || typeof response.url !== "string") return;
      this.#pending.set(key, { source, url: response.url, resourceType });
      return;
    }
    if (method === "Network.loadingFinished" && key) {
      const pending = this.#pending.get(key);
      this.#pending.delete(key);
      if (!pending) return;
      try {
        const response = await this.#sendCommand(source.tabId, "Network.getResponseBody", { requestId });
        if (!isRecord(response) || typeof response.body !== "string") return;
        await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
          encoding: response.base64Encoded === true ? "BASE64" : "UTF8",
          body: response.body
        });
      } catch {
        // A response body can be evicted by Chrome; isolate it from the stream.
      }
    }
  }

  async #emit(
    source: ObservedSource,
    url: string,
    resourceType: string,
    transport: ChromeBridgeEnvelope["transport"],
    payload: ChromeBridgeEnvelope["payload"]
  ): Promise<void> {
    const sequence = this.#sequences.get(source.sourceId) ?? 0;
    try {
      const redacted = redactNetworkEnvelope({
        version: 1,
        kind: "NETWORK",
        ...source,
        sequence,
        observedAtMs: this.#now(),
        receivedMonotonicMs: this.#monotonicNow(),
        transport,
        request: { url, resourceType },
        payload
      }) as ChromeBridgeEnvelope;
      await this.#forward(redacted);
      this.#sequences.set(source.sourceId, sequence + 1);
    } catch (error) {
      if (!(error instanceof Error) || !/^BRIDGE_PAYLOAD_/u.test(error.message)) throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
