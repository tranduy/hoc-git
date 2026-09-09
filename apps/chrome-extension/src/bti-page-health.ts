import { BTI_SOURCE_INVENTORY_EXPRESSION } from "./bti-source-inventory.js";

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
  let rosterCoverage = String(document.documentElement.dataset.fieldlineBtiRosterCoverage || '');
  try {
    if (rosterCoverage.length > 4096) rosterCoverage = '';
    else if (rosterCoverage) rosterCoverage = JSON.stringify({ ...JSON.parse(rosterCoverage),
      ...${BTI_SOURCE_INVENTORY_EXPRESSION} });
  } catch { rosterCoverage = ''; }
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
  if (btiRequestsPaused(health)) return "REFRESH";
  return health?.status === "AUTH_ERROR" && health.code === "1008" ? "RENEW" : "REFRESH";
}

function btiRequestsPaused(health: BtiPageHealthProbe | null): boolean {
  try { return JSON.parse(health?.rosterCoverage ?? "{}").requestPaused === true; }
  catch { return false; }
}

export type BtiSourceControlCommand = "RELOAD" | "RESTORE" | "ENSURE";
export type BtiSourceControlAction = "REFRESH_CURRENT" | "RENEW_CURRENT" |
  "RESTORE_DOCUMENT" | "ENSURE_LAUNCH";

export function btiSourceControlAction(command: BtiSourceControlCommand,
  health: BtiPageHealthProbe | null): BtiSourceControlAction {
  if (btiRequestsPaused(health)) return "REFRESH_CURRENT";
  if (command === "RESTORE") return "RESTORE_DOCUMENT";
  if (command === "ENSURE") return "ENSURE_LAUNCH";
  return btiHardRecoveryAction(health) === "RENEW" ? "RENEW_CURRENT" : "REFRESH_CURRENT";
}

function parseRosterCoverage(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  const allowed = ["phase", "liveLeagues", "prematchLeagues", "liveBatches", "prematchBatches",
    "earlyLeagues", "earlyBatches", "earlyDone",
    "liveDone", "prematchDone", "failed", "events", "namedEvents", "timedEvents", "marketEvents", "validEvents",
    "detailCachedEvents", "detailCachedBytes", "detailPendingEvents", "detailRosterEvents",
    "detailEmptyEvents", "detailFailedEvents", "detailEvictedEvents", "detailQueuedEvents",
    "detailInFlightEvents", "detailOldestReceiptAgeMs", "detailNearTtlMs", "detailDistantTtlMs",
    "detailDueEvents", "detailDeferredEvents", "detailRetainedEventCap", "detailQueueCap",
    "detailOverCapEvents", "requestStatus", "requestRetryInMs", "nativeRosterEvents", "nativePrematchEvents", "nativeLiveEvents",
    "nativeDetailEvents", "nativeMarketRows", "nativeSelectionRows", "nativeNumericIds", "nativeMalformedRows"];
  const booleans = ["detailCoverageComplete", "rosterRefreshFailed", "requestPaused", "authBlocked", "nativeInventoryTruncated", "nativeTypeCountsTruncated"];
  if (Object.keys(candidate).some((key) => ![...allowed, ...booleans, "nativeTypeCounts"].includes(key)) ||
    !["INITIAL", "HYDRATING", "COMPLETE", "FAILED"].includes(String(candidate.phase))) return null;
  if (booleans.some((key) => candidate[key] !== undefined && typeof candidate[key] !== "boolean")) return null;
  if (candidate.nativeTypeCounts !== undefined && (typeof candidate.nativeTypeCounts !== "string" ||
    candidate.nativeTypeCounts.length > 1024 ||
    !/^(?:[A-Z][A-Z0-9_]{0,23}:\d{1,6}(?:,[A-Z][A-Z0-9_]{0,23}:\d{1,6}){0,31})?$/u.test(candidate.nativeTypeCounts))) return null;
  for (const key of allowed.slice(1)) {
    if (key === "detailOldestReceiptAgeMs" && candidate[key] === null) continue;
    const maximum = key === "detailCachedBytes" ? 256 * 1024 * 1024
      : key === "detailOldestReceiptAgeMs" || key === "requestRetryInMs" ? Number.MAX_SAFE_INTEGER : 1_000_000;
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
    if (btiRequestsPaused(health)) return;
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
