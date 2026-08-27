import { describe, expect, it } from "vitest";
import { LIVE_TAB_LABELS, TODAY_TAB_LABELS, timeTabExpression } from "./time-tab-selector.js";

/** Written by code point so this file's own escaping cannot be the thing under
 *  test: the expression must reach the page carrying real escape sequences. */
const BACKSLASH = String.fromCharCode(92);

describe("timeTabExpression", () => {
  it("keeps its escapes intact through the template literal", () => {
    // A template literal eats a single backslash, which once turned a
    // whitespace class into the letter s and would have made the selector
    // strip letters out of every label it read.
    const source = timeTabExpression([...TODAY_TAB_LABELS]);
    expect(source).toContain(`${BACKSLASH}s+`);
    expect(source).toContain(`${BACKSLASH}u0300-${BACKSLASH}u036f`);
    expect(source).toContain(`${BACKSLASH}u0111`);
    expect(source).not.toContain("replace(/s+/g");
  });

  it("folds accents and the Vietnamese d so one label matches both spellings", () => {
    const source = timeTabExpression([...TODAY_TAB_LABELS]);
    expect(source).toContain("normalize('NFD')");
    expect(source).toContain('["hom nay","today"]');
  });

  it("carries the labels it considered so a renamed tab is reported, not silent", () => {
    const source = timeTabExpression([...LIVE_TAB_LABELS]);
    expect(source).toContain("labels: seen");
    expect(source).toContain("time-tab-not-found");
  });

  it("leaves an already-selected tab alone unless the caller forces it", () => {
    expect(timeTabExpression([...TODAY_TAB_LABELS])).toContain("if (active && !false)");
    expect(timeTabExpression([...TODAY_TAB_LABELS], true)).toContain("if (active && !true)");
  });

  it("accepts the labels a lobby may use for its running fixtures", () => {
    expect(LIVE_TAB_LABELS).toContain("truc tiep");
    expect(LIVE_TAB_LABELS).toContain("in play");
    expect(TODAY_TAB_LABELS).toEqual(["hom nay", "today"]);
  });
});
