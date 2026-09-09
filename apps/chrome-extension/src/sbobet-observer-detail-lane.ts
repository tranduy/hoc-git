import { SbobetCatalogRefresh, type SbobetDetailBatch, type SbobetDetailRequest,
  type SbobetDetailResponse, type SbobetPrematchEvent, type SbobetRefreshOptions } from "./sbobet-catalog-refresh.js";
import { buildSbobetDetailFetchExpression, parseSbobetDetailEvent, sbobetDetailTemplateFromObserved,
  type SbobetDetailBinding, type SbobetDetailTemplate } from "./sbobet-detail-protocol.js";
import type { SbobetRequestBackoff } from "./sbobet-request-backoff.js";

export interface SbobetDetailReceipt { readonly receivedMonotonicMs: number }
export interface SbobetObserverDetailLaneOptions {
  readonly requestBackoff?: SbobetRequestBackoff;
  readonly tabId: number;
  readonly currentGeneration: () => string | null;
  readonly allocateRequestStartSequence: () => number;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
  readonly sendCommand: (tabId: number, method: string, params: Record<string, unknown>,
    sessionId?: string) => Promise<unknown>;
  /** Resolve an already attached context. This callback must never create/attach one. */
  readonly resolveContext: (binding: SbobetDetailBinding) => number | null | Promise<number | null>;
  /** Verify source/tab generation, origin, and frame+loader or verified worker target/session. */
  readonly isBindingCurrent: (binding: SbobetDetailBinding) => boolean | Promise<boolean>;
  /** The observer must recheck signal, epoch, and document immediately before its external commit. */
  readonly emit: (batch: SbobetDetailBatch, signal: AbortSignal, template: SbobetDetailTemplate,
    receipt: SbobetDetailReceipt) => void | Promise<void>;
  readonly refresh?: Omit<SbobetRefreshOptions, "request" | "onBatch" | "now" |
    "allocateRequestStartSequence" | "onFailure">;
}

export interface SbobetObserverDetailDiagnostics {
  readonly state: "NO_TEMPLATE" | "UNPROVEN" | "READY" | "NO_ROSTER" | "DISPOSED";
  readonly rosterSize: number;
  readonly requestsStarted: number;
  readonly batchesEmitted: number;
  readonly failures: number;
  readonly inFlight: number;
  readonly lastStatus: number | null;
}

interface RememberedTemplate {
  readonly identity: SbobetDetailTemplate;
  readonly snapshot: SbobetDetailTemplate;
  readonly generation: string;
  verified: boolean;
}
interface Receipt {
  readonly startedAtMs: number;
  readonly template: RememberedTemplate;
  readonly contextId: number;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}
interface Roster { readonly generation: string; readonly events: readonly SbobetPrematchEvent[] }

/** Caller-driven detail requests on an existing observer attachment; no independent cadence. */
export class SbobetObserverDetailLane {
  readonly #options: SbobetObserverDetailLaneOptions;
  readonly #now: () => number;
  readonly #monotonicNow: () => number;
  readonly #refresh: SbobetCatalogRefresh;
  readonly #receipts = new Map<AbortSignal, Receipt>();
  readonly #fetchTimeoutMs: number;
  #template: RememberedTemplate | null = null;
  #roster: Roster | null = null;
  #generation: string | null = null;
  #disposed = false;
  #requestsStarted = 0;
  #batchesEmitted = 0;
  #failures = 0;
  #inFlight = 0;
  #lastStatus: number | null = null;

  constructor(options: SbobetObserverDetailLaneOptions) {
    if (!Number.isSafeInteger(options.tabId) || options.tabId < 0) throw new Error("SBOBET_DETAIL_TAB_INVALID");
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#fetchTimeoutMs = Math.min(options.refresh?.timeoutMs ?? 8_000, 30_000);
    this.#refresh = new SbobetCatalogRefresh({ ...options.refresh, now: this.#now,
      canRequest: () => !options.requestBackoff?.paused() && options.refresh?.canRequest?.() !== false,
      allocateRequestStartSequence: options.allocateRequestStartSequence,
      request: (input) => this.#request(input), onBatch: (batch, signal) => this.#emit(batch, signal),
      onFailure: () => {
        this.#failures = increment(this.#failures);
        // Per-event retry and physical capacity stay with the detail scheduler.
        // Missing/invalid detail evidence is not a provider-wide HTTP refusal.
      } });
  }

  /** Supply only a request observed and bound by the existing observer. Structural validity is not completeness proof. */
  rememberTemplate(template: SbobetDetailTemplate, generation: string): boolean {
    if (!this.#synchronize() || generation !== this.#generation) return false;
    let validated: SbobetDetailTemplate | null;
    try { validated = sbobetDetailTemplateFromObserved({ ...template, method: "GET" }); }
    catch { return false; }
    if (validated === null || validated.observedEventId !== template.observedEventId) return false;
    if (this.#template?.identity === template && sameTemplate(this.#template.snapshot, validated)) return true;
    this.#resetRequests();
    this.#template = { identity: template, generation, verified: false,
      snapshot: Object.freeze({ ...validated, binding: Object.freeze(validated.binding), headers: Object.freeze(validated.headers) }) };
    return true;
  }

  /** Future independent evidence only: neither a well-shaped body nor discovery telemetry establishes this proof. */
  setCompletenessVerified(template: SbobetDetailTemplate, generation: string, verified = true): boolean {
    if (!this.#synchronize()) return false;
    const remembered = this.#template;
    if (remembered === null || remembered.identity !== template || remembered.generation !== generation ||
      !sameTemplate(remembered.snapshot, template)) return false;
    if (remembered.verified !== verified) {
      this.#resetRequests();
      remembered.verified = verified;
    }
    return true;
  }

  /** Replace only from a complete validated PREMATCH roster, never a sparse delta. */
  setRoster(input: Roster): boolean {
    if (!this.#synchronize() || input.generation !== this.#generation) return false;
    try {
      const roster = { generation: input.generation, events: input.events.map((event) => ({ ...event })) };
      this.#refresh.setRoster(roster);
      this.#roster = roster;
      return true;
    } catch { return false; }
  }

  tick(): Promise<void> {
    if (!this.#synchronize() || this.#template?.verified !== true || this.#roster === null) return Promise.resolve();
    return this.#refresh.tick();
  }

  diagnostics(): SbobetObserverDetailDiagnostics {
    this.#synchronize();
    return { state: this.#disposed ? "DISPOSED" : this.#template === null ? "NO_TEMPLATE" :
      !this.#template.verified ? "UNPROVEN" : this.#roster === null ? "NO_ROSTER" : "READY",
    rosterSize: this.#roster?.events.length ?? 0, requestsStarted: this.#requestsStarted,
    batchesEmitted: this.#batchesEmitted, failures: this.#failures, inFlight: this.#inFlight, lastStatus: this.#lastStatus };
  }

  dispose(): void {
    this.#disposed = true;
    this.#template = null;
    this.#roster = null;
    this.#receipts.clear();
    this.#refresh.dispose();
  }

  #currentGeneration(): string | null {
    try {
      const value = this.#options.currentGeneration();
      return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
    } catch { return null; }
  }

  #synchronize(): boolean {
    if (this.#disposed) return false;
    const generation = this.#currentGeneration();
    if (generation !== this.#generation) {
      if (this.#roster !== null) this.#refresh.setRoster({ generation: this.#roster.generation, events: [] });
      this.#generation = generation;
      this.#template = null;
      this.#roster = null;
      this.#receipts.clear();
    }
    return generation !== null;
  }

  #resetRequests(): void {
    this.#receipts.clear();
    if (this.#roster === null) return;
    // Keep the scheduler instance: physically pending CDP operations must continue occupying capacity.
    this.#refresh.setRoster({ generation: this.#roster.generation, events: [] });
    this.#refresh.setRoster(this.#roster);
  }

  #eligible(template: RememberedTemplate, signal: AbortSignal): boolean {
    return !this.#disposed && !signal.aborted && this.#template === template && template.verified &&
      this.#roster?.generation === template.generation && this.#currentGeneration() === template.generation;
  }

  async #boundContext(template: RememberedTemplate, signal: AbortSignal): Promise<number | null> {
    if (!this.#eligible(template, signal)) return null;
    const contextId = await this.#options.resolveContext(template.snapshot.binding);
    if (!this.#eligible(template, signal) || !Number.isSafeInteger(contextId) || contextId === null || contextId <= 0) return null;
    if (!await this.#options.isBindingCurrent(template.snapshot.binding) || !this.#eligible(template, signal)) return null;
    return contextId;
  }

  async #request(input: SbobetDetailRequest): Promise<SbobetDetailResponse> {
    if (this.#options.requestBackoff?.paused()) return failure();
    const startedAtMs = this.#now();
    const template = this.#template;
    if (template === null || template.generation !== input.generation || !this.#eligible(template, input.signal)) return failure();
    this.#inFlight += 1;
    try {
      const contextId = await this.#boundContext(template, input.signal);
      if (contextId === null) return failure();
      const expression = buildSbobetDetailFetchExpression(template.snapshot, input.eventId, {
        timeoutMs: this.#fetchTimeoutMs, marketContainerCompletenessVerified: template.verified });
      if (expression === null || !this.#eligible(template, input.signal) ||
        this.#options.requestBackoff?.paused()) return failure();
      this.#requestsStarted = increment(this.#requestsStarted);
      const response = await this.#options.sendCommand(this.#options.tabId, "Runtime.evaluate", {
        expression, contextId, awaitPromise: true, returnByValue: true
      }, template.snapshot.binding.sessionId);
      const wire = record(response) && record(response.result) && record(response.result.value)
        ? response.result.value : null;
      // Stamp before any asynchronous document/context verification.
      const observedAtMs = this.#now();
      const receivedMonotonicMs = this.#monotonicNow();
      if (!this.#eligible(template, input.signal) || !Number.isSafeInteger(observedAtMs) || observedAtMs < 0 ||
        !Number.isFinite(receivedMonotonicMs) || receivedMonotonicMs < 0 ||
        await this.#boundContext(template, input.signal) !== contextId || !this.#eligible(template, input.signal)) return failure();
      if (typeof wire?.status === "number" && wire.status >= 400 && wire.status <= 599) {
        this.#options.requestBackoff?.fail(wire.status, typeof wire.retryAfterMs === "number" ? wire.retryAfterMs : 0);
      }
      if (!record(response) || response.exceptionDetails !== undefined || !record(response.result) ||
        !record(response.result.value)) return failure();
      const result = response.result.value;
      if (typeof result.status !== "number" || !Number.isSafeInteger(result.status) ||
        result.status !== 0 && (result.status < 100 || result.status > 599)) return failure();
      this.#lastStatus = result.status;
      if (result.status !== 200) return { status: result.status, marketContainerComplete: false,
        ...(typeof result.retryAfterMs === "number" && Number.isFinite(result.retryAfterMs) && result.retryAfterMs >= 0
          ? { retryAfterMs: result.retryAfterMs } : {}) };
      const event = result.marketContainerComplete === true ? parseSbobetDetailEvent(result.event, input.eventId) : null;
      if (event === null) return failure();
      const receipt = { template, contextId, observedAtMs, receivedMonotonicMs, startedAtMs };
      this.#receipts.set(input.signal, receipt);
      input.signal.addEventListener("abort", () => this.#receipts.delete(input.signal), { once: true });
      return { status: 200, marketContainerComplete: true, event };
    } catch {
      return failure();
    }
    finally { this.#inFlight -= 1; }
  }

  async #emit(batch: SbobetDetailBatch, signal: AbortSignal): Promise<void> {
    const receipt = this.#receipts.get(signal);
    try {
      if (receipt === undefined || batch.generation !== receipt.template.generation ||
        !this.#eligible(receipt.template, signal) ||
        await this.#boundContext(receipt.template, signal) !== receipt.contextId ||
        !this.#eligible(receipt.template, signal)) throw new Error("SBOBET_DETAIL_STALE");
      await this.#options.emit({ ...batch, observedAtMs: receipt.observedAtMs }, signal, receipt.template.snapshot,
        { receivedMonotonicMs: receipt.receivedMonotonicMs });
      if (this.#eligible(receipt.template, signal)) this.#options.requestBackoff?.succeeded(receipt.startedAtMs);
      if (this.#eligible(receipt.template, signal)) this.#batchesEmitted = increment(this.#batchesEmitted);
    } finally { this.#receipts.delete(signal); }
  }
}

function sameTemplate(left: SbobetDetailTemplate, right: SbobetDetailTemplate): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function failure(): SbobetDetailResponse { return { status: 0, marketContainerComplete: false }; }
function increment(value: number): number { return Math.min(value + 1, Number.MAX_SAFE_INTEGER); }
