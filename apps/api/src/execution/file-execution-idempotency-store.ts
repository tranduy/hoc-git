import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { ExecutionIdempotencyClaim, ExecutionIdempotencyStore, TwoLegExecutionResult } from "./two-leg-executor.js";

const legIdentityShape = {
  provider: z.enum(["FABET", "CMD", "SABA", "SBOBET", "APSPORT", "BTI", "IM"]),
  providerSelectionId: z.string().min(1)
} as const;
const legSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...legIdentityShape, status: z.literal("ACCEPTED"), reason: z.null() }),
  z.strictObject({ ...legIdentityShape, status: z.literal("REJECTED"), reason: z.enum([
    "ODDS_CHANGED", "MARKET_SUSPENDED", "LIMIT_CHANGED", "INSUFFICIENT_BALANCE", "PROVIDER_REJECTED"
  ]) }),
  z.strictObject({ ...legIdentityShape, status: z.literal("UNKNOWN"), reason: z.enum([
    "TIMEOUT", "ADAPTER_ERROR", "ADAPTER_UNAVAILABLE", "IDENTITY_MISMATCH"
  ]) })
]);
const resultSchema = z.strictObject({
  ticketId: z.string().min(1), idempotencyKey: z.string().min(16).max(256), mode: z.literal("DRY_RUN"),
  status: z.enum(["BOTH_ACCEPTED", "NONE_ACCEPTED", "PARTIAL_FAILURE"]),
  legs: z.tuple([legSchema, legSchema])
}) satisfies z.ZodType<TwoLegExecutionResult>;
const claimSchema = z.strictObject({ version: z.literal(1), fingerprint: z.string().min(1) });
const completionSchema = z.strictObject({
  version: z.literal(1), fingerprint: z.string().min(1), result: resultSchema
});

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readJson(path: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("EXECUTION_IDEMPOTENCY_STORE_INVALID");
  }
}

export class FileExecutionIdempotencyStore implements ExecutionIdempotencyStore {
  readonly #directory: string;
  constructor(directory: string) {
    if (directory.trim() === "") throw new Error("EXECUTION_IDEMPOTENCY_DIRECTORY_INVALID");
    this.#directory = resolve(directory);
  }

  async claim(idempotencyKey: string, fingerprint: string): Promise<ExecutionIdempotencyClaim> {
    await mkdir(this.#directory, { recursive: true });
    const paths = this.#paths(idempotencyKey);
    const completed = await this.#completed(paths.result, fingerprint);
    if (completed !== null) return completed;
    try {
      await writeFile(paths.claim, JSON.stringify({ version: 1, fingerprint }), { encoding: "utf8", flag: "wx" });
      return { status: "CLAIMED" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("EXECUTION_IDEMPOTENCY_STORE_UNAVAILABLE");
    }
    const completedAfterRace = await this.#completed(paths.result, fingerprint);
    if (completedAfterRace !== null) return completedAfterRace;
    const parsed = claimSchema.safeParse(await readJson(paths.claim));
    if (!parsed.success) throw new Error("EXECUTION_IDEMPOTENCY_STORE_INVALID");
    return parsed.data.fingerprint === fingerprint ? { status: "PENDING" } : { status: "CONFLICT" };
  }

  async complete(idempotencyKey: string, fingerprint: string, result: TwoLegExecutionResult): Promise<void> {
    const paths = this.#paths(idempotencyKey);
    const claim = claimSchema.safeParse(await readJson(paths.claim));
    if (!claim.success || claim.data.fingerprint !== fingerprint) throw new Error("EXECUTION_IDEMPOTENCY_STORE_INVALID");
    const payload = JSON.stringify({ version: 1, fingerprint, result: resultSchema.parse(result) });
    try { await writeFile(paths.result, payload, { encoding: "utf8", flag: "wx" }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("EXECUTION_IDEMPOTENCY_STORE_UNAVAILABLE");
      const completed = await this.#completed(paths.result, fingerprint);
      if (completed?.status !== "COMPLETED" || JSON.stringify(completed.result) !== JSON.stringify(result)) {
        throw new Error("EXECUTION_IDEMPOTENCY_CONFLICT");
      }
    }
  }

  async #completed(path: string, fingerprint: string): Promise<ExecutionIdempotencyClaim | null> {
    const raw = await readJson(path);
    if (raw === null) return null;
    const parsed = completionSchema.safeParse(raw);
    if (!parsed.success) throw new Error("EXECUTION_IDEMPOTENCY_STORE_INVALID");
    return parsed.data.fingerprint === fingerprint
      ? { status: "COMPLETED", result: parsed.data.result }
      : { status: "CONFLICT" };
  }

  #paths(idempotencyKey: string): { claim: string; result: string } {
    const name = digest(idempotencyKey);
    return { claim: join(this.#directory, `${name}.claim.json`), result: join(this.#directory, `${name}.result.json`) };
  }
}
