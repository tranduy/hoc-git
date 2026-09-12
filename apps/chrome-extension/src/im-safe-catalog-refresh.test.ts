import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildImCatalogRefreshExpression } from "./im-catalog-refresh.js";
import { buildImSafeCatalogRefreshExpression } from "./im-safe-catalog-refresh.js";

const START = 1_788_880_000_000;
type Pending = { path: string; respond: (body: unknown, status?: number, retryAfter?: string) => void; fail: () => void };
function shared() {
  const values = new Map<string, string>();
  let held = false;
  return { storage: { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } },
    locks: { request: async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => {
      if (held) return callback(null);
      held = true; try { return await callback({}); } finally { held = false; }
    } } };
}
function harness(origin = shared()) {
  const requests: Pending[] = [];
  const listeners = new Map<string, (event: { detail: string }) => void>();
  const globals: Record<string, any> = { Date, AbortController, setTimeout, clearTimeout,
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [] },
    location: { hostname: "imsports.directsb.net" }, navigator: { locks: origin.locks },
    localStorage: origin.storage, sessionStorage: { getItem: () => "fixture-session" },
    global: { SiteProfile: { StatusCode: 100, im: true, t: "fixture-session" } },
    addEventListener: (name: string, listener: (event: { detail: string }) => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    dispatchEvent: (event: { detail: { c: string } }) => listeners.get(`halo_${event.detail.c}`)?.({ detail: "fixture-signature" }),
    CustomEvent: class { constructor(readonly type: string, readonly init: { detail: unknown }) {} get detail() { return this.init.detail; } },
    fetch: (path: string) => new Promise((resolve, reject) => { requests.push({ path,
      respond: (body, status = 200, retryAfter) => resolve({ status, ok: status === 200,
        headers: { get: () => retryAfter ?? null }, text: async () => JSON.stringify(body) }),
      fail: () => reject(new Error("network")) }); }) };
  globals.window = globals;
  const context = vm.createContext(globals);
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const run = (expression: string) => vm.runInContext(expression, context);
  const tick = (generation = "one") => run(buildImSafeCatalogRefreshExpression(generation));
  const success = async () => { await settle(); for (const request of requests.slice(-2)) request.respond({ StatusCode: 100,
    sel: [{ eid: 1, edt: "2026-09-09", htn: "Home", atn: "Away", cn: "League", isrbt: false, iscyb: false, mls: [] }] }); await settle(); };
  return { globals, requests, settle, run, tick, success };
}

describe("IM safe roster collection", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.useRealTimers(); });

  it("roster-only mode never starts any event detail requests", async () => {
    const h = harness();
    const running = h.run(buildImCatalogRefreshExpression("one", { allowDetails: false }));
    await h.success();
    expect(h.requests.map(request => request.path)).toEqual(["/api/EventV6/GetSE", "/api/EventV6/GetSE"]);
    expect((await running).responses).toHaveLength(2);
  });

  it("allows a slow successful roster beyond eight seconds while keeping the origin lock", async () => {
    const origin = shared(), h = harness(origin), other = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(h.globals.__fieldlineImNativeCatalogV1.state.controllers.size).toBe(2);
    expect([...h.globals.__fieldlineImNativeCatalogV1.state.controllers]
      .every((controller: AbortController) => !controller.signal.aborted)).toBe(true);
    expect(await other.tick()).toMatchObject({ coverage: { gateReason: "LOCK_HELD" } });
    expect(other.requests).toHaveLength(0);
    await h.success();
    expect((await running).responses).toHaveLength(2);
  });

  it("still aborts stalled roster requests at eighteen seconds and enters backoff", async () => {
    const h = harness(); await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    // 18s, not 15s: the provider was measured answering at 15098ms on
    // 2026-09-12 and the old deadline aborted the response as it arrived.
    await vi.advanceTimersByTimeAsync(18_000);
    expect([...h.globals.__fieldlineImNativeCatalogV1.state.controllers]
      .every((controller: AbortController) => controller.signal.aborted)).toBe(true);
    for (const request of h.requests) request.fail();
    expect(await running).toMatchObject({ status: "rate-limited", responses: [],
      coverage: { lastFailure: { errorCategory: "REQUEST_TIMEOUT" } } });
    await h.tick();
    expect(h.requests).toHaveLength(2);
  });

  it("separates a roster that never answered from one whose body was slow", async () => {
    const stalled = harness(); await stalled.tick(); vi.setSystemTime(START + 30_000);
    const running = stalled.tick(); await stalled.settle();
    await vi.advanceTimersByTimeAsync(18_000);
    for (const request of stalled.requests) request.fail();
    // No response head ever arrived, so the whole deadline is unexplained time.
    expect(await running).toMatchObject({ coverage: { failureStage: "NETWORK",
      elapsedMs: 18_000, headAtMs: null, localFailureCount: 1 } });

    const slow = harness(); await slow.tick(); vi.setSystemTime(Date.now() + 30_000);
    slow.globals.fetch = async () => ({ status: 200, ok: true, headers: { get: () => null },
      text: async () => { throw new Error("local-body-read"); } });
    const slowRunning = slow.tick(); await slow.settle();
    // The head arrived; only the body failed. That is a different fault.
    expect(await slowRunning).toMatchObject({ coverage: { failureStage: "BODY_READ",
      elapsedMs: 0, headAtMs: 0, localFailureCount: 1 } });
  });

  it("caps a long escalation at one minute for a new document without clearing the run", async () => {
    const origin = shared(), h = harness(origin); await h.tick(); vi.setSystemTime(START + 30_000);
    const key = "__fieldlineImSafeCatalogGateV1";
    const failRound = async () => {
      const running = h.tick("round"); await h.settle();
      await vi.advanceTimersByTimeAsync(15_000);
      for (const request of h.requests.slice(-2)) request.fail();
      return running;
    };
    const openGate = () => {
      const gate = JSON.parse(origin.storage.getItem(key)!);
      origin.storage.setItem(key, JSON.stringify({ ...gate, armedAtMs: 0, nextAtMs: 0 }));
    };
    // Escalate past a minute so the cap is what the next document observes.
    for (let round = 0; round < 5; round += 1) { await failRound(); openGate(); }
    const escalated = await failRound();
    expect(escalated).toMatchObject({ coverage: { localFailureCount: 6, retryInMs: 240_000 } });

    // The same document keeps the full escalated wait: reloading is not a
    // remedy the lane earned, and a page refresh must not restart the run.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await h.tick("same-document")).toMatchObject({ status: "rate-limited" });

    // A new document caps only what is left, and the run is preserved so a
    // lane that is still dead re-escalates on its very next round.
    const reopened = harness(origin);
    expect(await reopened.tick("new-document")).toMatchObject({ status: "rate-limited" });
    const gate = JSON.parse(origin.storage.getItem(key)!);
    expect(gate.localFailures).toBe(6);
    expect(gate.nextAtMs - Date.now()).toBeLessThanOrEqual(60_000);
  });


  it("keeps the first local rounds prompt then escalates the wait to a 15-minute cap", async () => {
    const origin = shared(), h = harness(origin); await h.tick(); vi.setSystemTime(START + 30_000);
    const key = "__fieldlineImSafeCatalogGateV1";
    const failRound = async () => {
      const running = h.tick("round"); await h.settle();
      await vi.advanceTimersByTimeAsync(15_000);
      for (const request of h.requests.slice(-2)) request.fail();
      return running;
    };
    // Clearing the persisted deadline stands in for waiting it out, so the test
    // does not have to advance fake timers across a quarter of an hour.
    const openGate = (patch: Record<string, unknown> = {}) => {
      const gate = JSON.parse(origin.storage.getItem(key)!);
      origin.storage.setItem(key, JSON.stringify({ ...gate, armedAtMs: 0, nextAtMs: 0, ...patch }));
    };
    for (const [index, expected] of [30_000, 30_000, 30_000, 60_000, 120_000].entries()) {
      expect(await failRound()).toMatchObject({ coverage: { failureStage: "NETWORK",
        headAtMs: null, localFailureCount: index + 1, retryInMs: expected } });
      openGate();
    }
    // A long run saturates rather than growing without bound.
    openGate({ failures: 20, localFailures: 20 });
    expect(await failRound()).toMatchObject({ coverage: { retryInMs: 900_000 } });
    // An unanswered run still never arms the provider breaker: nothing was read
    // from the provider that could be called a refusal.
    expect(JSON.parse(origin.storage.getItem(key)!)).toMatchObject({ providerFailures: 0, hardBlocked: false });
    openGate();
    const recovered = h.tick("recovered"); await h.success();
    expect(await recovered).toMatchObject({ status: "catalog-requested", coverage: { localFailureCount: 0 } });
  }, 20_000);

  it("reports the original timeout stage and clock through cooldown without counting another failed round", async () => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    await vi.advanceTimersByTimeAsync(15_000);
    for (const request of h.requests) request.fail();
    expect(await running).toMatchObject({ coverage: { failureCount: 1, retryInMs: 30_000,
      lastFailureAtMs: START + 45_000, failureStage: "NETWORK" } });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await h.tick()).toMatchObject({ status: "rate-limited", coverage: { gateReason: "COOLDOWN",
      failureCount: 1, retryInMs: 22_000, lastFailureAtMs: START + 45_000, failureStage: "NETWORK" } });
    expect(h.requests).toHaveLength(2);
    const persisted = JSON.parse(origin.storage.getItem("__fieldlineImSafeCatalogGateV1")!);
    expect(persisted.lastFailure).toMatchObject({ observedAtMs: START + 45_000, failureStage: "NETWORK" });
    await vi.advanceTimersByTimeAsync(22_000);
    const recovered = h.tick(); await h.success();
    expect(await recovered).toMatchObject({ status: "catalog-requested", coverage: {
      failureCount: 0, retryInMs: 20_000, lastFailureAtMs: null, failureStage: null } });
  });

  it("retains a BODY_READ timeout stage instead of attributing it to the request headers", async () => {
    const h = harness(); await h.tick(); vi.setSystemTime(START + 30_000);
    const rejectBodies: Array<(reason: Error) => void> = [];
    h.globals.fetch = async () => ({ status: 200, ok: true, headers: { get: () => null },
      text: () => new Promise((_resolve, reject) => rejectBodies.push(reject)) });
    const running = h.tick(); await h.settle();
    await vi.advanceTimersByTimeAsync(18_000);
    for (const reject of rejectBodies) reject(new Error("aborted"));
    expect(await running).toMatchObject({ coverage: { lastFailureAtMs: START + 48_000,
      failureStage: "BODY_READ", lastFailure: { status: 200, errorCategory: "REQUEST_TIMEOUT" } } });
  });

  it("retains the SIGNATURE stage and leaves legacy failure stages unknown", async () => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    h.globals.dispatchEvent = () => undefined;
    const running = h.tick(); await vi.advanceTimersByTimeAsync(3_000);
    expect(await running).toMatchObject({ coverage: { failureStage: "SIGNATURE",
      lastFailureAtMs: START + 33_000, lastFailure: { errorCategory: "SIGNATURE" } } });
    const gate = JSON.parse(origin.storage.getItem("__fieldlineImSafeCatalogGateV1")!);
    delete gate.lastFailure.failureStage; origin.storage.setItem("__fieldlineImSafeCatalogGateV1", JSON.stringify(gate));
    expect(await h.tick()).toMatchObject({ coverage: { failureStage: null,
      lastFailureAtMs: START + 33_000, failureCount: 1 } });
  });

  it("shares the initial 30-second passive grace and 20-second round budget across documents", async () => {
    const origin = shared(), a = harness(origin), b = harness(origin);
    expect((await a.tick()).responses).toEqual([]);
    vi.setSystemTime(START + 29_999);
    await b.tick("new-document"); expect(b.requests).toHaveLength(0);
    vi.setSystemTime(START + 30_000);
    const first = a.tick(); await a.success(); expect((await first).responses).toHaveLength(2);
    vi.setSystemTime(START + 49_999);
    expect((await b.tick("new-generation")).responses).toEqual([]);
    expect(b.requests).toHaveLength(0);
    vi.setSystemTime(START + 50_000);
    const second = b.tick("new-generation"); await b.success(); expect((await second).responses).toHaveLength(2);
    expect([...a.requests, ...b.requests].every(request => request.path.endsWith("/GetSE"))).toBe(true);
  });

  it.each([{ status: 200, body: { StatusCode: 501 } }, { status: 401, body: "denied" },
    { status: 403, body: "denied" }])("persists the hard block for %j across fresh contexts and generations", async failure => {
    const origin = shared(), a = harness(origin);
    await a.tick(); vi.setSystemTime(START + 30_000);
    const running = a.tick(); await a.settle();
    a.requests[0]!.respond(failure.body, failure.status);
    a.requests[1]!.respond({ StatusCode: 500 });
    expect(await running).toMatchObject({ status: "collector-paused", responses: [] });
    vi.setSystemTime(START + 86_400_000);
    const b = harness(origin);
    expect((await b.tick("restarted")).status).toBe("collector-paused");
    expect(b.requests).toHaveLength(0);
  });

  it("holds the origin lock through a failed pair's physically unsettled sibling", async () => {
    const origin = shared(), a = harness(origin), b = harness(origin);
    await a.tick(); vi.setSystemTime(START + 30_000);
    let completed = false;
    const first = a.tick().then((result: unknown) => { completed = true; return result; });
    await a.settle(); a.requests[0]!.fail(); await a.settle();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(completed).toBe(false);
    expect(await b.tick("different-document")).toMatchObject({ status: "rate-limited",
      coverage: { gateReason: "LOCK_HELD" } });
    expect(b.requests).toHaveLength(0);
    a.requests[1]!.respond({ StatusCode: 100, sel: [] });
    expect((await first as any).responses).toEqual([]);
    expect(await b.tick()).toMatchObject({ status: "rate-limited",
      coverage: { gateReason: "COOLDOWN" } });
  });

  it("persists a hard block immediately before the sibling request settles", async () => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    h.requests[0]!.respond({ StatusCode: 501 }); await h.settle();
    expect(JSON.parse(origin.storage.getItem("__fieldlineImSafeCatalogGateV1")!).hardBlocked).toBe(true);
    h.requests[1]!.respond({ StatusCode: 100, sel: [] });
    expect((await running).status).toBe("collector-paused");
  });

  it("retains a received native 501 even when native authentication retires during the response", async () => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    h.globals.global.SiteProfile = undefined;
    h.requests[0]!.respond({ StatusCode: 501 });
    h.requests[1]!.respond({ StatusCode: 100, sel: [] });
    await running;
    expect(JSON.parse(origin.storage.getItem("__fieldlineImSafeCatalogGateV1")!).hardBlocked).toBe(true);
  });

  it("pauses every provider-failed round at least 30 seconds and escalates three failures to 15 minutes", async () => {
    const origin = shared(), a = harness(origin);
    await a.tick();
    for (let round = 0; round < 3; round++) {
      vi.setSystemTime(START + 30_000 + round * 30_000);
      const running = a.tick(`generation-${round}`); await a.settle();
      for (const request of a.requests.slice(-2)) request.respond({ StatusCode: 500 }, 429);
      expect((await running).responses).toEqual([]);
      vi.setSystemTime(START + 59_999 + round * 30_000);
      // A provider-refused round now reports the provider's own code instead
      // of the generic pause, so the pause itself is asserted by retryInMs.
      expect((await harness(origin).tick()).status).toBe("native-status-500");
    }
    const b = harness(origin);
    vi.setSystemTime(START + 90_000 + 899_999);
    await b.tick(); expect(b.requests).toHaveLength(0);
    vi.setSystemTime(START + 90_000 + 900_000);
    const resumed = b.tick(); await b.success(); expect((await resumed).responses).toHaveLength(2);
  });

  it("retries three local NETWORK timeouts after 30 seconds without escalating a provider breaker", async () => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    for (let round = 0; round < 3; round++) {
      const running = h.tick(`round-${round}`); await h.settle();
      await vi.advanceTimersByTimeAsync(15_000);
      for (const request of h.requests.slice(-2)) request.fail();
      expect(await running).toMatchObject({ responses: [], coverage: {
        failureCount: round + 1, failureStage: "NETWORK", retryInMs: 30_000 } });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(await harness(origin).tick("other-document")).toMatchObject({ status: "rate-limited" });
      expect(h.requests).toHaveLength((round + 1) * 2);
      await vi.advanceTimersByTimeAsync(1);
    }
    const other = harness(origin);
    const recovered = other.tick("new-document"); await other.success();
    expect(await recovered).toMatchObject({ status: "catalog-requested", coverage: { failureCount: 0 } });
    expect(other.requests).toHaveLength(2);
  });

  it.each(["SIGNATURE", "BODY_READ"])("does not turn repeated local %s failures into a provider refusal", async stage => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    if (stage === "SIGNATURE") h.globals.dispatchEvent = () => undefined;
    else h.globals.fetch = async () => ({ status: 200, ok: true, headers: { get: () => null },
      text: async () => { throw new Error("local-body-read"); } });
    for (let round = 0; round < 3; round++) {
      const running = h.tick(); await h.settle();
      if (stage === "SIGNATURE") await vi.advanceTimersByTimeAsync(3_000);
      expect(await running).toMatchObject({ responses: [], coverage: {
        failureCount: round + 1, failureStage: stage, retryInMs: 30_000 } });
      await vi.advanceTimersByTimeAsync(30_000);
    }
  });

  it("counts provider-failed rounds separately from local failures and once per pair", async () => {
    const origin = shared(), h = harness(origin);
    await h.tick(); vi.setSystemTime(START + 30_000);
    for (const kind of ["local", "local", "provider", "local", "provider", "provider"]) {
      const running = h.tick(); await h.settle();
      for (const request of h.requests.slice(-2)) {
        if (kind === "local") request.fail();
        else request.respond({ StatusCode: 500 }, 429);
      }
      const result = await running;
      const thirdProvider = h.requests.length === 12;
      expect(result).toMatchObject({ coverage: { retryInMs: thirdProvider ? 900_000 : 30_000 } });
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const replacement = harness(origin);
    // The last round was a provider refusal, so the pause now reports the
    // provider's own StatusCode rather than hiding it behind a generic status.
    expect(await replacement.tick()).toMatchObject({ status: "native-status-500" });
    expect(replacement.requests).toHaveLength(0);
  });

  it.each(["success", "local failure"])("keeps legacy persisted deadlines before resuming with %s", async outcome => {
    const origin = shared();
    origin.storage.setItem("__fieldlineImSafeCatalogGateV1", JSON.stringify({ version: 1,
      armedAtMs: START, nextAtMs: START + 900_000, failures: 4, hardBlocked: false,
      lastFailure: { status: null, nativeStatusCode: null, errorCategory: "REQUEST_TIMEOUT",
        failureStage: "NETWORK", observedAtMs: START } }));
    const h = harness(origin);
    expect(await h.tick()).toMatchObject({ status: "rate-limited", coverage: { retryInMs: 900_000 } });
    expect(h.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(900_000);
    const resumed = h.tick(); await h.settle();
    if (outcome === "success") {
      await h.success();
      expect(await resumed).toMatchObject({ status: "catalog-requested", coverage: { failureCount: 0 } });
    } else {
      for (const request of h.requests) request.fail();
      expect(await resumed).toMatchObject({ status: "rate-limited", coverage: { failureCount: 5, retryInMs: 30_000 } });
    }
  });

  it("retains provider Retry-After when the paired sibling later fails locally", async () => {
    const h = harness(); await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    h.requests[0]!.respond({ StatusCode: 500 }, 429, "120"); await h.settle();
    await vi.advanceTimersByTimeAsync(15_000);
    h.requests[1]!.fail();
    expect(await running).toMatchObject({ responses: [], coverage: { failureCount: 1, retryInMs: 105_000 } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await h.tick()).toMatchObject({ status: "rate-limited", coverage: { retryInMs: 75_000 } });
    expect(h.requests).toHaveLength(2);
  });

  it("retains the provider breaker when refusal bodies cannot be read", async () => {
    const h = harness(); await h.tick(); vi.setSystemTime(START + 30_000);
    h.globals.fetch = async () => ({ status: 429, ok: false, headers: { get: () => null },
      text: async () => { throw new Error("body-read"); } });
    for (let round = 0; round < 3; round++) {
      const running = h.tick(); await h.settle();
      expect(await running).toMatchObject({ coverage: {
        failureCount: round + 1, failureStage: "BODY_READ", retryInMs: round === 2 ? 900_000 : 30_000 } });
      await vi.advanceTimersByTimeAsync(30_000);
    }
  });

  it.each(["120", new Date(START + 150_000).toUTCString()])("honors Retry-After %s", async retryAfter => {
    const h = harness(); await h.tick(); vi.setSystemTime(START + 30_000);
    const running = h.tick(); await h.settle();
    h.requests[0]!.respond({ StatusCode: 100, sel: [] });
    h.requests[1]!.respond({ StatusCode: 500 }, 429, retryAfter);
    await running;
    vi.setSystemTime(START + 149_999);
    expect((await h.tick("next-document")).responses).toEqual([]);
    expect(h.requests).toHaveLength(2);
  });

  it("fails closed when locks or writable persistent storage are unavailable", async () => {
    const noLocks = harness(); noLocks.globals.navigator = {};
    expect((await noLocks.tick()).status).toBe("collector-paused");
    expect(noLocks.requests).toHaveLength(0);
    const noStorage = harness(); noStorage.globals.localStorage.setItem = () => { throw new Error("blocked"); };
    expect((await noStorage.tick()).status).toBe("collector-paused");
    expect(noStorage.requests).toHaveLength(0);
  });

  it("publishes new receipt clocks for unchanged successful pairs and never replays during a gate", async () => {
    const h = harness(); await h.tick(); vi.setSystemTime(START + 30_000);
    const first = h.tick(); await h.success();
    expect((await first).coverage.rosterAtMs).toBe(START + 30_000);
    expect((await h.tick()).responses).toEqual([]);
    vi.setSystemTime(START + 50_000);
    const second = h.tick(); await h.success();
    expect((await second).coverage.rosterAtMs).toBe(START + 50_000);
  });
});
