export interface SbobetRequestBackoffState {
  readonly retryAtMs: number;
  readonly failureAtMs: number;
  readonly failures: number;
  readonly status: number;
}

interface Options {
  readonly now?: () => number;
  readonly load?: () => Promise<unknown>;
  readonly save?: (state: SbobetRequestBackoffState) => Promise<void>;
}

/** Shared admission for extension-owned SBO requests; passive native traffic is untouched. */
export class SbobetRequestBackoff {
  readonly #now: () => number;
  readonly #options: Options;
  #state: SbobetRequestBackoffState = { retryAtMs: 0, failureAtMs: 0, failures: 0, status: 0 };
  #loaded: boolean;
  readonly #ready: Promise<void>;
  #saving: Promise<void> = Promise.resolve();

  constructor(options: Options = {}) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#loaded = options.load === undefined;
    this.#ready = options.load === undefined ? Promise.resolve() : options.load().then(value => {
      if (validState(value)) this.#state = value;
    }, () => {
      this.#state = { retryAtMs: this.#now() + 30_000, failureAtMs: this.#now(), failures: 1, status: 0 };
    }).finally(() => { this.#loaded = true; });
  }

  ready(): Promise<void> { return this.#ready; }
  paused(): boolean { return !this.#loaded || this.#now() < this.#state.retryAtMs; }
  retryInMs(): number { return Math.max(0, this.#state.retryAtMs - this.#now()); }
  lastStatus(): number { return this.#state.status; }

  fail(status: number, retryAfterMs = 0): void {
    const now = this.#now();
    const failures = now < this.#state.retryAtMs ? this.#state.failures : Math.min(30, this.#state.failures + 1);
    const delay = status === 401 || status === 403 ? 900_000 : Math.min(300_000, 30_000 * 2 ** (failures - 1));
    const retry = Number.isSafeInteger(retryAfterMs) && retryAfterMs > 0 &&
      Number.isSafeInteger(now + retryAfterMs) ? retryAfterMs : 0;
    const retryAtMs = Math.max(this.#state.retryAtMs, now + Math.max(delay, retry));
    this.#state = { retryAtMs, failureAtMs: now, failures,
      status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0 };
    this.#persist();
  }

  succeeded(startedAtMs: number): void {
    if (this.#state.failures === 0 || startedAtMs < this.#state.retryAtMs ||
      startedAtMs <= this.#state.failureAtMs || this.paused()) return;
    this.#state = { retryAtMs: 0, failureAtMs: 0, failures: 0, status: 0 };
    this.#persist();
  }

  #persist(): void {
    const state = this.#state;
    this.#saving = this.#saving.then(() => this.#options.save?.(state)).catch(() => undefined);
  }
}

function validState(value: unknown): value is SbobetRequestBackoffState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return ["retryAtMs", "failureAtMs", "failures", "status"].every(key =>
    typeof state[key] === "number" && Number.isSafeInteger(state[key]) && state[key] >= 0) &&
    Number(state.failures) <= 30 && Number(state.status) <= 599;
}

/** Embedded in the verified page context. No provider URL/header value is returned. */
export function sbobetRetryAfterMs(value: unknown, nowMs = Date.now()): number {
  if (typeof value !== "string") return 0;
  const delay = /^\d+(?:\.\d+)?$/u.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - nowMs;
  return Number.isFinite(delay) && delay > 0 && Number.isSafeInteger(Math.ceil(nowMs + delay)) ? Math.ceil(delay) : 0;
}

export const SBOBET_RETRY_AFTER_EXPRESSION = `((value) => {
  if (typeof value !== 'string') return 0;
  const delay = /^\\d+(?:\\.\\d+)?$/u.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 && Number.isSafeInteger(Math.ceil(Date.now() + delay))
    ? Math.ceil(delay) : 0;
})`;
