import type { PreflightTicket } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { TwoLegExecutor, type ExecutionLegAdapter } from "./two-leg-executor.js";

const ticket: PreflightTicket = {
  ticketId: "ticket-1", opportunityId: "opp-1", canonicalEventId: "event-1", canonicalMarketId: "market-1",
  baseCurrency: "VND", totalStakeBase: "180000", worstCaseProfit: "20000", issuedAtMs: 1000, expiresAtMs: 3000,
  nonce: "nonce-1234567890123456", signature: "signature-1234567890123456",
  legs: [
    { accountId: "sb", provider: "SBOBET", providerEventId: "sb-event", providerMarketId: "sb-market",
      providerSelectionId: "sb-home", selection: "HOME", decimalOdds: "2", stake: "100000", currency: "VND",
      balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
    { accountId: "ap", provider: "APSPORT", providerEventId: "ap-event", providerMarketId: "ap-market",
      providerSelectionId: "ap-away", selection: "AWAY", decimalOdds: "2.5", stake: "80000", currency: "VND",
      balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
  ]
};

function adapter(provider: "SBOBET" | "APSPORT", status: "ACCEPTED" | "REJECTED" = "ACCEPTED"):
ExecutionLegAdapter {
  return { provider, dryRun: vi.fn(async (leg) => status === "ACCEPTED"
    ? ({ status, reason: null, provider, providerSelectionId: leg.providerSelectionId })
    : ({ status, reason: "PROVIDER_REJECTED" as const, provider, providerSelectionId: leg.providerSelectionId })) };
}

function service(adapters: readonly ExecutionLegAdapter[], options: { nowMs?: number; timeoutMs?: number } = {}) {
  return new TwoLegExecutor({ adapters, verifyTicket: () => true,
    clock: { nowMs: () => options.nowMs ?? 1500 }, timeoutMs: options.timeoutMs ?? 100 });
}

describe("TwoLegExecutor dry run", () => {
  it("runs both verified legs concurrently and reports both accepted", async () => {
    const executor = service([adapter("SBOBET"), adapter("APSPORT")]);
    await expect(executor.execute({ ticket, idempotencyKey: "request-1234567890123456", mode: "DRY_RUN" }))
      .resolves.toMatchObject({ status: "BOTH_ACCEPTED",
        legs: [{ provider: "SBOBET", status: "ACCEPTED" }, { provider: "APSPORT", status: "ACCEPTED" }] });
  });

  it("returns the same operation for a duplicate idempotency key", async () => {
    const sb = adapter("SBOBET"); const ap = adapter("APSPORT");
    const executor = service([sb, ap]);
    const request = { ticket, idempotencyKey: "request-1234567890123456", mode: "DRY_RUN" as const };
    const [first, second] = await Promise.all([executor.execute(request), executor.execute(request)]);
    expect(second).toEqual(first);
    expect(sb.dryRun).toHaveBeenCalledTimes(1);
    expect(ap.dryRun).toHaveBeenCalledTimes(1);
  });

  it("rejects expired or unverifiable tickets before touching adapters", async () => {
    const sb = adapter("SBOBET"); const ap = adapter("APSPORT");
    await expect(service([sb, ap], { nowMs: 3000 }).execute({ ticket,
      idempotencyKey: "request-1234567890123456", mode: "DRY_RUN" })).rejects.toThrow("EXECUTION_TICKET_EXPIRED");
    const invalid = new TwoLegExecutor({ adapters: [sb, ap], verifyTicket: () => false,
      clock: { nowMs: () => 1500 } });
    await expect(invalid.execute({ ticket, idempotencyKey: "request-abcdefghijklmnop", mode: "DRY_RUN" }))
      .rejects.toThrow("EXECUTION_TICKET_INVALID");
    expect(sb.dryRun).not.toHaveBeenCalled();
  });

  it("reports partial failure when only one provider accepts", async () => {
    const executor = service([adapter("SBOBET", "ACCEPTED"), adapter("APSPORT", "REJECTED")]);
    await expect(executor.execute({ ticket, idempotencyKey: "request-1234567890123456", mode: "DRY_RUN" }))
      .resolves.toMatchObject({ status: "PARTIAL_FAILURE",
        legs: [{ status: "ACCEPTED" }, { status: "REJECTED" }] });
  });

  it("marks an unresolved provider unknown on timeout and never claims both accepted", async () => {
    const hanging: ExecutionLegAdapter = { provider: "APSPORT",
      dryRun: async () => new Promise<never>(() => undefined) };
    const executor = service([adapter("SBOBET"), hanging], { timeoutMs: 10 });
    await expect(executor.execute({ ticket, idempotencyKey: "request-1234567890123456", mode: "DRY_RUN" }))
      .resolves.toMatchObject({ status: "PARTIAL_FAILURE",
        legs: [{ status: "ACCEPTED" }, { status: "UNKNOWN", reason: "TIMEOUT" }] });
  });

  it("preserves odds-changed and suspended rejection reasons", async () => {
    const changed: ExecutionLegAdapter = { provider: "SBOBET", dryRun: async (leg) => ({ provider: "SBOBET",
      providerSelectionId: leg.providerSelectionId, status: "REJECTED", reason: "ODDS_CHANGED" }) };
    const suspended: ExecutionLegAdapter = { provider: "APSPORT", dryRun: async (leg) => ({ provider: "APSPORT",
      providerSelectionId: leg.providerSelectionId, status: "REJECTED", reason: "MARKET_SUSPENDED" }) };
    await expect(service([changed, suspended]).execute({ ticket, idempotencyKey: "request-1234567890123456",
      mode: "DRY_RUN" })).resolves.toMatchObject({ status: "NONE_ACCEPTED",
      legs: [{ reason: "ODDS_CHANGED" }, { reason: "MARKET_SUSPENDED" }] });
  });

  it("turns a spoofed adapter identity into unknown instead of accepted", async () => {
    const spoofed: ExecutionLegAdapter = { provider: "APSPORT", dryRun: async () => ({ provider: "APSPORT",
      providerSelectionId: "wrong-selection", status: "ACCEPTED", reason: null }) };
    await expect(service([adapter("SBOBET"), spoofed]).execute({ ticket,
      idempotencyKey: "request-1234567890123456", mode: "DRY_RUN" })).resolves.toMatchObject({
      status: "PARTIAL_FAILURE", legs: [{ status: "ACCEPTED" },
        { status: "UNKNOWN", reason: "IDENTITY_MISMATCH" }]
    });
  });
});
