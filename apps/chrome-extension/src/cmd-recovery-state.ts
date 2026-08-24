export interface CmdRecoveryDocument {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly frameId: string;
  readonly loaderId: string;
}

export interface CmdRecoveryOptions {
  readonly nowMs: number;
  readonly maxAttempts: number;
  readonly deadlineMs: number;
}

export interface CmdRecoveryCompletion {
  readonly document: CmdRecoveryDocument;
  readonly providerFunctionCode: number;
  readonly responseComplete: boolean;
}

export type CmdRecoveryPageResult = "busy" | "baseline-requested";

export type CmdRecoveryFailureReason = "ATTEMPT_CAP" | "DEADLINE" |
  "DOCUMENT_CHANGED" | "ABORTED" | "RELEASED";

export type CmdRecoveryResolution =
  | { readonly outcome: "SUCCESS"; readonly attempts: number }
  | { readonly outcome: "FAILURE"; readonly reason: CmdRecoveryFailureReason; readonly attempts: number };

export type CmdRecoveryStep =
  | { readonly kind: "ATTEMPT"; readonly attempt: number }
  | { readonly kind: "WAITING" }
  | { readonly kind: "RESOLVED"; readonly resolution: CmdRecoveryResolution };

export class CmdRecoverySession {
  readonly #document: CmdRecoveryDocument;
  readonly #maxAttempts: number;
  readonly #deadlineAtMs: number;
  #attempts = 0;
  #awaitingAttempt: number | null = null;
  #resolution: CmdRecoveryResolution | null = null;

  constructor(document: CmdRecoveryDocument, options: CmdRecoveryOptions) {
    if (!Number.isFinite(options.nowMs) || !Number.isFinite(options.deadlineMs) || options.deadlineMs <= 0 ||
      !Number.isSafeInteger(options.maxAttempts) || options.maxAttempts <= 0) {
      throw new TypeError("CMD recovery requires a positive attempt cap and finite deadline");
    }
    this.#document = { ...document };
    this.#maxAttempts = options.maxAttempts;
    this.#deadlineAtMs = options.nowMs + options.deadlineMs;
  }

  get resolution(): CmdRecoveryResolution | null { return this.#resolution; }

  matches(document: CmdRecoveryDocument): boolean {
    return document.sourceId === this.#document.sourceId &&
      document.sourceEpoch === this.#document.sourceEpoch &&
      document.frameId === this.#document.frameId && document.loaderId === this.#document.loaderId;
  }

  nextAttempt(nowMs: number): CmdRecoveryStep {
    this.expire(nowMs);
    if (this.#resolution !== null) return { kind: "RESOLVED", resolution: this.#resolution };
    if (this.#awaitingAttempt !== null) return { kind: "WAITING" };
    if (this.#attempts >= this.#maxAttempts) {
      const resolution = this.#fail("ATTEMPT_CAP");
      return { kind: "RESOLVED", resolution };
    }
    this.#attempts += 1;
    this.#awaitingAttempt = this.#attempts;
    return { kind: "ATTEMPT", attempt: this.#attempts };
  }

  recordPageResult(attempt: number, result: CmdRecoveryPageResult,
    nowMs: number): CmdRecoveryResolution | null {
    const expired = this.expire(nowMs);
    if (expired !== null || this.#resolution !== null) return expired;
    if (this.#awaitingAttempt !== attempt) return null;
    void result;
    this.#awaitingAttempt = null;
    return null;
  }

  expire(nowMs: number): CmdRecoveryResolution | null {
    if (this.#resolution !== null || nowMs < this.#deadlineAtMs) return null;
    return this.#fail("DEADLINE");
  }

  complete(nowMs: number): CmdRecoveryResolution | null {
    const expired = this.expire(nowMs);
    if (expired !== null || this.#resolution !== null) return expired;
    this.#resolution = { outcome: "SUCCESS", attempts: this.#attempts };
    this.#awaitingAttempt = null;
    return this.#resolution;
  }

  abort(reason: Extract<CmdRecoveryFailureReason,
    "DOCUMENT_CHANGED" | "ABORTED" | "RELEASED">): CmdRecoveryResolution | null {
    if (this.#resolution !== null) return null;
    return this.#fail(reason);
  }

  #fail(reason: CmdRecoveryFailureReason): CmdRecoveryResolution {
    this.#resolution = { outcome: "FAILURE", reason, attempts: this.#attempts };
    this.#awaitingAttempt = null;
    return this.#resolution;
  }
}

export class CmdRecoveryState {
  readonly #sessions = new Map<string, CmdRecoverySession>();

  begin(document: CmdRecoveryDocument, options: CmdRecoveryOptions): CmdRecoverySession {
    const existing = this.#sessions.get(document.sourceId);
    if (existing?.resolution === null) {
      if (existing.matches(document)) return existing;
      existing.abort("DOCUMENT_CHANGED");
    }
    const session = new CmdRecoverySession(document, options);
    this.#sessions.set(document.sourceId, session);
    return session;
  }

  complete(completion: CmdRecoveryCompletion, nowMs: number): CmdRecoveryResolution | null {
    if (completion.providerFunctionCode !== 1 || !completion.responseComplete) return null;
    const session = this.#sessions.get(completion.document.sourceId);
    return session?.matches(completion.document) === true ? session.complete(nowMs) : null;
  }

  abort(document: CmdRecoveryDocument): CmdRecoveryResolution | null {
    const session = this.#sessions.get(document.sourceId);
    return session?.matches(document) === true ? session.abort("ABORTED") : null;
  }

  release(sourceId: string): CmdRecoveryResolution | null {
    const session = this.#sessions.get(sourceId);
    if (session === undefined) return null;
    this.#sessions.delete(sourceId);
    return session.abort("RELEASED");
  }
}
