export type SabaCollectorPeriod = "TODAY" | "EARLY";

export interface SabaCollectorBinding {
  readonly sourceEpoch: string;
  readonly frameKey: string;
  readonly documentKey: string;
}

export interface SabaCollectorOdd {
  readonly marketOddsId: string;
  readonly priceText: string;
  readonly status: string | null;
  readonly greyedOut: string | null;
  readonly lineText?: string | null;
}

export interface SabaCollectorGroup {
  readonly betTypeIds: readonly string[];
  readonly labels: readonly string[];
  readonly odds: readonly SabaCollectorOdd[];
}

// Extension-local structural mirror. The API remains the runtime schema authority.
export interface SabaCollectorRecord {
  readonly sportId: "1";
  readonly leagueId: string;
  readonly leagueName: string;
  readonly matchId: string;
  readonly timeText: string;
  readonly providerTimezoneOffsetMinutes?: number | null;
  readonly teamNames: readonly string[];
  readonly groups: readonly SabaCollectorGroup[];
}

export type SabaCollectorKickoffDate = { readonly kind: "EXPLICIT"; readonly isoDate: string } |
  { readonly kind: "UNKNOWN" };

interface SabaCollectorReadClock {
  readonly capturedAtMs: number;
  readonly capturedMonotonicMs: number;
}

export interface SabaCollectorRosterOwner extends SabaCollectorReadClock {
  readonly ownerMatchId: string;
  readonly record: SabaCollectorRecord;
  readonly control: "ELIGIBLE_MORE" | "NO_ELIGIBLE_CONTROL";
  readonly kickoffDate: SabaCollectorKickoffDate;
}

export interface SabaCollectorRosterResult {
  readonly binding: SabaCollectorBinding;
  readonly period: SabaCollectorPeriod;
  readonly selectedPrematch: true;
  readonly owners: readonly SabaCollectorRosterOwner[];
}

export interface SabaCollectorOwnerCaptureResult {
  readonly binding: SabaCollectorBinding;
  readonly period: SabaCollectorPeriod;
  readonly ownerMatchId: string;
  readonly observedAtMs?: number;
  readonly controlOpened: true;
  readonly terminalControlState: "RESTORED_CLOSED";
  readonly restored: true;
  readonly safeControlOutcome: "NO_STRUCTURAL_CHANGE" | "ALTERNATE_ROWS_ADDED" |
    "OWNER_GROUPS_EXPANDED";
  readonly capture?: SabaCollectorReadClock & {
    readonly record: SabaCollectorRecord;
    readonly kickoffDate: SabaCollectorKickoffDate;
  };
}

export interface SabaCollectorTodayRestoreResult {
  readonly binding: SabaCollectorBinding;
  readonly selectedPrematch: true;
  readonly rosterMatchIds: readonly string[];
}

export interface SabaCollectorPageAdapter {
  readRoster(period: SabaCollectorPeriod): Promise<SabaCollectorRosterResult>;
  captureOwner(period: SabaCollectorPeriod,
    owner: SabaCollectorRosterOwner): Promise<SabaCollectorOwnerCaptureResult>;
  restoreToday(): Promise<SabaCollectorTodayRestoreResult>;
}

export interface SabaCollectorCaptureItem {
  readonly kind: "CAPTURE";
  readonly collectorGeneration: string;
  readonly period: SabaCollectorPeriod;
  readonly ownerMatchId: string;
  readonly captureKind: "ROSTER" | "ALTERNATE_ROWS_ADDED" | "OWNER_GROUPS_EXPANDED";
  readonly kickoffDate: SabaCollectorKickoffDate;
  readonly capturedAtMs: number;
  readonly capturedMonotonicMs: number;
  readonly captureOrdinal: number;
  readonly record: SabaCollectorRecord;
}

export interface SabaCollectorOwnerCompleteItem {
  readonly kind: "OWNER_COMPLETE";
  readonly collectorGeneration: string;
  readonly period: SabaCollectorPeriod;
  readonly ownerMatchId: string;
  readonly safeControlOutcome: "NO_ELIGIBLE_CONTROL" | "NO_STRUCTURAL_CHANGE" |
    "ALTERNATE_ROWS_ADDED" | "OWNER_GROUPS_EXPANDED";
  readonly restored: boolean;
}

export interface SabaCollectorPeriodCompleteItem {
  readonly kind: "PERIOD_COMPLETE";
  readonly collectorGeneration: string;
  readonly period: SabaCollectorPeriod;
  readonly rosterMatchIds: readonly string[];
  readonly rosterCount: number;
}

export interface SabaCollectorTerminalItem {
  readonly kind: "TERMINAL";
  readonly collectorGeneration: string;
  readonly periods: readonly [{
    readonly period: "TODAY"; readonly rosterMatchIds: readonly string[]; readonly rosterCount: number
  }, {
    readonly period: "EARLY"; readonly rosterMatchIds: readonly string[]; readonly rosterCount: number
  }];
  readonly owners: readonly { readonly period: SabaCollectorPeriod; readonly ownerMatchId: string }[];
  readonly todayRestoration: { readonly selected: boolean; readonly rosterMatchIds: readonly string[];
    readonly rosterCount: number };
  readonly unresolvedOwners: readonly { readonly period: SabaCollectorPeriod;
    readonly ownerMatchId: string }[];
  readonly failedOwners: readonly { readonly period: SabaCollectorPeriod;
    readonly ownerMatchId: string }[];
}

export type SabaCollectorDomItem = SabaCollectorCaptureItem | SabaCollectorOwnerCompleteItem |
  SabaCollectorPeriodCompleteItem | SabaCollectorTerminalItem;

export interface SabaMainRosterTerminalItem {
  readonly kind: "MAIN_ROSTER_TERMINAL";
  readonly collectorGeneration: string;
  readonly periods: SabaCollectorTerminalItem["periods"];
  readonly owners: SabaCollectorTerminalItem["owners"];
  readonly todayRestoration: SabaCollectorTerminalItem["todayRestoration"];
  readonly hiddenMarketsComplete: false;
}

export type SabaMainRosterItem = SabaCollectorCaptureItem | SabaMainRosterTerminalItem;

export type SabaCollectorAdvanceError = "BINDING_CHANGED" | "ADAPTER_ERROR" |
  "ROSTER_UNCONFIRMED" | "OWNER_CAPTURE_UNSAFE" | "TODAY_RESTORE_UNCONFIRMED";

export interface SabaScheduledOwnerTerminalItem {
  readonly kind: "SCHEDULED_OWNER_TERMINAL";
  readonly collectorGeneration: string;
  readonly mainRosterGeneration: string;
  readonly owners: readonly { readonly period: SabaCollectorPeriod; readonly ownerMatchId: string }[];
  readonly hiddenMarketsComplete: false;
}

export interface SabaCollectorAdvanceResult {
  readonly status: "INCOMPLETE" | "COMPLETE" | "SAFE_ERROR" | "STALE_BINDING";
  readonly items: readonly SabaCollectorDomItem[];
  readonly candidateItems: readonly SabaCollectorDomItem[];
  readonly mainRosterItems?: readonly SabaMainRosterItem[];
  readonly mainRosterChanged?: boolean;
  readonly scheduledCaptureItems?: readonly SabaCollectorCaptureItem[];
  readonly scheduledItems?: readonly (SabaCollectorDomItem | SabaScheduledOwnerTerminalItem)[];
  readonly scheduledVisits?: readonly { readonly period: SabaCollectorPeriod; readonly ownerMatchId: string }[];
  readonly error?: SabaCollectorAdvanceError;
}

export interface SabaHiddenMarketCollectorOptions {
  readonly collectorGeneration: string;
  readonly binding: SabaCollectorBinding;
  readonly adapter: SabaCollectorPageAdapter;
  readonly publishMainRosterFirst?: boolean;
  /** Opt-in recurring partial acquisition. A deferred owner is never marked complete. */
  readonly shouldCaptureOwner?: (period: SabaCollectorPeriod, owner: SabaCollectorRosterOwner,
    lastVisitAtMs: number | null) => boolean;
  readonly onCaptured?: (period: SabaCollectorPeriod, owner: SabaCollectorRosterOwner,
    actualReadAtMs: number) => void;
  readonly sortOwners?: (eventIds: readonly string[]) => readonly string[];
  readonly nowMs?: () => number;
  readonly isSchedulingEnabled?: () => boolean;
}

interface PeriodState {
  roster: readonly SabaCollectorRosterOwner[] | null;
  cursor: number;
  complete: boolean;
  validatedNoGrowthPending: boolean;
}

type ResumableOperation = {
  readonly kind: "OWNER_CAPTURE";
  readonly period: SabaCollectorPeriod;
  readonly ownerMatchId: string;
} | {
  readonly kind: "ROSTER_READ";
  readonly period: SabaCollectorPeriod;
  readonly stage: "INITIAL" | "RECONCILIATION";
};

const PERIODS: readonly SabaCollectorPeriod[] = ["TODAY", "EARLY"];
const RESUMABLE_FRAME_COMMAND_TIMEOUT = "SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT";
const RESUMABLE_OPERATION_DEADLINE = "SABA_COLLECTOR_OPERATION_DEADLINE";
const RESUMABLE_OWNER_PREPARATION_TIMEOUT = "SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT";

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function resumableRosterReadError(error: unknown): boolean {
  const message = errorMessage(error);
  return message === RESUMABLE_FRAME_COMMAND_TIMEOUT || message === RESUMABLE_OPERATION_DEADLINE;
}

function resumableOwnerCaptureError(error: unknown): boolean {
  const message = errorMessage(error);
  return message === RESUMABLE_FRAME_COMMAND_TIMEOUT ||
    message === RESUMABLE_OWNER_PREPARATION_TIMEOUT;
}

function sameBinding(left: SabaCollectorBinding, right: SabaCollectorBinding): boolean {
  return left.sourceEpoch === right.sourceEpoch && left.frameKey === right.frameKey &&
    left.documentKey === right.documentKey;
}

function sameOrderedRoster(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRosterMembership(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    new Set(right).size === right.length && left.every((value) => right.includes(value));
}

function validWallClock(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validMonotonicClock(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validRosterOwner(owner: SabaCollectorRosterOwner): boolean {
  return owner.ownerMatchId.length > 0 && owner.record.matchId === owner.ownerMatchId &&
    (owner.control === "ELIGIBLE_MORE" || owner.control === "NO_ELIGIBLE_CONTROL") &&
    validWallClock(owner.capturedAtMs) && validMonotonicClock(owner.capturedMonotonicMs);
}

function validMonotonicSequence(owners: readonly SabaCollectorRosterOwner[], prior: number): boolean {
  for (const owner of owners) {
    if (owner.capturedMonotonicMs < prior) return false;
    prior = owner.capturedMonotonicMs;
  }
  return true;
}

function validKickoffDate(value: SabaCollectorKickoffDate): boolean {
  if (value.kind === "UNKNOWN") return true;
  if (value.kind !== "EXPLICIT" || !/^\d{4}-\d{2}-\d{2}$/u.test(value.isoDate)) return false;
  const parsed = new Date(`${value.isoDate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value.isoDate;
}

function stableOwnerIdentity(owner: SabaCollectorRosterOwner): string {
  const { record, kickoffDate } = owner;
  return JSON.stringify([owner.ownerMatchId, record.sportId, record.matchId, record.leagueId,
    record.leagueName, record.timeText, record.providerTimezoneOffsetMinutes === undefined
      ? 480 : record.providerTimezoneOffsetMinutes, [...record.teamNames], owner.control,
    kickoffDate.kind, kickoffDate.kind === "EXPLICIT" ? kickoffDate.isoDate : null]);
}

function continuationAllowed(shouldContinue: (() => boolean) | undefined): boolean {
  if (shouldContinue === undefined) return true;
  try { return shouldContinue() === true; } catch { return false; }
}

export class SabaHiddenMarketCollector {
  readonly #generation: string;
  readonly #binding: SabaCollectorBinding;
  readonly #adapter: SabaCollectorPageAdapter;
  readonly #publishMainRosterFirst: boolean;
  readonly #schedule: Pick<SabaHiddenMarketCollectorOptions, "shouldCaptureOwner" | "onCaptured" | "sortOwners" | "isSchedulingEnabled">;
  readonly #lastVisits = new Map<string, number>();
  #scheduledPeriod: SabaCollectorPeriod | null = null;
  #scheduledSequence = 0;
  readonly #now: () => number;
  #nextMainRefreshAtMs = Infinity;
  #mainSequence = 0;
  #mainPeriodIndex = 0;
  #mainRosterItems: readonly SabaMainRosterItem[] | undefined;
  readonly #periods: Record<SabaCollectorPeriod, PeriodState> = {
    TODAY: { roster: null, cursor: 0, complete: false, validatedNoGrowthPending: false },
    EARLY: { roster: null, cursor: 0, complete: false, validatedNoGrowthPending: false }
  };
  readonly #candidateItems: SabaCollectorDomItem[] = [];
  #periodIndex = 0;
  #captureOrdinal = 0;
  #lastCapturedMonotonicMs = -1;
  #terminalEmitted = false;
  #frozen: { status: "SAFE_ERROR" | "STALE_BINDING"; error: SabaCollectorAdvanceError } | null = null;
  #resumableOperation: ResumableOperation | null = null;
  readonly #ownerResumeCounts = new Map<string, number>();
  #tail: Promise<void> = Promise.resolve();

  constructor(options: SabaHiddenMarketCollectorOptions) {
    this.#generation = options.collectorGeneration;
    this.#binding = { ...options.binding };
    this.#adapter = options.adapter;
    this.#schedule = options;
    this.#now = options.nowMs ?? Date.now;
    this.#publishMainRosterFirst = options.publishMainRosterFirst === true || options.shouldCaptureOwner !== undefined;
  }

  get currentPeriod(): SabaCollectorPeriod | null {
    if (this.#publishMainRosterFirst && this.#mainRosterItems === undefined) {
      return PERIODS[this.#mainPeriodIndex] ?? "TODAY";
    }
    if (this.scheduledCollection) {
      if (this.#scheduledPeriod) return this.#scheduledPeriod;
      try {
        for (const period of PERIODS) if (this.#periods[period].roster?.some(owner =>
          owner.control === "ELIGIBLE_MORE" && this.#schedule.shouldCaptureOwner!(period, owner,
            this.#lastVisits.get(`${period}:${owner.ownerMatchId}`) ?? null))) return period;
      } catch { /* The advance operation owns scheduling error handling. */ }
      return "TODAY";
    }
    return this.#terminalEmitted || this.#periodIndex >= PERIODS.length ? null : PERIODS[this.#periodIndex]!;
  }

  get scheduledCollection(): boolean {
    return this.#schedule.shouldCaptureOwner !== undefined && (this.#schedule.isSchedulingEnabled?.() ?? true);
  }

  get mainRosterComplete(): boolean { return this.#mainRosterItems !== undefined; }
  get hiddenMarketsComplete(): boolean { return this.#terminalEmitted; }
  get terminalError(): SabaCollectorAdvanceError | null { return this.#frozen?.error ?? null; }

  advance(maxOwnersPerSlice: number,
    shouldContinue?: () => boolean,
    options: { readonly maxPassiveOwnersPerSlice?: number } = {}): Promise<SabaCollectorAdvanceResult> {
    if (!Number.isSafeInteger(maxOwnersPerSlice) || maxOwnersPerSlice <= 0) {
      return Promise.reject(new RangeError("maxOwnersPerSlice must be a positive safe integer"));
    }
    const passiveLimit = options.maxPassiveOwnersPerSlice;
    if (passiveLimit !== undefined && (!Number.isSafeInteger(passiveLimit) || passiveLimit < 1 || passiveLimit > 512)) {
      return Promise.reject(new RangeError("maxPassiveOwnersPerSlice must be an integer between 1 and 512"));
    }
    const operation = this.#tail.then(() => this.#advance(maxOwnersPerSlice, shouldContinue, passiveLimit));
    this.#tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  resumeAfterVerifiedTodayRestore(restoration: SabaCollectorTodayRestoreResult): boolean {
    const todayRoster = this.#periods.TODAY.roster;
    const resumable = this.#resumableOperation;
    if (this.#terminalEmitted || this.#frozen?.status !== "SAFE_ERROR" ||
      this.#frozen.error !== "ADAPTER_ERROR" || resumable === null ||
      !sameBinding(restoration.binding, this.#binding) || restoration.selectedPrematch !== true) {
      return false;
    }

    const restoredIds = restoration.rosterMatchIds;
    if (new Set(restoredIds).size !== restoredIds.length) return false;
    if (todayRoster === null) {
      if (resumable.kind !== "ROSTER_READ" || resumable.period !== "TODAY" ||
        resumable.stage !== "INITIAL" || this.#candidateItems.length !== 0) return false;
    } else {
      const todayIds = todayRoster.map(({ ownerMatchId }) => ownerMatchId);
      const todayRestored = resumable.kind === "ROSTER_READ" ?
        sameRosterMembership(restoredIds, todayIds) : sameOrderedRoster(restoredIds, todayIds);
      if (!todayRestored) return false;
    }

    const mainPending = this.#publishMainRosterFirst && this.#mainRosterItems === undefined;
    const period = PERIODS[mainPending ? this.#mainPeriodIndex : this.#periodIndex];
    if (period !== resumable.period) return false;
    const state = this.#periods[period];
    let retryKey: string;
    if (resumable.kind === "OWNER_CAPTURE") {
      const currentOwner = state.roster?.[state.cursor];
      if (currentOwner?.ownerMatchId !== resumable.ownerMatchId) return false;
      retryKey = `${period}\u0000OWNER\u0000${resumable.ownerMatchId}`;
    } else {
      const expectedStage = state.roster === null ? "INITIAL" :
        (mainPending || state.cursor >= state.roster.length) && !state.complete ? "RECONCILIATION" : null;
      if (expectedStage !== resumable.stage) return false;
      retryKey = `${period}\u0000ROSTER\u0000${resumable.stage}`;
    }

    const resumes = this.#ownerResumeCounts.get(retryKey) ?? 0;
    if (resumes >= 2) return false;
    this.#ownerResumeCounts.set(retryKey, resumes + 1);
    this.#frozen = null;
    this.#resumableOperation = null;
    return true;
  }

  async #advance(maxOwnersPerSlice: number,
    shouldContinue?: () => boolean, maxPassiveOwnersPerSlice?: number): Promise<SabaCollectorAdvanceResult> {
    const emitted: SabaCollectorDomItem[] = [];
    if (this.#terminalEmitted && this.scheduledCollection) {
      this.#terminalEmitted = false;
      this.#candidateItems.splice(0, this.#candidateItems.length,
        ...this.#candidateItems.filter(item => item.kind === "CAPTURE" && item.captureKind === "ROSTER"));
    }
    if (this.#terminalEmitted) return this.#result("COMPLETE", emitted);
    if (this.#frozen) return this.#result(this.#frozen.status, emitted, this.#frozen.error);
    if (this.scheduledCollection && this.#mainRosterItems !== undefined &&
      this.#now() >= this.#nextMainRefreshAtMs) {
      this.#mainSequence += 1;
      this.#mainPeriodIndex = 0;
      this.#mainRosterItems = undefined;
      this.#candidateItems.splice(0);
      for (const period of PERIODS) this.#periods[period] = {
        roster: null, cursor: 0, complete: false, validatedNoGrowthPending: false };
    }
    if (this.#publishMainRosterFirst && this.#mainRosterItems === undefined) {
      return this.#advanceMainRoster(emitted, shouldContinue);
    }
    if (this.scheduledCollection) return this.#advanceScheduled(maxOwnersPerSlice, shouldContinue);
    let processedOwners = 0;
    let passiveOwners = 0;

    while (this.#periodIndex < PERIODS.length) {
      if (!continuationAllowed(shouldContinue)) return this.#result("INCOMPLETE", emitted);
      const period = PERIODS[this.#periodIndex]!;
      const state = this.#periods[period];
      if (state.validatedNoGrowthPending && shouldContinue !== undefined) {
        state.validatedNoGrowthPending = false;
        this.#completePeriod(period, state, emitted);
        continue;
      }
      if (state.validatedNoGrowthPending) state.validatedNoGrowthPending = false;
      if (state.roster === null) {
        if (processedOwners >= maxOwnersPerSlice) return this.#result("INCOMPLETE", emitted);
        let result: SabaCollectorRosterResult;
        try {
          result = await this.#adapter.readRoster(period);
        } catch (error) {
          const resumable = resumableRosterReadError(error) ?
            { kind: "ROSTER_READ" as const, period, stage: "INITIAL" as const } : null;
          return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted, resumable);
        }
        if (!sameBinding(result.binding, this.#binding)) {
          return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
        }
        const ids = result.owners.map(({ ownerMatchId }) => ownerMatchId);
        if (result.period !== period || result.selectedPrematch !== true ||
          new Set(ids).size !== ids.length || !result.owners.every(validRosterOwner) ||
          !validMonotonicSequence(result.owners, this.#lastCapturedMonotonicMs) ||
          !result.owners.every(({ kickoffDate }) => validKickoffDate(kickoffDate))) {
          return this.#freeze("SAFE_ERROR", "ROSTER_UNCONFIRMED", emitted);
        }
        state.roster = [...result.owners];
        for (const rosterOwner of state.roster) {
          this.#emit(this.#capture(period, rosterOwner.ownerMatchId, "ROSTER", rosterOwner), emitted);
        }
        if (!continuationAllowed(shouldContinue)) return this.#result("INCOMPLETE", emitted);
      }

      if (state.cursor >= state.roster.length) {
        let result: SabaCollectorRosterResult;
        try {
          result = await this.#adapter.readRoster(period);
        } catch (error) {
          const resumable = resumableRosterReadError(error) ?
            { kind: "ROSTER_READ" as const, period, stage: "RECONCILIATION" as const } : null;
          return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted, resumable);
        }
        if (!sameBinding(result.binding, this.#binding)) {
          return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
        }
        const ids = result.owners.map(({ ownerMatchId }) => ownerMatchId);
        if (result.period !== period || result.selectedPrematch !== true ||
          new Set(ids).size !== ids.length || !result.owners.every(validRosterOwner) ||
          !validMonotonicSequence(result.owners, this.#lastCapturedMonotonicMs) ||
          !result.owners.every(({ kickoffDate }) => validKickoffDate(kickoffDate))) {
          return this.#freeze("SAFE_ERROR", "ROSTER_UNCONFIRMED", emitted);
        }
        const currentOwners = new Map(result.owners.map((owner) => [owner.ownerMatchId, owner]));
        if (state.roster.some((owner) => {
          const current = currentOwners.get(owner.ownerMatchId);
          return current === undefined || stableOwnerIdentity(current) !== stableOwnerIdentity(owner);
        })) return this.#freeze("SAFE_ERROR", "ROSTER_UNCONFIRMED", emitted);
        const knownIds = new Set(state.roster.map(({ ownerMatchId }) => ownerMatchId));
        const additions = result.owners.filter(({ ownerMatchId }) => !knownIds.has(ownerMatchId));
        if (additions.length > 0) {
          state.roster = [...state.roster, ...additions];
          for (const addition of additions) {
            this.#emit(this.#capture(period, addition.ownerMatchId, "ROSTER", addition), emitted);
          }
        }
        if (!continuationAllowed(shouldContinue)) {
          if (additions.length === 0) state.validatedNoGrowthPending = true;
          return this.#result("INCOMPLETE", emitted);
        }
        if (additions.length === 0) this.#completePeriod(period, state, emitted);
        continue;
      }

      const rosterOwner = state.roster[state.cursor]!;
      const passive = maxPassiveOwnersPerSlice !== undefined && rosterOwner.control === "NO_ELIGIBLE_CONTROL";
      if (passive ? passiveOwners >= maxPassiveOwnersPerSlice! : processedOwners >= maxOwnersPerSlice) {
        return this.#result("INCOMPLETE", emitted);
      }
      if (rosterOwner.control === "NO_ELIGIBLE_CONTROL") {
        this.#emit({ kind: "OWNER_COMPLETE", collectorGeneration: this.#generation, period,
          ownerMatchId: rosterOwner.ownerMatchId, safeControlOutcome: "NO_ELIGIBLE_CONTROL",
          restored: true }, emitted);
      } else {
        let result: SabaCollectorOwnerCaptureResult;
        try {
          result = await this.#adapter.captureOwner(period, rosterOwner);
        } catch (error) {
          const resumable = resumableOwnerCaptureError(error) ?
            { kind: "OWNER_CAPTURE" as const, period, ownerMatchId: rosterOwner.ownerMatchId } : null;
          return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted, resumable);
        }
        if (!sameBinding(result.binding, this.#binding)) {
          return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
        }
        const structuralKind = result.safeControlOutcome === "ALTERNATE_ROWS_ADDED" ||
          result.safeControlOutcome === "OWNER_GROUPS_EXPANDED" ? result.safeControlOutcome : null;
        const captureValid = result.capture !== undefined &&
          result.capture.record.matchId === rosterOwner.ownerMatchId &&
          validWallClock(result.capture.capturedAtMs) &&
          validMonotonicClock(result.capture.capturedMonotonicMs) &&
          result.capture.capturedMonotonicMs >= this.#lastCapturedMonotonicMs;
        if (result.period !== period || result.ownerMatchId !== rosterOwner.ownerMatchId ||
          result.controlOpened !== true || result.terminalControlState !== "RESTORED_CLOSED" ||
          result.restored !== true || (structuralKind !== null) !== captureValid) {
          return this.#freeze("SAFE_ERROR", "OWNER_CAPTURE_UNSAFE", emitted);
        }
        if (structuralKind !== null && result.capture) {
          this.#emit(this.#capture(period, rosterOwner.ownerMatchId, structuralKind,
            result.capture), emitted);
        }
        this.#emit({ kind: "OWNER_COMPLETE", collectorGeneration: this.#generation, period,
          ownerMatchId: rosterOwner.ownerMatchId, safeControlOutcome: result.safeControlOutcome,
          restored: true }, emitted);
      }
      state.cursor += 1;
      if (passive) passiveOwners += 1;
      else processedOwners += 1;
    }

    if (!continuationAllowed(shouldContinue)) return this.#result("INCOMPLETE", emitted);
    return this.#finish(emitted);
  }

  async #advanceScheduled(limit: number, shouldContinue?: () => boolean): Promise<SabaCollectorAdvanceResult> {
    const emitted: SabaCollectorDomItem[] = [];
    const captures: SabaCollectorCaptureItem[] = [];
    const visits: { period: SabaCollectorPeriod; ownerMatchId: string }[] = [];
    const complete: SabaCollectorOwnerCompleteItem[] = [];
    const eligible = PERIODS.flatMap(period => (this.#periods[period].roster ?? [])
      .filter(owner => owner.control === "ELIGIBLE_MORE")
      .map(owner => ({ period, owner })));
    const due = ({ period, owner }: typeof eligible[number]) => this.#schedule.shouldCaptureOwner!(
      period, owner, this.#lastVisits.get(`${period}:${owner.ownerMatchId}`) ?? null);
    let candidates: typeof eligible;
    try {
      candidates = eligible.filter(due);
      const order = this.#schedule.sortOwners?.(candidates.map(({ owner }) => owner.ownerMatchId));
      if (order) {
        const ranks = new Map(order.map((id, index) => [id, index]));
        candidates.sort((a, b) => (ranks.get(a.owner.ownerMatchId) ?? Infinity) -
          (ranks.get(b.owner.ownerMatchId) ?? Infinity));
      }
    } catch { return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted); }
    for (const candidate of candidates.slice(0, limit)) {
      if (!continuationAllowed(shouldContinue)) break;
      const { period, owner } = candidate;
      this.#scheduledPeriod = period;
      let result: SabaCollectorOwnerCaptureResult;
      try {
        if (!due(candidate)) continue;
        result = await this.#adapter.captureOwner(period, owner);
      } catch { return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted); }
      if (!sameBinding(result.binding, this.#binding)) return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
      const structural = result.safeControlOutcome === "ALTERNATE_ROWS_ADDED" ||
        result.safeControlOutcome === "OWNER_GROUPS_EXPANDED";
      const capture = result.capture;
      const validCapture = capture !== undefined && capture.record.matchId === owner.ownerMatchId &&
        validWallClock(capture.capturedAtMs) && validMonotonicClock(capture.capturedMonotonicMs) &&
        capture.capturedMonotonicMs >= this.#lastCapturedMonotonicMs && validKickoffDate(capture.kickoffDate);
      if (result.period !== period || result.ownerMatchId !== owner.ownerMatchId ||
        !result.controlOpened || result.terminalControlState !== "RESTORED_CLOSED" || !result.restored ||
        structural !== validCapture || (!structural && result.safeControlOutcome !== "NO_STRUCTURAL_CHANGE")) {
        return this.#freeze("SAFE_ERROR", "OWNER_CAPTURE_UNSAFE", emitted);
      }
      visits.push({ period, ownerMatchId: owner.ownerMatchId });
      // This is an actual successful page read, never a synthetic quote timestamp.
      // Older adapters lack a clock for empty structural reads, so do not fabricate one.
      const receipt = capture?.capturedAtMs ?? result.observedAtMs;
      if (receipt === undefined || !validWallClock(receipt)) {
        return this.#freeze("SAFE_ERROR", "OWNER_CAPTURE_UNSAFE", emitted);
      }
      if (receipt !== undefined && validWallClock(receipt)) {
        this.#lastVisits.set(`${period}:${owner.ownerMatchId}`, receipt);
        this.#schedule.onCaptured?.(period, owner, receipt);
      }
      complete.push({ kind: "OWNER_COMPLETE", collectorGeneration: this.#generation, period,
        ownerMatchId: owner.ownerMatchId, safeControlOutcome: result.safeControlOutcome, restored: true });
      if (structural && capture) {
        const item = this.#capture(period, owner.ownerMatchId,
          result.safeControlOutcome as "ALTERNATE_ROWS_ADDED" | "OWNER_GROUPS_EXPANDED", capture);
        captures.push(item); emitted.push(item);
      }
    }
    this.#scheduledPeriod = null;
    // A partial proof lists only actual visits, never deferred owners. Its unique
    // transport generation cannot replace authoritative main roster membership.
    const scheduledItems: (SabaCollectorDomItem | SabaScheduledOwnerTerminalItem)[] = [];
    if (visits.length > 0) {
      const generation = `${this.#generation}:scheduled:${++this.#scheduledSequence}`;
      const keys = new Set(visits.map(visit => `${visit.period}:${visit.ownerMatchId}`));
      const rosters = this.#candidateItems.filter((item): item is SabaCollectorCaptureItem =>
        item.kind === "CAPTURE" && item.captureKind === "ROSTER" && keys.has(`${item.period}:${item.ownerMatchId}`));
      const ordered = [...rosters, ...captures].sort((a, b) => a.capturedMonotonicMs - b.capturedMonotonicMs ||
        a.captureOrdinal - b.captureOrdinal);
      scheduledItems.push(...ordered.map((item, captureOrdinal) => ({ ...item,
        collectorGeneration: generation, captureOrdinal })),
        ...complete.map(item => ({ ...item, collectorGeneration: generation })),
        { kind: "SCHEDULED_OWNER_TERMINAL", collectorGeneration: generation,
          mainRosterGeneration: this.#mainRosterItems!.at(-1)!.collectorGeneration, owners: visits,
          hiddenMarketsComplete: false });
    }
    // Retain only initial roster proof: repeated visits cannot grow candidate memory.
    return { ...this.#result("INCOMPLETE", emitted), scheduledCaptureItems: captures,
      scheduledVisits: visits, scheduledItems };
  }

  async #advanceMainRoster(emitted: SabaCollectorDomItem[],
    shouldContinue?: () => boolean): Promise<SabaCollectorAdvanceResult> {
    // Roster proof is independent of More expansion. Bound public reads per slice,
    // retain their acquisition clocks, and require a no-growth reconciliation.
    let reads = 0;
    while (this.#mainPeriodIndex < PERIODS.length) {
      if (!continuationAllowed(shouldContinue) || reads >= 4) return this.#result("INCOMPLETE", emitted);
      const period = PERIODS[this.#mainPeriodIndex]!;
      const state = this.#periods[period];
      const initial = state.roster === null;
      let result: SabaCollectorRosterResult;
      try {
        result = await this.#adapter.readRoster(period);
        reads += 1;
      } catch (error) {
        return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted, resumableRosterReadError(error)
          ? { kind: "ROSTER_READ", period, stage: initial ? "INITIAL" : "RECONCILIATION" } : null);
      }
      if (!sameBinding(result.binding, this.#binding)) {
        return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
      }
      const ids = result.owners.map(({ ownerMatchId }) => ownerMatchId);
      if (result.period !== period || result.selectedPrematch !== true ||
        new Set(ids).size !== ids.length || !result.owners.every(validRosterOwner) ||
        !validMonotonicSequence(result.owners, this.#lastCapturedMonotonicMs) ||
        !result.owners.every(({ kickoffDate, record }) => validKickoffDate(kickoffDate) &&
          typeof record.providerTimezoneOffsetMinutes === "number" &&
          Number.isInteger(record.providerTimezoneOffsetMinutes) &&
          Math.abs(record.providerTimezoneOffsetMinutes) <= 840)) {
        return this.#freeze("SAFE_ERROR", "ROSTER_UNCONFIRMED", emitted);
      }
      const currentOwners = new Map(result.owners.map((owner) => [owner.ownerMatchId, owner]));
      if (state.roster?.some((owner) => {
        const current = currentOwners.get(owner.ownerMatchId);
        return current === undefined || stableOwnerIdentity(current) !== stableOwnerIdentity(owner);
      })) return this.#freeze("SAFE_ERROR", "ROSTER_UNCONFIRMED", emitted);
      const knownIds = new Set(state.roster?.map(({ ownerMatchId }) => ownerMatchId) ?? []);
      const additions = result.owners.filter(({ ownerMatchId }) => !knownIds.has(ownerMatchId));
      state.roster = [...(state.roster ?? []), ...additions];
      for (const addition of additions) {
        this.#emit(this.#capture(period, addition.ownerMatchId, "ROSTER", addition), emitted);
      }
      if (!initial && additions.length === 0) this.#mainPeriodIndex += 1;
    }
    if (!continuationAllowed(shouldContinue)) return this.#result("INCOMPLETE", emitted);
    let restoration: SabaCollectorTodayRestoreResult;
    try { restoration = await this.#adapter.restoreToday(); }
    catch { return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted); }
    if (!sameBinding(restoration.binding, this.#binding)) {
      return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
    }
    const todayIds = this.#periods.TODAY.roster!.map(({ ownerMatchId }) => ownerMatchId);
    const earlyIds = this.#periods.EARLY.roster!.map(({ ownerMatchId }) => ownerMatchId);
    if (restoration.selectedPrematch !== true || !sameRosterMembership(restoration.rosterMatchIds, todayIds)) {
      return this.#freeze("SAFE_ERROR", "TODAY_RESTORE_UNCONFIRMED", emitted);
    }
    const collectorGeneration = `${this.#generation}:main${this.#mainSequence === 0 ? "" : `:${this.#mainSequence}`}`;
    this.#mainRosterItems = [
      ...this.#candidateItems.filter((item): item is SabaCollectorCaptureItem =>
        item.kind === "CAPTURE" && item.captureKind === "ROSTER")
        .map((item) => ({ ...item, collectorGeneration })),
      { kind: "MAIN_ROSTER_TERMINAL", collectorGeneration,
        periods: [{ period: "TODAY", rosterMatchIds: todayIds, rosterCount: todayIds.length },
          { period: "EARLY", rosterMatchIds: earlyIds, rosterCount: earlyIds.length }],
        owners: [...todayIds.map((ownerMatchId) => ({ period: "TODAY" as const, ownerMatchId })),
          ...earlyIds.map((ownerMatchId) => ({ period: "EARLY" as const, ownerMatchId }))],
        todayRestoration: { selected: true, rosterMatchIds: todayIds, rosterCount: todayIds.length },
        hiddenMarketsComplete: false }
    ];
    this.#nextMainRefreshAtMs = this.#now() + 30_000;
    const active = new Set(PERIODS.flatMap(period => (this.#periods[period].roster ?? [])
      .map(owner => `${period}:${owner.ownerMatchId}`)));
    for (const key of this.#lastVisits.keys()) if (!active.has(key)) this.#lastVisits.delete(key);
    return { ...this.#result("INCOMPLETE", emitted), mainRosterChanged: true };
  }

  #capture(period: SabaCollectorPeriod, ownerMatchId: string,
    captureKind: SabaCollectorCaptureItem["captureKind"], source: SabaCollectorReadClock & {
      readonly record: SabaCollectorRecord; readonly kickoffDate: SabaCollectorKickoffDate
  }): SabaCollectorCaptureItem {
    this.#lastCapturedMonotonicMs = source.capturedMonotonicMs;
    return { kind: "CAPTURE", collectorGeneration: this.#generation, period, ownerMatchId,
      captureKind, kickoffDate: source.kickoffDate, capturedAtMs: source.capturedAtMs,
      capturedMonotonicMs: source.capturedMonotonicMs, captureOrdinal: this.#captureOrdinal++,
      record: source.record };
  }

  #completePeriod(period: SabaCollectorPeriod, state: PeriodState,
    emitted: SabaCollectorDomItem[]): void {
    if (!state.complete && state.roster !== null) {
      const rosterMatchIds = state.roster.map(({ ownerMatchId }) => ownerMatchId);
      this.#emit({ kind: "PERIOD_COMPLETE", collectorGeneration: this.#generation, period,
        rosterMatchIds, rosterCount: rosterMatchIds.length }, emitted);
      state.complete = true;
    }
    this.#periodIndex += 1;
  }

  async #finish(emitted: SabaCollectorDomItem[]): Promise<SabaCollectorAdvanceResult> {
    let restoration: SabaCollectorTodayRestoreResult;
    try {
      restoration = await this.#adapter.restoreToday();
    } catch {
      return this.#freeze("SAFE_ERROR", "ADAPTER_ERROR", emitted);
    }
    if (!sameBinding(restoration.binding, this.#binding)) {
      return this.#freeze("STALE_BINDING", "BINDING_CHANGED", emitted);
    }
    const todayIds = this.#periods.TODAY.roster!.map(({ ownerMatchId }) => ownerMatchId);
    if (restoration.selectedPrematch !== true ||
      !sameRosterMembership(restoration.rosterMatchIds, todayIds)) {
      return this.#freeze("SAFE_ERROR", "TODAY_RESTORE_UNCONFIRMED", emitted);
    }
    const earlyIds = this.#periods.EARLY.roster!.map(({ ownerMatchId }) => ownerMatchId);
    const terminal: SabaCollectorTerminalItem = { kind: "TERMINAL",
      collectorGeneration: this.#generation,
      periods: [
        { period: "TODAY", rosterMatchIds: todayIds, rosterCount: todayIds.length },
        { period: "EARLY", rosterMatchIds: earlyIds, rosterCount: earlyIds.length }
      ],
      owners: [...todayIds.map((ownerMatchId) => ({ period: "TODAY" as const, ownerMatchId })),
        ...earlyIds.map((ownerMatchId) => ({ period: "EARLY" as const, ownerMatchId }))],
      todayRestoration: { selected: true, rosterMatchIds: todayIds, rosterCount: todayIds.length },
      unresolvedOwners: [], failedOwners: [] };
    this.#emit(terminal, emitted);
    this.#terminalEmitted = true;
    return this.#result("COMPLETE", emitted);
  }

  #emit(item: SabaCollectorDomItem, emitted: SabaCollectorDomItem[]): void {
    this.#candidateItems.push(item);
    emitted.push(item);
  }

  #freeze(status: "SAFE_ERROR" | "STALE_BINDING", error: SabaCollectorAdvanceError,
    emitted: SabaCollectorDomItem[], resumableOperation: ResumableOperation | null = null):
    SabaCollectorAdvanceResult {
    this.#resumableOperation = resumableOperation;
    this.#frozen = { status, error };
    return this.#result(status, emitted, error);
  }

  #result(status: SabaCollectorAdvanceResult["status"], items: readonly SabaCollectorDomItem[],
    error?: SabaCollectorAdvanceError): SabaCollectorAdvanceResult {
    return { status, items: [...items], candidateItems: [...this.#candidateItems],
      ...(this.#mainRosterItems === undefined ? {} : { mainRosterItems: [...this.#mainRosterItems] }),
      ...(error === undefined ? {} : { error }) };
  }
}
