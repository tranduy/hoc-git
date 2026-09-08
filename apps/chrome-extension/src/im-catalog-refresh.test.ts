import vm from "node:vm";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildImCatalogRefreshExpression } from "./im-catalog-refresh.js";

const START = 1_788_880_000_000;
const fullNative = JSON.parse(readFileSync(new URL("./im-native-full-event.fixture.json", import.meta.url), "utf8"));
const market = (mi: number, o = 0.91, bti = 1) => ({ mi, bti, gp: 1,
  ws: [{ wsi: mi * 10, si: 1, hdp: 0.5, dih: "0.5", o }] });
const event = (eid: number, mls = [market(eid)]) => ({ eid, edt: "2026-09-09T12:00:00Z",
  htn: `Home ${eid}`, atn: `Away ${eid}`, cn: "Football league", isrbt: false, iscyb: false, mls });
type Request = { path: string; body: any; signal: AbortSignal;
  respond: (body: unknown, status?: number) => void; fail: () => void };
function harness() {
  const requests: Request[] = [];
  const listeners = new Map<string, (event: { detail: string }) => void>();
  const globals: Record<string, any> = { Date, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [] },
    location: { hostname: "imsports.directsb.net", search: "?token=PRIVATE_URL_TOKEN" },
    sessionStorage: { getItem: () => "PRIVATE_STALE_TOKEN" },
    global: { PlatForm: "web" },
    addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    dispatchEvent: (value: { type: string; detail: { c: string } }) => {
      if (value.type === "helo") listeners.get(`halo_${value.detail.c}`)?.({ detail: "PRIVATE_SIGNATURE" });
    },
    CustomEvent: class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
      get detail() { return this.init.detail; } },
    fetch: (path: string, init: { body: string; signal: AbortSignal }) => new Promise((resolve, reject) => {
      requests.push({ path, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal,
        respond: (body, status = 200) => resolve({ status, ok: status === 200,
          text: async () => JSON.stringify(body) }), fail: () => reject(new Error("native failure")) });
    }) };
  globals.window = globals;
  const context = vm.createContext(globals);
  const tick = (generation = "source:1:document:1") => vm.runInContext(buildImCatalogRefreshExpression(generation), context);
  const mains = () => requests.filter(r => r.path.endsWith("GetSE"));
  const details = () => requests.filter(r => r.path.includes("GetEBI/"));
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const commit = async (rows: ReturnType<typeof event>[], secondStatus = 100) => {
    await settle();
    const pair = mains().slice(-2);
    expect(pair).toHaveLength(2);
    pair.find(r => r.body.Market === 1)!.respond({ StatusCode: 100, sel: rows });
    pair.find(r => r.body.Market === 2)!.respond({ StatusCode: secondStatus, sel: [] });
    await settle();
  };
  const complete = async (request: Request, rows?: any[]) => {
    const id = Number(request.path.split("/")[5]);
    request.respond({ StatusCode: 100, e: rows?.[0] === undefined && rows !== undefined ? null
      : { ...event(id), ...(rows?.[0] ?? { mls: [market(id + 1000)] }) } }); await settle();
  };
  const parsed = (result: any) => JSON.parse(result.responses.find((r: any) => r.market === 1).body);
  return { globals, tick, requests, mains, details, settle, commit, complete, parsed };
}

describe("IM native detail acquisition", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.useRealTimers(); });

  it("requests the source-proven unfiltered event route and retains every actual native family", async () => {
    // Actual signed response 1788866173879; only execution clocks are synthetic.
    // abtp is a tab subset: this complete response has 68 types, not the old40.
    const h = harness(); const run = h.tick();
    await h.commit([{ ...fullNative.e, mls: [fullNative.e.mls[0]] }]);
    const request = h.requests.find(r => r.path === "/api/EventV6/GetEBI/1/113077626/false/2/false");
    expect(request).toBeDefined();
    expect(request!.body).toBeUndefined();
    request!.respond(fullNative); await h.settle();
    const actual = h.parsed(await run).sel[0].mls;
    expect(actual).toHaveLength(157);
    expect(new Set(actual.map((m: any) => m.bti)).size).toBe(68);
    expect(actual.map((m: any) => ({ mi: m.mi, bti: m.bti, gp: m.gp, ws: m.ws }))).toEqual(
      fullNative.e.mls.map((m: any) => ({ mi: m.mi, bti: m.bti, gp: m.gp,
        ws: m.ws.map((s: any) => ({ wsi: s.wsi, si: s.si, hdp: s.hdp, dih: s.dih, o: s.o })) })));
  });

  it("drains all admitted owners with two physical unfiltered requests", async () => {
    const h = harness(); const run = h.tick();
    await h.commit(Array.from({ length: 5 }, (_, i) => event(i + 1)));
    expect(h.details()).toHaveLength(2);
    expect(h.details().map(r => r.body)).toEqual([undefined, undefined]);
    await h.complete(h.details()[0]!);
    expect(h.details()).toHaveLength(3);
    for (let i = 1; i < 5; i++) await h.complete(h.details()[i]!);
    const result = await run;
    expect(result.coverage).toMatchObject({ prematchEvents: 5, detailEvents: 5, pendingEvents: 0 });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
  });

  it("keeps real receipt clocks and lets newer main replace an older same-ID detail", async () => {
    const h = harness(); const first = h.tick(); await h.commit([event(1)]);
    vi.setSystemTime(START + 100);
    await h.complete(h.details()[0]!, [{ eid: 1, mls: [market(1, 0.61), market(1001, 0.77, 999)] }]);
    await first;
    vi.setSystemTime(START + 8_000);
    const next = h.tick(); await h.commit([event(1, [market(1, 0.95)])]);
    const result = h.parsed(await next);
    expect(result.sel[0].mls.find((m: any) => m.mi === 1)).toMatchObject({
      fieldlineObservedAtMs: START + 8_000, ws: [{ o: 0.95 }] });
    expect(result.sel[0].mls.find((m: any) => m.mi === 1001)).toEqual({
      ...market(1001, 0.77, 999), fieldlineObservedAtMs: START + 100 });
    expect(h.details()).toHaveLength(1);
  });

  it("does not prune a retained owner when only one roster partition succeeds", async () => {
    const h = harness(); const first = h.tick(); await h.commit([event(1)]);
    await h.complete(h.details()[0]!); await first;
    vi.setSystemTime(START + 8_000);
    const next = h.tick(); await h.commit([], 500);
    expect((await next).responses).toEqual([]);
    const retained = h.globals.__fieldlineImNativeCatalogV1.state.owners.get("1");
    expect(retained.markets.get("1001").fieldlineObservedAtMs).toBe(START);
  });

  it("does not publish the previous paired roster when the new pair times out", async () => {
    const h = harness(); const first = h.tick(); await h.commit([event(1)]);
    await h.complete(h.details()[0]!); await first;
    vi.setSystemTime(START + 8_000);
    const next = h.tick(); await h.settle();
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await next).responses).toEqual([]);
    const pending = h.mains().slice(-2);
    for (const request of pending) request.respond({ StatusCode: 100, sel: [event(99)] });
    await h.settle();
    expect([...h.globals.__fieldlineImNativeCatalogV1.state.owners.keys()]).toEqual(["1"]);
  });

  it("retains detail on a missing EBI owner and clears its domain only for a validated empty event", async () => {
    const h = harness(); const first = h.tick(); await h.commit([event(1)]);
    await h.complete(h.details()[0]!); await first;
    vi.setSystemTime(START + 61_000);
    const next = h.tick(); await h.commit([event(1)]);
    await h.complete(h.details()[1]!, []);
    expect(h.parsed(await next).sel[0].mls.some((m: any) => m.mi === 1001)).toBe(true);
    vi.setSystemTime(START + 77_000);
    const empty = h.tick(); await h.commit([event(1)]);
    await h.complete(h.details()[2]!, [{ eid: 1, mls: [] }]);
    expect(h.parsed(await empty).sel[0].mls.map((m: any) => m.mi)).toEqual([1]);
  });

  it("retires old generation values while holding their physical request slots until completion", async () => {
    const h = harness(); const first = h.tick();
    await h.commit([event(1), event(2)]);
    expect(h.details()).toHaveLength(2);
    const old = [...h.details()];
    const next = h.tick("source:2:document:1"); await h.commit([event(50)]);
    expect(h.details()).toHaveLength(2);
    await h.complete(old[0]!);
    expect(h.details()).toHaveLength(3);
    expect(h.details()[2]!.path).toBe("/api/EventV6/GetEBI/1/50/false/2/false");
    await h.complete(old[1]!); await h.complete(h.details()[2]!);
    await first;
    const result = h.parsed(await next);
    expect(result.sel.map((e: any) => e.eid)).toEqual([50]);
    expect(result.sel[0].mls.map((m: any) => m.mi)).toEqual([50, 1050]);
  });
});
