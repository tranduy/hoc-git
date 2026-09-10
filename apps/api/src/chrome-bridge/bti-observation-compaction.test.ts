import { describe, expect, it } from "vitest";
import type { NativeMarketObservation } from "@tool-chenh/contracts";
import { compactBtiNativeObservation } from "./bti-http-adapter.js";

function observation(disposition: NativeMarketObservation["disposition"]): NativeMarketObservation {
  return {
    provider: "BTI",
    category: "FOOTBALL",
    providerEventId: "event",
    providerMarketId: "market",
    nativeType: "QA1",
    nativeLabel: "Full-time total",
    nativeScope: "FULL_TIME",
    outcomeLabels: ["Over", "Under"],
    nativeRow: "raw row",
    nativeSelections: [{ selectionId: "over", outcomeId: "OVER", line: "2.5", price: "1.95" }],
    observedAtMs: 100,
    disposition,
    reason: disposition === "NORMALIZED" ? "NORMALIZED" : "UNSUPPORTED_NATIVE_TYPE"
  };
}

describe("BTI normalized observation compaction", () => {
  it("keeps canonical identity and coverage while releasing duplicated selection payloads", () => {
    expect(compactBtiNativeObservation(observation("NORMALIZED"))).toEqual({
      provider: "BTI",
      category: "FOOTBALL",
      providerEventId: "event",
      providerMarketId: "market",
      nativeType: "QA1",
      nativeLabel: null,
      nativeScope: "FULL_TIME",
      outcomeLabels: [],
      observedAtMs: 100,
      disposition: "NORMALIZED",
      reason: "NORMALIZED"
    });
  });

  it("retains complete evidence for a market that still needs normalization", () => {
    const unmapped = observation("UNMAPPED");
    expect(compactBtiNativeObservation(unmapped)).toBe(unmapped);
    expect(unmapped.nativeSelections).toHaveLength(1);
  });
});
