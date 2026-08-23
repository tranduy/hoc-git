import type { ChromeLobbyId } from "@tool-chenh/contracts";
import type { ProviderFeedRegistry } from "./provider-feed-registry.js";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./provider-feed-types.js";
import { refreshBridgeProviderSources } from "./provider-source-refresh.js";

type FabetProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";
type RecoveryStage = "SOFT" | "HARD";
type RecoveryFeedRegistry = Pick<ProviderFeedRegistry,
  "snapshot" | "subscribe" | "waitForFreshBaseline">;

interface RecoveryControlPlane {
  requestLobbySnapshot(lobby: ChromeLobbyId): number;
  ensureLobby(lobby: ChromeLobbyId, url: string): number;
  restoreLobby(lobby: ChromeLobbyId): number;
}

interface AutomaticSourceRecoveryOptions {
  readonly controlPlane: RecoveryControlPlane;
  readonly feedRegistry: RecoveryFeedRegistry;
  readonly refreshFabetLaunches: (signal: AbortSignal) => Promise<void>;
  readonly withLatestFabetLaunch: <T>(provider: FabetProvider, category: "FOOTBALL",
    consume: (url: string) => Promise<T>, minAcquiredAtMs: number, signal?: AbortSignal) => Promise<T>;
  readonly baselineTimeoutMs?: number;
  readonly now?: () => number;
  readonly isRecoverySuppressed?: (accountId: string) => boolean;
  readonly onError?: (accountId: string, error: unknown) => void;
}

export interface RecoveryResult {
  readonly accountId: string;
  readonly stage: RecoveryStage;
  readonly outcome: "RECOVERED" | "DELIVERED" | "NO_SOURCE" | "ACTION_REQUIRED";
  readonly reason: string | null;
}

interface RecoverySource {
  readonly provider: FabetProvider | null;
  readonly hardLobby: ChromeLobbyId;
  readonly softLobbies: ReadonlySet<ChromeLobbyId>;
}

const SOURCES = new Map<string, RecoverySource>([
  ["catalog-source:CMD:FOOTBALL", source(null, "CMD", ["CMD"])],
  ["catalog-source:IM:FOOTBALL", source("IM", "IM", ["IM"])],
  ["catalog-source:SABA:FOOTBALL", source("SABA", "SABA", ["SABA"])],
  ["catalog-source:SBOBET:FOOTBALL", source("SBOBET", "KSPORT", ["KSPORT", "SBO"])],
  ["catalog-source:APSPORT:FOOTBALL", source("APSPORT", "TSPORT", ["TSPORT"])],
  ["catalog-source:BTI:FOOTBALL", source("BTI", "BTI", ["BTI"])]
]);

const ACTIONABLE_REASONS = new Set([
  "AUTH_EGRESS_UNAVAILABLE", "LAUNCH_EXPIRED", "LAUNCH_CONSUMED",
  "PORTAL_VALIDATION_FAILED", "PROVIDER_SCHEMA_CHANGED"
]);
const DISPOSED = Symbol("RECOVERY_DISPOSED");

export class AutomaticSourceRecovery {
  readonly #options: AutomaticSourceRecoveryOptions;
  readonly #baselineTimeoutMs: number;
  readonly #now: () => number;
  readonly #inflight = new Map<string, Promise<RecoveryResult>>();
  readonly #disposeSignal: Promise<typeof DISPOSED>;
  readonly #abortController = new AbortController();
  #signalDispose!: () => void;
  #disposed = false;
  #disposal: Promise<void> | null = null;

  constructor(options: AutomaticSourceRecoveryOptions) {
    const baselineTimeoutMs = options.baselineTimeoutMs ?? 10_000;
    if (!Number.isFinite(baselineTimeoutMs) || baselineTimeoutMs <= 0) {
      throw new Error("RECOVERY_OPTIONS_INVALID");
    }
    this.#options = options;
    this.#baselineTimeoutMs = baselineTimeoutMs;
    this.#now = options.now ?? Date.now;
    this.#disposeSignal = new Promise((resolve) => {
      this.#signalDispose = () => { resolve(DISPOSED); };
    });
  }

  recover(request: ProviderRecoveryRequest): Promise<RecoveryResult> {
    const existing = this.#inflight.get(request.accountId);
    if (existing !== undefined) return existing;
    const operation = this.#recover(request).finally(() => {
      if (this.#inflight.get(request.accountId) === operation) this.#inflight.delete(request.accountId);
    });
    this.#inflight.set(request.accountId, operation);
    return operation;
  }

  dispose(): Promise<void> {
    if (this.#disposal !== null) return this.#disposal;
    this.#disposed = true;
    this.#abortController.abort(new Error("RECOVERY_DISPOSED"));
    this.#signalDispose();
    this.#disposal = Promise.allSettled([...this.#inflight.values()]).then(() => undefined);
    return this.#disposal;
  }

  async #recover(request: ProviderRecoveryRequest): Promise<RecoveryResult> {
    if (this.#disposed) return stopped(request.accountId, request.stage);
    if (this.#suppressed(request.accountId)) return suppressed(request.accountId, request.stage);
    const source = SOURCES.get(request.accountId);
    if (source === undefined) return noSource(request.accountId, request.stage);

    if (request.stage === "HARD") return this.#hardRecover(request, source);
    try {
      const current = this.#options.feedRegistry.snapshot(request.accountId);
      const delivered = this.#options.controlPlane.requestLobbySnapshot(softLobby(current, source));
      if (delivered > 0) {
        const confirmation = await this.#confirm(request, "SOFT");
        if (confirmation.outcome === "RECOVERED" || confirmation.reason !== "BASELINE_TIMEOUT") {
          return confirmation;
        }
      }
    } catch (error) {
      if (this.#disposed) return stopped(request.accountId, "SOFT");
      return this.#failure(request.accountId, "SOFT", error);
    }

    if (this.#disposed) return stopped(request.accountId, "SOFT");
    if (this.#suppressed(request.accountId)) return suppressed(request.accountId, "SOFT");
    return this.#hardRecover(request, source);
  }

  async #hardRecover(request: ProviderRecoveryRequest, source: RecoverySource): Promise<RecoveryResult> {
    if (this.#disposed) return stopped(request.accountId, "HARD");
    if (this.#suppressed(request.accountId)) return suppressed(request.accountId, "HARD");
    try {
      let delivered: number;
      if (source.provider === null) {
        delivered = this.#options.controlPlane.restoreLobby("CMD");
      } else {
        const recoveryStartedAtMs = this.#now();
        const refresh = await this.#whileActive(this.#options.refreshFabetLaunches(this.#abortController.signal));
        if (refresh === DISPOSED) return stopped(request.accountId, "HARD");
        if (this.#suppressed(request.accountId)) return suppressed(request.accountId, "HARD");
        const targetedDelivery = await this.#whileActive(refreshBridgeProviderSources({
          controlPlane: this.#options.controlPlane,
          withLatestFabetLaunch: this.#options.withLatestFabetLaunch,
          minAcquiredAtMs: recoveryStartedAtMs,
          signal: this.#abortController.signal,
          providers: [source.provider],
          restoreCmd: false,
          beforeDelivery: () => {
            if (this.#disposed) throw new Error("RECOVERY_DISPOSED");
            if (this.#suppressed(request.accountId)) throw new Error("RECOVERY_SUPPRESSED");
          }
        }));
        if (targetedDelivery === DISPOSED) return stopped(request.accountId, "HARD");
        delivered = targetedDelivery;
      }
      if (delivered <= 0) return noSource(request.accountId, "HARD");
      return this.#confirm(request, "HARD");
    } catch (error) {
      if (this.#disposed) return stopped(request.accountId, "HARD");
      return this.#failure(request.accountId, "HARD", error);
    }
  }

  async #confirm(request: ProviderRecoveryRequest, stage: RecoveryStage): Promise<RecoveryResult> {
    try {
      const baseline = await this.#whileActive(this.#options.feedRegistry.waitForFreshBaseline(
        request.accountId, request.requestedAtMs, this.#baselineTimeoutMs, this.#abortController.signal
      ));
      if (baseline === DISPOSED) return stopped(request.accountId, stage);
      if (!isStrictlyNewerBaseline(baseline, request)) {
        return { accountId: request.accountId, stage, outcome: "DELIVERED", reason: "BASELINE_TIMEOUT" };
      }
      return { accountId: request.accountId, stage, outcome: "RECOVERED", reason: null };
    } catch (error) {
      if (this.#disposed) return stopped(request.accountId, stage);
      const reason = recoveryReason(error);
      if (reason === "BASELINE_TIMEOUT") {
        return { accountId: request.accountId, stage, outcome: "DELIVERED", reason };
      }
      return this.#failure(request.accountId, stage, error);
    }
  }

  #failure(accountId: string, stage: RecoveryStage, error: unknown): RecoveryResult {
    this.#options.onError?.(accountId, error);
    const reason = recoveryReason(error);
    if (reason === "SOURCE_MISSING") return noSource(accountId, stage);
    return { accountId, stage, outcome: "ACTION_REQUIRED", reason };
  }

  #suppressed(accountId: string): boolean {
    return this.#options.isRecoverySuppressed?.(accountId) === true;
  }

  #whileActive<T>(operation: Promise<T>): Promise<T | typeof DISPOSED> {
    return Promise.race([operation, this.#disposeSignal]);
  }
}

function source(provider: FabetProvider | null, hardLobby: ChromeLobbyId,
  softLobbies: readonly ChromeLobbyId[]): RecoverySource {
  return { provider, hardLobby, softLobbies: new Set(softLobbies) };
}

function softLobby(snapshot: ProviderFeedSnapshot, source: RecoverySource): ChromeLobbyId {
  const lobby = snapshot.sourceId?.split(":")[1] as ChromeLobbyId | undefined;
  return lobby !== undefined && source.softLobbies.has(lobby) ? lobby : source.hardLobby;
}

function isStrictlyNewerBaseline(snapshot: ProviderFeedSnapshot, request: ProviderRecoveryRequest): boolean {
  return snapshot.accountId === request.accountId && snapshot.state === "LIVE" &&
    snapshot.lastCompleteBaselineAtMs !== null && snapshot.lastCompleteBaselineAtMs > request.requestedAtMs;
}

function recoveryReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const reason of ACTIONABLE_REASONS) {
    if (message === reason || message.startsWith(`${reason}:`)) return reason;
  }
  if (message === "BASELINE_TIMEOUT" || message.includes("BASELINE_TIMEOUT")) return "BASELINE_TIMEOUT";
  if (message.includes("UNDELIVERED") || message.includes("LAUNCH_UNAVAILABLE") ||
    message === "SOURCE_MISSING") return "SOURCE_MISSING";
  return message.length === 0 ? "SOURCE_MISSING" : message;
}

function stopped(accountId: string, stage: RecoveryStage): RecoveryResult {
  return { accountId, stage, outcome: "ACTION_REQUIRED", reason: "RECOVERY_DISPOSED" };
}

function suppressed(accountId: string, stage: RecoveryStage): RecoveryResult {
  return { accountId, stage, outcome: "ACTION_REQUIRED", reason: "RECOVERY_SUPPRESSED" };
}

function noSource(accountId: string, stage: RecoveryStage): RecoveryResult {
  return { accountId, stage, outcome: "NO_SOURCE", reason: "SOURCE_MISSING" };
}
