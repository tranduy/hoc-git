import type { ChromeLobbyId } from "@tool-chenh/contracts";
import type { TabDescriptor } from "./lobby-signatures.js";

export type RenewableLobby = Exclude<ChromeLobbyId, "CMD" | "SBO">;

export interface ProviderRecoveryGuard {
  readonly isCurrent: () => boolean;
  // Capture the identity claimed by this renewal after its own epoch change.
  readonly captureIdentity: () => () => boolean;
}

export interface RenewableSource {
  readonly lobby: RenewableLobby;
  readonly sourceId: string;
  readonly tabId: number;
  readonly recoveryGuard?: ProviderRecoveryGuard;
}

export interface ProviderLeaseSchedule {
  lastCompletedAtMs: number;
  nextAttemptAtMs: number;
}

export type ProviderPageLeaseState = Record<RenewableLobby, ProviderLeaseSchedule>;

interface ProviderPageLeaseCoordinatorOptions {
  readonly listAttached: () => readonly RenewableSource[];
  readonly isLoading: (tabId: number) => Promise<boolean>;
  readonly loadState: () => Promise<ProviderPageLeaseState | null>;
  readonly saveState: (state: ProviderPageLeaseState) => Promise<void>;
  readonly renew: (source: RenewableSource) => Promise<void>;
  /**
   * Periodic renewal navigates the tab, which discards any view the page is
   * currently showing. A lobby streaming a market group it only opens on
   * demand (APSPORT corners) would lose that stream every interval, so the
   * lobby may defer its own periodic slot. Bounded by deferPeriodicRenewalMs
   * so a stuck predicate can never suppress renewal indefinitely.
   */
  readonly deferPeriodicRenewal?: (lobby: RenewableLobby) => boolean;
  readonly deferPeriodicRenewalMs?: number;
  readonly now?: () => number;
  readonly intervalMs?: number;
  readonly initialStaggerMs?: number;
  readonly loadingRetryMs?: number;
  readonly failureRetryMs?: number;
}

interface ExactProviderRenewalOptions {
  readonly canRenew?: (source: RenewableSource) => boolean;
  readonly isAttached: (source: RenewableSource) => boolean;
  readonly get: (tabId: number) => Promise<TabDescriptor>;
  readonly attachBootstrap: (tab: TabDescriptor, lobby: RenewableLobby) => Promise<void>;
  readonly beginSourceEpoch: (sourceId: string) => void;
  readonly update: (tabId: number, url: string) => Promise<TabDescriptor>;
  readonly waitForReady: (tabId: number, lobby: RenewableLobby) => Promise<TabDescriptor>;
  readonly now?: () => number;
}

const PACIFIC_HOST = /^pacific\.(?:agenate|racern)\.com$/iu;
const SABA_HOST = /^c0z0o[a-z0-9]+\.bp[a-z0-9]+\.com$/iu;
const SBO_HOST = /^c0z0o[a-z0-9]+\.(?:bpb7jrm5|bpf7t7s9)\.com$/iu;
const RENEWABLE_LOBBIES = ["BTI", "IM", "TSPORT", "KSPORT", "SABA"] as const;
const DEFAULT_INTERVAL_MS = 20 * 60_000;
const DEFAULT_DEFER_PERIODIC_MS = 15 * 60_000;
const DEFAULT_INITIAL_STAGGER_MS = 2 * 60_000;
const DEFAULT_LOADING_RETRY_MS = 30_000;
const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export function isRenewableLobby(lobby: ChromeLobbyId): lobby is RenewableLobby {
  // IM can omit the token only after a token-bearing launch has established
  // the current browser session. Navigating it like the public providers can
  // replace that working page with provider error 500 and there is no public
  // URL capable of rebuilding the session. Keep IM on its exact authenticated
  // page and recover it through in-page GetSE refreshes instead.
  // SABA's provider-minted /(S(...))/ path is part of the live browser
  // session. Periodically replacing it with /NewIndex produced a shell with
  // no catalog socket, so SABA is recovered only on an observed failure and
  // its exact current session path is preserved there.
  return lobby !== "IM" && lobby !== "SABA" && RENEWABLE_LOBBIES.includes(lobby as RenewableLobby);
}

function isPeriodicRenewalLobby(lobby: RenewableLobby): boolean {
  // AP/SBO hidden collection must survive a healthy page's lease timer.
  // SBO's persisted 20-minute renewal matched the 2026-09-08 14:44 epoch
  // reset and erased its in-progress More inventory. Observed-failure
  // recovery still reaches renewNow() through isRenewableLobby above.
  // BTI's full Early/detail cache also belongs to its live document. A healthy
  // page must outlive the old 20-minute timer; observed auth failure still renews.
  return lobby !== "BTI" && lobby !== "TSPORT" && lobby !== "KSPORT" && isRenewableLobby(lobby);
}

export function parseProviderPageLeaseState(value: unknown): ProviderPageLeaseState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== RENEWABLE_LOBBIES.length ||
    Object.keys(record).some((key) => !RENEWABLE_LOBBIES.includes(key as RenewableLobby))) return null;
  for (const lobby of RENEWABLE_LOBBIES) {
    const schedule = record[lobby];
    if (typeof schedule !== "object" || schedule === null || Array.isArray(schedule)) return null;
    const candidate = schedule as Partial<ProviderLeaseSchedule>;
    if (!Number.isSafeInteger(candidate.lastCompletedAtMs) || candidate.lastCompletedAtMs! < 0 ||
      !Number.isSafeInteger(candidate.nextAttemptAtMs) ||
      candidate.nextAttemptAtMs! < candidate.lastCompletedAtMs!) return null;
  }
  return value as ProviderPageLeaseState;
}

export class ProviderPageLeaseCoordinator {
  readonly #options: ProviderPageLeaseCoordinatorOptions;
  readonly #now: () => number;
  readonly #intervalMs: number;
  readonly #initialStaggerMs: number;
  readonly #loadingRetryMs: number;
  readonly #failureRetryMs: number;
  readonly #deferPeriodicRenewalMs: number;
  readonly #deferredSinceMs = new Map<string, number>();
  readonly #renewSerial = new Map<string, number>();
  #state: ProviderPageLeaseState | null | undefined;
  #inflight: { readonly sourceId: string | null; readonly operation: Promise<void> } | null = null;

  constructor(options: ProviderPageLeaseCoordinatorOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.#initialStaggerMs = options.initialStaggerMs ?? DEFAULT_INITIAL_STAGGER_MS;
    this.#loadingRetryMs = options.loadingRetryMs ?? DEFAULT_LOADING_RETRY_MS;
    this.#failureRetryMs = options.failureRetryMs ?? DEFAULT_FAILURE_RETRY_MS;
    this.#deferPeriodicRenewalMs = options.deferPeriodicRenewalMs ?? DEFAULT_DEFER_PERIODIC_MS;
  }

  tick(): Promise<void> {
    if (this.#inflight !== null) return this.#inflight.operation;
    return this.#start(null, this.#tickSafely());
  }

  renewNow(source: RenewableSource): Promise<void> {
    if (source.recoveryGuard?.isCurrent() === false) return Promise.resolve();
    const observedSerial = this.#renewSerial.get(source.sourceId) ?? 0;
    if (this.#inflight !== null) {
      if (this.#inflight.sourceId === source.sourceId) return this.#inflight.operation;
      return this.#inflight.operation.catch(() => undefined).then(() =>
        (this.#renewSerial.get(source.sourceId) ?? 0) !== observedSerial ? undefined : this.renewNow(source));
    }
    return this.#start(source.sourceId, this.#renewManually(source));
  }

  #start(sourceId: string | null, operation: Promise<void>): Promise<void> {
    const tracked = operation.finally(() => {
      if (this.#inflight?.operation === tracked) this.#inflight = null;
    });
    this.#inflight = { sourceId, operation: tracked };
    return tracked;
  }

  async #load(): Promise<void> {
    if (this.#state !== undefined) return;
    this.#state = await this.#options.loadState();
  }

  async #tickSafely(): Promise<void> {
    try { await this.#tick(); }
    catch { /* The selected lobby already owns its persisted failure window. */ }
  }

  async #tick(): Promise<void> {
    await this.#load();
    const nowMs = this.#now();
    const state = this.#state;
    if (state === undefined) throw new Error("PROVIDER_PAGE_LEASE_STATE_UNAVAILABLE");
    if (state === null) {
      const seeded = {} as ProviderPageLeaseState;
      RENEWABLE_LOBBIES.forEach((lobby, index) => {
        seeded[lobby] = { lastCompletedAtMs: nowMs,
          nextAttemptAtMs: nowMs + this.#intervalMs + ((index + 1) * this.#initialStaggerMs) };
      });
      await this.#remember(seeded);
      return;
    }
    const dueLobby = RENEWABLE_LOBBIES.filter((lobby) => isPeriodicRenewalLobby(lobby) &&
      state[lobby].nextAttemptAtMs <= nowMs)
      .sort((left, right) => state[left].nextAttemptAtMs - state[right].nextAttemptAtMs)[0];
    if (dueLobby === undefined) return;
    if (this.#options.deferPeriodicRenewal?.(dueLobby) === true) {
      const since = this.#deferredSinceMs.get(dueLobby) ?? nowMs;
      this.#deferredSinceMs.set(dueLobby, since);
      if (nowMs - since < this.#deferPeriodicRenewalMs) {
        state[dueLobby].nextAttemptAtMs = nowMs + this.#loadingRetryMs;
        await this.#remember(state);
        return;
      }
    } else {
      this.#deferredSinceMs.delete(dueLobby);
    }
    const schedule = state[dueLobby];
    const source = this.#options.listAttached().find((candidate) => candidate.lobby === dueLobby);
    if (source === undefined) {
      schedule.nextAttemptAtMs = nowMs + this.#loadingRetryMs;
      await this.#remember(state);
      return;
    }
    this.#inflight = this.#inflight === null ? null : { ...this.#inflight, sourceId: source.sourceId };
    schedule.nextAttemptAtMs = nowMs + this.#failureRetryMs;
    await this.#remember(state);
    if (await this.#options.isLoading(source.tabId)) {
      schedule.nextAttemptAtMs = nowMs + this.#loadingRetryMs;
      await this.#remember(state);
      return;
    }
    await this.#options.renew(source);
    this.#renewSerial.set(source.sourceId, (this.#renewSerial.get(source.sourceId) ?? 0) + 1);
    schedule.lastCompletedAtMs = nowMs;
    schedule.nextAttemptAtMs = nowMs + this.#intervalMs;
    await this.#remember(state);
  }

  async #renewManually(source: RenewableSource): Promise<void> {
    await this.#load();
    if (source.recoveryGuard?.isCurrent() === false) return;
    let state = this.#state;
    if (state === undefined) throw new Error("PROVIDER_PAGE_LEASE_STATE_UNAVAILABLE");
    if (state === null) {
      const nowMs = this.#now();
      const seeded = {} as ProviderPageLeaseState;
      for (const lobby of RENEWABLE_LOBBIES) {
        seeded[lobby] = { lastCompletedAtMs: nowMs, nextAttemptAtMs: nowMs + this.#intervalMs };
      }
      this.#state = seeded;
      state = seeded;
    }
    const nowMs = this.#now();
    const schedule = state[source.lobby];
    schedule.nextAttemptAtMs = nowMs + this.#failureRetryMs;
    await this.#remember(state);
    if (await this.#options.isLoading(source.tabId)) {
      schedule.nextAttemptAtMs = nowMs + this.#loadingRetryMs;
      await this.#remember(state);
      return;
    }
    if (source.recoveryGuard?.isCurrent() === false) return;
    await this.#options.renew(source);
    this.#renewSerial.set(source.sourceId, (this.#renewSerial.get(source.sourceId) ?? 0) + 1);
    schedule.lastCompletedAtMs = nowMs;
    schedule.nextAttemptAtMs = nowMs + this.#intervalMs;
    await this.#remember(state);
  }

  async #remember(state: ProviderPageLeaseState): Promise<void> {
    this.#state = state;
    await this.#options.saveState(state).catch(() => undefined);
  }
}

export function providerRenewalUrl(lobby: RenewableLobby, currentUrl: string, nowMs: number): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("PROVIDER_RENEWAL_TIME_INVALID");
  let current: URL;
  try { current = new URL(currentUrl); }
  catch { throw new Error("UNTRUSTED_PROVIDER_RENEWAL_URL"); }
  if (!trustedProviderOrigin(lobby, current)) throw new Error("UNTRUSTED_PROVIDER_RENEWAL_URL");

  // Renewal has to follow the language the tab is already on. These paths and
  // parameters were pinned to Vietnamese, so switching a book to English
  // would have sent every renewal to a path that no longer exists and lost
  // the lease. The tab itself is the only thing that knows its language.
  const currentSegments = current.pathname.split("/").filter(Boolean);
  const currentLanguage = /^[a-z]{2}$/u.test(currentSegments[0] ?? "") ? currentSegments[0]! : "vi";
  if (lobby === "BTI") {
    const path = currentLanguage === "vi" ? "/vi/asian-view/today/Bóng-đá" : `/${currentLanguage}/asian-view/today/Football`;
    return new URL(`${path}?operatorToken=logout`, current.origin).href;
  }
  if (lobby === "IM") {
    const renewal = new URL(
      `/?languageCode=${current.searchParams.get("languageCode") ?? "vi"}`, current.origin);
    // preserve a broken SPA instance whose GetSE calls keep returning
    // StatusCode 500. A time-only cache buster forces a fresh shell in the
    // same owned tab without carrying session or account parameters forward.
    renewal.searchParams.set("t", String(nowMs));
    return renewal.href;
  }

  const renewal = new URL(lobby === "SABA" ? "/NewIndex" : "/", current.origin);
  if (lobby === "TSPORT") {
    renewal.searchParams.set("agentId", current.searchParams.get("agentId")?.trim() || "4");
    renewal.searchParams.set("lng", "vi");
    renewal.searchParams.set("t", String(nowMs));
    renewal.searchParams.set("sportType", "1_1");
    renewal.searchParams.set("sportId", "1");
    renewal.searchParams.set("periodId", current.searchParams.get("periodId")?.trim() || "2");
    return renewal.href;
  }
  if (lobby === "KSPORT") {
    renewal.searchParams.set("agentId", current.searchParams.get("agentId")?.trim() || "4");
    renewal.searchParams.set("sportId", "1");
    renewal.searchParams.set("lng", "vi");
    renewal.searchParams.set("t", String(nowMs));
    return renewal.href;
  }
  copyParameters(current, renewal, ["lang", "webskintype", "scmt", "ssmt"]);
  return renewal.href;
}

export async function renewExactProviderTab(
  source: RenewableSource,
  options: ExactProviderRenewalOptions
): Promise<void> {
  if (source.recoveryGuard?.isCurrent() === false) return;
  if (options.canRenew?.(source) === false) throw new Error("SOURCE_REQUEST_BACKOFF");
  if (!options.isAttached(source)) throw new Error("PROVIDER_SOURCE_NOT_ATTACHED");
  const candidate = await options.get(source.tabId);
  if (candidate.id !== source.tabId || typeof candidate.url !== "string") {
    throw new Error("PROVIDER_SOURCE_NOT_ATTACHED");
  }
  const renewalUrl = providerRenewalUrl(source.lobby, candidate.url, (options.now ?? Date.now)());
  const current = await options.get(source.tabId);
  if (!options.isAttached(source) || current.id !== source.tabId || typeof current.url !== "string" ||
    !trustedProviderOrigin(source.lobby, safeUrl(current.url))) {
    throw new Error("PROVIDER_SOURCE_REPLACED");
  }
  if (options.canRenew?.(source) === false) throw new Error("SOURCE_REQUEST_BACKOFF");
  if (source.recoveryGuard?.isCurrent() === false) return;
  options.beginSourceEpoch(source.sourceId);
  const replacementIsCurrent = source.recoveryGuard?.captureIdentity();
  // Navigation can create the provider's catalog socket and issue its one
  // complete roster request before tabs.onUpdated reports `complete`. Arm CDP
  // against the owned tab first, then confirm the redirected document again
  // below. Attaching only after waitForReady permanently missed those first
  // frames and left APSPORT with orphan deltas but no authoritative baseline.
  try {
    await options.attachBootstrap({ ...current, url: renewalUrl }, source.lobby);
  } catch (error) {
    // Keep healthy bootstrap capture before navigation. A dead, already-owned
    // AP renderer is the exception: its CDP timeout must not prevent the tab
    // navigation that replaces it. Other failures and providers stay closed.
    if (source.lobby !== "TSPORT" || !(error instanceof Error) || error.message !== "frame-command-timeout") {
      throw error;
    }
    const stillCurrent = await options.get(source.tabId);
    if (!options.isAttached(source) || stillCurrent.id !== source.tabId ||
      stillCurrent.url !== current.url || !trustedProviderOrigin(source.lobby, safeUrl(stillCurrent.url ?? ""))) {
      throw new Error("PROVIDER_SOURCE_REPLACED");
    }
  }
  if (replacementIsCurrent?.() === false) return;
  if (options.canRenew?.(source) === false) throw new Error("SOURCE_REQUEST_BACKOFF");
  if (!options.isAttached(source)) throw new Error("PROVIDER_SOURCE_REPLACED");
  await options.update(source.tabId, renewalUrl);
  const ready = await options.waitForReady(source.tabId, source.lobby);
  if (ready.id !== source.tabId || typeof ready.url !== "string" ||
    !trustedProviderOrigin(source.lobby, safeUrl(ready.url))) {
    throw new Error("PROVIDER_PAGE_RENEWAL_FAILED");
  }
  await options.attachBootstrap(ready, source.lobby);
  if (!options.isAttached(source)) throw new Error("PROVIDER_SOURCE_REPLACED");
}

function trustedProviderOrigin(lobby: RenewableLobby, url: URL | null): boolean {
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  if (lobby === "BTI") return host === "prod20091.fxf774.com";
  if (lobby === "IM") return host === "imsports.directsb.net";
  if (lobby === "TSPORT") return PACIFIC_HOST.test(host) || host === "sport.asportsb.com";
  if (lobby === "KSPORT") return host === "zenandfe.com";
  return SABA_HOST.test(host) && !SBO_HOST.test(host);
}

function copyParameters(source: URL, target: URL, names: readonly string[]): void {
  for (const name of names) {
    const value = source.searchParams.get(name)?.trim();
    if (value) target.searchParams.set(name, value);
  }
}

function safeUrl(value: string): URL | null {
  try { return new URL(value); }
  catch { return null; }
}
