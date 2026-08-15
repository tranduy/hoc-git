import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForFixtureStack } from "./fixture-stack-readiness.mjs";
import { stopManagedChildren } from "./managed-stack.mjs";
import { resolveStackEntries } from "./stack-paths.mjs";
import { cleanupStaleStack, removeStackState, writeStackState } from "./stack-state.mjs";
import { ensureChromeBridgeKey } from "./chrome-bridge-key.mjs";

const host = "127.0.0.1";
const apiPort = 4310;
const webPort = 4311;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

for (const entry of [apiEntry, viteEntry]) {
  if (!existsSync(entry)) throw new Error(`Missing built entrypoint: ${entry}`);
}

const environment = {
  ...process.env,
  NODE_ENV: "development",
  API_HOST: host,
  API_PORT: String(apiPort),
  VITE_ORIGIN: `http://${host}:${webPort}`,
  CHROME_BRIDGE_KEY: chromeBridgeKey,
  CHROME_BRIDGE_CAPTURE: process.env.CHROME_BRIDGE_CAPTURE ?? "0"
};
const api = spawn(process.execPath, [apiEntry], {
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
