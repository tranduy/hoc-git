import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { startLiveStack } from "./start-live-stack.mjs";

function moduleSource(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

test("validates stack state before dotenv, key creation, or filesystem mutation", async () => {
  const events = [];
  globalThis.__toolChenhStartTestEvents = events;
  const stackStateMock = moduleSource(`
    export async function cleanupStaleStack() {
      globalThis.__toolChenhStartTestEvents.push("cleanup");
      throw new Error(globalThis.__toolChenhStartTestFailure);
    }
    export function createManagedStackState() { throw new Error("unreachable"); }
    export function matchesStackShutdownRequest() { return false; }
    export async function removeStackState() { globalThis.__toolChenhStartTestEvents.push("remove-state"); }
    export async function writeStackState() { globalThis.__toolChenhStartTestEvents.push("write-state"); }
  `);
  const keyMock = moduleSource(`
    export async function ensureChromeBridgeKey() {
      globalThis.__toolChenhStartTestEvents.push("key");
      return "test-key";
    }
  `);
  const fsMock = moduleSource("export function existsSync() { return true; }");
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes("/start-live-stack.mjs")) {
        if (specifier === "./stack-state.mjs") return { url: stackStateMock, shortCircuit: true };
        if (specifier === "./chrome-bridge-key.mjs") return { url: keyMock, shortCircuit: true };
        if (specifier === "node:fs") return { url: fsMock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const originalLoadEnvFile = process.loadEnvFile;
  const originalBridgeKey = process.env.CHROME_BRIDGE_KEY;
  process.loadEnvFile = () => { events.push("dotenv"); };
  delete process.env.CHROME_BRIDGE_KEY;
  try {
    for (const errorCode of ["LEGACY_STACK_REQUIRES_ROOT_HANDOFF", "LIVE_STACK_STATE_INVALID"]) {
      events.length = 0;
      globalThis.__toolChenhStartTestFailure = errorCode;
      let failure;
      try {
        const launcher = await import(`./start-live-stack.mjs?preflight=${errorCode}-${Date.now()}`);
        assert.equal(typeof launcher.startLiveStack, "function");
        await launcher.startLiveStack();
      } catch (error) { failure = error; }
      assert.equal(failure?.message, errorCode);
      assert.deepEqual(events, ["cleanup"]);
    }
  } finally {
    hooks.deregister();
    process.loadEnvFile = originalLoadEnvFile;
    if (originalBridgeKey === undefined) delete process.env.CHROME_BRIDGE_KEY;
    else process.env.CHROME_BRIDGE_KEY = originalBridgeKey;
    delete globalThis.__toolChenhStartTestEvents;
    delete globalThis.__toolChenhStartTestFailure;
  }
});

class FastChild extends EventEmitter {
  constructor(pid, connected) {
    super();
    this.pid = pid;
    this.connected = connected;
    this.exitCode = null;
    this.signalCode = null;
    this.messages = [];
    this.signals = [];
  }
  finish() {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
  send(message) { this.messages.push(message); this.finish(); }
  kill(signal) { this.signals.push(signal); this.finish(); }
}

test("handles a child error during identity acquisition and stops its sibling without publishing state", async () => {
  const api = new FastChild(601, true);
  const web = new FastChild(602, false);
  const spawned = [api, web];
  const writes = [];
  const exitCodes = [];
  let identityCalls = 0;
  const timer = { unref: () => undefined };
  const result = await startLiveStack({
    repositoryRoot: "C:\\exact-worktree",
    environment: {
      CHROME_BRIDGE_KEY: "bridge-key",
      TOOL_CHENH_STACK_INSTANCE_ID: "instance-fast-failure",
      TOOL_CHENH_STACK_SHUTDOWN_TOKEN: "shutdown-token-fast-failure"
    },
    dependencies: {
      cleanupStaleStack: async () => undefined,
      existsSync: (path) => !path.endsWith(".env"),
      readFile: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); },
      cleanupOrphanedAutomationBrowsers: async () => undefined,
      resolveLocalAppData: () => "C:\\local-app-data",
      enforceToolResourceRetention: async () => ({ removedFiles: 0, reclaimedBytes: 0 }),
      computeBuildIdentity: async () => `sha256:${"a".repeat(64)}`,
      spawn: () => spawned.shift(),
      inspectProcessIdentity: async () => {
        identityCalls += 1;
        if (identityCalls === 1) api.emit("error", new Error("fast child failure"));
        return null;
      },
      writeStackState: async (...args) => { writes.push(args); },
      waitForFixtureStack: async () => { throw new Error("readiness must not run"); },
      setInterval: () => timer,
      clearInterval: () => undefined,
      registerSignal: () => undefined,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      setExitCode: (code) => { exitCodes.push(code); }
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(api.messages, [{ type: "tool-chenh:shutdown" }]);
  assert.deepEqual(web.signals, ["SIGTERM"]);
  assert.deepEqual(writes, []);
  assert.deepEqual(exitCodes, [1]);
});

test("waits for an in-flight state publication before removing failed-instance state", async () => {
  const api = new FastChild(701, true);
  const web = new FastChild(702, false);
  const spawned = [api, web];
  const exitCodes = [];
  const removalObservations = [];
  const timer = { unref: () => undefined };
  let statePresent = false;
  let readinessCalls = 0;
  const observedIdentity = (pid, parentPid) => ({ pid, parentPid, executablePath: process.execPath,
    commandLine: `"${process.execPath}" "entry-${pid}.mjs"`, birthMarker: `birth-${pid}` });
  const identities = new Map([
    [process.pid, observedIdentity(process.pid, 1)],
    [api.pid, observedIdentity(api.pid, process.pid)],
    [web.pid, observedIdentity(web.pid, process.pid)]
  ]);

  const result = await startLiveStack({
    repositoryRoot: "C:\\exact-worktree",
    environment: {
      CHROME_BRIDGE_KEY: "bridge-key",
      TOOL_CHENH_STACK_INSTANCE_ID: "instance-write-race",
      TOOL_CHENH_STACK_SHUTDOWN_TOKEN: "shutdown-token-write-race"
    },
    dependencies: {
      cleanupStaleStack: async () => undefined,
      existsSync: (path) => !path.endsWith(".env"),
      readFile: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); },
      cleanupOrphanedAutomationBrowsers: async () => undefined,
      resolveLocalAppData: () => "C:\\local-app-data",
      enforceToolResourceRetention: async () => ({ removedFiles: 0, reclaimedBytes: 0 }),
      computeBuildIdentity: async () => `sha256:${"a".repeat(64)}`,
      spawn: () => spawned.shift(),
      inspectProcessIdentity: async (pid) => identities.get(pid),
      writeStackState: async () => {
        api.emit("error", new Error("failure during state publication"));
        await new Promise((resolve) => setImmediate(resolve));
        statePresent = true;
      },
      removeStackState: async () => {
        removalObservations.push(statePresent);
        statePresent = false;
      },
      waitForFixtureStack: async () => { readinessCalls += 1; },
      setInterval: () => timer,
      clearInterval: () => undefined,
      registerSignal: () => undefined,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      setExitCode: (code) => { exitCodes.push(code); }
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(removalObservations, [true]);
  assert.equal(statePresent, false);
  assert.equal(readinessCalls, 0);
  assert.deepEqual(exitCodes, [1]);
});

test("honors an exact seeded shutdown request before key creation or child spawn", async () => {
  const mutations = [];
  const exitCodes = [];
  const timer = { unref: () => undefined };
  const identity = { instanceId: "instance-prepublish-stop",
    shutdownToken: "shutdown-token-prepublish-stop" };
  const result = await startLiveStack({
    repositoryRoot: "C:\\exact-worktree",
    environment: {
      TOOL_CHENH_STACK_INSTANCE_ID: identity.instanceId,
      TOOL_CHENH_STACK_SHUTDOWN_TOKEN: identity.shutdownToken
    },
    dependencies: {
      cleanupStaleStack: async () => undefined,
      existsSync: () => false,
      readFile: async () => JSON.stringify({ version: 1, ...identity }),
      ensureChromeBridgeKey: async () => { mutations.push("key"); },
      cleanupOrphanedAutomationBrowsers: async () => { mutations.push("browser-cleanup"); },
      spawn: () => { mutations.push("spawn"); },
      writeStackState: async () => { mutations.push("state-write"); },
      stopManagedChildren: async (children) => { mutations.push(`stop:${children.length}`); },
      setInterval: () => timer,
      clearInterval: () => undefined,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      setExitCode: (code) => { exitCodes.push(code); }
    }
  });

  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(mutations, ["stop:0"]);
  assert.deepEqual(exitCodes, [0]);
});

function observedIdentity(pid, parentPid) {
  return { pid, parentPid, executablePath: process.execPath,
    commandLine: `"${process.execPath}" "entry-${pid}.mjs"`, birthMarker: `birth-${pid}` };
}

test("managed start leaves another checkout-profile browser untouched", async () => {
  const api = new FastChild(751, true);
  const web = new FastChild(752, false);
  const spawned = [api, web];
  const timer = { unref: () => undefined };
  const buildIdentity = `sha256:${"b".repeat(64)}`;
  const instanceId = "instance-no-browser-cleanup";
  const identities = new Map([
    [process.pid, observedIdentity(process.pid, 1)],
    [api.pid, observedIdentity(api.pid, process.pid)],
    [web.pid, observedIdentity(web.pid, process.pid)]
  ]);

  const result = await startLiveStack({
    repositoryRoot: "C:\\exact-worktree",
    environment: {
      CHROME_BRIDGE_KEY: "bridge-key",
      TOOL_CHENH_STACK_INSTANCE_ID: instanceId,
      TOOL_CHENH_STACK_SHUTDOWN_TOKEN: "shutdown-token-no-browser-cleanup"
    },
    dependencies: {
      cleanupStaleStack: async () => undefined,
      existsSync: (path) => !path.endsWith(".env"),
      readFile: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); },
      cleanupOrphanedAutomationBrowsers: async () => {
        throw new Error("BROAD_BROWSER_CLEANUP_INVOKED");
      },
      resolveLocalAppData: () => "C:\\local-app-data",
      enforceToolResourceRetention: async () => ({ removedFiles: 0, reclaimedBytes: 0 }),
      computeBuildIdentity: async () => buildIdentity,
      spawn: () => spawned.shift(),
      inspectProcessIdentity: async (pid) => identities.get(pid),
      createManagedStackState: (state) => ({ version: 2, ...state }),
      writeStackState: async () => undefined,
      waitForFixtureStack: async () => undefined,
      setInterval: () => timer,
      clearInterval: () => undefined,
      registerSignal: () => undefined,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      setExitCode: () => undefined
    }
  });

  assert.deepEqual(result, { instanceId, buildIdentity });
  assert.equal(spawned.length, 0);
});

async function runStartSignalFixture(signalPhase) {
  const api = new FastChild(801, true);
  const web = new FastChild(802, false);
  const spawned = [api, web];
  const handlers = {};
  const events = [];
  const timer = { unref: () => undefined };
  let signalSent = false;
  const identities = new Map([
    [process.pid, observedIdentity(process.pid, 1)],
    [api.pid, observedIdentity(api.pid, process.pid)],
    [web.pid, observedIdentity(web.pid, process.pid)]
  ]);
  const result = await startLiveStack({
    repositoryRoot: "C:\\exact-worktree",
    environment: {
      CHROME_BRIDGE_KEY: "bridge-key",
      TOOL_CHENH_STACK_INSTANCE_ID: "instance-signal-boundary",
      TOOL_CHENH_STACK_SHUTDOWN_TOKEN: "shutdown-token-signal-boundary"
    },
    dependencies: {
      cleanupStaleStack: async () => undefined,
      existsSync: (path) => !path.endsWith(".env"),
      readFile: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); },
      cleanupOrphanedAutomationBrowsers: async () => undefined,
      resolveLocalAppData: () => "C:\\local-app-data",
      enforceToolResourceRetention: async () => ({ removedFiles: 0, reclaimedBytes: 0 }),
      computeBuildIdentity: async () => `sha256:${"a".repeat(64)}`,
      spawn: () => spawned.shift(),
      inspectProcessIdentity: async (pid) => {
        if (signalPhase === "identity" && !signalSent) {
          signalSent = true;
          handlers.SIGTERM?.();
        }
        return identities.get(pid);
      },
      createManagedStackState: (state) => ({ version: 2, ...state }),
      writeStackState: async () => {
        events.push("write");
        if (signalPhase === "publication" && !signalSent) {
          signalSent = true;
          handlers.SIGINT?.();
        }
        await Promise.resolve();
      },
      removeStackState: async () => { events.push("remove"); },
      stopManagedChildren: async (children) => {
        events.push(`stop:${children.length}`);
        for (const { child } of children) child.finish();
      },
      waitForFixtureStack: async () => { events.push("readiness"); },
      setInterval: () => timer,
      clearInterval: () => undefined,
      registerSignal: (signal, listener) => { handlers[signal] = listener; },
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      setExitCode: (code) => { events.push(`exit:${code}`); }
    }
  });
  return { result, events };
}

test("round3 registers termination before child identity acquisition", async () => {
  const { result, events } = await runStartSignalFixture("identity");
  assert.deepEqual(result, { stopped: true });
  assert.equal(events.includes("stop:2"), true);
  assert.equal(events.includes("write"), false);
  assert.equal(events.includes("readiness"), false);
});

test("round3 registers termination before managed state publication", async () => {
  const { result, events } = await runStartSignalFixture("publication");
  assert.deepEqual(result, { stopped: true });
  assert.equal(events.includes("stop:2"), true);
  assert.equal(events.includes("remove"), true);
  assert.equal(events.includes("readiness"), false);
});

test("round3 purges every casing of deployment and shutdown authority after dotenv", async () => {
  const api = new FastChild(901, true);
  const web = new FastChild(902, false);
  const spawned = [api, web];
  const childEnvironments = [];
  const timer = { unref: () => undefined };
  const environment = {
    CHROME_BRIDGE_KEY: "bridge-key",
    TOOL_CHENH_STACK_INSTANCE_ID: "instance-mixed-authority",
    TOOL_CHENH_STACK_SHUTDOWN_TOKEN: "shutdown-token-mixed-authority",
    tool_chenh_stack_shutdown_token: "stale-shutdown-token",
    Tool_Chenh_Deployment_Lease_Token: "deployment-secret",
    tool_chenh_stack_instance_query: "stale-query"
  };
  const identities = new Map([
    [process.pid, observedIdentity(process.pid, 1)],
    [api.pid, observedIdentity(api.pid, process.pid)],
    [web.pid, observedIdentity(web.pid, process.pid)]
  ]);
  await startLiveStack({
    repositoryRoot: "C:\\exact-worktree",
    environment,
    dependencies: {
      cleanupStaleStack: async () => undefined,
      existsSync: () => true,
      loadEnvFile: () => { environment.tOoL_cHeNh_DePlOyMeNt_LeAsE_tOkEn = "dotenv-secret"; },
      readFile: async () => { throw Object.assign(new Error("absent"), { code: "ENOENT" }); },
      cleanupOrphanedAutomationBrowsers: async () => undefined,
      resolveLocalAppData: () => "C:\\local-app-data",
      enforceToolResourceRetention: async () => ({ removedFiles: 0, reclaimedBytes: 0 }),
      computeBuildIdentity: async () => `sha256:${"a".repeat(64)}`,
      spawn: (command, args, options) => {
        childEnvironments.push(options.env);
        return spawned.shift();
      },
      inspectProcessIdentity: async (pid) => identities.get(pid),
      createManagedStackState: (state) => ({ version: 2, ...state }),
      writeStackState: async () => undefined,
      waitForFixtureStack: async () => undefined,
      setInterval: () => timer,
      clearInterval: () => undefined,
      registerSignal: () => undefined,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      setExitCode: () => undefined
    }
  });
  const authorityPattern = /^tool_chenh_(deployment_lease_token|stack_shutdown_token|stack_instance_query)$/iu;
  assert.deepEqual(Object.keys(environment).filter((key) => authorityPattern.test(key)), []);
  assert.equal(childEnvironments.length, 2);
  for (const childEnvironment of childEnvironments) {
    assert.deepEqual(Object.keys(childEnvironment).filter((key) => authorityPattern.test(key)), []);
  }
});
