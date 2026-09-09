import { runInNewContext } from "node:vm";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KSPORT_FOOTBALL_DISCOVERY_EXPRESSION, NetworkObserver } from "./network-observer.js";
import { SbobetRequestBackoff } from "./sbobet-request-backoff.js";

const source = { lobby: "KSPORT", sourceId: "chrome:KSPORT:14", tabId: 14 } as const;
const documentBinding = { frameId: "provider", loaderId: "document" };
const currentLive = "https://be.sb21.net/api/v2/getEvent?agentId=4&timeRange=live&sportType=1_1&sportId=1&oddsStyle=ma";
const currentToday = "https://be.sb21.net/api/v2/getEvent?agentId=4&timeRange=today&sportType=1_1&sportId=1&oddsStyle=ma";
const observers: NetworkObserver[] = [];
afterEach(() => { for (const observer of observers.splice(0)) observer.releaseTab(source.tabId); vi.useRealTimers(); });

async function harness(resources: Array<{ name: string; responseStatus?: number }> = [],
  options: { backoff?: SbobetRequestBackoff; onFetch?: () => void } = {}) {
  const requests: Array<{ url: string; headers: Record<string, string>; method: string }> = [];
  const forwarded: ChromeBridgeEnvelope[] = [];
  let lastExpression = "";
  const observer = new NetworkObserver({
    ...(options.backoff === undefined ? {} : { sbobetRequestBackoff: options.backoff }),
    now: () => 10_000, monotonicNow: () => 100,
    forward: async envelope => { forwarded.push(envelope); },
    sendCommand: async (_tab, method, params) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: {
        id: documentBinding.frameId, loaderId: documentBinding.loaderId, url: "https://zenandfe.com/sport"
      } } };
      if (method === "Network.getResponseBody") return { body: "[]", base64Encoded: false };
      if (method === "Target.getTargets") return { targetInfos: [] };
      if (method === "Runtime.evaluate" && String(params?.expression).includes("fieldline-ksport-catalog-refresh")) {
        lastExpression = String(params?.expression);
        const value = await runInNewContext(String(params?.expression), {
          URL, AbortController, setTimeout, clearTimeout,
          location: { href: "https://zenandfe.com/sport", origin: "https://zenandfe.com" },
          document: { querySelectorAll: () => [] },
          performance: { getEntriesByType: () => resources },
          fetch: async (url: string, init: { method: string; headers: Record<string, string> }) => {
            requests.push({ url, method: init.method, headers: { ...init.headers } });
            options.onFetch?.();
            return { ok: true, status: 200, text: async () => "[]" };
          }
        });
        return { result: { value: JSON.parse(JSON.stringify(value)) as unknown } };
      }
      return {};
    }
  });
  observers.push(observer);
  await observer.handleEvent(source, "Runtime.executionContextCreated", { context: {
    id: 91, auxData: { frameId: documentBinding.frameId, isDefault: true }
  } });
  let ordinal = 0;
  const begin = async (url = currentLive, method = "GET", header = "current-session", postData?: string) => {
    const requestId = `native-${++ordinal}`;
    await observer.handleEvent(source, "Network.requestWillBeSent", { requestId, type: "Fetch",
      ...documentBinding, request: { url, method, headers: { Authorization: header, lng: "vi" },
        ...(postData === undefined ? {} : { postData }) } });
    return { requestId, url };
  };
  const finish = async (request: { requestId: string; url: string }, status = 200, responseUrl = request.url) => {
    await observer.handleEvent(source, "Network.responseReceived", { requestId: request.requestId,
      type: "Fetch", response: { url: responseUrl, status } });
    await observer.handleEvent(source, "Network.loadingFinished", { requestId: request.requestId });
  };
  return { observer, requests, forwarded, begin, finish,
    expression: () => lastExpression,
    refresh: () => observer.refreshCatalog(source) };
}

describe("SBOBET main refresh uses the observed request and its headers together", () => {
  it("selects regular football after an already active GS football group", () => {
    const gsClick = vi.fn(), footballClick = vi.fn();
    const group = (textContent: string, active: boolean, click: () => void) => ({ textContent, click,
      querySelector: () => null, closest: () => null,
      classList: { contains: (name: string) => name === "active-type" && active } });
    const groups = [group("Bóng đá GS LIVE 12", true, gsClick), group("Bóng đá LIVE 42", false, footballClick)];
    const result = runInNewContext(KSPORT_FOOTBALL_DISCOVERY_EXPRESSION, {
      document: { querySelectorAll: () => groups } });
    expect(result.status).toBe("football-selected");
    expect(gsClick).not.toHaveBeenCalled();
    expect(footballClick).toHaveBeenCalledOnce();
  });
  it.each([{ resources: [] }, { resources: [{ name: "https://zenandfe.com/api/v2/getEvent?timeRange=live", responseStatus: 404 }] }])(
    "does not invent or reuse a failed catalog endpoint on an auxiliary worker origin: %j", async ({ resources }) => {
    const h = await harness(); await h.refresh();
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }));
    const result = await runInNewContext(h.expression(), { URL, AbortController, setTimeout, clearTimeout,
      location: { href: "https://zenandfe.com/helper-worker.js" },
      performance: { getEntriesByType: () => resources }, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.status).toBe("fieldline-ksport-catalog-refresh-template-missing");
  });
  it("does not start Today when another lane pauses during Live", async () => {
    const backoff = new SbobetRequestBackoff({ now: () => 10_000 });
    const h = await harness([{ name: currentLive }], { backoff, onFetch: () => backoff.fail(429) });
    await h.refresh();
    expect(h.requests.map(request => request.url)).toEqual([currentLive]);
    expect(h.forwarded.filter(item => item.transport === "HTTP_RESPONSE")).toHaveLength(0);
  });
  it("aborts a stalled native list before CDP timeout can launch another request", async () => {
    const h = await harness([{ name: currentLive }]); await h.refresh();
    vi.useFakeTimers();
    let aborted = false;
    const pending = runInNewContext(h.expression(), { URL, AbortController, setTimeout, clearTimeout,
      location: { href: "https://zenandfe.com/sport", origin: "https://zenandfe.com" },
      document: { querySelectorAll: () => [] }, performance: { getEntriesByType: () => [{ name: currentLive }] },
      fetch: (_url: string, init: RequestInit) => {
        if (!init.signal) return Promise.resolve({ ok: false, status: 503 });
        return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => {
          aborted = true; reject(new Error("ABORTED"));
        }, { once: true }));
      } });
    await vi.advanceTimersByTimeAsync(12_001);
    expect(aborted).toBe(true);
    expect(await pending).toMatchObject({ code: 0 });
  });

  it("keeps a successful observed GET ahead of failed or stale performance resources", async () => {
    const h = await harness([
      { name: "https://be.sb21.net/api/v2/getEvent?timeRange=live&sportId=1", responseStatus: 400 },
      { name: "https://be.sb21.net/api/v2/getEvent?agentId=9&timeRange=today&sportType=2_1&sportId=2", responseStatus: 200 },
      { name: "https://api.sb21.net/api/v2/getEvent?timeRange=live", responseStatus: 200 }
    ]);
    await h.finish(await h.begin());
    await h.refresh();
    expect(h.requests).toEqual([
      { url: currentLive, method: "GET", headers: { Authorization: "current-session", lng: "vi" } },
      { url: currentToday, method: "GET", headers: { Authorization: "current-session", lng: "vi" } }
    ]);
    expect(h.forwarded.filter(x => x.transport === "HTTP_RESPONSE")).toHaveLength(2);
  });

  it.each(["failed", "post", "get-body", "redirect", "pending"])(
    "does not replace a successful template with an invalid native request: %s", async kind => {
      const h = await harness();
      await h.finish(await h.begin());
      const invalid = await h.begin(currentLive.replace("agentId=4", "agentId=99"),
        kind === "post" ? "POST" : "GET", "unverified-session",
        kind === "post" || kind === "get-body" ? "timeRange=live" : undefined);
      if (kind !== "pending") await h.finish(invalid, kind === "failed" ? 400 : 200,
        kind === "redirect" ? "https://be.sb21.net/api/v2/getEvent?timeRange=live" : invalid.url);
      await h.refresh();
      expect(h.requests.map(x => x.url)).toEqual([currentLive, currentToday]);
      expect(h.requests.map(x => x.headers.Authorization)).toEqual(["current-session", "current-session"]);
    }
  );

  it("does not let an older successful response replace the newer request/header pair", async () => {
    const h = await harness();
    const old = await h.begin(currentLive.replace("agentId=4", "agentId=99"), "GET", "old-session");
    await h.finish(await h.begin());
    await h.finish(old);
    await h.refresh();
    expect(h.requests.map(x => x.url)).toEqual([currentLive, currentToday]);
    expect(h.requests.map(x => x.headers.Authorization)).toEqual(["current-session", "current-session"]);
  });

  it("retains performance-only bootstrapping when no observed template exists", async () => {
    const h = await harness([{ name: currentLive }, { name: currentToday }]);
    await h.refresh();
    expect(h.requests).toEqual([
      { url: currentLive, method: "GET", headers: {} },
      { url: currentToday, method: "GET", headers: {} }
    ]);
    expect(h.forwarded.filter(x => x.transport === "HTTP_RESPONSE")).toHaveLength(2);
  });

  it.each([["sportId", "2"], ["sportType", "2_1"], ["oddsStyle", "de"]])(
    "does not replace football with an explicitly conflicting successful request: %s=%s", async (key, value) => {
      const h = await harness();
      await h.finish(await h.begin());
      const otherSport = new URL(currentLive);
      otherSport.searchParams.set(key!, value!);
      await h.finish(await h.begin(otherSport.href, "GET", "other-scope-session"));
      await h.refresh();
      expect(h.requests).toEqual([
        { url: currentLive, method: "GET", headers: { Authorization: "current-session", lng: "vi" } },
        { url: currentToday, method: "GET", headers: { Authorization: "current-session", lng: "vi" } }
      ]);
    }
  );

  it.each([["sportId", "2"], ["sportType", "2_1"], ["oddsStyle", "de"]])(
    "ignores performance-only resources from an explicitly conflicting scope: %s=%s", async (key, value) => {
      const otherSport = new URL(currentLive);
      otherSport.searchParams.set(key!, value!);
      const h = await harness([{ name: currentLive }, { name: currentToday }, { name: otherSport.href }]);
      await h.refresh();
      expect(h.requests.map(x => x.url)).toEqual([currentLive, currentToday]);
      expect(h.forwarded.filter(x => x.transport === "HTTP_RESPONSE")).toHaveLength(2);
    }
  );

  it.each([["sportId", "2"], ["sportType", "2_1"], ["oddsStyle", "de"]])(
    "does not label a conflicting native pair as a full football catalog: %s=%s", async (key, value) => {
      const h = await harness();
      await h.refresh(); // Arms the existing native recovery window without issuing a usable request.
      for (const url of [currentLive, currentToday]) {
        const otherSport = new URL(url);
        otherSport.searchParams.set(key!, value!);
        await h.finish(await h.begin(otherSport.href));
      }
      expect(h.forwarded.filter(x => x.transport === "HTTP_RESPONSE")).toHaveLength(0);
    }
  );
});
