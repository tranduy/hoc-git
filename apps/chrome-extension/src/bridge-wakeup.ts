const ALARM_NAME = "fieldline-bridge-wakeup";

export interface BridgeWakeupDependencies {
  readonly createAlarm: (name: string, info: { readonly periodInMinutes: number }) => void;
  readonly addAlarmListener: (listener: (alarm: { readonly name: string }) => void) => void;
  readonly ensureConnected: () => Promise<boolean>;
  readonly ensureAttached?: () => Promise<void>;
}

export class BridgeWakeup {
  readonly #dependencies: BridgeWakeupDependencies;

  constructor(dependencies: BridgeWakeupDependencies) {
    this.#dependencies = dependencies;
  }

  start(): void {
    this.#dependencies.createAlarm(ALARM_NAME, { periodInMinutes: 0.5 });
    this.#dependencies.addAlarmListener((alarm) => {
      if (alarm.name !== ALARM_NAME) return;
      void this.#dependencies.ensureConnected().catch(() => false);
      void this.#dependencies.ensureAttached?.().catch(() => undefined);
    });
  }
}
