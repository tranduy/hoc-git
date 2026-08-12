import { describe, expect, it } from "vitest";
import { parseCmdTicketConstraint } from "./cmd-ticket-constraint.js";

describe("parseCmdTicketConstraint", () => {
  it("accepts duplicate responsive inputs only when they agree on integer native bounds", () => {
    const field = { type: "text", placeholder: "30 - 54,945", min: null, max: null, step: null,
      labels: ["Tối thiểu", "Tối đa"] };
    expect(parseCmdTicketConstraint({ evidence: { matched: true, displayedOdds: "0.94", inputs: [field, field] },
      providerSelectionId: "market:home", currency: "INH", balance: "29.61", observedAtMs: 1000 }))
      .toEqual({ providerSelectionId: "market:home", rawOdds: "0.94", currency: "INH",
        minStake: "30", maxStake: "54945", stakeStep: "1", balance: "29.61", observedAtMs: 1000 });
  });

  it("fails closed for ambiguous, fractional, unmatched, or malformed evidence", () => {
    const field = (placeholder: string) => ({ type: "text", placeholder, min: null, max: null, step: null, labels: [] });
    const base = { providerSelectionId: "market:home", currency: "INH", balance: "29.61", observedAtMs: 1000 };
    expect(parseCmdTicketConstraint({ ...base, evidence: { matched: false, displayedOdds: null, inputs: [] } })).toBeNull();
    expect(parseCmdTicketConstraint({ ...base, evidence: { matched: true, displayedOdds: "0.94",
      inputs: [field("30 - 54,945"), field("50 - 54,945")] } })).toBeNull();
    expect(parseCmdTicketConstraint({ ...base, evidence: { matched: true, displayedOdds: "0.94",
      inputs: [field("30.5 - 54,945")] } })).toBeNull();
  });
});
