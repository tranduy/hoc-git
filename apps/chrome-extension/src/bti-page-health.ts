export type BtiPageHealthStatus = "HEALTHY" | "AUTH_ERROR" | "UNKNOWN";

export interface BtiPageHealthProbe {
  readonly status: BtiPageHealthStatus;
  readonly code: "1008" | null;
}

export interface BtiPageHealth extends BtiPageHealthProbe {
  readonly sourceId: string;
  readonly tabId: number;
}

export const BTI_PAGE_HEALTH_EXPRESSION = `(() => {
  if (document.readyState === 'loading' || !document.body) return { status: 'UNKNOWN', code: null };
  const text = String(document.body.innerText || document.body.textContent || '').slice(0, 20000)
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D')
    .toLowerCase().replace(/\\s+/g, ' ');
  const authFailure = /(?:^|\\D)1008(?:\\D|$)/u.test(text) &&
    /(?:dang nhap khong thanh cong|login (?:failed|unsuccessful)|authentication failed)/u.test(text);
  return authFailure ? { status: 'AUTH_ERROR', code: '1008' } :
    { status: text.length > 0 ? 'HEALTHY' : 'UNKNOWN', code: null };
})()`;

export function parseBtiPageHealthProbe(value: unknown): BtiPageHealthProbe | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "AUTH_ERROR" && candidate.code === "1008") {
    return { status: "AUTH_ERROR", code: "1008" };
  }
  if ((candidate.status === "HEALTHY" || candidate.status === "UNKNOWN") && candidate.code === null) {
    return { status: candidate.status, code: null };
  }
  return null;
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
