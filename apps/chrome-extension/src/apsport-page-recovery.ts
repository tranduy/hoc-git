export interface ApsportPageHealth {
  readonly sourceId: string;
  readonly tabId: number;
  readonly rosterCount: number;
  readonly matchRows: number;
}

interface ApsportPageRecoveryWatchdogOptions {
  readonly reload: (tabId: number) => Promise<void>;
  readonly now?: () => number;
  readonly retryMs?: number;
}

export class ApsportPageRecoveryWatchdog {
  readonly #options: ApsportPageRecoveryWatchdogOptions;
  readonly #now: () => number;
  readonly #retryMs: number;
  #sourceId: string | null = null;
  #consecutiveEmptySamples = 0;
  #lastAttemptAtMs: number | null = null;

  constructor(options: ApsportPageRecoveryWatchdogOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#retryMs = options.retryMs ?? 5 * 60_000;
  }

  async observe(health: ApsportPageHealth): Promise<void> {
    if (health.sourceId !== this.#sourceId) {
      this.#sourceId = health.sourceId;
      this.#consecutiveEmptySamples = 0;
      this.#lastAttemptAtMs = null;
    }
    if (health.rosterCount <= 0 || health.matchRows < 0) {
      this.#consecutiveEmptySamples = 0;
      return;
    }
    if (health.matchRows > 0) {
      this.#consecutiveEmptySamples = 0;
      this.#lastAttemptAtMs = null;
      return;
    }
    this.#consecutiveEmptySamples += 1;
    const nowMs = this.#now();
    if (this.#consecutiveEmptySamples < 3 ||
      (this.#lastAttemptAtMs !== null && nowMs - this.#lastAttemptAtMs < this.#retryMs)) return;
    this.#lastAttemptAtMs = nowMs;
    await this.#options.reload(health.tabId);
  }
}
