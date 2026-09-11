import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCmdNativeCatalogRefreshExpression,
  formatCmdNativeCatalogDiagnostic } from "./cmd-native-catalog-refresh.js";

const START = 1_788_862_500_000;
const group = (index: number) => `fa97fe7b-13d3-4b03-96db-${String(index).padStart(12, "0")}`;
const row = (id: number, groupId = group(id)) => {
  const value = Array(91).fill(0);
  value[0] = id; value[3] = 100; value[34] = groupId;
  value[37] = "Football league"; value[38] = "Home"; value[39] = "Away";
  value[51] = "S"; value[53] = "12:00"; value[56] = "09/09";
  return value;
};
type NativeRequest = { url: string; body: string; timeout: number;
  success: (body: unknown) => void; fail: (xhr?: { status: number; getResponseHeader?: (name: string) => string | null }) => void };
function harness() {
  const requests: NativeRequest[] = [];
  const globals: Record<string, unknown> = {
    Date, URL, URLSearchParams, Map, Set, setTimeout, clearTimeout, location: { hostname: "cgnew.fts368.com",
      pathname: "/Member/BetOdds/HdpDouble.aspx", origin: "https://cgnew.fts368.com" },
    document: { documentElement: { dataset: {} } },
    GetOddsUrl: () => "/Member/BetsView/BetLight/DataOdds.ashx",
    GetOddsParams: (kind: string) => new URLSearchParams({ fc: kind === "E_Full" ? "6" : "1",
      m_accType: "MY+MR", SystemLanguage: "en-US", TimeFilter: "0", m_gameType: "S_",
      m_SortByTime: "0", m_LeagueList: "", SingleDouble: "double", clientTime: "", c: "A",
      fav: "", exlist: "0", keywords: "", m_sp: "0" }).toString(),
    ISCACHEMODE: true, ISPARLAYBETVIEW: false,
    GetAccountId: () => "PRIVATE_ACCOUNT_SENTINEL", GetAccoutType: () => "MY+MR", GetAccountCommission: () => "A",
    callWebService: (url: string, body: string, success: NativeRequest["success"], fail: () => void,
      _contentType: unknown, timeout: number) => { requests.push({ url, body, success, fail, timeout }); },
    LoadFullRunningTodayData: vi.fn(), LoadFullEarlyData: vi.fn(), onExtraBetTableLoaded: vi.fn()
  };
  const context = vm.createContext(globals);
  const tick = (generation = "source:1") => vm.runInContext(buildCmdNativeCatalogRefreshExpression(generation), context);
  const lists = () => requests.filter(r => r.url.endsWith("DataOdds.ashx"));
  const more = () => requests.filter(r => r.url.endsWith("GetAllOdds"));
  const commit = (today: unknown[][], early: unknown[][], live: unknown[][] = []) => {
    const current = lists().slice(-2);
    expect(current).toHaveLength(2);
    current.find(r => new URLSearchParams(r.body).get("fc") === "1")!.success({ a: true, t: 10, data: live, today, f: {} });
    current.find(r => new URLSearchParams(r.body).get("fc") === "6")!.success({ a: true, t: 11, today: early, f: {} });
  };
  const complete = (request: NativeRequest, eventId: number) => request.success({
    d: [JSON.parse(request.body).m_groupId, eventId, [[0.97, 0.91]], [[-999, -999]]]
  });
  return { context, globals, requests, tick, lists, more, commit, complete };
}

describe("CMD native catalog collector", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.useRealTimers(); });

  it("uses the fastest due event in each owner while retaining far roster members", () => {
    const h = harness();
    const completed = vi.fn();
    const root = (h.globals.document as any).documentElement;
    root.__fieldlineCollectionSchedulerV1 = {
      due: (id: string, receipt: number) => id === "2" && (!receipt || Date.now() - receipt >= 10_000),
      policy: (id: string) => ({ refreshMs: id === "2" ? 10_000 : null }),
      sort: (ids: string[]) => [...ids].reverse(), completed
    };
    h.tick(); h.commit([row(1), row(2, group(1)), row(3)], []);
    expect(h.more()).toHaveLength(1);
    h.complete(h.more()[0]!, 2);
    expect(completed).toHaveBeenCalledWith("2", START);
    expect(h.tick()).toMatchObject({ groups: 2, done: 1 });
    vi.setSystemTime(START + 9_999); h.tick();
    expect(h.more()).toHaveLength(1);
    vi.setSystemTime(START + 10_000); h.tick();
    expect(h.more()).toHaveLength(2);
  });

  it("queues the actual captured prematch owner using its native sport and group columns", () => {
    // Untouched public row from native-discovery-1788862499540, fc1 today;
    // only the test clock is synthetic. Column51 is sport, column56 is date.
    const actual = [25403104,0,0,16497,"bóng đá","00000330",0,"0","0",0,0.25,0,3,0,0.25,"4.5/5",1.25,2.94,2.21,3.45,3.42,2.61,2.34,0,0,0,0,0,0,0,"1","00000010","639244890000000000",1,"fa97fe7b-13d3-4b03-96db-68aca62dd73f","",["00000330","00002900"],"KOREA K LEAGUE 1","Ulsan HD FC","FC Seoul",0.98,0.92,-0.94,0.82,0.72,-0.84,-0.99,0.85,0.97,0.91,0,"S","Live","18:30",0,0,"09/08","KOREA K LEAGUE 1","Ulsan HD FC","FC Seoul","Soccer","00751,,",0,0,0,-999,-999,14,"Ulsan HD FC","FC Seoul",0,1,"","",1,1,0,1,1,0,0,0,0,0,1.57,1.27,1.35,0,0,26955,1871];
    const h = harness(); h.tick(); h.commit([actual], []);
    expect(h.more()).toHaveLength(1);
    expect(JSON.parse(h.more()[0]!.body).m_groupId).toBe(actual[34]);
    h.complete(h.more()[0]!, 25403104);
    expect(h.tick()).toMatchObject({ groups: 1, done: 1 });
  });

  it("uses native full-scope builders and own callbacks without altering the UI", () => {
    const h = harness();
    h.tick();
    expect(h.lists()).toHaveLength(2);
    expect(h.lists().map(r => new URLSearchParams(r.body).get("fc"))).toEqual(["1", "6"]);
    expect(h.lists().every(r => r.timeout === 7_500)).toBe(true);
    h.commit([row(1), row(2, group(1))], [row(3)]);
    expect(h.more()).toHaveLength(2);
    expect(h.tick()).toMatchObject({ todayRows: 2, earlyRows: 1, groups: 2, active: 2 });
    expect(JSON.stringify(h.tick())).not.toContain("PRIVATE_ACCOUNT_SENTINEL");
    expect(h.globals.LoadFullRunningTodayData).not.toHaveBeenCalled();
    expect(h.globals.LoadFullEarlyData).not.toHaveBeenCalled();
    expect(h.globals.onExtraBetTableLoaded).not.toHaveBeenCalled();
  });

  it("accepts the actual native numeric zero parlay flag and preserves its request representation", () => {
    // Native pure-page proof 1788862927946: typeof ISPARLAYBETVIEW === 'number', value0.
    const h = harness(); h.globals.ISPARLAYBETVIEW = 0;
    h.tick();
    expect(h.lists()).toHaveLength(2);
    h.commit([row(1)], []);
    expect(JSON.parse(h.more()[0]!.body).isPar).toBe(0);
  });

  it("preserves the actual native base parameters and server header without returning them", () => {
    const h = harness();
    const headers: string[] = [];
    h.globals.GetBaseParams = (json: boolean) => json ? { nativeBase: "PRIVATE_BASE" } : "nativeBase=PRIVATE_BASE";
    h.globals.sessionStorage = { getItem: () => "PRIVATE_SERVER", setItem: vi.fn() };
    h.globals.$ = { extend: Object.assign, ajax: (options: any) => {
      options.beforeSend?.({ setRequestHeader: (name: string, value: string) => headers.push(`${name}:${value}`) });
      h.requests.push({ url: options.url, body: options.data, timeout: options.timeout, fail: options.error,
        success: body => options.success(body, "success", { getResponseHeader: () => null }) });
    } };
    // Exact public callWebService body captured in native-discovery-1788862499540.
    vm.runInContext(`function callWebService(A,J,H,F,I,K){var E={type:"POST",url:A,cache:false,timeout:K||20000,dataType:"json",success:function(O,P,N){var M=N.getResponseHeader("X-Srv");if(M){sessionStorage.setItem("X-Server-Stats",M)}if(H){H(O,P,N)}},error:F};if(typeof J==="string"&&J.trim().startsWith("{")){try{var L=JSON.parse(J);var C=GetBaseParams(true);$.extend(L,C);E.data=JSON.stringify(L)}catch(G){console.error("Error parsing 'd' as JSON:",G);return}}else{var C=GetBaseParams(false);var B=C?J+"&"+C:J;E.data=B}if(I==null||I==false){E.contentType="application/json; charset=utf-8"}var D=sessionStorage.getItem("X-Server-Stats");if(D){E.beforeSend=function(M){M.setRequestHeader("X-Srv",D)}}$.ajax(E)}`, h.context);
    h.tick(); h.commit([row(1)], []);
    expect(h.lists().every(request => request.body.endsWith("nativeBase=PRIVATE_BASE"))).toBe(true);
    expect(JSON.parse(h.more()[0]!.body)).toMatchObject({ nativeBase: "PRIVATE_BASE", m_accId: "PRIVATE_ACCOUNT_SENTINEL" });
    expect(headers).toEqual(Array(3).fill("X-Srv:PRIVATE_SERVER"));
    expect(JSON.stringify(h.tick())).not.toContain("PRIVATE_");
  });

  it("drains more than two groups through native callbacks without another maintenance tick", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2)], [row(3), row(4), row(5)]);
    expect(h.more()).toHaveLength(2);
    h.complete(h.more()[0]!, 1);
    vi.advanceTimersByTime(500);
    expect(h.more()).toHaveLength(3);
    h.complete(h.more()[1]!, 2);
    vi.advanceTimersByTime(500);
    expect(h.more()).toHaveLength(4);
    h.complete(h.more()[2]!, 3); h.complete(h.more()[3]!, 4);
    vi.advanceTimersByTime(500); h.complete(h.more()[4]!, 5);
    expect(h.tick()).toMatchObject({ groups: 5, done: 5, pending: 0, active: 0, failed: 0 });
    expect(h.more()).toHaveLength(5);
  });

  it("retains physical slots on generation retirement and ignores stale callbacks", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2)], []);
    const old = h.more().slice();
    h.tick("source:2"); h.commit([row(3), row(4)], []);
    expect(h.more()).toHaveLength(2);
    h.complete(old[0]!, 1);
    vi.advanceTimersByTime(500);
    expect(h.more()).toHaveLength(3);
    expect(h.tick("source:2")).toMatchObject({ generation: "source:2", done: 0, active: 2, groups: 2 });
    h.complete(old[1]!, 2);
    vi.advanceTimersByTime(500);
    expect(h.more()).toHaveLength(4);
  });

  it("keeps the committed roster on failed refresh and excludes groups that are live", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2)], [row(3)], [row(4, group(2))]);
    expect(h.more().map(r => JSON.parse(r.body).m_groupId)).toEqual([group(1), group(3)]);
    vi.setSystemTime(START + 30_001); h.tick();
    h.lists().at(-2)!.fail(); h.lists().at(-1)!.fail();
    expect(h.tick()).toMatchObject({ groups: 2, rosterFailed: true });
  });

  it("names why a roster response was refused instead of only that it failed", () => {
    const h = harness(); h.tick();
    const current = h.lists().slice(-2);
    const oversized = Array.from({ length: 20_001 }, () => row(1));
    current.find(r => new URLSearchParams(r.body).get("fc") === "1")!.success({ a: true, t: 10, data: [], today: [], f: {} });
    current.find(r => new URLSearchParams(r.body).get("fc") === "6")!.success({ a: true, t: 11, today: oversized, f: {} });
    // Our own bound and a provider outage both used to read as rosterFailed:1.
    expect(h.tick()).toMatchObject({ rosterFailed: true, rosterReject: "r1-today-over-cap-20001" });
  });

  it("clears the refusal reason once a roster commits", () => {
    const h = harness(); h.tick();
    h.lists().slice(-2).forEach(request => request.success({ a: true, t: 1, today: [], data: [], f: {} }));
    expect(h.tick()).toMatchObject({ rosterFailed: false, rosterReject: null });
  });

  it("carries a bounded refusal reason into the diagnostic and drops anything else", () => {
    expect(formatCmdNativeCatalogDiagnostic({ status: "ready", rosterFailed: true,
      rosterReject: "r1-today-over-cap-20001" })).toContain("rosterReject:r1-today-over-cap-20001");
    for (const reject of ["../escape", "r9-x", "r1-" + "x".repeat(40), { nested: true }, 12]) {
      expect(formatCmdNativeCatalogDiagnostic({ status: "ready", rosterReject: reject }))
        .not.toContain("rosterReject");
    }
  });

  it("retires omitted owners only after both refreshed rosters complete and does not drain after caller retirement", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2), row(3)], []);
    const old = h.more().slice();
    vi.setSystemTime(START + 16_000);
    h.complete(old[0]!, 1);
    expect(h.more()).toHaveLength(2);
    vi.setSystemTime(START + 30_001); h.tick();
    const refresh = h.lists().slice(-2);
    refresh[0]!.success({ a: true, t: 12, data: [], today: [], f: {} });
    expect(h.tick()).toMatchObject({ groups: 3 });
    refresh[1]!.success({ a: true, t: 13, today: [], f: {} });
    expect(h.tick()).toMatchObject({ groups: 0, done: 0 });
    h.complete(old[1]!, 2);
    expect(h.tick()).toMatchObject({ groups: 0, done: 0 });
  });

  it("rejects filtered request scope before starting native requests", () => {
    const h = harness();
    const original = h.globals.GetOddsParams as (kind: string) => string;
    h.globals.GetOddsParams = (kind: string) => original(kind) + "&m_LeagueList=123";
    expect(h.tick()).toMatchObject({ status: "scope-unavailable" });
    expect(h.requests).toHaveLength(0);
  });

  it("rejects wrong-owner More responses and retries only after backoff", () => {
    const h = harness(); h.tick(); h.commit([row(1)], []);
    h.complete(h.more()[0]!, 2);
    expect(h.tick()).toMatchObject({ done: 0, failed: 1, pending: 1 });
    expect(h.more()).toHaveLength(1);
    vi.setSystemTime(START + 15_001); h.tick();
    expect(h.more()).toHaveLength(2);
  });

  it("pauses every owned request after HTTP failure, honors Retry-After and resumes the retained queue", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2), row(3)], []);
    h.more()[0]!.fail({ status: 429, getResponseHeader: () => "120" });
    h.complete(h.more()[1]!, 2);
    expect(h.tick()).toMatchObject({ requestPaused: true, requestStatus: 429, requestRetryInMs: 120_000,
      groups: 3, done: 1, active: 0 });
    const count = h.requests.length;
    vi.setSystemTime(START + 119_999); h.tick();
    expect(h.requests).toHaveLength(count);
    vi.setSystemTime(START + 120_001); h.tick();
    expect(h.more().length).toBeGreaterThan(2);
    expect(h.tick()).toMatchObject({ requestPaused: false, groups: 3, done: 1 });
  });

  it("retains request backoff across source-generation changes and does not let late success clear it", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2)], []);
    const old = h.more().slice();
    old[0]!.fail({ status: 503 });
    h.tick("source:2"); h.complete(old[1]!, 2);
    expect(h.tick("source:2")).toMatchObject({ requestPaused: true, requestRetryInMs: 30_000 });
    expect(h.lists()).toHaveLength(2);
    vi.setSystemTime(START + 30_001); h.tick("source:2");
    expect(h.lists()).toHaveLength(4);
  });

  it("backs off roster failures exponentially without discarding successful detail clocks", () => {
    const h = harness(); h.tick(); h.commit([row(1)], []); h.complete(h.more()[0]!, 1);
    let now = START + 30_001;
    for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      vi.setSystemTime(now); h.tick();
      const pair = h.lists().slice(-2);
      pair[0]!.fail({ status: 503 }); pair[1]!.fail({ status: 503 });
      expect(h.tick()).toMatchObject({ requestPaused: true, requestRetryInMs: delay, groups: 1, done: 1 });
      now += delay + 1;
    }
    const state = (h.globals.document as any).documentElement.__fieldlineCmdNativeCatalogV1;
    expect(state.owners.get(group(1)).nativeMore.observedAtMs).toBe(START);
  });

  it("paces fast More callbacks so maintenance ticks cannot flood the next owners", () => {
    const h = harness(); h.tick(); h.commit(Array.from({ length: 20 }, (_, i) => row(i + 1)), []);
    h.complete(h.more()[0]!, 1); h.complete(h.more()[1]!, 2);
    for (let i = 0; i < 10; i += 1) h.tick();
    expect(h.more()).toHaveLength(2);
    vi.advanceTimersByTime(500);
    expect(h.more()).toHaveLength(4);
  });

  it.each([401, 403])("waits fifteen minutes after authentication refusal %s without relaunching", (status) => {
    const h = harness(); h.tick(); h.lists()[0]!.fail({ status }); h.lists()[1]!.fail({ status });
    vi.setSystemTime(START + 899_999);
    expect(h.tick()).toMatchObject({ requestPaused: true, requestRetryInMs: 1 });
    expect(h.requests).toHaveLength(2);
    vi.setSystemTime(START + 900_001); h.tick();
    expect(h.lists()).toHaveLength(4);
  });

  it("honors an HTTP-date Retry-After longer than its own backoff ceiling", () => {
    const h = harness(); h.tick();
    h.lists()[0]!.fail({ status: 503, getResponseHeader: () => new Date(START + 600_000).toUTCString() });
    expect(h.tick()).toMatchObject({ requestPaused: true, requestRetryInMs: 600_000 });
  });

  it("stops scheduled More work after maintenance goes silent and resumes on the next tick", () => {
    const h = harness(); h.tick(); h.commit([row(1), row(2), row(3)], []);
    vi.setSystemTime(START + 16_000);
    h.complete(h.more()[0]!, 1); h.complete(h.more()[1]!, 2);
    vi.advanceTimersByTime(1_000);
    expect(h.more()).toHaveLength(2);
    h.tick();
    expect(h.more()).toHaveLength(4);
  });
});
