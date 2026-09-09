export interface ImRefreshEvaluationDiagnostic {
  readonly target: "top" | "child";
  readonly status: string;
  readonly gateReason: "LOCK_HELD" | "COOLDOWN" | null;
  readonly retryInMs: number | null;
  readonly failureCount: number | null;
  readonly lastFailureAtMs: number | null;
  readonly failureStage: "SIGNATURE" | "NETWORK" | "BODY_READ" | null;
  readonly localFailureCount: number | null;
  /** How long the last failed request ran before it was given up on. */
  readonly elapsedMs: number | null;
  /** How long until its response head arrived, or null if none ever did. */
  readonly headAtMs: number | null;
}

/** Only bounded scalar request health crosses this diagnostic boundary. */
export function imRefreshDiagnostic(target: "top" | "child", status: string,
  coverage: Record<string, unknown>, nowMs: number): ImRefreshEvaluationDiagnostic {
  const nonnegative = (value: unknown): number | null => typeof value === "number" &&
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const failureAt = nonnegative(coverage.lastFailureAtMs);
  const capturedAt = nonnegative(coverage.diagnosticAtMs);
  const retryInMs = nonnegative(coverage.retryInMs);
  return { target, status, gateReason: coverage.gateReason === "LOCK_HELD" || coverage.gateReason === "COOLDOWN"
    ? coverage.gateReason : null,
  retryInMs: retryInMs !== null && capturedAt !== null && capturedAt <= nowMs
    ? Math.max(0, retryInMs - (nowMs - capturedAt)) : null,
  failureCount: nonnegative(coverage.failureCount),
  lastFailureAtMs: failureAt !== null && failureAt <= nowMs ? failureAt : null,
  failureStage: coverage.failureStage === "SIGNATURE" || coverage.failureStage === "NETWORK" || coverage.failureStage === "BODY_READ"
    ? coverage.failureStage : null,
  localFailureCount: nonnegative(coverage.localFailureCount),
  elapsedMs: nonnegative(coverage.elapsedMs),
  headAtMs: nonnegative(coverage.headAtMs) };
}
