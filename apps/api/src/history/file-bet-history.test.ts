import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PreflightTicket, TwoLegExecutionResult } from "@tool-chenh/contracts";
import { FileBetHistory } from "./file-bet-history.js";

const roots: string[] = [];
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), "tool-chenh-bet-history-")); roots.push(value); return value; }
afterEach(async () => Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))));

const ticket = { ticketId: "ticket-1", opportunityId: "opp-1", canonicalEventId: "event-1",
  canonicalMarketId: "market-1", baseCurrency: "VND", totalStakeBase: "180000", worstCaseProfit: "20000",
  issuedAtMs: 1000, expiresAtMs: 4000, nonce: "n".repeat(32), signature: "s".repeat(64), legs: [
    { accountId: "account-a", provider: "SABA", providerEventId: "event-a", providerMarketId: "market-a",
      providerSelectionId: "selection-a", selection: "HOME", line: "0.5", decimalOdds: "1.8", stake: "100000",
      currency: "VND", balance: "300000", balanceAsOfMs: 900, quoteAsOfMs: 950 },
    { accountId: "account-b", provider: "SBOBET", providerEventId: "event-b", providerMarketId: "market-b",
      providerSelectionId: "selection-b", selection: "AWAY", line: "0.5", decimalOdds: "2.5", stake: "72000",
      currency: "VND", balance: "300000", balanceAsOfMs: 900, quoteAsOfMs: 950 }
  ] } as unknown as PreflightTicket;

describe("FileBetHistory", () => {
  it("stores a redacted own preflight record and lists newest first", async () => {
    const directory = await root();
    const history = new FileBetHistory(join(directory, "history.jsonl"), { nowMs: () => 2000 });

    await expect(history.recordPreflight(ticket)).resolves.toBeUndefined();
    const listed = await history.list(20);

    expect(listed.storageState).toBe("READY");
    expect(listed.records).toEqual([expect.objectContaining({ stage: "PREFLIGHT_READY", ticketId: "ticket-1",
      canonicalEventId: "event-1", worstCaseProfit: "20000", recordedAtMs: 2000,
      legs: [expect.objectContaining({ provider: "SABA", selection: "HOME", stake: "100000" }),
        expect.objectContaining({ provider: "SBOBET", selection: "AWAY", stake: "72000" })] })]);
    const raw = await readFile(join(directory, "history.jsonl"), "utf8");
    expect(raw).not.toContain(ticket.signature);
    expect(raw).not.toContain(ticket.nonce);
  });

  it("adds a dry-run result without duplicating an idempotent replay", async () => {
    const directory = await root();
    const history = new FileBetHistory(join(directory, "history.jsonl"), { nowMs: () => 3000 });
    const result = { ticketId: "ticket-1", idempotencyKey: "idempotency-key-1", mode: "DRY_RUN",
      status: "BOTH_ACCEPTED", legs: [
        { provider: "SABA", providerSelectionId: "selection-a", status: "ACCEPTED" },
        { provider: "SBOBET", providerSelectionId: "selection-b", status: "ACCEPTED" }
      ] } as unknown as TwoLegExecutionResult;

    await history.recordExecution(ticket, result);
    await history.recordExecution(ticket, result);

    expect((await history.list(20)).records).toHaveLength(1);
  });

  it("never throws or blocks callers when storage is unavailable", async () => {
    const directory = await root();
    const history = new FileBetHistory(directory, { nowMs: () => 4000 });

    await expect(history.recordPreflight(ticket)).resolves.toBeUndefined();
    await expect(history.list(20)).resolves.toEqual({ storageState: "UNAVAILABLE", records: [] });
  });
});
