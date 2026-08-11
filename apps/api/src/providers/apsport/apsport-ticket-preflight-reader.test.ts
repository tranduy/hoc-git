import type { ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { ApsportTicketPreflightReader } from "./apsport-ticket-preflight-reader.js";

const snapshot = { observedAtMs: 1000, receivedMonotonicMs: 10, records: [{ eventId: "event-1",
  leagueName: "League", timeText: "Live", scoreText: "0 - 0", teamNames: ["Alpha", "Beta"], markets: [{
    marketId: "market-1", marketType: "FT_AH" as const, lineText: "0.5", selections: [
      { selectionId: "home-1", selection: "HOME" as const, priceText: "0.82", locked: false, lineText: "-0.5" },
      { selectionId: "away-1", selection: "AWAY" as const, priceText: "-0.92", locked: false, lineText: "+0.5" }
    ]
  }]}] };
const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "home-1", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "1.82", requestedStake: "29000" };
const handle = { sessionId: "session-1", provider: "APSPORT", category: "FOOTBALL" as const,
  withSecret: async <T>(consume: (secret: { kind: "LAUNCH_URL"; value: string }) => Promise<T>) =>
    consume({ kind: "LAUNCH_URL", value: "https://private.test/" }) };

describe("ApsportTicketPreflightReader", () => {
  it("re-reads exact APSPORT identity and odds while limits are unavailable", async () => {
    const reader = new ApsportTicketPreflightReader({ source: { readCatalog: async () => snapshot } });
    await expect(reader.preflight(handle, request)).resolves.toMatchObject({ provider: "APSPORT",
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "home-1",
      decimalOdds: "1.82", quoteStatus: "OPEN", constraint: null, eligible: false,
      reasons: ["LIMIT_UNAVAILABLE"] });
  });

  it("reports changed odds and refuses a different provider selection", async () => {
    const reader = new ApsportTicketPreflightReader({ source: { readCatalog: async () => snapshot } });
    await expect(reader.preflight(handle, { ...request, expectedDecimalOdds: "1.9" })).resolves.toMatchObject({
      reasons: ["LIMIT_UNAVAILABLE", "ODDS_CHANGED"] });
    await expect(reader.preflight(handle, { ...request, providerSelectionId: "other" }))
      .rejects.toThrow("PREFLIGHT_IDENTITY_MISMATCH");
  });
});
