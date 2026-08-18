import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const browserNames = new Set(["chrome.exe", "chromium.exe", "headless_shell.exe"]);

function isOwnedAutomationBrowser(process) {
  if (!browserNames.has(String(process.Name ?? "").toLowerCase())) return false;
  const commandLine = String(process.CommandLine ?? "").replaceAll("/", "\\").toLowerCase();
  return commandLine.includes("\\tool-chenh\\.auth\\browser-profiles\\") ||
    /\\tool-chenh(?:\\.worktrees\\[^\\]+)?\\\.run\\(?:chrome|chromium|playwright)[^\\]*/u.test(commandLine);
}

/**
 * Deliberately matches the private Playwright profile only.  The user's normal
 * Chrome profile is never eligible for termination.
 */
export async function cleanupAutomationBrowserProcesses(processes, terminate) {
  const owned = processes.filter(isOwnedAutomationBrowser)
    .map((process) => Number(process.ProcessId))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  for (const pid of owned) await terminate(pid);
  return owned;
}

export async function cleanupOrphanedAutomationBrowsers() {
  if (process.platform !== "win32") return [];
  let stdout;
  try {
    ({ stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','chromium.exe','headless_shell.exe') } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
    { windowsHide: true, maxBuffer: 1024 * 1024 }));
  } catch {
    return [];
  }
  let processes;
  try {
    const parsed = JSON.parse(stdout);
    processes = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed];
  } catch {
    return [];
  }
  return cleanupAutomationBrowserProcesses(processes, async (pid) => {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
      .catch(() => undefined);
  });
}
