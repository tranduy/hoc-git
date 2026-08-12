import { describe, expect, it } from "vitest";
import { ExecutionApi } from "./execution.js";

const ticket = { ticketId: "ticket-1", opportunityId: "opp-1", canonicalEventId: "event-1",
  canonicalMarketId: "market-1", baseCurrency: "VND", totalStakeBase: "180000", worstCaseProfit: "20000",
  issuedAtMs: 1000, expiresAtMs: 3000, nonce: "nonce-value-123456", signature: "signature-value-123456",
  legs: [
    { accountId: "a", provider: "SABA", providerEventId: "ea", providerMarketId: "ma",
      providerSelectionId: "sa", selection: "HOME", line: "-0.5", decimalOdds: "2", stake: "100000",
      currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
    { accountId: "b", provider: "SBOBET", providerEventId: "eb", providerMarketId: "mb",
      providerSelectionId: "sb", selection: "AWAY", line: "-0.5", decimalOdds: "2.5", stake: "80000",
      currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
  ] } as const;

describe("ExecutionApi", () => {
  it("posts strict preflight and dry-run requests", async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const api = new ExecutionApi(async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify(requests.length === 1 ? { status: "READY_BOTH", ticket } : {
        ticketId: "ticket-1", idempotencyKey: "request-key-123456", mode: "DRY_RUN", status: "BOTH_ACCEPTED",
        legs: [{ provider: "SABA", providerSelectionId: "sa", status: "ACCEPTED", reason: null },
          { provider: "SBOBET", providerSelectionId: "sb", status: "ACCEPTED", reason: null }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const signed = await api.preflight({ opportunityId: "opp-1", accountAId: "a", accountBId: "b",
      maxOddsDriftBps: 25 });
    await expect(api.dryRun({ ticket: signed, idempotencyKey: "request-key-123456", mode: "DRY_RUN" }))
      .resolves.toMatchObject({ status: "BOTH_ACCEPTED" });
    expect(requests.map((request) => request.url)).toEqual(["/api/preflight", "/api/execution/dry-run"]);
  });

  it("rejects malformed successful responses", async () => {
    const api = new ExecutionApi(async () => new Response("{}", { status: 200,
      headers: { "content-type": "application/json" } }));
    await expect(api.preflight({ opportunityId: "opp-1", accountAId: "a", accountBId: "b",
      maxOddsDriftBps: 25 })).rejects.toThrow("Invalid preflight response");
  });
});
