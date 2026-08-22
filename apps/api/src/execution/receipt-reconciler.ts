import type { PreflightLeg, PreflightTicket, ProviderId } from "@tool-chenh/contracts";
import { Decimal } from "@tool-chenh/core";
import type { LiveLegResult, LiveTwoLegResult } from "./live-two-leg-coordinator.js";

export interface ReceiptObservation {
  readonly provider: ProviderId;
  readonly accountId: string;
  readonly providerEventId: string;
  readonly providerMarketId: string;
  readonly providerSelectionId: string;
  readonly selection: string;
  readonly line: string | null;
  readonly decimalOdds: string;
  readonly stake: string;
  readonly currency: string;
  readonly status: "ACCEPTED" | "REJECTED" | "PENDING";
  readonly receiptId: string | null;
}

export interface ReceiptReader {
  readonly provider: ProviderId;
  lookup(input: { readonly ticketId: string; readonly leg: PreflightLeg;
    readonly reported: LiveLegResult }): Promise<ReceiptObservation | null>;
}

export type ReconciliationReason = "RECEIPT_READER_UNAVAILABLE" | "RECEIPT_NOT_FOUND" |
  "RECEIPT_PENDING" | "RECEIPT_IDENTITY_MISMATCH" | "RECEIPT_STATUS_MISMATCH" |
  "RECEIPT_READER_ERROR" | "RECEIPT_READER_TIMEOUT" | "EXECUTION_TICKET_MISMATCH" |
  "EXECUTION_LEG_IDENTITY_MISMATCH" | "RECONCILIATION_PERSISTENCE_FAILED";

export interface ReconciliationResult {
  readonly status: "VERIFIED" | "IN_DOUBT" | "CONFLICT";
  readonly executionStatus: LiveTwoLegResult["status"];
  readonly observations: readonly ReceiptObservation[];
  readonly reasons: readonly ReconciliationReason[];
}

export interface ReconciliationJournal {
  record(ticket: PreflightTicket, execution: LiveTwoLegResult, reconciliation: ReconciliationResult,
    recordedAtMs: number): Promise<unknown>;
}

const receiptReaderTimeout = Symbol("RECEIPT_READER_TIMEOUT");

async function lookupWithTimeout(reader: ReceiptReader, input: Parameters<ReceiptReader["lookup"]>[0],
  timeoutMs: number): Promise<ReceiptObservation | null | typeof receiptReaderTimeout> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<typeof receiptReaderTimeout>((resolve) => {
      timer = setTimeout(() => resolve(receiptReaderTimeout), timeoutMs); timer.unref?.();
    });
    return await Promise.race([reader.lookup(input), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function decimalEquals(first: string, second: string): boolean {
  try { return new Decimal(first).eq(new Decimal(second)); } catch { return false; }
}

function lineEquals(first: string | null, second: string | null): boolean {
  return first === null || second === null ? first === second : decimalEquals(first, second);
}

function identityMatches(expected: PreflightLeg, observed: ReceiptObservation): boolean {
  return observed.provider === expected.provider && observed.accountId === expected.accountId &&
    observed.providerEventId === expected.providerEventId && observed.providerMarketId === expected.providerMarketId &&
    observed.providerSelectionId === expected.providerSelectionId && observed.selection === expected.selection &&
    lineEquals(observed.line, expected.line) && observed.currency === expected.currency &&
    decimalEquals(observed.decimalOdds, expected.decimalOdds) && decimalEquals(observed.stake, expected.stake);
}

function reportedStatusMatches(reported: LiveLegResult, observed: ReceiptObservation): boolean {
  if (reported.status === "UNKNOWN") return observed.status !== "PENDING";
  if (reported.status !== observed.status) return false;
  return reported.status === "ACCEPTED" ? reported.receiptId === observed.receiptId : observed.receiptId === null;
}

export class ReceiptReconciler {
  readonly #readers: ReadonlyMap<ProviderId, ReceiptReader>;
  readonly #tripKillSwitch: (result: LiveTwoLegResult) => void;
  readonly #timeoutMs: number;
  readonly #journal: ReconciliationJournal | null;
  readonly #clock: { nowMs(): number };

  constructor(options: { readonly readers: readonly ReceiptReader[];
    readonly timeoutMs?: number;
    readonly journal?: ReconciliationJournal;
    readonly clock?: { nowMs(): number };
    readonly tripKillSwitch: (result: LiveTwoLegResult) => void }) {
    this.#readers = new Map(options.readers.map((reader) => [reader.provider, reader]));
    this.#timeoutMs = options.timeoutMs ?? 3_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) throw new Error("RECEIPT_TIMEOUT_INVALID");
    this.#journal = options.journal ?? null; this.#clock = options.clock ?? { nowMs: Date.now };
    this.#tripKillSwitch = options.tripKillSwitch;
  }

  async reconcile(input: { readonly ticket: PreflightTicket;
    readonly result: LiveTwoLegResult }): Promise<ReconciliationResult> {
    if (input.result.ticketId !== input.ticket.ticketId) {
      this.#tripKillSwitch(input.result);
      return { status: "CONFLICT", executionStatus: input.result.status, observations: [],
        reasons: ["EXECUTION_TICKET_MISMATCH"] };
    }
    if (input.result.status === "NOT_SUBMITTED") {
      return { status: "VERIFIED", executionStatus: "NOT_SUBMITTED", observations: [], reasons: [] };
    }
    if (input.result.legs.some((reported, index) => {
      const leg = input.ticket.legs[index];
      return leg === undefined || reported.provider !== leg.provider ||
        reported.providerSelectionId !== leg.providerSelectionId;
    })) {
      this.#tripKillSwitch(input.result);
      return { status: "CONFLICT", executionStatus: input.result.status, observations: [],
        reasons: ["EXECUTION_LEG_IDENTITY_MISMATCH"] };
    }

    const checks = await Promise.all(input.result.legs.map(async (reported, index) => {
      const leg = input.ticket.legs[index]!; const reader = this.#readers.get(leg.provider);
      if (reader === undefined) return { reason: "RECEIPT_READER_UNAVAILABLE" as const, observation: null };
      try {
        const observed = await lookupWithTimeout(reader, { ticketId: input.ticket.ticketId, leg, reported },
          this.#timeoutMs);
        if (observed === receiptReaderTimeout) {
          return { reason: "RECEIPT_READER_TIMEOUT" as const, observation: null };
        }
        if (observed === null) return { reason: "RECEIPT_NOT_FOUND" as const, observation: null };
        if (!identityMatches(leg, observed)) {
          return { reason: "RECEIPT_IDENTITY_MISMATCH" as const, observation: observed };
        }
        if (observed.status === "PENDING") return { reason: "RECEIPT_PENDING" as const, observation: observed };
        if (!reportedStatusMatches(reported, observed)) {
          return { reason: "RECEIPT_STATUS_MISMATCH" as const, observation: observed };
        }
        return { reason: null, observation: observed };
      } catch {
        return { reason: "RECEIPT_READER_ERROR" as const, observation: null };
      }
    }));
    const reasons = checks.flatMap((check) => check.reason === null ? [] : [check.reason]);
    const observations = checks.flatMap((check) => check.observation === null ? [] : [check.observation]);
    const conflict = reasons.some((reason) => reason === "RECEIPT_IDENTITY_MISMATCH" ||
      reason === "RECEIPT_STATUS_MISMATCH");
    const status = conflict ? "CONFLICT" as const : reasons.length > 0 ? "IN_DOUBT" as const : "VERIFIED" as const;
    const reconciliation: ReconciliationResult = { status, executionStatus: input.result.status,
      observations, reasons };
    if (status !== "IN_DOUBT" && this.#journal !== null) {
      try { await this.#journal.record(input.ticket, input.result, reconciliation, this.#clock.nowMs()); }
      catch {
        this.#tripKillSwitch(input.result);
        return { status: "IN_DOUBT", executionStatus: input.result.status, observations,
          reasons: ["RECONCILIATION_PERSISTENCE_FAILED"] };
      }
    }
    if (status !== "VERIFIED" || input.result.status === "PARTIAL_FAILURE") this.#tripKillSwitch(input.result);
    return reconciliation;
  }
}
