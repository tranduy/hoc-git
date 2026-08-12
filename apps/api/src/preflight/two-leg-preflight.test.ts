import type { Opportunity, ProviderId, ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { TwoLegPreflight } from "./two-leg-preflight.js";

const opportunity = {
  opportunityId: "opp-1", canonicalEventId: "event-1", canonicalMarketId: "market-1",
  category: "FOOTBALL", marketType: "FT_AH", scope: "FULL_TIME", line: "0.5",
  settlementProfile: "FT_AH", baseCurrency: "VND", totalStakeBase: "180000",
  inverseSum: "0.9", netMargin: "0.1111111111", worstCaseProfit: "20000", roi: "0.1111111111",
  quoteAgeMs: 20, mappingEvidence: [], executionConfidence: "HIGH",
  legs: [
    { provider: "SBOBET", providerEventId: "sb-event", providerMarketId: "sb-market",
      providerSelectionId: "sb-home", selection: "HOME", rawOdds: "1", rawFormat: "MALAY",
      decimalOdds: "2", effectiveDecimal: "2", stake: "100000", stakeCurrency: "VND",
      baseCurrency: "VND", stakeBase: "100000", minStake: "50000", maxStake: "500000",
      payout: "200000", feeType: "NONE", feeRate: null, fxRate: "1", fxSpreadRate: "0",
      fxAsOfMs: 900, quoteAgeMs: 20, quoteStatus: "OPEN", sourceTimestampMs: 980,
      receivedMonotonicMs: 980, sequence: 1, eligible: true, ineligibleReasons: [] },
    { provider: "APSPORT", providerEventId: "ap-event", providerMarketId: "ap-market",
      providerSelectionId: "ap-away", selection: "AWAY", rawOdds: "2.5", rawFormat: "DECIMAL",
      decimalOdds: "2.5", effectiveDecimal: "2.5", stake: "80000", stakeCurrency: "VND",
      baseCurrency: "VND", stakeBase: "80000", minStake: "10000", maxStake: "500000",
      payout: "200000", feeType: "NONE", feeRate: null, fxRate: "1", fxSpreadRate: "0",
      fxAsOfMs: 900, quoteAgeMs: 20, quoteStatus: "OPEN", sourceTimestampMs: 980,
      receivedMonotonicMs: 980, sequence: 1, eligible: true, ineligibleReasons: [] }
  ]
} as const satisfies Opportunity;

function result(request: ProviderTicketPreflightRequest, provider: ProviderId,
  overrides: Partial<ProviderTicketPreflight> = {}): ProviderTicketPreflight {
  const limitEvidence = { currency: "VND", minStake: "10000", maxStake: "500000", stakeStep: "1000",
    balance: "500000", verifiedAsOfMs: 1000, expiresAtMs: 3000 };
  return { ...request, provider, decimalOdds: request.expectedDecimalOdds, quoteStatus: "OPEN",
    limitEvidence, constraint: { ...limitEvidence, feeType: "NONE", feeRate: null },
    eligible: true, reasons: [], ...overrides };
}

describe("TwoLegPreflight", () => {
  it("maps reversed accounts to providers, preflights concurrently, and issues a three-second ticket", async () => {
    const waiting: Array<() => void> = [];
    const preflight = vi.fn(async (request: ProviderTicketPreflightRequest) => {
      await new Promise<void>((resolve) => waiting.push(resolve));
      return result(request, request.accountId === "sb-account" ? "SBOBET" : "APSPORT");
    });
    const service = new TwoLegPreflight({
      opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async (id) => id === "sb-account" ? "SBOBET" : "APSPORT", preflight },
      clock: { nowMs: () => 1500 }, idFactory: () => "ticket-1", nonceFactory: () => "nonce-1234567890123456",
      signer: () => "signature-1234567890123456"
    });

    const pending = service.preflight({ opportunityId: "opp-1", accountAId: "ap-account",
      accountBId: "sb-account", maxOddsDriftBps: 25 });
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    waiting.splice(0).forEach((release) => release());

    await expect(pending).resolves.toMatchObject({ ticketId: "ticket-1", opportunityId: "opp-1",
      totalStakeBase: "180000", worstCaseProfit: "20000", issuedAtMs: 1500, expiresAtMs: 3000,
      legs: [{ accountId: "sb-account", provider: "SBOBET", stake: "100000" },
        { accountId: "ap-account", provider: "APSPORT", stake: "80000" }] });
    expect(preflight).toHaveBeenCalledTimes(2);
  });

  it("verifies its own signed ticket and rejects any mutated execution field", async () => {
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async (id) => id === "sb" ? "SBOBET" : "APSPORT",
        preflight: async (request) => result(request, request.accountId === "sb" ? "SBOBET" : "APSPORT") },
      clock: { nowMs: () => 1500 } });
    const issued = await service.preflight({ opportunityId: "opp-1", accountAId: "sb", accountBId: "ap",
      maxOddsDriftBps: 25 });

    expect(service.verifyTicket(issued)).toBe(true);
    expect(service.verifyTicket({ ...issued, legs: [{ ...issued.legs[0], stake: "200000" }, issued.legs[1]] }))
      .toBe(false);
    const replacement = issued.signature.endsWith("0") ? "1" : "0";
    expect(service.verifyTicket({ ...issued, signature: `${issued.signature.slice(0, -1)}${replacement}` })).toBe(false);
  });

  it("fails before opening slips when accounts do not cover two distinct leg providers", async () => {
    const preflight = vi.fn();
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async () => "SBOBET", preflight }, clock: { nowMs: () => 1500 } });
    await expect(service.preflight({ opportunityId: "opp-1", accountAId: "one", accountBId: "two",
      maxOddsDriftBps: 25 })).rejects.toThrow("PREFLIGHT_PROVIDER_COVERAGE_MISMATCH");
    expect(preflight).not.toHaveBeenCalled();
  });

  it("fails closed when a leg drifts beyond the requested threshold", async () => {
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async (id) => id === "sb" ? "SBOBET" : "APSPORT",
        preflight: async (request) => request.accountId === "sb"
          ? result(request, "SBOBET", { decimalOdds: "1.99", eligible: false, reasons: ["ODDS_CHANGED"] })
          : result(request, "APSPORT") }, clock: { nowMs: () => 1500 } });
    await expect(service.preflight({ opportunityId: "opp-1", accountAId: "sb", accountBId: "ap",
      maxOddsDriftBps: 25 })).rejects.toThrow("PREFLIGHT_ODDS_DRIFT");
  });

  it("fails closed when either verified constraint expires before the decision", async () => {
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async (id) => id === "sb" ? "SBOBET" : "APSPORT",
        preflight: async (request) => result(request, request.accountId === "sb" ? "SBOBET" : "APSPORT") },
      clock: { nowMs: () => 3000 } });
    await expect(service.preflight({ opportunityId: "opp-1", accountAId: "sb", accountBId: "ap",
      maxOddsDriftBps: 25 })).rejects.toThrow("PREFLIGHT_EXPIRED");
  });

  it.each([
    ["minimum", { minStake: "110000" }],
    ["maximum", { maxStake: "99000" }],
    ["balance", { balance: "99000" }],
    ["stake step", { stakeStep: "3000" }]
  ])("independently rejects a provider claiming eligible despite an invalid %s constraint", async (_label, override) => {
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async (id) => id === "sb" ? "SBOBET" : "APSPORT",
        preflight: async (request) => request.accountId === "sb"
          ? result(request, "SBOBET", { constraint: { ...result(request, "SBOBET").constraint!, ...override } })
          : result(request, "APSPORT") }, clock: { nowMs: () => 1500 } });

    await expect(service.preflight({ opportunityId: "opp-1", accountAId: "sb", accountBId: "ap",
      maxOddsDriftBps: 25 })).rejects.toThrow("PREFLIGHT_LEG_UNAVAILABLE");
  });

  it("fails closed when the opportunity disappears while both slips are being checked", async () => {
    let reads = 0;
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () =>
      ({ opportunities: reads++ === 0 ? [opportunity] : [] }) },
    providers: { providerForAccount: async (id) => id === "sb" ? "SBOBET" : "APSPORT",
      preflight: async (request) => result(request, request.accountId === "sb" ? "SBOBET" : "APSPORT") },
    clock: { nowMs: () => 1500 } });
    await expect(service.preflight({ opportunityId: "opp-1", accountAId: "sb", accountBId: "ap",
      maxOddsDriftBps: 25 })).rejects.toThrow("PREFLIGHT_OPPORTUNITY_CHANGED");
  });

  it("rejects an allowed odds drift when it erodes the promised worst-case profit", async () => {
    const service = new TwoLegPreflight({ opportunities: { getSnapshot: () => ({ opportunities: [opportunity] }) },
      providers: { providerForAccount: async (id) => id === "sb" ? "SBOBET" : "APSPORT",
        preflight: async (request) => request.accountId === "sb"
          ? result(request, "SBOBET", { decimalOdds: "1.999", eligible: false, reasons: ["ODDS_CHANGED"] })
          : result(request, "APSPORT") }, clock: { nowMs: () => 1500 } });
    await expect(service.preflight({ opportunityId: "opp-1", accountAId: "sb", accountBId: "ap",
      maxOddsDriftBps: 10 })).rejects.toThrow("PREFLIGHT_PROFIT_BELOW_SIGNAL");
  });
});
