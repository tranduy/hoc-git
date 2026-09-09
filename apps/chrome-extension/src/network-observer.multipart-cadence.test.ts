import { describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";

describe("native multipart transfer cadence", () => {
  it("finishes a large IM body within its original receipt lease despite a slow healthy renderer", async () => {
    const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
    const url = "https://imsports.directsb.net/api/EventV6/GetSE";
    const body = JSON.stringify({ StatusCode: 100, sel: [], padding: "x".repeat(6_600_000) });
    let now = 1_000;
    let frameReads = 0;
    const receipts: { atMs: number; envelope: ChromeBridgeEnvelope }[] = [];
    const observer = new NetworkObserver({ now: () => now, monotonicNow: () => now,
      forward: async envelope => { receipts.push({ atMs: now, envelope }); },
      sendCommand: async (_tab, method) => {
        if (method === "Network.getResponseBody") return { body, base64Encoded: false };
        if (method === "Page.getFrameTree") {
          // Each command succeeds within its existing 2.5s limit. Repeating
          // this round trip for all 61 chunks exhausted the API's 30s lease.
          now += 600; frameReads += 1;
          return { frameTree: { frame: { id: "frame", loaderId: "document" } } };
        }
        return {};
      } });
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "http", frameId: "frame",
      loaderId: "document", request: { method: "POST", url, postData: '{"Market":1}' } });
    await observer.handleEvent(source, "Network.responseReceived", { requestId: "http", type: "XHR",
      response: { url, mimeType: "application/json" } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "http" });
    const chunks = receipts.map(receipt => JSON.parse(receipt.envelope.payload.body));
    expect(chunks).toHaveLength(61);
    expect(chunks.map(chunk => chunk.bodyFragment).join("") === body).toBe(true);
    expect(new Set(receipts.map(receipt => receipt.envelope.observedAtMs))).toEqual(new Set([2_200]));
    expect(receipts.every(receipt => receipt.atMs - receipt.envelope.observedAtMs <= 30_000)).toBe(true);
    expect(frameReads).toBeLessThanOrEqual(4);
    observer.releaseTab(source.tabId);
  });

  it.each(["loader", "source", "bridge"] as const)(
    "withholds the final IM fragment when the %s changes after a middle fragment", async change => {
      const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
      const url = "https://imsports.directsb.net/api/EventV6/GetSE";
      const body = JSON.stringify({ StatusCode: 100, sel: [], padding: "x".repeat(440_000) });
      let loaderId = "document";
      const forwarded: ChromeBridgeEnvelope[] = [];
      const resync = vi.fn(() => observer.beginBridgeSourceEpoch(source.sourceId));
      const observer = new NetworkObserver({ onForwardOverflow: resync,
        forward: async envelope => {
          forwarded.push(envelope);
          if (JSON.parse(envelope.payload.body).chunkIndex === 1) {
            if (change === "loader") loaderId = "replacement";
            if (change === "source") observer.beginSourceEpoch(source.sourceId);
            if (change === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
          }
        },
        sendCommand: async (_tab, method) => method === "Network.getResponseBody"
          ? { body, base64Encoded: false } : method === "Page.getFrameTree"
          ? { frameTree: { frame: { id: "frame", loaderId } } } : {} });
      await observer.handleEvent(source, "Network.requestWillBeSent", { requestId: "http", frameId: "frame",
        loaderId: "document", request: { method: "POST", url, postData: '{"Market":1}' } });
      await observer.handleEvent(source, "Network.responseReceived", { requestId: "http", type: "XHR",
        response: { url, mimeType: "application/json" } });
      await observer.handleEvent(source, "Network.loadingFinished", { requestId: "http" });
      expect(forwarded.length).toBeGreaterThanOrEqual(2);
      expect(forwarded.map(envelope => JSON.parse(envelope.payload.body).chunkIndex)).not.toContain(4);
      expect(resync).toHaveBeenCalledTimes(change === "loader" ? 1 : 0);
      observer.releaseTab(source.tabId);
    });
});
