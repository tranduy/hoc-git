import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { restartLiveStack, runRestartCli, spawnLiveStackLauncher } from "./restart-live-stack.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";

const BUILD_ID = `sha256:${"a".repeat(64)}`;
const TOKEN = "right-lease-token-123";
const execFile = promisify(execFileCallback);

function moduleSource(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function processIdentity(pid, parentPid, args, birthMarker = `birth-${pid}`) {
  return { pid, parentPid, executablePath: process.execPath,
    commandLine: [process.execPath, ...args].map((entry) => `"${entry}"`).join(" "), birthMarker };
}

function managedState(repositoryRoot, basePid = 10, instanceId = "instance-old") {
  const { apiEntry, viteEntry } = resolveStackEntries(repositoryRoot);
  return {
    version: 2,
    instanceId,
    shutdownToken: `${instanceId}-shutdown-token`,
    worktreeRoot: repositoryRoot,
    buildIdentity: BUILD_ID,
    launcher: processIdentity(basePid, 1, [join(repositoryRoot, "scripts", "start-live-stack.mjs")]),
    api: processIdentity(basePid + 1, basePid, [apiEntry]),
    web: processIdentity(basePid + 2, basePid,
      [viteEntry, "--host", "127.0.0.1", "--port", "4311", "--strictPort"])
  };
}

function coordinationStatus({ provider = "SABA", token = TOKEN, expiresAtMs = 10_000 } = {}) {
  return { version: 3,
    deployment: { provider, worker: "root-worker", token, claimedAtMs: 500, expiresAtMs },
    lastDeployment: null, edits: [], acceptances: [] };
}

function makeHarness(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? resolve("C:\\exact-worktree");
  const oldState = options.oldState ?? managedState(repositoryRoot);
  const nextState = options.nextState ?? managedState(repositoryRoot, 20, "instance-new");
  const runtime = { state: oldState, oldAlive: true, newAlive: false, lateAlive: false,
    newOverrides: new Map() };
  const actions = { requests: [], removals: [], spawns: 0, fetches: [], statusReads: 0, instanceScans: [] };
  const statuses = options.statuses ?? [coordinationStatus(), coordinationStatus(),
    coordinationStatus(), coordinationStatus()];
  const nowValues = options.nowValues ?? [1_000];
  let nowIndex = 0;

  const oldEntries = [oldState.launcher, oldState.api, oldState.web].filter(Boolean);
  const nextEntries = [nextState.launcher, nextState.api, nextState.web].filter(Boolean);
  const deps = {
    now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)],
    sleep: async () => undefined,
    coordinatorStatus: async () => {
      const index = actions.statusReads;
      actions.statusReads += 1;
      const value = statuses[Math.min(index, statuses.length - 1)];
      return typeof value === "function" ? value(runtime, actions) : value;
    },
    computeBuildIdentity: async () => BUILD_ID,
    createLaunchIdentity: () => ({ instanceId: nextState.instanceId,
      shutdownToken: nextState.shutdownToken }),
    readStackState: async () => {
      if (runtime.state === null) throw new Error("LIVE_STACK_STATE_UNAVAILABLE");
      return runtime.state;
    },
    inspectProcess: async (pid) => {
      if (typeof options.inspectProcess === "function") {
        const overridden = await options.inspectProcess(pid, runtime, { oldState, nextState });
        if (overridden !== undefined) return overridden;
      }
      if (runtime.oldAlive) return oldEntries.find((entry) => entry?.pid === pid) ?? null;
      if (runtime.newAlive) {
        if (runtime.newOverrides.has(pid)) return runtime.newOverrides.get(pid);
        return nextEntries.find((entry) => entry?.pid === pid) ?? null;
      }
      return null;
    },
    listProcessTree: async (rootPid) => {
      if (typeof options.listProcessTree === "function") {
        return options.listProcessTree(rootPid, runtime, { oldState, nextState });
      }
      if (rootPid === oldState.launcher?.pid) return runtime.oldAlive ? oldEntries : [];
      if (rootPid === nextState.launcher?.pid) return runtime.newAlive ? nextEntries : [];
      return [];
    },
    listInstanceProcesses: async (instanceId) => {
      actions.instanceScans.push(instanceId);
      if (typeof options.listInstanceProcesses === "function") {
        return options.listInstanceProcesses(instanceId, runtime, { oldState, nextState });
      }
      if (instanceId === oldState.instanceId) return runtime.oldAlive ? oldEntries : [];
      if (instanceId === nextState.instanceId) return runtime.newAlive ? nextEntries : [];
      return [];
    },
    requestGracefulShutdown: async (request) => {
      actions.requests.push(request);
      if (request.instanceId === oldState.instanceId && request.shutdownToken === oldState.shutdownToken) {
        runtime.oldAlive = false;
      } else if (request.instanceId === nextState.instanceId && request.shutdownToken === nextState.shutdownToken) {
        runtime.newAlive = false;
        runtime.newOverrides.clear();
        if (runtime.state?.instanceId === nextState.instanceId) runtime.state = null;
      } else throw new Error("UNEXPECTED_SHUTDOWN_TARGET");
    },
    isPortClear: async () => true,
    removeStackState: async (expected) => {
      actions.removals.push(expected);
      if (runtime.state === expected) runtime.state = null;
      else throw new Error("LIVE_STACK_STATE_CHANGED");
    },
    spawnLauncher: async ({ repositoryRoot: spawnedRoot }) => {
      assert.equal(spawnedRoot, repositoryRoot);
      actions.spawns += 1;
      runtime.newAlive = true;
      runtime.state = nextState;
      return { pid: nextState.launcher.pid };
    },
    fetch: async (url) => {
      actions.fetches.push(url);
      if (url.endsWith("/api/health")) {
        options.onHealth?.(runtime, { oldState, nextState });
        return { ok: options.healthOk ?? true, json: async () => ({ status: "ok", mode: "OBSERVE",
          executionReady: false, buildIdentity: options.healthBuildIdentity ?? BUILD_ID }) };
      }
      return { ok: options.webOk ?? true, json: async () => ({}) };
    }
  };
  return { repositoryRoot, oldState, nextState, runtime, actions, deps };
}

function linuxStat(pid, birthMarker = "777") {
  return `${pid} (node) ${["S", "1", ...Array(17).fill("0"), birthMarker].join(" ")}`;
}

async function withLinuxDiscoveryFixture({ exitDuringFailure = false, ownerUid = 1000,
  replacementDuringScan = false, readableMarker = null }, operation) {
  const fixtureName = `__toolChenhLinuxDiscovery${Date.now()}${Math.random()}`.replaceAll(".", "_");
  const pid = 321;
  let statReads = 0;
  globalThis[fixtureName] = {
    async readdir(path) {
      assert.equal(path, "/proc");
      return [String(pid)];
    },
    async readFile(path) {
      if (path === `/proc/${pid}/stat`) {
        statReads += 1;
        if (exitDuringFailure && statReads > 1) throw Object.assign(new Error("gone"), { code: "ENOENT" });
        return linuxStat(pid, replacementDuringScan && statReads > 1 ? "888" : "777");
      }
      if (path === `/proc/${pid}/cmdline`) return Buffer.from(`${process.execPath}\0fixture.mjs\0`);
      if (path === `/proc/${pid}/environ`) {
        if (readableMarker !== null) return Buffer.from(`TOOL_CHENH_STACK_INSTANCE_ID=${readableMarker}\0`);
        throw Object.assign(new Error("environment unreadable"), { code: "EACCES" });
      }
      if (path === `/proc/${pid}/status`) return "Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n";
      throw new Error(`unexpected read: ${path}`);
    },
    async readlink(path) {
      assert.equal(path, `/proc/${pid}/exe`);
      return process.execPath;
    },
    async stat(path) {
      assert.equal(path, `/proc/${pid}`);
      if (exitDuringFailure && statReads > 1) throw Object.assign(new Error("gone"), { code: "ENOENT" });
      return { uid: ownerUid };
    }
  };
  const fsMock = moduleSource(`
    const fixture = globalThis[${JSON.stringify(fixtureName)}];
    export const readdir = (...args) => fixture.readdir(...args);
    export const readFile = (...args) => fixture.readFile(...args);
    export const readlink = (...args) => fixture.readlink(...args);
    export const stat = (...args) => fixture.stat(...args);
    export const mkdir = async () => { throw new Error("unexpected mkdir"); };
    export const rename = async () => { throw new Error("unexpected rename"); };
    export const rm = async () => { throw new Error("unexpected rm"); };
    export const writeFile = async () => { throw new Error("unexpected write"); };
  `);
  const childProcessMock = moduleSource(`
    export function execFile() { throw new Error("unexpected execFile"); }
    export function spawn() { throw new Error("unexpected spawn"); }
  `);
  const query = `round3-linux-${Date.now()}-${Math.random()}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes(`/restart-live-stack.mjs?${query}`)) {
        if (specifier === "node:fs/promises") return { url: fsMock, shortCircuit: true };
        if (specifier === "node:child_process") return { url: childProcessMock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const getuidDescriptor = Object.getOwnPropertyDescriptor(process, "getuid");
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  Object.defineProperty(process, "getuid", { value: () => 1000, configurable: true });
  try {
    const module = await import(`./restart-live-stack.mjs?${query}`);
    return await operation(module);
  } finally {
    hooks.deregister();
    Object.defineProperty(process, "platform", platformDescriptor);
    if (getuidDescriptor === undefined) delete process.getuid;
    else Object.defineProperty(process, "getuid", getuidDescriptor);
    delete globalThis[fixtureName];
  }
}

function selectedEnvironment(names) {
  const output = {};
  for (const name of names) {
    const found = Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase());
    if (found !== undefined) output[name] = process.env[found];
  }
  return output;
}

async function runWindowsDiscoveryFixture(mode) {
  const script = resolve("scripts", "windows-stack-instance-processes.ps1");
  const powershell = resolve(process.env.SystemRoot ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = String.raw`
Add-Type -TypeDefinition @'
namespace ToolChenh {
  public static class ProcessEnvironment {
    public static string[] Read(int processId) {
      string mode = System.Environment.GetEnvironmentVariable("DISCOVERY_TEST_MODE");
      if (mode == "unicode" || mode == "replacement") {
        return new[] { "TOOL_CHENH_STACK_INSTANCE_ID=" +
          System.Environment.GetEnvironmentVariable("TOOL_CHENH_STACK_INSTANCE_QUERY") };
      }
      throw new System.InvalidOperationException("fixture environment read failure");
    }
  }
}
'@
$global:DiscoveryCandidate = [pscustomobject]@{
  ProcessId = 321
  ParentProcessId = 1
  ExecutablePath = 'C:\工具\node.exe'
  CommandLine = '"C:\工具\node.exe" "C:\exact\entry.mjs"'
  CreationDate = [datetime]'2026-01-02T03:04:05Z'
}
function global:Get-CimInstance {
  param([Parameter(Position=0)][string]$ClassName, [string]$Filter)
  if ([string]::IsNullOrEmpty($Filter)) { return ,$global:DiscoveryCandidate }
  if ($env:DISCOVERY_TEST_MODE -eq 'exit') { return $null }
  if ($env:DISCOVERY_TEST_MODE -eq 'replacement') {
    return [pscustomobject]@{
      ProcessId = 321
      ParentProcessId = 1
      ExecutablePath = 'C:\replacement\node.exe'
      CommandLine = '"C:\replacement\node.exe" "C:\replacement\entry.mjs"'
      CreationDate = [datetime]'2026-01-02T03:04:06Z'
    }
  }
  return $global:DiscoveryCandidate
}
function global:Invoke-CimMethod {
  if ($env:DISCOVERY_TEST_MODE -eq 'different-owner') {
    return [pscustomobject]@{ ReturnValue = 0; Sid = 'S-1-5-21-999999999-999999999-999999999-9999' }
  }
  throw 'fixture owner lookup failure'
}
& $env:DISCOVERY_SCRIPT
`;
  return execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...selectedEnvironment(["SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP"]),
      DISCOVERY_SCRIPT: script,
      DISCOVERY_TEST_MODE: mode,
      TOOL_CHENH_STACK_INSTANCE_QUERY: "instance-round3-fixture"
    }
  });
}

test("round3 rejects an unreadable same-user Linux process whose exact identity survives", async () => {
  await assert.rejects(withLinuxDiscoveryFixture({}, ({ listStackInstanceProcesses }) =>
    listStackInstanceProcesses("instance-round3-linux")), /STACK_INSTANCE_DISCOVERY_UNAVAILABLE/u);
});

test("round3 ignores the Linux environment-read exit race only after exact identity disappears", async () => {
  const processes = await withLinuxDiscoveryFixture({ exitDuringFailure: true },
    ({ listStackInstanceProcesses }) => listStackInstanceProcesses("instance-round3-linux"));
  assert.deepEqual(processes, []);
});

test("round3 ignores an unreadable Linux process only when its UID is proven different", async () => {
  const processes = await withLinuxDiscoveryFixture({ ownerUid: 2000 },
    ({ listStackInstanceProcesses }) => listStackInstanceProcesses("instance-round3-linux"));
  assert.deepEqual(processes, []);
});

test("round4 refuses a marked Linux PID replacement during the second clear observation", async () => {
  let harness;
  await assert.rejects(withLinuxDiscoveryFixture({ replacementDuringScan: true,
    readableMarker: "instance-old" }, async ({ listStackInstanceProcesses }) => {
    let oldInstanceScans = 0;
    harness = makeHarness({
      listInstanceProcesses: async (instanceId, runtime, { oldState, nextState }) => {
        if (instanceId === oldState.instanceId) {
          oldInstanceScans += 1;
          if (oldInstanceScans === 1) return [oldState.launcher, oldState.api, oldState.web];
          if (oldInstanceScans === 2) return [];
          return listStackInstanceProcesses(instanceId);
        }
        return instanceId === nextState.instanceId && runtime.newAlive
          ? [nextState.launcher, nextState.api, nextState.web] : [];
      }
    });
    return restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
      timeoutMs: 3, pollIntervalMs: 1 }, harness.deps);
  }), /STACK_INSTANCE_DISCOVERY_UNAVAILABLE/u);
  assert.equal(harness.actions.spawns, 0);
});

test("round3 rejects an unreadable Windows process when owner lookup is ambiguous and identity survives", async () => {
  await assert.rejects(runWindowsDiscoveryFixture("survivor"), (error) => {
    assert.match(`${error.message}\n${error.stderr ?? ""}`, /STACK_INSTANCE_DISCOVERY_UNAVAILABLE/u);
    return true;
  });
});

test("round3 ignores the Windows environment-read exit race after the exact birth disappears", async () => {
  const { stdout } = await runWindowsDiscoveryFixture("exit");
  assert.deepEqual(JSON.parse(stdout.trim()), []);
});

test("round3 ignores an unreadable Windows process only when its SID is proven different", async () => {
  const { stdout } = await runWindowsDiscoveryFixture("different-owner");
  assert.deepEqual(JSON.parse(stdout.trim()), []);
});

test("round4 fails the Windows scan when a marked PID is replaced before the clear observation completes", async () => {
  await assert.rejects(runWindowsDiscoveryFixture("replacement"), (error) => {
    assert.match(`${error.message}\n${error.stderr ?? ""}`, /STACK_INSTANCE_DISCOVERY_UNAVAILABLE/u);
    return true;
  });
});

test("round3 preserves Unicode process identity JSON from PowerShell", async () => {
  const { stdout } = await runWindowsDiscoveryFixture("unicode");
  const [identity] = JSON.parse(stdout.trim());
  assert.equal(identity.executablePath, "C:\\工具\\node.exe");
});

test("round3 PowerShell discovery declares UTF-8 console and pipeline output", async () => {
  const source = await readFile(resolve("scripts", "windows-stack-instance-processes.ps1"), "utf8");
  assert.match(source, /\[Console\]::OutputEncoding\s*=/u);
  assert.match(source, /\$OutputEncoding\s*=/u);
});

test("rejects a wrong deployment token before every process action", async () => {
  const harness = makeHarness({ statuses: [coordinationStatus()] });
  const processActions = [];
  for (const name of ["inspectProcess", "listProcessTree", "listInstanceProcesses", "requestGracefulShutdown", "isPortClear",
    "removeStackState", "spawnLauncher", "fetch"]) {
    harness.deps[name] = async () => { processActions.push(name); };
  }
  await assert.rejects(restartLiveStack({ leaseToken: "wrong-token", repositoryRoot: harness.repositoryRoot },
    harness.deps), /LIVE_DEPLOYMENT_LEASE_REQUIRED/u);
  assert.deepEqual(processActions, []);
});

test("rejects a non-canonical deployment provider before mutation", async () => {
  const harness = makeHarness({ statuses: [coordinationStatus({ provider: "EVIL" })] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /COORDINATION_STATE_INVALID|LIVE_DEPLOYMENT_LEASE_REQUIRED/u);
  assert.deepEqual(harness.actions.requests, []);
  assert.equal(harness.actions.spawns, 0);
});

test("rejects a ROOT integration lease before mutation", async () => {
  const harness = makeHarness({ statuses: [coordinationStatus({ provider: "ROOT" })] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /LIVE_DEPLOYMENT_LEASE_REQUIRED/u);
  assert.deepEqual(harness.actions.requests, []);
  assert.equal(harness.actions.spawns, 0);
});

test("rejects malformed stack state without any mutation", async () => {
  const harness = makeHarness();
  harness.runtime.state = { version: 2, launcher: harness.oldState.launcher };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /LIVE_STACK_STATE_INVALID/u);
  assert.deepEqual(harness.actions.requests, []);
  assert.deepEqual(harness.actions.removals, []);
  assert.equal(harness.actions.spawns, 0);
});

test("fails closed on legacy state without inspecting, killing, deleting, or spawning", async () => {
  const harness = makeHarness({ oldState: { launcherPid: 10, apiPid: 11, webPid: 12 } });
  const mutations = [];
  harness.deps.inspectProcess = async () => { mutations.push("inspect"); };
  harness.deps.requestGracefulShutdown = async () => { mutations.push("shutdown"); };
  harness.deps.removeStackState = async () => { mutations.push("remove"); };
  harness.deps.spawnLauncher = async () => { mutations.push("spawn"); };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /LEGACY_STACK_REQUIRES_ROOT_HANDOFF/u);
  assert.deepEqual(mutations, []);
});

test("rejects a reused recorded PID before shutdown", async () => {
  const harness = makeHarness({ inspectProcess: (pid, runtime, { oldState }) =>
    runtime.oldAlive && pid === oldState.launcher.pid ? { ...oldState.launcher, birthMarker: "reused" } : undefined });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /STACK_OWNERSHIP_NOT_PROVEN/u);
  assert.deepEqual(harness.actions.requests, []);
});

test("requires the recorded API and web identities to carry the exact instance marker", async () => {
  const harness = makeHarness({ listInstanceProcesses: () => [] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /STACK_INSTANCE_MARKER_NOT_PROVEN/u);
  assert.deepEqual(harness.actions.requests, []);
});

test("rejects a Node option value masquerading as the API entrypoint", async () => {
  const harness = makeHarness();
  const { apiEntry } = resolveStackEntries(harness.repositoryRoot);
  harness.oldState.api.commandLine = [process.execPath, "--require", apiEntry,
    join(harness.repositoryRoot, "malicious-api.mjs")].map((entry) => `"${entry}"`).join(" ");
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /STACK_OWNERSHIP_NOT_PROVEN/u);
  assert.deepEqual(harness.actions.requests, []);
});

test("rechecks the exact lease after hashing and ownership before first mutation", async () => {
  const expiring = coordinationStatus({ expiresAtMs: 1_500 });
  const harness = makeHarness({ statuses: [expiring, expiring], nowValues: [1_000, 2_000] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /LIVE_DEPLOYMENT_LEASE_LOST/u);
  assert.deepEqual(harness.actions.requests, []);
  assert.equal(harness.actions.spawns, 0);
});

test("rejects a provider change under the same token before first mutation", async () => {
  const harness = makeHarness({ statuses: [coordinationStatus({ provider: "SABA" }),
    coordinationStatus({ provider: "CMD" })] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot }, harness.deps),
    /LIVE_DEPLOYMENT_LEASE_LOST/u);
  assert.deepEqual(harness.actions.requests, []);
});

test("rechecks the exact lease after state removal immediately before spawn", async () => {
  const harness = makeHarness({ statuses: [coordinationStatus(), coordinationStatus(), coordinationStatus(),
    { ...coordinationStatus(), deployment: null }] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /LIVE_DEPLOYMENT_LEASE_LOST/u);
  assert.equal(harness.actions.removals.length, 1);
  assert.equal(harness.actions.spawns, 0);
});

test("restarts a versioned stack and retains the same authority through final proof", async () => {
  const harness = makeHarness();
  const result = await restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 3, pollIntervalMs: 1 }, harness.deps);
  assert.deepEqual(result, { instanceId: "instance-new", buildIdentity: BUILD_ID });
  assert.deepEqual(harness.actions.requests, [{ instanceId: harness.oldState.instanceId,
    shutdownToken: harness.oldState.shutdownToken }]);
  assert.equal(harness.actions.statusReads, 6);
  assert.equal(harness.runtime.newAlive, true);
});

test("rescans after shutdown and refuses to leave a late descendant behind", async () => {
  const late = processIdentity(13, 10, ["C:\\exact-worktree\\late-child.js"]);
  const harness = makeHarness({
    listProcessTree: (rootPid, runtime, { oldState }) => {
      if (rootPid !== oldState.launcher.pid) return [];
      if (runtime.oldAlive) return [oldState.launcher, oldState.api, oldState.web];
      runtime.lateAlive = true;
      return [late];
    },
    inspectProcess: (pid, runtime) => pid === late.pid && runtime.lateAlive ? late : undefined
  });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /OLD_STACK_DID_NOT_CLEAR/u);
  assert.equal(harness.actions.spawns, 0);
});

test("finds a late instance-marked child after it is no longer parent-linked", async () => {
  const orphan = processIdentity(13, 999, ["C:\\exact-worktree\\late-child.js"]);
  const harness = makeHarness({
    listProcessTree: (rootPid, runtime, { oldState }) => rootPid === oldState.launcher.pid && runtime.oldAlive
      ? [oldState.launcher, oldState.api, oldState.web] : [],
    listInstanceProcesses: (instanceId, runtime, { oldState }) => {
      if (instanceId !== oldState.instanceId) return [];
      if (runtime.oldAlive) return [oldState.api, oldState.web];
      runtime.lateAlive = true;
      return [orphan];
    },
    inspectProcess: (pid, runtime) => pid === orphan.pid && runtime.lateAlive ? orphan : undefined
  });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /OLD_STACK_DID_NOT_CLEAR/u);
  assert.equal(harness.actions.spawns, 0);
});

test("rejects a marked successor spawned during tracked-child inspection", async () => {
  const dying = processIdentity(13, 999, ["C:\\exact-worktree\\dying-child.js"]);
  const successor = processIdentity(14, 999, ["C:\\exact-worktree\\successor-child.js"]);
  let postShutdownScans = 0;
  const harness = makeHarness({
    listProcessTree: (rootPid, runtime, { oldState }) => rootPid === oldState.launcher.pid && runtime.oldAlive
      ? [oldState.launcher, oldState.api, oldState.web] : [],
    listInstanceProcesses: (instanceId, runtime, { oldState }) => {
      if (instanceId !== oldState.instanceId) return [];
      if (runtime.oldAlive) return [oldState.api, oldState.web];
      postShutdownScans += 1;
      if (runtime.successorAlive) return [successor];
      if (runtime.dyingAlive) return [dying];
      if (postShutdownScans >= 2) {
        runtime.dyingAlive = true;
        return [dying];
      }
      return [];
    },
    inspectProcess: (pid, runtime) => {
      if (pid === dying.pid && runtime.dyingAlive) {
        runtime.dyingAlive = false;
        runtime.successorAlive = true;
        return null;
      }
      if (pid === successor.pid && runtime.successorAlive) return successor;
      return undefined;
    }
  });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /OLD_STACK_DID_NOT_CLEAR/u);
  assert.equal(harness.actions.spawns, 0);
});

test("cleans the seeded instance when new state publication times out", async () => {
  const harness = makeHarness();
  let spawnInput;
  harness.deps.spawnLauncher = async ({ repositoryRoot, instanceId, shutdownToken }) => {
    spawnInput = { repositoryRoot, instanceId, shutdownToken };
    harness.actions.spawns += 1;
    harness.runtime.newAlive = true;
    harness.runtime.state = null;
    return { pid: harness.nextState.launcher.pid };
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_IDENTITY_TIMEOUT/u);
  assert.deepEqual(spawnInput, { repositoryRoot: harness.repositoryRoot,
    instanceId: harness.nextState.instanceId, shutdownToken: harness.nextState.shutdownToken });
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("round3 cleans the seeded instance when spawn creates a marked child and then rejects", async () => {
  const harness = makeHarness();
  harness.deps.spawnLauncher = async () => {
    harness.actions.spawns += 1;
    harness.runtime.newAlive = true;
    harness.runtime.state = null;
    throw new Error("SPAWN_REJECTED_AFTER_CREATE");
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /SPAWN_REJECTED_AFTER_CREATE/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("cleans the seeded instance when the detached launcher reports an asynchronous spawn error", async () => {
  const harness = makeHarness();
  harness.deps.spawnLauncher = async () => {
    harness.actions.spawns += 1;
    harness.runtime.newAlive = true;
    harness.runtime.state = null;
    return { pid: harness.nextState.launcher.pid, getError: () => new Error("asynchronous spawn failure") };
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /LIVE_STACK_SPAWN_FAILED/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("cleans the seeded instance when new state publication is malformed", async () => {
  const harness = makeHarness();
  harness.deps.spawnLauncher = async () => {
    harness.actions.spawns += 1;
    harness.runtime.newAlive = true;
    harness.runtime.state = { version: 2, instanceId: harness.nextState.instanceId };
    return { pid: harness.nextState.launcher.pid };
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_STATE_INVALID/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("reports cleanup failure when malformed seeded state remains after processes stop", async () => {
  const harness = makeHarness();
  harness.deps.spawnLauncher = async () => {
    harness.actions.spawns += 1;
    harness.runtime.newAlive = true;
    harness.runtime.state = { version: 2, instanceId: harness.nextState.instanceId };
    return { pid: harness.nextState.launcher.pid };
  };
  const requestShutdown = harness.deps.requestGracefulShutdown;
  harness.deps.requestGracefulShutdown = async (request) => {
    if (request.instanceId === harness.nextState.instanceId) {
      harness.actions.requests.push(request);
      harness.runtime.newAlive = false;
      return;
    }
    await requestShutdown(request);
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /POSTSPAWN_CLEANUP_FAILED/u);
  assert.deepEqual(harness.runtime.state, { version: 2, instanceId: harness.nextState.instanceId });
});

test("removes exact seeded v2 state after ownership failure once marked processes stop", async () => {
  const harness = makeHarness({ inspectProcess: (pid, runtime, { nextState }) =>
    runtime.newAlive && pid === nextState.api.pid ? { ...nextState.api, birthMarker: "wrong-new-birth" } : undefined });
  const requestShutdown = harness.deps.requestGracefulShutdown;
  harness.deps.requestGracefulShutdown = async (request) => {
    if (request.instanceId === harness.nextState.instanceId) {
      harness.actions.requests.push(request);
      harness.runtime.newAlive = false;
      return;
    }
    await requestShutdown(request);
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_OWNERSHIP_NOT_PROVEN/u);
  assert.deepEqual(harness.actions.removals, [harness.oldState, harness.nextState]);
  assert.equal(harness.runtime.state, null);
});

test("fails cleanup when a spawned launcher remains alive but marker discovery misses it", async () => {
  const harness = makeHarness({ listInstanceProcesses: (instanceId, runtime, { oldState }) =>
    instanceId === oldState.instanceId && runtime.oldAlive ? [oldState.api, oldState.web] : [] });
  harness.deps.spawnLauncher = async () => {
    harness.actions.spawns += 1;
    harness.runtime.newAlive = true;
    harness.runtime.state = null;
    return { pid: harness.nextState.launcher.pid };
  };
  const requestShutdown = harness.deps.requestGracefulShutdown;
  harness.deps.requestGracefulShutdown = async (request) => {
    if (request.instanceId === harness.nextState.instanceId) {
      harness.actions.requests.push(request);
      return;
    }
    await requestShutdown(request);
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /POSTSPAWN_CLEANUP_FAILED/u);
  assert.equal(harness.runtime.newAlive, true);
});

test("cleans the seeded instance when published state ownership is not proven", async () => {
  const harness = makeHarness({ inspectProcess: (pid, runtime, { nextState }) =>
    runtime.newAlive && pid === nextState.api.pid ? { ...nextState.api, birthMarker: "wrong-new-birth" } : undefined });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_OWNERSHIP_NOT_PROVEN/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("shuts down and verifies the new instance after runtime build mismatch", async () => {
  const harness = makeHarness({ healthBuildIdentity: `sha256:${"b".repeat(64)}` });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /RUNTIME_BUILD_IDENTITY_MISMATCH/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("shuts down the proven new instance when readiness times out", async () => {
  const harness = makeHarness({ healthOk: false });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_READINESS_TIMEOUT/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("reports cleanup failure when the new exact process tree does not stop", async () => {
  const harness = makeHarness({ healthBuildIdentity: `sha256:${"b".repeat(64)}` });
  const request = harness.deps.requestGracefulShutdown;
  harness.deps.requestGracefulShutdown = async (target) => {
    if (target.instanceId === harness.nextState.instanceId) {
      harness.actions.requests.push(target);
      return;
    }
    await request(target);
  };
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /POSTSPAWN_CLEANUP_FAILED/u);
  assert.equal(harness.runtime.newAlive, true);
});

test("detects a swapped state after health and cleans only the proven new instance", async () => {
  const intruder = managedState(resolve("C:\\exact-worktree"), 30, "instance-intruder");
  const harness = makeHarness({ onHealth: (runtime) => { runtime.state = intruder; } });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_IDENTITY_CHANGED/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
  assert.equal(harness.runtime.state.instanceId, "instance-intruder");
});

test("detects a swapped process birth marker after health and cleans the addressed instance", async () => {
  const harness = makeHarness({ onHealth: (runtime, { nextState }) => {
    runtime.newOverrides.set(nextState.launcher.pid, { ...nextState.launcher, birthMarker: "reused-after-health" });
  } });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_IDENTITY_CHANGED/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("rechecks state and process identity at final return", async () => {
  let finalState;
  const statuses = [coordinationStatus(), coordinationStatus(), coordinationStatus(),
    (runtime) => { runtime.state = finalState; return coordinationStatus(); }];
  const harness = makeHarness({ statuses });
  finalState = managedState(harness.repositoryRoot, 30, "instance-final-swap");
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /NEW_STACK_IDENTITY_CHANGED/u);
  assert.equal(harness.runtime.newAlive, false);
});

test("lease loss after spawn triggers exact new-instance shutdown and verified cleanup", async () => {
  const harness = makeHarness({ statuses: [coordinationStatus(), coordinationStatus(), coordinationStatus(),
    coordinationStatus(), { ...coordinationStatus(), deployment: null }] });
  await assert.rejects(restartLiveStack({ leaseToken: TOKEN, repositoryRoot: harness.repositoryRoot,
    timeoutMs: 2, pollIntervalMs: 1 }, harness.deps), /LIVE_DEPLOYMENT_LEASE_LOST/u);
  assert.deepEqual(harness.actions.requests.map(({ instanceId }) => instanceId), ["instance-old", "instance-new"]);
  assert.equal(harness.runtime.newAlive, false);
});

test("CLI rejects positional tokens and reads the lease only from environment", async () => {
  const calls = [];
  const options = { repositoryRoot: "C:\\exact-worktree",
    env: { TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN: TOKEN },
    restart: async (input) => { calls.push(input); return { instanceId: "new", buildIdentity: BUILD_ID }; } };
  await assert.rejects(runRestartCli([TOKEN], options), /INVALID_ARGUMENTS/u);
  await assert.rejects(runRestartCli([], { ...options, env: {} }), /LIVE_DEPLOYMENT_LEASE_REQUIRED/u);
  await runRestartCli([], options);
  assert.deepEqual(calls, [{ leaseToken: TOKEN, repositoryRoot: "C:\\exact-worktree" }]);
});

test("round3 spawns the exact hidden launcher without retaining any casing of authority keys", () => {
  const repositoryRoot = resolve("C:\\exact-worktree");
  const launchIdentity = { instanceId: "instance-new", shutdownToken: "shutdown-token-instance-new" };
  const calls = [];
  let unrefCalls = 0;
  const sourceEnvironment = {
    SAFE: "yes",
    Tool_Chenh_Deployment_Lease_Token: TOKEN,
    tool_chenh_stack_shutdown_token: "stale-shutdown-token",
    Tool_Chenh_Stack_Instance_Query: "stale-instance-query",
    tool_chenh_stack_instance_id: "stale-instance-id"
  };
  const child = Object.assign(new EventEmitter(),
    { pid: 42, unref: () => { unrefCalls += 1; } });
  const result = spawnLiveStackLauncher(repositoryRoot, launchIdentity, (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  }, sourceEnvironment);
  assert.equal(result.pid, 42);
  assert.equal(result.instanceId, launchIdentity.instanceId);
  assert.equal(result.shutdownToken, launchIdentity.shutdownToken);
  assert.equal(result.getError(), null);
  assert.doesNotThrow(() => child.emit("error", new Error("late spawn error")));
  assert.equal(result.getError()?.message, "late spawn error");
  assert.equal(unrefCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [join(repositoryRoot, "scripts", "start-live-stack.mjs")]);
  assert.equal(calls[0].options.cwd, repositoryRoot);
  assert.deepEqual(calls[0].options.env, { SAFE: "yes",
    TOOL_CHENH_STACK_INSTANCE_ID: launchIdentity.instanceId,
    TOOL_CHENH_STACK_SHUTDOWN_TOKEN: launchIdentity.shutdownToken });
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(calls[0].options.windowsHide, true);
});

test("round3 gives the Windows discovery helper an allowlisted environment without secrets", async () => {
  const captureName = `__toolChenhWindowsEnvironment${Date.now()}`;
  let capturedEnvironment;
  globalThis[captureName] = (command, args, options, callback) => {
    capturedEnvironment = options.env;
    callback(null, { stdout: "[]", stderr: "" });
  };
  const childProcessMock = moduleSource(`
    export const execFile = (...args) => globalThis[${JSON.stringify(captureName)}](...args);
    export function spawn() { throw new Error("unexpected spawn"); }
  `);
  const query = `round3-windows-env-${Date.now()}-${Math.random()}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes(`/restart-live-stack.mjs?${query}`) && specifier === "node:child_process") {
        return { url: childProcessMock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const fixtures = {
    ROUND3_PROVIDER_SECRET: "fixture-provider-secret",
    Tool_Chenh_Deployment_Lease_Token: "fixture-deployment-token",
    tool_chenh_stack_shutdown_token: "fixture-shutdown-token",
    tool_chenh_stack_instance_query: "fixture-stale-query"
  };
  const originalFixtures = Object.keys(fixtures).map((fixtureKey) => {
    const actualKey = Object.keys(process.env).find((key) => key.toLowerCase() === fixtureKey.toLowerCase());
    return { fixtureKey, actualKey, value: actualKey === undefined ? undefined : process.env[actualKey] };
  });
  Object.assign(process.env, fixtures);
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const module = await import(`./restart-live-stack.mjs?${query}`);
    await module.listStackInstanceProcesses("instance-round3-helper");
    assert.equal(Object.keys(capturedEnvironment).some((key) => key.toLowerCase() ===
      "round3_provider_secret"), false);
    const controlKeys = Object.keys(capturedEnvironment).filter((key) =>
      /^tool_chenh_(deployment_lease_token|stack_shutdown_token|stack_instance_query)$/iu.test(key));
    assert.deepEqual(controlKeys, ["TOOL_CHENH_STACK_INSTANCE_QUERY"]);
    assert.equal(capturedEnvironment.TOOL_CHENH_STACK_INSTANCE_QUERY, "instance-round3-helper");
  } finally {
    hooks.deregister();
    Object.defineProperty(process, "platform", platformDescriptor);
    for (const { fixtureKey, actualKey, value } of originalFixtures) {
      const currentKey = Object.keys(process.env).find((key) => key.toLowerCase() === fixtureKey.toLowerCase());
      if (currentKey !== undefined) delete process.env[currentKey];
      if (actualKey !== undefined) process.env[actualKey] = value;
    }
    delete globalThis[captureName];
  }
});

test("round3 normalizes a failed Windows helper to the discovery-unavailable boundary", async () => {
  const callbackName = `__toolChenhWindowsFailure${Date.now()}`;
  globalThis[callbackName] = (...args) => {
    const callback = args.at(-1);
    callback(new Error("raw helper failure must not escape"));
  };
  const childProcessMock = moduleSource(`
    export const execFile = (...args) => globalThis[${JSON.stringify(callbackName)}](...args);
    export function spawn() { throw new Error("unexpected spawn"); }
  `);
  const query = `round3-windows-failure-${Date.now()}-${Math.random()}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes(`/restart-live-stack.mjs?${query}`) && specifier === "node:child_process") {
        return { url: childProcessMock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const module = await import(`./restart-live-stack.mjs?${query}`);
    await assert.rejects(module.listStackInstanceProcesses("instance-round3-failure"),
      (error) => error?.message === "STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
  } finally {
    hooks.deregister();
    Object.defineProperty(process, "platform", platformDescriptor);
    delete globalThis[callbackName];
  }
});

test("round4 invokes discovery through the absolute system PowerShell executable", async () => {
  const callbackName = `__toolChenhWindowsCommand${Date.now()}`;
  let observedCommand;
  globalThis[callbackName] = (command, args, options, callback) => {
    observedCommand = command;
    callback(null, { stdout: "[]", stderr: "" });
  };
  const childProcessMock = moduleSource(`
    export const execFile = (...args) => globalThis[${JSON.stringify(callbackName)}](...args);
    export function spawn() { throw new Error("unexpected spawn"); }
  `);
  const query = `round4-windows-command-${Date.now()}-${Math.random()}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes(`/restart-live-stack.mjs?${query}`) && specifier === "node:child_process") {
        return { url: childProcessMock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const module = await import(`./restart-live-stack.mjs?${query}`);
    await module.listStackInstanceProcesses("instance-round4-command");
    const systemEnvironment = selectedEnvironment(["SystemRoot", "WINDIR"]);
    const systemRoot = systemEnvironment.SystemRoot ?? systemEnvironment.WINDIR;
    assert.equal(observedCommand.toLowerCase(),
      `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`.toLowerCase());
  } finally {
    hooks.deregister();
    Object.defineProperty(process, "platform", platformDescriptor);
    delete globalThis[callbackName];
  }
});

test("round4 inline Windows identity inspection preserves a non-ASCII executable path", async () => {
  const callbackName = `__toolChenhWindowsUnicode${Date.now()}`;
  globalThis[callbackName] = (requestedCommand, args, options, callback) => {
    const inlineCommand = args.at(-1);
    const wrapper = String.raw`
function global:Get-CimInstance {
  return [pscustomobject]@{
    ProcessId = 4321
    ParentProcessId = 123
    ExecutablePath = 'C:\工具\node.exe'
    CommandLine = '"C:\工具\node.exe" "C:\工具\entry.mjs"'
    CreationDate = [datetime]'2026-02-03T04:05:06Z'
  }
}
${inlineCommand}
`;
    const systemEnvironment = selectedEnvironment(["SystemRoot", "WINDIR"]);
    const systemRoot = systemEnvironment.SystemRoot ?? systemEnvironment.WINDIR;
    const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    execFileCallback(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command", wrapper], options, (error, stdout, stderr) => {
      if (error !== null) callback(error);
      else callback(null, { stdout, stderr });
    });
  };
  const childProcessMock = moduleSource(`
    export const execFile = (...args) => globalThis[${JSON.stringify(callbackName)}](...args);
    export function spawn() { throw new Error("unexpected spawn"); }
  `);
  const query = `round4-windows-unicode-${Date.now()}-${Math.random()}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes(`/restart-live-stack.mjs?${query}`) && specifier === "node:child_process") {
        return { url: childProcessMock, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    const module = await import(`./restart-live-stack.mjs?${query}`);
    const identity = await module.inspectProcessIdentity(4321);
    assert.equal(identity.executablePath, "C:\\工具\\node.exe");
    assert.equal(identity.commandLine, '"C:\\工具\\node.exe" "C:\\工具\\entry.mjs"');
  } finally {
    hooks.deregister();
    Object.defineProperty(process, "platform", platformDescriptor);
    delete globalThis[callbackName];
  }
});
