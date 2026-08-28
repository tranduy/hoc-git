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

const COMPETITION_LINKS_KEY = "comparisonCompetitionLinksV1";
// A page reload is not evidence that two books stopped meaning one competition,
// but it used to throw away everything proving they did - and a league's second
// fixture is a match day away, so what was thrown away took days to rebuild.
const MAX_STORED_COMPETITION_LINKS = 4_000;

function defaultLinkStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try { return window.localStorage; } catch { return null; }
}

function readCompetitionLinks(storage: Pick<Storage, "getItem" | "setItem"> | null): readonly string[] {
  if (storage === null) return [];
  try {
    const stored: unknown = JSON.parse(storage.getItem(COMPETITION_LINKS_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored.filter((entry): entry is string => typeof entry === "string")
        .slice(0, MAX_STORED_COMPETITION_LINKS)
      : [];
  } catch { return []; }
}

export class ComparisonWorkerClient {
  readonly #createWorker: () => WorkerLike;
  readonly #onResult: (output: HydratedComparisonWorkerOutput) => void;
  readonly #onError: (message: string) => void;
  readonly #catalogs = new Map<string, LiveCatalogResponse>();
  readonly #stale = new Set<string>();
  readonly #linkStorage: Pick<Storage, "getItem" | "setItem"> | null;
  #links: readonly string[];
  #worker: WorkerLike;
  #generation = 0;
  #restartCount = 0;
  #stopped = false;

  constructor(options: {
    readonly createWorker?: () => WorkerLike;
    readonly onResult: (output: HydratedComparisonWorkerOutput) => void;
    readonly onError?: (message: string) => void;
    readonly competitionLinkStorage?: Pick<Storage, "getItem" | "setItem"> | null;
  }) {
    this.#createWorker = options.createWorker ?? defaultWorker;
    this.#onResult = options.onResult;
    this.#onError = options.onError ?? (() => undefined);
    this.#linkStorage = options.competitionLinkStorage === undefined
      ? defaultLinkStorage() : options.competitionLinkStorage;
    this.#links = readCompetitionLinks(this.#linkStorage);
    this.#worker = this.#spawn();
  }

  reset(catalogs: readonly LiveCatalogResponse[], staleAccountIds: readonly string[]): number {
    this.#catalogs.clear();
    this.#stale.clear();
    for (const catalog of catalogs) this.#catalogs.set(catalog.accountId, catalog);
    for (const accountId of staleAccountIds) this.#stale.add(accountId);
    return this.#post({ type: "RESET", generation: ++this.#generation,
      catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale],
      competitionLinks: this.#links });
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

  #storeLinks(links: readonly string[]): void {
    this.#links = links.slice(0, MAX_STORED_COMPETITION_LINKS);
    // Storage a browser has filled or refused is a lost head start, not a
    // reason to stop comparing: the session keeps its own copy either way.
    try { this.#linkStorage?.setItem(COMPETITION_LINKS_KEY, JSON.stringify(this.#links)); }
    catch { /* quota or a blocked store; the next session simply starts over */ }
  }

  #post(command: ComparisonWorkerCommand): number {
    if (!this.#stopped) this.#worker.postMessage(command);
    return command.generation;
  }

  #spawn(): WorkerLike {
    const worker = this.#createWorker();
    worker.onmessage = (event) => {
      if (this.#stopped || !isOutput(event.data) || event.data.generation < this.#generation) return;
      if (Array.isArray(event.data.competitionLinks)) this.#storeLinks(event.data.competitionLinks);
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
        catalogs: [...this.#catalogs.values()], staleAccountIds: [...this.#stale],
        competitionLinks: this.#links });
    };
    return worker;
  }
}
