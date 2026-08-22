import type { PreflightLeg } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import type { DecodedSbobetReceipt } from "./sbobet-receipt-decoder.js";
import { SbobetExecutionReceiptReader } from "./sbobet-execution-receipt-reader.js";

const leg: PreflightLeg = { accountId: "account-1", provider: "SBOBET", providerEventId: "event-1",
  providerMarketId: "market-1", providerSelectionId: "selection-home", selection: "HOME", line: "-0.5",
  decimalOdds: "2.25", stake: "100000", currency: "VND", balance: "500000",
  balanceAsOfMs: 1_000, quoteAsOfMs: 1_000 };
const record: SbobetCatalogInputRecord = { eventId: "event-1", leagueName: "League", timeText: "Live",
  scoreText: "0 - 0", teamNames: ["Alpha FC", "Beta United"], markets: [{ marketId: "market-1",
    marketType: "FT_AH", lineText: "-0.5", selections: [
      { selectionId: "selection-home", selection: "HOME", priceText: "-0.8", locked: false, lineText: "0.5" },
      { selectionId: "selection-away", selection: "AWAY", priceText: "0.7", locked: false, lineText: null }
    ] }] };
const receipt: DecodedSbobetReceipt = { purchaseId: "receipt-1", placementDate: "2026-08-12T08:00:00Z",
  sportId: "1", leagueName: "League", eventDisplayName: "Alpha FC vs Beta United",
  marketDisplayName: "Full Time Handicap", selectionDisplayName: "Alpha FC", points: "-0.5",
  displayOdds: "-0.8", totalStake: "100000", potentialReturns: "225000", settlementStatus: "Unsettled",
  status: "Active", marketTypeId: "1", startTime: "2026-08-12T07:30:00Z", currency: "VND",
  oddsStyle: "MALAY", timePeriod: "FT", betType: "1" };

function reader(receipts: readonly DecodedSbobetReceipt[]) {
  return new SbobetExecutionReceiptReader({
    accounts: { withActiveHandle: async (_id, _provider, consume) => consume({ sessionId: "session-1",
      provider: "SBOBET", category: "FOOTBALL", withSecret: async (consumeSecret) => consumeSecret({
        kind: "LAUNCH_URL", value: "https://sports.example.test/launch"
      }) }) },
    source: { readCatalog: vi.fn(async () => ({ records: [record], observedAtMs: 1, receivedMonotonicMs: 1 })),
      readReceiptHistory: vi.fn(async () => receipts) }
  });
}

describe("SBOBET execution receipt reader", () => {
  it("returns an accepted observation only for one exact catalog-backed receipt", async () => {
    await expect(reader([receipt]).lookup({ ticketId: "ticket-1", leg,
      reported: { provider: "SBOBET", providerSelectionId: "selection-home", status: "ACCEPTED", receiptId: "receipt-1" } }))
      .resolves.toEqual({ provider: "SBOBET", accountId: "account-1", providerEventId: "event-1",
        providerMarketId: "market-1", providerSelectionId: "selection-home", selection: "HOME", line: "-0.5",
        decimalOdds: "2.25", stake: "100000", currency: "VND", status: "ACCEPTED", receiptId: "receipt-1" });
  });

  it("fails closed on wrong event, side, line, odds, stake, currency, or ambiguous duplicate", async () => {
    const mutations: DecodedSbobetReceipt[] = [
      { ...receipt, eventDisplayName: "Alpha FC vs Gamma" }, { ...receipt, selectionDisplayName: "Beta United" },
      { ...receipt, points: "0.5" }, { ...receipt, displayOdds: "-0.7" },
      { ...receipt, totalStake: "90000" }, { ...receipt, currency: "USD" },
      { ...receipt, timePeriod: "", marketDisplayName: "Handicap" }
    ];
    for (const changed of mutations) {
      await expect(reader([changed]).lookup({ ticketId: "ticket-1", leg,
        reported: { provider: "SBOBET", providerSelectionId: "selection-home", status: "UNKNOWN", receiptId: null,
          reason: "TIMEOUT" } })).resolves.toBeNull();
    }
    await expect(reader([receipt, { ...receipt, purchaseId: "receipt-2" }]).lookup({ ticketId: "ticket-1", leg,
      reported: { provider: "SBOBET", providerSelectionId: "selection-home", status: "UNKNOWN", receiptId: null,
        reason: "TIMEOUT" } })).resolves.toBeNull();
  });

  it("maps provider pending and declined states without inventing acceptance", async () => {
    await expect(reader([{ ...receipt, status: "Pending", settlementStatus: "" }]).lookup({ ticketId: "ticket-1", leg,
      reported: { provider: "SBOBET", providerSelectionId: "selection-home", status: "UNKNOWN", receiptId: null,
        reason: "TIMEOUT" } })).resolves.toMatchObject({ status: "PENDING", receiptId: "receipt-1" });
    await expect(reader([{ ...receipt, status: "Declined", settlementStatus: "" }]).lookup({ ticketId: "ticket-1", leg,
      reported: { provider: "SBOBET", providerSelectionId: "selection-home", status: "REJECTED", receiptId: null,
        reason: "PROVIDER_REJECTED" } })).resolves.toMatchObject({ status: "REJECTED", receiptId: null });
  });
});
