import type { PreflightRequest, PreflightTicket } from "@tool-chenh/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerTwoLegPreflightRoutes } from "./two-leg-preflight.js";

const request: PreflightRequest = { opportunityId: "opp-1", accountAId: "account-a",
  accountBId: "account-b", maxOddsDriftBps: 25 };
const ticket: PreflightTicket = { ticketId: "ticket-1", opportunityId: "opp-1",
  canonicalEventId: "event-1", canonicalMarketId: "market-1", baseCurrency: "VND",
  totalStakeBase: "180000", worstCaseProfit: "20000", issuedAtMs: 1000, expiresAtMs: 3000,
  nonce: "nonce-1234567890123456", signature: "signature-1234567890123456",
  legs: [{ accountId: "account-a", provider: "SBOBET", providerEventId: "event-a",
    providerMarketId: "market-a", providerSelectionId: "home", selection: "HOME", decimalOdds: "2",
    stake: "100000", currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 },
  { accountId: "account-b", provider: "APSPORT", providerEventId: "event-b",
    providerMarketId: "market-b", providerSelectionId: "away", selection: "AWAY", decimalOdds: "2.5",
    stake: "80000", currency: "VND", balance: "500000", balanceAsOfMs: 1000, quoteAsOfMs: 1000 }] };

describe("two-leg preflight route", () => {
  it("returns READY_BOTH only with a valid signed ticket", async () => {
    const app = Fastify();
    registerTwoLegPreflightRoutes(app, { preflight: async () => ticket });
    const response = await app.inject({ method: "POST", url: "/api/preflight", payload: request });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "READY_BOTH", ticket });
  });

  it("rejects invalid requests and reports fail-closed service errors", async () => {
    const app = Fastify();
    registerTwoLegPreflightRoutes(app, { preflight: async () => { throw new Error("PREFLIGHT_ODDS_DRIFT"); } });
    expect((await app.inject({ method: "POST", url: "/api/preflight", payload: { ...request,
      accountBId: request.accountAId } })).statusCode).toBe(400);
    const response = await app.inject({ method: "POST", url: "/api/preflight", payload: request });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ status: "NOT_READY", error: "PREFLIGHT_ODDS_DRIFT" });
  });
});
