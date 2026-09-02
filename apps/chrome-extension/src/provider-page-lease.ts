import type { ChromeLobbyId } from "@tool-chenh/contracts";
import type { TabDescriptor } from "./lobby-signatures.js";

export type RenewableLobby = Exclude<ChromeLobbyId, "CMD" | "SBO">;

export interface RenewableSource {
  readonly lobby: RenewableLobby;
  readonly sourceId: string;
  readonly tabId: number;
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
  readonly now?: () => number;
  readonly intervalMs?: number;
  readonly initialStaggerMs?: number;
  readonly loadingRetryMs?: number;
  readonly failureRetryMs?: number;
}

interface ExactProviderRenewalOptions {
  readonly isAttached: (source: RenewableSource) => boolean;
  readonly get: (tabId: number) => Promise<TabDescriptor>;
  readonly attachBootstrap: (tab: TabDescriptor, lobby: RenewableLobby) => Promise<void>;
  readonly beginSourceEpoch: (sourceId: string) => void;
  readonly update: (tabId: number, url: string) => Promise<TabDescriptor>;
  readonly now?: () => number;
}

const PACIFIC_HOST = /^pacific\.(?:agenate|racern)\.com$/iu;
const SABA_HOST = /^c0z0o[a-z0-9]+\.bp[a-z0-9]+\.com$/iu;
const SBO_HOST = /^c0z0o[a-z0-9]+\.(?:bpb7jrm5|bpf7t7s9)\.com$/iu;
const RENEWABLE_LOBBIES = ["BTI", "IM", "TSPORT", "KSPORT", "SABA"] as const;
const DEFAULT_INTERVAL_MS = 20 * 60_000;
const DEFAULT_INITIAL_STAGGER_MS = 2 * 60_000;
const DEFAULT_LOADING_RETRY_MS = 30_000;
const DEFAULT_FAILURE_RETRY_MS = 5 * 60_000;

export function isRenewableLobby(lobby: ChromeLobbyId): lobby is RenewableLobby {
  return RENEWABLE_LOBBIES.includes(lobby as RenewableLobby);
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
  }

  tick(): Promise<void> {
    if (this.#inflight !== null) return this.#inflight.operation;
    return this.#start(null, this.#tickSafely());
  }

  renewNow(source: RenewableSource): Promise<void> {
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
    const dueLobby = RENEWABLE_LOBBIES.filter((lobby) => state[lobby].nextAttemptAtMs <= nowMs)
      .sort((left, right) => state[left].nextAttemptAtMs - state[right].nextAttemptAtMs)[0];
    if (dueLobby === undefined) return;
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

  if (lobby === "BTI") {
    return new URL("/vi/asian-view/today/Bóng-đá?operatorToken=logout", current.origin).href;
  }
  if (lobby === "IM") return new URL("/?languageCode=vi", current.origin).href;

  const renewal = new URL(lobby === "SABA" ? "/NewIndex" : "/", current.origin);
  if (lobby === "TSPORT") {
    copyParameters(current, renewal, ["agentId", "lng"]);
    renewal.searchParams.set("t", String(nowMs));
    copyParameters(current, renewal, ["sportType", "sportId", "periodId"]);
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
  if (!options.isAttached(source)) throw new Error("PROVIDER_SOURCE_NOT_ATTACHED");
  const candidate = await options.get(source.tabId);
  if (candidate.id !== source.tabId || typeof candidate.url !== "string") {
    throw new Error("PROVIDER_SOURCE_NOT_ATTACHED");
  }
  const renewalUrl = providerRenewalUrl(source.lobby, candidate.url, (options.now ?? Date.now)());
  await options.attachBootstrap({ ...candidate, url: renewalUrl }, source.lobby);
  const current = await options.get(source.tabId);
  if (!options.isAttached(source) || current.id !== source.tabId || typeof current.url !== "string" ||
    !trustedProviderOrigin(source.lobby, safeUrl(current.url))) {
    throw new Error("PROVIDER_SOURCE_REPLACED");
  }
  options.beginSourceEpoch(source.sourceId);
  await options.update(source.tabId, renewalUrl);
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
