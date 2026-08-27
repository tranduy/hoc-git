/**
 * A pulse from the one place that outlives the service worker.
 *
 * Lobby tabs stay open for days; the worker behind them is collected after
 * seconds of idle. Sending a runtime message from a tab starts a stopped
 * worker, so this is a way back in that does not depend on anything inside the
 * worker still running - which the alarm, registered by the worker itself, does.
 *
 * It reads nothing from the page and sends no page data. The message carries a
 * kind and nothing else.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;
// A tab already open when the extension updates is injected directly, because
// a deployment must never navigate an authenticated sportsbook tab. That tab
// then also matches the declarative script on its next load, so the guard is
// what keeps one tab from accumulating a timer per injection.
const installed = globalThis as { __fieldlineHeartbeatInstalled?: boolean };

function beat(): boolean {
  // An extension reload invalidates this context while the tab keeps running
  // the old script. Reading the id first avoids throwing on every later beat.
  if (chrome.runtime?.id === undefined) return false;
  try {
    chrome.runtime.sendMessage({ kind: "LOBBY_HEARTBEAT" }, () => {
      // A worker that is still starting has no receiver yet. Reading the error
      // is what stops Chrome logging it; the next beat reaches the worker.
      void chrome.runtime.lastError;
    });
    return true;
  } catch {
    return false;
  }
}

if (installed.__fieldlineHeartbeatInstalled !== true) {
  installed.__fieldlineHeartbeatInstalled = true;
  beat();
  const timer = setInterval(() => { if (!beat()) clearInterval(timer); }, HEARTBEAT_INTERVAL_MS);
  // Chrome throttles timers in a background tab to about one a minute. Beating
  // on the way back to the foreground makes a tab the user has just looked at
  // the fastest way back rather than the slowest.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
}
