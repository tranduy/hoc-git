import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import * as managedStack from "./managed-stack.mjs";

const { stopManagedChildren } = managedStack;

class FakeChild extends EventEmitter {
  constructor(pid, connected = true) {
    super();
    this.pid = pid;
    this.connected = connected;
    this.exitCode = null;
    this.signalCode = null;
    this.messages = [];
    this.signals = [];
  }
  send(message) { this.messages.push(message); }
  kill(signal) { this.signals.push(signal); }
  finish() { this.exitCode = 0; this.emit("exit", 0, null); }
}

test("asks the API to close Playwright through IPC before terminating any process", async () => {
  const api = new FakeChild(101);
  const web = new FakeChild(102, false);
  const stopping = stopManagedChildren([
    { name: "api", child: api, gracefulIpc: true },
    { name: "web", child: web, gracefulIpc: false }
  ], { graceMs: 100 });

  assert.deepEqual(api.messages, [{ type: "tool-chenh:shutdown" }]);
  assert.deepEqual(api.signals, []);
  assert.deepEqual(web.signals, ["SIGTERM"]);
  web.finish();
  api.finish();
  await stopping;
});

test("fails closed without a PID-only force kill when graceful shutdown times out", async () => {
  const api = new FakeChild(201);
  const forced = [];

  await assert.rejects(stopManagedChildren([{ name: "api", child: api, gracefulIpc: true }], {
    graceMs: 1,
    forceKillTree: async (pid) => { forced.push(pid); }
  }), /MANAGED_CHILD_SHUTDOWN_TIMEOUT/u);

  assert.deepEqual(forced, []);
});

test("attaches fast child failure handling synchronously so the sibling is stopped", async () => {
  assert.equal(typeof managedStack.attachManagedChildFailureHandlers, "function");
  const api = new FakeChild(301);
  const web = new FakeChild(302, false);
  const entries = [{ name: "api", child: api, gracefulIpc: true },
    { name: "web", child: web, gracefulIpc: false }];
  let stopping;
  managedStack.attachManagedChildFailureHandlers(entries, () => {
    stopping = stopManagedChildren(entries, { graceMs: 100 });
  }, { write: () => undefined });

  assert.doesNotThrow(() => api.emit("error", new Error("fast spawn failure")));
  assert.deepEqual(api.messages, [{ type: "tool-chenh:shutdown" }]);
  assert.deepEqual(web.signals, ["SIGTERM"]);
  api.finish();
  web.finish();
  await stopping;
});
