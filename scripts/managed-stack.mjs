import { spawn } from "node:child_process";

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

export async function forceKillProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
    return;
  }
  try { process.kill(pid, "SIGKILL"); } catch { /* already stopped */ }
}

export async function stopManagedChildren(entries, options = {}) {
  const graceMs = options.graceMs ?? 10_000;
  const forceKillTree = options.forceKillTree ?? forceKillProcessTree;
  const running = entries.filter(({ child }) => isRunning(child));
  await Promise.all(running.map(({ child, gracefulIpc }) => new Promise((resolve) => {
    let settled = false;
    let forceTimer;
    let finalTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(finalTimer);
      resolve();
    };
    child.once("exit", finish);
    try {
      if (gracefulIpc && child.connected && typeof child.send === "function") {
        forceTimer = setTimeout(() => {
          void forceKillTree(child.pid).finally(() => {
            if (settled) return;
            finalTimer = setTimeout(finish, 1_000);
          });
        }, graceMs);
        child.send({ type: "tool-chenh:shutdown" });
      } else {
        void forceKillTree(child.pid).finally(() => {
          if (settled) return;
          finalTimer = setTimeout(finish, 1_000);
        });
      }
    } catch {
      void forceKillTree(child.pid).finally(finish);
    }
    if (!isRunning(child)) finish();
  })));
}
