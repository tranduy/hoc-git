const ALARM_NAME = "fieldline-bridge-wakeup";

export interface BridgeWakeupDependencies {
  readonly createAlarm: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly addAlarmListener: (listener: (alarm: { readonly name: string }) => void) => void;
  readonly reconcileTabs?: () => Promise<void>;
  readonly ensureConnected: () => Promise<boolean>;
  readonly ensureAttached?: () => Promise<void>;
  readonly pollNow: () => void | Promise<void>;
}

export class BridgeWakeup {
  readonly #dependencies: BridgeWakeupDependencies;
  #wakeInFlight: Promise<void> | null = null;

  constructor(dependencies: BridgeWakeupDependencies) {
    this.#dependencies = dependencies;
  }

  start(): void {
    this.#dependencies.createAlarm(ALARM_NAME, { periodInMinutes: 0.5 });
    this.#dependencies.addAlarmListener((alarm) => {
      if (alarm.name !== ALARM_NAME) return;
      void this.wakeNow();
    });
    void this.wakeNow();
  }

  wakeNow(): Promise<void> {
    if (this.#wakeInFlight !== null) return this.#wakeInFlight;
    const operation = (async () => {
      await this.#dependencies.reconcileTabs?.().catch(() => undefined);
      await this.#dependencies.ensureConnected().catch(() => false);
      await this.#dependencies.ensureAttached?.().catch(() => undefined);
      await this.#dependencies.pollNow();
    })().finally(() => {
      if (this.#wakeInFlight === operation) this.#wakeInFlight = null;
    });
    this.#wakeInFlight = operation;
    return operation;
  }
}
