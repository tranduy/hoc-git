import { describe, expect, it } from "vitest";
import { parseSbobetTicketConstraint } from "./sbobet-ticket-constraint.js";

describe("SBOBET exact ticket constraint parser", () => {
  it("normalizes K-denominated exact slip evidence", () => {
    expect(parseSbobetTicketConstraint({ providerSelectionId: "selection-1", selectionMatched: true,
      limitText: "Mức cược tối thiểu 50 K\nMức cược tối đa 329,868 K", stakeStepText: "1",
      balanceText: "29 K", observedAtMs: 1000 })).toEqual({ providerSelectionId: "selection-1", currency: "VND",
      minStake: "50000", maxStake: "329868000", stakeStep: "1000", balance: "29000", observedAtMs: 1000 });
  });

  it.each([{ selectionMatched: false }, { limitText: "" }, { stakeStepText: "" }, { balanceText: "" }])
  ("fails closed for incomplete evidence: %o", (override) => {
    expect(parseSbobetTicketConstraint({ providerSelectionId: "selection-1", selectionMatched: true,
      limitText: "Mức cược tối thiểu 50 K\nMức cược tối đa 329,868 K", stakeStepText: "1",
      balanceText: "29 K", observedAtMs: 1000, ...override })).toBeNull();
  });
});
