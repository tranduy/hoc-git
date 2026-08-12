import type { PreflightTicket } from "@tool-chenh/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLiveExecutionJournal } from "./file-live-execution-journal.js";

const ticket: PreflightTicket = { ticketId: "ticket-live", opportunityId: "opp-1",
  canonicalEventId: "event-1", canonicalMarketId: "market-1", baseCurrency: "VND",
  totalStakeBase: "180000", worstCaseProfit: "20000", issuedAtMs: 1000, expiresAtMs: 3000,
  nonce: "nonce-value-123456", signature: "signature-value-123456", legs: [
    { accountId: "a", provider: "SABA", providerEventId: "ea", providerMarketId: "ma",
      providerSelectionId: "sa", selection: "HOME", line: "-0.5", decimalOdds: "2", stake: "100000",
      currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
    { accountId: "b", provider: "SBOBET", providerEventId: "eb", providerMarketId: "mb",
      providerSelectionId: "sb", selection: "AWAY", line: "-0.5", decimalOdds: "2.5", stake: "80000",
      currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
  ] };

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "tool-chenh-live-journal-"));
  directories.push(path); return path; }

describe("FileLiveExecutionJournal", () => {
  it("claims once and reports in-doubt after restart instead of allowing a retry", async () => {
    const path = await directory(); const first = new FileLiveExecutionJournal(path);
    await expect(first.claim(ticket)).resolves.toEqual({ status: "CLAIMED" });
    await expect(new FileLiveExecutionJournal(path).claim(ticket)).resolves.toEqual({ status: "IN_DOUBT",
      phase: "CLAIMED" });
  });

  it("latches committing before provider commits and preserves that phase after restart", async () => {
    const path = await directory(); const first = new FileLiveExecutionJournal(path);
    await first.claim(ticket); await first.markCommitting(ticket);
    await expect(new FileLiveExecutionJournal(path).claim(ticket)).resolves.toEqual({ status: "IN_DOUBT",
      phase: "COMMITTING" });
  });

  it("replays a completed result without another provider call", async () => {
    const path = await directory(); const first = new FileLiveExecutionJournal(path);
    await first.claim(ticket); await first.markCommitting(ticket);
    const result = { ticketId: "ticket-live", status: "BOTH_ACCEPTED" as const, legs: [
      { provider: "SABA" as const, providerSelectionId: "sa", status: "ACCEPTED" as const,
        receiptId: "receipt-a" },
      { provider: "SBOBET" as const, providerSelectionId: "sb", status: "ACCEPTED" as const,
        receiptId: "receipt-b" }
    ] as const };
    await first.complete(ticket, result);
    await expect(new FileLiveExecutionJournal(path).claim(ticket)).resolves.toEqual({ status: "COMPLETED", result });
  });

  it("records a prepare failure as safely completed without entering committing", async () => {
    const path = await directory(); const first = new FileLiveExecutionJournal(path);
    await first.claim(ticket);
    const result = { ticketId: "ticket-live", status: "NOT_SUBMITTED" as const, legs: [] as const };
    await first.complete(ticket, result);
    await expect(new FileLiveExecutionJournal(path).claim(ticket)).resolves.toEqual({ status: "COMPLETED", result });
  });

  it("rejects receipts whose leg identity or aggregate status does not match the signed ticket", async () => {
    const path = await directory(); const first = new FileLiveExecutionJournal(path);
    await first.claim(ticket); await first.markCommitting(ticket);
    await expect(first.complete(ticket, { ticketId: ticket.ticketId, status: "BOTH_ACCEPTED", legs: [
      { provider: "SBOBET", providerSelectionId: "sa", status: "ACCEPTED", receiptId: "wrong-provider" },
      { provider: "SBOBET", providerSelectionId: "sb", status: "ACCEPTED", receiptId: "receipt-b" }
    ] })).rejects.toThrow("LIVE_JOURNAL_RESULT_INVALID");
    await expect(first.complete(ticket, { ticketId: ticket.ticketId, status: "BOTH_ACCEPTED", legs: [
      { provider: "SABA", providerSelectionId: "sa", status: "ACCEPTED", receiptId: "receipt-a" },
      { provider: "SBOBET", providerSelectionId: "sb", status: "REJECTED", receiptId: null,
        reason: "PROVIDER_REJECTED" }
    ] })).rejects.toThrow("LIVE_JOURNAL_RESULT_INVALID");
  });

  it("rejects the same ticket id with a different signed fingerprint and malformed files", async () => {
    const path = await directory(); const first = new FileLiveExecutionJournal(path); await first.claim(ticket);
    await expect(first.claim({ ...ticket, signature: "different-signature-123456" })).resolves
      .toEqual({ status: "CONFLICT" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(first.claimPath(ticket.ticketId), "{}", "utf8");
    await expect(new FileLiveExecutionJournal(path).claim(ticket)).rejects.toThrow("LIVE_JOURNAL_INVALID");
  });
});
