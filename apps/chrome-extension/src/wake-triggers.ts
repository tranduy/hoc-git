export const BRIDGE_WAKE_ALARM = "fieldline-bridge-wakeup";
export const LOBBY_HEARTBEAT_KIND = "LOBBY_HEARTBEAT";
// Heartbeats arrive from every open lobby tab at once. The alarm already wakes
// the worker once a minute, so heartbeats only need to cover the case the alarm
// misses; matching that cadence keeps a reconnect prompt without replaying tab
// reconciliation and polling several times a minute.
const DEFAULT_MIN_WAKE_INTERVAL_MS = 60_000;

export interface WakeTriggerDependencies {
  readonly createAlarm: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly addAlarmListener: (listener: (alarm: { readonly name: string }) => void) => void;
  readonly addMessageListener: (listener: (message: unknown) => void) => void;
  readonly now?: () => number;
  readonly minWakeIntervalMs?: number;
}

/**
 * The wake path, owned separately from everything it wakes.
 *
 * This service worker is the extension's only live component: collect it and
 * every timer, socket and latch that could rebuild the bridge goes with it. The
 * alarm and the lobby heartbeat are the only two ways back in, so they are
 * installed before the observer, the registry and the poller are built — a
 * throw while constructing any of those must not be able to take the way back
 * in down with it. That failure is silent and absorbing: the worker idles out,
 * reports no error, and never reconnects again.
 */
export class WakeTriggers {
  readonly #now: () => number;
  readonly #minWakeIntervalMs: number;
  #handler: (() => void) | null = null;
  #pending = false;
  #lastWakeAtMs = Number.NEGATIVE_INFINITY;

  constructor(dependencies: WakeTriggerDependencies) {
    this.#now = dependencies.now ?? (() => Date.now());
    this.#minWakeIntervalMs = dependencies.minWakeIntervalMs ?? DEFAULT_MIN_WAKE_INTERVAL_MS;
    // Chrome refuses a period below one minute for a released extension, so this
    // is the fastest the alarm alone can bring a collected worker back.
    dependencies.createAlarm(BRIDGE_WAKE_ALARM, { periodInMinutes: 1 });
    dependencies.addAlarmListener((alarm) => {
      if (alarm.name === BRIDGE_WAKE_ALARM) this.#fire(true);
    });
    dependencies.addMessageListener((message) => {
      if ((message as { readonly kind?: unknown } | null)?.kind === LOBBY_HEARTBEAT_KIND) {
        this.#fire(false);
      }
    });
  }

  /**
   * Attaches the work a trigger runs. A trigger that arrived before this — the
   * usual case, since delivering it is what started the worker — is replayed
   * rather than dropped.
   */
  attach(handler: () => void): void {
    this.#handler = handler;
    if (!this.#pending) return;
    this.#pending = false;
    this.#run();
  }

  #fire(fromAlarm: boolean): void {
    if (this.#handler === null) {
      this.#pending = true;
      return;
    }
    if (!fromAlarm && this.#now() - this.#lastWakeAtMs < this.#minWakeIntervalMs) return;
    this.#run();
  }

  #run(): void {
    this.#lastWakeAtMs = this.#now();
    try { this.#handler?.(); }
    catch { /* the next trigger retries; a throw here must not stop later wakes */ }
  }
}
