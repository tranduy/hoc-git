const ALARM_NAME = "fieldline-bridge-wakeup";
// Shorter than the 30 s alarm period so a hung wake is always released before
// the next alarm arrives.
const DEFAULT_WAKE_TIMEOUT_MS = 20_000;
// Every source going stale within seconds of the others, with no reconnect
// after, is the failure this guards. Whatever holds the bridge — a latch, a
// timer lost to worker eviction — a bridge silent this long is rebuilt rather
// than waited on.
const DEFAULT_REBUILD_AFTER_MS = 180_000;

export interface BridgeWakeupDependencies {
  readonly createAlarm: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly addAlarmListener: (listener: (alarm: { readonly name: string }) => void) => void;
  readonly reconcileTabs?: () => Promise<void>;
  readonly ensureConnected: () => Promise<boolean>;
  readonly ensureAttached?: () => Promise<readonly string[] | void>;
  readonly pollNow: (sourceIds?: readonly string[]) => void | Promise<void>;
  readonly wakeTimeoutMs?: number;
  /** How long the bridge has been out of contact with the server. */
  readonly bridgeContactAgeMs?: () => number;
  /** Tears the bridge down and builds a fresh one, bypassing any held latch. */
  readonly rebuildBridge?: () => Promise<void> | void;
  readonly rebuildAfterMs?: number;
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

  async #rebuildStalledBridge(): Promise<void> {
    const contactAgeMs = this.#dependencies.bridgeContactAgeMs?.();
    const rebuild = this.#dependencies.rebuildBridge;
    if (contactAgeMs === undefined || rebuild === undefined) return;
    const limitMs = this.#dependencies.rebuildAfterMs ?? DEFAULT_REBUILD_AFTER_MS;
    if (!Number.isFinite(contactAgeMs) || contactAgeMs <= limitMs) return;
    try { await rebuild(); }
    catch { /* a failed rebuild is retried by the next alarm */ }
  }

  wakeNow(forceAttachedSources = false): Promise<void> {
    if (this.#wakeInFlight !== null) return this.#wakeInFlight;
    const operation = (async () => {
      await this.#dependencies.ensureConnected().catch(() => false);
      await this.#rebuildStalledBridge();
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
