import { describe, expect, it } from "vitest";
import { decodeSbobetReceiptHistory } from "./sbobet-receipt-decoder.js";

function singleRow(): unknown[] {
  const row = Array.from({ length: 39 }, () => null as unknown);
  row[0] = "receipt-123"; row[1] = "2026-08-12T08:00:00Z"; row[2] = 1;
  row[3] = "Verified league"; row[4] = "Alpha vs Beta"; row[5] = "Full Time Handicap";
  row[6] = "Alpha"; row[7] = "-0.5"; row[8] = "-0.8"; row[9] = "100000";
  row[10] = "180000"; row[11] = "Unsettled"; row[12] = "Active"; row[15] = 1;
  row[18] = "2026-08-12T07:30:00Z"; row[19] = "VND"; row[25] = "MALAY";
  row[35] = "FT"; row[37] = 1;
  return row;
}

describe("SBOBET receipt history decoder", () => {
  it("decodes the provider JSON-string envelope and positional single-bet fields", () => {
    const raw = JSON.stringify(JSON.stringify({ betReportingDtos: [singleRow()], total: 1 }));

    expect(decodeSbobetReceiptHistory(raw)).toEqual({ total: 1, unsupportedCount: 0, receipts: [{
      purchaseId: "receipt-123", placementDate: "2026-08-12T08:00:00Z", sportId: "1",
      leagueName: "Verified league", eventDisplayName: "Alpha vs Beta",
      marketDisplayName: "Full Time Handicap", selectionDisplayName: "Alpha", points: "-0.5",
      displayOdds: "-0.8", totalStake: "100000", potentialReturns: "180000",
      settlementStatus: "Unsettled", status: "Active", marketTypeId: "1",
      startTime: "2026-08-12T07:30:00Z", currency: "VND", oddsStyle: "MALAY",
      timePeriod: "FT", betType: "1"
    }] });
  });

  it("fails closed for malformed envelopes, missing identity fields, and non-single bets", () => {
    expect(() => decodeSbobetReceiptHistory("not-json")).toThrow("SBOBET_RECEIPT_SCHEMA_CHANGED");
    expect(() => decodeSbobetReceiptHistory(JSON.stringify({ betReportingDtos: {}, total: 0 })))
      .toThrow("SBOBET_RECEIPT_SCHEMA_CHANGED");
    const missingIdentity = singleRow(); missingIdentity[4] = "";
    expect(() => decodeSbobetReceiptHistory({ betReportingDtos: [missingIdentity], total: 1 }))
      .toThrow("SBOBET_RECEIPT_SCHEMA_CHANGED");
    const parlay = singleRow(); parlay[37] = 2;
    expect(decodeSbobetReceiptHistory({ betReportingDtos: [parlay], total: 1 }))
      .toEqual({ total: 1, unsupportedCount: 1, receipts: [] });
  });

  it("accepts an empty, internally consistent history page", () => {
    expect(decodeSbobetReceiptHistory(JSON.stringify({ betReportingDtos: [], total: 0 })))
      .toEqual({ total: 0, unsupportedCount: 0, receipts: [] });
  });
});
