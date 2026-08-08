import {
  ProviderConnectionStatusSchema,
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  type Category
} from "@tool-chenh/contracts";
import type {
  AdapterRecordKind,
  AdapterSchemaError,
  ProviderAdapter,
  ProviderSink
} from "./provider-adapter.js";

export type FixtureRecordKind = Exclude<AdapterRecordKind, "UNKNOWN">;

export interface FixtureRecord {
  readonly offsetMs: number;
  readonly kind: FixtureRecordKind;
  readonly payload: unknown;
}

export interface FixtureSnapshot {
  readonly version: 1;
  readonly adapterId: string;
  readonly provider: string;
  readonly category: Category;
  readonly records: readonly FixtureRecord[];
}

export interface ReplayScheduler {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface FixtureAdapterOptions {
  readonly speed?: number;
  readonly scheduler?: ReplayScheduler;
}

interface SafeSchemaFailure {
  readonly issues: readonly {
    readonly code: string;
    readonly path: readonly PropertyKey[];
  }[];
}

const defaultScheduler: ReplayScheduler = {
  wait(delayMs, signal) {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
};

export class FixtureAdapter implements ProviderAdapter {
  readonly id: string;
  readonly categories: readonly Category[];
  readonly #provider: string;
  readonly #category: Category;
  readonly #records: readonly FixtureRecord[];
  readonly #speed: number;
  readonly #scheduler: ReplayScheduler;

  constructor(snapshot: FixtureSnapshot, options: FixtureAdapterOptions = {}) {
    const speed = options.speed ?? 1;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error("Fixture replay speed must be a positive finite number");
    }

    this.id = snapshot.adapterId;
    this.categories = Object.freeze([snapshot.category]);
    this.#provider = snapshot.provider;
    this.#category = snapshot.category;
    this.#records = snapshot.records.map((record) => ({ ...record }));
    this.#speed = speed;
    this.#scheduler = options.scheduler ?? defaultScheduler;
  }

  async start(sink: ProviderSink, signal: AbortSignal): Promise<void> {
    const scheduled = this.#records
      .map((record, index) => ({ record, index }))
      .sort((left, right) => left.record.offsetMs - right.record.offsetMs || left.index - right.index);
    let previousOffsetMs = 0;

    for (const { record } of scheduled) {
      if (signal.aborted) return;
      const waitMs = (record.offsetMs - previousOffsetMs) / this.#speed;
      if (waitMs > 0) {
        try {
          await this.#scheduler.wait(waitMs, signal);
        } catch {
          if (signal.aborted) return;
          throw new Error("Fixture replay scheduler failed");
        }
      }
      if (signal.aborted) return;

      this.#validateAndEmit(record, sink);
      previousOffsetMs = record.offsetMs;
    }
  }

  #validateAndEmit(record: FixtureRecord, sink: ProviderSink): void {
    switch (record.kind) {
      case "EVENT": {
        const result = ProviderEventSchema.safeParse(record.payload);
        if (result.success) sink.onEvent(result.data);
        else sink.onSchemaError(this.#schemaError(record, result.error));
        return;
      }
      case "MARKET": {
        const result = ProviderMarketSchema.safeParse(record.payload);
        if (result.success) sink.onMarket(result.data);
        else sink.onSchemaError(this.#schemaError(record, result.error));
        return;
      }
      case "QUOTE": {
        const result = ProviderQuoteSchema.safeParse(record.payload);
        if (result.success) sink.onQuote(result.data);
        else sink.onSchemaError(this.#schemaError(record, result.error));
        return;
      }
      case "STATUS": {
        const result = ProviderConnectionStatusSchema.safeParse(record.payload);
        if (result.success) sink.onStatus(result.data);
        else sink.onSchemaError(this.#schemaError(record, result.error));
      }
    }
  }

  #schemaError(record: FixtureRecord, error: SafeSchemaFailure): AdapterSchemaError {
    return {
      code: "SCHEMA_ERROR",
      adapterId: this.id,
      provider: this.#provider,
      category: this.#category,
      recordKind: record.kind,
      offsetMs: record.offsetMs,
      issues: error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map(String)
      }))
    };
  }
}

export type { AdapterSchemaError } from "./provider-adapter.js";
