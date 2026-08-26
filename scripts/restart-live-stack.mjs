import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { computeBuildIdentity, validateFiveProviderCoordinatorStatus } from "./five-provider-coordinator.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";
import { removeStackState, validateStackState } from "./stack-state.mjs";

const execFile = promisify(execFileCallback);
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const STACK_CONTROL_ENVIRONMENT_KEYS = new Set([
  "tool_chenh_deployment_lease_token",
  "tool_chenh_stack_instance_id",
  "tool_chenh_stack_instance_query",
  "tool_chenh_stack_shutdown_token"
]);
const WINDOWS_DISCOVERY_ENVIRONMENT_KEYS = [
  "SystemRoot", "WINDIR", "ComSpec", "PATH", "PATHEXT", "TEMP", "TMP", "PSModulePath"
];

function environmentWithoutKeys(environment, blockedKeys) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !blockedKeys.has(key.toLowerCase())));
}

function environmentSubset(environment, allowedKeys) {
  const subset = {};
  for (const allowedKey of allowedKeys) {
    const actualKey = Object.keys(environment).find((key) => key.toLowerCase() === allowedKey.toLowerCase());
    if (actualKey !== undefined && typeof environment[actualKey] === "string") {
      subset[allowedKey] = environment[actualKey];
    }
  }
  return subset;
}

function environmentValue(environment, expectedKey) {
  const actualKey = Object.keys(environment).find((key) => key.toLowerCase() === expectedKey.toLowerCase());
  return actualKey === undefined ? undefined : environment[actualKey];
}

function windowsPowerShellExecutable(environment = process.env) {
  const systemRoot = environmentValue(environment, "SystemRoot") ?? environmentValue(environment, "WINDIR");
  if (typeof systemRoot !== "string" || !win32.isAbsolute(systemRoot)) {
    throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
  }
  return win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function captureDeploymentAuthority(rawStatus, token, nowMs, errorCode) {
  let status;
  try { status = validateFiveProviderCoordinatorStatus(rawStatus, nowMs); }
  catch { throw new Error("COORDINATION_STATE_INVALID"); }
  const lease = status.deployment;
  if (typeof token !== "string" || token.length === 0 || lease === null || lease.provider === "ROOT" ||
    lease.token !== token) throw new Error(errorCode);
  return { provider: lease.provider, token: lease.token };
}

async function recheckDeploymentAuthority(authority, dependencies, now, errorCode = "LIVE_DEPLOYMENT_LEASE_LOST") {
  const current = captureDeploymentAuthority(await dependencies.coordinatorStatus(), authority.token, now(), errorCode);
  if (current.provider !== authority.provider || current.token !== authority.token) throw new Error(errorCode);
  return current;
}

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
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
  const args = [];
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
    args.push(current);
    while (/\s/u.test(commandLine[index] ?? "")) index += 1;
  }
  return args;
}

function exactNodeEntrypoint(info, expectedPath, leadingOptionPattern = null) {
  const args = commandArguments(info.commandLine);
  if (!samePath(info.executablePath, process.execPath) || !samePath(args[0], process.execPath)) return false;
  let entrypointIndex = 1;
  if (leadingOptionPattern !== null && leadingOptionPattern.test(args[entrypointIndex] ?? "")) {
    entrypointIndex += 1;
  }
  return samePath(args[entrypointIndex], expectedPath);
}

function validObservedIdentity(value) {
  return value !== null && typeof value === "object" && positivePid(value.pid) &&
    Number.isSafeInteger(value.parentPid) && value.parentPid >= 0 &&
    typeof value.executablePath === "string" && typeof value.commandLine === "string" &&
    typeof value.birthMarker === "string" && value.birthMarker.length > 0;
}

function matchesRecordedIdentity(recorded, observed) {
  return validObservedIdentity(recorded) && validObservedIdentity(observed) &&
    recorded.pid === observed.pid && recorded.parentPid === observed.parentPid &&
    samePath(recorded.executablePath, observed.executablePath) &&
    recorded.commandLine === observed.commandLine && recorded.birthMarker === observed.birthMarker;
}

function sameRuntimeIdentity(left, right) {
  return validObservedIdentity(left) && validObservedIdentity(right) && left.pid === right.pid &&
    left.birthMarker === right.birthMarker;
}

function linuxStatFields(raw) {
  const close = raw.lastIndexOf(")");
  if (close < 0) return null;
  const fields = raw.slice(close + 1).trim().split(/\s+/u);
  const parentPid = Number(fields[1]);
  const startTicks = fields[19];
  return Number.isSafeInteger(parentPid) && parentPid >= 0 && typeof startTicks === "string"
    ? { parentPid, birthMarker: `linux:${startTicks}` } : null;
}

async function inspectWindowsProcess(pid) {
  const command = "$utf8 = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = $utf8; " +
    "$OutputEncoding = $utf8; " +
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; ` +
    "if ($null -ne $p) { [pscustomobject]@{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; " +
    "executablePath = [string]$p.ExecutablePath; commandLine = [string]$p.CommandLine; " +
    "birthMarker = $p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }";
  const { stdout } = await execFile(windowsPowerShellExecutable(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", timeout: 5_000, windowsHide: true });
  if (stdout.trim().length === 0) return null;
  try { return JSON.parse(stdout); } catch { return null; }
}

async function inspectLinuxProcess(pid) {
  const processRoot = `/proc/${pid}`;
  try {
    const [stat, commandBuffer, executablePath] = await Promise.all([
      readFile(`${processRoot}/stat`, "utf8"), readFile(`${processRoot}/cmdline`), readlink(`${processRoot}/exe`)
    ]);
    const fields = linuxStatFields(stat);
    if (fields === null) return null;
    const commandLine = commandBuffer.toString("utf8").split("\0").filter(Boolean)
      .map((argument) => `"${argument.replaceAll("\"", "\\\"")}"`).join(" ");
    return { pid, parentPid: fields.parentPid, executablePath, commandLine, birthMarker: fields.birthMarker };
  } catch { return null; }
}

async function linuxProcessOwner(pid) {
  try {
    const information = await stat(`/proc/${pid}`);
    return { exited: false, uid: Number.isSafeInteger(information.uid) ? information.uid : null };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return { exited: true, uid: null };
    return { exited: false, uid: null };
  }
}

function linuxOwnerProvenDifferent(owner) {
  const currentUid = process.getuid?.();
  return Number.isSafeInteger(currentUid) && Number.isSafeInteger(owner.uid) && owner.uid !== currentUid;
}

async function inspectPortableProcess(pid) {
  try {
    const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "ppid=", "-o", "lstart=", "-o", "command="],
      { encoding: "utf8", timeout: 5_000 });
    const line = stdout.trim();
    const match = /^(\d+)\s+(.{24})\s+(.+)$/u.exec(line);
    if (match === null) return null;
    const parentPid = Number(match[1]);
    const commandLine = match[3];
    const executablePath = commandArguments(commandLine)[0];
    return { pid, parentPid, executablePath, commandLine, birthMarker: `ps:${match[2]}` };
  } catch { return null; }
}

export async function inspectProcessIdentity(pid) {
  if (!positivePid(pid)) return null;
  if (process.platform === "win32") return inspectWindowsProcess(pid);
  if (process.platform === "linux") return inspectLinuxProcess(pid);
  return inspectPortableProcess(pid);
}

async function pidParents() {
  if (process.platform === "win32") {
    const command = "@(Get-CimInstance Win32_Process | ForEach-Object { " +
      "[pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId } }) | " +
      "ConvertTo-Json -Compress";
    const { stdout } = await execFile(windowsPowerShellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 10_000, windowsHide: true });
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  if (process.platform === "linux") {
    const names = await readdir("/proc");
    const entries = await Promise.all(names.filter((name) => /^\d+$/u.test(name)).map(async (name) => {
      const pid = Number(name);
      try {
        const fields = linuxStatFields(await readFile(`/proc/${pid}/stat`, "utf8"));
        return fields === null ? null : { pid, parentPid: fields.parentPid };
      } catch { return null; }
    }));
    return entries.filter((entry) => entry !== null);
  }
  const { stdout } = await execFile("ps", ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 10_000 });
  return stdout.trim().split(/\r?\n/u).map((line) => {
    const [pid, parentPid] = line.trim().split(/\s+/u).map(Number);
    return { pid, parentPid };
  }).filter((entry) => positivePid(entry.pid) && Number.isSafeInteger(entry.parentPid));
}

function descendantsOf(rootPid, entries) {
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (!included.has(entry.pid) && included.has(entry.parentPid)) {
        included.add(entry.pid);
        changed = true;
      }
    }
  }
  return [...included];
}

async function listProcessTree(rootPid) {
  const pids = descendantsOf(rootPid, await pidParents());
  const identities = await Promise.all(pids.map(inspectProcessIdentity));
  return identities.filter((entry) => entry !== null);
}

async function listLinuxInstanceProcesses(instanceId) {
  const marker = `TOOL_CHENH_STACK_INSTANCE_ID=${instanceId}`;
  const names = await readdir("/proc");
  const identities = await Promise.all(names.filter((name) => /^\d+$/u.test(name)).map(async (name) => {
    const pid = Number(name);
    const initial = await inspectLinuxProcess(pid);
    if (initial === null) {
      const owner = await linuxProcessOwner(pid);
      if (owner.exited || linuxOwnerProvenDifferent(owner)) return null;
      throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
    }
    let environment;
    try {
      environment = (await readFile(`/proc/${pid}/environ`)).toString("utf8").split("\0");
    } catch {
      const current = await inspectLinuxProcess(pid);
      if (current !== null && !sameRuntimeIdentity(initial, current)) {
        throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
      }
      if (current !== null) {
        const owner = await linuxProcessOwner(pid);
        if (owner.exited || linuxOwnerProvenDifferent(owner)) return null;
        throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
      }
      const owner = await linuxProcessOwner(pid);
      if (owner.exited || linuxOwnerProvenDifferent(owner)) return null;
      throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
    }
    const current = await inspectLinuxProcess(pid);
    if (current === null) {
      const owner = await linuxProcessOwner(pid);
      if (owner.exited || linuxOwnerProvenDifferent(owner)) return null;
      throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
    }
    if (!sameRuntimeIdentity(initial, current)) throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE");
    return environment.includes(marker) ? current : null;
  }));
  return identities.filter((entry) => entry !== null);
}

async function listWindowsInstanceProcesses(instanceId) {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "windows-stack-instance-processes.ps1");
  const discoveryEnvironment = environmentSubset(process.env, WINDOWS_DISCOVERY_ENVIRONMENT_KEYS);
  let stdout;
  try {
    ({ stdout } = await execFile(windowsPowerShellExecutable(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: { ...discoveryEnvironment, TOOL_CHENH_STACK_INSTANCE_QUERY: instanceId }
      }));
  } catch { throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE"); }
  if (stdout.trim().length === 0) return [];
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new Error("STACK_INSTANCE_DISCOVERY_UNAVAILABLE"); }
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function listPortableInstanceProcesses(instanceId) {
  const marker = `TOOL_CHENH_STACK_INSTANCE_ID=${instanceId}`;
  const { stdout } = await execFile("ps", ["eww", "-axo", "pid=,command="],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  const pids = stdout.split(/\r?\n/u).filter((line) => line.split(/\s+/u).includes(marker))
    .map((line) => Number(/^\s*(\d+)/u.exec(line)?.[1])).filter(positivePid);
  const identities = await Promise.all(pids.map(inspectProcessIdentity));
  return identities.filter((entry) => entry !== null);
}

export async function listStackInstanceProcesses(instanceId) {
  if (typeof instanceId !== "string" || !/^[A-Za-z0-9._-]{8,128}$/u.test(instanceId)) {
    throw new Error("STACK_INSTANCE_ID_INVALID");
  }
  if (process.platform === "win32") return listWindowsInstanceProcesses(instanceId);
  if (process.platform === "linux") return listLinuxInstanceProcesses(instanceId);
  return listPortableInstanceProcesses(instanceId);
}

async function portIsClear(host, port) {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") resolvePort(false);
      else rejectPort(error);
    });
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolvePort(true)));
  });
}

async function readJson(path, unavailableCode = "LIVE_STACK_STATE_UNAVAILABLE",
  invalidCode = "LIVE_STACK_STATE_INVALID") {
  let raw;
  try { raw = await readFile(path, "utf8"); }
  catch { throw new Error(unavailableCode); }
  try { return JSON.parse(raw); }
  catch { throw new Error(invalidCode); }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

function validLaunchIdentity(value) {
  return value !== null && typeof value === "object" &&
    typeof value.instanceId === "string" && /^[A-Za-z0-9._-]{8,128}$/u.test(value.instanceId) &&
    typeof value.shutdownToken === "string" && value.shutdownToken.length >= 16;
}

export function spawnLiveStackLauncher(repositoryRoot, launchIdentity, spawnImpl = spawn,
  sourceEnvironment = process.env) {
  if (!validLaunchIdentity(launchIdentity)) throw new Error("NEW_STACK_LAUNCH_IDENTITY_INVALID");
  const script = resolve(repositoryRoot, "scripts", "start-live-stack.mjs");
  const launcherEnvironment = environmentWithoutKeys(sourceEnvironment, STACK_CONTROL_ENVIRONMENT_KEYS);
  const child = spawnImpl(process.execPath, [script], {
    cwd: repositoryRoot,
    env: { ...launcherEnvironment, TOOL_CHENH_STACK_INSTANCE_ID: launchIdentity.instanceId,
      TOOL_CHENH_STACK_SHUTDOWN_TOKEN: launchIdentity.shutdownToken },
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  let launcherError = null;
  if (typeof child.once !== "function") throw new Error("LIVE_STACK_SPAWN_FAILED");
  child.once("error", (error) => { launcherError = error; });
  if (!positivePid(child.pid)) throw new Error("LIVE_STACK_SPAWN_FAILED");
  child.unref();
  return { pid: child.pid, ...launchIdentity, getError: () => launcherError };
}

function defaultDependencies(repositoryRoot) {
  const coordinationPath = resolve(repositoryRoot, ".run", "five-provider", "coordination.json");
  const statePath = resolve(repositoryRoot, ".auth", "run", "live-stack.json");
  const shutdownPath = resolve(repositoryRoot, ".auth", "run", "live-stack.shutdown.json");
  return {
    now: Date.now,
    sleep: delay,
    coordinatorStatus: () => readJson(coordinationPath, "COORDINATION_STATE_UNAVAILABLE",
      "COORDINATION_STATE_INVALID"),
    computeBuildIdentity,
    readStackState: () => readJson(statePath),
    inspectProcess: inspectProcessIdentity,
    listProcessTree,
    listInstanceProcesses: listStackInstanceProcesses,
    requestGracefulShutdown: (request) => writeJsonAtomic(shutdownPath, { version: 1, ...request }),
    isPortClear: portIsClear,
    removeStackState: (expected) => removeStackState(statePath, expected),
    createLaunchIdentity: () => ({ instanceId: randomUUID(), shutdownToken: randomUUID() }),
    spawnLauncher: ({ instanceId, shutdownToken }) => spawnLiveStackLauncher(repositoryRoot,
      { instanceId, shutdownToken }),
    fetch: (url) => globalThis.fetch(url, { signal: AbortSignal.timeout(1_000) })
  };
}

function launcherCommandMatches(info, repositoryRoot) {
  const expected = resolve(repositoryRoot, "scripts", "start-live-stack.mjs");
  const args = commandArguments(info.commandLine);
  return exactNodeEntrypoint(info, expected) && args.length === 2;
}

async function ownedStack(state, repositoryRoot, inspectProcess) {
  const { apiEntry, viteEntry } = resolveStackEntries(repositoryRoot);
  if (state?.version !== 2 || !samePath(state.worktreeRoot, repositoryRoot)) return null;
  const recorded = { launcher: state.launcher, api: state.api, web: state.web };
  const [launcher, api, web] = await Promise.all([
    inspectProcess(recorded.launcher.pid), inspectProcess(recorded.api.pid), inspectProcess(recorded.web.pid)
  ]);
  if (![launcher, api, web].every(validObservedIdentity)) return null;
  if (!matchesRecordedIdentity(recorded.launcher, launcher) ||
    !matchesRecordedIdentity(recorded.api, api) || !matchesRecordedIdentity(recorded.web, web)) return null;
  if (!launcherCommandMatches(launcher, repositoryRoot) || api.parentPid !== launcher.pid ||
    web.parentPid !== launcher.pid || !exactNodeEntrypoint(api, apiEntry, /^--max-old-space-size=\d+$/u) ||
    !exactNodeEntrypoint(web, viteEntry)) return null;
  return { launcher, api, web };
}

function boundedAttempts(timeoutMs, pollIntervalMs) {
  return Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollIntervalMs)) + 1);
}

function identityKey(identity) {
  return `${identity.pid}\0${identity.birthMarker}`;
}

function addTrackedIdentities(tracked, entries) {
  if (!Array.isArray(entries) || !entries.every(validObservedIdentity)) {
    throw new Error("STACK_PROCESS_TREE_NOT_PROVEN");
  }
  let newIdentities = 0;
  for (const entry of entries) {
    const key = identityKey(entry);
    if (!tracked.has(key)) newIdentities += 1;
    tracked.set(key, entry);
  }
  return newIdentities;
}

async function scanOwnedProcesses(root, instanceId, tracked, dependencies) {
  const treeEntries = root === null ? [] : await dependencies.listProcessTree(root.pid);
  const instanceEntries = await dependencies.listInstanceProcesses(instanceId);
  return {
    newIdentities: addTrackedIdentities(tracked, treeEntries) +
      addTrackedIdentities(tracked, instanceEntries),
    observedIdentities: treeEntries.length + instanceEntries.length
  };
}

async function initialProcessTree(state, stack, dependencies) {
  const tracked = new Map();
  const treeEntries = await dependencies.listProcessTree(stack.launcher.pid);
  const instanceEntries = await dependencies.listInstanceProcesses(state.instanceId);
  addTrackedIdentities(tracked, treeEntries);
  addTrackedIdentities(tracked, instanceEntries);
  for (const required of [stack.launcher, stack.api, stack.web]) {
    if (!tracked.has(identityKey(required))) throw new Error("STACK_PROCESS_TREE_NOT_PROVEN");
  }
  const marked = new Set(instanceEntries.map(identityKey));
  for (const required of [stack.api, stack.web]) {
    if (!marked.has(identityKey(required))) throw new Error("STACK_INSTANCE_MARKER_NOT_PROVEN");
  }
  return tracked;
}

async function waitForProcessTreeClear(root, instanceId, tracked, dependencies, attempts, pollIntervalMs) {
  let clearObservations = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const beforeInspection = await scanOwnedProcesses(root, instanceId, tracked, dependencies);
    if (beforeInspection.newIdentities > 0) clearObservations = 0;
    const expected = [...tracked.values()];
    const observed = await Promise.all(expected.map((entry) => dependencies.inspectProcess(entry.pid)));
    const exactProcessAlive = observed.some((entry, index) => sameRuntimeIdentity(expected[index], entry));
    const afterDeaths = exactProcessAlive ? { newIdentities: 0, observedIdentities: 0 }
      : await scanOwnedProcesses(root, instanceId, tracked, dependencies);
    if (afterDeaths.newIdentities > 0) clearObservations = 0;
    const [apiPortClear, webPortClear] = await Promise.all([
      dependencies.isPortClear("127.0.0.1", 4310), dependencies.isPortClear("127.0.0.1", 4311)
    ]);
    const stableClear = !exactProcessAlive && beforeInspection.observedIdentities === 0 &&
      afterDeaths.observedIdentities === 0 && apiPortClear && webPortClear;
    if (stableClear) {
      clearObservations += 1;
      if (clearObservations >= 2) return true;
    } else clearObservations = 0;
    if (attempt + 1 < attempts) await dependencies.sleep(pollIntervalMs);
  }
  return false;
}

function sameManagedState(left, right) {
  return left?.version === 2 && right?.version === 2 && left.instanceId === right.instanceId &&
    left.shutdownToken === right.shutdownToken && samePath(left.worktreeRoot, right.worktreeRoot) &&
    left.buildIdentity === right.buildIdentity && matchesRecordedIdentity(left.launcher, right.launcher) &&
    matchesRecordedIdentity(left.api, right.api) && matchesRecordedIdentity(left.web, right.web);
}

async function awaitNewStack(oldState, oldStack, launchIdentity, spawned, input, dependencies, attempts,
  pollIntervalMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (typeof spawned.getError === "function" && spawned.getError() !== null) {
      throw new Error("LIVE_STACK_SPAWN_FAILED");
    }
    let candidate = null;
    try { candidate = await dependencies.readStackState(); } catch { /* launcher has not published state yet */ }
    try { if (candidate !== null) validateStackState(candidate); } catch {
      throw new Error("NEW_STACK_STATE_INVALID");
    }
    const differentInstance = candidate?.version === 2 && candidate.instanceId !== oldState.instanceId &&
      candidate.instanceId === launchIdentity.instanceId && candidate.shutdownToken === launchIdentity.shutdownToken;
    const differentLauncher = differentInstance && !sameRuntimeIdentity(candidate.launcher, oldStack.launcher);
    if (differentLauncher && candidate.launcher?.pid === spawned.pid) {
      const owned = await ownedStack(candidate, input.repositoryRoot, dependencies.inspectProcess);
      if (owned !== null) return { state: candidate, stack: owned };
      throw new Error("NEW_STACK_OWNERSHIP_NOT_PROVEN");
    }
    if (attempt + 1 < attempts) await dependencies.sleep(pollIntervalMs);
  }
  throw new Error("NEW_STACK_IDENTITY_TIMEOUT");
}

async function proveNewStackIdentity(expected, input, dependencies) {
  let current;
  try { current = validateStackState(await dependencies.readStackState()); }
  catch { throw new Error("NEW_STACK_IDENTITY_CHANGED"); }
  if (!sameManagedState(current, expected.state)) throw new Error("NEW_STACK_IDENTITY_CHANGED");
  const stack = await ownedStack(current, input.repositoryRoot, dependencies.inspectProcess);
  if (stack === null || !matchesRecordedIdentity(stack.launcher, expected.stack.launcher) ||
    !matchesRecordedIdentity(stack.api, expected.stack.api) ||
    !matchesRecordedIdentity(stack.web, expected.stack.web)) throw new Error("NEW_STACK_IDENTITY_CHANGED");
  return stack;
}

async function waitForReadiness(expectedBuildIdentity, dependencies, attempts, pollIntervalMs) {
  const healthUrl = "http://127.0.0.1:4310/api/health";
  const webUrl = "http://127.0.0.1:4311/";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const [healthResponse, webResponse] = await Promise.all([
        dependencies.fetch(healthUrl), dependencies.fetch(webUrl)
      ]);
      if (healthResponse.ok) {
        const health = await healthResponse.json();
        const apiReady = ["ok", "degraded"].includes(health?.status) && health?.mode === "OBSERVE" &&
          health?.executionReady === false;
        if (apiReady && health.buildIdentity !== expectedBuildIdentity) {
          throw new Error("RUNTIME_BUILD_IDENTITY_MISMATCH");
        }
        if (apiReady && webResponse.ok) return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "RUNTIME_BUILD_IDENTITY_MISMATCH") throw error;
    }
    if (attempt + 1 < attempts) await dependencies.sleep(pollIntervalMs);
  }
  throw new Error("NEW_STACK_READINESS_TIMEOUT");
}

async function cleanupSpawnedStack(launchIdentity, spawnedLauncher, next, dependencies, attempts, pollIntervalMs) {
  const tracked = new Map();
  if (spawnedLauncher !== null) addTrackedIdentities(tracked, [spawnedLauncher]);
  if (next !== null) addTrackedIdentities(tracked, [next.stack.launcher, next.stack.api, next.stack.web]);
  await dependencies.requestGracefulShutdown({
    instanceId: launchIdentity.instanceId,
    shutdownToken: launchIdentity.shutdownToken
  });
  const root = next === null ? spawnedLauncher : next.stack.launcher;
  if (!await waitForProcessTreeClear(root, launchIdentity.instanceId, tracked, dependencies,
    attempts, pollIntervalMs)) {
    throw new Error("POSTSPAWN_CLEANUP_FAILED");
  }
  let rawState;
  try { rawState = await dependencies.readStackState(); }
  catch (error) {
    if (error instanceof Error && error.message === "LIVE_STACK_STATE_UNAVAILABLE") return;
    throw new Error("POSTSPAWN_CLEANUP_FAILED");
  }
  let current;
  try { current = validateStackState(rawState); }
  catch { throw new Error("POSTSPAWN_CLEANUP_FAILED"); }
  const exactSeededState = current.version === 2 && current.instanceId === launchIdentity.instanceId &&
    current.shutdownToken === launchIdentity.shutdownToken;
  if (!exactSeededState) return;
  if (typeof dependencies.removeStackState !== "function") throw new Error("POSTSPAWN_CLEANUP_FAILED");
  await dependencies.removeStackState(current);
}

export async function restartLiveStack(input, dependencies) {
  const now = dependencies.now ?? Date.now;
  const authority = captureDeploymentAuthority(await dependencies.coordinatorStatus(), input?.leaseToken, now(),
    "LIVE_DEPLOYMENT_LEASE_REQUIRED");
  const timeoutMs = input.timeoutMs ?? 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 100;
  const attempts = boundedAttempts(timeoutMs, pollIntervalMs);
  const buildIdentity = await dependencies.computeBuildIdentity(input.repositoryRoot);
  let state;
  try { state = validateStackState(await dependencies.readStackState()); }
  catch { throw new Error("LIVE_STACK_STATE_INVALID"); }
  if (state.version !== 2) throw new Error("LEGACY_STACK_REQUIRES_ROOT_HANDOFF");
  const stack = await ownedStack(state, input.repositoryRoot, dependencies.inspectProcess);
  if (stack === null) throw new Error("STACK_OWNERSHIP_NOT_PROVEN");
  const tracked = await initialProcessTree(state, stack, dependencies);
  await recheckDeploymentAuthority(authority, dependencies, now);
  await dependencies.requestGracefulShutdown({
    instanceId: state.instanceId,
    shutdownToken: state.shutdownToken
  });
  if (!await waitForProcessTreeClear(stack.launcher, state.instanceId, tracked, dependencies,
    attempts, pollIntervalMs)) {
    throw new Error("OLD_STACK_DID_NOT_CLEAR");
  }
  await recheckDeploymentAuthority(authority, dependencies, now);
  if (typeof dependencies.removeStackState === "function") await dependencies.removeStackState(state);
  const launchIdentity = dependencies.createLaunchIdentity();
  if (!validLaunchIdentity(launchIdentity)) throw new Error("NEW_STACK_LAUNCH_IDENTITY_INVALID");
  await recheckDeploymentAuthority(authority, dependencies, now);
  let spawned = null;
  let spawnedLauncher = null;
  let next = null;
  try {
    spawned = await dependencies.spawnLauncher({ repositoryRoot: input.repositoryRoot, ...launchIdentity });
    const observedLauncher = positivePid(spawned?.pid) ? await dependencies.inspectProcess(spawned.pid) : null;
    if (observedLauncher !== null) {
      if (!validObservedIdentity(observedLauncher) || observedLauncher.pid !== spawned.pid ||
        !launcherCommandMatches(observedLauncher, input.repositoryRoot)) {
        throw new Error("NEW_STACK_LAUNCHER_NOT_PROVEN");
      }
      spawnedLauncher = observedLauncher;
    }
    next = await awaitNewStack(state, stack, launchIdentity, spawned, input, dependencies, attempts, pollIntervalMs);
    if (next.state.buildIdentity !== buildIdentity) throw new Error("NEW_STACK_BUILD_IDENTITY_MISMATCH");
    await waitForReadiness(buildIdentity, dependencies, attempts, pollIntervalMs);
    await proveNewStackIdentity(next, input, dependencies);
    await recheckDeploymentAuthority(authority, dependencies, now);
    await proveNewStackIdentity(next, input, dependencies);
    await recheckDeploymentAuthority(authority, dependencies, now);
    return { instanceId: next.state.instanceId, buildIdentity };
  } catch (error) {
    try { await cleanupSpawnedStack(launchIdentity, spawnedLauncher, next, dependencies, attempts, pollIntervalMs); }
    catch (cleanupError) {
      throw new Error("POSTSPAWN_CLEANUP_FAILED", { cause: { error, cleanupError } });
    }
    throw error;
  }
}

export async function runRestartCli(args, options = {}) {
  if (!Array.isArray(args) || args.length !== 0) throw new Error("INVALID_ARGUMENTS");
  const tokenEnvironment = options.env ?? process.env;
  const token = environmentValue(tokenEnvironment, "TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN");
  if (typeof token !== "string" || token.trim().length === 0) throw new Error("LIVE_DEPLOYMENT_LEASE_REQUIRED");
  const repositoryRoot = options.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const restart = options.restart ?? ((input) => restartLiveStack(input,
    options.dependencies ?? defaultDependencies(repositoryRoot)));
  return restart({ leaseToken: token.trim(), repositoryRoot });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRestartCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`[live-stack] restarted ${result.instanceId} (${result.buildIdentity}).\n`);
  }).catch((error) => {
    process.stderr.write(`[live-stack] restart failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
