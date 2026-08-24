import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as stackState from "./stack-state.mjs";

const { cleanupStaleStack, writeStackState } = stackState;

function managedState(basePid = 10, instanceId = `instance-${basePid}`) {
  const identity = (pid, parentPid) => ({ pid, parentPid, executablePath: "C:\\node.exe",
    commandLine: `node-${pid}`, birthMarker: `birth-${pid}` });
  return stackState.createManagedStackState({ instanceId,
    shutdownToken: `${instanceId}-shutdown-token`, worktreeRoot: "C:\\exact-worktree",
    buildIdentity: `sha256:${"a".repeat(64)}`, launcher: identity(basePid, 1),
    api: identity(basePid + 1, basePid), web: identity(basePid + 2, basePid) });
}

test("refuses a legacy stale state with live children without killing or deleting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const killed = [];
  try {
    const raw = JSON.stringify({ launcherPid: 10, apiPid: 11, webPid: 12 });
    await writeFile(statePath, raw);
    await assert.rejects(cleanupStaleStack(statePath, {
      isAlive: (pid) => pid !== 10,
      forceKillTree: async (pid) => { killed.push(pid); }
    }), /LEGACY_STACK_REQUIRES_ROOT_HANDOFF/u);
    assert.deepEqual(killed, []);
    assert.equal(await readFile(statePath, "utf8"), raw);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("refuses a duplicate stack while its recorded launcher is alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  try {
    await writeFile(statePath, JSON.stringify(managedState(20)));
    await assert.rejects(cleanupStaleStack(statePath, {
      isAlive: (pid) => pid === 20,
      forceKillTree: async () => undefined
    }), /LIVE_STACK_ALREADY_RUNNING/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("generic state publication rejects legacy state before filesystem mutation", async () => {
  const mutations = [];
  await assert.rejects(writeStackState("C:\\exact-worktree\\live.json",
    { launcherPid: 10, apiPid: 11, webPid: 12 }, {
      mkdir: async () => { mutations.push("mkdir"); },
      writeFile: async () => { mutations.push("write"); },
      link: async () => { mutations.push("link"); },
      rm: async () => { mutations.push("remove"); }
    }), /INVALID_MANAGED_STACK_STATE/u);
  assert.deepEqual(mutations, []);
});

test("generic state removal rejects legacy state before filesystem mutation", async () => {
  const mutations = [];
  await assert.rejects(stackState.removeStackState("C:\\exact-worktree\\live.json",
    { launcherPid: 10, apiPid: 11, webPid: 12 }, {
      readFile: async () => { mutations.push("read"); },
      rename: async () => { mutations.push("rename"); },
      rm: async () => { mutations.push("remove"); }
    }), /INVALID_MANAGED_STACK_STATE/u);
  assert.deepEqual(mutations, []);
});

test("legacy all-dead state requires ROOT handoff and remains untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const raw = JSON.stringify({ launcherPid: 10, apiPid: 11, webPid: 12 });
  try {
    await writeFile(statePath, raw);
    await assert.rejects(cleanupStaleStack(statePath, { isAlive: () => false }),
      /LEGACY_STACK_REQUIRES_ROOT_HANDOFF/u);
    assert.equal(await readFile(statePath, "utf8"), raw);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("creates versioned state with exact worktree, build, instance, and process identities", () => {
  assert.equal(typeof stackState.createManagedStackState, "function",
    "createManagedStackState must be implemented");
  const identity = (pid, parentPid) => ({ pid, parentPid, executablePath: "C:\\node.exe",
    commandLine: `node-${pid}`, birthMarker: `birth-${pid}` });
  const input = {
    instanceId: "instance-123",
    shutdownToken: "shutdown-token-123",
    worktreeRoot: "C:\\exact-worktree",
    buildIdentity: `sha256:${"a".repeat(64)}`,
    launcher: identity(10, 1),
    api: identity(11, 10),
    web: identity(12, 10)
  };

  assert.deepEqual(stackState.createManagedStackState(input), { version: 2, ...input });
});

test("accepts a shutdown request only for the exact versioned instance and token", () => {
  assert.equal(typeof stackState.matchesStackShutdownRequest, "function",
    "matchesStackShutdownRequest must be implemented");
  const identity = (pid, parentPid) => ({ pid, parentPid, executablePath: "C:\\node.exe",
    commandLine: `node-${pid}`, birthMarker: `birth-${pid}` });
  const state = stackState.createManagedStackState({ instanceId: "instance-123",
    shutdownToken: "shutdown-token-123", worktreeRoot: "C:\\exact-worktree",
    buildIdentity: `sha256:${"a".repeat(64)}`, launcher: identity(10, 1),
    api: identity(11, 10), web: identity(12, 10) });
  assert.equal(stackState.matchesStackShutdownRequest(state, {
    version: 1, instanceId: "instance-123", shutdownToken: "shutdown-token-123"
  }), true);
  assert.equal(stackState.matchesStackShutdownRequest(state, {
    version: 1, instanceId: "instance-123", shutdownToken: "wrong-token"
  }), false);
  assert.equal(stackState.matchesStackShutdownRequest(state, {
    version: 1, instanceId: "wrong-instance", shutdownToken: "shutdown-token-123"
  }), false);
});

test("leaves malformed and partial state untouched and fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  try {
    for (const [name, raw] of [["malformed", "{not-json"], ["partial", JSON.stringify({ launcherPid: 10 })]]) {
      const statePath = join(directory, `${name}.json`);
      await writeFile(statePath, raw);
      await assert.rejects(cleanupStaleStack(statePath, { isAlive: () => false }), /LIVE_STACK_STATE_INVALID/u);
      assert.equal(await readFile(statePath, "utf8"), raw);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("fails closed on a state read error without attempting removal", async () => {
  let removals = 0;
  const unavailable = Object.assign(new Error("denied"), { code: "EACCES" });
  await assert.rejects(cleanupStaleStack("C:\\exact-worktree\\live.json", { io: {
    readFile: async () => { throw unavailable; },
    rm: async () => { removals += 1; }
  } }), /LIVE_STACK_STATE_UNAVAILABLE/u);
  assert.equal(removals, 0);
});

test("refuses versioned stale children when the recorded launcher is dead", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const identity = (pid, parentPid) => ({ pid, parentPid, executablePath: "C:\\node.exe",
    commandLine: `node-${pid}`, birthMarker: `birth-${pid}` });
  const state = stackState.createManagedStackState({
    instanceId: "instance-123",
    shutdownToken: "shutdown-token-123",
    worktreeRoot: "C:\\exact-worktree",
    buildIdentity: `sha256:${"a".repeat(64)}`,
    launcher: identity(10, 1), api: identity(11, 10), web: identity(12, 10)
  });
  try {
    await writeFile(statePath, JSON.stringify(state));
    await assert.rejects(cleanupStaleStack(statePath, {
      isAlive: (pid) => pid === 11,
      forceKillTree: async () => { throw new Error("must not kill"); }
    }), /STALE_STACK_REQUIRES_MANAGED_HANDOFF/u);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), state);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("keeps a dead versioned record when descendant cleanup cannot be proven", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const identity = (pid, parentPid) => ({ pid, parentPid, executablePath: "C:\\node.exe",
    commandLine: `node-${pid}`, birthMarker: `birth-${pid}` });
  const state = stackState.createManagedStackState({ instanceId: "instance-123",
    shutdownToken: "shutdown-token-123", worktreeRoot: "C:\\exact-worktree",
    buildIdentity: `sha256:${"a".repeat(64)}`, launcher: identity(10, 1),
    api: identity(11, 10), web: identity(12, 10) });
  try {
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
    await assert.rejects(cleanupStaleStack(statePath, { isAlive: () => false }),
      /STALE_STACK_REQUIRES_MANAGED_HANDOFF/u);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), state);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("publishes state atomically without overwriting an existing record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const oldState = managedState(10);
  const nextState = managedState(20);
  try {
    await writeFile(statePath, `${JSON.stringify(oldState)}\n`);
    await assert.rejects(writeStackState(statePath, nextState), /EEXIST/u);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), oldState);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("does not remove state unless the quarantined record matches the exact expected instance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const current = managedState(20);
  try {
    await writeFile(statePath, `${JSON.stringify(current)}\n`);
    await assert.rejects(stackState.removeStackState(statePath, managedState(10)),
      /LIVE_STACK_STATE_CHANGED/u);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), current);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("quarantines and removes only the exact expected state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const expected = managedState(10);
  try {
    await writeFile(statePath, `${JSON.stringify(expected)}\n`);
    await stackState.removeStackState(statePath, expected);
    await assert.rejects(readFile(statePath), /ENOENT/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
