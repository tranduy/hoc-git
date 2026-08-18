import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanupStaleStack, writeStackState } from "./stack-state.mjs";

test("cleans exact orphaned child trees recorded by a dead launcher", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  const killed = [];
  try {
    await writeFile(statePath, JSON.stringify({ launcherPid: 10, apiPid: 11, webPid: 12 }));
    await cleanupStaleStack(statePath, {
      isAlive: (pid) => pid !== 10,
      forceKillTree: async (pid) => { killed.push(pid); }
    });
    assert.deepEqual(killed, [11, 12]);
    await assert.rejects(readFile(statePath), /ENOENT/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("refuses a duplicate stack while its recorded launcher is alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tool-chenh-stack-"));
  const statePath = join(directory, "live.json");
  try {
    await writeStackState(statePath, { launcherPid: 20, apiPid: 21, webPid: 22 });
    await assert.rejects(cleanupStaleStack(statePath, {
      isAlive: (pid) => pid === 20,
      forceKillTree: async () => undefined
    }), /LIVE_STACK_ALREADY_RUNNING/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
