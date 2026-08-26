import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import {
  handoffExactV2LiveStack,
  runExactV2StackHandoffCli
} from "./exact-v2-stack-handoff.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";

const TOKEN = "exact-deployment-token-123";
const OLD_BUILD = `sha256:${"b".repeat(64)}`;
const NEW_BUILD = `sha256:${"a".repeat(64)}`;

function quotedCommand(...arguments_) {
  return arguments_.map((argument) => `"${argument}"`).join(" ");
}

function processIdentity(pid, parentPid, entrypoint, options = {}) {
  const arguments_ = [process.execPath];
  if (options.nodeOption !== undefined) arguments_.push(options.nodeOption);
  arguments_.push(entrypoint);
  if (options.trailing !== undefined) arguments_.push(...options.trailing);
  return {
    pid,
    parentPid,
    executablePath: process.execPath,
    commandLine: quotedCommand(...arguments_),
    birthMarker: `birth-${pid}`
  };
}

function coordinatorStatus(deployment = {
  provider: "SABA",
  worker: "root-deployer",
  token: TOKEN,
  claimedAtMs: 1,
  expiresAtMs: 100_000
}) {
  return { version: 3, deployment, lastDeployment: null, edits: [], acceptances: [] };
}

function harness(options = {}) {
  const repositoryRoot = resolve(".tmp-exact-v2-handoff-root");
  const { apiEntry, viteEntry } = resolveStackEntries(repositoryRoot);
  const launcherEntry = join(repositoryRoot, "scripts", "start-live-stack.mjs");
  const old = {
    launcher: processIdentity(101, 50, launcherEntry),
    api: processIdentity(102, 101, apiEntry, { nodeOption: "--max-old-space-size=4096" }),
    web: processIdentity(103, 101, viteEntry, {
      trailing: ["--host", "127.0.0.1", "--port", "4311", "--strictPort"]
    }),
    late: processIdentity(104, 102, join(repositoryRoot, "late-child.mjs"))
  };
  const fresh = {
    launcher: processIdentity(201, 50, launcherEntry),
    api: processIdentity(202, 201, apiEntry, { nodeOption: "--max-old-space-size=4096" }),
    web: processIdentity(203, 201, viteEntry, {
      trailing: ["--host", "127.0.0.1", "--port", "4311", "--strictPort"]
    })
  };
  const oldState = {
    version: 2,
    instanceId: "old-instance-123",
    shutdownToken: "old-shutdown-token-123",
    worktreeRoot: repositoryRoot,
    buildIdentity: OLD_BUILD,
    launcher: old.launcher,
    api: old.api,
    web: old.web
  };
  const freshIdentity = {
    instanceId: "new-instance-456",
    shutdownToken: "new-shutdown-token-456"
  };
  const freshState = {
    ...oldState,
    ...freshIdentity,
    buildIdentity: NEW_BUILD,
    launcher: fresh.launcher,
    api: fresh.api,
    web: fresh.web
  };
  const alive = new Map([old.launcher, old.api, old.web, old.late, fresh.launcher, fresh.api, fresh.web]
    .map((entry) => [entry.pid, entry]));
  for (const entry of Object.values(fresh)) alive.delete(entry.pid);
  let state = oldState;
  let phase = "old";
  let oldShutdownRequested = false;
  let newShutdownRequested = false;
  let coordinatorReads = 0;
  let oldTreeScans = 0;
  const shutdownRequests = [];
  const inspectedPids = [];
  const spawned = [];

  const dependencies = {
    now: () => 100,
    coordinatorStatus: async () => {
      coordinatorReads += 1;
      if (options.replaceStateAtCoordinatorRead === coordinatorReads) {
        state = { ...freshState, api: { ...freshState.api, birthMarker: "replaced-api-birth" } };
      }
      return options.loseLeaseAtRead === coordinatorReads ? coordinatorStatus(null) : coordinatorStatus();
    },
    computeBuildIdentity: async () => NEW_BUILD,
    readStackState: async () => state,
    inspectProcess: async (pid) => {
      inspectedPids.push(pid);
      return alive.get(pid) ?? null;
    },
    listInstanceProcesses: async () => {
      if (options.discoveryAvailable) return [];
      throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
    },
    snapshotProcessTree: async (root) => {
      if (Object.values(old).some((entry) => entry.pid === root.pid)) {
        oldTreeScans += 1;
        if (options.lateAfterLauncherExit) {
          if (phase === "clear") {
            return root.pid === old.api.pid ? [old.late].filter((entry) => alive.has(entry.pid)) : [];
          }
          return root.pid === old.launcher.pid
            ? [old.launcher, old.api, old.web].filter((entry) => alive.has(entry.pid)) : [];
        }
        if (root.pid !== old.launcher.pid) return [];
        return oldTreeScans === 1 ? [old.launcher, old.api, old.web]
          : [old.launcher, old.api, old.web, old.late].filter((entry) => alive.has(entry.pid));
      }
      return root.pid === fresh.launcher.pid
        ? [fresh.launcher, fresh.api, fresh.web].filter((entry) => alive.has(entry.pid)) : [];
    },
    listPortOwnerPids: async (_host, port) => {
      if (phase === "old") return port === 4310 ? [old.api.pid] : [old.web.pid];
      if (phase === "new") return port === 4310 ? [fresh.api.pid] : [fresh.web.pid];
      return [];
    },
    requestGracefulShutdown: async (request) => {
      shutdownRequests.push(request);
      if (request.instanceId === oldState.instanceId) oldShutdownRequested = true;
      if (request.instanceId === freshState.instanceId) newShutdownRequested = true;
    },
    createLaunchIdentity: () => freshIdentity,
    spawnLauncher: async (input) => {
      spawned.push(input);
      phase = "new";
      state = options.spawnedLauncherGoneBeforeCleanup ? null : freshState;
      for (const entry of Object.values(fresh)) alive.set(entry.pid, entry);
      if (options.spawnedLauncherGoneBeforeCleanup) alive.delete(fresh.launcher.pid);
      return { pid: fresh.launcher.pid, ...freshIdentity, getError: () => null };
    },
    fetch: async (url) => url.endsWith("/api/health") ? {
      ok: true,
      json: async () => ({ status: "ok", mode: "OBSERVE", executionReady: false, buildIdentity: NEW_BUILD })
    } : { ok: true },
    sleep: async () => {
      if (oldShutdownRequested && phase === "old") {
        for (const entry of Object.values(old)) {
          if (!options.lateAfterLauncherExit || entry.pid !== old.late.pid) alive.delete(entry.pid);
        }
        if (!options.keepOldState) state = null;
        phase = "clear";
      } else if (options.lateAfterLauncherExit && phase === "clear" && alive.has(old.late.pid)) {
        alive.delete(old.late.pid);
      } else if (newShutdownRequested && phase === "new") {
        for (const entry of Object.values(fresh)) alive.delete(entry.pid);
        state = null;
        phase = "clear";
      }
    }
  };

  return { repositoryRoot, dependencies, old, fresh, oldState, freshState, shutdownRequests, inspectedPids,
    spawned };
}

test("hands off an exact v2 stack and tracks a descendant born during graceful shutdown", async () => {
  const fixture = harness();

  const result = await handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 20, pollIntervalMs: 1 }, fixture.dependencies);

  assert.deepEqual(result, { instanceId: fixture.freshState.instanceId, buildIdentity: NEW_BUILD });
  assert.deepEqual(fixture.shutdownRequests, [{
    instanceId: fixture.oldState.instanceId,
    shutdownToken: fixture.oldState.shutdownToken
  }]);
  assert.equal(fixture.inspectedPids.includes(fixture.old.late.pid), true);
  assert.equal(fixture.spawned.length, 1);
});

test("tracks a descendant born at the launcher-death boundary before two clear observations", async () => {
  const fixture = harness({ lateAfterLauncherExit: true });

  const result = await handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 20, pollIntervalMs: 1 }, fixture.dependencies);

  assert.equal(result.instanceId, fixture.freshState.instanceId);
  assert.equal(fixture.inspectedPids.includes(fixture.old.late.pid), true);
  assert.equal(fixture.spawned.length, 1);
});

test("refuses the fallback when exact instance-wide discovery is available", async () => {
  const fixture = harness({ discoveryAvailable: true });

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot }, fixture.dependencies), /STACK_INSTANCE_DISCOVERY_AVAILABLE/u);

  assert.deepEqual(fixture.shutdownRequests, []);
  assert.deepEqual(fixture.spawned, []);
});

test("proves the old API and web own their exact ports before the shutdown request", async () => {
  const fixture = harness();
  fixture.dependencies.listPortOwnerPids = async (_host, port) => port === 4310 ? [999] : [103];

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot }, fixture.dependencies), /STACK_PORT_OWNERSHIP_NOT_PROVEN/u);

  assert.deepEqual(fixture.shutdownRequests, []);
});

test("requires the launcher to remove old state instead of unlinking it from the handoff", async () => {
  const fixture = harness({ keepOldState: true });

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 2, pollIntervalMs: 1 }, fixture.dependencies),
  /OLD_STACK_DID_NOT_CLEAR/u);

  assert.equal(fixture.spawned.length, 0);
  assert.deepEqual(fixture.shutdownRequests, [{
    instanceId: fixture.oldState.instanceId,
    shutdownToken: fixture.oldState.shutdownToken
  }]);
});

test("lease loss after spawn performs only exact graceful cleanup of the fresh instance", async () => {
  const fixture = harness({ loseLeaseAtRead: 4 });

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 20, pollIntervalMs: 1 }, fixture.dependencies),
  /LIVE_DEPLOYMENT_LEASE_LOST/u);

  assert.deepEqual(fixture.shutdownRequests, [
    { instanceId: fixture.oldState.instanceId, shutdownToken: fixture.oldState.shutdownToken },
    { instanceId: fixture.freshState.instanceId, shutdownToken: fixture.freshState.shutdownToken }
  ]);
  assert.equal(fixture.spawned.length, 1);
});

test("lease loss at the final gate cleans the exact fresh instance", async () => {
  const fixture = harness({ loseLeaseAtRead: 5 });

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 20, pollIntervalMs: 1 }, fixture.dependencies),
  /LIVE_DEPLOYMENT_LEASE_LOST/u);

  assert.equal(fixture.spawned.length, 1);
  assert.deepEqual(fixture.shutdownRequests.at(-1), {
    instanceId: fixture.freshState.instanceId,
    shutdownToken: fixture.freshState.shutdownToken
  });
});

test("state replacement before final proof cleans the exact fresh instance", async () => {
  const fixture = harness({ replaceStateAtCoordinatorRead: 4 });

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 20, pollIntervalMs: 1 }, fixture.dependencies),
  /NEW_STACK_STATE_CHANGED/u);

  assert.equal(fixture.spawned.length, 1);
  assert.deepEqual(fixture.shutdownRequests.at(-1), {
    instanceId: fixture.freshState.instanceId,
    shutdownToken: fixture.freshState.shutdownToken
  });
});

test("cleanup seeds the vanished spawned PID and tracks unpublished children", async () => {
  const fixture = harness({ spawnedLauncherGoneBeforeCleanup: true });

  await assert.rejects(handoffExactV2LiveStack({ leaseToken: TOKEN,
    repositoryRoot: fixture.repositoryRoot, timeoutMs: 3, pollIntervalMs: 1 }, fixture.dependencies),
  /NEW_STACK_READINESS_TIMEOUT/u);

  assert.equal(fixture.inspectedPids.includes(fixture.fresh.api.pid), true);
  assert.equal(fixture.inspectedPids.includes(fixture.fresh.web.pid), true);
  assert.deepEqual(fixture.shutdownRequests.at(-1), {
    instanceId: fixture.freshState.instanceId,
    shutdownToken: fixture.freshState.shutdownToken
  });
});

test("CLI accepts zero arguments and obtains the deployment token only from environment", async () => {
  const calls = [];
  const result = await runExactV2StackHandoffCli([], {
    env: { tool_chenh_deployment_lease_token: ` ${TOKEN} ` },
    repositoryRoot: "C:\\exact-root",
    handoff: async (input) => { calls.push(input); return { instanceId: "new", buildIdentity: NEW_BUILD }; }
  });

  assert.deepEqual(result, { instanceId: "new", buildIdentity: NEW_BUILD });
  assert.deepEqual(calls, [{ leaseToken: TOKEN, repositoryRoot: "C:\\exact-root" }]);
  await assert.rejects(runExactV2StackHandoffCli([TOKEN], {
    env: { TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN: TOKEN }
  }), /INVALID_ARGUMENTS/u);
});
