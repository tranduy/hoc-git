import { describe, expect, it } from "vitest";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";

function match(eventId: string): Record<string, unknown> {
  const textNode = (textContent: string) => ({ textContent });
  return {
    __computedStyle: { display: "block", visibility: "visible", contentVisibility: "visible" },
    parentElement: null,
    id: "",
    getAttribute: () => null,
    querySelector: (selector: string) => selector === ".match-favorite"
      ? { id: `eventId-main-1-${eventId}` }
      : selector === ".league-name" ? textNode("League")
        : selector === ".match__status, .match__time, .match-time" ? textNode("12:00") : null,
    querySelectorAll: (selector: string) => selector === ".match__team-name"
      ? [textNode("Home"), textNode("Away")] : []
  };
}

function root(eventId: string, display: "block" | "none"): Record<string, unknown> {
  const candidate = match(eventId);
  const value = {
    __computedStyle: { display, visibility: "visible", contentVisibility: "visible" },
    parentElement: null,
    getAttribute: (name: string) => name === "data-sport-id" ? "1" : null,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: (selector: string) => selector === ".match" ? [candidate] : []
  };
  candidate.parentElement = value;
  return value;
}

describe("TSPORT_PUBLIC_CATALOG_EXPRESSION", () => {
  it("uses the one visible football root when a stale sibling root is CSS-hidden", () => {
    const visibleRoot = root("12345", "block");
    const hiddenRoot = root("67890", "none");
    const document = {
      querySelectorAll: () => [visibleRoot, hiddenRoot]
    };
    const evaluate = new Function("document", "getComputedStyle",
      `return ${TSPORT_PUBLIC_CATALOG_EXPRESSION}`) as
      (document: unknown, getComputedStyle: (element: unknown) => unknown) => string;
    const records = JSON.parse(evaluate(document, (element: unknown) =>
      (element as { readonly __computedStyle: unknown }).__computedStyle)) as unknown[];

    expect(records).toEqual([
      expect.objectContaining({ eventId: "12345" }),
      { __fieldlineSweep: {
        sweepId: expect.stringMatching(/^tsport-sweep-[1-9]\d*$/u),
        complete: true
      } }
    ]);
  });
});
