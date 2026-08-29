import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createChildSupervisor } from "./child-respawn.mjs";

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  crash(code = 1) { this.exitCode = code; this.emit("exit", code, null); }
}

function harness(overrides = {}) {
  const timers = [];
  const written = [];
  let nowMs = 0;
  const spawned = [];
  const permanent = [];
  const respawned = [];
  const supervisor = createChildSupervisor({
    name: "api",
    respawn: () => { const child = new FakeChild(); spawned.push(child); return child; },
    onRespawned: (entry) => { respawned.push(entry.child); },
    onPermanentFailure: (code) => { permanent.push(code); },
    output: { write: (line) => written.push(line) },
    shouldIgnore: () => false,
    maxRestarts: 3,
    windowMs: 60_000,
    backoffBaseMs: 1_000,
    backoffCapMs: 8_000,
    now: () => nowMs,
    schedule: (callback, delayMs) => { const timer = { callback, delayMs, cancelled: false }; timers.push(timer); return timer; },
    cancel: (timer) => { timer.cancelled = true; },
    ...overrides
  });
  return { supervisor, timers, written, permanent, respawned, spawned,
    advance: () => { const timer = timers.shift(); if (!timer.cancelled) timer.callback(); return timer; },
    setNow: (value) => { nowMs = value; } };
}

test("fails fast instead of respawning while the stack is not yet armed", () => {
  let armed = false;
  const h = harness({ isArmed: () => armed });
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);
  entry.child.crash(9);
  assert.deepEqual(h.permanent, [9]);
  assert.equal(h.timers.length, 0);
  assert.ok(h.written.at(-1).includes("before the stack was ready"));
});

test("respawns an unexpectedly exited child with exponential backoff", () => {
  const h = harness();
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);

  entry.child.crash(7);
  assert.equal(h.timers[0].delayMs, 1_000);
  const first = entry.child;
  h.advance();
  assert.notEqual(entry.child, first);
  assert.deepEqual(h.respawned, [entry.child]);

  h.setNow(5_000);
  entry.child.crash(7);
  assert.equal(h.timers[0].delayMs, 2_000);
  h.advance();
  assert.equal(h.permanent.length, 0);
  assert.ok(h.written.some((line) => line.includes("restarting in 1s")));
  assert.ok(h.written.some((line) => line.includes("restarting in 2s")));
});

test("escalates to permanent failure when restarts exceed the window budget", () => {
  const h = harness();
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);
  for (const at of [0, 1_000, 2_000]) {
    h.setNow(at);
    entry.child.crash(3);
    h.advance();
  }
  h.setNow(3_000);
  entry.child.crash(3);
  assert.deepEqual(h.permanent, [3]);
  assert.equal(h.timers.length, 0);
  assert.ok(h.written.at(-1).includes("did not hold"));
});

test("forgets failures that fall outside the rolling window", () => {
  const h = harness();
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);
  for (const at of [0, 1_000, 2_000]) {
    h.setNow(at);
    entry.child.crash(1);
    h.advance();
  }
  // Fourth failure, but the first three have aged out of the 60s window.
  h.setNow(120_000);
  entry.child.crash(1);
  assert.equal(h.permanent.length, 0);
  assert.equal(h.timers[0].delayMs, 1_000);
});

test("a spawn error also counts as a failure and retries", () => {
  let attempts = 0;
  const h = harness({ respawn: () => {
    attempts += 1;
    if (attempts === 1) throw new Error("spawn EBUSY");
    return new FakeChild();
  } });
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);
  entry.child.crash(1);
  h.advance();
  assert.ok(h.written.some((line) => line.includes("respawn failed: spawn EBUSY")));
  assert.equal(h.timers[0].delayMs, 2_000);
  h.advance();
  assert.equal(attempts, 2);
  assert.equal(h.permanent.length, 0);
});

test("ignores exits during deliberate shutdown and cancels a pending respawn on stop", () => {
  let ignore = false;
  const h = harness({ shouldIgnore: () => ignore });
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);

  entry.child.crash(1);
  assert.equal(h.timers.length, 1);
  h.supervisor.stop();
  assert.equal(h.timers[0].cancelled, true);

  ignore = true;
  const h2 = harness({ shouldIgnore: () => true });
  const entry2 = { name: "api", child: new FakeChild() };
  h2.supervisor.attach(entry2);
  entry2.child.crash(1);
  assert.equal(h2.timers.length, 0);
  assert.equal(h2.permanent.length, 0);
});

test("escalates when the respawned child's state cannot be republished", async () => {
  const h = harness({ onRespawned: () => Promise.reject(new Error("LIVE_STACK_STATE_CHANGED")) });
  const entry = { name: "api", child: new FakeChild() };
  h.supervisor.attach(entry);
  entry.child.crash(1);
  h.advance();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.permanent, [1]);
  assert.ok(h.written.some((line) => line.includes("state could not be republished")));
});
