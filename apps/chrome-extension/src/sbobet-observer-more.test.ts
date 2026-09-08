import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:7", tabId: 7 } as const;
const url = "https://be.sb21.net/api/v2/getEventBetMore?eventId=5717357&oddsStyle=ma&leagueId=481&sportId=1&sportType=1_1";
const binding = { frameId: "football", loaderId: "document-1" };
// Exact public numeric-group response saved after the observed More click, 2026-09-08.
const realGroups = JSON.parse(readFileSync(new URL("./fixtures/sbobet-more-5717357-20260908.json", import.meta.url), "utf8"));
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function harness() {
  let now = 1_000;
  let loader = binding.loaderId;
  let body: unknown = realGroups;
  let encoded = false;
  let afterRead: (() => void) | undefined;
  let documentHook: (() => void) | undefined;
  let forwardHook: (() => Promise<void>) | undefined;
  let contextRegistered = false;
  const forwarded: ChromeBridgeEnvelope[] = [];
  const sendCommand = vi.fn(async (_tab: number, method: string) => {
    if (method === "Page.getFrameTree") {
      documentHook?.();
      return { frameTree: { frame: { id: binding.frameId, loaderId: loader, url: "https://zenandfe.com/sport" } } };
    }
    if (method === "Network.getResponseBody") {
      afterRead?.();
      return { body: JSON.stringify(body), base64Encoded: encoded };
    }
    return {};
  });
  const observer = new NetworkObserver({ sendCommand, forward: async (item) => { forwarded.push(item); await forwardHook?.(); },
    now: () => now, monotonicNow: () => now / 2, observerSessionId: "more-observer" });
  const epoch = observer.beginBridgeSourceEpoch(source.sourceId);
  cleanups.push(() => observer.releaseTab(source.tabId));
  const request = async (options: { method?: string; targetUrl?: string; bound?: boolean } = {}) => {
    if (!contextRegistered) {
      await observer.handleEvent(source, "Runtime.executionContextCreated", {
        context: { id: 91, auxData: { frameId: binding.frameId, isDefault: true } },
      });
      contextRegistered = true;
    }
    await observer.handleEvent(source, "Network.requestWillBeSent", {
      requestId: "more", type: "Fetch", ...(options.bound === false ? {} : binding),
      request: { url: options.targetUrl ?? url, method: options.method ?? "GET", headers: {} },
    });
  };
  const response = async (options: { status?: number; targetUrl?: string } = {}) => {
    await observer.handleEvent(source, "Network.responseReceived", {
      requestId: "more", type: "Fetch", response: { url: options.targetUrl ?? url, status: options.status ?? 200 },
    });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: "more" });
  };
  const more = () => forwarded.filter(item => item.request.streamId?.startsWith("sbobet-more:"));
  return { observer, epoch, sendCommand, forwarded, request, response, more,
    setNow: (value: number) => { now = value; }, setLoader: (value: string) => { loader = value; },
    setBody: (value: unknown) => { body = value; }, setEncoded: () => { encoded = true; },
    afterRead: (hook: () => void) => { afterRead = hook; },
    onDocument: (hook: () => void) => { documentHook = hook; },
    onForward: (hook: () => Promise<void>) => { forwardHook = hook; } };
}

describe("observed SBOBET More HTTP ingestion", () => {
  it("forwards the real flat More inventory as complementary evidence without a full-detail proof", async () => {
    const h = harness();
    await h.request();
    await h.response();
    expect(h.more()).toHaveLength(1);
    const emitted = h.more()[0]!;
    expect(emitted.request).toMatchObject({ hostname: "be.sb21.net", pathnameClass: "/api/v2/getEventBetMore",
      method: "GET", reconcileCutoffSequence: 0 });
    expect(emitted.sourceEpoch).toBe(h.epoch);
    expect(JSON.parse(emitted.payload.body)).toEqual({ kind: "SBOBET_EVENT_MORE", generation: h.epoch,
      eventId: "5717357", leagueId: "481", requestStartSequence: 0, observedAtMs: 1000,
      marketContainerComplete: false, groups: realGroups });
    expect(h.sendCommand.mock.calls.filter(([, method]) => method === "Network.getResponseBody")).toHaveLength(1);
    expect(h.sendCommand.mock.calls.some(([, method]) => method === "Runtime.evaluate")).toBe(false);
  });

  it("continues to ingest real More after the diagnostic discovery window expires", async () => {
    const h = harness();
    await h.request();
    await h.response();
    h.setNow(500_000);
    await h.request();
    await h.response();
    expect(h.more()).toHaveLength(2);
    const second = h.more()[1]!;
    expect(second.request.streamId).not.toBe(h.more()[0]!.request.streamId);
    expect(JSON.parse(second.payload.body).requestStartSequence).toBe(h.more()[0]!.sequence);
  });

  it("retains body receipt clocks across a later document check", async () => {
    const h = harness();
    await h.request();
    h.onDocument(() => h.setNow(9000));
    await h.response();
    expect(h.more()).toHaveLength(1);
    expect(h.more()[0]).toMatchObject({ observedAtMs: 1000, receivedMonotonicMs: 500 });
    expect(JSON.parse(h.more()[0]!.payload.body).observedAtMs).toBe(1000);
  });

  it.each([{}, { "0": ["2,3,4,11,12"] }])("does not turn empty or metadata-only More into a catalog update", async body => {
    const h = harness(); h.setBody(body);
    await h.request(); await h.response();
    expect(h.more()).toHaveLength(0);
  });

  it.each([
    { request: { method: "POST" } }, { request: { bound: false } },
    { request: { targetUrl: url.replace("be.sb21.net", "be.sb21.net.other.test") } },
    { request: { targetUrl: url + "&eventId=123" } },
    { response: { status: 401 } }, { response: { status: 429 } },
    { response: { targetUrl: url.replace("leagueId=481", "leagueId=482") } },
  ])("rejects unbound or mismatched observed request/response %#", async options => {
    const h = harness();
    await h.request("request" in options ? options.request : {});
    await h.response("response" in options ? options.response : {});
    expect(h.more()).toHaveLength(0);
  });

  it.each([
    { "8": ["1.8*99999990080000000h 1.9*99999990080000000a"] },
    { "8": ["https://invalid.example/secret"] }, { "8": [null] },
    { "8": "not-an-array" }, { error: ["not a market response"] },
    { "8": ["oops1.8*571735712h"] }, { "8": ["1e3*571735712h"] },
    { "8": ["1.2.3*571735712h"] },
  ])("rejects malformed or different-event native rows %#", async body => {
    const h = harness(); h.setBody(body);
    await h.request(); await h.response();
    expect(h.more()).toHaveLength(0);
  });

  it("rejects a response from a previous bridge epoch", async () => {
    const h = harness(); await h.request();
    h.observer.beginBridgeSourceEpoch(source.sourceId);
    await h.response(); expect(h.more()).toHaveLength(0);
  });

  it("rejects navigation after the response body is read", async () => {
    const h = harness(); await h.request();
    h.afterRead(() => h.setLoader("document-2"));
    await h.response(); expect(h.more()).toHaveLength(0);
  });

  it("does not reinterpret an encoded response as JSON", async () => {
    const h = harness(); h.setEncoded();
    await h.request(); await h.response(); expect(h.more()).toHaveLength(0);
  });

  it("drops a queued More emission when its execution context is retired", async () => {
    const h = harness();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    h.onForward(() => blocked);
    await h.request();
    const first = h.response();
    await vi.waitFor(() => expect(h.more()).toHaveLength(1));
    let checked = false;
    h.onDocument(() => { checked = true; });
    await h.request();
    const second = h.response();
    await vi.waitFor(() => expect(checked).toBe(true));
    await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 91 });
    release();
    await Promise.all([first, second]);
    expect(h.more()).toHaveLength(1);
  });
});
