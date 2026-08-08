import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const loopbackHost = "127.0.0.1";
const apiPort = 4310;
const webPort = 4311;
const healthUrl = `http://${loopbackHost}:${apiPort}/api/health`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiEntry = join(repositoryRoot, "apps", "api", "dist", "server.js");
const viteEntry = join(repositoryRoot, "node_modules", "vite", "bin", "vite.js");
const webRoot = join(repositoryRoot, "apps", "web");

const inheritedEnvironmentKeys = process.platform === "win32"
  ? ["Path", "PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "TEMP", "TMP"]
  : ["PATH", "TMPDIR", "TEMP", "TMP"];

function fixtureEnvironment() {
  const environment = {};
  for (const key of inheritedEnvironmentKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return {
    ...environment,
    NODE_ENV: "development",
    API_HOST: loopbackHost,
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
    VITE_ORIGIN: `http://${loopbackHost}:${webPort}`,
    FIXTURE_REPLAY_SPEED: "1",
    FIXTURE_MODE: "1"
  };
}

function assertBuiltEntrypoints() {
  for (const path of [apiEntry, viteEntry]) {
    if (!existsSync(path)) {
      throw new Error(`Missing built fixture-stack dependency: ${path}. Run npm.cmd run build first.`);
    }
  }
}

function startChild(name, entry, args, cwd, environment) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env: environment,
    stdio: "inherit",
    windowsHide: true
  });
  child.fixtureName = name;
  return child;
}

async function waitForHealth(children, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null || child.signalCode !== null)) {
      throw new Error("A fixture-stack child exited before API health became ready.");
    }
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const body = await response.json();
        if (body?.status === "ok" && body?.mode === "OBSERVE" && body?.executionReady === false) return;
      }
    } catch {
      // Startup races are expected; the bounded loop retries them.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Fixture API did not become healthy at ${healthUrl} within ${timeoutMs} ms.`);
}

async function stopChildren(children, signal) {
  const running = children.filter((child) => child.exitCode === null && child.signalCode === null);
  await Promise.all(running.map((child) => new Promise((resolveExit) => {
    let finalTimeout;
    const finish = () => {
      clearTimeout(forceTimeout);
      clearTimeout(finalTimeout);
      resolveExit();
    };
    child.once("exit", finish);
    const forceTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      finalTimeout = setTimeout(finish, 1_000);
    }, 5_000);
    try {
      child.kill(signal);
    } catch {
      finish();
    }
    if (child.exitCode !== null || child.signalCode !== null) finish();
  })));
}

async function main() {
  assertBuiltEntrypoints();
  const environment = fixtureEnvironment();
  const children = [
    startChild("api", apiEntry, [], repositoryRoot, environment),
    startChild("web", viteEntry, ["--host", loopbackHost, "--port", String(webPort), "--strictPort"], webRoot, environment)
  ];
  let stopping = false;

  const shutdown = async (exitCode, signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    await stopChildren(children, signal);
    process.exitCode = exitCode;
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => void shutdown(0, signal));
  }
  for (const child of children) {
    child.once("exit", (code, signal) => {
      if (stopping) return;
      const reason = signal === null ? `code ${code ?? 1}` : `signal ${signal}`;
      process.stderr.write(`[fixture-stack] ${child.fixtureName} exited unexpectedly with ${reason}.\n`);
      void shutdown(code === null || code === 0 ? 1 : code);
    });
    child.once("error", (error) => {
      if (stopping) return;
      process.stderr.write(`[fixture-stack] ${child.fixtureName} failed: ${error.message}\n`);
      void shutdown(1);
    });
  }

  try {
    await waitForHealth(children);
    process.stdout.write(`[fixture-stack] ready: API ${healthUrl}; web http://${loopbackHost}:${webPort}\n`);
  } catch (error) {
    process.stderr.write(`[fixture-stack] ${error instanceof Error ? error.message : String(error)}\n`);
    await shutdown(1);
  }
}

void main().catch((error) => {
  process.stderr.write(`[fixture-stack] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
