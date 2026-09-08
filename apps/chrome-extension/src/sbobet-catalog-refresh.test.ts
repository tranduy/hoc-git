import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SbobetCatalogRefresh, type SbobetDetailBatch, type SbobetDetailRequest,
  type SbobetDetailResponse, type SbobetRefreshOptions } from "./sbobet-catalog-refresh.js";

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

  it("spaces provider request starts until a later caller tick without starting its own cadence timer", async () => {
    const starts: Array<[string, number]> = [];
    const { collector } = setup({ minimumDelayMs: 250, request: async (input) => {
      starts.push([input.eventId, Date.now()]); return response(input.eventId);
    } });
    collector.setRoster({ generation: "source:1", events: [event(), event("102"), event("103")] });
    await collector.tick();
    expect(starts).toEqual([["101", 10_000]]);
    await vi.advanceTimersByTimeAsync(249);
    await collector.tick();
    expect(starts).toEqual([["101", 10_000]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([["101", 10_000]]);
    await collector.tick();
    expect(starts).toEqual([["101", 10_000], ["102", 10_250]]);
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
