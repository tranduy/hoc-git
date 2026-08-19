import type { AttachedLobbyTab } from "./tab-registry.js";
import type { ObservedSource } from "./network-observer.js";

export interface CmdSnapshotPollerDependencies {
  readonly list: () => readonly AttachedLobbyTab[];
  readonly capture: (source: ObservedSource, hostname: string) => Promise<void>;
  readonly maintain?: (source: ObservedSource) => Promise<void>;
  readonly refreshCatalog?: (source: ObservedSource) => Promise<void>;
  readonly replaySnapshots?: () => Promise<boolean>;
  readonly now?: () => number;
  readonly replayIntervalMs?: number;
  readonly cmdDiscoveryIntervalMs?: number;
  readonly imDiscoveryIntervalMs?: number;
  readonly setInterval?: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly intervalMs?: number;
}

export class CmdSnapshotPoller {
  readonly #dependencies: CmdSnapshotPollerDependencies;
  readonly #inFlight = new Set<number>();
  #timer: unknown = null;
  #lastReplayAtMs: number | null = null;
  #lastMaintenanceAtMs: number | null = null;
  readonly #lastFastMaintenanceAtMs = new Map<number, number>();
  readonly #lastCatalogRefreshAtMs = new Map<number, number>();
  #replayInFlight = false;
  readonly #maintenanceInFlight = new Set<number>();
  readonly #catalogRefreshInFlight = new Set<number>();
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

  pollNow(): void {
    const now = (this.#dependencies.now ?? Date.now)();
    if (this.#lastScheduledPollAtMs !== null &&
      now - this.#lastScheduledPollAtMs < (this.#dependencies.intervalMs ?? 2_000)) return;
    this.#tick();
  }

  #tick(): void {
    const now = (this.#dependencies.now ?? Date.now)();
    const tabs = this.#dependencies.list();
    if (this.#dependencies.maintain !== undefined &&
      (this.#lastMaintenanceAtMs === null || now - this.#lastMaintenanceAtMs >= 60_000)) {
      this.#lastMaintenanceAtMs = now;
      for (const tab of tabs) {
        if (this.#maintenanceInFlight.has(tab.tabId)) continue;
        if (tab.lobby === "CMD" || tab.lobby === "TSPORT" || tab.lobby === "IM") {
          this.#lastFastMaintenanceAtMs.set(tab.tabId, now);
        }
        this.#maintenanceInFlight.add(tab.tabId);
        const source = { lobby: tab.lobby, sourceId: `chrome:${tab.lobby}:${tab.tabId}`, tabId: tab.tabId } as const;
        void this.#dependencies.maintain(source).catch(() => undefined)
          .finally(() => this.#maintenanceInFlight.delete(tab.tabId));
      }
    }
    if (this.#dependencies.maintain !== undefined) {
      for (const tab of tabs) {
        const intervalMs = tab.lobby === "IM" ? this.#dependencies.imDiscoveryIntervalMs ?? 15_000
          : tab.lobby === "CMD" || tab.lobby === "TSPORT"
            ? this.#dependencies.cmdDiscoveryIntervalMs ?? this.#dependencies.intervalMs ?? 2_000
            : null;
        if (intervalMs === null || this.#maintenanceInFlight.has(tab.tabId) ||
          now - (this.#lastFastMaintenanceAtMs.get(tab.tabId) ?? Number.NEGATIVE_INFINITY) < intervalMs) continue;
        this.#lastFastMaintenanceAtMs.set(tab.tabId, now);
        this.#maintenanceInFlight.add(tab.tabId);
        const source = { lobby: tab.lobby, sourceId: `chrome:${tab.lobby}:${tab.tabId}`, tabId: tab.tabId } as const;
        void this.#dependencies.maintain(source).catch(() => undefined)
          .finally(() => this.#maintenanceInFlight.delete(tab.tabId));
      }
    }
    if (!this.#replayInFlight && this.#dependencies.replaySnapshots !== undefined &&
      (this.#lastReplayAtMs === null || now - this.#lastReplayAtMs >= (this.#dependencies.replayIntervalMs ?? 60_000))) {
      this.#lastReplayAtMs = now;
      this.#replayInFlight = true;
      void this.#dependencies.replaySnapshots().catch(() => false).finally(() => { this.#replayInFlight = false; });
    }
    for (const tab of tabs) {
      if (tab.lobby === "BTI" && this.#dependencies.refreshCatalog !== undefined &&
        !this.#catalogRefreshInFlight.has(tab.tabId) &&
        now - (this.#lastCatalogRefreshAtMs.get(tab.tabId) ?? Number.NEGATIVE_INFINITY) >= 2_000) {
        this.#lastCatalogRefreshAtMs.set(tab.tabId, now);
        this.#catalogRefreshInFlight.add(tab.tabId);
        const source = { lobby: tab.lobby, sourceId: `chrome:${tab.lobby}:${tab.tabId}`, tabId: tab.tabId } as const;
        void this.#dependencies.refreshCatalog(source).catch(() => undefined)
          .finally(() => this.#catalogRefreshInFlight.delete(tab.tabId));
      }
      if ((tab.lobby !== "CMD" && tab.lobby !== "SABA" && tab.lobby !== "TSPORT") ||
        this.#inFlight.has(tab.tabId)) continue;
      this.#inFlight.add(tab.tabId);
      const source = { lobby: tab.lobby, sourceId: `chrome:${tab.lobby}:${tab.tabId}`, tabId: tab.tabId } as const;
      void this.#dependencies.capture(source, tab.hostname)
        .catch(() => undefined)
        .finally(() => this.#inFlight.delete(tab.tabId));
    }
  }
}
