import { describe, expect, it } from "vitest";
import { ProviderQuoteSchema } from "./schemas.js";

describe("ProviderQuoteSchema", () => {
  it("accepts a complete quote", () => {
    const result = ProviderQuoteSchema.safeParse({
      provider: "SABA",
      category: "LOL",
      providerEventId: "event-1",
      providerMarketId: "market-1",
      providerSelectionId: "selection-1",
      marketType: "MAP_WINNER",
      scope: "MAP_3",
      selection: "navi",
      line: null,
      rawOdds: "1.26",
      rawFormat: "HK",
      status: "OPEN",
      isLive: true,
      sourceTimestampMs: 1000,
      receivedMonotonicMs: 1100,
      sequence: 7
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = ProviderQuoteSchema.safeParse({
      provider: "SABA",
      category: "TENNIS"
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown critical fields", () => {
    const result = ProviderQuoteSchema.safeParse({
      provider: "SABA",
      category: "LOL",
      providerEventId: "event-1",
      providerMarketId: "market-1",
      providerSelectionId: "selection-1",
      marketType: "MAP_WINNER",
      scope: "MAP_3",
      selection: "navi",
      line: null,
      rawOdds: "1.26",
      rawFormat: "HK",
      status: "OPEN",
      isLive: true,
      sourceTimestampMs: 1000,
      receivedMonotonicMs: 1100,
      sequence: 7,
      decimalOdds: "2.26"
    });
    expect(result.success).toBe(false);
  });
});
