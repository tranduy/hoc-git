import { describe, expect, it } from "vitest";
import { TwoLegExecutionResultSchema } from "@tool-chenh/contracts";
import type { ExecutionLegResult, PreflightTicket, ProviderId } from "@tool-chenh/contracts";
import { TwoLegExecutor, type ExecutionLegAdapter } from "./two-leg-executor.js";

const leg = (provider: ProviderId, selection: string) => ({
  provider, accountId: `${provider}-account`, providerEventId: "event-1",
  providerMarketId: `${provider}-market`, providerSelectionId: `${provider}-${selection}`,
  selection, line: null, decimalOdds: "4.10", stake: "100"
});

const ticket = (providers: readonly ProviderId[]): PreflightTicket => ({
  ticketId: "ticket-1", opportunityId: "opportunity-1", signature: "signature", nonce: "nonce",
  expiresAtMs: 10_000,
  legs: providers.map((provider, index) => leg(provider, ["HOME", "DRAW", "AWAY"][index]!))
} as unknown as PreflightTicket);

const adapter = (provider: ProviderId, status: ExecutionLegResult["status"]): ExecutionLegAdapter => ({
  provider,
  dryRun: async (input) => (status === "ACCEPTED"
    ? { provider, providerSelectionId: input.providerSelectionId, status: "ACCEPTED", reason: null }
    : { provider, providerSelectionId: input.providerSelectionId, status: "REJECTED",
        reason: "MARKET_SUSPENDED" }) as ExecutionLegResult
});

const executor = (adapters: readonly ExecutionLegAdapter[]) => new TwoLegExecutor({
  adapters, verifyTicket: () => true, clock: { nowMs: () => 0 }
});

describe("dry run for a three-outcome ticket", () => {
  it("checks every leg and calls the ticket covered only when all of them are on", async () => {
    // A corner 1X2 needs a leg on each of three books. Nothing could check that
    // before: the executor refused any ticket that was not exactly two legs.
    const result = await executor([
      adapter("SABA", "ACCEPTED"), adapter("SBOBET", "ACCEPTED"), adapter("CMD", "ACCEPTED")
    ]).execute({ ticket: ticket(["SABA", "SBOBET", "CMD"]), mode: "DRY_RUN", idempotencyKey: "idempotency-key-0001" });

    expect(result.legs).toHaveLength(3);
    expect(result.status).toBe("BOTH_ACCEPTED");
    expect(result.mode).toBe("DRY_RUN");
    // The contract has to accept what the executor produces.
    expect(() => TwoLegExecutionResultSchema.parse(result)).not.toThrow();
  });

  it("calls two of three a partial fill, never a covered ticket", async () => {
    // Two legs on and one refused is an open position, not an edge. Reading it
    // as covered is how a hedge that was never placed becomes a loss.
    const result = await executor([
      adapter("SABA", "ACCEPTED"), adapter("SBOBET", "ACCEPTED"), adapter("CMD", "REJECTED")
    ]).execute({ ticket: ticket(["SABA", "SBOBET", "CMD"]), mode: "DRY_RUN", idempotencyKey: "idempotency-key-0002" });

    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(() => TwoLegExecutionResultSchema.parse(result)).not.toThrow();
  });

  it("refuses a ticket where one book holds two legs", async () => {
    // A book given two legs nets them off internally and the cover is imaginary.
    await expect(executor([adapter("SABA", "ACCEPTED"), adapter("SBOBET", "ACCEPTED")])
      .execute({ ticket: ticket(["SABA", "SABA", "SBOBET"]), mode: "DRY_RUN", idempotencyKey: "idempotency-key-0003" }))
      .rejects.toThrow("EXECUTION_TWO_PROVIDER_TICKET_REQUIRED");
  });

  it("still handles the two-leg ticket exactly as before", async () => {
    const result = await executor([adapter("SABA", "ACCEPTED"), adapter("SBOBET", "ACCEPTED")])
      .execute({ ticket: ticket(["SABA", "SBOBET"]), mode: "DRY_RUN", idempotencyKey: "idempotency-key-0004" });
    expect(result.legs).toHaveLength(2);
    expect(result.status).toBe("BOTH_ACCEPTED");
  });
});
