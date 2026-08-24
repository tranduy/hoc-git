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
    .map((process) => ({ pid: Number(process.ProcessId),
      birthMarker: String(process.BirthMarker ?? process.CreationDate ?? "") }))
    .filter(({ pid, birthMarker }) => Number.isSafeInteger(pid) && pid > 0 && birthMarker.length > 0);
  for (const identity of owned) await terminate(identity);
  return owned;
}

async function terminateExactAutomationBrowser({ pid, birthMarker }) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[0-9TZ:.+\-]+$/u.test(birthMarker)) {
    throw new Error("AUTOMATION_BROWSER_IDENTITY_INVALID");
  }
  const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; ` +
    "if ($null -eq $p) { exit 0 }; " +
    "$birth = $p.CreationDate.ToUniversalTime().ToString('o'); " +
    `if ($birth -ne '${birthMarker}') { exit 9 }; ` +
    `Stop-Process -Id ${pid} -Force -ErrorAction Stop`;
  await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, maxBuffer: 64 * 1024 });
}

export async function cleanupOrphanedAutomationBrowsers() {
  if (process.platform !== "win32") return [];
  let stdout;
  try {
    ({ stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','chromium.exe','headless_shell.exe') } | ForEach-Object { [pscustomobject]@{ ProcessId = [int]$_.ProcessId; Name = [string]$_.Name; CommandLine = [string]$_.CommandLine; BirthMarker = $_.CreationDate.ToUniversalTime().ToString('o') } } | ConvertTo-Json -Compress"],
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
  return cleanupAutomationBrowserProcesses(processes, terminateExactAutomationBrowser);
}
