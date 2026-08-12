import type { ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerProviderPreflightRoutes } from "./provider-preflight.js";

const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "2.2", requestedStake: "100000" };
const result: ProviderTicketPreflight = { accountId: "account-1", provider: "SABA", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  decimalOdds: "2.2", quoteStatus: "OPEN", limitEvidence: { currency: "VND", minStake: "50000",
    maxStake: "200000", stakeStep: "1000", balance: "300000", verifiedAsOfMs: 1000, expiresAtMs: 3000 },
  constraint: { currency: "VND", minStake: "50000",
    maxStake: "200000", stakeStep: "1000", balance: "300000", feeType: "NONE", feeRate: null,
    verifiedAsOfMs: 1000, expiresAtMs: 3000 }, eligible: true, reasons: [] };

describe("provider preflight route", () => {
  it("returns strict no-store read-only ticket evidence", async () => {
    const app = Fastify(); registerProviderPreflightRoutes(app, { preflight: async () => result });
    const response = await app.inject({ method: "POST", url: "/api/preflight/provider", payload: request });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    await app.close();
  });

  it("rejects malformed requests and maps fail-closed provider errors", async () => {
    const app = Fastify(); registerProviderPreflightRoutes(app, { preflight: async () => {
      throw new Error("PREFLIGHT_IDENTITY_MISMATCH");
    } });
    expect((await app.inject({ method: "POST", url: "/api/preflight/provider", payload: { ...request,
      providerSelectionId: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/preflight/provider", payload: request })).statusCode).toBe(422);
    await app.close();
  });
});
