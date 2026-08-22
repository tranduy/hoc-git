import type { LiveCatalogResponse } from "../api/catalog.js";
import type { ComparisonEvent } from "./comparison.js";
import type { ComparisonProjection, ComparisonWorkerCommand, ComparisonWorkerOutput } from "./comparison-worker-protocol.js";
import { ComparisonWorkerEngine } from "./comparison-worker-engine.js";

export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface HydratedComparisonWorkerOutput {
  readonly generation: number;
  readonly displayEvents: readonly ComparisonEvent[];
  readonly freshEvents: readonly ComparisonEvent[];
}

function defaultWorker(): WorkerLike {
  if (typeof Worker === "undefined") {
    const engine = new ComparisonWorkerEngine();
    let stopped = false;
    const inline: WorkerLike = {
      onmessage: null, onerror: null,
      postMessage(message) {
        queueMicrotask(() => {
          if (stopped) return;
          try { inline.onmessage?.({ data: engine.apply(message as ComparisonWorkerCommand) } as MessageEvent); }
          catch (error) { inline.onerror?.(new ErrorEvent("error", { error })); }
        });
      },
      terminate() { stopped = true; }
    };
    return inline;
  }
  return new Worker(new URL("./comparison.worker.ts", import.meta.url), { type: "module" });
}

function hydrate(projection: ComparisonProjection,
  catalogs: ReadonlyMap<string, LiveCatalogResponse>): ComparisonEvent {
  const { accountIds, ...event } = projection;
  return { ...event, catalogs: accountIds.flatMap((accountId) => {
    const catalog = catalogs.get(accountId);
    return catalog === undefined ? [] : [catalog];
  }) };
}

function isOutput(value: unknown): value is ComparisonWorkerOutput {
  if (typeof value !== "object" || value === null) return false;
  const output = value as Partial<ComparisonWorkerOutput>;
  return Number.isSafeInteger(output.generation) && (output.generation ?? -1) >= 0 &&
    Array.isArray(output.displayEvents) && Array.isArray(output.freshEvents);
}

export class ComparisonWorkerClient {
  readonly #createWorker: () => WorkerLike;
  readonly #onResult: (output: HydratedComparisonWorkerOutput) => void;
  readonly #onError: (message: string) => void;
  readonly #catalogs = new Map<string, LiveCatalogResponse>();
  readonly #stale = new Set<string>();
  #worker: WorkerLike;
  #generation = 0;
  #restartCount = 0;
  #stopped = false;

  constructor(options: {
    readonly createWorker?: () => WorkerLike;
    readonly onResult: (output: HydratedComparisonWorkerOutput) => void;
    readonly onError?: (message: string) => void;
  }) {
    this.#createWorker = options.createWorker ?? defaultWorker;
    this.#onResult = options.onResult;
    this.#onError = options.onError ?? (() => undefined);
    this.#worker = this.#spawn();
  }

  reset(catalogs: readonly LiveCatalogResponse[], staleAccountIds: readonly string[]): number {
    this.#catalogs.clear();
    this.#stale.clear();
    for (const catalog of catalogs) this.#catalogs.set(catalog.accountId, catalog);
    for (const accountId of staleAccountIds) this.#stale.add(accountId);
    return this.#post({ type: "RESET", generation: ++this.#generation,
      catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale] });
  }

  upsert(catalog: LiveCatalogResponse, stale: boolean): number {
    this.#catalogs.set(catalog.accountId, catalog);
    if (stale) this.#stale.add(catalog.accountId); else this.#stale.delete(catalog.accountId);
    return this.#post({ type: "UPSERT", generation: ++this.#generation, catalog, stale });
  }

  setStale(accountId: string, stale: boolean): number {
    if (stale) this.#stale.add(accountId); else this.#stale.delete(accountId);
    return this.#post({ type: "SET_STALE", generation: ++this.#generation, accountId, stale });
  }

  remove(accountId: string): number {
    this.#catalogs.delete(accountId);
    this.#stale.delete(accountId);
    return this.#post({ type: "REMOVE", generation: ++this.#generation, accountId });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#worker.terminate();
  }

  #post(command: ComparisonWorkerCommand): number {
    if (!this.#stopped) this.#worker.postMessage(command);
    return command.generation;
  }

  #spawn(): WorkerLike {
    const worker = this.#createWorker();
    worker.onmessage = (event) => {
      if (this.#stopped || !isOutput(event.data) || event.data.generation < this.#generation) return;
      this.#onResult({ generation: event.data.generation,
        displayEvents: event.data.displayEvents.map((item) => hydrate(item, this.#catalogs)),
        freshEvents: event.data.freshEvents.map((item) => hydrate(item, this.#catalogs)) });
    };
    worker.onerror = () => {
      if (this.#stopped) return;
      if (this.#restartCount >= 1) {
        this.#onError("COMPARISON_WORKER_FAILED");
        return;
      }
      this.#restartCount += 1;
      worker.terminate();
      this.#worker = this.#spawn();
      this.#post({ type: "RESET", generation: ++this.#generation,
        catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale] });
    };
    return worker;
  }
}
