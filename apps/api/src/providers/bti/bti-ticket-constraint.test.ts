import { describe, expect, it } from "vitest";
import { parseBtiTicketConstraint } from "./bti-ticket-constraint.js";

describe("BTI exact ticket constraint parser", () => {
  it("normalizes the visible K-denominated slip and balance into VND", () => {
    expect(parseBtiTicketConstraint({ providerSelectionId: "selection-1", selectionMatched: true,
      limitText: "Tối thiểu - Tối đa 25.25 - 17,669.91", stakeStepText: "0.01",
      balanceText: "29.61 K", currencyCode: "VND", observedAtMs: 1234 })).toEqual({
      providerSelectionId: "selection-1", currency: "VND", minStake: "25250", maxStake: "17669910",
      stakeStep: "10", balance: "29610", observedAtMs: 1234
    });
  });

  it.each([
    { selectionMatched: false },
    { limitText: "" },
    { stakeStepText: "any" },
    { balanceText: "unknown" },
    { currencyCode: "USD" },
    { observedAtMs: Number.NaN }
  ])("fails closed when exact slip evidence is incomplete: %o", (override) => {
    expect(parseBtiTicketConstraint({ providerSelectionId: "selection-1", selectionMatched: true,
      limitText: "Tối thiểu - Tối đa 25.25 - 17,669.91", stakeStepText: "0.01",
      balanceText: "29.61 K", currencyCode: "VND", observedAtMs: 1234, ...override })).toBeNull();
  });
});
