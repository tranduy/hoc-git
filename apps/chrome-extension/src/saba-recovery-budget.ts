export interface SabaRecoveryBudgetState {
  readonly attempts: number;
  readonly nextAttemptAtMs: number;
}
interface Options {
  readonly now?: () => number;
  readonly load?: () => Promise<unknown>;
  readonly save?: (state: SabaRecoveryBudgetState) => Promise<void>;
}
export class SabaRecoveryBudget {
  readonly #now: () => number;
  readonly #options: Options;
  readonly #ready: Promise<void>;
  #state: SabaRecoveryBudgetState = { attempts: 0, nextAttemptAtMs: 0 };
  #admitting = false;

  constructor(options: Options = {}) {
    this.#options = options;
    const now = options.now ?? Date.now;
    this.#now = now;
    this.#ready = (async () => {
      if (options.load === undefined) return;
      try {
        const value = await options.load();
        if (value === undefined || value === null) return;
        if (!validState(value)) throw new Error("SABA_RECOVERY_STATE_INVALID");
        this.#state = { attempts: value.attempts, nextAttemptAtMs: value.nextAttemptAtMs };
      } catch {
        this.#state = { attempts: 3, nextAttemptAtMs: now() + 300_000 };
      }
    })();
  }

  async paused(): Promise<boolean> {
    await this.#ready;
    return this.#admitting || this.#now() < this.#state.nextAttemptAtMs;
  }

  async admit(): Promise<boolean> {
    await this.#ready;
    const now = this.#now();
    if (this.#admitting || now < this.#state.nextAttemptAtMs) return false;
    const attempts = this.#state.attempts >= 3 || now - this.#state.nextAttemptAtMs >= 300_000
      ? 1 : this.#state.attempts + 1;
    this.#state = { attempts, nextAttemptAtMs: now + (attempts === 3 ? 300_000 : 30_000) };
    this.#admitting = true;
    try {
      await this.#options.save?.(this.snapshot());
      return true;
    } catch {
      // No provider work unless its retry deadline survives a worker restart.
      return false;
    } finally { this.#admitting = false; }
  }

  snapshot(): SabaRecoveryBudgetState { return { ...this.#state }; }
}

function validState(value: unknown): value is SabaRecoveryBudgetState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Partial<SabaRecoveryBudgetState>;
  return Number.isSafeInteger(state.attempts) && state.attempts! >= 0 && state.attempts! <= 3 &&
    Number.isSafeInteger(state.nextAttemptAtMs) && state.nextAttemptAtMs! >= 0;
}
