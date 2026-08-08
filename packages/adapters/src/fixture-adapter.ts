import {
  CategorySchema,
  ProviderConnectionStatusSchema,
  ProviderEventSchema,
  ProviderMarketSchema,
  ProviderQuoteSchema,
  type Category
} from "@tool-chenh/contracts";
import { z } from "zod";
import type {
  AdapterRecordKind,
  AdapterSchemaError,
  AdapterSchemaIssue,
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

export interface FixtureAdapterConfig extends FixtureAdapterOptions {
  readonly id: string;
  readonly provider: string;
  readonly category: Category;
}

interface PreparedFixtureRecord {
  readonly valid: boolean;
  readonly offsetMs: number;
  readonly kind: AdapterRecordKind;
  readonly payload: unknown;
  readonly issues: readonly AdapterSchemaIssue[];
  readonly originalIndex: number;
}

interface SafeSchemaFailure {
  readonly issues: readonly {
    readonly code: string;
    readonly path: readonly PropertyKey[];
  }[];
}

const FixtureSnapshotEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  adapterId: z.string().min(1),
  provider: z.string().min(1),
  category: CategorySchema,
  records: z.array(z.unknown())
});

const FixtureAdapterIdentitySchema = z.strictObject({
  id: z.string().min(1),
  provider: z.string().min(1),
  category: CategorySchema
});

const FixtureRecordSchema = z.strictObject({
  offsetMs: z.number().finite().nonnegative(),
  kind: z.enum(["EVENT", "MARKET", "QUOTE", "STATUS"]),
  payload: z.unknown()
});

const fixtureRecordKinds = new Set<FixtureRecordKind>(["EVENT", "MARKET", "QUOTE", "STATUS"]);

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

function safeRecordMetadata(record: unknown): {
  readonly offsetMs: number;
  readonly kind: AdapterRecordKind;
} {
  if (typeof record !== "object" || record === null) {
    return { offsetMs: 0, kind: "UNKNOWN" };
  }

  const candidate = record as Record<string, unknown>;
  const offsetMs = typeof candidate.offsetMs === "number"
    && Number.isFinite(candidate.offsetMs)
    && candidate.offsetMs >= 0
    ? candidate.offsetMs
    : 0;
  const kind = typeof candidate.kind === "string"
    && fixtureRecordKinds.has(candidate.kind as FixtureRecordKind)
    ? candidate.kind as FixtureRecordKind
    : "UNKNOWN";
  return { offsetMs, kind };
}

function safeIssues(error: SafeSchemaFailure): readonly AdapterSchemaIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.map(String)
  }));
}

export class FixtureAdapter implements ProviderAdapter {
  readonly id: string;
  readonly categories: readonly Category[];
  readonly #provider: string;
  readonly #category: Category;
  readonly #records: readonly unknown[];
  readonly #snapshotIssues: readonly AdapterSchemaIssue[];
  readonly #speed: number;
  readonly #scheduler: ReplayScheduler;

  constructor(snapshot: unknown, config: FixtureAdapterConfig) {
    const identity = FixtureAdapterIdentitySchema.safeParse(config === undefined
      ? undefined
      : { id: config.id, provider: config.provider, category: config.category });
    if (!identity.success) throw new Error("Invalid fixture adapter configuration");

    const speed = config.speed ?? 1;
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error("Fixture replay speed must be a positive finite number");
    }

    this.id = identity.data.id;
    this.categories = Object.freeze([identity.data.category]);
    this.#provider = identity.data.provider;
    this.#category = identity.data.category;
    this.#speed = speed;
    this.#scheduler = config.scheduler ?? defaultScheduler;

    let clonedSnapshot: unknown;
    try {
      clonedSnapshot = structuredClone(snapshot);
    } catch {
      this.#records = [];
      this.#snapshotIssues = [{ code: "invalid_snapshot", path: [] }];
      return;
    }
    const result = FixtureSnapshotEnvelopeSchema.safeParse(clonedSnapshot);
    if (!result.success) {
      this.#records = [];
      this.#snapshotIssues = safeIssues(result.error);
      return;
    }

    const identityIssues: AdapterSchemaIssue[] = [];
    if (result.data.adapterId !== this.id) {
      identityIssues.push({ code: "custom", path: ["adapterId"] });
    }
    if (result.data.provider !== this.#provider) {
      identityIssues.push({ code: "custom", path: ["provider"] });
    }
    if (result.data.category !== this.#category) {
      identityIssues.push({ code: "custom", path: ["category"] });
    }
    this.#records = identityIssues.length === 0 ? result.data.records : [];
    this.#snapshotIssues = identityIssues;
  }

  async start(sink: ProviderSink, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.#snapshotIssues.length > 0) {
      sink.onSchemaError(this.#schemaError(
        { kind: "UNKNOWN", offsetMs: 0 },
        this.#snapshotIssues
      ));
      return;
    }

    const scheduled = this.#records
      .map((record, originalIndex) => this.#prepareRecord(record, originalIndex))
      .sort((left, right) => left.offsetMs - right.offsetMs || left.originalIndex - right.originalIndex);
    let previousOffsetMs = 0;

    for (const record of scheduled) {
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

      if (record.valid) this.#validateAndEmit(record, sink);
      else sink.onSchemaError(this.#schemaError(record, record.issues));
      previousOffsetMs = record.offsetMs;
    }
  }

  #prepareRecord(record: unknown, originalIndex: number): PreparedFixtureRecord {
    const result = FixtureRecordSchema.safeParse(record);
    if (result.success) {
      return { ...result.data, valid: true, issues: [], originalIndex };
    }

    const metadata = safeRecordMetadata(record);
    return {
      ...metadata,
      valid: false,
      payload: undefined,
      issues: safeIssues(result.error),
      originalIndex
    };
  }

  #validateAndEmit(record: PreparedFixtureRecord, sink: ProviderSink): void {
    switch (record.kind) {
      case "EVENT": {
        const result = ProviderEventSchema.safeParse(record.payload);
        if (!result.success) sink.onSchemaError(this.#schemaError(record, safeIssues(result.error)));
        else if (this.#matchesProvenance(result.data)) sink.onEvent(result.data);
        else sink.onSchemaError(this.#provenanceError(record, result.data));
        return;
      }
      case "MARKET": {
        const result = ProviderMarketSchema.safeParse(record.payload);
        if (!result.success) sink.onSchemaError(this.#schemaError(record, safeIssues(result.error)));
        else if (this.#matchesProvenance(result.data)) sink.onMarket(result.data);
        else sink.onSchemaError(this.#provenanceError(record, result.data));
        return;
      }
      case "QUOTE": {
        const result = ProviderQuoteSchema.safeParse(record.payload);
        if (!result.success) sink.onSchemaError(this.#schemaError(record, safeIssues(result.error)));
        else if (this.#matchesProvenance(result.data)) sink.onQuote(result.data);
        else sink.onSchemaError(this.#provenanceError(record, result.data));
        return;
      }
      case "STATUS": {
        const result = ProviderConnectionStatusSchema.safeParse(record.payload);
        if (!result.success) sink.onSchemaError(this.#schemaError(record, safeIssues(result.error)));
        else if (this.#matchesProvenance(result.data)) sink.onStatus(result.data);
        else sink.onSchemaError(this.#provenanceError(record, result.data));
        return;
      }
      case "UNKNOWN":
        sink.onSchemaError(this.#schemaError(record, [{ code: "invalid_kind", path: ["kind"] }]));
    }
  }

  #matchesProvenance(value: { provider: string; category: Category }): boolean {
    return value.provider === this.#provider && value.category === this.#category;
  }

  #provenanceError(
    record: PreparedFixtureRecord,
    value: { provider: string; category: Category }
  ): AdapterSchemaError {
    const issues: AdapterSchemaIssue[] = [];
    if (value.provider !== this.#provider) issues.push({ code: "custom", path: ["provider"] });
    if (value.category !== this.#category) issues.push({ code: "custom", path: ["category"] });
    return this.#schemaError(record, issues);
  }

  #schemaError(
    record: Pick<PreparedFixtureRecord, "kind" | "offsetMs">,
    issues: readonly AdapterSchemaIssue[]
  ): AdapterSchemaError {
    return {
      code: "SCHEMA_ERROR",
      adapterId: this.id,
      provider: this.#provider,
      category: this.#category,
      recordKind: record.kind,
      offsetMs: record.offsetMs,
      issues
    };
  }
}

export type { AdapterSchemaError } from "./provider-adapter.js";
