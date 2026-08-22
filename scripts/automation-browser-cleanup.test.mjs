import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupAutomationBrowserProcesses } from "./automation-browser-cleanup.mjs";

test("removes only orphaned browsers using the private tool-chenh browser profile", async () => {
  const terminated = [];
  const removed = await cleanupAutomationBrowserProcesses([
    { ProcessId: 101, Name: "chrome.exe", CommandLine: "chrome --user-data-dir=C:\\Users\\HLC\\AppData\\Local\\tool-chenh\\.auth\\browser-profiles\\providers" },
    { ProcessId: 102, Name: "headless_shell.exe", CommandLine: "headless_shell --user-data-dir=C:\\Users\\HLC\\AppData\\Local\\tool-chenh\\.auth\\browser-profiles\\fabet" },
    { ProcessId: 103, Name: "chrome.exe", CommandLine: "chrome --user-data-dir=C:\\Users\\HLC\\AppData\\Local\\Google\\Chrome\\User Data" },
    { ProcessId: 104, Name: "node.exe", CommandLine: "node server.js" }
    ,{ ProcessId: 105, Name: "chromium.exe", CommandLine: "chromium --user-data-dir=F:\\0. PROJECT\\tool-chenh\\.worktrees\\arbitrage-foundation\\.run\\chrome-ui-verify" }
  ], async (pid) => { terminated.push(pid); });

  assert.deepEqual(removed, [101, 102, 105]);
  assert.deepEqual(terminated, [101, 102, 105]);
});
