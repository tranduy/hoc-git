import type { PreflightTicket } from "@tool-chenh/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveTwoLegResult } from "./live-two-leg-coordinator.js";
import type { ReconciliationResult } from "./receipt-reconciler.js";
import { FileReconciliationJournal } from "./file-reconciliation-journal.js";

const ticket: PreflightTicket = { ticketId: "ticket-live", opportunityId: "opp", canonicalEventId: "event",
  canonicalMarketId: "market", baseCurrency: "VND", totalStakeBase: "180000", worstCaseProfit: "20000",
  issuedAtMs: 1000, expiresAtMs: 3000, nonce: "nonce-value-123456", signature: "signature-value-123456",
  legs: [
    { accountId: "account-a", provider: "SABA", providerEventId: "ea", providerMarketId: "ma",
      providerSelectionId: "sa", selection: "HOME", line: "-0.5", decimalOdds: "2", stake: "100000",
      currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
    { accountId: "account-b", provider: "SBOBET", providerEventId: "eb", providerMarketId: "mb",
      providerSelectionId: "sb", selection: "AWAY", line: "-0.5", decimalOdds: "2.5", stake: "80000",
      currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
  ] };
const execution: LiveTwoLegResult = { ticketId: ticket.ticketId, status: "BOTH_ACCEPTED", legs: [
  { provider: "SABA", providerSelectionId: "sa", status: "ACCEPTED", receiptId: "receipt-a" },
  { provider: "SBOBET", providerSelectionId: "sb", status: "ACCEPTED", receiptId: "receipt-b" }
] };
const reconciliation: ReconciliationResult = { status: "VERIFIED", executionStatus: "BOTH_ACCEPTED", reasons: [],
  observations: ticket.legs.map((leg, index) => ({ provider: leg.provider, accountId: leg.accountId,
    providerEventId: leg.providerEventId, providerMarketId: leg.providerMarketId,
    providerSelectionId: leg.providerSelectionId, selection: leg.selection, line: leg.line,
    decimalOdds: leg.decimalOdds, stake: leg.stake, currency: leg.currency, status: "ACCEPTED" as const,
    receiptId: index === 0 ? "receipt-a" : "receipt-b" })) };

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
async function directory(): Promise<string> { const path = await mkdtemp(join(tmpdir(), "tool-chenh-reconcile-"));
  directories.push(path); return path; }

describe("FileReconciliationJournal", () => {
  it("persists a sanitized terminal result and replays it after restart", async () => {
    const path = await directory(); const first = new FileReconciliationJournal(path);
    const recorded = await first.record(ticket, execution, reconciliation, 5000);
    expect(JSON.stringify(recorded)).not.toContain("account-a");
    await expect(new FileReconciliationJournal(path).read(ticket, execution)).resolves
      .toEqual({ status: "RECORDED", record: recorded });
    await expect(new FileReconciliationJournal(path).record(ticket, execution, reconciliation, 9000)).resolves
      .toEqual(recorded);
  });

  it("refuses to persist an in-doubt result as terminal", async () => {
    const journal = new FileReconciliationJournal(await directory());
    await expect(journal.record(ticket, execution, { ...reconciliation, status: "IN_DOUBT",
      reasons: ["RECEIPT_NOT_FOUND"] }, 5000)).rejects.toThrow("LIVE_RECONCILIATION_NOT_TERMINAL");
  });

  it("fails closed for a changed execution or mismatched receipt evidence", async () => {
    const path = await directory(); const journal = new FileReconciliationJournal(path);
    await expect(journal.record(ticket, execution, { ...reconciliation, observations: [
      { ...reconciliation.observations[0]!, providerSelectionId: "wrong" }, reconciliation.observations[1]!
    ] }, 5000)).rejects.toThrow("LIVE_RECONCILIATION_RESULT_INVALID");
    await journal.record(ticket, execution, reconciliation, 5000);
    await expect(new FileReconciliationJournal(path).read(ticket, { ...execution, status: "PARTIAL_FAILURE" }))
      .resolves.toEqual({ status: "CONFLICT" });
  });
});
