import type { AccountStatus, ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { ProviderPreflightRegistry } from "./provider-preflight-registry.js";

const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "2.2", requestedStake: "100000" };
const result: ProviderTicketPreflight = { accountId: "account-1", provider: "SABA", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  decimalOdds: "2.2", quoteStatus: "OPEN", constraint: { currency: "VND", minStake: "50000",
    maxStake: "200000", stakeStep: "1000", balance: "300000", feeType: "NONE", feeRate: null,
    verifiedAsOfMs: 1000, expiresAtMs: 3000 }, eligible: true, reasons: [] };
const account: AccountStatus = { id: "account-1", alias: "SABA", provider: "SABA", category: "FOOTBALL",
  sessionState: "ACTIVE", profileState: "FRESH", redactedLabel: "••••0001", currency: "VND", balance: "300000",
  balanceAsOfMs: 1000, capabilities: ["PROFILE", "CATALOG", "PREFLIGHT"], reason: null };

function registry(preflight = async (): Promise<ProviderTicketPreflight> => result,
  accounts: readonly AccountStatus[] = [account]): ProviderPreflightRegistry {
  return new ProviderPreflightRegistry({ accounts: { listStatuses: async () => accounts,
    withActiveHandle: async (_id, _provider, consume) => consume({ sessionId: "session-1", provider: "SABA",
      category: "FOOTBALL", withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://private.test/" }) }) },
  readers: [{ provider: "SABA", capabilities: ["PROFILE", "CATALOG", "PREFLIGHT"], preflight }] });
}

describe("ProviderPreflightRegistry", () => {
  it("returns strict evidence bound to the requested account and ticket", async () => {
    await expect(registry().preflight(request)).resolves.toEqual(result);
  });

  it.each([
    ["event", { ...result, providerEventId: "other" }],
    ["market", { ...result, providerMarketId: "other" }],
    ["selection id", { ...result, providerSelectionId: "other" }],
    ["selection semantic", { ...result, selection: "AWAY" }],
    ["line", { ...result, line: "0.5" }]
  ])("rejects a provider response with mismatched %s identity", async (_name, mismatched) => {
    await expect(registry(async () => mismatched as ProviderTicketPreflight).preflight(request))
      .rejects.toThrow("PREFLIGHT_IDENTITY_MISMATCH");
  });

  it("rejects unsupported and inactive accounts before touching a provider", async () => {
    await expect(new ProviderPreflightRegistry({ accounts: { listStatuses: async () => [account],
      withActiveHandle: async () => { throw new Error("must not run"); } }, readers: [] }).preflight(request))
      .rejects.toThrow("PREFLIGHT_PROVIDER_UNSUPPORTED");
    await expect(registry(undefined, [{ ...account, sessionState: "ACTION_REQUIRED" }]).preflight(request))
      .rejects.toThrow("PREFLIGHT_ACCOUNT_UNAVAILABLE");
  });
});
