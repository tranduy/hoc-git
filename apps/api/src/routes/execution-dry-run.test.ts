import type { ExecutionRequest, TwoLegExecutionResult } from "@tool-chenh/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerExecutionDryRunRoute } from "./execution-dry-run.js";

const request: ExecutionRequest = {
  mode: "DRY_RUN", idempotencyKey: "request-key-123456",
  ticket: { ticketId: "ticket-1", opportunityId: "opp-1", canonicalEventId: "event-1",
    canonicalMarketId: "market-1", baseCurrency: "VND", totalStakeBase: "180000",
    worstCaseProfit: "20000", issuedAtMs: 1000, expiresAtMs: 3000,
    nonce: "nonce-1234567890123456", signature: "signature-1234567890123456", legs: [
      { accountId: "account-a", provider: "SBOBET", providerEventId: "event-a",
        providerMarketId: "market-a", providerSelectionId: "home", selection: "HOME", line: "-0.5",
        decimalOdds: "2", stake: "100000", currency: "VND", balance: "500000",
        balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
      { accountId: "account-b", provider: "APSPORT", providerEventId: "event-b",
        providerMarketId: "market-b", providerSelectionId: "away", selection: "AWAY", line: "-0.5",
        decimalOdds: "2.5", stake: "80000", currency: "VND", balance: "500000",
        balanceAsOfMs: 1000, quoteAsOfMs: 1000 }
    ] }
};

const result: TwoLegExecutionResult = { ticketId: "ticket-1", idempotencyKey: "request-key-123456",
  mode: "DRY_RUN", status: "BOTH_ACCEPTED", legs: [
    { provider: "SBOBET", providerSelectionId: "home", status: "ACCEPTED", reason: null },
    { provider: "APSPORT", providerSelectionId: "away", status: "ACCEPTED", reason: null }
  ] };

describe("execution dry-run route", () => {
  it("accepts only strict DRY_RUN requests and validates the service response", async () => {
    const app = Fastify();
    registerExecutionDryRunRoute(app, { execute: async () => result });
    const response = await app.inject({ method: "POST", url: "/api/execution/dry-run", payload: request });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect((await app.inject({ method: "POST", url: "/api/execution/dry-run",
      payload: { ...request, mode: "LIVE" } })).statusCode).toBe(400);
  });

  it("fails closed without leaking internal errors", async () => {
    const app = Fastify();
    registerExecutionDryRunRoute(app, { execute: async () => { throw new Error("EXECUTION_TICKET_EXPIRED"); } });
    const response = await app.inject({ method: "POST", url: "/api/execution/dry-run", payload: request });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ status: "NOT_EXECUTED", error: "EXECUTION_TICKET_EXPIRED" });
  });
});
