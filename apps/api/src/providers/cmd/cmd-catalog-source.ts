import type { CmdCatalogInputRecord, CmdCatalogSnapshot, CmdCatalogSource } from "@tool-chenh/adapters";
import type { ActiveSecretHandle } from "../../sessions/types.js";

export interface CmdCatalogRecordReader {
  readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly CmdCatalogInputRecord[]>;
}

export interface CmdCatalogScheduler {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface CmdPollingCatalogSourceOptions {
  readonly handle: ActiveSecretHandle;
  readonly reader: CmdCatalogRecordReader;
  readonly clock: { now(): { readonly wallClockNowMs: number; readonly monotonicNowMs: number } };
  readonly scheduler?: CmdCatalogScheduler;
  readonly pollingIntervalMs?: number;
  readonly timezoneOffsetMinutes: number;
}

const defaultScheduler: CmdCatalogScheduler = {
  wait: async (delayMs, signal) => new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, delayMs);
    const stop = (): void => { clearTimeout(timeout); resolve(); };
    signal.addEventListener("abort", stop, { once: true });
  })
};

export class CmdPollingCatalogSource implements CmdCatalogSource {
  readonly #handle: ActiveSecretHandle;
  readonly #reader: CmdCatalogRecordReader;
  readonly #clock: CmdPollingCatalogSourceOptions["clock"];
  readonly #scheduler: CmdCatalogScheduler;
  readonly #pollingIntervalMs: number;
  readonly #timezoneOffsetMinutes: number;

  constructor(options: CmdPollingCatalogSourceOptions) {
    if (!Number.isFinite(options.pollingIntervalMs ?? 250) || (options.pollingIntervalMs ?? 250) < 100 ||
      !Number.isFinite(options.timezoneOffsetMinutes)) throw new Error("CMD_CATALOG_OPTIONS_INVALID");
    this.#handle = options.handle;
    this.#reader = options.reader;
    this.#clock = options.clock;
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#pollingIntervalMs = options.pollingIntervalMs ?? 250;
    this.#timezoneOffsetMinutes = options.timezoneOffsetMinutes;
  }

  async *snapshots(signal: AbortSignal): AsyncIterable<CmdCatalogSnapshot> {
    if (this.#handle.provider !== "CMD") throw new Error("CMD_CATALOG_UNAVAILABLE");
    let sequence = 0;
    while (!signal.aborted) {
      let records: readonly CmdCatalogInputRecord[];
      try {
        records = await this.#handle.withSecret(async (secret) => {
          if (secret.kind !== "LAUNCH_URL") throw new Error("CMD_CATALOG_UNAVAILABLE");
          return this.#reader.readCatalog({ sessionId: this.#handle.sessionId, launchUrl: secret.value });
        });
      } catch {
        throw new Error("CMD_CATALOG_UNAVAILABLE");
      }
      const now = this.#clock.now();
      sequence += 1;
      yield {
        records, observedAtMs: now.wallClockNowMs, receivedMonotonicMs: now.monotonicNowMs,
        timezoneOffsetMinutes: this.#timezoneOffsetMinutes, sequence
      };
      if (!signal.aborted) await this.#scheduler.wait(this.#pollingIntervalMs, signal);
    }
  }
}
