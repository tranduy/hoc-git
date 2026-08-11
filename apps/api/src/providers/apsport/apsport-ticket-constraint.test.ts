import { describe, expect, it } from "vitest";
import { parseApsportTicketConstraint } from "./apsport-ticket-constraint.js";

describe("APSPORT ticket constraint parser", () => {
  it("normalizes exact K-denominated slip limits", () => {
    expect(parseApsportTicketConstraint({ providerSelectionId: "s1", selectionMatched: true,
      limitText: "Tối thiểu - Tối đa 50 - 352,359 K", stakeStepText: "1", balanceText: "29 K",
      observedAtMs: 1000 })).toEqual({ providerSelectionId: "s1", currency: "VND", minStake: "50000",
      maxStake: "352359000", stakeStep: "1000", balance: "29000", observedAtMs: 1000 });
  });

  it.each([{ selectionMatched: false }, { limitText: "" }, { stakeStepText: "" }, { balanceText: "" }])
  ("fails closed on incomplete slip evidence: %o", (override) => {
    expect(parseApsportTicketConstraint({ providerSelectionId: "s1", selectionMatched: true,
      limitText: "50 - 352,359 K", stakeStepText: "1", balanceText: "29 K", observedAtMs: 1000,
      ...override })).toBeNull();
  });
});
