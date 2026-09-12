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
type Request = { path: string; body: any; signal: AbortSignal; headers: Record<string, string>;
  respond: (body: unknown, status?: number) => void; fail: () => void };
function harness() {
  const requests: Request[] = [];
  const signatures: Array<{ path: string; mode: number }> = [];
  const listeners = new Map<string, (event: { detail: string }) => void>();
  const globals: Record<string, any> = { Date, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [] },
    location: { hostname: "imsports.directsb.net", search: "?token=PRIVATE_URL_TOKEN" },
    sessionStorage: { getItem: () => "PRIVATE_STALE_TOKEN" },
    global: { PlatForm: "web", SiteProfile: { StatusCode: 100, im: true, t: "PRIVATE_STALE_TOKEN" } },
    addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    dispatchEvent: (value: { type: string; detail: { c: string; p: { c: string; a: number } } }) => {
      if (value.type === "helo") {
        signatures.push({ path: value.detail.p.c, mode: value.detail.p.a });
        listeners.get(`halo_${value.detail.c}`)?.({ detail: "PRIVATE_SIGNATURE" });
      }
    },
    CustomEvent: class { constructor(readonly type: string, readonly init: { detail: { c: string } }) {}
      get detail() { return this.init.detail; } },
    fetch: (path: string, init: { body: string; signal: AbortSignal; headers: Record<string, string> }) => new Promise((resolve, reject) => {
      requests.push({ path, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal, headers: init.headers,
        respond: (body, status = 200) => resolve({ status, ok: status === 200,
          text: async () => JSON.stringify(body) }), fail: () => reject(new Error("native failure")) });
    }) };
  globals.window = globals;
  const context = vm.createContext(globals);
  const tick = (generation = "source:1:document:1", options: { readonly allowDetails?: boolean } = {}) =>
    vm.runInContext(buildImCatalogRefreshExpression(generation, options), context);
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
  return { globals, tick, requests, signatures, mains, details, settle, commit, complete, parsed };
}

describe("IM native detail acquisition", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.useRealTimers(); });

  it("keeps both native bulk markets healthy when the plan defers all known far details", async () => {
    const h = harness();
    h.globals.document.documentElement.__fieldlineCollectionSchedulerV1 = {
      due: () => false, policy: () => ({ refreshMs: null }), sort: (ids: string[]) => ids,
      completed: vi.fn()
    };
    const run = h.tick("source:far:document:1", { allowDetails: false });
    await h.commit([event(1)]);
    expect((await run).responses).toHaveLength(2);
    expect(h.mains().map(r => r.body.Market)).toEqual([1, 2]);
    expect(h.mains().every(r => typeof r.body.DateFrom === "string" && !("DateTo" in r.body))).toBe(true);
    expect(h.details()).toHaveLength(0);
  });

  it.each([true, false, undefined, null, "false", 0])(
    "preserves native IM market lock evidence through compact publication: %j", async il => {
      const h = harness();
      const run = h.tick("source:lock:document:1", { allowDetails: false });
      await h.commit([event(1, [{ ...market(1), ...(il === undefined ? {} : { il }) }])]);
      const published = h.parsed(await run).sel[0].mls[0];
      expect(published.il).toBe(typeof il === "boolean" ? il : il === undefined ? undefined : null);
      expect(published.ws[0].wsi).toBe(10);
    });

  it.each([undefined, { StatusCode: 500, im: true, t: "PRIVATE_STALE_TOKEN" },
    { StatusCode: 100, im: false, t: "PRIVATE_STALE_TOKEN" },
    { StatusCode: 100, im: 1, t: "PRIVATE_STALE_TOKEN" },
    { StatusCode: 100, im: true, t: "" },
    { StatusCode: 100, im: true, t: "PRIVATE_OTHER_TOKEN" }])(
    "does not sign or fetch before native member bootstrap is valid: %j", async profile => {
      const h = harness(); h.globals.global.SiteProfile = profile;
      const run = h.tick(); await h.settle();
      expect(h.signatures).toEqual([]); expect(h.requests).toEqual([]);
      expect(await run).toMatchObject({ status: "native-auth-not-ready", responses: [] });
    });

  it("stops owned requests on auth loss and resumes only after a new valid native profile", async () => {
    const h = harness(), first = h.tick(); await h.commit([event(1), event(2), event(3)]);
    const old = [...h.details()], count = h.signatures.length;
    h.globals.global.SiteProfile = undefined;
    const blocked = h.tick(); await h.settle();
    expect(old.every(request => request.signal.aborted)).toBe(true);
    expect(await blocked).toMatchObject({ status: "native-auth-not-ready", responses: [] });
    expect(h.signatures).toHaveLength(count);
    for (const request of old) await h.complete(request);
    expect((await first).responses).toEqual([]);
    h.globals.global.SiteProfile = { StatusCode: 100, im: true, t: "PRIVATE_STALE_TOKEN" };
    const resumed = h.tick(); await h.commit([event(4)]);
    await h.complete(h.details().at(-1)!);
    expect(h.parsed(await resumed).sel.map((e: any) => e.eid)).toEqual([4]);
  });

  it("pauses active work without signing or fetching and resumes after unpause", async () => {
    const h = harness(); let paused = false;
    h.globals.localStorage = { getItem: () => paused ? "1" : null };
    const first = h.tick(); await h.commit([event(1), event(2)]);
    const old = [...h.details()], count = h.signatures.length;
    paused = true;
    expect(await h.tick()).toEqual({ status: "collector-paused", responses: [] });
    expect(old.every(request => request.signal.aborted)).toBe(true);
    expect(h.signatures).toHaveLength(count);
    paused = false;
    const resumed = h.tick(); await h.commit([event(3)]);
    expect(h.details()).toHaveLength(2); // Uncooperative old callbacks still own physical capacity.
    await h.complete(old[0]!); await h.complete(old[1]!);
    await h.complete(h.details().at(-1)!);
    expect((await first).responses).toEqual([]);
    expect(h.parsed(await resumed).sel.map((e: any) => e.eid)).toEqual([3]);
  });

  it("keeps the Market 1 roster inside the provider's query budget", async () => {
    const h = harness(); const run = h.tick("source:1:document:1", { allowDetails: false });
    await h.settle();
    const pair = h.mains().slice(-2);
    const live = pair.find(r => r.body.Market === 1)!;
    const other = pair.find(r => r.body.Market === 2)!;
    // Measured 2026-09-10 against the live account: this market answers five
    // bet types in under six seconds and refuses twenty or forty with
    // StatusCode 9999 and an empty body, which is what took the book dark.
    // Cutting these further was tried on 2026-09-12 and reverted: the provider
    // refused 3+10 types at headAtMs 15065 and 5+40 at 15084, and a refusal that
    // does not move with the size of the ask is a fixed server deadline.
    expect(live.body.BetTypeIds).toEqual([1, 2, 3, 4, 5]);
    expect(other.body.BetTypeIds).toHaveLength(40);
    expect(live.body.GamePeriods).toEqual([1, 2, 3]);
    expect(other.body.GamePeriods).toEqual([1, 2, 3]);
    await h.commit([event(1)]);
    expect(h.parsed(await run).sel).toHaveLength(1);
  });

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
        ws: m.ws.map((s: any) => ({ wsi: s.wsi, si: s.si, hdp: s.hdp, dih: s.dih, o: s.o,
          ot: s.ot, s: s.s })) })));
    expect(actual.find((m: any) => m.bti === 24).ws).toMatchObject([
      { si: 101, ot: 3, s: "total=1.5", o: 5.4 }, { si: 102, ot: 3, s: "total=1.5", o: 1.11 }
    ]);
  });

  it("preserves native odds types and specifiers in main-only responses", async () => {
    const h = harness(), run = h.tick(undefined, { allowDetails: false });
    const rows = fullNative.e.mls.filter((m: any) => m.bti === 24 || m.bti === 25);
    await h.commit([{ ...fullNative.e, mls: rows }]);
    const actual = h.parsed(await run).sel[0].mls;
    expect(h.details()).toHaveLength(0);
    expect(actual.map((m: any) => m.ws)).toEqual(rows.map((m: any) => m.ws.map((s: any) => ({
      wsi: s.wsi, si: s.si, o: s.o, ot: s.ot, s: s.s
    }))));
  });

  it("bounds specifiers and preserves invalid explicit odds types as rejection markers", async () => {
    const h = harness(), run = h.tick(undefined, { allowDetails: false });
    const values = [
      { ot: 3, s: "x".repeat(512) }, { ot: 999, s: "x".repeat(513) },
      { ot: "3", s: { private: "discard" } }, { ot: null, s: ["discard"] },
      { ot: 3.5, s: 1.5 }, {}
    ];
    await h.commit([event(1, [{ ...market(1), ws: values.map((value, i) => ({
      wsi: 10 + i, si: i, hdp: 0.5, dih: "0.5", o: 1.9, ...value
    })) }])]);
    const actual = h.parsed(await run).sel[0].mls[0].ws;
    expect(actual.map((s: any) => s.ot)).toEqual([3, 999, null, null, null, undefined]);
    expect(actual.map((s: any) => s.s)).toEqual(["x".repeat(512), undefined, undefined,
      undefined, undefined, undefined]);
    expect(JSON.stringify(actual)).not.toContain("discard");
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

  it("uses the current native session token and signing mode for every queued request", async () => {
    const h = harness(); const run = h.tick(); await h.commit([event(1), event(2), event(3)]);
    expect(h.requests.every(r => r.headers["x-token"] === "PRIVATE_STALE_TOKEN")).toBe(true);
    expect(h.signatures.every(s => s.mode === 2)).toBe(true);
    h.globals.sessionStorage.getItem = () => "PRIVATE_ROTATED_SESSION";
    h.globals.global.SiteProfile = { StatusCode: 100, im: true, t: "PRIVATE_ROTATED_SESSION" };
    await h.complete(h.details()[0]!);
    expect(h.details()[2]!.headers["x-token"]).toBe("PRIVATE_ROTATED_SESSION");
    expect(h.signatures.at(-1)).toEqual({ path: "/api/EventV6/GetEBI/1/3/false/2/false", mode: 2 });
    await h.complete(h.details()[1]!); await h.complete(h.details()[2]!);
    expect(JSON.stringify(await run)).not.toMatch(/PRIVATE_/);
  });

  it("stops the queued owners when storage rotates before the current native profile", async () => {
    const h = harness(), run = h.tick(); await h.commit([event(1), event(2), event(3)]);
    const count = h.signatures.length;
    h.globals.sessionStorage.getItem = () => "PRIVATE_ROTATED_SESSION";
    await h.complete(h.details()[0]!);
    expect(h.signatures).toHaveLength(count);
    expect(h.details()).toHaveLength(2);
    expect(h.details()[1]!.signal.aborted).toBe(true);
    await h.complete(h.details()[1]!);
    expect((await run).responses).toEqual([]);
  });

  it.each([{ status: 200, body: { StatusCode: 501 } }, { status: 429, body: "throttled" }])(
    "backs off all native requests for 30 seconds after %j without replaying receipts", async failure => {
      const h = harness(), run = h.tick();
      const rows = Array.from({ length: 5 }, (_, i) => event(i + 1));
      await h.commit(rows);
      h.details()[0]!.respond(failure.body, failure.status); await h.settle();
      await h.complete(h.details()[1]!);
      expect(h.details()).toHaveLength(2);
      expect(await run).toMatchObject({ status: "rate-limited", responses: [] });
      const count = h.signatures.length;
      vi.setSystemTime(START + 29_999);
      expect(await h.tick()).toMatchObject({ status: "rate-limited", responses: [] });
      expect(h.signatures).toHaveLength(count);
      vi.setSystemTime(START + 30_000);
      const resumed = h.tick(); await h.commit(rows);
      for (let i = 2; i < 6; i++) await h.complete(h.details()[i]!);
      const result = await resumed;
      expect(result.coverage).toMatchObject({ detailEvents: 5, pendingEvents: 0 });
      expect(h.parsed(result).sel.find((e: any) => e.eid === 2).mls.find((m: any) => m.mi === 1002))
        .toMatchObject({ fieldlineObservedAtMs: START });
    });

  it("keeps transport failure backoff local to its owner", async () => {
    const h = harness(), run = h.tick(); await h.commit([event(1), event(2), event(3)]);
    h.details()[0]!.fail(); await h.settle();
    expect(h.details()).toHaveLength(3);
    await h.complete(h.details()[1]!); await h.complete(h.details()[2]!);
    expect(await run).toMatchObject({ status: "catalog-requested",
      coverage: { detailEvents: 2, pendingEvents: 1 } });
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

  it("starts due detail before the roster result then backs off and preserves late safe failure fields", async () => {
    const h = harness(); const first = h.tick(); await h.commit([event(1)]);
    await h.complete(h.details()[0]!); await first;
    vi.setSystemTime(START + 61_000);
    const next = h.tick(); await h.commit([], 500);
    expect(h.details()).toHaveLength(2);
    const state = h.globals.__fieldlineImNativeCatalogV1.state;
    expect(state.lastFailure).toEqual({ path: "/api/EventV6/GetSE", status: 200, nativeStatusCode: 500,
      errorCategory: "NATIVE_STATUS", observedAtMs: START + 61_000 });
    h.details()[1]!.respond({ StatusCode: 701, token: "PRIVATE_BODY_TOKEN", signature: "PRIVATE_SIGNATURE" }, 503);
    await h.settle();
    const result = await next;
    expect(result).toMatchObject({ status: "rate-limited", responses: [] });
    expect(result.coverage.lastFailure).toEqual({ path: "/api/EventV6/GetSE", status: 200, nativeStatusCode: 500,
      errorCategory: "NATIVE_STATUS", observedAtMs: START + 61_000 });
    const blocked = await h.tick();
    expect(blocked).toMatchObject({ status: "rate-limited", responses: [] });
    expect(blocked.coverage.lastFailure).toEqual({ path: "/api/EventV6/GetEBI/1/1/false/2/false",
      status: 503, nativeStatusCode: 701, errorCategory: "HTTP_STATUS", observedAtMs: START + 61_000 });
    expect(JSON.stringify(blocked.coverage)).not.toMatch(/PRIVATE_|token|signature/i);
    expect(state.owners.get("1").markets.get("1001").fieldlineObservedAtMs).toBe(START);
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
