import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { ImFootballTicketPreflightReader } from "./im-football-ticket-preflight-reader.js";

const handle: ActiveSecretHandle = { sessionId: "im", provider: "IM", category: "FOOTBALL",
  withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://private.invalid/secret" }) };

describe("ImFootballTicketPreflightReader", () => {
  it("reads the current IM source and returns the exact direct quote evidence", async () => {
    const reader = new ImFootballTicketPreflightReader({ source: { readCatalogFromFabet: async () => ({
      observedAtMs: 3_000, receivedMonotonicMs: 30, records: [{ eventId: "event", leagueName: "League",
        timeText: "PREMATCH", scoreText: null, startAtUtcMs: 4_000, teamNames: ["Alpha", "Beta"], markets: [{
          marketId: "market", marketType: "FT_AH", lineText: null, selections: [
            { selectionId: "home", selection: "HOME", priceText: "0.8", locked: false, lineText: "-0.5" },
            { selectionId: "away", selection: "AWAY", priceText: "-0.9", locked: false, lineText: "+0.5" }
          ]
        }] }]
    }) } });

    await expect(reader.preflight(handle, { accountId: "catalog-source:IM:FOOTBALL", providerEventId: "event",
      providerMarketId: "market", providerSelectionId: "home", selection: "HOME", line: "-0.5",
      expectedDecimalOdds: "1.7", requestedStake: "500000" })).resolves.toMatchObject({
      provider: "IM", rawOdds: "0.8", rawFormat: "MALAY", decimalOdds: "1.8", quoteStatus: "OPEN",
      providerObservedAtMs: 3_000, receivedMonotonicMs: 30, sequence: 1,
      limitEvidence: null, constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE", "ODDS_CHANGED"]
    });
  });
});
