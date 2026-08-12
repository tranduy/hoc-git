import type { ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { SabaTicketPreflightReader } from "./saba-ticket-preflight-reader.js";

const handle = { sessionId: "saba-session", provider: "SABA" as const, category: "FOOTBALL" as const,
  withSecret: async <T>(consume: (secret: { kind: "LAUNCH_URL"; value: string }) => Promise<T>) =>
    consume({ kind: "LAUNCH_URL", value: "https://sports.test/launch" }) };
const request: ProviderTicketPreflightRequest = { accountId: "account", providerEventId: "event",
  providerMarketId: "market", providerSelectionId: "market:home", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "1.94", requestedStake: "100000" };
const records = [{ sportId: "1" as const, leagueId: "league", leagueName: "League", matchId: "event",
  timeText: "1H27'", teamNames: ["Home", "Away"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
    { marketOddsId: "market", priceText: "0.94", status: null, greyedOut: null, lineText: "0.5" },
    { marketOddsId: "market", priceText: "-0.99", status: null, greyedOut: null, lineText: null }
  ] }] }];

describe("SabaTicketPreflightReader", () => {
  it("revalidates the exact native ticket and blocks a stake above the live balance", async () => {
    const reader = new SabaTicketPreflightReader({ source: { readCatalog: async () => records,
      readTicketConstraint: async () => ({ providerSelectionId: "market:home", rawOdds: "0.94", currency: "INH",
        minStake: "30", maxStake: "54945", stakeStep: "1", balance: "29.61", observedAtMs: 1000 }) },
    clock: { nowMs: () => 1000, monotonicNowMs: () => 500 }, fee: { type: "NONE" } });
    await expect(reader.preflight(handle, request)).resolves.toMatchObject({ provider: "SABA", decimalOdds: "1.94",
      limitEvidence: { currency: "VND", minStake: "30000", maxStake: "54945000", stakeStep: "1000", balance: "29610" },
      constraint: { currency: "VND", minStake: "30000", maxStake: "54945000", stakeStep: "1000", balance: "29610" },
      eligible: false, reasons: ["INSUFFICIENT_BALANCE"] });
  });

  it("fails closed on exact identity mismatch or missing ticket limits", async () => {
    const reader = new SabaTicketPreflightReader({ source: { readCatalog: async () => records },
      clock: { nowMs: () => 1000, monotonicNowMs: () => 500 }, fee: { type: "NONE" } });
    await expect(reader.preflight(handle, { ...request, providerSelectionId: "other" }))
      .rejects.toThrow("PREFLIGHT_IDENTITY_MISMATCH");
    await expect(reader.preflight(handle, request)).resolves.toMatchObject({ limitEvidence: null, constraint: null,
      eligible: false, reasons: ["LIMIT_UNAVAILABLE"] });
  });

  it("does not invent a fee-free constraint when no provider fee policy is configured", async () => {
    const reader = new SabaTicketPreflightReader({ source: { readCatalog: async () => records,
      readTicketConstraint: async () => ({ providerSelectionId: "market:home", rawOdds: "0.94", currency: "INH",
        minStake: "30", maxStake: "54945", stakeStep: "1", balance: "200", observedAtMs: 1000 }) },
    clock: { nowMs: () => 1000, monotonicNowMs: () => 500 } });

    await expect(reader.preflight(handle, request)).resolves.toMatchObject({
      limitEvidence: { currency: "VND", minStake: "30000", maxStake: "54945000", stakeStep: "1000", balance: "200000" },
      constraint: null, eligible: false,
      reasons: ["FINANCIAL_POLICY_UNAVAILABLE"] });
  });
});
