export interface ImRefreshDiagnostic {
  readonly observedAtMs: number;
  readonly evaluations: readonly {
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
  }[];
}

const statuses = /^(?:catalog-requested|request-failed|request-timeout|collector-paused|native-auth-not-ready|rate-limited|token-unavailable|navigation-not-found|unavailable|gate-(?:lock-held|cooldown)|native-status-[0-9]{1,6}|http-status-(?:401|403|429)|failure-(?:signature|network|body-read|invalid-json|roster-shape|request-timeout|request-failed|native-auth-changed|native-auth-not-ready))$/u;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function parseImRefreshDiagnostic(value: unknown, envelopeAtMs: number): ImRefreshDiagnostic | null {
  if (!record(value)) return null;
  const observedAtMs = nonnegative(value.observedAtMs);
  if (observedAtMs === null || observedAtMs > envelopeAtMs || !Array.isArray(value.evaluations)) return null;
  const evaluations: ImRefreshDiagnostic["evaluations"][number][] = [];
  for (const entry of value.evaluations.slice(0, 32)) {
    if (!record(entry) || entry.target !== "top" && entry.target !== "child" ||
      typeof entry.status !== "string" || entry.status.length > 64 || !statuses.test(entry.status)) continue;
    const failureAt = nonnegative(entry.lastFailureAtMs);
    evaluations.push({ target: entry.target, status: entry.status,
      gateReason: entry.gateReason === "LOCK_HELD" || entry.gateReason === "COOLDOWN" ? entry.gateReason : null,
      retryInMs: nonnegative(entry.retryInMs), failureCount: nonnegative(entry.failureCount),
      lastFailureAtMs: failureAt !== null && failureAt <= observedAtMs ? failureAt : null,
      failureStage: entry.failureStage === "SIGNATURE" || entry.failureStage === "NETWORK" || entry.failureStage === "BODY_READ"
        ? entry.failureStage : null,
      localFailureCount: nonnegative(entry.localFailureCount),
      elapsedMs: nonnegative(entry.elapsedMs), headAtMs: nonnegative(entry.headAtMs) });
  }
  return { observedAtMs, evaluations };
}
