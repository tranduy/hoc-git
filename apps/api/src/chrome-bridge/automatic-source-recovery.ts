import type { ChromeLobbyId } from "@tool-chenh/contracts";
import type { ProviderFeedRegistry } from "./provider-feed-registry.js";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./provider-feed-types.js";
import { refreshBridgeProviderSources } from "./provider-source-refresh.js";
import { chromeBridgeSourceIdentity } from "./chrome-bridge-account.js";

type FabetProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";
type RecoveryStage = "SOFT" | "HARD";
type RecoveryFeedRegistry = Pick<ProviderFeedRegistry,
  "snapshot" | "subscribe" | "waitForFreshBaseline">;

interface RecoveryControlPlane {
  requestLobbySnapshot(lobby: ChromeLobbyId): number;
  reloadSource?(sourceId: string): number;
  reloadRecoverySource?(accountId: string, lobby: ChromeLobbyId): number;
  ensureLobby(lobby: ChromeLobbyId, url: string): number;
  restoreLobby(lobby: ChromeLobbyId): number;
}

interface AutomaticSourceRecoveryOptions {
  readonly controlPlane: RecoveryControlPlane;
  readonly feedRegistry: RecoveryFeedRegistry;
  readonly refreshFabetLaunches: (signal: AbortSignal) => Promise<void>;
  readonly browserRefreshEnabled?: boolean;
  readonly withLatestFabetLaunch: <T>(provider: FabetProvider, category: "FOOTBALL",
    consume: (url: string) => Promise<T>, minAcquiredAtMs: number, signal?: AbortSignal) => Promise<T>;
  readonly baselineTimeoutMs?: number;
  /**
   * How long a reloaded provider tab is given to publish a complete baseline.
   * Separate from baselineTimeoutMs because a lobby snapshot is an in-page
   * action that answers in seconds, while a reload restarts the page, its
   * session and its whole catalog sweep.
   */
  readonly reloadBaselineTimeoutMs?: number;
  readonly now?: () => number;
  readonly isRecoverySuppressed?: (accountId: string) => boolean;
  readonly onError?: (accountId: string, error: unknown) => void;
  readonly onStateChange?: (status: RecoveryBackoffStatus) => void;
}

export interface RecoveryBackoffStatus {
  readonly accountId: string;
  readonly state: "BACKOFF" | "RECOVERED";
  readonly consecutiveFailures: number;
  readonly nextAttemptAtMs: number | null;
  readonly nextAttemptInMs: number;
  readonly lastFailureCode: string | null;
  readonly repeatCount: number;
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

// Chrome never replays Network.webSocketCreated for a socket opened before the
// debugger attached, so a re-attached WebSocket tab stays permanently blind.
// Reloading the source is the only recovery that rebuilds an observable socket,
// and unlike the Fabet relaunch it works while browser refresh is disabled.
const WEBSOCKET_PROVIDERS: ReadonlySet<FabetProvider | null> = new Set<FabetProvider>([
  "SABA", "SBOBET", "APSPORT"
]);

const ACTIONABLE_REASONS = new Set([
  "AUTH_EGRESS_UNAVAILABLE", "LAUNCH_EXPIRED", "LAUNCH_CONSUMED",
  "PORTAL_VALIDATION_FAILED", "PROVIDER_SCHEMA_CHANGED"
]);
const DISPOSED = Symbol("RECOVERY_DISPOSED");
const SBOBET_SAME_TAB_RECOVERY = Symbol("SBOBET_SAME_TAB_RECOVERY");
const INITIAL_BACKOFF_MS = 1_000;
// The retry ceiling is the operator's 30 s realtime contract. Measured
// 2026-08-31: after an API restart, APSPORT's first recovery raced the
// extension's bridge reconnect, failed as undelivered, and the doubling
// backoff then pushed the next attempt out past two minutes while the book
// sat dark - a five-minute ceiling can only ever be a five-minute outage.
// Retrying this often is safe because the soft action is a snapshot request
// that reloads and navigates nothing, and the tab-reloading hard action keeps
// its own MIN_SOURCE_RELOAD_INTERVAL_MS gate.
const MAX_BACKOFF_MS = 30_000;
/**
 * The least time between two reloads of one provider tab.
 *
 * A reload destroys the page and every socket it owns, and the page needs
 * minutes to authenticate and subscribe again. The backoff alone does not
 * protect it: a recovery that succeeds for even one beat clears the counter, so
 * a book that comes up briefly and falls over drops straight back to a
 * one-second delay. Measured 2026-08-27: APSPORT opened its football socket 21
 * times and produced 48 separate bursts of one to eight minutes across two
 * days, never once settling - it was being reloaded out of every burst it
 * managed to start.
 */
const MIN_SOURCE_RELOAD_INTERVAL_MS = 300_000;
// KSPORT owns a safe same-tab recovery path in the extension: it re-selects
// the real Football group, requests a paired live + today HTTP baseline, and
// reconnects only the catalog socket when needed. A recent tab heartbeat means
// that path is still reachable. Replacing the whole tab in that state destroys
// the very subscriptions recovery is waiting for and creates a relaunch loop.
const SBOBET_SAME_TAB_RECOVERY_MAX_HEARTBEAT_AGE_MS = 60_000;

interface RecoveryBackoffState {
  readonly consecutiveFailures: number;
  readonly nextAttemptAtMs: number;
  readonly lastFailureCode: string;
  readonly repeatCount: number;
}

export class AutomaticSourceRecovery {
  readonly #options: AutomaticSourceRecoveryOptions;
  readonly #baselineTimeoutMs: number;
  readonly #reloadBaselineTimeoutMs: number;
  readonly #now: () => number;
  readonly #inflight = new Map<string, Promise<RecoveryResult>>();
  readonly #backoff = new Map<string, RecoveryBackoffState>();
  readonly #lastReloadAtMs = new Map<string, number>();
  readonly #disposeSignal: Promise<typeof DISPOSED>;
  readonly #abortController = new AbortController();
  #signalDispose!: () => void;
  #disposed = false;
  #disposal: Promise<void> | null = null;

  constructor(options: AutomaticSourceRecoveryOptions) {
    const baselineTimeoutMs = options.baselineTimeoutMs ?? 10_000;
    // Measured 2026-08-27: after the stack redeployed at 03:02 UTC the reloaded
    // provider tabs published their first complete baselines at 03:04:28. Ten
    // seconds - the lobby-snapshot deadline this used to share - expires while
    // the page is still loading, so every reload was declared a failure and the
    // next hard stage reloaded the tab again, destroying the sweep before it
    // could finish. That loop is what leaves APSPORT reporting five events.
    const reloadBaselineTimeoutMs = options.reloadBaselineTimeoutMs ?? 90_000;
    if (!Number.isFinite(baselineTimeoutMs) || baselineTimeoutMs <= 0 ||
      !Number.isFinite(reloadBaselineTimeoutMs) || reloadBaselineTimeoutMs <= 0) {
      throw new Error("RECOVERY_OPTIONS_INVALID");
    }
    this.#options = options;
    this.#baselineTimeoutMs = baselineTimeoutMs;
    this.#reloadBaselineTimeoutMs = reloadBaselineTimeoutMs;
    this.#now = options.now ?? Date.now;
    this.#disposeSignal = new Promise((resolve) => {
      this.#signalDispose = () => { resolve(DISPOSED); };
    });
  }

  recover(request: ProviderRecoveryRequest): Promise<RecoveryResult> {
    const existing = this.#inflight.get(request.accountId);
    if (existing !== undefined) return existing;
    const backoff = this.#backoff.get(request.accountId);
    if (backoff !== undefined && this.#now() < backoff.nextAttemptAtMs) {
      return Promise.resolve({ accountId: request.accountId, stage: request.stage,
        outcome: "ACTION_REQUIRED", reason: "RECOVERY_BACKOFF" });
    }
    const operation = this.#recover(request).then((result) => {
      this.#recordResult(result);
      return result;
    }, (error: unknown) => {
      this.#recordFailure(request.accountId, recoveryFailureCode(recoveryReason(error)));
      throw error;
    }).finally(() => {
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
      const current = this.#options.feedRegistry.snapshot(request.accountId);
      const actionStartedAtMs = this.#now();
      if (source.provider === "SBOBET") {
        const delivered = this.#options.controlPlane.requestLobbySnapshot(source.hardLobby);
        if (delivered > 0 && hasRecentSbobetTab(current, actionStartedAtMs)) {
          return this.#confirmAfter(request.accountId, "HARD", actionStartedAtMs,
            this.#reloadBaselineTimeoutMs);
        }
        if (delivered > 0) {
          const confirmation = await this.#confirmAfter(request.accountId, "HARD", actionStartedAtMs);
          if (confirmation.outcome === "RECOVERED" || confirmation.reason !== "BASELINE_TIMEOUT") {
            return confirmation;
          }
          const retryStartedAtMs = this.#now();
          if (hasRecentSbobetTab(this.#options.feedRegistry.snapshot(request.accountId),
            retryStartedAtMs)) {
            if (this.#options.controlPlane.requestLobbySnapshot(source.hardLobby) > 0) {
              return this.#confirmAfter(request.accountId, "HARD", retryStartedAtMs,
                this.#reloadBaselineTimeoutMs);
            }
          }
        }
      }
      if (WEBSOCKET_PROVIDERS.has(source.provider) &&
        (this.#options.controlPlane.reloadSource !== undefined ||
          this.#options.controlPlane.reloadRecoverySource !== undefined)) {
        const prior = current;
        let delivered = 0;
        const lastReloadAtMs = this.#lastReloadAtMs.get(request.accountId) ?? Number.NEGATIVE_INFINITY;
        const reloadAllowed = actionStartedAtMs - lastReloadAtMs >= MIN_SOURCE_RELOAD_INTERVAL_MS;
        if (reloadAllowed && prior.sourceId !== null &&
          this.#options.controlPlane.reloadSource !== undefined &&
          matchesRecoverySource(prior.sourceId, request.accountId, source.hardLobby)) {
          try {
            delivered = this.#options.controlPlane.reloadSource(prior.sourceId);
            if (delivered > 0) this.#lastReloadAtMs.set(request.accountId, actionStartedAtMs);
          } catch { /* send failure is undelivered; fall through to a fresh launch */ }
        }
        if (source.provider !== "SBOBET" && reloadAllowed && delivered <= 0 &&
          this.#options.controlPlane.reloadRecoverySource !== undefined) {
          try {
            delivered = this.#options.controlPlane.reloadRecoverySource(request.accountId, source.hardLobby);
            if (delivered > 0) this.#lastReloadAtMs.set(request.accountId, actionStartedAtMs);
          } catch { /* candidate send failure is undelivered; fall through to a fresh launch */ }
        }
        if (delivered > 0) {
          const confirmation = await this.#confirmReplacement(request, prior, actionStartedAtMs);
          if (confirmation.outcome === "RECOVERED" || confirmation.reason !== "BASELINE_TIMEOUT") {
            return confirmation;
          }
          if (this.#disposed) return stopped(request.accountId, "HARD");
          if (this.#suppressed(request.accountId)) return suppressed(request.accountId, "HARD");
        }
      }
      let delivered: number;
      let confirmationAfterMs = request.requestedAtMs;
      if (source.provider === null) {
        delivered = this.#options.controlPlane.restoreLobby("CMD");
      } else {
        if (this.#options.browserRefreshEnabled === false) {
          // Returning here did nothing at all, and once a feed reaches the hard
          // stage only the hard stage is requested again, so the book stayed
          // dead with its tab alive. A lobby snapshot is the cheap action that
          // still works with the relaunch path closed: it triggers the
          // extension-driven reconciliation some providers ingest exclusively,
          // and it neither reloads nor navigates a tab.
          const snapshotStartedAtMs = this.#now();
          if (this.#options.controlPlane.requestLobbySnapshot(source.hardLobby) > 0) {
            const confirmation = await this.#confirmAfter(request.accountId, "HARD", snapshotStartedAtMs);
            if (confirmation.outcome === "RECOVERED") return confirmation;
            if (this.#disposed) return stopped(request.accountId, "HARD");
            if (this.#suppressed(request.accountId)) return suppressed(request.accountId, "HARD");
          }
          return { accountId: request.accountId, stage: "HARD", outcome: "ACTION_REQUIRED",
            reason: "BROWSER_REFRESH_DISABLED" };
        }
        const recoveryStartedAtMs = this.#now();
        const refresh = await this.#whileActive(this.#options.refreshFabetLaunches(this.#abortController.signal));
        if (refresh === DISPOSED) return stopped(request.accountId, "HARD");
        if (this.#suppressed(request.accountId)) return suppressed(request.accountId, "HARD");
        let targetedDelivery: number | typeof DISPOSED;
        try {
          targetedDelivery = await this.#whileActive(refreshBridgeProviderSources({
            controlPlane: this.#options.controlPlane,
            withLatestFabetLaunch: this.#options.withLatestFabetLaunch,
            minAcquiredAtMs: recoveryStartedAtMs,
            signal: this.#abortController.signal,
            providers: [source.provider],
            restoreCmd: false,
            beforeDelivery: () => {
              if (this.#disposed) throw new Error("RECOVERY_DISPOSED");
              if (this.#suppressed(request.accountId)) throw new Error("RECOVERY_SUPPRESSED");
              confirmationAfterMs = this.#now();
              // Launch-token discovery can take long enough for the existing
              // authenticated KSPORT tab to attach in the meantime. Recheck at
              // the last mutation boundary; replacing it here destroys the
              // live baseline before the today partition can arrive.
              if (source.provider === "SBOBET" && hasRecentSbobetTab(
                this.#options.feedRegistry.snapshot(request.accountId), confirmationAfterMs
              ) && this.#options.controlPlane.requestLobbySnapshot(source.hardLobby) > 0) {
                throw SBOBET_SAME_TAB_RECOVERY;
              }
            }
          }));
        } catch (error) {
          if (error === SBOBET_SAME_TAB_RECOVERY) {
            return this.#confirmAfter(request.accountId, "HARD", confirmationAfterMs,
              this.#reloadBaselineTimeoutMs);
          }
          throw error;
        }
        if (targetedDelivery === DISPOSED) return stopped(request.accountId, "HARD");
        delivered = targetedDelivery;
      }
      if (delivered <= 0) return noSource(request.accountId, "HARD");
      return this.#confirmAfter(request.accountId, "HARD", confirmationAfterMs);
    } catch (error) {
      if (this.#disposed) return stopped(request.accountId, "HARD");
      return this.#failure(request.accountId, "HARD", error);
    }
  }

  async #confirmReplacement(request: ProviderRecoveryRequest, prior: ProviderFeedSnapshot,
    actionStartedAtMs: number): Promise<RecoveryResult> {
    const deadlineAtMs = actionStartedAtMs + this.#reloadBaselineTimeoutMs;
    let afterMs = actionStartedAtMs;
    while (true) {
      const remainingMs = deadlineAtMs - this.#now();
      if (remainingMs <= 0) {
        return { accountId: request.accountId, stage: "HARD", outcome: "DELIVERED",
          reason: "BASELINE_TIMEOUT" };
      }
      try {
        const baseline = await this.#whileActive(this.#options.feedRegistry.waitForFreshBaseline(
          request.accountId, afterMs, remainingMs, this.#abortController.signal
        ));
        if (baseline === DISPOSED) return stopped(request.accountId, "HARD");
        if (!isBaselineAfter(baseline, request.accountId, actionStartedAtMs)) {
          return { accountId: request.accountId, stage: "HARD", outcome: "DELIVERED",
            reason: "BASELINE_TIMEOUT" };
        }
        if (baseline.sourceId !== prior.sourceId || baseline.sourceEpoch !== prior.sourceEpoch ||
          baseline.activeGeneration !== prior.activeGeneration) {
          return { accountId: request.accountId, stage: "HARD", outcome: "RECOVERED", reason: null };
        }
        const completedAtMs = baseline.lastCompleteBaselineAtMs;
        if (completedAtMs === null || completedAtMs <= afterMs) {
          return { accountId: request.accountId, stage: "HARD", outcome: "DELIVERED",
            reason: "BASELINE_TIMEOUT" };
        }
        afterMs = completedAtMs;
      } catch (error) {
        if (this.#disposed) return stopped(request.accountId, "HARD");
        const reason = recoveryReason(error);
        if (reason === "BASELINE_TIMEOUT") {
          return { accountId: request.accountId, stage: "HARD", outcome: "DELIVERED", reason };
        }
        return this.#failure(request.accountId, "HARD", error);
      }
    }
  }

  async #confirm(request: ProviderRecoveryRequest, stage: RecoveryStage): Promise<RecoveryResult> {
    return this.#confirmAfter(request.accountId, stage, request.requestedAtMs);
  }

  async #confirmAfter(accountId: string, stage: RecoveryStage, afterMs: number,
    timeoutMs = this.#baselineTimeoutMs): Promise<RecoveryResult> {
    try {
      const baseline = await this.#whileActive(this.#options.feedRegistry.waitForFreshBaseline(
        accountId, afterMs, timeoutMs, this.#abortController.signal
      ));
      if (baseline === DISPOSED) return stopped(accountId, stage);
      if (!isBaselineAfter(baseline, accountId, afterMs)) {
        return { accountId, stage, outcome: "DELIVERED", reason: "BASELINE_TIMEOUT" };
      }
      return { accountId, stage, outcome: "RECOVERED", reason: null };
    } catch (error) {
      if (this.#disposed) return stopped(accountId, stage);
      const reason = recoveryReason(error);
      if (reason === "BASELINE_TIMEOUT") {
        return { accountId, stage, outcome: "DELIVERED", reason };
      }
      return this.#failure(accountId, stage, error);
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

  #recordResult(result: RecoveryResult): void {
    if (result.outcome === "RECOVERED") {
      const prior = this.#backoff.get(result.accountId);
      if (prior === undefined) return;
      this.#backoff.delete(result.accountId);
      this.#emitState({ accountId: result.accountId, state: "RECOVERED", consecutiveFailures: 0,
        nextAttemptAtMs: null, nextAttemptInMs: 0, lastFailureCode: null,
        repeatCount: prior.repeatCount });
      return;
    }
    if (result.reason === "RECOVERY_DISPOSED" || result.reason === "RECOVERY_SUPPRESSED" ||
      result.reason === "RECOVERY_BACKOFF") return;
    this.#recordFailure(result.accountId, recoveryFailureCode(result.reason));
  }

  #recordFailure(accountId: string, code: string): void {
    const prior = this.#backoff.get(accountId);
    const consecutiveFailures = (prior?.consecutiveFailures ?? 0) + 1;
    const delayMs = Math.min(INITIAL_BACKOFF_MS * (2 ** Math.min(30, consecutiveFailures - 1)),
      MAX_BACKOFF_MS);
    const nextAttemptAtMs = this.#now() + delayMs;
    const repeatCount = prior?.lastFailureCode === code ? prior.repeatCount + 1 : 1;
    this.#backoff.set(accountId, { consecutiveFailures, nextAttemptAtMs, lastFailureCode: code,
      repeatCount });
    this.#emitState({ accountId, state: "BACKOFF", consecutiveFailures, nextAttemptAtMs,
      nextAttemptInMs: delayMs, lastFailureCode: code, repeatCount });
  }

  #emitState(status: RecoveryBackoffStatus): void {
    try { this.#options.onStateChange?.(status); } catch { /* telemetry/logging cannot stop recovery */ }
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

function isBaselineAfter(snapshot: ProviderFeedSnapshot, accountId: string, afterMs: number): boolean {
  return snapshot.accountId === accountId && snapshot.state === "LIVE" &&
    snapshot.lastCompleteBaselineAtMs !== null && snapshot.lastCompleteBaselineAtMs > afterMs;
}

function hasRecentSbobetTab(snapshot: ProviderFeedSnapshot, nowMs: number): boolean {
  return snapshot.sourceId !== null && snapshot.tabReachableAtMs !== null &&
    nowMs - snapshot.tabReachableAtMs <= SBOBET_SAME_TAB_RECOVERY_MAX_HEARTBEAT_AGE_MS;
}

function matchesRecoverySource(sourceId: string, accountId: string, lobby: ChromeLobbyId): boolean {
  const identity = chromeBridgeSourceIdentity(sourceId);
  return identity?.accountId === accountId && identity.lobby === lobby;
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

function recoveryFailureCode(reason: string | null): string {
  if (reason === null || reason.length === 0) return "SOURCE_MISSING";
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(reason) ? reason : "RECOVERY_FAILED";
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
