import type { AttachedLobbyTab } from "./tab-registry.js";
import type { ObservedSource } from "./network-observer.js";

const TSPORT_CATALOG_REFRESH_INTERVAL_MS = 60_000;
const WORK_HEALTH_EMIT_INTERVAL_MS = 5_000;
const MIN_WORK_TIMEOUT_MS = 30_000;

export type PollerWorkItem = "maintain" | "refreshCatalog" | "recoverCmdCatalog" |
  "pollSabaDomChanges" | "capture";
export type PollerWorkOutcome = "OK" | "ERROR" | "TIMEOUT" | "SKIPPED_INFLIGHT";

export interface PollerWorkHealth {
  readonly kind: "WORK_HEALTH";
  readonly counters: Readonly<Record<PollerWorkOutcome, number>> & { readonly forcedUnlocks: number };
  readonly lastOutcome: {
    readonly workItem: PollerWorkItem;
    readonly outcome: PollerWorkOutcome;
    readonly durationMs: number;
  } | null;
  readonly lastErrorCode: string | null;
  readonly inFlightAgeMs: number;
}

interface ActiveWork {
  readonly token: symbol;
  readonly source: ObservedSource;
  readonly workItem: PollerWorkItem;
  readonly startedAtMs: number;
  readonly timeoutMs: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface MutableWorkHealth {
  readonly counters: Record<PollerWorkOutcome, number> & { forcedUnlocks: number };
  lastOutcome: PollerWorkHealth["lastOutcome"];
  lastErrorCode: string | null;
}

export interface CmdSnapshotPollerDependencies {
  readonly list: () => readonly AttachedLobbyTab[];
  readonly capture: (source: ObservedSource, hostname: string) => Promise<void>;
  readonly maintain?: (source: ObservedSource) => Promise<void>;
  readonly refreshCatalog?: (source: ObservedSource) => Promise<void>;
  readonly recoverCmdCatalog?: (source: ObservedSource) => Promise<void>;
  readonly pollSabaDomChanges?: (source: ObservedSource, hostname: string) => Promise<void>;
  readonly replaySnapshots?: () => Promise<boolean>;
  readonly now?: () => number;
  readonly replayIntervalMs?: number;
  readonly cmdDiscoveryIntervalMs?: number;
  readonly imDiscoveryIntervalMs?: number;
  readonly setInterval?: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly intervalMs?: number;
  readonly reportWorkHealth?: (source: ObservedSource, health: PollerWorkHealth) => Promise<void> | void;
  readonly log?: (message: string) => void;
}

export class CmdSnapshotPoller {
  readonly #dependencies: CmdSnapshotPollerDependencies;
  readonly #inFlight = new Map<number, symbol>();
  #timer: unknown = null;
  #lastMaintenanceAtMs: number | null = null;
  readonly #lastFastMaintenanceAtMs = new Map<number, number>();
  readonly #lastDomCaptureAtMs = new Map<string, number>();
  readonly #lastCatalogRefreshAtMs = new Map<number, number>();
  readonly #maintenanceInFlight = new Map<number, symbol>();
  readonly #catalogRefreshInFlight = new Map<number, symbol>();
  readonly #activeWork = new Map<string, ActiveWork>();
  readonly #workHealth = new Map<string, MutableWorkHealth>();
  readonly #lastHealthEmittedAtMs = new Map<string, number>();
  readonly #lastPolledSourceIds = new Set<string>();
  #lastScheduledPollAtMs: number | null = null;

  constructor(dependencies: CmdSnapshotPollerDependencies) {
    this.#dependencies = dependencies;
  }

  start(): void {
    if (this.#timer !== null) return;
    const schedule = this.#dependencies.setInterval ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.#timer = schedule(() => {
      this.#lastScheduledPollAtMs = (this.#dependencies.now ?? Date.now)();
      this.#tick();
    }, this.#dependencies.intervalMs ?? 2_000);
  }

  stop(): void {
    if (this.#timer === null) return;
    const cancel = this.#dependencies.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
    cancel(this.#timer);
    this.#timer = null;
  }

  pollNow(forcedSourceIds: readonly string[] = []): void {
    const now = (this.#dependencies.now ?? Date.now)();
    const tabs = this.#dependencies.list();
    const forced = new Set(forcedSourceIds);
    const hasNewSource = tabs.some((tab) =>
      !this.#lastPolledSourceIds.has(`chrome:${tab.lobby}:${tab.tabId}`));
    if (this.#lastScheduledPollAtMs !== null &&
      now - this.#lastScheduledPollAtMs < (this.#dependencies.intervalMs ?? 2_000) && !hasNewSource &&
      forced.size === 0) return;
    this.#tick(tabs, forced);
  }

  #tick(tabs = this.#dependencies.list(), forcedSourceIds = new Set<string>()): void {
    const now = (this.#dependencies.now ?? Date.now)();
    const currentSourceIds = new Set(tabs.map((tab) => `chrome:${tab.lobby}:${tab.tabId}`));
    const currentTabIds = new Set(tabs.map((tab) => tab.tabId));
    const newSourceIds = new Set<string>();
    const maintainedTabIds = new Set<number>();
    const refreshedTabIds = new Set<number>();
    for (const tab of tabs) {
      const sourceId = `chrome:${tab.lobby}:${tab.tabId}`;
      if (this.#lastPolledSourceIds.has(sourceId)) continue;
      newSourceIds.add(sourceId);
      // Chrome can reuse a tab id after a provider handoff. Cadence and
      // in-flight ownership belong to the source, so the replacement must not
      // inherit (or wait for) work started by the retired source.
      this.#lastFastMaintenanceAtMs.delete(tab.tabId);
      this.#lastCatalogRefreshAtMs.delete(tab.tabId);
      this.#clearGuard("maintenance", tab.tabId, this.#maintenanceInFlight);
      this.#clearGuard("catalog", tab.tabId, this.#catalogRefreshInFlight);
      this.#clearGuard("capture", tab.tabId, this.#inFlight);
    }
    for (const tabId of this.#lastFastMaintenanceAtMs.keys()) {
      if (!currentTabIds.has(tabId)) this.#lastFastMaintenanceAtMs.delete(tabId);
    }
    for (const tabId of this.#lastCatalogRefreshAtMs.keys()) {
      if (!currentTabIds.has(tabId)) this.#lastCatalogRefreshAtMs.delete(tabId);
    }
    for (const tabId of this.#maintenanceInFlight.keys()) {
      if (!currentTabIds.has(tabId)) this.#clearGuard("maintenance", tabId, this.#maintenanceInFlight);
    }
    for (const tabId of this.#catalogRefreshInFlight.keys()) {
      if (!currentTabIds.has(tabId)) this.#clearGuard("catalog", tabId, this.#catalogRefreshInFlight);
    }
    for (const tabId of this.#inFlight.keys()) {
      if (!currentTabIds.has(tabId)) this.#clearGuard("capture", tabId, this.#inFlight);
    }
    for (const tab of tabs) {
      const sourceId = `chrome:${tab.lobby}:${tab.tabId}`;
      if (!forcedSourceIds.has(sourceId)) continue;
      this.#lastFastMaintenanceAtMs.delete(tab.tabId);
      this.#lastDomCaptureAtMs.delete(sourceId);
      this.#lastCatalogRefreshAtMs.delete(tab.tabId);
      this.#clearGuard("maintenance", tab.tabId, this.#maintenanceInFlight);
      this.#clearGuard("catalog", tab.tabId, this.#catalogRefreshInFlight);
      this.#clearGuard("capture", tab.tabId, this.#inFlight);
    }
    this.#lastPolledSourceIds.clear();
    for (const sourceId of currentSourceIds) this.#lastPolledSourceIds.add(sourceId);
    for (const sourceId of this.#lastDomCaptureAtMs.keys()) {
      if (!this.#lastPolledSourceIds.has(sourceId)) this.#lastDomCaptureAtMs.delete(sourceId);
    }
    if (this.#dependencies.maintain !== undefined &&
      (this.#lastMaintenanceAtMs === null || now - this.#lastMaintenanceAtMs >= 60_000)) {
      this.#lastMaintenanceAtMs = now;
      for (const tab of tabs) {
        const source = { lobby: tab.lobby, sourceId: `chrome:${tab.lobby}:${tab.tabId}`, tabId: tab.tabId } as const;
        if (this.#guardBlocked("maintenance", tab.tabId, this.#maintenanceInFlight, now)) continue;
        if (tab.lobby === "CMD" || tab.lobby === "TSPORT" || tab.lobby === "IM") {
          this.#lastFastMaintenanceAtMs.set(tab.tabId, now);
        }
        maintainedTabIds.add(tab.tabId);
        this.#startWork("maintenance", tab.tabId, this.#maintenanceInFlight, source, "maintain", 60_000,
          () => this.#dependencies.maintain!(source), now);
      }
    }
    if (this.#dependencies.maintain !== undefined) {
      for (const tab of tabs) {
        const intervalMs = tab.lobby === "IM" ? this.#dependencies.imDiscoveryIntervalMs ?? 15_000
          : tab.lobby === "CMD" || tab.lobby === "TSPORT"
            ? this.#dependencies.cmdDiscoveryIntervalMs ?? 10_000
            : null;
        if (intervalMs === null ||
          now - (this.#lastFastMaintenanceAtMs.get(tab.tabId) ?? Number.NEGATIVE_INFINITY) < intervalMs) continue;
        const source = { lobby: tab.lobby, sourceId: `chrome:${tab.lobby}:${tab.tabId}`, tabId: tab.tabId } as const;
        if (this.#guardBlocked("maintenance", tab.tabId, this.#maintenanceInFlight, now)) continue;
        this.#lastFastMaintenanceAtMs.set(tab.tabId, now);
        maintainedTabIds.add(tab.tabId);
        this.#startWork("maintenance", tab.tabId, this.#maintenanceInFlight, source, "maintain", intervalMs,
          () => this.#dependencies.maintain!(source), now);
      }
    }
    for (const tab of tabs) {
      const sourceId = `chrome:${tab.lobby}:${tab.tabId}`;
      const source = { lobby: tab.lobby, sourceId, tabId: tab.tabId } as const;
      if (tab.lobby === "SABA" && this.#dependencies.pollSabaDomChanges !== undefined &&
        now - (this.#lastCatalogRefreshAtMs.get(tab.tabId) ?? Number.NEGATIVE_INFINITY) >=
          (this.#dependencies.intervalMs ?? 2_000) &&
        !this.#guardBlocked("catalog", tab.tabId, this.#catalogRefreshInFlight, now)) {
        const intervalMs = this.#dependencies.intervalMs ?? 2_000;
        this.#lastCatalogRefreshAtMs.set(tab.tabId, now);
        refreshedTabIds.add(tab.tabId);
        this.#startWork("catalog", tab.tabId, this.#catalogRefreshInFlight, source, "pollSabaDomChanges",
          intervalMs, () => this.#dependencies.pollSabaDomChanges!(source, tab.hostname), now);
      }
      // IM's catalog is a two-part signed GetSE that only the explicit refresh
      // path requests (maintain() deliberately skips it). Without a periodic
      // refresh the provider delivers exactly one baseline per bridge
      // reconnect and then never updates, so schedule it here on its own
      // slower cadence. APSPORT/TSPORT's API roster renews the authoritative
      // generation, while its rate-limited detail walk keeps hidden markets
      // current. Keep it periodic and never fall back to the virtualized DOM.
      const catalogRefreshIntervalMs = tab.lobby === "IM"
        ? this.#dependencies.imDiscoveryIntervalMs ?? 15_000
        : tab.lobby === "CMD" ? 5_000
        : tab.lobby === "BTI" ? 4_000
        : tab.lobby === "KSPORT" ? 2_000
        : tab.lobby === "TSPORT"
          ? TSPORT_CATALOG_REFRESH_INTERVAL_MS
          : null;
      const refreshCatalog = tab.lobby === "CMD"
        ? this.#dependencies.recoverCmdCatalog ?? this.#dependencies.refreshCatalog
        : this.#dependencies.refreshCatalog;
      if (catalogRefreshIntervalMs !== null && refreshCatalog !== undefined &&
        now - (this.#lastCatalogRefreshAtMs.get(tab.tabId) ?? Number.NEGATIVE_INFINITY) >= catalogRefreshIntervalMs &&
        !this.#guardBlocked("catalog", tab.tabId, this.#catalogRefreshInFlight, now)) {
        this.#lastCatalogRefreshAtMs.set(tab.tabId, now);
        refreshedTabIds.add(tab.tabId);
        if (tab.lobby === "TSPORT") {
          this.#lastDomCaptureAtMs.set(sourceId, now);
        }
        const workItem: PollerWorkItem = tab.lobby === "CMD" && this.#dependencies.recoverCmdCatalog !== undefined
          ? "recoverCmdCatalog" : "refreshCatalog";
        this.#startWork("catalog", tab.tabId, this.#catalogRefreshInFlight, source, workItem,
          catalogRefreshIntervalMs, () => refreshCatalog(source), now);
      }
      if (tab.lobby !== "CMD" ||
        this.#guardBlocked("capture", tab.tabId, this.#inFlight, now) ||
        (maintainedTabIds.has(tab.tabId) && !newSourceIds.has(sourceId) &&
          !forcedSourceIds.has(sourceId)) ||
        refreshedTabIds.has(tab.tabId)) continue;
      const domCaptureIntervalMs = this.#dependencies.cmdDiscoveryIntervalMs ?? 10_000;
      if (now - (this.#lastDomCaptureAtMs.get(sourceId) ?? Number.NEGATIVE_INFINITY) <
        domCaptureIntervalMs) continue;
      this.#lastDomCaptureAtMs.set(sourceId, now);
      this.#startWork("capture", tab.tabId, this.#inFlight, source, "capture", domCaptureIntervalMs,
        () => this.#dependencies.capture(source, tab.hostname), now);
    }
  }

  #startWork(guard: "maintenance" | "catalog" | "capture", tabId: number,
    owners: Map<number, symbol>, source: ObservedSource, workItem: PollerWorkItem,
    intervalMs: number, operation: () => Promise<void>, startedAtMs: number): void {
    const token = Symbol(workItem);
    const timeoutMs = Math.max(intervalMs * 3, MIN_WORK_TIMEOUT_MS);
    const key = `${guard}:${tabId}`;
    owners.set(tabId, token);
    const active: ActiveWork = { token, source, workItem, startedAtMs, timeoutMs, timeoutHandle: null };
    this.#activeWork.set(key, active);
    let work: Promise<void>;
    try { work = operation(); }
    catch (error) {
      this.#finishWork(key, tabId, owners, token, "ERROR", sanitizeErrorCode(error));
      return;
    }
    active.timeoutHandle = setTimeout(() => {
      this.#finishWork(key, tabId, owners, token, "TIMEOUT", "WORK_ITEM_TIMEOUT");
    }, timeoutMs);
    (active.timeoutHandle as unknown as { unref?: () => void }).unref?.();
    let outcome: Exclude<PollerWorkOutcome, "SKIPPED_INFLIGHT"> = "OK";
    let errorCode: string | null = null;
    void work.catch((error) => {
      outcome = "ERROR";
      errorCode = sanitizeErrorCode(error);
    }).finally(() => this.#finishWork(key, tabId, owners, token, outcome, errorCode));
  }

  #finishWork(key: string, tabId: number, owners: Map<number, symbol>, token: symbol,
    outcome: Exclude<PollerWorkOutcome, "SKIPPED_INFLIGHT">, errorCode: string | null): void {
    const active = this.#activeWork.get(key);
    if (owners.get(tabId) !== token || active?.token !== token) return;
    if (active.timeoutHandle !== null) clearTimeout(active.timeoutHandle);
    owners.delete(tabId);
    this.#activeWork.delete(key);
    const now = (this.#dependencies.now ?? Date.now)();
    this.#recordOutcome(active.source, active.workItem, outcome,
      Math.max(0, now - active.startedAtMs), errorCode, now);
  }

  #guardBlocked(guard: "maintenance" | "catalog" | "capture", tabId: number,
    owners: Map<number, symbol>, now: number): boolean {
    const key = `${guard}:${tabId}`;
    const active = this.#activeWork.get(key);
    if (!owners.has(tabId) || active === undefined) return false;
    const ageMs = Math.max(0, now - active.startedAtMs);
    if (ageMs > active.timeoutMs) {
      if (active.timeoutHandle !== null) clearTimeout(active.timeoutHandle);
      owners.delete(tabId);
      this.#activeWork.delete(key);
      const health = this.#health(active.source.sourceId);
      health.counters.forcedUnlocks += 1;
      this.#recordOutcome(active.source, active.workItem, "TIMEOUT", ageMs, "WORK_ITEM_TIMEOUT", now);
      this.#dependencies.log?.(`[poller-work] ${active.source.sourceId} ${active.workItem} TIMEOUT ` +
        `forcedUnlocks=${health.counters.forcedUnlocks}`);
      return false;
    }
    this.#recordOutcome(active.source, active.workItem, "SKIPPED_INFLIGHT", ageMs, null, now);
    return true;
  }

  #clearGuard(guard: "maintenance" | "catalog" | "capture", tabId: number,
    owners: Map<number, symbol>): void {
    const active = this.#activeWork.get(`${guard}:${tabId}`);
    if (active?.timeoutHandle !== null && active?.timeoutHandle !== undefined) clearTimeout(active.timeoutHandle);
    owners.delete(tabId);
    this.#activeWork.delete(`${guard}:${tabId}`);
  }

  #recordOutcome(source: ObservedSource, workItem: PollerWorkItem, outcome: PollerWorkOutcome,
    durationMs: number, errorCode: string | null, now: number): void {
    const health = this.#health(source.sourceId);
    health.counters[outcome] += 1;
    health.lastOutcome = { workItem, outcome, durationMs };
    if (errorCode !== null) health.lastErrorCode = errorCode;
    this.#emitWorkHealth(source, health, now);
  }

  #health(sourceId: string): MutableWorkHealth {
    let health = this.#workHealth.get(sourceId);
    if (health === undefined) {
      health = { counters: { OK: 0, ERROR: 0, TIMEOUT: 0, SKIPPED_INFLIGHT: 0, forcedUnlocks: 0 },
        lastOutcome: null, lastErrorCode: null };
      this.#workHealth.set(sourceId, health);
    }
    return health;
  }

  #emitWorkHealth(source: ObservedSource, health: MutableWorkHealth, now: number): void {
    if (this.#dependencies.reportWorkHealth === undefined ||
      now - (this.#lastHealthEmittedAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) <
        WORK_HEALTH_EMIT_INTERVAL_MS) return;
    this.#lastHealthEmittedAtMs.set(source.sourceId, now);
    const inFlightAgeMs = [...this.#activeWork.values()]
      .filter((active) => active.source.sourceId === source.sourceId)
      .reduce((oldest, active) => Math.max(oldest, now - active.startedAtMs), 0);
    const diagnostic: PollerWorkHealth = {
      kind: "WORK_HEALTH", counters: { ...health.counters }, lastOutcome: health.lastOutcome,
      lastErrorCode: health.lastErrorCode, inFlightAgeMs: Math.max(0, inFlightAgeMs)
    };
    void Promise.resolve(this.#dependencies.reportWorkHealth(source, diagnostic)).catch(() => undefined);
  }
}

function sanitizeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : typeof error === "string" ? error : "WORK_ITEM_ERROR";
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : "WORK_ITEM_ERROR";
}
