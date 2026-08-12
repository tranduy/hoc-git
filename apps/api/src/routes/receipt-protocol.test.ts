import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerReceiptProtocolRoute } from "./receipt-protocol.js";

describe("receipt protocol route", () => {
  it("exposes sanitized read-only discovery evidence", async () => {
    const app = Fastify(); registerReceiptProtocolRoute(app, { inspect: async () => ({
      provider: "SBOBET", accountId: "account-1", controlLabel: "Bet history", observations: []
    }) });
    const response = await app.inject({ method: "POST", url: "/api/receipts/protocol/inspect",
      payload: { accountId: "account-1" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({ provider: "SBOBET", observations: [] }));
  });

  it("rejects malformed requests before invoking the service", async () => {
    let called = false;
    const app = Fastify(); registerReceiptProtocolRoute(app, { inspect: async () => {
      called = true;
      throw new Error("must not run");
    } });
    const response = await app.inject({ method: "POST", url: "/api/receipts/protocol/inspect",
      payload: { accountId: "", secret: "leak" } });
    expect(response.statusCode).toBe(400);
    expect(called).toBe(false);
  });

  it("returns a safe diagnostic code without leaking provider details", async () => {
    const app = Fastify(); registerReceiptProtocolRoute(app, { inspect: async () => {
      throw new Error("SBOBET_HISTORY_CONTROL_UNAVAILABLE");
    } });
    const response = await app.inject({ method: "POST", url: "/api/receipts/protocol/inspect",
      payload: { accountId: "account-1" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "SBOBET_HISTORY_CONTROL_UNAVAILABLE" });
  });
});
