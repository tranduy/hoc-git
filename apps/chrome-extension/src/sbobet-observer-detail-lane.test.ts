import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sbobetDetailTemplateFromObserved, type SbobetDetailBinding } from "./sbobet-detail-protocol.js";
import type { SbobetDetailBatch } from "./sbobet-catalog-refresh.js";
import { SbobetObserverDetailLane, type SbobetObserverDetailLaneOptions } from "./sbobet-observer-detail-lane.js";

const binding: SbobetDetailBinding = { sourceGeneration: 4, tabGeneration: 8,
  executionOrigin: "https://be.sb21.net", frameId: "frame-1", loaderId: "loader-1", sessionId: "session-1" };
const template = () => sbobetDetailTemplateFromObserved({ method: "GET", binding,
  url: "https://api.sb21.net/api/v2/getEvent?timeRange=Today&eventId=101&flag=a%20b",
  headers: { "X-Context": "SECRET_SENTINEL" } })!;
const native = (id = "202") => ({ "8": id, "7": { "31": ["4.5 0.9*x -0.9*y 123"],
  "777": [{ unknown: "retained" }], "500": [] } });
const roster = (id = "202") => [{ eventId: id, startAtUtcMs: 50_000, phase: "PREMATCH" as const }];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const lanes: SbobetObserverDetailLane[] = [];
afterEach(() => { for (const lane of lanes.splice(0)) lane.dispose(); vi.useRealTimers(); });

function setup(overrides: Partial<SbobetObserverDetailLaneOptions> = {}) {
  let generation = "epoch-4";
  let clock = 1_000;
  let status = 200;
  let body: unknown = native();
  let origin = binding.executionOrigin;
  let retryAfter: string | null = null;
  const fetch = vi.fn(async () => ({ status, text: async () => JSON.stringify(body),
    headers: { get: () => retryAfter } }));
  const emit = vi.fn(async (_batch: SbobetDetailBatch, _signal: AbortSignal) => {});
  const sendCommand = vi.fn(async (_tabId: number, _method: string, params: Record<string, unknown>, _sessionId?: string) => {
    const value = await runInNewContext(params.expression as string, {
      location: { origin }, AbortController, setTimeout, clearTimeout, fetch
    });
    // CDP returnByValue crosses a JSON transport boundary; do not leak VM-realm prototypes.
    return { result: { type: "object", value: JSON.parse(JSON.stringify(value)) as unknown } };
  });
  const lane = new SbobetObserverDetailLane({ tabId: 7, currentGeneration: () => generation,
    allocateRequestStartSequence: () => 12, now: () => clock, monotonicNow: () => clock / 2, resolveContext: () => 91,
    isBindingCurrent: () => true, sendCommand, emit,
    refresh: { minimumDelayMs: 0, maxConcurrent: 1, maxRequestsPerTick: 1, backoffMs: 100,
      nearTtlMs: 500, farTtlMs: 1_000, timeoutMs: 200 }, ...overrides });
  lanes.push(lane);
  const observed = template();
  const arm = () => {
    expect(lane.rememberTemplate(observed, generation)).toBe(true);
    expect(lane.setCompletenessVerified(observed, generation)).toBe(true);
    expect(lane.setRoster({ generation, events: roster() })).toBe(true);
  };
  return { lane, observed, arm, fetch, emit, sendCommand,
    setClock: (value: number) => { clock = value; },
    setGeneration: (value: string) => { generation = value; },
    setBody: (value: unknown) => { body = value; },
    setStatus: (value: number) => { status = value; },
    setOrigin: (value: string) => { origin = value; },
    setRetryAfter: (value: string) => { retryAfter = value; } };
}

describe("SBOBET observer detail lane", () => {
  it("performs zero CDP calls without both an observed template and its explicit completeness proof", async () => {
    const h = setup();
    h.lane.setRoster({ generation: "epoch-4", events: roster() });
    await h.lane.tick();
    expect(h.lane.setCompletenessVerified(h.observed, "epoch-4")).toBe(false);
    h.lane.rememberTemplate(h.observed, "epoch-4");
    await h.lane.tick();
    expect(h.sendCommand).not.toHaveBeenCalled();
    expect(h.lane.diagnostics()).toMatchObject({ state: "UNPROVEN", requestsStarted: 0 });
  });

  it("runs the exact protocol expression in the existing document context and emits all native groups", async () => {
    const h = setup(); h.arm();
    await h.lane.tick();
    expect(h.sendCommand).toHaveBeenCalledWith(7, "Runtime.evaluate", expect.objectContaining({
      contextId: 91, awaitPromise: true, returnByValue: true }), "session-1");
    expect(h.fetch).toHaveBeenCalledWith(
      "https://api.sb21.net/api/v2/getEvent?timeRange=Today&eventId=202&flag=a%20b",
      expect.objectContaining({ method: "GET", credentials: "include", cache: "no-store" }));
    expect(h.emit).toHaveBeenCalledWith({ kind: "SBOBET_EVENT_DETAIL", generation: "epoch-4", eventId: "202",
      requestStartSequence: 12, observedAtMs: 1_000, marketContainerComplete: true, event: native() },
    expect.any(AbortSignal), expect.objectContaining({ url: h.observed.url, binding }), { receivedMonotonicMs: 500 });
    await h.lane.tick();
    expect(h.sendCommand).toHaveBeenCalledTimes(1);
  });

  it("preserves CDP receipt time across asynchronous postflight and emit binding checks", async () => {
    let checks = 0;
    const h = setup({ isBindingCurrent: async () => { checks += 1; if (checks > 1) h.setClock(9_000); return true; } });
    h.arm(); await h.lane.tick();
    expect(h.emit.mock.calls[0]?.[0].observedAtMs).toBe(1_000);
    expect(h.emit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { receivedMonotonicMs: 500 });
  });

  it("requires proof for the exact remembered template object and generation", async () => {
    const h = setup(); h.arm();
    expect(h.lane.setCompletenessVerified(template(), "epoch-4")).toBe(false);
    expect(h.lane.setCompletenessVerified(h.observed, "epoch-wrong")).toBe(false);
    h.lane.rememberTemplate(template(), "epoch-4");
    await h.lane.tick();
    expect(h.sendCommand).not.toHaveBeenCalled();
  });

  it("clears proof and roster authority on lifecycle rotation", async () => {
    const h = setup(); h.arm(); h.setGeneration("epoch-5");
    await h.lane.tick();
    expect(h.lane.setRoster({ generation: "epoch-4", events: roster() })).toBe(false);
    expect(h.lane.setCompletenessVerified(h.observed, "epoch-4")).toBe(false);
    expect(h.sendCommand).not.toHaveBeenCalled();
  });

  it.each(["binding", "context", "origin"])("rejects stale preflight %s without a network fetch", async (kind) => {
    const h = setup(kind === "binding" ? { isBindingCurrent: () => false } :
      kind === "context" ? { resolveContext: () => null } : {});
    h.arm(); if (kind === "origin") h.setOrigin("https://other.sb21.net");
    await h.lane.tick();
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled();
  });

  it("rejects document changes after the actual response", async () => {
    let checks = 0;
    const h = setup({ isBindingCurrent: () => ++checks === 1 }); h.arm();
    await h.lane.tick();
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.emit).not.toHaveBeenCalled();
  });

  it("rechecks the source after the final asynchronous binding check resolves", async () => {
    let checks = 0;
    const h = setup({ isBindingCurrent: () => {
      if (++checks === 3) queueMicrotask(() => queueMicrotask(() => h.setGeneration("epoch-5")));
      return true;
    } });
    h.arm(); await h.lane.tick();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it.each([{}, { result: { value: { status: 200, marketContainerComplete: true, event: native("999") } } },
    { exceptionDetails: { text: "SECRET_SENTINEL" }, result: { value: { status: 200, marketContainerComplete: true, event: native() } } }
  ])("fails closed on malformed CDP results without emitting diagnostics secrets", async (result) => {
    const h = setup({ sendCommand: async () => result }); h.arm(); await h.lane.tick();
    expect(h.emit).not.toHaveBeenCalled();
    expect(JSON.stringify(h.lane.diagnostics())).not.toContain("SECRET_SENTINEL");
  });

  it("distinguishes authoritative empty native groups from failed or malformed responses", async () => {
    const h = setup(); h.arm(); h.setBody({ "8": "202", "7": {} });
    await h.lane.tick(); expect(h.emit).toHaveBeenCalledTimes(1);
    h.setClock(2_000); h.setBody({ "8": "202", "7": { "31": null } });
    await h.lane.tick(); expect(h.emit).toHaveBeenCalledTimes(1);
    h.setClock(2_100); h.setStatus(500);
    await h.lane.tick(); expect(h.emit).toHaveBeenCalledTimes(1);
  });

  it("backs off on 429 using the actual response Retry-After", async () => {
    const h = setup(); h.arm(); h.setStatus(429); h.setRetryAfter("2");
    await h.lane.tick(); h.setClock(2_999); await h.lane.tick();
    expect(h.sendCommand).toHaveBeenCalledTimes(1);
    h.setStatus(200); h.setClock(3_000); await h.lane.tick();
    expect(h.sendCommand).toHaveBeenCalledTimes(2); expect(h.emit).toHaveBeenCalledTimes(1);
  });

  it("retains capacity for an uncooperative CDP call after timeout and rejects its late response", async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    const sendCommand = vi.fn(() => pending.promise);
    const h = setup({ sendCommand }); h.arm();
    const tick = h.lane.tick(); await vi.advanceTimersByTimeAsync(201); await tick;
    h.setClock(2_000); await h.lane.tick(); expect(sendCommand).toHaveBeenCalledTimes(1);
    pending.resolve({ result: { value: { status: 200, marketContainerComplete: true, event: native() } } });
    await vi.advanceTimersByTimeAsync(0); expect(h.emit).not.toHaveBeenCalled();
    await h.lane.tick(); expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it.each(["rotate", "revoke", "dispose"])("prevents late emission after %s while CDP is in flight", async (action) => {
    const pending = deferred<unknown>();
    const h = setup({ sendCommand: () => pending.promise }); h.arm();
    const tick = h.lane.tick(); await vi.waitFor(() => expect(h.lane.diagnostics().requestsStarted).toBe(1));
    if (action === "rotate") { h.setGeneration("epoch-5"); await h.lane.tick(); }
    if (action === "revoke") h.lane.setCompletenessVerified(h.observed, "epoch-4", false);
    if (action === "dispose") h.lane.dispose();
    pending.resolve({ result: { value: { status: 200, marketContainerComplete: true, event: native() } } });
    await tick; expect(h.emit).not.toHaveBeenCalled();
    expect(JSON.stringify(h.lane.diagnostics())).not.toMatch(/SECRET_SENTINEL|sb21|frame-1|epoch-4/);
  });
});
