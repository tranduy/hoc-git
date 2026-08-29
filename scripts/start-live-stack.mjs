import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForFixtureStack } from "./fixture-stack-readiness.mjs";
import { stopManagedChildren } from "./managed-stack.mjs";
import { createChildSupervisor } from "./child-respawn.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";
import { cleanupStaleStack, createManagedStackState, removeStackState, writeStackState } from "./stack-state.mjs";
import { ensureChromeBridgeKey } from "./chrome-bridge-key.mjs";
import { resolveApiNodeArgs, resolveLiveStackEnvironment } from "./live-stack-config.mjs";
import { enforceToolResourceRetention } from "./resource-retention.mjs";
import { resolveLocalAppData } from "./local-app-data.mjs";
import { computeBuildIdentity } from "./five-provider-coordinator.mjs";
import { inspectProcessIdentity } from "./restart-live-stack.mjs";

const host = "127.0.0.1";
const apiPort = 4310;
const webPort = 4311;
const STACK_AUTHORITY_ENVIRONMENT_KEYS = new Set([
  "tool_chenh_deployment_lease_token",
  "tool_chenh_stack_instance_query",
  "tool_chenh_stack_shutdown_token"
]);

function purgeStackAuthority(environment) {
  for (const key of Object.keys(environment)) {
    if (STACK_AUTHORITY_ENVIRONMENT_KEYS.has(key.toLowerCase())) delete environment[key];
  }
}

function launchIdentity(environment, createUuid) {
  const instanceId = environment.TOOL_CHENH_STACK_INSTANCE_ID?.trim();
  const shutdownToken = environment.TOOL_CHENH_STACK_SHUTDOWN_TOKEN?.trim();
  if (instanceId === undefined && shutdownToken === undefined) {
    return { instanceId: createUuid(), shutdownToken: createUuid() };
  }
  if (typeof instanceId !== "string" || !/^[A-Za-z0-9._-]{8,128}$/u.test(instanceId) ||
    typeof shutdownToken !== "string" || shutdownToken.length < 16) {
    throw new Error("STACK_LAUNCH_IDENTITY_INVALID");
  }
  return { instanceId, shutdownToken };
}

function matchesLaunchShutdownRequest(identity, request) {
  return request !== null && typeof request === "object" && !Array.isArray(request) &&
    Object.keys(request).sort().join("\0") === ["instanceId", "shutdownToken", "version"].sort().join("\0") &&
    request.version === 1 && request.instanceId === identity.instanceId &&
    request.shutdownToken === identity.shutdownToken;
}

function startDependencies(overrides = {}) {
  return {
    cleanupStaleStack,
    existsSync,
    loadEnvFile: (path) => process.loadEnvFile(path),
    ensureChromeBridgeKey,
    readFile,
    resolveLocalAppData,
    enforceToolResourceRetention,
    computeBuildIdentity,
    createUuid: randomUUID,
    spawn,
    inspectProcessIdentity,
    createManagedStackState,
    writeStackState,
    removeStackState,
    stopManagedChildren,
    waitForFixtureStack,
    setInterval,
    clearInterval,
    registerSignal: (signal, listener) => process.once(signal, listener),
    stdout: process.stdout,
    stderr: process.stderr,
    setExitCode: (code) => { process.exitCode = code; },
    ...overrides
  };
}

export async function startLiveStack(options = {}) {
  const dependencies = startDependencies(options.dependencies);
  const repositoryRoot = options.repositoryRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const environmentSource = options.environment ?? process.env;
  const statePath = resolve(repositoryRoot, ".auth", "run", "live-stack.json");
  const shutdownPath = resolve(repositoryRoot, ".auth", "run", "live-stack.shutdown.json");

  try {
    await dependencies.cleanupStaleStack(statePath);
  } catch (error) {
    if (error instanceof Error && error.message === "LIVE_STACK_ALREADY_RUNNING") {
      dependencies.stdout.write("[live-stack] already running: http://127.0.0.1:4311/football-live\n");
      return { alreadyRunning: true };
    }
    throw error;
  }

  const localEnvFile = resolve(repositoryRoot, ".env");
  const identity = launchIdentity(environmentSource, dependencies.createUuid);
  if (dependencies.existsSync(localEnvFile)) dependencies.loadEnvFile(localEnvFile);
  purgeStackAuthority(environmentSource);
  if (environmentSource !== process.env) purgeStackAuthority(process.env);
  const { apiEntry, viteEntry, webRoot } = resolveStackEntries(repositoryRoot);
  const children = [];
  const supervisors = [];
  let respawnArmed = false;
  let managedState = null;
  let stopping = false;
  let readingShutdownRequest = false;
  let shutdownTimer = null;
  let retentionTimer = null;
  let statePublication = null;
  let shutdownPromise = null;

  async function shutdown(exitCode) {
    if (shutdownPromise !== null) return shutdownPromise;
    stopping = true;
    for (const supervisor of supervisors) supervisor.stop();
    if (retentionTimer !== null) dependencies.clearInterval(retentionTimer);
    if (shutdownTimer !== null) dependencies.clearInterval(shutdownTimer);
    shutdownPromise = (async () => {
      let childrenStopping;
      let childrenStoppingError = null;
      try {
        childrenStopping = Promise.resolve(dependencies.stopManagedChildren(children))
          .catch((error) => { childrenStoppingError = error; });
      } catch (error) {
        childrenStoppingError = error;
        childrenStopping = Promise.resolve();
      }
      // A child can fail while writeStackState is returning its promise. Yield
      // once so the publication reference is installed before deciding whether
      // exact-instance state exists and must be removed.
      await Promise.resolve();
      if (statePublication !== null) await statePublication.catch(() => undefined);
      await childrenStopping;
      if (childrenStoppingError !== null) {
        dependencies.stderr.write("[live-stack] managed child shutdown did not complete safely.\n");
        dependencies.setExitCode(1);
        return;
      }
      if (managedState !== null) {
        try { await dependencies.removeStackState(statePath, managedState); }
        catch {
          dependencies.stderr.write("[live-stack] state changed before exact-instance removal.\n");
          dependencies.setExitCode(1);
          return;
        }
      }
      dependencies.setExitCode(exitCode);
    })();
    return shutdownPromise;
  }

  async function checkShutdownRequest() {
    if (readingShutdownRequest || stopping) return;
    readingShutdownRequest = true;
    try {
      const request = JSON.parse(await dependencies.readFile(shutdownPath, "utf8"));
      if (matchesLaunchShutdownRequest(identity, request)) await shutdown(0);
    } catch {
      // An absent, partial, or differently addressed request cannot stop this instance.
    } finally { readingShutdownRequest = false; }
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    dependencies.registerSignal(signal, () => void shutdown(0));
  }

  shutdownTimer = dependencies.setInterval(() => { void checkShutdownRequest(); }, 250);
  shutdownTimer.unref?.();
  await checkShutdownRequest();
  if (stopping) return { stopped: true };

  const chromeBridgeKey = environmentSource.CHROME_BRIDGE_KEY?.trim() ||
    await dependencies.ensureChromeBridgeKey(resolve(repositoryRoot, ".auth", "chrome-bridge.key"));
  if (stopping) return { stopped: true };
  const localAppData = dependencies.resolveLocalAppData();
  if (localAppData === null) throw new Error("LOCAL_APP_DATA_REQUIRED");
  const localToolRoot = resolve(localAppData, "tool-chenh");
  const retention = await dependencies.enforceToolResourceRetention({ repositoryRoot, localToolRoot });
  if (stopping) return { stopped: true };
  if (retention.removedFiles > 0) {
    dependencies.stdout.write(`[live-stack] resource cleanup removed ${retention.removedFiles} item(s), ` +
      `reclaimed ${Math.round(retention.reclaimedBytes / 1024 / 1024)} MB.\n`);
  }
  retentionTimer = dependencies.setInterval(() => {
    void dependencies.enforceToolResourceRetention({ repositoryRoot, localToolRoot }).catch(() => {
      // Retention is best-effort and must never interrupt live ingestion.
    });
  }, 15 * 60 * 1_000);
  retentionTimer.unref?.();

  for (const entry of [apiEntry, viteEntry]) {
    if (!dependencies.existsSync(entry)) throw new Error(`Missing built entrypoint: ${entry}`);
  }
  const buildIdentity = await dependencies.computeBuildIdentity(repositoryRoot);
  if (stopping) return { stopped: true };
  const childEnvironment = {
    ...resolveLiveStackEnvironment(environmentSource, host, webPort),
    LOCALAPPDATA: localAppData,
    CHROME_BRIDGE_KEY: chromeBridgeKey,
    CHROME_BRIDGE_CAPTURE: environmentSource.CHROME_BRIDGE_CAPTURE ?? "0",
    TOOL_CHENH_BUILD_IDENTITY: buildIdentity,
    TOOL_CHENH_STACK_INSTANCE_ID: identity.instanceId
  };
  purgeStackAuthority(childEnvironment);

  const spawnApi = () => dependencies.spawn(process.execPath,
    [...resolveApiNodeArgs(environmentSource), apiEntry], {
      cwd: repositoryRoot,
      env: childEnvironment,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      windowsHide: true
    });
  const spawnWeb = () => dependencies.spawn(process.execPath,
    [viteEntry, "--host", host, "--port", String(webPort), "--strictPort"], {
      cwd: webRoot,
      env: childEnvironment,
      stdio: "inherit",
      windowsHide: true
    });
  // After a respawn the state file still records the dead child's process
  // identity; republish it for the replacement so restart/cleanup tooling
  // keeps matching the exact running processes. Fail closed if another
  // instance changed the state underneath us.
  async function republishChildIdentity(entry) {
    if (managedState === null) return;
    const replacement = await dependencies.inspectProcessIdentity(entry.child.pid);
    const nextState = dependencies.createManagedStackState({ ...managedState,
      [entry.name]: replacement });
    await dependencies.removeStackState(statePath, managedState);
    await dependencies.writeStackState(statePath, nextState);
    managedState = nextState;
  }
  function supervise(entry, respawn) {
    const supervisor = createChildSupervisor({
      name: entry.name,
      respawn,
      onRespawned: (respawned) => republishChildIdentity(respawned),
      onPermanentFailure: (code) => stopping ? undefined : shutdown(code),
      output: dependencies.stderr,
      shouldIgnore: () => stopping,
      isArmed: () => respawnArmed,
      now: options.dependencies?.now,
      schedule: options.dependencies?.scheduleRespawn,
      cancel: options.dependencies?.cancelRespawn
    });
    supervisors.push(supervisor);
    supervisor.attach(entry);
  }

  let api;
  let web;
  try {
    api = spawnApi();
    const apiChild = { name: "api", child: api, gracefulIpc: true };
    children.push(apiChild);
    supervise(apiChild, spawnApi);

    web = spawnWeb();
    const webChild = { name: "web", child: web, gracefulIpc: false };
    children.push(webChild);
    supervise(webChild, spawnWeb);
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  try {
    const [launcherIdentity, apiIdentity, webIdentity] = await Promise.all([
      dependencies.inspectProcessIdentity(process.pid), dependencies.inspectProcessIdentity(api.pid),
      dependencies.inspectProcessIdentity(web.pid)
    ]);
    if (stopping) {
      await shutdownPromise;
      return { stopped: true };
    }
    managedState = dependencies.createManagedStackState({ instanceId: identity.instanceId,
      shutdownToken: identity.shutdownToken, worktreeRoot: repositoryRoot, buildIdentity,
      launcher: launcherIdentity, api: apiIdentity, web: webIdentity });
    statePublication = dependencies.writeStackState(statePath, managedState);
    await statePublication;
    if (stopping) {
      await shutdownPromise;
      return { stopped: true };
    }
    statePublication = null;
  } catch (error) {
    await shutdown(1);
    throw error;
  }

  try {
    await dependencies.waitForFixtureStack({
      children: children.map(({ child }) => child),
      apiHealthUrl: `http://${host}:${apiPort}/api/health`,
      webUrl: `http://${host}:${webPort}/`,
      acceptDegraded: true,
      timeoutMs: 60_000
    });
    dependencies.stdout.write(`[live-stack] ready: http://${host}:${webPort}/football-live\n`);
    respawnArmed = true;
  } catch (error) {
    dependencies.stderr.write(`[live-stack] ${error instanceof Error ? error.message : String(error)}\n`);
    await shutdown(1);
  }
  return { instanceId: identity.instanceId, buildIdentity };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLiveStack().catch((error) => {
    process.stderr.write(`[live-stack] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
