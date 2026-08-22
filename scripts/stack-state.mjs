import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { forceKillProcessTree } from "./managed-stack.mjs";

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function writeStackState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state)}\n`, "utf8");
}

export async function removeStackState(path) {
  await rm(path, { force: true });
}

export async function cleanupStaleStack(path, options = {}) {
  const isAlive = options.isAlive ?? ((pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  });
  const forceKillTree = options.forceKillTree ?? forceKillProcessTree;
  let raw;
  try { raw = JSON.parse(await readFile(path, "utf8")); }
  catch { await removeStackState(path); return; }
  const launcherPid = positivePid(raw?.launcherPid);
  if (launcherPid !== null && isAlive(launcherPid)) throw new Error("LIVE_STACK_ALREADY_RUNNING");
  const childPids = [positivePid(raw?.apiPid), positivePid(raw?.webPid)]
    .filter((pid) => pid !== null);
  for (const pid of childPids) {
    if (isAlive(pid)) await forceKillTree(pid);
  }
  await removeStackState(path);
}
