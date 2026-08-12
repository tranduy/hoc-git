import type { ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { SbobetTicketPreflightReader } from "./sbobet-ticket-preflight-reader.js";

const snapshot = { observedAtMs: 1000, receivedMonotonicMs: 10, records: [{ eventId: "event-1",
  leagueName: "League", timeText: "Live", scoreText: "0 - 0", teamNames: ["Alpha", "Beta"], markets: [{
    marketId: "market-1", marketType: "FT_AH" as const, lineText: "-0.5", selections: [
      { selectionId: "home-1h", selection: "HOME" as const, priceText: "0.82", locked: false, lineText: "-0.5" },
      { selectionId: "away-1a", selection: "AWAY" as const, priceText: "-0.92", locked: false, lineText: null }
    ]
  }]}] };
const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "home-1h", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "1.82", requestedStake: "50000" };
const handle = { sessionId: "session-1", provider: "SBOBET", category: "FOOTBALL" as const,
  withSecret: async <T>(consume: (secret: { kind: "LAUNCH_URL"; value: string }) => Promise<T>) =>
    consume({ kind: "LAUNCH_URL", value: "https://private.test/" }) };

describe("SbobetTicketPreflightReader", () => {
  it("revalidates exact identity and stays blocked without exact slip limits", async () => {
    const reader = new SbobetTicketPreflightReader({ source: { readCatalog: async () => snapshot }, fee: { type: "NONE" } });
    await expect(reader.preflight(handle, request)).resolves.toMatchObject({ provider: "SBOBET",
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "home-1h",
      decimalOdds: "1.82", constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE"] });
    await expect(reader.preflight(handle, { ...request, providerSelectionId: "other" }))
      .rejects.toThrow("PREFLIGHT_IDENTITY_MISMATCH");
  });

  it("uses a short-lived exact constraint and reports insufficient balance", async () => {
    const reader = new SbobetTicketPreflightReader({ source: { readCatalog: async () => snapshot,
      readTicketConstraint: async () => ({ providerSelectionId: "home-1h", currency: "VND", minStake: "50000",
        maxStake: "329868000", stakeStep: "1000", balance: "29000", observedAtMs: 2000 })
    }, clock: { nowMs: () => 2000 }, fee: { type: "PROFIT", rate: "0.01" } });
    await expect(reader.preflight(handle, request)).resolves.toMatchObject({
      constraint: { minStake: "50000", balance: "29000", feeType: "PROFIT", feeRate: "0.01",
        expiresAtMs: 5000 }, eligible: false,
      reasons: ["INSUFFICIENT_BALANCE"]
    });
  });
});
