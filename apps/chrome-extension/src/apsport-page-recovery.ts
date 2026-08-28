export interface ApsportPageHealth {
  readonly sourceId: string;
  readonly tabId: number;
  readonly rosterCount: number;
  readonly matchRows: number;
}

interface ApsportPageRecoveryWatchdogOptions {
  readonly reload: (tabId: number) => Promise<void>;
}

export class ApsportPageRecoveryWatchdog {
  readonly #options: ApsportPageRecoveryWatchdogOptions;
  #sourceId: string | null = null;
  #consecutiveEmptySamples = 0;
  #attempted = false;

  constructor(options: ApsportPageRecoveryWatchdogOptions) {
    this.#options = options;
  }

  async observe(health: ApsportPageHealth): Promise<void> {
    if (health.sourceId !== this.#sourceId) {
      this.#sourceId = health.sourceId;
      this.#consecutiveEmptySamples = 0;
      this.#attempted = false;
    }
    if (health.rosterCount <= 0 || health.matchRows < 0) {
      this.#consecutiveEmptySamples = 0;
      return;
    }
    if (health.matchRows > 0) {
      this.#consecutiveEmptySamples = 0;
      this.#attempted = false;
      return;
    }
    this.#consecutiveEmptySamples += 1;
    if (this.#consecutiveEmptySamples < 3 || this.#attempted) return;
    this.#attempted = true;
    await this.#options.reload(health.tabId);
  }
}
