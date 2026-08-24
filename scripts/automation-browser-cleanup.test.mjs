import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupAutomationBrowserProcesses } from "./automation-browser-cleanup.mjs";

test("removes only orphaned browsers using the private tool-chenh browser profile", async () => {
  const terminated = [];
  const removed = await cleanupAutomationBrowserProcesses([
    { ProcessId: 101, Name: "chrome.exe", CreationDate: "birth-101", CommandLine: "chrome --user-data-dir=C:\\Users\\HLC\\AppData\\Local\\tool-chenh\\.auth\\browser-profiles\\providers" },
    { ProcessId: 102, Name: "headless_shell.exe", CreationDate: "birth-102", CommandLine: "headless_shell --user-data-dir=C:\\Users\\HLC\\AppData\\Local\\tool-chenh\\.auth\\browser-profiles\\fabet" },
    { ProcessId: 103, Name: "chrome.exe", CreationDate: "birth-103", CommandLine: "chrome --user-data-dir=C:\\Users\\HLC\\AppData\\Local\\Google\\Chrome\\User Data" },
    { ProcessId: 104, Name: "node.exe", CreationDate: "birth-104", CommandLine: "node server.js" }
    ,{ ProcessId: 105, Name: "chromium.exe", CreationDate: "birth-105", CommandLine: "chromium --user-data-dir=F:\\0. PROJECT\\tool-chenh\\.worktrees\\arbitrage-foundation\\.run\\chrome-ui-verify" }
  ], async (identity) => { terminated.push(identity); });

  assert.deepEqual(removed, [
    { pid: 101, birthMarker: "birth-101" },
    { pid: 102, birthMarker: "birth-102" },
    { pid: 105, birthMarker: "birth-105" }
  ]);
  assert.deepEqual(terminated, removed);
});
