import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForFixtureStack } from "./fixture-stack-readiness.mjs";
import { stopManagedChildren } from "./managed-stack.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";
import { cleanupStaleStack, removeStackState, writeStackState } from "./stack-state.mjs";
import { ensureChromeBridgeKey } from "./chrome-bridge-key.mjs";
import { resolveApiNodeArgs, resolveLiveStackEnvironment } from "./live-stack-config.mjs";
import { cleanupOrphanedAutomationBrowsers } from "./automation-browser-cleanup.mjs";
import { enforceToolResourceRetention } from "./resource-retention.mjs";
import { resolveLocalAppData } from "./local-app-data.mjs";

const host = "127.0.0.1";
const apiPort = 4310;
const webPort = 4311;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnvFile = resolve(repositoryRoot, ".env");
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
const { apiEntry, viteEntry, webRoot } = resolveStackEntries(repositoryRoot);
const statePath = resolve(repositoryRoot, ".auth", "run", "live-stack.json");
const chromeBridgeKey = process.env.CHROME_BRIDGE_KEY?.trim() ||
  await ensureChromeBridgeKey(resolve(repositoryRoot, ".auth", "chrome-bridge.key"));

try {
  await cleanupStaleStack(statePath);
} catch (error) {
  if (error instanceof Error && error.message === "LIVE_STACK_ALREADY_RUNNING") {
    process.stdout.write("[live-stack] already running: http://127.0.0.1:4311/football-live\n");
    process.exit(0);
  }
  throw error;
}

// A previous forced shutdown can leave Playwright's private Chromium tree
// alive on Windows. Remove only those private profiles before creating a new
// stack; the user's regular Chrome browser is never touched.
await cleanupOrphanedAutomationBrowsers();
// Windows requires LOCALAPPDATA; macOS/Linux fall back to their own per-user
// data directory so the same launcher works on every operator machine.
const localAppData = resolveLocalAppData();
if (localAppData === null) throw new Error("LOCAL_APP_DATA_REQUIRED");
const localToolRoot = resolve(localAppData, "tool-chenh");
const retention = await enforceToolResourceRetention({ repositoryRoot, localToolRoot });
if (retention.removedFiles > 0) process.stdout.write(`[live-stack] resource cleanup removed ${retention.removedFiles} item(s), reclaimed ${Math.round(retention.reclaimedBytes / 1024 / 1024)} MB.\n`);
const retentionTimer = setInterval(() => {
  void enforceToolResourceRetention({ repositoryRoot, localToolRoot }).catch(() => {
    // Retention is best-effort and must never interrupt live ingestion.
  });
}, 15 * 60 * 1_000);
retentionTimer.unref();

for (const entry of [apiEntry, viteEntry]) {
  if (!existsSync(entry)) throw new Error(`Missing built entrypoint: ${entry}`);
}

const environment = {
  ...resolveLiveStackEnvironment(process.env, host, webPort),
  LOCALAPPDATA: localAppData,
  CHROME_BRIDGE_KEY: chromeBridgeKey,
  CHROME_BRIDGE_CAPTURE: process.env.CHROME_BRIDGE_CAPTURE ?? "0"
};
const api = spawn(process.execPath, [...resolveApiNodeArgs(process.env), apiEntry], {
  cwd: repositoryRoot,
  env: environment,
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  windowsHide: true
});
const web = spawn(process.execPath, [viteEntry, "--host", host, "--port", String(webPort), "--strictPort"], {
  cwd: webRoot,
  env: environment,
  stdio: "inherit",
  windowsHide: true
});
const children = [
  { name: "api", child: api, gracefulIpc: true },
  { name: "web", child: web, gracefulIpc: false }
];
await writeStackState(statePath, { launcherPid: process.pid, apiPid: api.pid, webPid: web.pid });
let stopping = false;

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  clearInterval(retentionTimer);
  await stopManagedChildren(children);
  await removeStackState(statePath);
  process.exitCode = exitCode;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void shutdown(0));
}
for (const entry of children) {
  entry.child.once("exit", (code, signal) => {
    if (stopping) return;
    const reason = signal === null ? `code ${code ?? 1}` : `signal ${signal}`;
    process.stderr.write(`[live-stack] ${entry.name} exited unexpectedly with ${reason}.\n`);
    void shutdown(code === null || code === 0 ? 1 : code);
  });
  entry.child.once("error", (error) => {
    if (stopping) return;
    process.stderr.write(`[live-stack] ${entry.name} failed: ${error.message}\n`);
    void shutdown(1);
  });
}

try {
  await waitForFixtureStack({
    children: children.map(({ child }) => child),
    apiHealthUrl: `http://${host}:${apiPort}/api/health`,
    webUrl: `http://${host}:${webPort}/`,
    acceptDegraded: true,
    timeoutMs: 60_000
  });
  process.stdout.write(`[live-stack] ready: http://${host}:${webPort}/football-live\n`);
} catch (error) {
  process.stderr.write(`[live-stack] ${error instanceof Error ? error.message : String(error)}\n`);
  await shutdown(1);
}
