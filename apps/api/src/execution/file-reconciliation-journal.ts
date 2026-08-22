import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PreflightTicket } from "@tool-chenh/contracts";
import { z } from "zod";
import type { LiveTwoLegResult } from "./live-two-leg-coordinator.js";
import type { ReconciliationResult } from "./receipt-reconciler.js";

const providerSchema = z.enum(["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"]);
const reasonSchema = z.enum(["RECEIPT_READER_UNAVAILABLE", "RECEIPT_NOT_FOUND", "RECEIPT_PENDING",
  "RECEIPT_IDENTITY_MISMATCH", "RECEIPT_STATUS_MISMATCH", "RECEIPT_READER_ERROR",
  "RECEIPT_READER_TIMEOUT", "EXECUTION_TICKET_MISMATCH", "EXECUTION_LEG_IDENTITY_MISMATCH",
  "RECONCILIATION_PERSISTENCE_FAILED"]);
const recordedObservationSchema = z.strictObject({ provider: providerSchema,
  providerSelectionId: z.string().min(1).max(512), status: z.enum(["ACCEPTED", "REJECTED", "PENDING"]),
  receiptId: z.string().min(1).max(512).nullable() });
const recordSchema = z.strictObject({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  ticketId: z.string().min(1).max(256), status: z.enum(["VERIFIED", "CONFLICT"]),
  executionStatus: z.enum(["NOT_SUBMITTED", "BOTH_ACCEPTED", "NONE_ACCEPTED", "PARTIAL_FAILURE"]),
  reasons: z.array(reasonSchema), observations: z.array(recordedObservationSchema).max(2),
  recordedAtMs: z.number().finite().nonnegative() });

export type ReconciliationRecord = z.infer<typeof recordSchema>;
export type ReconciliationJournalRead = { readonly status: "RECORDED"; readonly record: ReconciliationRecord } |
  { readonly status: "NOT_FOUND" } | { readonly status: "CONFLICT" };

function fingerprint(ticket: PreflightTicket, execution: LiveTwoLegResult): string {
  return createHash("sha256").update(JSON.stringify([ticket.ticketId, ticket.signature, ticket.nonce, ticket.legs,
    execution])).digest("hex");
}

function assertVerifiedEvidence(ticket: PreflightTicket, execution: LiveTwoLegResult,
  reconciliation: ReconciliationResult): void {
  if (reconciliation.status !== "VERIFIED") return;
  if (execution.status === "NOT_SUBMITTED") {
    if (reconciliation.observations.length !== 0) throw new Error("LIVE_RECONCILIATION_RESULT_INVALID");
    return;
  }
  if (reconciliation.observations.length !== 2 || reconciliation.observations.some((observed, index) => {
    const leg = ticket.legs[index]; const reported = execution.legs[index];
    if (leg === undefined || reported === undefined || observed.provider !== leg.provider ||
      observed.providerSelectionId !== leg.providerSelectionId || observed.status === "PENDING") return true;
    if (reported.status === "ACCEPTED") {
      return observed.status !== "ACCEPTED" || observed.receiptId !== reported.receiptId;
    }
    if (reported.status === "REJECTED") return observed.status !== "REJECTED" || observed.receiptId !== null;
    return false;
  })) throw new Error("LIVE_RECONCILIATION_RESULT_INVALID");
}

function semantic(record: ReconciliationRecord): string {
  return JSON.stringify({ fingerprint: record.fingerprint, ticketId: record.ticketId, status: record.status,
    executionStatus: record.executionStatus, reasons: record.reasons, observations: record.observations });
}

export class FileReconciliationJournal {
  readonly #directory: string;
  constructor(directory: string) {
    if (directory.trim().length === 0) throw new Error("LIVE_RECONCILIATION_DIRECTORY_INVALID");
    this.#directory = directory;
  }

  async record(ticket: PreflightTicket, execution: LiveTwoLegResult, reconciliation: ReconciliationResult,
    recordedAtMs: number): Promise<ReconciliationRecord> {
    if (reconciliation.status === "IN_DOUBT") throw new Error("LIVE_RECONCILIATION_NOT_TERMINAL");
    if (execution.ticketId !== ticket.ticketId || reconciliation.executionStatus !== execution.status ||
      !Number.isFinite(recordedAtMs) || recordedAtMs < 0) throw new Error("LIVE_RECONCILIATION_RESULT_INVALID");
    assertVerifiedEvidence(ticket, execution, reconciliation);
    const value = recordSchema.parse({ fingerprint: fingerprint(ticket, execution), ticketId: ticket.ticketId,
      status: reconciliation.status, executionStatus: reconciliation.executionStatus, reasons: reconciliation.reasons,
      observations: reconciliation.observations.map((item) => ({ provider: item.provider,
        providerSelectionId: item.providerSelectionId, status: item.status, receiptId: item.receiptId })), recordedAtMs });
    await mkdir(this.#directory, { recursive: true });
    try {
      await writeFile(this.#path(ticket.ticketId), JSON.stringify(value), { encoding: "utf8", flag: "wx" });
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await this.#parse(this.#path(ticket.ticketId));
      if (semantic(current) !== semantic(value)) throw new Error("LIVE_RECONCILIATION_CONFLICT");
      return current;
    }
  }

  async read(ticket: PreflightTicket, execution: LiveTwoLegResult): Promise<ReconciliationJournalRead> {
    try {
      const record = await this.#parse(this.#path(ticket.ticketId));
      return record.fingerprint === fingerprint(ticket, execution) ? { status: "RECORDED", record } :
        { status: "CONFLICT" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "NOT_FOUND" };
      throw error;
    }
  }

  async #parse(path: string): Promise<ReconciliationRecord> {
    try {
      const result = recordSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
      if (!result.success) throw new Error("LIVE_RECONCILIATION_INVALID");
      return result.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      if (error instanceof Error && error.message === "LIVE_RECONCILIATION_INVALID") throw error;
      throw new Error("LIVE_RECONCILIATION_INVALID");
    }
  }

  #path(ticketId: string): string {
    return join(this.#directory, `${createHash("sha256").update(ticketId).digest("hex")}.reconciliation.json`);
  }
}
