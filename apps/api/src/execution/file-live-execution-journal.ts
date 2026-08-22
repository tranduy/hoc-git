import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PreflightTicket } from "@tool-chenh/contracts";
import { z } from "zod";
import type { LiveTwoLegResult } from "./live-two-leg-coordinator.js";

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const phaseSchema = z.strictObject({ fingerprint: fingerprintSchema,
  phase: z.enum(["CLAIMED", "COMMITTING"]) });
const identitySchema = { provider: z.enum(["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"]),
  providerSelectionId: z.string().min(1) } as const;
const liveLegSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...identitySchema, status: z.literal("ACCEPTED"), receiptId: z.string().min(1).max(512) }),
  z.strictObject({ ...identitySchema, status: z.literal("REJECTED"), receiptId: z.null(),
    reason: z.enum(["PROVIDER_REJECTED", "ODDS_CHANGED", "MARKET_SUSPENDED", "LIMIT_CHANGED"]) }),
  z.strictObject({ ...identitySchema, status: z.literal("UNKNOWN"), receiptId: z.null(),
    reason: z.enum(["TIMEOUT", "ADAPTER_ERROR", "IDENTITY_MISMATCH"]) })
]);
const resultSchema = z.strictObject({ fingerprint: fingerprintSchema,
  result: z.discriminatedUnion("status", [
    z.strictObject({ ticketId: z.string().min(1).max(256), status: z.literal("NOT_SUBMITTED"), legs: z.tuple([]) }),
    z.strictObject({ ticketId: z.string().min(1).max(256),
      status: z.enum(["BOTH_ACCEPTED", "NONE_ACCEPTED", "PARTIAL_FAILURE"]),
      legs: z.tuple([liveLegSchema, liveLegSchema]) })
  ])
});

export type LiveJournalClaim = { readonly status: "CLAIMED" } |
  { readonly status: "IN_DOUBT"; readonly phase: "CLAIMED" | "COMMITTING" } |
  { readonly status: "COMPLETED"; readonly result: LiveTwoLegResult } |
  { readonly status: "CONFLICT" };

function fingerprint(ticket: PreflightTicket): string {
  return createHash("sha256").update(JSON.stringify([ticket.ticketId, ticket.signature, ticket.nonce, ticket.legs]))
    .digest("hex");
}

function assertResultMatchesTicket(ticket: PreflightTicket, result: LiveTwoLegResult): void {
  if (result.status === "NOT_SUBMITTED") return;
  const identitiesMatch = result.legs.every((leg, index) => {
    const expected = ticket.legs[index];
    return expected !== undefined && leg.provider === expected.provider &&
      leg.providerSelectionId === expected.providerSelectionId;
  });
  const accepted = result.legs.filter((leg) => leg.status === "ACCEPTED").length;
  const expectedStatus = accepted === 2 ? "BOTH_ACCEPTED"
    : accepted === 0 && result.legs.every((leg) => leg.status === "REJECTED") ? "NONE_ACCEPTED"
      : "PARTIAL_FAILURE";
  if (!identitiesMatch || result.status !== expectedStatus) throw new Error("LIVE_JOURNAL_RESULT_INVALID");
}

export class FileLiveExecutionJournal {
  readonly #directory: string;
  constructor(directory: string) {
    if (directory.trim().length === 0) throw new Error("LIVE_JOURNAL_DIRECTORY_INVALID");
    this.#directory = directory;
  }

  claimPath(ticketId: string): string { return this.#path(ticketId, "claim"); }

  async claim(ticket: PreflightTicket): Promise<LiveJournalClaim> {
    await mkdir(this.#directory, { recursive: true });
    const expected = fingerprint(ticket);
    const completed = await this.#readResult(ticket.ticketId, expected);
    if (completed !== null) return completed;
    const committing = await this.#readPhase(ticket.ticketId, "committing", expected);
    if (committing !== null) return committing;
    try {
      await writeFile(this.claimPath(ticket.ticketId), JSON.stringify({ fingerprint: expected, phase: "CLAIMED" }),
        { encoding: "utf8", flag: "wx" });
      return { status: "CLAIMED" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.#readPhase(ticket.ticketId, "claim", expected);
      if (existing === null) throw new Error("LIVE_JOURNAL_INVALID");
      return existing;
    }
  }

  async markCommitting(ticket: PreflightTicket): Promise<void> {
    const expected = fingerprint(ticket);
    const claim = await this.#parse(this.claimPath(ticket.ticketId), phaseSchema);
    if (claim.fingerprint !== expected || claim.phase !== "CLAIMED") throw new Error("LIVE_JOURNAL_CONFLICT");
    try {
      await writeFile(this.#path(ticket.ticketId, "committing"),
        JSON.stringify({ fingerprint: expected, phase: "COMMITTING" }), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await this.#parse(this.#path(ticket.ticketId, "committing"), phaseSchema);
      if (current.fingerprint !== expected || current.phase !== "COMMITTING") throw new Error("LIVE_JOURNAL_CONFLICT");
    }
  }

  async complete(ticket: PreflightTicket, result: LiveTwoLegResult): Promise<void> {
    const expected = fingerprint(ticket);
    const phase = result.status === "NOT_SUBMITTED"
      ? await this.#parse(this.claimPath(ticket.ticketId), phaseSchema)
      : await this.#parse(this.#path(ticket.ticketId, "committing"), phaseSchema);
    const expectedPhase = result.status === "NOT_SUBMITTED" ? "CLAIMED" : "COMMITTING";
    if (phase.fingerprint !== expected || phase.phase !== expectedPhase || result.ticketId !== ticket.ticketId) {
      throw new Error("LIVE_JOURNAL_CONFLICT");
    }
    assertResultMatchesTicket(ticket, result);
    const parsed = resultSchema.parse({ fingerprint: expected, result });
    try {
      await writeFile(this.#path(ticket.ticketId, "result"), JSON.stringify(parsed), { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = await this.#parse(this.#path(ticket.ticketId, "result"), resultSchema);
      if (JSON.stringify(current) !== JSON.stringify(parsed)) throw new Error("LIVE_JOURNAL_CONFLICT");
    }
  }

  async #readResult(ticketId: string, expected: string): Promise<LiveJournalClaim | null> {
    const value = await this.#maybeParse(this.#path(ticketId, "result"), resultSchema);
    if (value === null) return null;
    return value.fingerprint === expected ? { status: "COMPLETED", result: value.result } : { status: "CONFLICT" };
  }

  async #readPhase(ticketId: string, suffix: "claim" | "committing", expected: string): Promise<LiveJournalClaim | null> {
    const value = await this.#maybeParse(this.#path(ticketId, suffix), phaseSchema);
    if (value === null) return null;
    if (value.fingerprint !== expected) return { status: "CONFLICT" };
    return { status: "IN_DOUBT", phase: value.phase };
  }

  async #maybeParse<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    try { return await this.#parse(path, schema); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async #parse<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    try {
      const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
      if (!parsed.success) throw new Error("LIVE_JOURNAL_INVALID");
      return parsed.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
      if (error instanceof Error && error.message === "LIVE_JOURNAL_INVALID") throw error;
      throw new Error("LIVE_JOURNAL_INVALID");
    }
  }

  #path(ticketId: string, suffix: "claim" | "committing" | "result"): string {
    const key = createHash("sha256").update(ticketId).digest("hex");
    return join(this.#directory, `${key}.${suffix}.json`);
  }
}
