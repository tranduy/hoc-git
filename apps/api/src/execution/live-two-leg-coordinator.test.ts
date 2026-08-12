import type { PreflightTicket } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { LiveTwoLegCoordinator, type LiveExecutionAdapter, type PreparedLiveLeg } from "./live-two-leg-coordinator.js";

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

function prepared(provider: "SABA" | "SBOBET", selectionId: string, accepted = true): PreparedLiveLeg {
  return { provider, providerSelectionId: selectionId, cancel: vi.fn(async () => {}),
    commit: vi.fn(async () => accepted
      ? { provider, providerSelectionId: selectionId, status: "ACCEPTED" as const, receiptId: `${provider}-receipt` }
      : { provider, providerSelectionId: selectionId, status: "REJECTED" as const, receiptId: null,
        reason: "PROVIDER_REJECTED" as const }) };
}

function adapter(provider: "SABA" | "SBOBET", value: PreparedLiveLeg): LiveExecutionAdapter {
  return { provider, prepare: vi.fn(async () => value) };
}

describe("LiveTwoLegCoordinator", () => {
  it("prepares both legs before either commit starts", async () => {
    const first = prepared("SABA", "sa"); const second = prepared("SBOBET", "sb");
    let releaseSecond!: () => void;
    const secondReady = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const secondAdapter: LiveExecutionAdapter = { provider: "SBOBET", prepare: async () => {
      await secondReady; return second;
    } };
    const service = new LiveTwoLegCoordinator({ adapters: [adapter("SABA", first), secondAdapter],
      verifyTicket: () => true, consumeArm: () => true, clock: { nowMs: () => 2000 },
      tripKillSwitch: vi.fn() });
    const operation = service.execute({ ticket, armToken: "arm-token-123456" });
    await Promise.resolve();
    expect(first.commit).not.toHaveBeenCalled();
    releaseSecond();
    await expect(operation).resolves.toMatchObject({ status: "BOTH_ACCEPTED" });
    expect(first.commit).toHaveBeenCalledOnce(); expect(second.commit).toHaveBeenCalledOnce();
  });

  it("cancels a prepared sibling and submits neither leg when prepare fails", async () => {
    const first = prepared("SABA", "sa");
    const service = new LiveTwoLegCoordinator({ adapters: [adapter("SABA", first),
      { provider: "SBOBET", prepare: async () => { throw new Error("suspended"); } }],
      verifyTicket: () => true, consumeArm: () => true, clock: { nowMs: () => 2000 },
      tripKillSwitch: vi.fn() });
    await expect(service.execute({ ticket, armToken: "arm-token-123456" })).resolves
      .toMatchObject({ status: "NOT_SUBMITTED" });
    expect(first.cancel).toHaveBeenCalledOnce(); expect(first.commit).not.toHaveBeenCalled();
  });

  it("trips the kill switch exactly once on a one-leg result and never retries", async () => {
    const first = prepared("SABA", "sa"); const second = prepared("SBOBET", "sb", false);
    const trip = vi.fn();
    const service = new LiveTwoLegCoordinator({ adapters: [adapter("SABA", first), adapter("SBOBET", second)],
      verifyTicket: () => true, consumeArm: () => true, clock: { nowMs: () => 2000 }, tripKillSwitch: trip });
    await expect(service.execute({ ticket, armToken: "arm-token-123456" })).resolves
      .toMatchObject({ status: "PARTIAL_FAILURE" });
    expect(trip).toHaveBeenCalledOnce();
    expect(first.commit).toHaveBeenCalledOnce(); expect(second.commit).toHaveBeenCalledOnce();
  });

  it("marks a commit timeout unknown and trips the kill switch instead of hanging or retrying", async () => {
    const first = prepared("SABA", "sa");
    const hanging = prepared("SBOBET", "sb");
    hanging.commit = vi.fn(async () => new Promise<never>(() => {}));
    const trip = vi.fn();
    const service = new LiveTwoLegCoordinator({ adapters: [adapter("SABA", first), adapter("SBOBET", hanging)],
      verifyTicket: () => true, consumeArm: () => true, clock: { nowMs: () => 2000 },
      timeoutMs: 5, tripKillSwitch: trip });
    const actual = await Promise.race([service.execute({ ticket, armToken: "arm-token-123456" }),
      new Promise<"NO_TIMEOUT">((resolve) => setTimeout(() => resolve("NO_TIMEOUT"), 30))]);
    expect(actual).not.toBe("NO_TIMEOUT");
    expect(actual).toMatchObject({ status: "PARTIAL_FAILURE", legs: [
      { status: "ACCEPTED" }, { status: "UNKNOWN", reason: "TIMEOUT" }
    ] });
    expect(trip).toHaveBeenCalledOnce(); expect(hanging.commit).toHaveBeenCalledOnce();
  });

  it("rejects an invalid one-time arm before touching providers", async () => {
    const first = prepared("SABA", "sa"); const prepare = vi.fn(async () => first);
    const service = new LiveTwoLegCoordinator({ adapters: [{ provider: "SABA", prepare },
      adapter("SBOBET", prepared("SBOBET", "sb"))], verifyTicket: () => true,
      consumeArm: () => false, clock: { nowMs: () => 2000 }, tripKillSwitch: vi.fn() });
    await expect(service.execute({ ticket, armToken: "bad-arm-token-123" })).rejects.toThrow("LIVE_ARM_INVALID");
    expect(prepare).not.toHaveBeenCalled();
  });
});
