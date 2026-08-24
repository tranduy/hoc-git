function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

export function attachManagedChildFailureHandlers(entries, onFailure, output = process.stderr,
  shouldIgnore = () => false) {
  if (!Array.isArray(entries) || typeof onFailure !== "function" || typeof output?.write !== "function") {
    throw new Error("MANAGED_CHILD_HANDLER_INVALID");
  }
  for (const entry of entries) {
    entry.child.once("exit", (code, signal) => {
      if (shouldIgnore()) return;
      const reason = signal === null ? `code ${code ?? 1}` : `signal ${signal}`;
      output.write(`[live-stack] ${entry.name} exited unexpectedly with ${reason}.\n`);
      void onFailure(code === null || code === 0 ? 1 : code);
    });
    entry.child.once("error", (error) => {
      if (shouldIgnore()) return;
      output.write(`[live-stack] ${entry.name} failed: ${error.message}\n`);
      void onFailure(1);
    });
  }
}

export async function stopManagedChildren(entries, options = {}) {
  const graceMs = options.graceMs ?? 10_000;
  const running = entries.filter(({ child }) => isRunning(child));
  await Promise.all(running.map(({ child, gracefulIpc }) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => finish(new Error("MANAGED_CHILD_SHUTDOWN_TIMEOUT")), graceMs);
    child.once("exit", () => finish());
    try {
      if (gracefulIpc && child.connected && typeof child.send === "function") {
        child.send({ type: "tool-chenh:shutdown" });
      } else if (typeof child.kill === "function") child.kill("SIGTERM");
      else finish(new Error("MANAGED_CHILD_SHUTDOWN_UNAVAILABLE"));
    } catch { finish(new Error("MANAGED_CHILD_SHUTDOWN_UNAVAILABLE")); }
    if (!isRunning(child)) finish();
  })));
}
