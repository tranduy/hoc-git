import { describe, expect, it } from "vitest";
import type { ActiveSecretHandle } from "../../sessions/types.js";
import { ImFootballTicketPreflightReader } from "./im-football-ticket-preflight-reader.js";
import { extractImFootballCatalog } from "./im-football-catalog-source.js";

const handle: ActiveSecretHandle = { sessionId: "im", provider: "IM", category: "FOOTBALL",
  withSecret: async (consume) => consume({ kind: "LAUNCH_URL", value: "https://private.invalid/secret" }) };

describe("ImFootballTicketPreflightReader", () => {
  it.each([
    [3, "DECIMAL", "2.15"], [2, "HK", "3.15"]
  ] as const)("preserves native format %s from extraction through preflight", async (ot, rawFormat, decimalOdds) => {
    const records = extractImFootballCatalog({ StatusCode: 100, sel: [{ eid: 100, htn: "Alpha", atn: "Beta",
      cn: "League", edt: "2026-09-10T12:00:00Z", isrbt: false, iscyb: false,
      mls: [{ mi: 200, bti: 2, gp: 1, il: false, ws: [
        { wsi: 301, si: 3, hdp: 2.5, dih: "2.5", o: 2.15, ot },
        { wsi: 302, si: 4, hdp: 2.5, dih: "2.5", o: 1.95, ot }
      ] }] }] });
    const reader = new ImFootballTicketPreflightReader({ source: { readCatalogFromFabet: async () => ({
      observedAtMs: 3000, receivedMonotonicMs: 30, records
    }) } });
    await expect(reader.preflight(handle, { accountId: "catalog-source:IM:FOOTBALL", providerEventId: "100",
      providerMarketId: "200", providerSelectionId: "301", selection: "OVER", line: "2.5",
      expectedDecimalOdds: decimalOdds, requestedStake: "500000" })).resolves.toMatchObject({
      rawOdds: "2.15", rawFormat, decimalOdds, quoteStatus: "OPEN", eligible: false,
      reasons: ["LIMIT_UNAVAILABLE"], providerObservedAtMs: 3000, receivedMonotonicMs: 30
    });
  });
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
