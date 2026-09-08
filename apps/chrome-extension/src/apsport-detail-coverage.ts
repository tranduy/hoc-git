export interface ApsportDetailCoverageSnapshot {
  readonly rosterEvents: number;
  readonly successfulEvents: number;
  readonly withMarketsEvents: number;
  readonly emptyEvents: number;
  readonly pendingEvents: number;
  readonly failedEvents: number;
  readonly queuedEvents: number;
  readonly inFlightEvents: number;
  readonly complete: boolean;
  readonly oldestSuccessAgeMs: number | null;
}

interface EventCoverage {
  successAtMs: number | null;
  hasMarkets: boolean | null;
  latestFailed: boolean;
  queued: boolean;
  inFlight: boolean;
}

function emptyCoverage(): EventCoverage {
  return { successAtMs: null, hasMarkets: null, latestFailed: false, queued: false, inFlight: false };
}

/** Bounded, payload-free detail-collection evidence for the current prematch roster.
 * It does not assert downstream publication or global price freshness. */
export class ApsportDetailCoverage {
  readonly #events = new Map<string, EventCoverage>();
  #rosterEstablished = false;

  reconcileRoster(eventIds: readonly string[]): void {
    const next = new Map<string, EventCoverage>();
    for (const eventId of new Set(eventIds)) {
      if (eventId.trim() === "" || eventId.length > 128) continue;
      next.set(eventId, this.#events.get(eventId) ?? emptyCoverage());
    }
    this.#events.clear();
    for (const [eventId, state] of next) this.#events.set(eventId, state);
    this.#rosterEstablished = true;
  }

  markQueued(eventId: string): void {
    const state = this.#events.get(eventId);
    if (state === undefined) return;
    state.queued = true;
    state.inFlight = false;
  }

  markInFlight(eventId: string): void {
    const state = this.#events.get(eventId);
    if (state === undefined) return;
    state.queued = false;
    state.inFlight = true;
  }

  markFailure(eventId: string): void {
    const state = this.#events.get(eventId);
    if (state === undefined) return;
    state.queued = false;
    state.inFlight = false;
    state.latestFailed = true;
  }

  removeEvent(eventId: string): void {
    this.#events.delete(eventId);
  }

  markSuccess(eventId: string, hasMarkets: boolean, atMs: number): void {
    const state = this.#events.get(eventId);
    if (state === undefined || !Number.isFinite(atMs)) return;
    state.successAtMs = atMs;
    state.hasMarkets = hasMarkets;
    state.latestFailed = false;
    state.queued = false;
    state.inFlight = false;
  }

  markActiveWorkFailed(): void {
    for (const [eventId, state] of this.#events) {
      if (state.queued || state.inFlight) this.markFailure(eventId);
    }
  }

  reset(): void {
    this.#events.clear();
    this.#rosterEstablished = false;
  }

  snapshot(nowMs: number): ApsportDetailCoverageSnapshot {
    const states = [...this.#events.values()];
    const successful = states.filter((state) => state.successAtMs !== null);
    const oldestSuccessAtMs = successful.reduce<number | null>((oldest, state) =>
      oldest === null || state.successAtMs! < oldest ? state.successAtMs! : oldest, null);
    return {
      rosterEvents: states.length,
      successfulEvents: successful.length,
      withMarketsEvents: successful.filter((state) => state.hasMarkets === true).length,
      emptyEvents: successful.filter((state) => state.hasMarkets === false).length,
      pendingEvents: states.filter((state) => state.successAtMs === null).length,
      failedEvents: states.filter((state) => state.latestFailed).length,
      queuedEvents: states.filter((state) => state.queued).length,
      inFlightEvents: states.filter((state) => state.inFlight).length,
      complete: this.#rosterEstablished && states.every((state) =>
        state.successAtMs !== null && !state.latestFailed),
      oldestSuccessAgeMs: oldestSuccessAtMs === null || !Number.isFinite(nowMs)
        ? null : Math.max(0, nowMs - oldestSuccessAtMs)
    };
  }
}
