import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { stopManagedChildren } from "./managed-stack.mjs";

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
  const forced = [];
  const stopping = stopManagedChildren([
    { name: "api", child: api, gracefulIpc: true },
    { name: "web", child: web, gracefulIpc: false }
  ], { graceMs: 100, forceKillTree: async (pid) => { forced.push(pid); if (pid === 102) web.finish(); } });

  assert.deepEqual(api.messages, [{ type: "tool-chenh:shutdown" }]);
  assert.deepEqual(api.signals, []);
  assert.deepEqual(web.signals, []);
  assert.deepEqual(forced, [102]);
  api.finish();
  await stopping;
});

test("force-kills only the exact child tree when graceful shutdown times out", async () => {
  const api = new FakeChild(201);
  const forced = [];

  await stopManagedChildren([{ name: "api", child: api, gracefulIpc: true }], {
    graceMs: 1,
    forceKillTree: async (pid) => { forced.push(pid); api.finish(); }
  });

  assert.deepEqual(forced, [201]);
});
