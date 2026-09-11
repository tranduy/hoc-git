import { expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";
import { NetworkObserver } from "./network-observer.js";

it("drains an interleaved IM body while another producer waits for its final acknowledgement", async () => {
  const messages: ChromeBridgeEnvelope[] = [];
  const finals: ChromeBridgeEnvelope[] = [];
  const socket: BridgeSocket = { readyState: 1, onopen: null, onclose: null, onmessage: null,
    close() {}, send(raw) {
      const message = JSON.parse(raw) as ChromeBridgeEnvelope;
      messages.push(message);
      const chunk = JSON.parse(message.payload.body);
      if (chunk.chunkIndex === chunk.chunkCount - 1) finals.push(message);
      else queueMicrotask(() => acknowledge(message));
    } };
  const acknowledge = (message: ChromeBridgeEnvelope) => socket.onmessage?.({ data: JSON.stringify({
    version: 1, kind: "ACK", sourceId: message.sourceId, sourceEpoch: message.sourceEpoch, sequence: message.sequence
  }) });
  const bridge = new LocalBridge({ installationKey: "test-only-key", socketFactory: () => socket });
  bridge.connect(); socket.onopen?.();
  const overflow = vi.fn();
  const observer = new NetworkObserver({ sendCommand: async () => ({}),
    forward: message => bridge.admit(message), maxPendingAcknowledgementBytes: 5_000_000,
    onForwardOverflow: overflow, now: () => 1_000, monotonicNow: () => 50 });
  const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
  const body = (size: number) => JSON.stringify({ StatusCode: 100, sel: [], padding: "x".repeat(size) });
  let firstDone = false, secondDone = false;
  const first = observer.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
    body(220_000), { method: "POST", currentDocumentConfirmed: true, providerPartition: "IM_MARKET_1" })
    .then(() => { firstDone = true; });
  const second = observer.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
    body(550_000), { method: "POST", currentDocumentConfirmed: true, providerPartition: "IM_MARKET_2" })
    .then(() => { secondDone = true; });
  try {
    for (let index = 0; index < 300; index++) await Promise.resolve();
    expect(finals).toHaveLength(2);
    expect(firstDone).toBe(false); expect(secondDone).toBe(false);
    expect(messages.map(message => message.sequence)).toEqual(messages.map((_, index) => index));
    expect(new Set(messages.map(message => message.observedAtMs))).toEqual(new Set([1_000]));
    expect(bridge.queueBytes).toBeLessThan(5_000);
    acknowledge(finals[1]!);
    for (let index = 0; index < 30; index++) await Promise.resolve();
    expect(secondDone).toBe(true); expect(firstDone).toBe(false);
    const third = observer.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
      body(550_000), { method: "POST", currentDocumentConfirmed: true, providerPartition: "IM_MARKET_2" });
    for (let index = 0; index < 150; index++) await Promise.resolve();
    expect(finals).toHaveLength(3);
    expect(overflow).not.toHaveBeenCalled();
    acknowledge(finals[2]!);
    acknowledge(finals[0]!);
    await Promise.all([first, second, third]);
  } finally { bridge.close(); observer.releaseTab(8); }
});

it.each(["close", "retire"] as const)("bounds withheld final acknowledgements and releases them on %s", async (release) => {
  const finals: ChromeBridgeEnvelope[] = [];
  const overflow = vi.fn();
  const socket: BridgeSocket = { readyState: 1, onopen: null, onclose: null, onmessage: null,
    close() {}, send(raw) {
      const message = JSON.parse(raw) as ChromeBridgeEnvelope;
      const chunk = JSON.parse(message.payload.body);
      if (chunk.chunkIndex === chunk.chunkCount - 1) finals.push(message);
      else queueMicrotask(() => socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ACK",
        sourceId: message.sourceId, sourceEpoch: message.sourceEpoch, sequence: message.sequence }) }));
    } };
  const bridge = new LocalBridge({ installationKey: "test-only-key", socketFactory: () => socket });
  bridge.connect(); socket.onopen?.();
  const observer = new NetworkObserver({ sendCommand: async () => ({}),
    forward: message => bridge.admit(message), maxPendingAcknowledgementBytes: 2_000_000,
    onForwardOverflow: overflow, now: () => 1_000, monotonicNow: () => 50 });
  const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
  const pending: Promise<void>[] = [];
  try {
    for (let bodyIndex = 0; bodyIndex < 12; bodyIndex++) {
      pending.push(observer.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
        JSON.stringify({ StatusCode: 100, sel: [], padding: "x".repeat(220_000) }),
        { method: "POST", currentDocumentConfirmed: true, providerPartition: "IM_MARKET_1" }));
      for (let index = 0; index < 80; index++) await Promise.resolve();
    }
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(finals.length).toBeLessThanOrEqual(2);
    if (release === "close") bridge.close();
    else bridge.requestSourceResync(source.sourceId);
    await Promise.all(pending);
    observer.beginBridgeSourceEpoch(source.sourceId);
    if (release === "close") { bridge.connect(); socket.onopen?.(); }
    const next = observer.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
      JSON.stringify({ StatusCode: 100, sel: [], padding: "x".repeat(220_000) }),
      { method: "POST", currentDocumentConfirmed: true, providerPartition: "IM_MARKET_1" });
    for (let index = 0; index < 150; index++) await Promise.resolve();
    expect(overflow).toHaveBeenCalledTimes(1);
    const final = finals.at(-1)!;
    socket.onmessage?.({ data: JSON.stringify({ version: 1, kind: "ACK", sourceId: final.sourceId,
      sourceEpoch: final.sourceEpoch, sequence: final.sequence }) });
    await next;
  } finally { bridge.close(); observer.releaseTab(8); }
});
