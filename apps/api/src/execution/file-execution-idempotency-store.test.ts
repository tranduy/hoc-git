import type { PreflightTicket } from "@tool-chenh/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileExecutionIdempotencyStore } from "./file-execution-idempotency-store.js";
import { TwoLegExecutor, type ExecutionLegAdapter } from "./two-leg-executor.js";

const ticket: PreflightTicket = {
  ticketId: "ticket-durable", opportunityId: "opp-1", canonicalEventId: "event-1", canonicalMarketId: "market-1",
  baseCurrency: "VND", totalStakeBase: "180000", worstCaseProfit: "20000", issuedAtMs: 1000, expiresAtMs: 3000,
  nonce: "nonce-1234567890123456", signature: "signature-1234567890123456",
  legs: [
    { accountId: "sb", provider: "SBOBET", providerEventId: "sb-event", providerMarketId: "sb-market",
      providerSelectionId: "sb-home", selection: "HOME", line: "-0.5", decimalOdds: "2", stake: "100000", currency: "VND",
      balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
    { accountId: "ap", provider: "APSPORT", providerEventId: "ap-event", providerMarketId: "ap-market",
      providerSelectionId: "ap-away", selection: "AWAY", line: "-0.5", decimalOdds: "2.5", stake: "80000", currency: "VND",
      balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
  ]
};

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true }))));

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "tool-chenh-execution-"));
  directories.push(value);
  return value;
}

function acceptedAdapter(provider: "SBOBET" | "APSPORT", calls: { value: number }): ExecutionLegAdapter {
  return { provider, dryRun: async (leg) => {
    calls.value += 1;
    return { provider, providerSelectionId: leg.providerSelectionId, status: "ACCEPTED", reason: null };
  } };
}

function executor(store: FileExecutionIdempotencyStore, adapters: readonly ExecutionLegAdapter[]): TwoLegExecutor {
  return new TwoLegExecutor({ adapters, idempotencyStore: store, verifyTicket: () => true,
    clock: { nowMs: () => 1500 }, timeoutMs: 1000 });
}

describe("durable execution idempotency", () => {
  it("returns the persisted result after an executor restart without touching either adapter again", async () => {
    const path = await directory();
    const firstCalls = { value: 0 };
    const request = { ticket, idempotencyKey: "durable-request-123456", mode: "DRY_RUN" as const };
    const first = await executor(new FileExecutionIdempotencyStore(path), [
      acceptedAdapter("SBOBET", firstCalls), acceptedAdapter("APSPORT", firstCalls)
    ]).execute(request);
    expect(first.status).toBe("BOTH_ACCEPTED");
    expect(firstCalls.value).toBe(2);

    const restartCalls = { value: 0 };
    const replay = await executor(new FileExecutionIdempotencyStore(path), [
      acceptedAdapter("SBOBET", restartCalls), acceptedAdapter("APSPORT", restartCalls)
    ]).execute(request);
    expect(replay).toEqual(first);
    expect(restartCalls.value).toBe(0);
  });

  it("refuses to repeat legs when another process left the same request pending", async () => {
    const path = await directory();
    const releases: Array<() => void> = [];
    const hanging = (provider: "SBOBET" | "APSPORT"): ExecutionLegAdapter => ({ provider, dryRun: async (leg) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return { provider, providerSelectionId: leg.providerSelectionId, status: "ACCEPTED", reason: null };
    } });
    const request = { ticket, idempotencyKey: "pending-request-123456", mode: "DRY_RUN" as const };
    const active = executor(new FileExecutionIdempotencyStore(path), [hanging("SBOBET"), hanging("APSPORT")])
      .execute(request);
    await vi.waitFor(() => expect(releases).toHaveLength(2));

    const restartCalls = { value: 0 };
    await expect(executor(new FileExecutionIdempotencyStore(path), [
      acceptedAdapter("SBOBET", restartCalls), acceptedAdapter("APSPORT", restartCalls)
    ]).execute(request)).rejects.toThrow("EXECUTION_IDEMPOTENCY_IN_DOUBT");
    expect(restartCalls.value).toBe(0);
    releases.splice(0).forEach((release) => release());
    await expect(active).resolves.toMatchObject({ status: "BOTH_ACCEPTED" });
  });
});
