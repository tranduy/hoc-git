import type { AccountStatus, ProviderId, ProviderTicketPreflight, ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import type { ActiveSecretHandle } from "../sessions/types.js";
import { ProviderPreflightRegistry } from "./provider-preflight-registry.js";

const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "2.2", requestedStake: "100000" };
const result: ProviderTicketPreflight = { accountId: "account-1", provider: "SABA", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-1", selection: "HOME", line: "-0.5",
  rawOdds: "1.2", rawFormat: "HK", decimalOdds: "2.2", quoteStatus: "OPEN",
  providerObservedAtMs: 1_100, receivedMonotonicMs: 100, sequence: 1,
  limitEvidence: { currency: "VND", minStake: "50000",
    maxStake: "200000", stakeStep: "1000", balance: "300000", verifiedAsOfMs: 1000, expiresAtMs: 3000 },
  constraint: { currency: "VND", minStake: "50000",
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
  it("resolves a synthetic catalog source through the current catalog session", async () => {
    const catalogRequest = { ...request, accountId: "catalog-source:SABA:FOOTBALL" };
    let currentSourceHandleCalls = 0;
    const currentSourceHandle = async <T>(_id: string, _provider: ProviderId,
      consume: (handle: ActiveSecretHandle) => Promise<T>): Promise<T> => {
      currentSourceHandleCalls += 1;
      return consume({ sessionId: "latest-saba", provider: "SABA", category: "FOOTBALL",
        withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://current.test/" }) });
    };
    const service = new ProviderPreflightRegistry({
      accounts: { listStatuses: async () => [account],
        withActiveHandle: async () => { throw new Error("old account must not be used"); } },
      sources: { listStatuses: async () => [{ id: catalogRequest.accountId, provider: "SABA" as const,
        sessionState: "ACTIVE" as const }], withActiveHandle: currentSourceHandle },
      readers: [{ provider: "SABA", capabilities: ["PREFLIGHT"],
        preflight: async (_handle, input) => ({ ...result, accountId: input.accountId }) }]
    });

    await expect(service.preflight(catalogRequest)).resolves.toMatchObject({
      accountId: catalogRequest.accountId, providerSelectionId: "selection-1", selection: "HOME", line: "-0.5"
    });
    expect(currentSourceHandleCalls).toBe(1);
  });

  it("returns strict evidence bound to the requested account and ticket", async () => {
    await expect(registry().preflight(request)).resolves.toEqual(result);
  });

  it("coalesces concurrent checks of the same exact account ticket", async () => {
    let release!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const service = registry(async () => {
      calls += 1;
      await gate;
      return result;
    });

    const first = service.preflight(request);
    const second = service.preflight(request);
    await vi.waitFor(() => expect(calls).toBe(1));
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([result, result]);
    expect(calls).toBe(1);
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
