import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SbobetCatalogRefresh, type SbobetDetailBatch, type SbobetDetailRequest,
  type SbobetDetailResponse, type SbobetRefreshOptions, type SbobetMoreRefreshOptions,
  type SbobetMoreRefreshResponse } from "./sbobet-catalog-refresh.js";
import type { SbobetMoreBatch, SbobetMoreRequest } from "./sbobet-more-protocol.js";

const event = (eventId = "101", startAtUtcMs = 20_000) => ({ eventId, startAtUtcMs, phase: "PREMATCH" as const });
const response = (eventId: string, markets: unknown = { "3": ["2.5 0.91*101h -0.97*101a 123456"] }): SbobetDetailResponse =>
  ({ status: 200, event: { "8": eventId, "7": markets }, marketContainerComplete: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<SbobetRefreshOptions> = {}) {
  const requests: SbobetDetailRequest[] = [];
  const batches: SbobetDetailBatch[] = [];
  let sequence = 40;
  const collector = new SbobetCatalogRefresh({ request: async (input) => {
    requests.push(input); return response(input.eventId);
  }, onBatch: (batch) => { batches.push(batch); }, allocateRequestStartSequence: () => ++sequence,
  nearTtlMs: 1_000, farTtlMs: 5_000, nearWindowMs: 10_000, timeoutMs: 100,
  backoffMs: 200, maxBackoffMs: 2_000, minimumDelayMs: 0, ...overrides });
  return { collector, requests, batches };
}

const moreRequest = (eventId: string): SbobetMoreRequest => ({ eventId, leagueId: "481",
  url: `https://be.sb21.net/api/v2/getEventBetMore?eventId=${eventId}&oddsStyle=ma&leagueId=481&sportId=1&sportType=1_1` });
const moreResponse = (eventId: string, groups: unknown = {
  "21": [`9.5 0.91*${eventId}01h -0.97*${eventId}01a 123456`]
}): SbobetMoreRefreshResponse => ({ status: 200, request: moreRequest(eventId), body: JSON.stringify(groups) });
function setupMore(overrides: Partial<SbobetMoreRefreshOptions> = {}) {
  const requests: SbobetDetailRequest[] = [];
  const batches: SbobetMoreBatch[] = [];
  let sequence = 40;
  const collector = new SbobetCatalogRefresh({ mode: "COMPLEMENTARY_MORE", request: async input => {
    requests.push(input); return moreResponse(input.eventId);
  }, onBatch: batch => { batches.push(batch); }, allocateRequestStartSequence: () => ++sequence,
  nearTtlMs: 1_000, farTtlMs: 5_000, nearWindowMs: 10_000, timeoutMs: 100,
  backoffMs: 200, maxBackoffMs: 2_000, minimumDelayMs: 0, ...overrides });
  return { collector, requests, batches };
}

describe("SbobetCatalogRefresh complementary More mode", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { vi.useRealTimers(); });

  it("uses all four bounded request starts in one caller tick despite sub-250ms responses", async () => {
    const starts: Array<[string, number]> = [];
    const { collector, batches } = setupMore({ minimumDelayMs: 250, nearTtlMs: 30_000, farTtlMs: 120_000,
      request: async input => {
        starts.push([input.eventId, Date.now()]);
        await new Promise(resolve => setTimeout(resolve, 10));
        return moreResponse(input.eventId);
      } });
    collector.setRoster({ generation: "source:1", events: Array.from({ length: 6 }, (_, index) => event(String(101 + index))) });
    const tick = collector.tick();
    expect(collector.tick()).toBe(tick);
    await vi.advanceTimersByTimeAsync(760);
    await tick;
    expect(starts).toEqual([["101", 10_000], ["102", 10_250], ["103", 10_500], ["104", 10_750]]);
    expect(batches.map(batch => batch.observedAtMs)).toEqual([10_010, 10_260, 10_510, 10_760]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts).toHaveLength(4); // No recurring refresh/publication timer.
  });

  it("uses two physical slots for slow responses while spacing every request start", async () => {
    const starts: Array<[string, number]> = [];
    let active = 0;
    let maximum = 0;
    const { collector } = setupMore({ minimumDelayMs: 250, timeoutMs: 2_000, request: async input => {
      starts.push([input.eventId, Date.now()]);
      maximum = Math.max(maximum, ++active);
      await new Promise(resolve => setTimeout(resolve, 600));
      active -= 1;
      return moreResponse(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102"), event("103"), event("104"), event("105")] });
    const tick = collector.tick();
    await vi.advanceTimersByTimeAsync(1_450);
    await tick;
    expect(starts).toEqual([["101", 10_000], ["102", 10_250], ["103", 10_600], ["104", 10_850]]);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });

  it.each(["generation", "removal", "dispose"])("cancels pending spacing immediately on %s", async change => {
    const starts: string[] = [];
    const { collector } = setupMore({ minimumDelayMs: 250, request: async input => {
      starts.push(input.eventId); return moreResponse(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102")] });
    let settled = false;
    const tick = collector.tick().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    if (change === "dispose") collector.dispose();
    else collector.setRoster({ generation: change === "generation" ? "source:2" : "source:1", events: [event()] });
    await tick;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(starts).toEqual(["101"]);
  });

  it("keeps a paced batch alive across identical canonical roster receipts", async () => {
    const starts: Array<[string, number]> = [];
    const { collector } = setupMore({ minimumDelayMs: 250, request: async input => {
      starts.push([input.eventId, Date.now()]); return moreResponse(input.eventId);
    } });
    const roster = { generation: "source:1", events: [event(), event("102")] };
    collector.setRoster(roster);
    const tick = collector.tick();
    await vi.advanceTimersByTimeAsync(10);
    collector.setRoster(roster);
    await vi.advanceTimersByTimeAsync(240);
    await tick;
    expect(starts).toEqual([["101", 10_000], ["102", 10_250]]);
  });

  it("gives provider 429 priority over a pending spacing wait", async () => {
    const starts: string[] = [];
    const { collector } = setupMore({ minimumDelayMs: 250, request: async input => {
      starts.push(input.eventId);
      await new Promise(resolve => setTimeout(resolve, 10));
      return { status: 429, retryAfterMs: 1_500 };
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102")] });
    const tick = collector.tick();
    await vi.advanceTimersByTimeAsync(10);
    await tick;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_499);
    await collector.tick();
    expect(starts).toEqual(["101"]);
  });

  it.each(["request", "emission"])("does not exceed physical capacity or hang a paced tick on an uncooperative %s", async held => {
    const pending = deferred<void>();
    const starts: string[] = [];
    const { collector } = setupMore({ minimumDelayMs: 250, timeoutMs: 300,
      request: async input => {
        starts.push(input.eventId);
        if (held === "request") await pending.promise;
        return moreResponse(input.eventId);
      }, onBatch: async () => { if (held === "emission") await pending.promise; } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102"), event("103"), event("104")] });
    const tick = collector.tick();
    await vi.advanceTimersByTimeAsync(550);
    await tick;
    expect(starts).toEqual(["101", "102"]);
    collector.setRoster({ generation: "source:2", events: [event("105")] });
    await collector.tick();
    expect(starts).toEqual(["101", "102"]);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await collector.tick();
    expect(starts).toEqual(["101", "102", "105"]);
  });

  it("backs off empty More without spending the rest of a bounded batch on the same owner", async () => {
    const starts: string[] = [];
    const { collector, batches } = setupMore({ minimumDelayMs: 250, request: async input => {
      starts.push(input.eventId);
      return moreResponse(input.eventId, input.eventId === "101" ? {} : undefined);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102"), event("103"), event("104")] });
    const tick = collector.tick();
    await vi.advanceTimersByTimeAsync(750);
    await tick;
    expect(starts).toEqual(["101", "102", "103", "104"]);
    expect(batches.map(batch => batch.eventId)).toEqual(["102", "103", "104"]);
  });

  it("emits observed native More groups unchanged with no complete-event claim", async () => {
    // Exact representative rows from the observed 2026-09-08 More receipt.
    const groups = { "0": ["2,3,4,11,12"],
      "19": ["2.5 0.83*57173570190002995h 0.87*57173570190002995a h 184852809191125 0 4 0 1 0"],
      "80": ["1.5 1.88*57173570800001005h 1.83*57173570800001005a 184852809801015 0 11 0 0 0"],
      "131": ["9-10 4.5*57173571310000910h 18485280913110910 0 4 0 1 0"] };
    const pending = deferred<SbobetMoreRefreshResponse>();
    const { collector, batches } = setupMore({ request: () => pending.promise });
    collector.setRoster({ generation: "source:1", events: [event("5717357")] });
    const tick = collector.tick();
    vi.setSystemTime(10_050);
    pending.resolve(moreResponse("5717357", groups));
    await tick;
    expect(batches).toEqual([{ kind: "SBOBET_EVENT_MORE", generation: "source:1", eventId: "5717357",
      leagueId: "481", requestStartSequence: 41, observedAtMs: 10_050, marketContainerComplete: false, groups }]);
  });

  it.each([{}, { "0": ["2,3,4,11,12"] }])("backs off empty or metadata-only More without emission: %j", async groups => {
    let attempts = 0;
    const { collector, batches } = setupMore({ request: async input =>
      ++attempts === 1 ? moreResponse(input.eventId, groups) : moreResponse(input.eventId) });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    expect(batches).toEqual([]);
    vi.setSystemTime(10_199);
    await collector.tick();
    expect(attempts).toBe(1);
    vi.setSystemTime(10_200);
    await collector.tick();
    expect(attempts).toBe(2);
    expect(batches).toEqual([expect.objectContaining({ kind: "SBOBET_EVENT_MORE", observedAtMs: 10_200,
      marketContainerComplete: false })]);
  });

  it("rejects a valid More receipt for a different scheduled event", async () => {
    const { collector, batches } = setupMore({ request: async () => moreResponse("102") });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    expect(batches).toEqual([]);
  });

  it("never admits a complete-event response through complementary mode", async () => {
    const { collector, batches } = setupMore({ request: async () => response("101") });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    expect(batches).toEqual([]);
  });

  it("retains physical request capacity until a retired More callback settles", async () => {
    const old = deferred<SbobetMoreRefreshResponse>();
    const requests: SbobetDetailRequest[] = [];
    const { collector, batches } = setupMore({ maxConcurrent: 1, request: input => {
      requests.push(input); return input.generation === "source:1" ? old.promise : Promise.resolve(moreResponse(input.eventId));
    } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const retired = collector.tick();
    collector.setRoster({ generation: "source:2", events: [event("102")] });
    expect(requests[0]!.signal.aborted).toBe(true);
    await retired;
    await collector.tick();
    expect(requests).toHaveLength(1);
    old.resolve(moreResponse("101"));
    await Promise.resolve();
    await collector.tick();
    expect(batches).toEqual([expect.objectContaining({ eventId: "102", generation: "source:2",
      kind: "SBOBET_EVENT_MORE", marketContainerComplete: false })]);
  });

  it("cancels a queued More emission when its event is removed", async () => {
    const pending = deferred<void>();
    const emitted: SbobetMoreBatch[] = [];
    let emissionSignal: AbortSignal | undefined;
    const { collector } = setupMore({ onBatch: async (batch, signal) => {
      emissionSignal = signal;
      await pending.promise;
      if (!signal.aborted) emitted.push(batch);
    } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const tick = collector.tick();
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    expect(emissionSignal?.aborted).toBe(false);
    collector.setRoster({ generation: "source:1", events: [] });
    expect(emissionSignal?.aborted).toBe(true);
    await tick;
    pending.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });

  it("honors provider-wide More 429 backoff across other scheduled owners", async () => {
    const requested: string[] = [];
    const { collector, batches } = setupMore({ maxConcurrent: 1, request: async input => {
      requested.push(input.eventId);
      return requested.length === 1 ? { status: 429, retryAfterMs: 1_500 } : moreResponse(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102")] });
    await collector.tick();
    expect(requested).toEqual(["101"]);
    vi.setSystemTime(11_499);
    await collector.tick();
    expect(requested).toEqual(["101"]);
    vi.setSystemTime(11_500);
    await collector.tick();
    expect(batches.map(batch => batch.eventId).sort()).toEqual(["101", "102"]);
    expect(batches.every(batch => batch.marketContainerComplete === false)).toBe(true);
  });
});

describe("SbobetCatalogRefresh", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { vi.useRealTimers(); });

  it("emits every native group with the request identity and actual response receipt time", async () => {
    const pending = deferred<SbobetDetailResponse>();
    const { collector, batches } = setup({ request: () => pending.promise });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const tick = collector.tick();
    vi.setSystemTime(10_050);
    pending.resolve(response("101", { "31": ["3.5 0.91*101h -0.97*101a 123456"],
      "777": [{ nativeSelection: "unknown", price: "0.83" }] }));
    await tick;
    expect(batches).toEqual([expect.objectContaining({ eventId: "101", generation: "source:1",
      requestStartSequence: 41, observedAtMs: 10_050, marketContainerComplete: true,
      event: { "8": "101", "7": { "31": ["3.5 0.91*101h -0.97*101a 123456"],
        "777": [{ nativeSelection: "unknown", price: "0.83" }] } } })]);
  });

  it("does no autonomous refresh and schedules near events sooner than far events", async () => {
    const { collector, requests } = setup();
    collector.setRoster({ generation: "source:1", events: [event(), event("102", 100_000)] });
    await collector.tick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests.map((item) => item.eventId)).toEqual(["101", "102"]);
    await collector.tick();
    expect(requests.map((item) => item.eventId)).toEqual(["101", "102", "101"]);
    vi.setSystemTime(15_000);
    await collector.tick();
    expect(requests.map((item) => item.eventId)).toEqual(["101", "102", "101", "101", "102"]);
  });

  it("coalesces concurrent ticks and enforces both concurrency and per-tick request limits", async () => {
    const first = deferred<SbobetDetailResponse>();
    const requests: SbobetDetailRequest[] = [];
    const { collector, batches } = setup({ maxConcurrent: 1, maxRequestsPerTick: 2,
      request: (input) => { requests.push(input); return input.eventId === "101"
        ? first.promise : Promise.resolve(response(input.eventId)); } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102"), event("103")] });
    const tick = collector.tick();
    expect(collector.tick()).toBe(tick);
    expect(requests.map((item) => item.eventId)).toEqual(["101"]);
    first.resolve(response("101"));
    await tick;
    expect(batches.map((item) => item.eventId)).toEqual(["101", "102"]);
    await collector.tick();
    expect(batches.map((item) => item.eventId)).toEqual(["101", "102", "103"]);
  });

  it("spaces bounded request starts inside one caller tick without starting a recurring cadence timer", async () => {
    const starts: Array<[string, number]> = [];
    const { collector } = setup({ minimumDelayMs: 250, request: async (input) => {
      starts.push([input.eventId, Date.now()]); return response(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102"), event("103")] });
    const tick = collector.tick();
    expect(starts).toEqual([["101", 10_000]]);
    await vi.advanceTimersByTimeAsync(249);
    expect(collector.tick()).toBe(tick);
    expect(starts).toEqual([["101", 10_000]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([["101", 10_000], ["102", 10_250]]);
    await vi.advanceTimersByTimeAsync(250);
    await tick;
    expect(starts).toEqual([["101", 10_000], ["102", 10_250], ["103", 10_500]]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(starts).toHaveLength(3);
  });

  it("aborts retired generation requests and rejects their late successful response", async () => {
    const old = deferred<SbobetDetailResponse>();
    let oldRequest: SbobetDetailRequest | undefined;
    const { collector, batches } = setup({ maxConcurrent: 1, request: (input) => {
      if (input.generation === "source:1") { oldRequest = input; return old.promise; }
      return Promise.resolve(response(input.eventId));
    } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const retired = collector.tick();
    collector.setRoster({ generation: "source:2", events: [event("102")] });
    expect(oldRequest?.signal.aborted).toBe(true);
    await retired;
    await collector.tick();
    expect(batches).toEqual([]); // Ignoring abort must not release a physical request slot.
    old.resolve(response("101"));
    await Promise.resolve();
    await collector.tick();
    expect(batches.map((item) => [item.eventId, item.generation])).toEqual([["102", "source:2"]]);
  });

  it("retires a removed or transitioned-live event even within the same source generation", async () => {
    const pending = deferred<SbobetDetailResponse>();
    let signal: AbortSignal | undefined;
    const { collector, batches } = setup({ request: (input) => { signal = input.signal; return pending.promise; } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const tick = collector.tick();
    collector.setRoster({ generation: "source:1", events: [] });
    expect(signal?.aborted).toBe(true);
    pending.resolve(response("101"));
    await tick;
    expect(batches).toEqual([]);
  });

  it("cancels an asynchronous emitter when its source epoch retires", async () => {
    const emitted: SbobetDetailBatch[] = [];
    const pending = deferred<void>();
    let emissionSignal: AbortSignal | undefined;
    const { collector } = setup({ maxConcurrent: 1, onBatch: async (batch, signal) => {
      emissionSignal = signal;
      await pending.promise;
      if (!signal.aborted) emitted.push(batch);
    } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const tick = collector.tick();
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    collector.setRoster({ generation: "source:2", events: [] });
    expect(emissionSignal?.aborted).toBe(true);
    await tick;
    pending.resolve();
    await Promise.resolve();
    expect(emitted).toEqual([]);
  });

  it("times out, aborts, and retries only after backoff without publishing a late result", async () => {
    const pending = deferred<SbobetDetailResponse>();
    const requests: SbobetDetailRequest[] = [];
    const { collector, batches } = setup({ request: (input) => {
      requests.push(input); return requests.length === 1 ? pending.promise : Promise.resolve(response(input.eventId));
    } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    const tick = collector.tick();
    await vi.advanceTimersByTimeAsync(100);
    await tick;
    expect(requests[0]?.signal.aborted).toBe(true);
    pending.resolve(response("101"));
    await Promise.resolve();
    await collector.tick();
    expect(batches).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    await collector.tick();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.observedAtMs).toBe(10_300);
  });

  it("honors a provider 429 retry delay without clearing any retained detail", async () => {
    let attempt = 0;
    const { collector, batches } = setup({ request: async (input) => ++attempt === 2
      ? { status: 429, retryAfterMs: 1_500 } : response(input.eventId) });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    vi.setSystemTime(11_000);
    await collector.tick();
    vi.setSystemTime(12_499);
    await collector.tick();
    expect(batches).toHaveLength(1);
    vi.setSystemTime(12_500);
    await collector.tick();
    expect(batches).toHaveLength(2);
  });

  it.each([
    ["wrong event", { ...response("102") }],
    ["missing completeness", { ...response("101"), marketContainerComplete: false }],
    ["missing market container", { status: 200, event: { "8": "101" }, marketContainerComplete: true }],
    ["malformed market group", response("101", { "777": "not-a-row-list" })],
    ["failed request with empty-looking body", { ...response("101", {}), status: 503 }]
  ])("rejects %s without emitting deletion or a fresh clock", async (_label, result) => {
    const { collector, batches } = setup({ request: async () => result as SbobetDetailResponse });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    expect(batches).toEqual([]);
  });

  it("emits an explicitly complete empty detail as authoritative empty membership", async () => {
    const { collector, batches } = setup({ request: async () => response("101", {}) });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    expect(batches).toEqual([expect.objectContaining({ eventId: "101", event: { "8": "101", "7": {} },
      marketContainerComplete: true })]);
  });

  it("rejects invalid, live, duplicate and oversized rosters before mutating active membership", async () => {
    const { collector, batches } = setup({ maxEvents: 1 });
    collector.setRoster({ generation: "source:1", events: [event()] });
    for (const events of [[event("bad-id")], [{ ...event(), phase: "LIVE" }],
      [event(), event()], [event(), event("102")]]) {
      expect(() => collector.setRoster({ generation: "source:1", events } as Parameters<
        SbobetCatalogRefresh["setRoster"]>[0])).toThrow();
    }
    await collector.tick();
    expect(batches.map((item) => item.eventId)).toEqual(["101"]);
  });

  it("allows parallel requests at the same main-feed cutoff and a new epoch's sequence origin", async () => {
    let sequence = 41;
    const { collector, batches } = setup({ allocateRequestStartSequence: () => sequence });
    collector.setRoster({ generation: "source:1", events: [event(), event("102")] });
    await collector.tick();
    sequence = 0;
    collector.setRoster({ generation: "source:2", events: [event()] });
    await collector.tick();
    expect(batches.map((batch) => [batch.generation, batch.requestStartSequence]))
      .toEqual([["source:1", 41], ["source:1", 41], ["source:2", 0]]);
  });

  it("pauses the entire provider queue after 429 rather than probing every other event", async () => {
    const requested: string[] = [];
    const { collector, batches } = setup({ maxConcurrent: 1, request: async (input) => {
      requested.push(input.eventId);
      return requested.length === 1 ? { status: 429, retryAfterMs: 1_500 } : response(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102")] });
    await collector.tick();
    expect(requested).toEqual(["101"]);
    vi.setSystemTime(11_499);
    await collector.tick();
    expect(batches).toEqual([]);
    vi.setSystemTime(11_500);
    await collector.tick();
    expect(batches.map((batch) => batch.eventId).sort()).toEqual(["101", "102"]);
  });

  it("backs off repeated request failures exponentially without inventing response clocks", async () => {
    let attempt = 0;
    const { collector, batches } = setup({ request: async (input) => {
      if (++attempt <= 2) throw new Error("network error");
      return response(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    vi.setSystemTime(10_200);
    await collector.tick();
    vi.setSystemTime(10_599);
    await collector.tick();
    expect(batches).toEqual([]);
    vi.setSystemTime(10_600);
    await collector.tick();
    expect(batches).toEqual([expect.objectContaining({ observedAtMs: 10_600 })]);
  });

  it("rejects a regressed request cutoff and does not publish after disposal", async () => {
    let sequence = 41;
    const { collector, batches } = setup({ allocateRequestStartSequence: () => sequence });
    collector.setRoster({ generation: "source:1", events: [event()] });
    await collector.tick();
    sequence = 40;
    vi.setSystemTime(11_000);
    await expect(collector.tick()).rejects.toThrow("SBOBET_REQUEST_SEQUENCE_INVALID");
    collector.dispose();
    await collector.tick();
    expect(batches).toHaveLength(1);
  });
});
