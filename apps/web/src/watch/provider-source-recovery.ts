import type { CatalogSourceStatus, ProviderId } from "@tool-chenh/contracts";

export type RecoverableProvider = Exclude<ProviderId, "FABET">;
export type ProviderRecoveryMode = "AUTO" | "MANUAL";
export type ProviderRecoveryCountdownKind = "INITIAL" | "VERIFY" | "RETRY";

export interface ProviderAutomaticRecoveryTiming {
  readonly verificationDeadlineMs: number;
  readonly retryAtMs: number;
}

export interface ProviderRecoverySnapshot {
  readonly phase: "IDLE" | "COUNTDOWN" | "RECOVERING" | "WAITING" | "MANUAL" | "BLOCKED";
  readonly countdownKind: ProviderRecoveryCountdownKind | null;
  readonly countdownSeconds: number | null;
  readonly automaticAttemptsRemaining: 0 | 1;
  readonly manualRetryAfterSeconds: number;
  readonly lastError: string | null;
}

interface ProviderSourceRecoveryOptions {
  readonly recover: (provider: RecoverableProvider, mode: ProviderRecoveryMode) => Promise<void>;
  readonly onChange?: () => void;
  readonly now?: () => number;
  readonly loadAutomaticAttemptsRemaining?: (provider: RecoverableProvider) => 0 | 1;
  readonly saveAutomaticAttemptsRemaining?: (provider: RecoverableProvider, remaining: 0 | 1) => void;
  readonly loadAutomaticTiming?: (provider: RecoverableProvider) => ProviderAutomaticRecoveryTiming | null;
  readonly saveAutomaticTiming?: (provider: RecoverableProvider,
    timing: ProviderAutomaticRecoveryTiming | null) => void;
  readonly loadManualRetryAtMs?: (provider: RecoverableProvider) => number;
  readonly saveManualRetryAtMs?: (provider: RecoverableProvider, deadlineMs: number) => void;
}

interface ProviderRecoveryState {
  phase: ProviderRecoverySnapshot["phase"];
  recoveryMode: ProviderRecoveryMode | null;
  automaticAttemptsRemaining: 0 | 1;
  automaticTiming: ProviderAutomaticRecoveryTiming | null;
  countdownKind: ProviderRecoveryCountdownKind | null;
  countdownDeadlineMs: number | null;
  manualReadyAtMs: number;
  lastError: string | null;
  outageGeneration: number;
  off: boolean;
  countdownTimer: ReturnType<typeof setTimeout> | null;
  countdownTicker: ReturnType<typeof setInterval> | null;
}

const AUTO_RECOVERY_DELAY_MS = 3_000;
const RECOVERY_CONFIRMATION_MS = 90_000;
const AUTO_RECOVERY_RETRY_MS = 300_000;
const MANUAL_RECOVERY_COOLDOWN_MS = 60_000;

export class ProviderSourceRecoveryCoordinator {
  readonly #options: ProviderSourceRecoveryOptions;
  readonly #states = new Map<RecoverableProvider, ProviderRecoveryState>();
  readonly #now: () => number;
  #disposed = false;

  constructor(options: ProviderSourceRecoveryOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  update(sources: readonly CatalogSourceStatus[]): void {
    if (this.#disposed) return;
    for (const source of sources) {
      const provider = source.provider as RecoverableProvider;
      const state = this.#state(provider);
      if (state.phase === "RECOVERING" && state.recoveryMode === "MANUAL") {
        state.off = source.sessionState !== "ACTIVE";
        continue;
      }
      if (source.sessionState === "ACTIVE") {
        this.#markActive(provider, state);
        continue;
      }
      if (source.reason !== "PROVIDER_VALIDATION_FAILED") {
        if (state.off && state.phase === "BLOCKED") continue;
        this.#clearCountdown(state);
        state.phase = "BLOCKED";
        state.recoveryMode = null;
        state.countdownKind = null;
        state.countdownDeadlineMs = null;
        state.lastError = null;
        state.off = true;
        state.outageGeneration += 1;
        this.#emit();
        continue;
      }
      if (state.off) {
        if (state.phase !== "BLOCKED") continue;
        state.outageGeneration += 1;
        this.#resumeAutomaticLifecycle(provider, state);
        this.#emit();
        continue;
      }
      state.off = true;
      state.outageGeneration += 1;
      this.#resumeAutomaticLifecycle(provider, state);
      this.#emit();
    }
  }

  snapshot(provider: RecoverableProvider): ProviderRecoverySnapshot {
    const state = this.#state(provider);
    const nowMs = this.#now();
    state.manualReadyAtMs = Math.max(state.manualReadyAtMs,
      this.#loadManualRetryAtMs(provider, state.manualReadyAtMs));
    return {
      phase: state.phase,
      countdownKind: state.countdownKind,
      countdownSeconds: state.countdownDeadlineMs === null ? null
        : Math.max(0, Math.ceil((state.countdownDeadlineMs - nowMs) / 1_000)),
      automaticAttemptsRemaining: state.automaticAttemptsRemaining,
      manualRetryAfterSeconds: Math.max(0, Math.ceil((state.manualReadyAtMs - nowMs) / 1_000)),
      lastError: state.lastError
    };
  }

  async manual(provider: RecoverableProvider): Promise<boolean> {
    if (this.#disposed) return false;
    const state = this.#state(provider);
    const nowMs = this.#now();
    state.manualReadyAtMs = Math.max(state.manualReadyAtMs,
      this.#loadManualRetryAtMs(provider, state.manualReadyAtMs));
    if (state.phase === "RECOVERING" || state.phase === "WAITING" || nowMs < state.manualReadyAtMs) return false;
    this.#clearCountdown(state);
    if (state.off) {
      state.automaticAttemptsRemaining = 0;
      this.#saveAutomaticAttemptsRemaining(provider, 0);
      state.automaticTiming = this.#newAutomaticTiming(nowMs);
      this.#saveAutomaticTiming(provider, state.automaticTiming);
    }
    state.manualReadyAtMs = nowMs + MANUAL_RECOVERY_COOLDOWN_MS;
    this.#saveManualRetryAtMs(provider, state.manualReadyAtMs);
    state.phase = "RECOVERING";
    state.recoveryMode = "MANUAL";
    state.countdownKind = state.off ? "VERIFY" : null;
    state.countdownDeadlineMs = state.automaticTiming?.verificationDeadlineMs ?? null;
    state.lastError = null;
    const outageGeneration = state.outageGeneration;
    this.#startTicker(state);
    this.#emit();
    await this.#attempt(provider, "MANUAL", outageGeneration);
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const state of this.#states.values()) this.#clearCountdown(state);
  }

  #state(provider: RecoverableProvider): ProviderRecoveryState {
    const existing = this.#states.get(provider);
    if (existing !== undefined) return existing;
    const state: ProviderRecoveryState = {
      phase: "IDLE", recoveryMode: null,
      automaticAttemptsRemaining: this.#loadAutomaticAttemptsRemaining(provider, 1),
      automaticTiming: this.#loadAutomaticTiming(provider),
      countdownKind: null, countdownDeadlineMs: null,
      manualReadyAtMs: this.#loadManualRetryAtMs(provider, 0), lastError: null, outageGeneration: 0, off: false,
      countdownTimer: null, countdownTicker: null
    };
    this.#states.set(provider, state);
    return state;
  }

  #markActive(provider: RecoverableProvider, state: ProviderRecoveryState): void {
    const changed = state.off || state.phase !== "IDLE" || state.automaticAttemptsRemaining !== 1 ||
      state.countdownDeadlineMs !== null || state.countdownKind !== null || state.lastError !== null;
    if (!changed) return;
    this.#clearCountdown(state);
    state.phase = "IDLE";
    state.recoveryMode = null;
    state.automaticAttemptsRemaining = 1;
    state.automaticTiming = null;
    state.countdownKind = null;
    state.countdownDeadlineMs = null;
    state.lastError = null;
    state.off = false;
    state.outageGeneration += 1;
    this.#saveAutomaticAttemptsRemaining(provider, 1);
    this.#saveAutomaticTiming(provider, null);
    this.#emit();
  }

  #resumeAutomaticLifecycle(provider: RecoverableProvider, state: ProviderRecoveryState): void {
    if (state.automaticAttemptsRemaining === 1) {
      this.#startInitialCountdown(provider, state);
      return;
    }
    state.automaticTiming = this.#loadAutomaticTiming(provider) ?? state.automaticTiming;
    const nowMs = this.#now();
    if (state.automaticTiming !== null && state.automaticTiming.verificationDeadlineMs > nowMs) {
      this.#waitForVerification(provider, state);
      return;
    }
    const retryAtMs = state.automaticTiming?.retryAtMs ?? (nowMs + AUTO_RECOVERY_RETRY_MS);
    if (state.automaticTiming === null) {
      state.automaticTiming = { verificationDeadlineMs: nowMs, retryAtMs };
      this.#saveAutomaticTiming(provider, state.automaticTiming);
    }
    this.#waitForRetry(provider, state, retryAtMs);
  }

  #startInitialCountdown(provider: RecoverableProvider, state: ProviderRecoveryState): void {
    const outageGeneration = state.outageGeneration;
    this.#scheduleDeadline(state, "COUNTDOWN", "INITIAL", this.#now() + AUTO_RECOVERY_DELAY_MS, () => {
      if (!this.#isCurrentOutage(state, outageGeneration, "COUNTDOWN", "INITIAL")) return;
      if (this.#loadAutomaticAttemptsRemaining(provider, state.automaticAttemptsRemaining) === 0) {
        state.automaticAttemptsRemaining = 0;
        this.#resumeAutomaticLifecycle(provider, state);
        this.#emit();
        return;
      }
      this.#beginAutomaticAttempt(provider, state, outageGeneration);
    });
  }

  #beginAutomaticAttempt(provider: RecoverableProvider, state: ProviderRecoveryState,
    outageGeneration: number): void {
    this.#clearCountdown(state);
    const nowMs = this.#now();
    state.automaticAttemptsRemaining = 0;
    this.#saveAutomaticAttemptsRemaining(provider, 0);
    state.automaticTiming = this.#newAutomaticTiming(nowMs);
    this.#saveAutomaticTiming(provider, state.automaticTiming);
    state.phase = "RECOVERING";
    state.recoveryMode = "AUTO";
    state.countdownKind = "VERIFY";
    state.countdownDeadlineMs = state.automaticTiming.verificationDeadlineMs;
    state.lastError = null;
    this.#startTicker(state);
    this.#emit();
    void this.#attempt(provider, "AUTO", outageGeneration);
  }

  async #attempt(provider: RecoverableProvider, mode: ProviderRecoveryMode,
    outageGeneration: number): Promise<void> {
    let error: unknown = null;
    try {
      await this.#options.recover(provider, mode);
    } catch (reason) {
      error = reason;
    }
    if (this.#disposed) return;
    const state = this.#state(provider);
    if (state.outageGeneration !== outageGeneration) return;
    this.#clearCountdown(state);
    state.recoveryMode = null;
    state.lastError = error === null ? null : recoveryError(error);
    if (!state.off) {
      state.phase = "IDLE";
      state.countdownKind = null;
      state.countdownDeadlineMs = null;
      state.automaticTiming = null;
      this.#saveAutomaticTiming(provider, null);
      this.#emit();
      return;
    }
    if (state.automaticTiming === null) {
      state.automaticTiming = this.#newAutomaticTiming(this.#now());
      this.#saveAutomaticTiming(provider, state.automaticTiming);
    }
    if (error === null && state.automaticTiming.verificationDeadlineMs > this.#now()) {
      this.#waitForVerification(provider, state);
    } else {
      this.#waitForRetry(provider, state, state.automaticTiming.retryAtMs);
    }
    this.#emit();
  }

  #waitForVerification(provider: RecoverableProvider, state: ProviderRecoveryState): void {
    const timing = state.automaticTiming;
    if (timing === null || timing.verificationDeadlineMs <= this.#now()) {
      this.#waitForRetry(provider, state, timing?.retryAtMs ?? (this.#now() + AUTO_RECOVERY_RETRY_MS));
      return;
    }
    const outageGeneration = state.outageGeneration;
    this.#scheduleDeadline(state, "WAITING", "VERIFY", timing.verificationDeadlineMs, () => {
      if (!this.#isCurrentOutage(state, outageGeneration, "WAITING", "VERIFY")) return;
      this.#waitForRetry(provider, state, timing.retryAtMs);
      this.#emit();
    });
  }

  #waitForRetry(provider: RecoverableProvider, state: ProviderRecoveryState, requestedRetryAtMs: number): void {
    const nowMs = this.#now();
    const retryAtMs = requestedRetryAtMs > nowMs ? requestedRetryAtMs : nowMs + AUTO_RECOVERY_DELAY_MS;
    if (state.automaticTiming === null || state.automaticTiming.retryAtMs !== retryAtMs) {
      state.automaticTiming = {
        verificationDeadlineMs: state.automaticTiming?.verificationDeadlineMs ?? nowMs,
        retryAtMs
      };
      this.#saveAutomaticTiming(provider, state.automaticTiming);
    }
    const outageGeneration = state.outageGeneration;
    this.#scheduleDeadline(state, "COUNTDOWN", "RETRY", retryAtMs, () => {
      if (!this.#isCurrentOutage(state, outageGeneration, "COUNTDOWN", "RETRY")) return;
      this.#beginAutomaticAttempt(provider, state, outageGeneration);
    });
  }

  #scheduleDeadline(state: ProviderRecoveryState, phase: ProviderRecoverySnapshot["phase"],
    kind: ProviderRecoveryCountdownKind, deadlineMs: number, callback: () => void): void {
    this.#clearCountdown(state);
    state.phase = phase;
    state.recoveryMode = null;
    state.countdownKind = kind;
    state.countdownDeadlineMs = deadlineMs;
    this.#startTicker(state);
    state.countdownTimer = setTimeout(callback, Math.max(0, deadlineMs - this.#now()));
  }

  #startTicker(state: ProviderRecoveryState): void {
    if (state.countdownDeadlineMs === null || state.countdownTicker !== null) return;
    state.countdownTicker = setInterval(() => { this.#emit(); }, 1_000);
  }

  #isCurrentOutage(state: ProviderRecoveryState, outageGeneration: number,
    phase: ProviderRecoverySnapshot["phase"], kind: ProviderRecoveryCountdownKind): boolean {
    return !this.#disposed && state.off && state.outageGeneration === outageGeneration &&
      state.phase === phase && state.countdownKind === kind;
  }

  #newAutomaticTiming(nowMs: number): ProviderAutomaticRecoveryTiming {
    return { verificationDeadlineMs: nowMs + RECOVERY_CONFIRMATION_MS, retryAtMs: nowMs + AUTO_RECOVERY_RETRY_MS };
  }

  #clearCountdown(state: ProviderRecoveryState): void {
    if (state.countdownTimer !== null) clearTimeout(state.countdownTimer);
    if (state.countdownTicker !== null) clearInterval(state.countdownTicker);
    state.countdownTimer = null;
    state.countdownTicker = null;
  }

  #emit(): void {
    try { this.#options.onChange?.(); } catch { /* UI notification cannot own recovery */ }
  }

  #loadAutomaticAttemptsRemaining(provider: RecoverableProvider, fallback: 0 | 1): 0 | 1 {
    const load = this.#options.loadAutomaticAttemptsRemaining;
    if (load === undefined) return fallback;
    try { return load(provider) === 0 ? 0 : 1; }
    catch { return fallback; }
  }

  #saveAutomaticAttemptsRemaining(provider: RecoverableProvider, remaining: 0 | 1): void {
    try { this.#options.saveAutomaticAttemptsRemaining?.(provider, remaining); }
    catch { /* Browser storage must not own recovery */ }
  }

  #loadAutomaticTiming(provider: RecoverableProvider): ProviderAutomaticRecoveryTiming | null {
    try {
      const timing = this.#options.loadAutomaticTiming?.(provider) ?? null;
      if (timing === null || !Number.isFinite(timing.verificationDeadlineMs) ||
        !Number.isFinite(timing.retryAtMs) || timing.verificationDeadlineMs < 0 || timing.retryAtMs < 0) return null;
      return timing;
    } catch { return null; }
  }

  #saveAutomaticTiming(provider: RecoverableProvider, timing: ProviderAutomaticRecoveryTiming | null): void {
    try { this.#options.saveAutomaticTiming?.(provider, timing); }
    catch { /* Browser storage must not own recovery */ }
  }

  #loadManualRetryAtMs(provider: RecoverableProvider, fallback: number): number {
    const load = this.#options.loadManualRetryAtMs;
    if (load === undefined) return fallback;
    try {
      const value = load(provider);
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    } catch { return fallback; }
  }

  #saveManualRetryAtMs(provider: RecoverableProvider, deadlineMs: number): void {
    try { this.#options.saveManualRetryAtMs?.(provider, deadlineMs); }
    catch { /* Browser storage must not own recovery */ }
  }
}

function recoveryError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "SOURCE_RECOVERY_FAILED";
}
