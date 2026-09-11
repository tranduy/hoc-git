import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BTI_CATALOG_REFRESH_EXPRESSION } from "./bti-catalog-refresh.js";

type Row = unknown[];
type PageRoot = { dataset: Record<string, string>; [key: string]: any };
type Fetcher = (path: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<any>;
const START = 1_800_000_000_000;
function event(id: string): Row {
  const value: Row = Array(34).fill(null);
  value[0] = id;
  value[8] = [["a", { EN: "Alpha" }], ["b", { EN: "Beta" }]];
  value[11] = "2027-09-07T12:00:00Z";
  value[13] = false;
  value[20] = [];
  return value;
}
function harness(ids = ["e1"]) {
  const root: PageRoot = { dataset: {} };
  const rosterRow = (id: string): Row => [id, null, null, null, null, false];
  let roster = ids.map(rosterRow);
  let live: Row[] = [];
  let rosterOk = true;
  let context = "synthetic-session-a";
  let list: Fetcher | undefined;
  let listReads = 0;
  let detail: Fetcher = async (path) => ({ ok: true,
    text: async () => JSON.stringify({ data: [event(path.split("/").pop()!.split("?")[0]!)] }) });
  const requests: { eventId: string; signal: AbortSignal; atMs: number }[] = [];
  const fetcher: Fetcher = async (path, init) => {
    if (path.startsWith("/api/eventpage/")) {
      requests.push({ eventId: path.split("/").pop()!.split("?")[0]!, signal: init.signal, atMs: Date.now() });
      return detail(path, init);
    }
    listReads += 1;
    if (path.includes("/early")) return { ok: rosterOk, text: async () => '{"serializedData":[]}' };
    if (list) return list(path, init);
    const league = Array(13).fill(null);
    league[12] = path.includes("prematch") ? roster : live;
    return { ok: rosterOk, text: async () => JSON.stringify({ serializedData: [league] }) };
  };
  const evaluate = new Function("document", "location", "fetch", "localStorage",
    `return ${BTI_CATALOG_REFRESH_EXPRESSION}`);
  const refresh = async () => evaluate({ documentElement: root },
    { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" }, fetcher, { getItem: () => context });
  const nextRoster = async () => {
    await vi.advanceTimersByTimeAsync(13_000);
    return refresh();
  };
  const settle = async () => { await vi.advanceTimersByTimeAsync(1_000); };
  const cache = () => (Object.entries(root).find(([key]) => key.startsWith("__fieldlineBtiDetailBodies"))?.[1] ?? []) as any[];
  return { root, refresh, nextRoster, settle, cache, requests,
    listReads: () => listReads,
    setRoster: (next: string[]) => { roster = next.map(rosterRow); },
    setRows: (prematch: Row[], liveRows: Row[] = []) => { roster = prematch; live = liveRows; },
    setRosterOk: (value: boolean) => { rosterOk = value; },
    setContext: (value: string) => { context = value; },
    setList: (value: Fetcher | undefined) => { list = value; },
    setDetail: (next: Fetcher) => { detail = next; } };
}
const detailBodies = (result: any) => result.responses.filter((row: any) => row.url.startsWith("/api/eventpage/"))
  .map((row: any) => JSON.parse(row.body));

describe("BTI All Early roster", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it("does not replay unchanged far bodies on every maintenance tick", async () => {
    const h = harness();
    h.root.__fieldlineCollectionSchedulerV1 = {
      policy: () => ({ refreshMs: 3_600_000 }),
      due: (_id: string, receipt: number) => !receipt,
      sort: (ids: string[]) => ids, completed: vi.fn()
    };
    await h.refresh(); await h.settle();
    await vi.advanceTimersByTimeAsync(2_000);
    await h.refresh();
    await vi.advanceTimersByTimeAsync(2_000);
    const second = await h.refresh();
    expect(detailBodies(second)).toEqual([]);
    expect(second.responses.some((r: any) => r.url.includes("/leagues/"))).toBe(true);
    expect(h.cache()).toHaveLength(1);
    expect(h.requests).toHaveLength(1);
  });

  it("defers far details without removing their roster and honors tier promotion", async () => {
    const h = harness(["far", "near"]);
    let promoted = false;
    const completed = vi.fn();
    h.root.__fieldlineCollectionSchedulerV1 = {
      policy: (id: string) => ({ refreshMs: id === "far" && !promoted ? null : 30_000 }),
      due: (id: string, receipt: number) => (id !== "far" || promoted) && (!receipt || Date.now() - receipt >= 30_000),
      sort: (ids: string[]) => [...ids].reverse(), completed
    };
    await h.refresh(); await h.settle();
    expect(h.requests.map(r => r.eventId)).toEqual(["near"]);
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!).detailRosterEvents).toBe(2);
    const receipt = h.cache()[0].observedAtMs;
    promoted = true;
    await h.nextRoster(); await h.settle();
    expect(h.requests.map(r => r.eventId)).toEqual(["near", "far"]);
    expect(h.cache().find(c => c.eventId === "near").observedAtMs).toBe(receipt);
    expect(completed).toHaveBeenCalledWith("near", receipt);
  });

  it("retains and requests detail only for events in the installed comparison plan", async () => {
    const h = harness(["unpaired-a", "paired", "unpaired-b"]);
    h.root.__fieldlineCollectionPlanV1 = { revision: 1,
      events: [{ eventId: "paired", startAtUtcMs: START + 60_000, isLive: false }] };
    h.root.__fieldlineCollectionSchedulerV1 = {
      policy: () => ({ refreshMs: 30_000 }), due: () => true,
      sort: (ids: string[]) => ids, completed: vi.fn()
    };

    await h.refresh(); await h.settle();

    expect(h.requests.map(request => request.eventId)).toEqual(["paired"]);
    expect(h.cache().map(item => item.eventId)).toEqual(["paired"]);
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
      detailRosterEvents: 1, detailCachedEvents: 1, detailOverCapEvents: 0
    });
  });

  it("discovers leagues beyond the initial ten and hydrates by master ID before publishing", async () => {
    const root: PageRoot = { dataset: {} };
    const requests: string[] = [];
    const league = (id: string, populated: boolean) => {
      const value = Array(14).fill(null);
      value[0] = `container-${id}`; value[1] = "Early League"; value[3] = id; value[10] = "1";
      value[12] = [[`event-${id}`, populated ? [["h", { EN: "Home Club" }], ["a", { EN: "Away Club" }]] : null,
        populated ? "Home Club vs Away Club" : null, "2027-11-29T12:00:00Z", null, false]];
      return value;
    };
    const allIds = Array.from({ length: 23 }, (_, index) => `master-${index}`);
    const fetcher = async (path: string) => {
      requests.push(path);
      if (path.startsWith("/api/eventpage/")) return new Promise(() => {});
      if (!path.includes("/early")) return { ok: true, text: async () => '{"serializedData":[]}' };
      const url = new URL(path, "https://bti.test");
      expect(url.searchParams.get("SportId")).toBe("1");
      expect(url.searchParams.get("allEvents")).toBe("true");
      const ids = url.searchParams.get("leagueIds")!.split(",");
      expect(ids.length).toBeLessThanOrEqual(10);
      const initial = path.includes("/initial?");
      return { ok: true, text: async () => JSON.stringify({ serializedData:
        (initial ? allIds.slice(0, 10) : allIds).map((id) => league(id, initial || ids.includes(id))) }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage", `return ${BTI_CATALOG_REFRESH_EXPRESSION}`);
    const result = await evaluate({ documentElement: root },
      { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" }, fetcher, { getItem: () => null });
    const roster = JSON.parse(result.responses.find((item: any) => item.url.endsWith("prematch/initial")).body);
    expect(roster.serializedData).toHaveLength(23);
    expect(roster.serializedData.every((item: any) => item[12][0][1]?.length === 2)).toBe(true);
    expect(requests.some((path) => path.includes("leagueIds=container-"))).toBe(false);
    expect(JSON.parse(root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
      earlyLeagues: 23, detailRosterEvents: 23, validEvents: 23
    });
  });
});

describe("BTI bounded cached delivery", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  async function seededCache(count: number, padding = 900 * 1024) {
    const ids = Array.from({ length: count }, (_, index) => `cached-${index}`);
    const h = harness(ids);
    h.setDetail(async () => ({ ok: false, text: async () => "unavailable" }));
    const initial = await h.refresh();
    const key = Object.keys(h.root).find((name) => name.startsWith("__fieldlineBtiDetailBodies"))!;
    h.root[key] = ids.map((eventId) => ({ eventId, path: `/api/eventpage/events/${eventId}`,
      observedAtMs: START, requestedAtMs: START - 50, generation: initial.generation,
      body: JSON.stringify({ data: [[eventId, "x".repeat(padding)]], fieldlineBtiDetails: [{
        eventId, observedAtMs: START, requestedAtMs: START - 50, generation: initial.generation }] }) }));
    return { h, ids, initial };
  }

  it("reserves all three roster responses while bounding detail delivery to eight batches and sixteen MiB", async () => {
    const { h } = await seededCache(10);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await h.refresh();
    const details = result.responses.filter((row: any) => row.url.startsWith("/api/eventpage/"));
    expect(details).toHaveLength(8);
    expect(details.reduce((sum: number, row: any) => sum + Buffer.byteLength(row.body), 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(result.responses.filter((row: any) => row.url.startsWith("/api/eventlist/"))).toHaveLength(3);
    expect(h.cache()).toHaveLength(10);
  });

  it("eventually replays every owner through cache reorder and a new roster generation without changing receipt clocks", async () => {
    const { h, ids, initial } = await seededCache(19);
    const received: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      // Receipts move refreshed owners to the cache tail; this must not reset delivery fairness.
      h.cache().reverse();
      await vi.advanceTimersByTimeAsync(index === 2 ? 13_000 : 2_000);
      const result = await h.refresh();
      const metadata = detailBodies(result).flatMap((body: any) => body.fieldlineBtiDetails);
      expect(metadata).toHaveLength(8);
      for (const row of metadata) expect(row).toEqual({ eventId: row.eventId,
        observedAtMs: START, requestedAtMs: START - 50, generation: initial.generation });
      if (index >= 2) expect(result.generation).not.toBe(initial.generation);
      received.push(...metadata.map((row: any) => row.eventId));
    }
    // Lost forwards need no ACK: each current owner is included again on a later cycle.
    for (const id of ids) expect(received.filter((value) => value === id).length).toBeGreaterThanOrEqual(2);
  });

  it("retains a roster whose actual cached detail exceeds the old 24 MiB eviction threshold", async () => {
    const { h } = await seededCache(30, 1024 * 1024);
    await vi.advanceTimersByTimeAsync(2_000);
    await h.refresh();
    expect(h.cache()).toHaveLength(30);
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
      detailCachedEvents: 30, detailPendingEvents: 0, detailEvictedEvents: 0 });
  });

  it("publishes a newly received price before old cached replay while keeping replay fair", async () => {
    const { h, ids, initial } = await seededCache(40);
    await vi.advanceTimersByTimeAsync(2_000);
    await h.refresh();
    const changed = h.cache().find((item: any) => item.eventId === ids[0]);
    const body = JSON.parse(changed.body);
    changed.requestedAtMs = Date.now();
    changed.observedAtMs = Date.now();
    body.fieldlineBtiDetails[0].requestedAtMs = changed.requestedAtMs;
    body.fieldlineBtiDetails[0].observedAtMs = changed.observedAtMs;
    changed.body = JSON.stringify(body);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await h.refresh();
    const clocks = detailBodies(result).flatMap((entry: any) => entry.fieldlineBtiDetails);
    expect(clocks[0]).toMatchObject({ eventId: ids[0], observedAtMs: START + 2_000, generation: initial.generation });
    expect(clocks.some((row: any) => row.eventId !== ids[0] && row.observedAtMs === START)).toBe(true);
  });

  it("does not consume fresh delivery priority when a background roster finishes after publication", async () => {
    const { h, ids } = await seededCache(40);
    await vi.advanceTimersByTimeAsync(2_000);
    await h.refresh();
    await vi.advanceTimersByTimeAsync(13_000);
    h.setList(async (path) => {
      const league: Row = [];
      league[12] = ids.map((id) => [id, null, null, null, null, false]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { ok: true, text: async () => JSON.stringify({ serializedData: path.includes('prematch') ? [league] : [] }) };
    });
    const publication = h.refresh();
    await vi.advanceTimersByTimeAsync(300);
    await publication;
    const changed = h.cache().find((item: any) => item.eventId === ids[0]);
    const body = JSON.parse(changed.body);
    changed.requestedAtMs = changed.observedAtMs = Date.now();
    body.fieldlineBtiDetails[0].requestedAtMs = body.fieldlineBtiDetails[0].observedAtMs = Date.now();
    changed.body = JSON.stringify(body);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await h.refresh();
    const clocks = detailBodies(result).flatMap((entry: any) => entry.fieldlineBtiDetails);
    expect(clocks[0]).toMatchObject({ eventId: ids[0], observedAtMs: START + 15_300 });
  });
});

describe("BTI private collector regression", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("delivers current detail while a replacement roster is still waiting on the provider", async () => {
    const h = harness();
    const first = await h.refresh();
    await h.settle();
    await vi.advanceTimersByTimeAsync(13_000);
    h.setList(async () => new Promise(() => {}));
    let result: any;
    void h.refresh().then((value: any) => { result = value; });
    await vi.advanceTimersByTimeAsync(300);
    expect(result?.generation).toBe(first.generation);
    expect(detailBodies(result)[0].fieldlineBtiDetails[0].observedAtMs).toBe(START + 14_000);
    const reads = h.listReads();
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await h.refresh()).generation).toBe(first.generation);
    expect(h.listReads()).toBe(reads);
  });

  it("pauses all owned requests after 429 and respects Retry-After across maintenance ticks", async () => {
    const h = harness(Array.from({ length: 12 }, (_, index) => `e${index}`));
    h.setDetail(async () => ({ ok: false, status: 429,
      headers: { get: () => "60" }, text: async () => "" }));
    await h.refresh();
    await h.settle();
    const reads = h.listReads();
    expect(h.requests.length).toBeLessThanOrEqual(3);
    for (let tick = 0; tick < 10; tick += 1) {
      await vi.advanceTimersByTimeAsync(4_000);
      await h.refresh();
    }
    expect(h.requests.length).toBeLessThanOrEqual(3);
    expect(h.listReads()).toBe(reads);
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
      requestStatus: 429, requestPaused: true });
    h.setDetail(async () => ({ ok: true, text: async () => '{"data":[]}' }));
    await vi.advanceTimersByTimeAsync(20_000);
    await h.refresh();
    await h.settle();
    expect(h.requests.length).toBeGreaterThan(3);
  });

  it("stops unauthorized roster retries until native session credentials change", async () => {
    const h = harness();
    h.setList(async () => ({ ok: false, status: 401 }));
    expect((await h.refresh()).status).toBe("catalog-failed");
    const reads = h.listReads();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect((await h.refresh()).status).toBe("catalog-failed");
    expect(h.listReads()).toBe(reads);
    h.setContext("synthetic-renewed-session");
    h.setList(undefined);
    expect((await h.refresh()).status).toBe("catalog-requested");
  });

  it("paces a healthy detail queue instead of bursting through every owner", async () => {
    const h = harness(Array.from({ length: 40 }, (_, index) => `e${index}`));
    await h.refresh();
    await vi.advanceTimersByTimeAsync(999);
    expect(h.requests.length).toBeLessThanOrEqual(6);
    await vi.advanceTimersByTimeAsync(6_001);
    expect(new Set(h.requests.map(({ eventId }) => eventId)).size).toBe(40);
  });

  it("keeps provider cooldown across an extension collector upgrade in the same session", async () => {
    const h = harness();
    h.setDetail(async () => ({ ok: false, status: 429, headers: { get: () => "300" } }));
    await h.refresh();
    await h.settle();
    const reads = h.listReads();
    h.root.__fieldlineBtiDetailStateV10.collectorVersion = 12;
    await vi.advanceTimersByTimeAsync(5_000);
    await h.refresh();
    expect(h.listReads()).toBe(reads);
    expect(h.requests).toHaveLength(1);
  });

  it("retires a previous collector's workers while keeping same-session receipt evidence", async () => {
    const h = harness();
    await h.refresh();
    await h.settle();
    const originalBody = h.cache()[0].body;
    const oldState = h.root.__fieldlineBtiDetailStateV10;
    oldState.collectorVersion = 10;
    const controller = new AbortController();
    oldState.listControllers.add(controller);
    await vi.advanceTimersByTimeAsync(2_000);
    await h.refresh();
    expect(controller.signal.aborted).toBe(true);
    expect(h.root.__fieldlineBtiDetailStateV10).not.toBe(oldState);
    expect(h.cache()[0].body).toBe(originalBody);
  });

  it("only schedules proven prematch rows and retires IDs that are already live", async () => {
    const h = harness();
    h.setRows([["pre", null, null, null, null, false], ["flagged", null, null, null, null, true],
      ["both", null, null, null, null, false], ["unknown"]], [["both", null, null, null, null, true]]);
    await h.refresh();
    expect(h.requests.map(({ eventId }) => eventId)).toEqual(["pre"]);
  });

  it("refreshes a due near event on the existing cached-roster tick while distant detail waits", async () => {
    const h = harness(["near", "distant"]);
    h.setRows(["near", "distant"].map((id, index) => [id, null, null,
      new Date(START + (index === 0 ? 60 * 60_000 : 48 * 60 * 60_000)).toISOString(), null, false]));
    const first = await h.refresh();
    await h.settle();
    await vi.advanceTimersByTimeAsync(11_000);
    const tick = await h.refresh();
    expect(tick.generation).toBe(first.generation);
    expect(h.requests.filter(({ eventId }) => eventId === "near")).toHaveLength(2);
    expect(h.requests.filter(({ eventId }) => eventId === "distant")).toHaveLength(1);
    await h.settle();
    await vi.advanceTimersByTimeAsync(47_000);
    await h.refresh();
    expect(h.requests.filter(({ eventId }) => eventId === "distant")).toHaveLength(2);
  });

  it("invalidates cached session evidence before reuse and ignores an aborted old session detail", async () => {
    const h = harness();
    let release!: () => void;
    h.setDetail(async () => ({ ok: true, text: () => new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify({ data: [event("e1")] }));
    }) }));
    const first = await h.refresh();
    await vi.advanceTimersByTimeAsync(2_000);
    h.setContext("synthetic-session-b");
    h.setDetail(async () => ({ ok: true, text: async () => '{"data":[]}' }));
    const second = await h.refresh();
    expect(second.generation).not.toBe(first.generation);
    expect(h.requests[0]!.signal.aborted).toBe(true);
    release();
    await h.settle();
    expect(JSON.parse(h.cache()[0].body)).toMatchObject({ data: [],
      fieldlineBtiDetails: [{ generation: second.generation }] });
  });

  it("keeps refreshing known hidden detail under the committed generation when roster refresh fails", async () => {
    const h = harness();
    const first = await h.refresh();
    await h.settle();
    h.setRosterOk(false);
    h.setDetail(async () => ({ ok: true, text: async () => '{"data":[]}' }));
    const failedRefresh = await h.nextRoster();
    expect(failedRefresh.generation).toBe(first.generation);
    expect(h.requests).toHaveLength(2);
    await h.settle();
    await vi.advanceTimersByTimeAsync(2_000);
    const recoveredDetail = await h.refresh();
    expect(detailBodies(recoveredDetail)[0].data).toEqual([]);
    expect(detailBodies(recoveredDetail)[0].fieldlineBtiDetails[0]).toMatchObject({
      generation: first.generation, observedAtMs: START + 14_000 });
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({ rosterRefreshFailed: true });
  });

  it("honors bootstrap roster failure backoff without a committed snapshot", async () => {
    const h = harness();
    h.setRosterOk(false);
    expect((await h.refresh()).status).toBe("catalog-failed");
    expect(h.listReads()).toBe(6);
    for (let index = 0; index < 3; index += 1) {
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await h.refresh()).status).toBe("catalog-failed");
    }
    expect(h.listReads()).toBe(6);
    h.setRosterOk(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect((await h.refresh()).status).toBe("catalog-requested");
    expect(h.listReads()).toBe(9);
  });

  it("keeps a fast retained league's receipt clock when another league retries and finishes later", async () => {
    const h = harness([]);
    const league = (id: string, populated: boolean) => {
      const value: Row = []; value[0] = id; value[1] = "League";
      value[12] = populated ? [[`event-${id}`, null, null, null, null, false]] : [];
      return value;
    };
    let slowAttempts = 0;
    h.setList(async (path) => {
      if (path.includes("/live")) return { ok: true, text: async () => '{"serializedData":[]}' };
      if (path.includes("/initial")) return { ok: true, text: async () => JSON.stringify({
        serializedData: Array.from({ length: 11 }, (_, index) => league(`l${index}`, false)) }) };
      const ids = new URL(path, "https://bti.test").searchParams.get("leagueIds")!.split(",");
      if (ids[0] === "l10" && ++slowAttempts === 1) {
        return new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 500));
      }
      return { ok: true, text: () => new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({
        serializedData: ids.map((id) => league(id, id === "l0" || id === "l10"))
      })), ids[0] === "l10" ? 2_000 : 100)) };
    });
    const pending = h.refresh();
    await vi.advanceTimersByTimeAsync(2_600);
    const result = await pending;
    const roster = JSON.parse(result.responses.find((item: any) => item.url.endsWith("prematch/initial")).body);
    expect(slowAttempts).toBe(2);
    expect(roster.serializedData.map((item: any) => item[0])).toEqual(["l0", "l10"]);
    expect(roster.fieldlineBtiRoster).toMatchObject({ requestedAtMs: START, observedAtMs: START + 100 });
  });

  it("clears old-session cached detail even if the replacement session cannot load a roster", async () => {
    const h = harness();
    await h.refresh();
    await h.settle();
    expect(h.cache()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    h.setContext("synthetic-session-b");
    h.setRosterOk(false);
    const result = await h.refresh();
    expect(result.status).toBe("catalog-failed");
    expect(result.responses).toEqual([]);
    expect(h.cache()).toEqual([]);
  });

  it("aborts old-session roster bodies and prevents their late completion from publishing", async () => {
    const h = harness();
    const signals: AbortSignal[] = [];
    const releases: Array<() => void> = [];
    h.setList(async (_path, init) => {
      signals.push(init.signal);
      return { ok: true, text: () => new Promise<string>((resolve) => {
        releases.push(() => resolve('{"serializedData":[]}'));
      }) };
    });
    const pending = h.refresh();
    await vi.advanceTimersByTimeAsync(2_000);
    h.setContext("synthetic-session-b");
    h.setList(undefined);
    const current = await h.refresh();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    releases.forEach((release) => release());
    expect((await pending).responses).toEqual([]);
    await h.settle();
    expect(JSON.parse(h.cache()[0].body).fieldlineBtiDetails[0].generation).toBe(current.generation);
  });

  it("continues discovery beyond one bounded queue on subsequent existing ticks", async () => {
    const h = harness(Array.from({ length: 140 }, (_, index) => `e${index}`));
    await h.refresh();
    for (let index = 0; index < 9; index += 1) {
      await vi.advanceTimersByTimeAsync(3_000);
      await h.refresh();
    }
    expect(new Set(h.requests.map(({ eventId }) => eventId)).size).toBe(140);
    expect(h.cache()).toHaveLength(140);
  });

  it("removes cached prematch detail when the same event becomes live", async () => {
    const h = harness();
    await h.refresh();
    await h.settle();
    h.setRows([["e1", null, null, null, null, true]]);
    const next = await h.nextRoster();
    expect(detailBodies(next)).toEqual([]);
    expect(h.cache()).toEqual([]);
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!).detailRosterEvents).toBe(0);
  });

  it("bounds detail queue and retained event bodies without claiming complete coverage over the cap", async () => {
    const ids = Array.from({ length: 2_051 }, (_, index) => `e${index}`);
    const h = harness(ids);
    h.setDetail(async () => ({ ok: true, text: () => new Promise(() => {}) }));
    const first = await h.refresh();
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!).detailQueuedEvents).toBeLessThanOrEqual(128);
    const cacheKey = Object.keys(h.root).find((key) => key.startsWith("__fieldlineBtiDetailBodies"))!;
    h.root[cacheKey] = ids.map((eventId) => ({ eventId, path: `/api/eventpage/events/${eventId}`,
      observedAtMs: START, requestedAtMs: START, generation: first.generation,
      body: JSON.stringify({ data: [], fieldlineBtiDetails: [{ eventId, observedAtMs: START,
        requestedAtMs: START, generation: first.generation }] }), empty: true }));
    await vi.advanceTimersByTimeAsync(2_000);
    await h.refresh();
    expect(h.cache()).toHaveLength(2_048);
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
      detailRosterEvents: 2_051, detailOverCapEvents: 3, detailCoverageComplete: false });
  });

  it("preserves the original receipt and request clock when cached detail is replayed", async () => {
    const h = harness();
    const first = await h.refresh();
    await h.settle();
    const cached = JSON.parse(h.cache()[0].body);
    expect(cached.fieldlineBtiDetails).toEqual([{ eventId: "e1", observedAtMs: START,
      requestedAtMs: START, generation: first.generation }]);
    h.setDetail(async () => ({ ok: false, text: async () => "unavailable" }));
    const next = await h.nextRoster();
    expect(detailBodies(next).flatMap((body: any) => body.fieldlineBtiDetails)).toEqual(cached.fieldlineBtiDetails);
    expect(JSON.parse(next.responses.find((row: any) => row.url.endsWith("prematch/initial")).body)
      .fieldlineBtiRoster).toMatchObject({ requestedAtMs: START + 14_000, observedAtMs: START + 14_000, complete: true });
  });

  it("publishes newly received hidden detail during roster reuse on the next existing refresh", async () => {
    const h = harness();
    let release!: () => void;
    h.setDetail(async () => ({ ok: true, text: () => new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify({ data: [event("e1")] }));
    }) }));
    const initial = await h.refresh();
    expect(detailBodies(initial)).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    release();
    await h.settle();
    await vi.advanceTimersByTimeAsync(500);
    const next = await h.refresh();
    expect(next.generation).toBe(initial.generation);
    expect(detailBodies(next)[0]?.fieldlineBtiDetails).toEqual([{ eventId: "e1", generation: initial.generation,
      requestedAtMs: START, observedAtMs: START + 500 }]);
    expect(h.requests).toHaveLength(1);
  });

  it("replays a successful empty detail as an authoritative event tombstone", async () => {
    const h = harness();
    await h.refresh();
    await h.settle();
    h.setDetail(async () => ({ ok: true, text: async () => '{"data":[]}' }));
    await h.nextRoster();
    await h.settle();
    const cached = JSON.parse(h.cache()[0].body);
    expect(cached.data).toEqual([]);
    expect(cached.fieldlineBtiDetails).toEqual([expect.objectContaining({ eventId: "e1" })]);
    h.setDetail(async () => ({ ok: false, text: async () => "unavailable" }));
    const next = await h.nextRoster();
    expect(detailBodies(next)).toContainEqual(cached);
  });

  it("does not mark failed detail as successfully visited and reports it against the roster", async () => {
    const h = harness();
    h.setDetail(async () => ({ ok: false, text: async () => '{"data":[]}' }));
    await h.refresh();
    await h.settle();
    expect(JSON.parse(h.root.dataset.fieldlineBtiDetailVisits ?? "{}")).not.toHaveProperty("e1");
    expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
      detailRosterEvents: 1, detailFailedEvents: 1, detailPendingEvents: 1, detailCachedEvents: 0
    });
  });

  it("aborts an in-flight event removed from the authoritative prematch roster", async () => {
    const h = harness();
    let release!: () => void;
    h.setDetail(async () => ({ ok: true, text: () => new Promise<string>((resolve) => {
      release = () => resolve(JSON.stringify({ data: [event("e1")] }));
    }) }));
    await h.refresh();
    // Expire only the completed roster cache; keep the detail read in flight.
    h.root.dataset.fieldlineBtiCatalogRefreshAt = "0";
    for (const key of Object.keys(h.root)) if (key.startsWith("__fieldlineBtiRosterWorker")) delete h.root[key];
    vi.setSystemTime(START + 2_000);
    h.setRoster([]);
    await h.refresh();
    expect(h.requests[0]!.signal.aborted).toBe(true);
    release();
    await h.settle();
    expect(h.cache()).toEqual([]);
  });

  it("releases a detail lane on timeout even when the response body ignores abort", async () => {
    const h = harness(["e1", "e2", "e3", "e4"]);
    h.setDetail(async () => ({ ok: true, text: () => new Promise(() => {}) }));
    await h.refresh();
    expect(h.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(h.requests.map(({ eventId }) => eventId)).toContain("e4");
  });

  it("retains unnamed native detail rows for downstream unmapped accounting", async () => {
    const h = harness();
    const raw = event("e1");
    const market = Array(24).fill(null);
    market[13] = [["native-selection"]];
    raw[20] = [market];
    h.setDetail(async () => ({ ok: true, text: async () => JSON.stringify({ data: [raw] }) }));
    await h.refresh();
    await h.settle();
    expect(JSON.parse(h.cache()[0].body).data[0][20]).toHaveLength(1);
  });

  it("keeps a malformed third native outcome visible to the fail-closed parser", async () => {
    const h = harness();
    const raw = event("e1");
    const market = Array(24).fill(null);
    market[0] = "binary";
    market[5] = ["YN1", "Both teams score"];
    market[13] = [["yes"], ["no"], null];
    raw[20] = [market];
    h.setDetail(async () => ({ ok: true, text: async () => JSON.stringify({ data: [raw] }) }));
    await h.refresh();
    await h.settle();
    expect(JSON.parse(h.cache()[0].body).data[0][20][0][13]).toHaveLength(3);
  });

  it("does not derive event participants from an unknown market's translated handicap label", async () => {
    const h = harness();
    const raw = event("e1");
    raw[8] = [["a", { EN: "Home" }], ["b", { EN: "Away" }]];
    const market = Array(24).fill(null);
    market[0] = "unknown";
    market[1] = "Asian Handicap";
    market[5] = ["ZZ999", "Asian Handicap"];
    market[13] = ["Over", "Under"].map((name, index) => {
      const selection = Array(17).fill(null);
      selection[0] = name;
      selection[2] = { EN: name };
      selection[9] = index === 0 ? 1 : 3;
      return selection;
    });
    raw[20] = [market];
    h.setDetail(async () => ({ ok: true, text: async () => JSON.stringify({ data: [raw] }) }));
    await h.refresh();
    await h.settle();
    expect(JSON.parse(h.cache()[0].body).data[0][8].map((row: any) => row[1])).toEqual([
      { EN: "Home" }, { EN: "Away" }
    ]);
  });

  it("continues to fetch changed hidden prices after bootstrap without refreshing the old cache clock", async () => {
    const h = harness();
    let price = "0.90";
    h.setDetail(async () => {
      const raw = event("e1");
      const market = Array(24).fill(null);
      market[0] = "hidden";
      market[5] = ["OU619", "Total Corners"];
      market[13] = [1, 3].map((side) => {
        const selection = Array(17).fill(null);
        selection[0] = `s${side}`;
        selection[8] = [null, null, null, null, null, price];
        selection[9] = side;
        selection[16] = 9.5;
        return selection;
      });
      raw[20] = [market];
      return { ok: true, text: async () => JSON.stringify({ data: [raw] }) };
    });
    await h.refresh();
    await h.settle();
    price = "0.95";
    const before = await h.nextRoster();
    expect(detailBodies(before)[0].data[0][20][0][13][0][8][5]).toBe("0.95");
    await h.settle();
    await vi.advanceTimersByTimeAsync(2_000);
    const after = await h.refresh();
    const body = detailBodies(after)[0];
    expect(body.data[0][20][0][13][0][8][5]).toBe("0.95");
    expect(body.fieldlineBtiDetails[0].observedAtMs).toBe(START + 14_000);
    expect(h.requests.filter(({ eventId }) => eventId === "e1").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the last valid detail when the next successful HTTP body is malformed or for another event", async () => {
    const h = harness();
    await h.refresh();
    await h.settle();
    const original = h.cache()[0].body;
    for (const body of ['{"data":[null]}', JSON.stringify({ data: [event("other")] })]) {
      h.setDetail(async () => ({ ok: true, text: async () => body }));
      await h.nextRoster();
      await h.settle();
      expect(h.cache()[0].body).toBe(original);
      expect(JSON.parse(h.root.dataset.fieldlineBtiRosterCoverage!)).toMatchObject({
        detailCachedEvents: 1, detailPendingEvents: 0, detailFailedEvents: 1, detailCoverageComplete: false
      });
    }
  });

  it("bounds repeat failures with backoff while keeping the roster available", async () => {
    const h = harness();
    h.setDetail(async () => ({ ok: false, status: 429, text: async () => "busy" }));
    expect((await h.refresh()).status).toBe("catalog-requested");
    await h.settle();
    await h.nextRoster();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    await h.nextRoster();
    await h.settle();
    expect(h.requests).toHaveLength(1);
    await h.nextRoster();
    await h.settle();
    expect(h.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(59_000);
    await h.refresh();
    expect(h.requests).toHaveLength(3);
  });

  it("hydrates all advertised leagues and queues every prematch event without waiting for detail", async () => {
    const root = { dataset: {} };
    const requested: string[] = [];
    const league = (id: string, populated: boolean) => {
      const row = Array(13).fill(null);
      row[0] = id;
      row[12] = populated ? [[`e-${id}`, [], "Alpha vs. Beta", "2027-09-07T12:00:00Z", null, false]] : [];
      return row;
    };
    const fetcher = async (path: string) => {
      requested.push(path);
      if (path.startsWith("/api/eventpage")) return new Promise(() => {});
      if (path.includes("/early")) return { ok: true, text: async () => '{"serializedData":[]}' };
      if (path.includes("/live")) return { ok: true, text: async () => '{"serializedData":[]}' };
      const ids = path.includes("/initial") ? Array.from({ length: 23 }, (_, i) => `l${i}`)
        : new URL(path, "https://bti.test").searchParams.get("leagueIds")!.split(",");
      return { ok: true, text: async () => JSON.stringify({ serializedData: ids.map((id) => league(id, !path.includes("/initial"))) }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage", `return ${BTI_CATALOG_REFRESH_EXPRESSION}`);
    const result = await evaluate({ documentElement: root },
      { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" }, fetcher, { getItem: () => null });
    const roster = JSON.parse(result.responses.find((row: any) => row.url.endsWith("prematch/initial")).body);
    expect(roster.serializedData).toHaveLength(23);
    expect(requested.filter((path) => path.includes("/prematch?"))).toHaveLength(3);
    expect(requested.filter((path) => path.startsWith("/api/eventpage"))).toHaveLength(3);
    expect(JSON.parse((root.dataset as Record<string, string>).fieldlineBtiRosterCoverage!)).toMatchObject({
      detailRosterEvents: 23, detailInFlightEvents: 3, detailQueuedEvents: 20, namedEvents: 23, validEvents: 23
    });
  });

  it("uses the explicit league response to retire initial events and old market rows", async () => {
    const root = { dataset: {} };
    const league = (events: unknown[]) => {
      const value = Array(13).fill(null);
      value[0] = "L";
      value[12] = events;
      return value;
    };
    const raw = (id: string, markets: unknown[]) => {
      const value = Array(9).fill(null);
      value[0] = id;
      value[5] = false;
      value[8] = markets;
      return value;
    };
    const requested: string[] = [];
    const fetcher = async (path: string) => {
      requested.push(path);
      if (path.startsWith("/api/eventpage")) return new Promise(() => {});
      if (path.includes("/early")) return { ok: true, text: async () => '{"serializedData":[]}' };
      if (path.includes("/live")) return { ok: true, text: async () => '{"serializedData":[]}' };
      return { ok: true, text: async () => JSON.stringify({ serializedData: [league(path.includes("/initial")
        ? [raw("e1", ["stale-market"]), raw("departed", ["stale-market"])] : [raw("e1", [])])] }) };
    };
    const evaluate = new Function("document", "location", "fetch", "localStorage", `return ${BTI_CATALOG_REFRESH_EXPRESSION}`);
    const result = await evaluate({ documentElement: root },
      { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" }, fetcher, { getItem: () => null });
    const roster = JSON.parse(result.responses.find((row: any) => row.url.endsWith("prematch/initial")).body);
    expect(roster.serializedData[0][12]).toEqual([raw("e1", [])]);
    expect(requested.filter((path) => path.startsWith("/api/eventpage"))).toEqual([
      "/api/eventpage/events/e1?hideX25X75Selections=false"
    ]);
  });
});
