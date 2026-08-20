import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { CmdTicketPreflightReader } from "./cmd-ticket-preflight-reader.js";

const handle: ActiveSecretHandle = { sessionId: "cmd", provider: "CMD", category: "FOOTBALL",
  withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://private.invalid/secret" }) };

describe("CmdTicketPreflightReader", () => {
  it("reads the current CMD source and returns the exact direct quote evidence", async () => {
    const reader = new CmdTicketPreflightReader({ source: { readCatalogFromFabet: async () => ({
      observedAtMs: 2_000, receivedMonotonicMs: 20, records: [{ sportId: "1", leagueId: "league",
        leagueName: "League", matchId: "event", timeText: "1H27'", teamNames: ["Alpha", "Beta"], groups: [{
          betTypeIds: ["3"], labels: ["2.5"], odds: [
            { marketOddsId: "market", priceText: "0.36", status: null, greyedOut: null },
            { marketOddsId: "market", priceText: "-0.17", status: null, greyedOut: null }
          ]
        }] }]
    }) } });

    await expect(reader.preflight(handle, { accountId: "catalog-source:CMD:FOOTBALL", providerEventId: "event",
      providerMarketId: "market", providerSelectionId: "market:over", selection: "OVER", line: "2.5",
      expectedDecimalOdds: "1.17", requestedStake: "500000" })).resolves.toMatchObject({
      provider: "CMD", rawOdds: "0.36", rawFormat: "MALAY", decimalOdds: "1.36", quoteStatus: "OPEN",
      providerObservedAtMs: 2_000, receivedMonotonicMs: 20, sequence: 1,
      limitEvidence: null, constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE", "ODDS_CHANGED"]
    });
  });
});
