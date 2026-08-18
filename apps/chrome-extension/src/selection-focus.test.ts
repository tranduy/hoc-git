import { describe, expect, it } from "vitest";
import { buildCmdSelectionFocusExpression, buildGenericSelectionFocusExpression } from "./selection-focus.js";

describe("CMD selection focus expression", () => {
  it("uses exact opaque identities and never performs a wagering click", () => {
    const expression = buildCmdSelectionFocusExpression({
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "market-1:home"
    });
    expect(expression).toContain("event-1");
    expect(expression).toContain("market-1");
    expect(expression).toContain("scrollIntoView");
    expect(expression).not.toContain(".click(");
    expect(expression).not.toMatch(/dispatchEvent|MouseEvent|PointerEvent/u);
  });

  it("rejects a selection ID that is not tied to the exact market", () => {
    expect(() => buildCmdSelectionFocusExpression({
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "other:home"
    })).toThrow("SELECTION_IDENTITY_MISMATCH");
  });
});

describe("generic provider selection focus expression", () => {
  it("searches only exact opaque identity attributes and never performs a wagering click", () => {
    const expression = buildGenericSelectionFocusExpression({
      providerEventId: "event-1", providerMarketId: "market-1", providerSelectionId: "selection-1"
    });
    expect(expression).toContain("selection-1");
    expect(expression).toContain("scrollIntoView");
    expect(expression).not.toContain(".click(");
    expect(expression).not.toMatch(/dispatchEvent|MouseEvent|PointerEvent/u);
  });
});
