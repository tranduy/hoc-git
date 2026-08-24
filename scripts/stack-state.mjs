import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BUILD_ID_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROCESS_KEYS = Object.freeze(["birthMarker", "commandLine", "executablePath", "parentPid", "pid"]);
const LEGACY_KEYS = Object.freeze(["apiPid", "launcherPid", "webPid"]);
const MANAGED_KEYS = Object.freeze([
  "api", "buildIdentity", "instanceId", "launcher", "shutdownToken", "version", "web", "worktreeRoot"
]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return plainObject(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function processIdentity(value) {
  return exactKeys(value, PROCESS_KEYS) && positivePid(value.pid) &&
    Number.isSafeInteger(value.parentPid) && value.parentPid >= 0 &&
    typeof value.executablePath === "string" && value.executablePath.length > 0 &&
    typeof value.commandLine === "string" && value.commandLine.length > 0 &&
    typeof value.birthMarker === "string" && value.birthMarker.length > 0;
}

function legacyStackState(value) {
  return exactKeys(value, LEGACY_KEYS) && positivePid(value.launcherPid) && positivePid(value.apiPid) &&
    positivePid(value.webPid) && new Set([value.launcherPid, value.apiPid, value.webPid]).size === 3;
}

function managedStackState(value) {
  return exactKeys(value, MANAGED_KEYS) && value.version === 2 &&
    typeof value.instanceId === "string" && value.instanceId.length >= 8 &&
    typeof value.shutdownToken === "string" && value.shutdownToken.length >= 16 &&
    typeof value.worktreeRoot === "string" && value.worktreeRoot.length > 0 &&
    typeof value.buildIdentity === "string" && BUILD_ID_PATTERN.test(value.buildIdentity) &&
    processIdentity(value.launcher) && processIdentity(value.api) && processIdentity(value.web) &&
    value.api.parentPid === value.launcher.pid && value.web.parentPid === value.launcher.pid &&
    new Set([value.launcher.pid, value.api.pid, value.web.pid]).size === 3;
}

export function validateStackState(value) {
  if (!legacyStackState(value) && !managedStackState(value)) throw new Error("LIVE_STACK_STATE_INVALID");
  return value;
}

function requireManagedStackState(value) {
  if (!managedStackState(value)) throw new Error("INVALID_MANAGED_STACK_STATE");
  return value;
}

export function createManagedStackState(input) {
  const state = { version: 2, instanceId: input?.instanceId, shutdownToken: input?.shutdownToken,
    worktreeRoot: input?.worktreeRoot, buildIdentity: input?.buildIdentity,
    launcher: input?.launcher, api: input?.api, web: input?.web };
  try { return requireManagedStackState(state); }
  catch { throw new Error("INVALID_MANAGED_STACK_STATE"); }
}

export function matchesStackShutdownRequest(state, request) {
  return managedStackState(state) && exactKeys(request, ["instanceId", "shutdownToken", "version"]) &&
    request.version === 1 && request.instanceId === state.instanceId &&
    request.shutdownToken === state.shutdownToken;
}

function ioDependencies(overrides = {}) {
  return { link, mkdir, readFile, rename, rm, writeFile, ...overrides };
}

export async function writeStackState(path, state, overrides = {}) {
  requireManagedStackState(state);
  const io = ioDependencies(overrides);
  await io.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await io.writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx" });
    await io.link(temporary, path);
  } finally {
    await io.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function sameProcessIdentity(left, right) {
  return processIdentity(left) && processIdentity(right) && PROCESS_KEYS.every((key) => left[key] === right[key]);
}

function sameStackState(left, right) {
  if (legacyStackState(left) && legacyStackState(right)) {
    return LEGACY_KEYS.every((key) => left[key] === right[key]);
  }
  return managedStackState(left) && managedStackState(right) && left.instanceId === right.instanceId &&
    left.shutdownToken === right.shutdownToken && left.worktreeRoot === right.worktreeRoot &&
    left.buildIdentity === right.buildIdentity && sameProcessIdentity(left.launcher, right.launcher) &&
    sameProcessIdentity(left.api, right.api) && sameProcessIdentity(left.web, right.web);
}

async function restoreQuarantine(io, quarantine, path) {
  try {
    await io.link(quarantine, path);
    await io.rm(quarantine, { force: true });
  } catch {
    // If another writer already published state, preserve both records and fail closed.
  }
}

export async function removeStackState(path, expected, overrides = {}) {
  requireManagedStackState(expected);
  const io = ioDependencies(overrides);
  let raw;
  try { raw = await io.readFile(path, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("LIVE_STACK_STATE_UNAVAILABLE");
  }
  let current;
  try { current = validateStackState(JSON.parse(raw)); }
  catch { throw new Error("LIVE_STACK_STATE_INVALID"); }
  if (!sameStackState(current, expected)) throw new Error("LIVE_STACK_STATE_CHANGED");

  const quarantine = `${path}.${process.pid}.${randomUUID()}.quarantine`;
  await io.rename(path, quarantine).catch(() => { throw new Error("LIVE_STACK_STATE_CHANGED"); });
  let quarantined;
  try { quarantined = validateStackState(JSON.parse(await io.readFile(quarantine, "utf8"))); }
  catch {
    await restoreQuarantine(io, quarantine, path);
    throw new Error("LIVE_STACK_STATE_CHANGED");
  }
  if (!sameStackState(quarantined, expected)) {
    await restoreQuarantine(io, quarantine, path);
    throw new Error("LIVE_STACK_STATE_CHANGED");
  }
  await io.rm(quarantine, { force: true });
}

export async function cleanupStaleStack(path, options = {}) {
  const io = ioDependencies(options.io);
  const isAlive = options.isAlive ?? ((pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  let raw;
  try { raw = await io.readFile(path, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("LIVE_STACK_STATE_UNAVAILABLE");
  }
  let state;
  try { state = validateStackState(JSON.parse(raw)); }
  catch { throw new Error("LIVE_STACK_STATE_INVALID"); }
  if (legacyStackState(state)) throw new Error("LEGACY_STACK_REQUIRES_ROOT_HANDOFF");
  const pids = [state.launcher.pid, state.api.pid, state.web.pid];
  if (isAlive(pids[0])) throw new Error("LIVE_STACK_ALREADY_RUNNING");
  throw new Error("STALE_STACK_REQUIRES_MANAGED_HANDOFF");
}
