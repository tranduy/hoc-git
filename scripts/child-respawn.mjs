const RESPAWN_DEFAULTS = Object.freeze({
  maxRestarts: 5,
  windowMs: 600_000,
  backoffBaseMs: 1_000,
  backoffCapMs: 30_000
});

/**
 * Keeps one managed stack child alive. An unexpected exit or spawn error
 * respawns the child with bounded exponential backoff instead of tearing the
 * whole stack down; only a child that keeps dying (more than `maxRestarts`
 * failures inside `windowMs`) escalates to `onPermanentFailure`, which keeps
 * the old fail-closed behaviour for genuinely broken builds. Deliberate
 * shutdowns are excluded through `shouldIgnore`, exactly like the previous
 * one-shot failure handlers.
 */
export function createChildSupervisor(options) {
  const { name, respawn, onRespawned, onPermanentFailure, output, shouldIgnore } = options;
  // Before the stack is armed (state published, readiness confirmed) a child
  // failure keeps the historical fail-fast behaviour: a build that cannot
  // boot once will not be fixed by respawning it in a loop.
  const isArmed = options.isArmed ?? (() => true);
  if (typeof name !== "string" || name.length === 0 || typeof respawn !== "function" ||
    typeof onPermanentFailure !== "function" || typeof output?.write !== "function" ||
    typeof shouldIgnore !== "function") {
    throw new Error("CHILD_SUPERVISOR_INVALID");
  }
  const maxRestarts = options.maxRestarts ?? RESPAWN_DEFAULTS.maxRestarts;
  const windowMs = options.windowMs ?? RESPAWN_DEFAULTS.windowMs;
  const backoffBaseMs = options.backoffBaseMs ?? RESPAWN_DEFAULTS.backoffBaseMs;
  const backoffCapMs = options.backoffCapMs ?? RESPAWN_DEFAULTS.backoffCapMs;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? clearTimeout;

  const failureAtMs = [];
  let pendingTimer = null;
  let stopped = false;

  function recordFailure() {
    const nowMs = now();
    failureAtMs.push(nowMs);
    while (failureAtMs.length > 0 && nowMs - failureAtMs[0] > windowMs) failureAtMs.shift();
    return failureAtMs.length;
  }

  function attach(entry) {
    const child = entry.child;
    const onceFailed = (describe, exitCode) => {
      if (stopped || shouldIgnore()) return;
      if (!isArmed()) {
        output.write(`[live-stack] ${name} ${describe} before the stack was ready.\n`);
        void onPermanentFailure(exitCode);
        return;
      }
      const failures = recordFailure();
      if (failures > maxRestarts) {
        output.write(`[live-stack] ${name} ${describe}; ${failures - 1} restarts in ` +
          `${Math.round(windowMs / 60_000)} minutes did not hold - stopping the stack.\n`);
        void onPermanentFailure(exitCode);
        return;
      }
      const delayMs = Math.min(backoffCapMs, backoffBaseMs * 2 ** (failures - 1));
      output.write(`[live-stack] ${name} ${describe}; restarting in ${Math.round(delayMs / 1000)}s ` +
        `(attempt ${failures}/${maxRestarts}).\n`);
      pendingTimer = schedule(() => {
        pendingTimer = null;
        if (stopped || shouldIgnore()) return;
        let replacement;
        try {
          replacement = respawn();
        } catch (error) {
          output.write(`[live-stack] ${name} respawn failed: ${error instanceof Error ? error.message : String(error)}\n`);
          onceFailed("could not be respawned", 1);
          return;
        }
        entry.child = replacement;
        attach(entry);
        Promise.resolve(onRespawned?.(entry)).catch((error) => {
          output.write(`[live-stack] ${name} restarted but its state could not be republished: ` +
            `${error instanceof Error ? error.message : String(error)}\n`);
          void onPermanentFailure(1);
        });
      }, delayMs);
      pendingTimer?.unref?.();
    };
    child.once("exit", (code, signal) => {
      const reason = signal === null || signal === undefined ? `code ${code ?? 1}` : `signal ${signal}`;
      onceFailed(`exited unexpectedly with ${reason}`, code === null || code === 0 ? 1 : code);
    });
    child.once("error", (error) => {
      onceFailed(`failed: ${error.message}`, 1);
    });
  }

  return {
    attach,
    stop() {
      stopped = true;
      if (pendingTimer !== null) {
        cancel(pendingTimer);
        pendingTimer = null;
      }
    }
  };
}
