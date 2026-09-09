import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { CmdSnapshotChunkSchema } from "@tool-chenh/contracts";
import { z } from "zod";
import { CmdSnapshotAssembler, type CmdSnapshotAssemblerOptions } from "./cmd-snapshot-assembler.js";

const generationId = z.string().trim().min(1).max(128).regex(/^[a-z0-9._:-]+$/iu);
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const safeOrdinal = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const monotonicClock = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const isSafeIntegerClock = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const isValidMonotonicClock = (value: number): boolean => Number.isFinite(value) && value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;

const validIsoDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

const oddSchema = z.strictObject({
  marketOddsId: text(128),
  priceText: text(32),
  status: nullableText(32),
  greyedOut: nullableText(16),
  lineText: nullableText(32).optional()
});
const groupSchema = z.strictObject({
  betTypeIds: z.array(text(80)).max(8),
  labels: z.array(z.string().trim().max(80)).max(64),
  // Public inventory may include score grids. Accept their bounded evidence;
  // canonical binary eligibility is still decided by the existing normalizer.
  odds: z.array(oddSchema).min(1).max(128)
});
const recordSchema = z.strictObject({
  sportId: z.literal("1"),
  leagueId: z.string().trim().max(128),
  leagueName: text(160),
  matchId: text(128),
  timeText: z.string().trim().max(80),
  providerTimezoneOffsetMinutes: z.number().int().min(-840).max(840).nullable().optional(),
  teamNames: z.array(text(160)).min(2).max(4),
  groups: z.array(groupSchema).max(128)
});
const periodSchema = z.enum(["TODAY", "EARLY"]);
const ownerReferenceSchema = z.strictObject({ period: periodSchema, ownerMatchId: text(128) });
const periodManifestSchema = z.strictObject({
  period: periodSchema,
  rosterMatchIds: z.array(text(128)),
  rosterCount: safeOrdinal
});
const kickoffDateSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("EXPLICIT"),
    isoDate: z.string().refine(validIsoDate, "invalid ISO calendar date") }),
  z.strictObject({ kind: z.literal("UNKNOWN") })
]);

export const SabaCollectorCaptureItemSchema = z.strictObject({
  kind: z.literal("CAPTURE"),
  collectorGeneration: generationId,
  period: periodSchema,
  ownerMatchId: text(128),
  captureKind: z.enum(["ROSTER", "ALTERNATE_ROWS_ADDED", "OWNER_GROUPS_EXPANDED"]),
  kickoffDate: kickoffDateSchema,
  capturedAtMs: safeOrdinal,
  capturedMonotonicMs: monotonicClock,
  captureOrdinal: safeOrdinal,
  record: recordSchema
});
export const SabaCollectorOwnerCompleteItemSchema = z.strictObject({
  kind: z.literal("OWNER_COMPLETE"),
  collectorGeneration: generationId,
  period: periodSchema,
  ownerMatchId: text(128),
  safeControlOutcome: z.enum(["NO_ELIGIBLE_CONTROL", "NO_STRUCTURAL_CHANGE",
    "ALTERNATE_ROWS_ADDED", "OWNER_GROUPS_EXPANDED"]),
  restored: z.boolean()
});
export const SabaCollectorPeriodCompleteItemSchema = z.strictObject({
  kind: z.literal("PERIOD_COMPLETE"),
  collectorGeneration: generationId,
  period: periodSchema,
  rosterMatchIds: z.array(text(128)),
  rosterCount: safeOrdinal
});
export const SabaCollectorTerminalItemSchema = z.strictObject({
  kind: z.literal("TERMINAL"),
  collectorGeneration: generationId,
  periods: z.tuple([
    periodManifestSchema.extend({ period: z.literal("TODAY") }),
    periodManifestSchema.extend({ period: z.literal("EARLY") })
  ]),
  owners: z.array(ownerReferenceSchema),
  todayRestoration: z.strictObject({
    selected: z.boolean(),
    rosterMatchIds: z.array(text(128)),
    rosterCount: safeOrdinal
  }),
  unresolvedOwners: z.array(ownerReferenceSchema),
  failedOwners: z.array(ownerReferenceSchema)
});
export const SabaMainRosterTerminalItemSchema = SabaCollectorTerminalItemSchema
  .omit({ unresolvedOwners: true, failedOwners: true }).extend({
    kind: z.literal("MAIN_ROSTER_TERMINAL"),
    hiddenMarketsComplete: z.literal(false)
  });
export const SabaCollectorDomItemSchema = z.discriminatedUnion("kind", [
  SabaCollectorCaptureItemSchema,
  SabaCollectorOwnerCompleteItemSchema,
  SabaCollectorPeriodCompleteItemSchema,
  SabaCollectorTerminalItemSchema,
  SabaMainRosterTerminalItemSchema
]);

export type SabaCollectorPeriod = z.infer<typeof periodSchema>;
export type SabaCollectorKickoffDate = z.infer<typeof kickoffDateSchema>;
export type SabaCollectorCaptureItem = z.infer<typeof SabaCollectorCaptureItemSchema> & {
  readonly record: CmdCatalogInputRecord;
};
export type SabaCollectorOwnerCompleteItem = z.infer<typeof SabaCollectorOwnerCompleteItemSchema>;
export type SabaCollectorPeriodCompleteItem = z.infer<typeof SabaCollectorPeriodCompleteItemSchema>;
export type SabaCollectorTerminalItem = z.infer<typeof SabaCollectorTerminalItemSchema>;
export type SabaMainRosterTerminalItem = z.infer<typeof SabaMainRosterTerminalItemSchema>;
export type SabaCollectorDomItem = SabaCollectorCaptureItem | SabaCollectorOwnerCompleteItem |
  SabaCollectorPeriodCompleteItem | SabaCollectorTerminalItem | SabaMainRosterTerminalItem;

interface ValidatedSabaCollectorBinding {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly collectorGeneration: string;
  readonly sweepFrameKey: string;
  readonly sweepDocumentKey: string;
  readonly captures: readonly SabaCollectorCaptureItem[];
}

export type ValidatedSabaCollectorCandidate = ValidatedSabaCollectorBinding & ({
  readonly coverage: "HIDDEN_COMPLETE";
  readonly hiddenMarketsComplete: true;
  readonly owners: readonly SabaCollectorOwnerCompleteItem[];
  readonly periods: readonly SabaCollectorPeriodCompleteItem[];
  readonly terminal: SabaCollectorTerminalItem;
} | {
  readonly coverage: "MAIN_ROSTER";
  readonly hiddenMarketsComplete: false;
  readonly owners: readonly [];
  readonly periods: readonly z.infer<typeof periodManifestSchema>[];
  readonly terminal: SabaMainRosterTerminalItem;
});

export interface SabaCollectorChunkInput {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly rawChunk: unknown;
  /** Same source capture/performance clock domain as every capturedMonotonicMs in this chunk generation. */
  readonly receivedMonotonicMs: number;
  /** Trusted wall-clock upper bound for capturedAtMs. */
  readonly generationObservedAtMs: number;
}

const ownerKey = (period: SabaCollectorPeriod, matchId: string) => `${period}\u0000${matchId}`;
const sameStringSet = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && new Set(left).size === left.length &&
  new Set(right).size === right.length && left.every((value) => right.includes(value));
const validCountedRoster = (value: { readonly rosterMatchIds: readonly string[];
  readonly rosterCount: number }): boolean => value.rosterCount === value.rosterMatchIds.length &&
    new Set(value.rosterMatchIds).size === value.rosterMatchIds.length;

function addExact<T>(target: Map<string, { readonly fingerprint: string; readonly value: T }>,
  key: string, value: T): boolean {
  const fingerprint = JSON.stringify(value);
  const existing = target.get(key);
  if (existing) return existing.fingerprint === fingerprint;
  target.set(key, { fingerprint, value });
  return true;
}

function validateCandidate(items: readonly unknown[], binding: {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly collectorGeneration: string;
  readonly sweepFrameKey: string;
  readonly sweepDocumentKey: string;
}, clocks: {
  readonly receivedMonotonicMs: number;
  readonly generationObservedAtMs: number;
}): ValidatedSabaCollectorCandidate | null {
  const captures = new Map<string, { readonly fingerprint: string;
    readonly value: SabaCollectorCaptureItem }>();
  const capturesByOrdinal = new Map<number, string>();
  const owners = new Map<string, { readonly fingerprint: string;
    readonly value: SabaCollectorOwnerCompleteItem }>();
  const periods = new Map<SabaCollectorPeriod, { readonly fingerprint: string;
    readonly value: SabaCollectorPeriodCompleteItem }>();
  let terminalEntry: { readonly fingerprint: string;
    readonly value: SabaCollectorTerminalItem | SabaMainRosterTerminalItem } | undefined;
  let priorCaptureOrdinal = -1;
  let priorCaptureMonotonicMs = -1;

  for (const candidate of items) {
    const parsed = SabaCollectorDomItemSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.collectorGeneration !== binding.collectorGeneration) return null;
    const item = parsed.data as SabaCollectorDomItem;
    if (item.kind === "CAPTURE") {
      if (item.record.matchId !== item.ownerMatchId || item.captureOrdinal <= priorCaptureOrdinal ||
        item.capturedMonotonicMs < priorCaptureMonotonicMs ||
        item.capturedMonotonicMs > clocks.receivedMonotonicMs ||
        item.capturedAtMs > clocks.generationObservedAtMs) return null;
      priorCaptureOrdinal = item.captureOrdinal;
      priorCaptureMonotonicMs = item.capturedMonotonicMs;
      const fingerprint = JSON.stringify(item);
      const ordinalFingerprint = capturesByOrdinal.get(item.captureOrdinal);
      if (ordinalFingerprint !== undefined && ordinalFingerprint !== fingerprint) return null;
      capturesByOrdinal.set(item.captureOrdinal, fingerprint);
      if (!addExact(captures, `${ownerKey(item.period, item.ownerMatchId)}\u0000${item.captureKind}`,
        item as SabaCollectorCaptureItem)) return null;
      continue;
    }
    if (item.kind === "OWNER_COMPLETE") {
      if (!addExact(owners, ownerKey(item.period, item.ownerMatchId), item)) return null;
      continue;
    }
    if (item.kind === "PERIOD_COMPLETE") {
      if (!validCountedRoster(item) || !addExact(periods, item.period, item)) return null;
      continue;
    }
    const fingerprint = JSON.stringify(item);
    if (terminalEntry && terminalEntry.fingerprint !== fingerprint) return null;
    terminalEntry = { fingerprint, value: item };
  }

  const today = periods.get("TODAY")?.value;
  const early = periods.get("EARLY")?.value;
  const terminal = terminalEntry?.value;
  if (terminal?.kind === "MAIN_ROSTER_TERMINAL") {
    if (owners.size !== 0 || periods.size !== 0 || terminal.todayRestoration.selected !== true ||
      !terminal.periods.every(validCountedRoster) || !validCountedRoster(terminal.todayRestoration) ||
      !sameStringSet(terminal.todayRestoration.rosterMatchIds, terminal.periods[0].rosterMatchIds)) return null;
    const rosterKeys = terminal.periods.flatMap((period) =>
      period.rosterMatchIds.map((matchId) => ownerKey(period.period, matchId)));
    const manifestKeys = terminal.owners.map((owner) => ownerKey(owner.period, owner.ownerMatchId));
    const mainCaptures = [...captures.values()].map((entry) => entry.value);
    if (mainCaptures.some((capture) => capture.captureKind !== "ROSTER" ||
      capture.record.providerTimezoneOffsetMinutes === null ||
      capture.record.providerTimezoneOffsetMinutes === undefined) ||
      !sameStringSet(manifestKeys, rosterKeys) ||
      !sameStringSet(mainCaptures.map((capture) => ownerKey(capture.period, capture.ownerMatchId)), rosterKeys)) return null;
    return { ...binding, coverage: "MAIN_ROSTER", hiddenMarketsComplete: false,
      captures: mainCaptures, owners: [], periods: terminal.periods, terminal };
  }
  if (!today || !early || !terminal || terminal.todayRestoration.selected !== true ||
    terminal.unresolvedOwners.length !== 0 || terminal.failedOwners.length !== 0) return null;
  if (!validCountedRoster(terminal.periods[0]) || !validCountedRoster(terminal.periods[1]) ||
    !validCountedRoster(terminal.todayRestoration) ||
    !sameStringSet(terminal.periods[0].rosterMatchIds, today.rosterMatchIds) ||
    !sameStringSet(terminal.periods[1].rosterMatchIds, early.rosterMatchIds) ||
    !sameStringSet(terminal.todayRestoration.rosterMatchIds, today.rosterMatchIds)) return null;

  const rosterKeys = new Set([
    ...today.rosterMatchIds.map((matchId) => ownerKey("TODAY", matchId)),
    ...early.rosterMatchIds.map((matchId) => ownerKey("EARLY", matchId))
  ]);
  const terminalOwnerKeys = terminal.owners.map((entry) => ownerKey(entry.period, entry.ownerMatchId));
  if (new Set(terminalOwnerKeys).size !== terminalOwnerKeys.length ||
    !sameStringSet(terminalOwnerKeys, [...rosterKeys]) ||
    !sameStringSet([...owners.keys()], [...rosterKeys])) return null;

  for (const [key, entry] of owners) {
    if (entry.value.restored !== true ||
      !captures.has(`${key}\u0000ROSTER`)) return null;
    const structuralKind = entry.value.safeControlOutcome === "ALTERNATE_ROWS_ADDED" ||
      entry.value.safeControlOutcome === "OWNER_GROUPS_EXPANDED" ?
      entry.value.safeControlOutcome : null;
    if (structuralKind !== null && !captures.has(`${key}\u0000${structuralKind}`)) return null;
  }
  for (const entry of captures.values()) {
    const key = ownerKey(entry.value.period, entry.value.ownerMatchId);
    if (!rosterKeys.has(key)) return null;
    if (entry.value.captureKind !== "ROSTER" &&
      owners.get(key)?.value.safeControlOutcome !== entry.value.captureKind) return null;
  }

  return {
    ...binding,
    coverage: "HIDDEN_COMPLETE", hiddenMarketsComplete: true,
    captures: [...captures.values()].map((entry) => entry.value),
    owners: [...owners.values()].map((entry) => entry.value),
    periods: [today, early],
    terminal
  };
}

export class SabaCollectorDomAssembler {
  readonly #assembler: CmdSnapshotAssembler;
  readonly #activeEpochBySource = new Map<string, string>();

  constructor(options: CmdSnapshotAssemblerOptions = {}) {
    this.#assembler = new CmdSnapshotAssembler(options);
  }

  activateSourceEpoch(sourceId: string, sourceEpoch: string): boolean {
    if (!/^chrome:SABA:[^\s]+$/u.test(sourceId) || !generationId.safeParse(sourceEpoch).success) return false;
    const currentEpoch = this.#activeEpochBySource.get(sourceId);
    if (currentEpoch === sourceEpoch) return true;
    if (currentEpoch !== undefined) this.#assembler.resetSource(`${sourceId}\u0000${currentEpoch}`);
    this.#activeEpochBySource.set(sourceId, sourceEpoch);
    return true;
  }

  ingest(input: SabaCollectorChunkInput): ValidatedSabaCollectorCandidate | null {
    if (!isValidMonotonicClock(input.receivedMonotonicMs) ||
      !isSafeIntegerClock(input.generationObservedAtMs) ||
      !/^chrome:SABA:[^\s]+$/u.test(input.sourceId) || !generationId.safeParse(input.sourceEpoch).success) {
      return null;
    }
    const parsed = CmdSnapshotChunkSchema.safeParse(input.rawChunk);
    if (!parsed.success || parsed.data.sweepId === undefined || parsed.data.sweepComplete !== true ||
      parsed.data.sweepFrameKey === undefined || parsed.data.sweepDocumentKey === undefined) return null;

    if (this.#activeEpochBySource.get(input.sourceId) !== input.sourceEpoch) return null;
    const assembled = this.#assembler.ingest(`${input.sourceId}\u0000${input.sourceEpoch}`, parsed.data,
      input.receivedMonotonicMs, input.generationObservedAtMs);
    if (assembled === null) return null;
    return validateCandidate(assembled, {
      sourceId: input.sourceId,
      sourceEpoch: input.sourceEpoch,
      collectorGeneration: parsed.data.sweepId,
      sweepFrameKey: parsed.data.sweepFrameKey,
      sweepDocumentKey: parsed.data.sweepDocumentKey
    }, { receivedMonotonicMs: input.receivedMonotonicMs,
      generationObservedAtMs: input.generationObservedAtMs });
  }

  resetSource(sourceId: string): void {
    const activeEpoch = this.#activeEpochBySource.get(sourceId);
    if (activeEpoch !== undefined) this.#assembler.resetSource(`${sourceId}\u0000${activeEpoch}`);
    this.#activeEpochBySource.delete(sourceId);
  }
}
