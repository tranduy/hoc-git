import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PreflightTicket, TwoLegExecutionResult } from "@tool-chenh/contracts";
import { z } from "zod";

const providerSchema = z.enum(["FABET", "CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]);
const storedLegSchema = z.strictObject({ provider: providerSchema, accountId: z.string().min(1).max(128),
  providerEventId: z.string().min(1).max(512), providerMarketId: z.string().min(1).max(512),
  providerSelectionId: z.string().min(1).max(512), selection: z.string().min(1).max(64),
  line: z.string().max(64).nullable(), decimalOdds: z.string().min(1).max(64), stake: z.string().min(1).max(64),
  currency: z.string().min(1).max(16) });
const preflightSchema = z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/u), stage: z.literal("PREFLIGHT_READY"),
  recordedAtMs: z.number().finite().nonnegative(), ticketId: z.string().min(1).max(256),
  opportunityId: z.string().min(1).max(512), canonicalEventId: z.string().min(1).max(512),
  canonicalMarketId: z.string().min(1).max(512), baseCurrency: z.string().min(1).max(16),
  totalStakeBase: z.string().min(1).max(64), worstCaseProfit: z.string().min(1).max(64),
  issuedAtMs: z.number().finite().nonnegative(), expiresAtMs: z.number().finite().nonnegative(),
  legs: z.tuple([storedLegSchema, storedLegSchema]) });
const executionLegSchema = z.strictObject({ provider: providerSchema, providerSelectionId: z.string().min(1).max(512),
  status: z.enum(["ACCEPTED", "REJECTED", "UNKNOWN"]), reason: z.string().min(1).max(128).nullable() });
const executionSchema = z.strictObject({ id: z.string().regex(/^[a-f0-9]{64}$/u), stage: z.literal("DRY_RUN_RESULT"),
  recordedAtMs: z.number().finite().nonnegative(), ticketId: z.string().min(1).max(256),
  idempotencyKey: z.string().min(1).max(256), status: z.enum(["BOTH_ACCEPTED", "NONE_ACCEPTED", "PARTIAL_FAILURE"]),
  legs: z.tuple([executionLegSchema, executionLegSchema]) });
const recordSchema = z.discriminatedUnion("stage", [preflightSchema, executionSchema]);

export type BetHistoryRecord = z.infer<typeof recordSchema>;
export interface BetHistoryList { readonly storageState: "READY" | "UNAVAILABLE"; readonly records: readonly BetHistoryRecord[] }

function recordId(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class FileBetHistory {
  readonly #path: string;
  readonly #clock: { nowMs(): number };
  #writes: Promise<void> = Promise.resolve();

  constructor(path: string, clock: { nowMs(): number } = { nowMs: Date.now }) {
    if (path.trim().length === 0) throw new Error("BET_HISTORY_PATH_INVALID");
    this.#path = path; this.#clock = clock;
  }

  async recordPreflight(ticket: PreflightTicket): Promise<void> {
    const value = preflightSchema.parse({ id: recordId(["PREFLIGHT_READY", ticket.ticketId]),
      stage: "PREFLIGHT_READY", recordedAtMs: this.#clock.nowMs(), ticketId: ticket.ticketId,
      opportunityId: ticket.opportunityId, canonicalEventId: ticket.canonicalEventId,
      canonicalMarketId: ticket.canonicalMarketId, baseCurrency: ticket.baseCurrency,
      totalStakeBase: ticket.totalStakeBase, worstCaseProfit: ticket.worstCaseProfit,
      issuedAtMs: ticket.issuedAtMs, expiresAtMs: ticket.expiresAtMs,
      legs: ticket.legs.map((leg) => ({ accountId: leg.accountId, provider: leg.provider,
        providerEventId: leg.providerEventId, providerMarketId: leg.providerMarketId,
        providerSelectionId: leg.providerSelectionId, selection: leg.selection, line: leg.line,
        decimalOdds: leg.decimalOdds, stake: leg.stake, currency: leg.currency })) });
    await this.#append(value);
  }

  async recordExecution(_ticket: PreflightTicket, result: TwoLegExecutionResult): Promise<void> {
    const value = executionSchema.parse({ id: recordId(["DRY_RUN_RESULT", result.ticketId, result.idempotencyKey]),
      stage: "DRY_RUN_RESULT", recordedAtMs: this.#clock.nowMs(), ticketId: result.ticketId,
      idempotencyKey: result.idempotencyKey, status: result.status,
      legs: result.legs.map((leg) => ({ provider: leg.provider, providerSelectionId: leg.providerSelectionId,
        status: leg.status, reason: "reason" in leg ? leg.reason : null })) });
    await this.#append(value);
  }

  async list(limit = 100): Promise<BetHistoryList> {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 500 ? limit : 100;
    await this.#writes.catch(() => undefined);
    try {
      const text = await readFile(this.#path, "utf8");
      const unique = new Map<string, BetHistoryRecord>();
      for (const line of text.split(/\r?\n/u).filter(Boolean)) {
        const parsed = recordSchema.safeParse(JSON.parse(line));
        if (!parsed.success) continue;
        unique.set(parsed.data.id, parsed.data);
      }
      return { storageState: "READY", records: [...unique.values()]
        .sort((left, right) => right.recordedAtMs - left.recordedAtMs).slice(0, safeLimit) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { storageState: "READY", records: [] };
      return { storageState: "UNAVAILABLE", records: [] };
    }
  }

  async #append(record: BetHistoryRecord): Promise<void> {
    const operation = this.#writes.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true });
      await appendFile(this.#path, `${JSON.stringify(record)}\n`, "utf8");
    });
    this.#writes = operation.catch(() => undefined);
    await operation.catch(() => undefined);
  }
}
