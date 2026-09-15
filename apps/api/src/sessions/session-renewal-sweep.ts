/**
 * Proactive session renewal, and nothing else.
 *
 * Two triggers were meant to keep sessions alive. The reactive one exists:
 * a provider read that comes back 401 or on a login page calls
 * reportProviderFailure. The proactive one - renew a session before its own
 * declared deadline passes - was never built, because the 03:00 maintenance job
 * happened to renew sessions on its way through a global reset.
 *
 * That job was removed on 2026-09-04 (69cdf30) for a good reason: its global
 * reset destroyed healthy provider sockets. Per-source recovery took over the
 * feed half. Nothing took over the session half. Measured 2026-09-15, twelve
 * days later: sixty-one sessions, zero usable, the Fabet parent 28.4 hours past
 * renewal, every preflight refused.
 *
 * So this sweep renews sessions and touches nothing else. It never restarts a
 * reader, never resets a source, never closes a socket. A live feed is not
 * evidence a session is healthy, and a dead session is not a reason to disturb
 * a feed that is working.
 */
import type { RedactedSessionStatus } from "@tool-chenh/contracts";

/**
 * Only the Fabet credential parent is renewed here. Its children hold derived
 * launch URLs rather than credentials, and renewing a child concurrently marks
 * it expired before the parent can preserve its verified identity - the
 * parent-first ordering session-manager already relies on.
 */
export function sessionsDueForRenewal(
  sessions: readonly RedactedSessionStatus[],
  nowMs: number
): readonly string[] {
  return sessions.filter((session) => {
    if (session.source !== "FABET_LOGIN" || session.provider !== "FABET") return false;
    // A renewal already in flight must not be started twice.
    if (session.state === "RENEWING") return false;
    if (session.state === "ACTIVE") {
      return session.renewAfterMs !== null && nowMs >= session.renewAfterMs;
    }
    if (session.state !== "INVALID" && session.state !== "ACTION_REQUIRED") return false;
    // Backoff is owned by session-recovery-policy, which writes nextRetryAtMs.
    // Honour it, so a book refusing our credentials is asked slowly.
    return session.nextRetryAtMs === null || nowMs >= session.nextRetryAtMs;
  }).map((session) => session.id);
}

export interface SessionRenewalSweepOptions {
  readonly list: () => Promise<readonly RedactedSessionStatus[]>;
  readonly renew: (id: string) => Promise<RedactedSessionStatus>;
  readonly record?: (level: "INFO" | "WARN" | "ERROR", message: string) => void;
  readonly clock?: { nowMs(): number };
  readonly intervalMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

export interface SessionRenewalSweep {
  runOnce(): Promise<number>;
  start(): void;
  stop(): void;
}

export function createSessionRenewalSweep(options: SessionRenewalSweepOptions): SessionRenewalSweep {
  const clock = options.clock ?? { nowMs: Date.now };
  const record = options.record ?? ((): void => {});
  const intervalMs = options.intervalMs ?? 300_000;
  const setTimer = options.setTimer ?? ((callback, delayMs) => {
    const timer = setInterval(callback, delayMs); timer.unref?.(); return timer;
  });
  // Backoff the sweep owns, because the path it calls does not set one.
  //
  // session-manager writes nextRetryAtMs when its own Fabet parent renewal
  // fails, but renew() does not, so a sweep that only honours nextRetryAtMs
  // retries at full cadence forever. Measured 2026-09-16: eight identical
  // "AUTH_EGRESS_UNAVAILABLE" entries in one hour, one every five minutes,
  // each one a login attempt that could not have succeeded.
  const failures = new Map<string, number>();
  const retryAfter = new Map<string, number>();
  const backoffMs = (count: number): number => Math.min(3_600_000, 300_000 * 2 ** (count - 1));
  const clearTimer = options.clearTimer ??
    ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>); });
  let timer: unknown = null;
  let inFlight: Promise<number> | null = null;

  const sweep = async (): Promise<number> => {
    const due = sessionsDueForRenewal(await options.list(), clock.nowMs());
    if (due.length === 0) return 0;
    let renewed = 0;
    for (const id of due) {
      const waitUntil = retryAfter.get(id);
      if (waitUntil !== undefined && clock.nowMs() < waitUntil) continue;
      // Sequential on purpose: concurrent Fabet logins race the same
      // credential source and the loser leaves a half-published launch set.
      try {
        const status = await options.renew(id);
        if (status.state === "ACTIVE") {
          renewed += 1;
          failures.delete(id);
          retryAfter.delete(id);
          record("INFO", "Đã gia hạn phiên quá hạn mà không khởi động lại reader nào");
        } else {
          // Silence here is what cost twelve days, so a refusal says so - but
          // it says so once per backoff window, not once per sweep.
          const count = (failures.get(id) ?? 0) + 1;
          failures.set(id, count);
          const delayMs = backoffMs(count);
          retryAfter.set(id, clock.nowMs() + delayMs);
          record("WARN", `Gia hạn phiên không thành: ${status.state}/${status.reason ?? "KHÔNG RÕ"}` +
            `; thử lại sau ${Math.round(delayMs / 60_000)} phút`);
        }
      } catch (error) {
        const count = (failures.get(id) ?? 0) + 1;
        failures.set(id, count);
        retryAfter.set(id, clock.nowMs() + backoffMs(count));
        record("ERROR", `Gia hạn phiên lỗi: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return renewed;
  };

  const runOnce = (): Promise<number> => {
    if (inFlight !== null) return inFlight;
    const operation = sweep().finally(() => { if (inFlight === operation) inFlight = null; });
    inFlight = operation;
    return operation;
  };

  return {
    runOnce,
    start(): void {
      if (timer !== null) return;
      timer = setTimer(() => { void runOnce(); }, intervalMs);
    },
    stop(): void {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    }
  };
}
