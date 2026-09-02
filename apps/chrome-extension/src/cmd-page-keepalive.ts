export interface CmdAttachedSource {
  readonly lobby: "CMD";
  readonly sourceId: string;
  readonly tabId: number;
}

export interface CmdPageKeepaliveState {
  readonly lastCompletedAtMs: number;
  readonly nextAttemptAtMs: number;
}

export function parseCmdPageKeepaliveState(value: unknown): CmdPageKeepaliveState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<CmdPageKeepaliveState>;
  if (!Number.isSafeInteger(candidate.lastCompletedAtMs) || candidate.lastCompletedAtMs! < 0 ||
    !Number.isSafeInteger(candidate.nextAttemptAtMs) || candidate.nextAttemptAtMs! < candidate.lastCompletedAtMs!) {
    return null;
  }
  return { lastCompletedAtMs: candidate.lastCompletedAtMs!, nextAttemptAtMs: candidate.nextAttemptAtMs! };
}

interface ExclusiveResult<T> {
  readonly started: true;
  readonly value: T;
}

interface ExclusiveNotStarted {
  readonly started: false;
}

type TryExclusiveResult<T> = ExclusiveResult<T> | ExclusiveNotStarted;

interface CmdPageKeepaliveOptions {
  readonly listAttached: () => readonly CmdAttachedSource[];
  readonly isBusy: (sourceId: string) => boolean;
  readonly isLoading: (tabId: number) => Promise<boolean>;
  readonly loadState: () => Promise<CmdPageKeepaliveState | null>;
  readonly saveState: (state: CmdPageKeepaliveState) => Promise<void>;
  readonly reload: (source: CmdAttachedSource) => Promise<void>;
  readonly tryRunExclusive?: <T>(sourceId: string, operation: () => Promise<T>) => Promise<TryExclusiveResult<T>>;
  readonly runExclusive?: <T>(sourceId: string, operation: () => Promise<T>) => Promise<T>;
  readonly now?: () => number;
  readonly intervalMs?: number;
  readonly busyRetryMs?: number;
  readonly failureRetryMs?: number;
}

interface ExactCmdTab {
  readonly id?: number | undefined;
  readonly url?: string | undefined;
  readonly title?: string | undefined;
}

interface ExactCmdReloadOptions {
  readonly isAttached: (source: CmdAttachedSource) => boolean;
  readonly get: (tabId: number) => Promise<ExactCmdTab>;
  readonly isExpected: (tab: ExactCmdTab) => boolean;
  readonly attachBootstrap: (tab: ExactCmdTab) => Promise<void>;
  readonly reload: (tabId: number) => Promise<void>;
}

export async function reloadExactCmdTab(source: CmdAttachedSource, options: ExactCmdReloadOptions): Promise<void> {
  if (!options.isAttached(source)) throw new Error("CMD_SOURCE_NOT_ATTACHED");
  const candidate = await options.get(source.tabId);
  if (candidate.id !== source.tabId || !options.isExpected(candidate)) throw new Error("CMD_SOURCE_NOT_ATTACHED");
  await options.attachBootstrap(candidate);
  const current = await options.get(source.tabId);
  // There is deliberately no await between these final identity checks and
  // invoking reload: recovery must never create, navigate or substitute a tab.
  if (!options.isAttached(source) || current.id !== source.tabId || !options.isExpected(current)) {
    throw new Error("CMD_SOURCE_REPLACED");
  }
  await options.reload(source.tabId);
}

const DEFAULT_INTERVAL_MS = 20 * 60_000;
const DEFAULT_BUSY_RETRY_MS = 30_000;
const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export class SourceActivityGuard {
  readonly #active = new Map<string, number>();
  readonly #exclusive = new Set<string>();
  readonly #exclusivePending = new Map<string, number>();
  readonly #waiters = new Map<string, Set<() => void>>();

  isBusy(sourceId: string): boolean {
    return (this.#active.get(sourceId) ?? 0) > 0 || this.#exclusive.has(sourceId) ||
      (this.#exclusivePending.get(sourceId) ?? 0) > 0;
  }

  async run<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    while (this.#exclusive.has(sourceId) || (this.#exclusivePending.get(sourceId) ?? 0) > 0) {
      await this.#wait(sourceId);
    }
    this.#active.set(sourceId, (this.#active.get(sourceId) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const remaining = (this.#active.get(sourceId) ?? 1) - 1;
      if (remaining <= 0) this.#active.delete(sourceId);
      else this.#active.set(sourceId, remaining);
      this.#notify(sourceId);
    }
  }

  tryRunExclusive<T>(sourceId: string, operation: () => Promise<T>): Promise<TryExclusiveResult<T>> {
    if (this.isBusy(sourceId)) return Promise.resolve({ started: false });
    this.#exclusive.add(sourceId);
    return this.#performExclusive(sourceId, operation).then((value) => ({ started: true, value }));
  }

  async runExclusive<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    this.#exclusivePending.set(sourceId, (this.#exclusivePending.get(sourceId) ?? 0) + 1);
    try {
      while (this.#exclusive.has(sourceId) || (this.#active.get(sourceId) ?? 0) > 0) await this.#wait(sourceId);
      this.#exclusive.add(sourceId);
    } finally {
      const remaining = (this.#exclusivePending.get(sourceId) ?? 1) - 1;
      if (remaining <= 0) this.#exclusivePending.delete(sourceId);
      else this.#exclusivePending.set(sourceId, remaining);
    }
    return this.#performExclusive(sourceId, operation);
  }

  async #performExclusive<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      this.#exclusive.delete(sourceId);
      this.#notify(sourceId);
    }
  }

  #wait(sourceId: string): Promise<void> {
    return new Promise((resolve) => {
      const waiters = this.#waiters.get(sourceId) ?? new Set<() => void>();
      waiters.add(resolve);
      this.#waiters.set(sourceId, waiters);
    });
  }

  #notify(sourceId: string): void {
    const waiters = this.#waiters.get(sourceId);
    if (waiters === undefined) return;
    this.#waiters.delete(sourceId);
    for (const resolve of waiters) resolve();
  }
}

export class CmdPageKeepalive {
  readonly #options: CmdPageKeepaliveOptions;
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #busyRetryMs: number;
  readonly #failureRetryMs: number;
  #state: CmdPageKeepaliveState | null | undefined;
  #inflight: Promise<void> | null = null;
  #reloadSerial = 0;

  constructor(options: CmdPageKeepaliveOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#busyRetryMs = options.busyRetryMs ?? DEFAULT_BUSY_RETRY_MS;
    this.#failureRetryMs = options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS;
  }

  tick(): Promise<void> {
    if (this.#inflight !== null) return this.#inflight;
    return this.#start(this.#tickSafely());
  }

  reloadNow(source: CmdAttachedSource): Promise<void> {
    const observedReloadSerial = this.#reloadSerial;
    if (this.#inflight !== null) {
      return this.#inflight.then(() => this.#reloadSerial !== observedReloadSerial
        ? undefined
        : this.reloadNow(source));
    }
    return this.#start(this.#reloadManually(source));
  }

  markCompleted(): Promise<void> {
    if (this.#inflight !== null) {
      return this.#inflight.catch(() => undefined).then(() => this.markCompleted());
    }
    return this.#start(this.#markCompleted());
  }

  async #markCompleted(): Promise<void> {
    const nowMs = this.#now();
    await this.#remember({ lastCompletedAtMs: nowMs, nextAttemptAtMs: nowMs + this.#intervalMs });
  }

  #start(operation: Promise<void>): Promise<void> {
    const tracked = operation.finally(() => {
      if (this.#inflight === tracked) this.#inflight = null;
    });
    this.#inflight = tracked;
    return tracked;
  }

  async #tickSafely(): Promise<void> {
    try {
      await this.#tick();
    } catch {
      await this.#rememberFailure();
    }
  }

  async #tick(): Promise<void> {
    if (this.#state === undefined) {
      try {
        this.#state = await this.#options.loadState();
      } catch {
        await this.#rememberFailure();
        return;
      }
    }
    const nowMs = this.#now();
    if (this.#state === null) {
      await this.#remember({ lastCompletedAtMs: nowMs, nextAttemptAtMs: nowMs + this.#intervalMs });
      return;
    }
    if (nowMs < this.#state.nextAttemptAtMs) return;

    const source = this.#options.listAttached().find((candidate) => candidate.lobby === "CMD");
    if (source === undefined) {
      await this.#remember({ ...this.#state, nextAttemptAtMs: nowMs + this.#busyRetryMs });
      return;
    }

    const lastCompletedAtMs = this.#state.lastCompletedAtMs;
    await this.#remember({ lastCompletedAtMs, nextAttemptAtMs: nowMs + this.#failureRetryMs });
    const attempt = await this.#tryScheduledReload(source);
    if (!attempt.started || attempt.value === "loading") {
      await this.#remember({ lastCompletedAtMs, nextAttemptAtMs: nowMs + this.#busyRetryMs });
      return;
    }
    this.#reloadSerial += 1;
    await this.#remember({ lastCompletedAtMs: nowMs, nextAttemptAtMs: nowMs + this.#intervalMs });
  }

  async #tryScheduledReload(source: CmdAttachedSource): Promise<TryExclusiveResult<"loading" | "reloaded">> {
    const operation = async (): Promise<"loading" | "reloaded"> => {
      if (await this.#options.isLoading(source.tabId)) return "loading";
      await this.#options.reload(source);
      return "reloaded";
    };
    if (this.#options.tryRunExclusive !== undefined) {
      return this.#options.tryRunExclusive(source.sourceId, operation);
    }
    if (this.#options.isBusy(source.sourceId)) return { started: false };
    return { started: true, value: await operation() };
  }

  async #reloadManually(source: CmdAttachedSource): Promise<void> {
    const nowMs = this.#now();
    const lastCompletedAtMs = this.#state?.lastCompletedAtMs ?? Math.max(0, nowMs - this.#intervalMs);
    await this.#remember({ lastCompletedAtMs, nextAttemptAtMs: nowMs + this.#failureRetryMs });
    const operation = async (): Promise<boolean> => {
      if (await this.#options.isLoading(source.tabId)) return false;
      await this.#options.reload(source);
      return true;
    };
    const reloaded = this.#options.runExclusive === undefined
      ? await operation()
      : await this.#options.runExclusive(source.sourceId, operation);
    if (!reloaded) {
      await this.#remember({ lastCompletedAtMs, nextAttemptAtMs: nowMs + this.#busyRetryMs });
      return;
    }
    this.#reloadSerial += 1;
    await this.#remember({ lastCompletedAtMs: nowMs, nextAttemptAtMs: nowMs + this.#intervalMs });
  }

  async #rememberFailure(): Promise<void> {
    const nowMs = this.#now();
    const lastCompletedAtMs = this.#state?.lastCompletedAtMs ?? Math.max(0, nowMs - this.#intervalMs);
    await this.#remember({ lastCompletedAtMs, nextAttemptAtMs: nowMs + this.#failureRetryMs });
  }

  async #remember(state: CmdPageKeepaliveState): Promise<void> {
    this.#state = state;
    await this.#options.saveState(state).catch(() => undefined);
  }
}
