const ALARM_NAME = "fieldline-bridge-wakeup";
// Shorter than the 30 s alarm period so a hung wake is always released before
// the next alarm arrives.
const DEFAULT_WAKE_TIMEOUT_MS = 20_000;

export interface BridgeWakeupDependencies {
  readonly createAlarm: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly addAlarmListener: (listener: (alarm: { readonly name: string }) => void) => void;
  readonly reconcileTabs?: () => Promise<void>;
  readonly ensureConnected: () => Promise<boolean>;
  readonly ensureAttached?: () => Promise<readonly string[] | void>;
  readonly pollNow: (sourceIds?: readonly string[]) => void | Promise<void>;
  readonly wakeTimeoutMs?: number;
}

export class BridgeWakeup {
  readonly #dependencies: BridgeWakeupDependencies;
  readonly #wakeTimeoutMs: number;
  #wakeInFlight: Promise<void> | null = null;

  constructor(dependencies: BridgeWakeupDependencies) {
    this.#dependencies = dependencies;
    this.#wakeTimeoutMs = dependencies.wakeTimeoutMs ?? DEFAULT_WAKE_TIMEOUT_MS;
  }

  start(): void {
    this.#dependencies.createAlarm(ALARM_NAME, { periodInMinutes: 0.5 });
    this.#dependencies.addAlarmListener((alarm) => {
      if (alarm.name !== ALARM_NAME) return;
      void this.wakeNow(false);
    });
    void this.wakeNow(true);
  }

  wakeNow(forceAttachedSources = false): Promise<void> {
    if (this.#wakeInFlight !== null) return this.#wakeInFlight;
    const operation = (async () => {
      await this.#dependencies.ensureConnected().catch(() => false);
      await this.#dependencies.reconcileTabs?.().catch(() => undefined);
      const reattached = await this.#dependencies.ensureAttached?.().catch(() => undefined);
      if (forceAttachedSources) await this.#dependencies.pollNow(reattached ?? []);
      else await this.#dependencies.pollNow();
    })();
    // A chrome.debugger command against an unresponsive tab never settles.
    // Holding the latch on that promise turns every later alarm into a silent
    // no-op, so the worker stops reconnecting until the extension is reloaded.
    // Release the latch on a bound instead; the next alarm then retries.
    let releaseDeadline = (): void => undefined;
    const deadline = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.#wakeTimeoutMs);
      releaseDeadline = () => { clearTimeout(timer); resolve(); };
    });
    const bounded = Promise.race([operation, deadline]).finally(() => {
      releaseDeadline();
      if (this.#wakeInFlight === bounded) this.#wakeInFlight = null;
    });
    this.#wakeInFlight = bounded;
    return bounded;
  }
}
