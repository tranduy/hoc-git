import type { PreflightTicket } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import type { LiveTwoLegResult } from "./live-two-leg-coordinator.js";
import { ReceiptReconciler, type ReceiptObservation, type ReceiptReader } from "./receipt-reconciler.js";

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

const result: LiveTwoLegResult = { ticketId: ticket.ticketId, status: "BOTH_ACCEPTED", legs: [
  { provider: "SABA", providerSelectionId: "sa", status: "ACCEPTED", receiptId: "receipt-a" },
  { provider: "SBOBET", providerSelectionId: "sb", status: "ACCEPTED", receiptId: "receipt-b" }
] };

function observation(index: 0 | 1, overrides: Partial<ReceiptObservation> = {}): ReceiptObservation {
  const leg = ticket.legs[index]; const reported = result.legs[index]!;
  return { provider: leg.provider, accountId: leg.accountId, providerEventId: leg.providerEventId,
    providerMarketId: leg.providerMarketId, providerSelectionId: leg.providerSelectionId,
    selection: leg.selection, line: "-0.50", decimalOdds: index === 0 ? "2.00" : "2.500",
    stake: `${Number(leg.stake).toFixed(2)}`, currency: leg.currency, status: "ACCEPTED",
    receiptId: reported.status === "ACCEPTED" ? reported.receiptId : null, ...overrides };
}

function reader(provider: "SABA" | "SBOBET", value: ReceiptObservation | null): ReceiptReader {
  return { provider, lookup: vi.fn(async () => value) };
}

describe("ReceiptReconciler", () => {
  it("verifies both receipts against every signed leg field while accepting equivalent decimal formatting", async () => {
    const saba = reader("SABA", observation(0)); const sbobet = reader("SBOBET", observation(1));
    const service = new ReceiptReconciler({ readers: [saba, sbobet], tripKillSwitch: vi.fn() });
    await expect(service.reconcile({ ticket, result })).resolves.toMatchObject({ status: "VERIFIED",
      executionStatus: "BOTH_ACCEPTED" });
    expect(saba.lookup).toHaveBeenCalledOnce(); expect(sbobet.lookup).toHaveBeenCalledOnce();
  });

  it("returns conflict and trips the kill switch when a receipt belongs to another account or selection", async () => {
    const trip = vi.fn(); const service = new ReceiptReconciler({ readers: [
      reader("SABA", observation(0, { accountId: "other-account" })), reader("SBOBET", observation(1))
    ], tripKillSwitch: trip });
    await expect(service.reconcile({ ticket, result })).resolves.toMatchObject({ status: "CONFLICT",
      reasons: ["RECEIPT_IDENTITY_MISMATCH"] });
    expect(trip).toHaveBeenCalledOnce();
  });

  it("rejects a reported execution leg whose provider identity differs from the signed leg", async () => {
    const trip = vi.fn(); const service = new ReceiptReconciler({ readers: [reader("SABA", observation(0)),
      reader("SBOBET", observation(1))], tripKillSwitch: trip });
    const mismatched: LiveTwoLegResult = { ...result, legs: [
      { provider: "SBOBET", providerSelectionId: "sa", status: "ACCEPTED", receiptId: "receipt-a" },
      result.legs[1]
    ] };
    await expect(service.reconcile({ ticket, result: mismatched })).resolves.toMatchObject({ status: "CONFLICT",
      reasons: ["EXECUTION_LEG_IDENTITY_MISMATCH"] });
    expect(trip).toHaveBeenCalledOnce();
  });

  it("keeps execution in doubt and trips the kill switch when a reader is missing or has no receipt", async () => {
    const trip = vi.fn(); const service = new ReceiptReconciler({ readers: [reader("SABA", null)],
      tripKillSwitch: trip });
    await expect(service.reconcile({ ticket, result })).resolves.toMatchObject({ status: "IN_DOUBT",
      reasons: expect.arrayContaining(["RECEIPT_NOT_FOUND", "RECEIPT_READER_UNAVAILABLE"]) });
    expect(trip).toHaveBeenCalledOnce();
  });

  it("times out a stuck receipt reader and leaves the execution in doubt", async () => {
    const trip = vi.fn(); const stuck = { provider: "SABA" as const,
      lookup: vi.fn(async () => new Promise<ReceiptObservation | null>(() => {})) };
    const service = new ReceiptReconciler({ readers: [stuck, reader("SBOBET", observation(1))],
      timeoutMs: 10, tripKillSwitch: trip });
    await expect(service.reconcile({ ticket, result })).resolves.toMatchObject({ status: "IN_DOUBT",
      reasons: ["RECEIPT_READER_TIMEOUT"] });
    expect(trip).toHaveBeenCalledOnce();
  });

  it("fails closed when a terminal reconciliation cannot be persisted", async () => {
    const trip = vi.fn(); const journal = { record: vi.fn(async () => { throw new Error("disk full"); }) };
    const service = new ReceiptReconciler({ readers: [reader("SABA", observation(0)),
      reader("SBOBET", observation(1))], journal, clock: { nowMs: () => 5000 }, tripKillSwitch: trip });
    await expect(service.reconcile({ ticket, result })).resolves.toMatchObject({ status: "IN_DOUBT",
      reasons: ["RECONCILIATION_PERSISTENCE_FAILED"] });
    expect(journal.record).toHaveBeenCalledOnce(); expect(trip).toHaveBeenCalledOnce();
  });

  it("does not query providers for a safely completed prepare failure", async () => {
    const lookup = vi.fn(); const service = new ReceiptReconciler({ readers: [{ provider: "SABA", lookup }],
      tripKillSwitch: vi.fn() });
    await expect(service.reconcile({ ticket, result: { ticketId: ticket.ticketId, status: "NOT_SUBMITTED",
      legs: [] } })).resolves.toEqual({ status: "VERIFIED", executionStatus: "NOT_SUBMITTED", observations: [],
        reasons: [] });
    expect(lookup).not.toHaveBeenCalled();
  });
});
