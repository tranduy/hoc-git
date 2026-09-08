import { sbobetMoreBatchFromResponse, type SbobetMoreBatch, type SbobetMoreRequest } from "./sbobet-more-protocol.js";

export interface SbobetPrematchEvent {
  readonly eventId: string;
  readonly startAtUtcMs: number;
  readonly phase: "PREMATCH";
}

export interface SbobetDetailRequest {
  readonly generation: string;
  readonly eventId: string;
  readonly requestStartSequence: number;
  readonly signal: AbortSignal;
}

/** The observer supplies the verified authenticated wire request and unwraps its exact event. */
export interface SbobetDetailResponse {
  readonly status: number;
  readonly event?: unknown;
  /** Set only when provider request/response semantics prove complete event market membership. */
  readonly marketContainerComplete?: boolean;
  readonly retryAfterMs?: number;
}

export interface SbobetDetailBatch {
  readonly kind: "SBOBET_EVENT_DETAIL";
  /** Source lifecycle epoch, stable across ordinary main-feed refreshes. */
  readonly generation: string;
  readonly eventId: string;
  readonly requestStartSequence: number;
  readonly observedAtMs: number;
  readonly marketContainerComplete: true;
  readonly event: Readonly<Record<string, unknown>> & {
    readonly "8": string | number;
    readonly "7": Readonly<Record<string, readonly unknown[]>>;
  };
}

export interface SbobetRefreshOptions {
  readonly mode?: "COMPLETE_EVENT";
  readonly request: (input: SbobetDetailRequest) => Promise<SbobetDetailResponse>;
  /** An asynchronous emitter must check signal/source epoch again before committing externally. */
  readonly onBatch: (batch: SbobetDetailBatch, signal: AbortSignal) => void | Promise<void>;
  readonly allocateRequestStartSequence: () => number;
  readonly now?: () => number;
  readonly nearTtlMs?: number;
  readonly farTtlMs?: number;
  readonly nearWindowMs?: number;
  readonly timeoutMs?: number;
  readonly backoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly maxRetryAfterMs?: number;
  readonly minimumDelayMs?: number;
  readonly maxConcurrent?: number;
  readonly maxRequestsPerTick?: number;
  readonly maxEvents?: number;
  readonly onFailure?: (failure: { readonly generation: string; readonly eventId: string;
    readonly reason: string; readonly retryAtMs: number }) => void;
}

export interface SbobetMoreRefreshResponse {
  readonly status: number;
  readonly request?: SbobetMoreRequest;
  readonly body?: string;
  readonly retryAfterMs?: number;
}

export interface SbobetMoreRefreshOptions extends Omit<SbobetRefreshOptions, "mode" | "request" | "onBatch"> {
  readonly mode: "COMPLEMENTARY_MORE";
  readonly request: (input: SbobetDetailRequest) => Promise<SbobetMoreRefreshResponse>;
  readonly onBatch: (batch: SbobetMoreBatch, signal: AbortSignal) => void | Promise<void>;
}

interface EventState {
  event: SbobetPrematchEvent;
  receivedAtMs: number | null;
  retryAtMs: number;
  failures: number;
}
interface ActiveRequest {
  readonly state: EventState;
  readonly controller: AbortController;
}

/** Caller-driven; timers only bound requests and space starts within the current finite batch. */
export class SbobetCatalogRefresh {
  readonly #options: SbobetRefreshOptions | SbobetMoreRefreshOptions;
  readonly #now: () => number;
  readonly #nearTtlMs: number;
  readonly #farTtlMs: number;
  readonly #nearWindowMs: number;
  readonly #timeoutMs: number;
  readonly #backoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #maxRetryAfterMs: number;
  readonly #minimumDelayMs: number;
  readonly #maxConcurrent: number;
  readonly #maxRequestsPerTick: number;
  readonly #maxEvents: number;
  readonly #events = new Map<string, EventState>();
  readonly #active = new Set<ActiveRequest>();
  #generation: string | null = null;
  #lifecycle = {};
  #tick: Promise<void> | null = null;
  #drainController: AbortController | null = null;
  #lastRequestSequence = -1;
  #providerRetryAtMs = 0;
  #nextRequestAtMs = 0;
  #disposed = false;

  constructor(options: SbobetRefreshOptions | SbobetMoreRefreshOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#nearTtlMs = positive(options.nearTtlMs ?? 30_000);
    this.#farTtlMs = positive(options.farTtlMs ?? 120_000);
    this.#nearWindowMs = positive(options.nearWindowMs ?? 6 * 60 * 60_000);
    this.#timeoutMs = positive(options.timeoutMs ?? 8_000);
    this.#backoffMs = positive(options.backoffMs ?? 2_000);
    this.#maxBackoffMs = positive(options.maxBackoffMs ?? 60_000);
    this.#maxRetryAfterMs = positive(options.maxRetryAfterMs ?? 300_000);
    this.#minimumDelayMs = options.minimumDelayMs ?? 250;
    this.#maxConcurrent = positive(options.maxConcurrent ?? 2);
    this.#maxRequestsPerTick = positive(options.maxRequestsPerTick ?? 4);
    this.#maxEvents = positive(options.maxEvents ?? 2_048);
    if (!Number.isSafeInteger(this.#minimumDelayMs) || this.#minimumDelayMs < 0 ||
      this.#nearTtlMs > this.#farTtlMs || this.#backoffMs > this.#maxBackoffMs ||
      this.#maxConcurrent > 8 || this.#maxRequestsPerTick > 128 || this.#maxEvents > 20_000) {
      throw new Error("SBOBET_REFRESH_OPTIONS_INVALID");
    }
  }

  /** Only complete, validated roster membership belongs here; sparse deltas must be merged first. */
  setRoster(input: { readonly generation: string; readonly events: readonly SbobetPrematchEvent[] }): void {
    if (this.#disposed) throw new Error("SBOBET_REFRESH_DISPOSED");
    const ids = new Set<string>();
    if (typeof input.generation !== "string" || input.generation.length === 0 ||
      input.generation.length > 512 || input.events.length > this.#maxEvents) {
      throw new Error("SBOBET_ROSTER_INVALID");
    }
    for (const item of input.events) {
      if (typeof item.eventId !== "string" || !/^\d{1,30}$/u.test(item.eventId) ||
        !Number.isSafeInteger(item.startAtUtcMs) || item.startAtUtcMs < 0 ||
        item.phase !== "PREMATCH" || ids.has(item.eventId)) throw new Error("SBOBET_ROSTER_INVALID");
      ids.add(item.eventId);
    }
    if (input.generation !== this.#generation || ids.size !== this.#events.size ||
      input.events.some(item => this.#events.get(item.eventId)?.event.startAtUtcMs !== item.startAtUtcMs)) {
      this.#drainController?.abort();
    }
    if (input.generation !== this.#generation) {
      this.#lifecycle = {};
      this.#generation = input.generation;
      this.#lastRequestSequence = -1;
      this.#events.clear();
      this.#providerRetryAtMs = 0;
      for (const active of this.#active) active.controller.abort();
    }
    for (const [id, state] of this.#events) {
      if (ids.has(id)) continue;
      this.#events.delete(id);
      for (const active of this.#active) if (active.state === state) active.controller.abort();
    }
    for (const item of input.events) {
      const state = this.#events.get(item.eventId);
      if (state !== undefined) state.event = { ...item };
      else this.#events.set(item.eventId, { event: { ...item }, receivedAtMs: null, retryAtMs: 0, failures: 0 });
    }
  }

  tick(): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#tick !== null) return this.#tick;
    const operation = this.#drain().finally(() => { if (this.#tick === operation) this.#tick = null; });
    this.#tick = operation;
    return operation;
  }

  dispose(): void {
    this.#disposed = true;
    this.#lifecycle = {};
    this.#events.clear();
    this.#drainController?.abort();
    for (const active of this.#active) active.controller.abort();
  }

  #dueAt(state: EventState, now: number): number {
    const ttl = state.event.startAtUtcMs - now <= this.#nearWindowMs ? this.#nearTtlMs : this.#farTtlMs;
    return Math.max(state.retryAtMs, state.receivedAtMs === null ? 0 : state.receivedAtMs + ttl);
  }

  async #drain(): Promise<void> {
    const generation = this.#generation;
    const lifecycle = this.#lifecycle;
    const now = this.#now();
    if (generation === null || now < this.#providerRetryAtMs || now < this.#nextRequestAtMs) return;
    const selected = [...this.#events.values()].filter((state) => this.#dueAt(state, now) <= now &&
      ![...this.#active].some((active) => active.state === state))
      .sort((a, b) => this.#dueAt(a, now) - this.#dueAt(b, now) || a.event.startAtUtcMs - b.event.startAtUtcMs)
      .slice(0, this.#maxRequestsPerTick);
    const controller = new AbortController();
    this.#drainController = controller;
    const running = new Set<Promise<void>>();
    const started: Promise<void>[] = [];
    let next = 0;
    try {
      while (next < selected.length && !controller.signal.aborted &&
        this.#now() >= this.#providerRetryAtMs && lifecycle === this.#lifecycle && !this.#disposed) {
        if (this.#active.size >= this.#maxConcurrent) {
          // A timed-out callback can retain a physical slot after its logical request ends.
          // Leave that slot to a later caller tick; never wait indefinitely for its promise.
          if (running.size === 0) break;
          await Promise.race(running);
          continue;
        }
        const delay = this.#nextRequestAtMs - this.#now();
        if (delay > 0) {
          await waitForSpacing(delay, controller.signal);
          continue; // Recheck ownership, capacity and provider backoff after every wait.
        }
        const state = selected[next++]!;
        if (this.#events.get(state.event.eventId) !== state) continue;
        const operation = this.#refresh(state, generation, lifecycle);
        started.push(operation);
        running.add(operation);
        void operation.then(() => running.delete(operation), () => running.delete(operation));
      }
      await Promise.all(started);
    } finally {
      if (this.#drainController === controller) this.#drainController = null;
    }
  }

  async #refresh(state: EventState, generation: string, lifecycle: object): Promise<void> {
    const requestStartSequence = this.#options.allocateRequestStartSequence();
    if (!Number.isSafeInteger(requestStartSequence) || requestStartSequence < 0 ||
      requestStartSequence < this.#lastRequestSequence) throw new Error("SBOBET_REQUEST_SEQUENCE_INVALID");
    this.#lastRequestSequence = requestStartSequence;
    this.#nextRequestAtMs = this.#now() + this.#minimumDelayMs;
    const eventId = state.event.eventId;
    const current = (): boolean => !this.#disposed && lifecycle === this.#lifecycle &&
      this.#events.get(eventId) === state;
    const active: ActiveRequest = { state, controller: new AbortController() };
    this.#active.add(active);
    let timedOut = false;
    let cancelled!: () => void;
    const aborted = new Promise<{ readonly kind: "ABORTED" }>((resolve) => {
      cancelled = () => resolve({ kind: "ABORTED" });
      active.controller.signal.addEventListener("abort", cancelled, { once: true });
    });
    const timer = setTimeout(() => { timedOut = true; active.controller.abort(); }, this.#timeoutMs);
    let request: Promise<SbobetDetailResponse | SbobetMoreRefreshResponse>;
    try { request = Promise.resolve(this.#options.request({ eventId, generation, requestStartSequence,
      signal: active.controller.signal })); }
    catch { request = Promise.reject(new Error("SBOBET_DETAIL_REQUEST_FAILED")); }
    let pendingCallbacks = 1;
    let finished = false;
    const release = (): void => { if (finished && pendingCallbacks === 0) this.#active.delete(active); };
    // Uncooperative request/emission callbacks retain capacity until they really settle.
    const settled = (): void => { pendingCallbacks -= 1; release(); };
    void request.then(settled, settled);
    const received = request.then((result) => ({ kind: "RESPONSE" as const, result, observedAtMs: this.#now() }),
      () => ({ kind: "ERROR" as const }));
    try {
      const result = await Promise.race([received, aborted]);
      if (!current()) return;
      if (result.kind !== "RESPONSE") {
        if (result.kind === "ERROR" || timedOut) this.#failure(state, generation,
          timedOut ? "REQUEST_TIMEOUT" : "REQUEST_FAILED");
        return;
      }
      if (result.result.status !== 200) {
        this.#failure(state, generation, `HTTP_${result.result.status}`, result.result.retryAfterMs,
          result.result.status === 429);
        return;
      }
      if (!Number.isSafeInteger(result.observedAtMs) || result.observedAtMs < 0) {
        this.#failure(state, generation, "DETAIL_INVALID");
        return;
      }
      const options = this.#options;
      let emitBatch: () => void | Promise<void>;
      if (options.mode === "COMPLEMENTARY_MORE") {
        const response = result.result as SbobetMoreRefreshResponse;
        const batch = response.request?.eventId === eventId && typeof response.body === "string"
          ? sbobetMoreBatchFromResponse(response.request, response.body, {
            generation, requestStartSequence, observedAtMs: result.observedAtMs }) : null;
        // Empty/metadata-only or invalid More is not full-event membership.
        if (batch === null) { this.#failure(state, generation, "DETAIL_INVALID"); return; }
        emitBatch = () => options.onBatch(batch, active.controller.signal);
      } else {
        const response = result.result as SbobetDetailResponse;
        const event = response.marketContainerComplete === true ? completeNativeEvent(response.event, eventId) : null;
        if (event === null) { this.#failure(state, generation, "DETAIL_INVALID"); return; }
        emitBatch = () => options.onBatch({ kind: "SBOBET_EVENT_DETAIL", generation, eventId,
          requestStartSequence, observedAtMs: result.observedAtMs, marketContainerComplete: true, event },
        active.controller.signal);
      }
      let emission: Promise<void>;
      try {
        emission = Promise.resolve(emitBatch());
      } catch { emission = Promise.reject(new Error("SBOBET_DETAIL_EMIT_FAILED")); }
      pendingCallbacks += 1;
      const delivered = emission.then(() => { settled(); return { kind: "EMITTED" as const }; },
        () => { settled(); return { kind: "ERROR" as const }; });
      const outcome = await Promise.race([delivered, aborted]);
      if (!current()) return;
      if (outcome.kind !== "EMITTED") {
        this.#failure(state, generation, timedOut ? "EMIT_TIMEOUT" : "EMIT_FAILED");
        return;
      }
      state.receivedAtMs = result.observedAtMs;
      state.retryAtMs = 0;
      state.failures = 0;
    } finally {
      clearTimeout(timer);
      active.controller.signal.removeEventListener("abort", cancelled);
      finished = true;
      release();
    }
  }

  #failure(state: EventState, generation: string, reason: string, retryAfterMs?: number,
    providerLimited = false): void {
    state.failures = Math.min(state.failures + 1, 32);
    const exponential = Math.min(this.#maxBackoffMs, this.#backoffMs * 2 ** (state.failures - 1));
    const providerDelay = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(this.#maxRetryAfterMs, retryAfterMs) : 0;
    state.retryAtMs = this.#now() + Math.max(exponential, providerDelay);
    if (providerLimited) {
      this.#providerRetryAtMs = Math.max(this.#providerRetryAtMs, state.retryAtMs);
      this.#drainController?.abort();
    }
    try { this.#options.onFailure?.({ generation, eventId: state.event.eventId, reason, retryAtMs: state.retryAtMs }); }
    catch { /* Diagnostics must not interrupt independent provider work. */ }
  }
}

function waitForSpacing(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function completeNativeEvent(value: unknown, eventId: string): SbobetDetailBatch["event"] | null {
  if (!record(value) || !Object.hasOwn(value, "8") || !Object.hasOwn(value, "7") ||
    (typeof value["8"] !== "string" && (typeof value["8"] !== "number" ||
      !Number.isSafeInteger(value["8"]))) || String(value["8"]) !== eventId || !record(value["7"])) return null;
  const groups = Object.values(value["7"]);
  if (groups.length > 256 || groups.some((rows) => !Array.isArray(rows)) ||
    groups.reduce<number>((count, rows) => count + (rows as unknown[]).length, 0) > 20_000) return null;
  let visited = 0;
  const ancestors = new Set<object>();
  const jsonValue = (item: unknown, depth: number): boolean => {
    if (++visited > 100_000 || depth > 20) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item !== "object" || ancestors.has(item)) return false;
    ancestors.add(item);
    const valid = Object.values(item).every((child) => jsonValue(child, depth + 1));
    ancestors.delete(item);
    return valid;
  };
  try {
    if (!jsonValue(value, 0)) return null;
    const encoded = JSON.stringify(value);
    return encoded.length <= 4_000_000 ? JSON.parse(encoded) as SbobetDetailBatch["event"] : null;
  } catch { return null; }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("SBOBET_REFRESH_OPTIONS_INVALID");
  return value;
}
