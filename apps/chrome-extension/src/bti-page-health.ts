export type BtiPageHealthStatus = "HEALTHY" | "AUTH_ERROR" | "UNKNOWN";

export interface BtiPageHealthProbe {
  readonly status: BtiPageHealthStatus;
  readonly code: "1008" | null;
  readonly rosterCoverage?: string;
}

export interface BtiPageHealth extends BtiPageHealthProbe {
  readonly sourceId: string;
  readonly tabId: number;
}

export const BTI_PAGE_HEALTH_EXPRESSION = `(() => {
  if (document.readyState === 'loading' || !document.body) return { status: 'UNKNOWN', code: null };
  const rosterCoverage = String(document.documentElement.dataset.fieldlineBtiRosterCoverage || '').slice(0, 400);
  const text = String(document.body.innerText || document.body.textContent || '').slice(0, 20000)
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D')
    .toLowerCase().replace(/\\s+/g, ' ');
  const authFailure = /(?:^|\\D)1008(?:\\D|$)/u.test(text) &&
    /(?:dang nhap khong thanh cong|login (?:failed|unsuccessful)|authentication failed)/u.test(text);
  const health = authFailure ? { status: 'AUTH_ERROR', code: '1008' } :
    { status: text.length > 0 ? 'HEALTHY' : 'UNKNOWN', code: null };
  return rosterCoverage ? { ...health, rosterCoverage } : health;
})()`;

export function parseBtiPageHealthProbe(value: unknown): BtiPageHealthProbe | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const rosterCoverage = parseRosterCoverage(candidate.rosterCoverage);
  if (candidate.rosterCoverage !== undefined && rosterCoverage === null) return null;
  if (candidate.status === "AUTH_ERROR" && candidate.code === "1008") {
    return { status: "AUTH_ERROR", code: "1008",
      ...(rosterCoverage === null ? {} : { rosterCoverage }) };
  }
  if ((candidate.status === "HEALTHY" || candidate.status === "UNKNOWN") && candidate.code === null) {
    return { status: candidate.status, code: null,
      ...(rosterCoverage === null ? {} : { rosterCoverage }) };
  }
  return null;
}

export function btiHardRecoveryAction(health: BtiPageHealthProbe | null): "REFRESH" | "RENEW" {
  return health?.status === "AUTH_ERROR" && health.code === "1008" ? "RENEW" : "REFRESH";
}

function parseRosterCoverage(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 400) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  const allowed = ["phase", "liveLeagues", "prematchLeagues", "liveBatches", "prematchBatches",
    "liveDone", "prematchDone", "failed", "events", "namedEvents", "timedEvents", "marketEvents", "validEvents",
    "detailCachedEvents", "detailCachedBytes", "detailPendingEvents"];
  if (Object.keys(candidate).some((key) => !allowed.includes(key)) ||
    !["INITIAL", "HYDRATING", "COMPLETE", "FAILED"].includes(String(candidate.phase))) return null;
  for (const key of allowed.slice(1)) {
    const maximum = key === "detailCachedBytes" ? 128 * 1024 * 1024 : 1_000_000;
    if (candidate[key] !== undefined && (!Number.isSafeInteger(candidate[key]) || Number(candidate[key]) < 0 ||
      Number(candidate[key]) > maximum)) return null;
  }
  return JSON.stringify(candidate);
}

interface BtiPageRecoveryWatchdogOptions {
  readonly reload: (source: { readonly sourceId: string; readonly tabId: number }) => Promise<void>;
  readonly now?: () => number;
  readonly retryMs?: number;
}

export class BtiPageRecoveryWatchdog {
  readonly #options: BtiPageRecoveryWatchdogOptions;
  readonly #now: () => number;
  readonly #retryMs: number;
  readonly #lastAttemptAtMs = new Map<string, number>();

  constructor(options: BtiPageRecoveryWatchdogOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#retryMs = options.retryMs ?? 5 * 60_000;
  }

  async observe(health: BtiPageHealth): Promise<void> {
    if (health.status === "HEALTHY") {
      this.#lastAttemptAtMs.delete(health.sourceId);
      return;
    }
    if (health.status !== "AUTH_ERROR") return;
    const nowMs = this.#now();
    const lastAttemptAtMs = this.#lastAttemptAtMs.get(health.sourceId);
    if (lastAttemptAtMs !== undefined && nowMs - lastAttemptAtMs < this.#retryMs) return;
    this.#lastAttemptAtMs.set(health.sourceId, nowMs);
    await this.#options.reload({ sourceId: health.sourceId, tabId: health.tabId });
  }
}
