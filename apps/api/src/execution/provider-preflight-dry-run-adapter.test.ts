import type { PreflightLeg, ProviderTicketPreflight } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { ProviderPreflightDryRunAdapter } from "./provider-preflight-dry-run-adapter.js";

const leg: PreflightLeg = { accountId: "account-a", provider: "SBOBET", providerEventId: "event-a",
  providerMarketId: "market-a", providerSelectionId: "away", selection: "AWAY", line: "-0.5",
  decimalOdds: "1.93", stake: "50000", currency: "VND", balance: "100000",
  balanceAsOfMs: 1000, quoteAsOfMs: 1000 };

function result(overrides: Partial<ProviderTicketPreflight> = {}): ProviderTicketPreflight {
  return { accountId: leg.accountId, provider: leg.provider, providerEventId: leg.providerEventId,
    providerMarketId: leg.providerMarketId, providerSelectionId: leg.providerSelectionId,
    selection: leg.selection, line: leg.line, decimalOdds: leg.decimalOdds, quoteStatus: "OPEN",
    limitEvidence: { currency: "VND", minStake: "30000", maxStake: "100000", stakeStep: "1000",
      balance: "100000", verifiedAsOfMs: 1100, expiresAtMs: 3000 },
    constraint: { currency: "VND", minStake: "30000", maxStake: "100000", stakeStep: "1000",
      balance: "100000", feeType: "NONE", feeRate: null, verifiedAsOfMs: 1100, expiresAtMs: 3000 },
    eligible: true, reasons: [], ...overrides };
}

describe("provider preflight dry-run adapter", () => {
  it("revalidates the exact signed leg without submitting it", async () => {
    const calls: unknown[] = [];
    const adapter = new ProviderPreflightDryRunAdapter({ provider: "SBOBET", preflight: async (request) => {
      calls.push(request); return result();
    } });
    await expect(adapter.dryRun(leg)).resolves.toEqual({ provider: "SBOBET",
      providerSelectionId: "away", status: "ACCEPTED", reason: null });
    expect(calls).toEqual([{ accountId: "account-a", providerEventId: "event-a",
      providerMarketId: "market-a", providerSelectionId: "away", selection: "AWAY", line: "-0.5",
      expectedDecimalOdds: "1.93", requestedStake: "50000" }]);
  });

  it("maps provider evidence to fail-closed execution results", async () => {
    const cases = [
      [result({ eligible: false, reasons: ["ODDS_CHANGED"] }), "ODDS_CHANGED"],
      [result({ eligible: false, quoteStatus: "SUSPENDED", reasons: ["MARKET_NOT_OPEN"] }), "MARKET_SUSPENDED"],
      [result({ eligible: false, reasons: ["STAKE_STEP_MISMATCH"] }), "LIMIT_CHANGED"],
      [result({ eligible: false, reasons: ["INSUFFICIENT_BALANCE"] }), "INSUFFICIENT_BALANCE"],
      [result({ eligible: false, constraint: null, reasons: ["FINANCIAL_POLICY_UNAVAILABLE"] }), "ADAPTER_UNAVAILABLE"]
    ] as const;
    for (const [providerResult, reason] of cases) {
      const adapter = new ProviderPreflightDryRunAdapter({ provider: "SBOBET",
        preflight: async () => providerResult });
      const actual = await adapter.dryRun(leg);
      expect(actual.reason).toBe(reason);
      expect(actual.status).toBe(reason === "ADAPTER_UNAVAILABLE" ? "UNKNOWN" : "REJECTED");
    }
  });
});
