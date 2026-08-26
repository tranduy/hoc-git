import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { computeBuildIdentity, validateFiveProviderCoordinatorStatus } from "./five-provider-coordinator.mjs";
import { inspectProcessIdentity, listStackInstanceProcesses, spawnLiveStackLauncher } from "./restart-live-stack.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";
import { validateStackState } from "./stack-state.mjs";

const execFile = promisify(execFileCallback);
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function environmentValue(environment, expectedKey) {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === expectedKey.toLowerCase());
  return key === undefined ? undefined : environment[key];
}

function windowsPowerShellExecutable(environment = process.env) {
  const systemRoot = environmentValue(environment, "SystemRoot") ?? environmentValue(environment, "WINDIR");
  if (typeof systemRoot !== "string" || !win32.isAbsolute(systemRoot)) throw new Error("WINDOWS_PROCESS_QUERY_UNAVAILABLE");
  return win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function canonicalPath(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = resolve(value).replaceAll("/", "\\");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return canonicalPath(left) === canonicalPath(right);
}

function commandArguments(commandLine) {
  if (typeof commandLine !== "string") return [];
  const arguments_ = [];
  let index = 0;
  while (index < commandLine.length) {
    while (/\s/u.test(commandLine[index] ?? "")) index += 1;
    if (index >= commandLine.length) break;
    let current = "";
    let quoted = false;
    while (index < commandLine.length) {
      let backslashes = 0;
      while (commandLine[index] === "\\") { backslashes += 1; index += 1; }
      if (commandLine[index] === "\"") {
        current += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 1) current += "\"";
        else if (quoted && commandLine[index + 1] === "\"") { current += "\""; index += 1; }
        else quoted = !quoted;
        index += 1;
        continue;
      }
      current += "\\".repeat(backslashes);
      const character = commandLine[index];
      if (character === undefined || (!quoted && /\s/u.test(character))) break;
      current += character;
      index += 1;
    }
    arguments_.push(current);
    while (/\s/u.test(commandLine[index] ?? "")) index += 1;
  }
  return arguments_;
}

function exactNodeEntrypoint(identity, expected, leadingOptionPattern = null) {
  const arguments_ = commandArguments(identity?.commandLine);
  if (!samePath(identity?.executablePath, process.execPath) || !samePath(arguments_[0], process.execPath)) return false;
  let entrypointIndex = 1;
  if (leadingOptionPattern?.test(arguments_[entrypointIndex] ?? "")) entrypointIndex += 1;
  return samePath(arguments_[entrypointIndex], expected);
}

function validIdentity(value) {
  return value !== null && typeof value === "object" && Number.isSafeInteger(value.pid) && value.pid > 0 &&
    Number.isSafeInteger(value.parentPid) && value.parentPid >= 0 && typeof value.executablePath === "string" &&
    typeof value.commandLine === "string" && typeof value.birthMarker === "string" && value.birthMarker.length > 0;
}

function sameRuntimeIdentity(left, right) {
  return validIdentity(left) && validIdentity(right) && left.pid === right.pid && left.birthMarker === right.birthMarker;
}

function matchesRecordedIdentity(recorded, observed) {
  return sameRuntimeIdentity(recorded, observed) && recorded.parentPid === observed.parentPid &&
    recorded.commandLine === observed.commandLine && samePath(recorded.executablePath, observed.executablePath);
}

function identityKey(identity) {
  return `${identity.pid}\0${identity.birthMarker}`;
}

function sameManagedState(left, right) {
  return left?.version === 2 && right?.version === 2 && left.instanceId === right.instanceId &&
    left.shutdownToken === right.shutdownToken && left.buildIdentity === right.buildIdentity &&
    samePath(left.worktreeRoot, right.worktreeRoot) && matchesRecordedIdentity(left.launcher, right.launcher) &&
    matchesRecordedIdentity(left.api, right.api) && matchesRecordedIdentity(left.web, right.web);
}

function addTracked(tracked, identities) {
  if (!Array.isArray(identities) || !identities.every(validIdentity)) throw new Error("STACK_PROCESS_TREE_NOT_PROVEN");
  let added = 0;
  for (const identity of identities) {
    const key = identityKey(identity);
    if (!tracked.has(key)) added += 1;
    tracked.set(key, identity);
  }
  return added;
}

function captureAuthority(raw, token, nowMs, code = "LIVE_DEPLOYMENT_LEASE_REQUIRED") {
  let status;
  try { status = validateFiveProviderCoordinatorStatus(raw, nowMs); }
  catch { throw new Error("COORDINATION_STATE_INVALID"); }
  const lease = status.deployment;
  if (typeof token !== "string" || token.length === 0 || lease === null || lease.provider === "ROOT" ||
    lease.token !== token) throw new Error(code);
  return { provider: lease.provider, token: lease.token };
}

async function recheckAuthority(authority, dependencies, now) {
  const current = captureAuthority(await dependencies.coordinatorStatus(), authority.token, now(),
    "LIVE_DEPLOYMENT_LEASE_LOST");
  if (current.provider !== authority.provider) throw new Error("LIVE_DEPLOYMENT_LEASE_LOST");
}

function stackEntrypointsMatch(state, observed, repositoryRoot) {
  const { apiEntry, viteEntry } = resolveStackEntries(repositoryRoot);
  const launcherEntry = resolve(repositoryRoot, "scripts", "start-live-stack.mjs");
  return exactNodeEntrypoint(observed.launcher, launcherEntry) &&
    exactNodeEntrypoint(observed.api, apiEntry, /^--max-old-space-size=\d+$/u) &&
    exactNodeEntrypoint(observed.web, viteEntry) && observed.api.parentPid === observed.launcher.pid &&
    observed.web.parentPid === observed.launcher.pid && matchesRecordedIdentity(state.launcher, observed.launcher) &&
    matchesRecordedIdentity(state.api, observed.api) && matchesRecordedIdentity(state.web, observed.web);
}

async function observeStateStack(state, repositoryRoot, dependencies) {
  const [launcher, api, web] = await Promise.all([
    dependencies.inspectProcess(state.launcher.pid), dependencies.inspectProcess(state.api.pid),
    dependencies.inspectProcess(state.web.pid)
  ]);
  const observed = { launcher, api, web };
  return stackEntrypointsMatch(state, observed, repositoryRoot) ? observed : null;
}

async function exactPortOwnership(stack, dependencies) {
  const [apiOwners, webOwners] = await Promise.all([
    dependencies.listPortOwnerPids("127.0.0.1", 4310), dependencies.listPortOwnerPids("127.0.0.1", 4311)
  ]);
  return Array.isArray(apiOwners) && Array.isArray(webOwners) && apiOwners.length === 1 && webOwners.length === 1 &&
    apiOwners[0] === stack.api.pid && webOwners[0] === stack.web.pid;
}

function boundedAttempts(timeoutMs, intervalMs) {
  return Math.max(2, Math.ceil(timeoutMs / Math.max(1, intervalMs)) + 1);
}

async function stateOrNull(dependencies) {
  try { return await dependencies.readStackState(); }
  catch (error) {
    if (error instanceof Error && error.message === "LIVE_STACK_STATE_UNAVAILABLE") return null;
    throw error;
  }
}

async function waitForOldClear(state, stack, tracked, dependencies, attempts, intervalMs) {
  let clear = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Win32_Process preserves the creator PID after the parent exits. Keep scanning
    // every already-tracked PID as a forest root so a grandchild remains reachable
    // even after its immediate parent row has disappeared.
    let added = 0;
    for (const root of [...tracked.values()]) {
      added += addTracked(tracked, await dependencies.snapshotProcessTree(root));
    }
    if (added > 0) clear = 0;
    const entries = [...tracked.values()];
    const observed = await Promise.all(entries.map((entry) => dependencies.inspectProcess(entry.pid)));
    const alive = observed.some((identity, index) => sameRuntimeIdentity(entries[index], identity));
    const currentState = await stateOrNull(dependencies);
    const [apiOwners, webOwners] = await Promise.all([
      dependencies.listPortOwnerPids("127.0.0.1", 4310), dependencies.listPortOwnerPids("127.0.0.1", 4311)
    ]);
    const stateGone = currentState === null;
    if (!alive && stateGone && apiOwners.length === 0 && webOwners.length === 0) {
      clear += 1;
      if (clear >= 2) return;
    } else clear = 0;
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  throw new Error("OLD_STACK_DID_NOT_CLEAR");
}

async function waitForNewStack(identity, spawned, buildIdentity, repositoryRoot, dependencies, attempts, intervalMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (typeof spawned?.getError === "function" && spawned.getError() !== null) throw new Error("LIVE_STACK_SPAWN_FAILED");
    const candidate = await stateOrNull(dependencies);
    if (candidate !== null) {
      let state;
      try { state = validateStackState(candidate); } catch { throw new Error("NEW_STACK_STATE_INVALID"); }
      if (state.version === 2 && state.instanceId === identity.instanceId &&
        state.shutdownToken === identity.shutdownToken && state.buildIdentity === buildIdentity &&
        samePath(state.worktreeRoot, repositoryRoot) && state.launcher.pid === spawned.pid) {
        const stack = await observeStateStack(state, repositoryRoot, dependencies);
        if (stack !== null && await exactPortOwnership(stack, dependencies)) {
          try {
            const [healthResponse, webResponse] = await Promise.all([
              dependencies.fetch("http://127.0.0.1:4310/api/health"), dependencies.fetch("http://127.0.0.1:4311/")
            ]);
            const health = healthResponse.ok ? await healthResponse.json() : null;
            if (health?.buildIdentity === buildIdentity && webResponse.ok) return { state, stack };
          } catch { /* retry while the exact new instance becomes ready */ }
        }
      }
    }
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  throw new Error("NEW_STACK_READINESS_TIMEOUT");
}

async function cleanupFresh(identity, spawned, next, dependencies, attempts, intervalMs) {
  await dependencies.requestGracefulShutdown(identity);
  const tracked = new Map();
  const rootPids = new Set();
  if (Number.isSafeInteger(spawned?.pid) && spawned.pid > 0) rootPids.add(spawned.pid);
  if (next !== null) addTracked(tracked, [next.stack.launcher, next.stack.api, next.stack.web]);
  else if (Number.isSafeInteger(spawned?.pid) && spawned.pid > 0) {
    const launcher = await dependencies.inspectProcess(spawned.pid);
    if (launcher !== null) addTracked(tracked, [launcher]);
  }
  for (const entry of tracked.values()) rootPids.add(entry.pid);
  let clear = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let added = 0;
    for (const pid of [...rootPids]) {
      const discovered = await dependencies.snapshotProcessTree({ pid });
      added += addTracked(tracked, discovered);
      for (const entry of discovered) rootPids.add(entry.pid);
    }
    if (added > 0) clear = 0;
    const entries = [...tracked.values()];
    const observed = await Promise.all(entries.map((entry) => dependencies.inspectProcess(entry.pid)));
    const alive = observed.some((value, index) => sameRuntimeIdentity(entries[index], value));
    const current = await stateOrNull(dependencies);
    const exactState = current?.version === 2 && current.instanceId === identity.instanceId;
    const [apiOwners, webOwners] = await Promise.all([
      dependencies.listPortOwnerPids("127.0.0.1", 4310), dependencies.listPortOwnerPids("127.0.0.1", 4311)
    ]);
    if (!alive && !exactState && apiOwners.length === 0 && webOwners.length === 0) {
      clear += 1;
      if (clear >= 2) return;
    } else clear = 0;
    if (attempt + 1 < attempts) await dependencies.sleep(intervalMs);
  }
  throw new Error("POSTSPAWN_CLEANUP_FAILED");
}

export async function handoffExactV2LiveStack(input, dependencies) {
  const now = dependencies.now ?? Date.now;
  const authority = captureAuthority(await dependencies.coordinatorStatus(), input?.leaseToken, now());
  try {
    await dependencies.listInstanceProcesses("probe-exact-v2-handoff");
    throw new Error("STACK_INSTANCE_DISCOVERY_AVAILABLE");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "STACK_INSTANCE_DISCOVERY_UNAVAILABLE") throw error;
  }
  const repositoryRoot = input.repositoryRoot;
  const buildIdentity = await dependencies.computeBuildIdentity(repositoryRoot);
  let state;
  try { state = validateStackState(await dependencies.readStackState()); }
  catch { throw new Error("LIVE_STACK_STATE_INVALID"); }
  if (state.version !== 2 || !samePath(state.worktreeRoot, repositoryRoot)) throw new Error("LIVE_STACK_STATE_INVALID");
  const stack = await observeStateStack(state, repositoryRoot, dependencies);
  if (stack === null) throw new Error("STACK_OWNERSHIP_NOT_PROVEN");
  if (!await exactPortOwnership(stack, dependencies)) throw new Error("STACK_PORT_OWNERSHIP_NOT_PROVEN");
  const tracked = new Map();
  addTracked(tracked, await dependencies.snapshotProcessTree(stack.launcher));
  for (const required of [stack.launcher, stack.api, stack.web]) {
    if (!tracked.has(identityKey(required))) throw new Error("STACK_PROCESS_TREE_NOT_PROVEN");
  }
  await recheckAuthority(authority, dependencies, now);
  await dependencies.requestGracefulShutdown({ instanceId: state.instanceId, shutdownToken: state.shutdownToken });
  const timeoutMs = input.timeoutMs ?? 60_000;
  const intervalMs = input.pollIntervalMs ?? 100;
  const attempts = boundedAttempts(timeoutMs, intervalMs);
  await waitForOldClear(state, stack, tracked, dependencies, attempts, intervalMs);
  await recheckAuthority(authority, dependencies, now);
  const identity = dependencies.createLaunchIdentity();
  let spawned = null;
  let next = null;
  try {
    spawned = await dependencies.spawnLauncher({ repositoryRoot, ...identity });
    next = await waitForNewStack(identity, spawned, buildIdentity, repositoryRoot, dependencies, attempts, intervalMs);
    await recheckAuthority(authority, dependencies, now);
    let currentState;
    try { currentState = validateStackState(await dependencies.readStackState()); }
    catch { throw new Error("NEW_STACK_STATE_CHANGED"); }
    if (!sameManagedState(next.state, currentState)) throw new Error("NEW_STACK_STATE_CHANGED");
    const reproved = await observeStateStack(currentState, repositoryRoot, dependencies);
    if (reproved === null || !await exactPortOwnership(reproved, dependencies)) {
      throw new Error("NEW_STACK_OWNERSHIP_NOT_PROVEN");
    }
    await recheckAuthority(authority, dependencies, now);
    return { instanceId: next.state.instanceId, buildIdentity };
  } catch (error) {
    if (spawned !== null) {
      try { await cleanupFresh(identity, spawned, next, dependencies, attempts, intervalMs); }
      catch (cleanupError) { throw new Error("POSTSPAWN_CLEANUP_FAILED", { cause: { error, cleanupError } }); }
    }
    throw error;
  }
}

async function readJson(path, unavailableCode) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") throw new Error(unavailableCode);
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, ...value })}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

async function windowsRows(command, environment = process.env) {
  const { stdout } = await execFile(windowsPowerShellExecutable(environment),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 10_000, windowsHide: true });
  if (stdout.trim().length === 0) return [];
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function snapshotWindowsProcessTree(root) {
  const rows = await windowsRows("@(Get-CimInstance Win32_Process | ForEach-Object { " +
    "[pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId } }) | ConvertTo-Json -Compress");
  const included = new Set([root.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!included.has(row.pid) && included.has(row.parentPid)) { included.add(row.pid); changed = true; }
    }
  }
  const identities = await Promise.all([...included].map(inspectProcessIdentity));
  return identities.filter((identity) => identity !== null);
}

async function portOwnerPids(host, port) {
  if (process.platform !== "win32" || host !== "127.0.0.1") throw new Error("PORT_OWNER_DISCOVERY_UNAVAILABLE");
  return windowsRows(`@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | ` +
    "Select-Object -ExpandProperty OwningProcess -Unique) | ConvertTo-Json -Compress");
}

function defaultDependencies(repositoryRoot) {
  const coordinationPath = resolve(repositoryRoot, ".run", "five-provider", "coordination.json");
  const statePath = resolve(repositoryRoot, ".auth", "run", "live-stack.json");
  const shutdownPath = resolve(repositoryRoot, ".auth", "run", "live-stack.shutdown.json");
  return {
    now: Date.now,
    coordinatorStatus: () => readJson(coordinationPath, "COORDINATION_STATE_UNAVAILABLE"),
    computeBuildIdentity,
    readStackState: () => readJson(statePath, "LIVE_STACK_STATE_UNAVAILABLE"),
    inspectProcess: inspectProcessIdentity,
    listInstanceProcesses: listStackInstanceProcesses,
    snapshotProcessTree: snapshotWindowsProcessTree,
    listPortOwnerPids: portOwnerPids,
    requestGracefulShutdown: (request) => writeJsonAtomic(shutdownPath, request),
    createLaunchIdentity: () => ({ instanceId: randomUUID(), shutdownToken: randomUUID() }),
    spawnLauncher: ({ instanceId, shutdownToken }) => spawnLiveStackLauncher(repositoryRoot,
      { instanceId, shutdownToken }),
    fetch: (url) => globalThis.fetch(url, { signal: AbortSignal.timeout(2_000) }),
    sleep: delay
  };
}

export async function runExactV2StackHandoffCli(args, options = {}) {
  if (!Array.isArray(args) || args.length !== 0) throw new Error("INVALID_ARGUMENTS");
  const environment = options.env ?? process.env;
  const token = environmentValue(environment, "TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN")?.trim();
  if (typeof token !== "string" || token.length === 0) throw new Error("LIVE_DEPLOYMENT_LEASE_REQUIRED");
  const repositoryRoot = options.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const handoff = options.handoff ?? ((input) => handoffExactV2LiveStack(input,
    options.dependencies ?? defaultDependencies(repositoryRoot)));
  return handoff({ leaseToken: token, repositoryRoot });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runExactV2StackHandoffCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`[live-stack] exact v2 handoff completed (${result.buildIdentity}).\n`);
  }).catch((error) => {
    process.stderr.write(`[live-stack] exact v2 handoff failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
