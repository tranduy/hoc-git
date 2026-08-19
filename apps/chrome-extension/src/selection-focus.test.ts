import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCmdSelectionFocusExpression, buildGenericSelectionFocusExpression } from "./selection-focus.js";

describe("CMD selection focus expression", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

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

  it("focuses the exact hidden market row belonging to the requested legacy event", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="match default-match" id="R_25224742">
        <div class="Dbox_b2"><span>0/0.5</span><i class="odds" id="main-ft-home">-0.90</i><i class="odds">0.78</i></div>
      </div>
      <div class="match" id="R_25252758">
        <div class="Dbox_b2"><span>0.5</span><i class="odds" id="child-ft-home">-0.73</i><i class="odds">0.61</i></div>
        <div class="Dbox_b5"><span>0/0.5</span><i class="odds" id="child-fh-home">-0.67</i><i class="odds">0.53</i></div>
      </div>
      <div class="match default-match" id="R_other-event">
        <div class="Dbox_b5"><span>0/0.5</span><i class="odds" id="other-home">-0.50</i><i class="odds">0.40</i></div>
      </div>
    `);
    const marketId = "legacy:25252758:7:0/0.5";
    const result = await page.evaluate(buildCmdSelectionFocusExpression({
      providerEventId: "25224742", providerMarketId: marketId, providerSelectionId: `${marketId}:home`
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(await page.locator("#child-fh-home").evaluate((node) => {
      const style = (node as HTMLElement).style;
      return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
    })).toEqual({ color: "rgb(53, 232, 134)", style: "solid", width: "4px" });
    expect(await page.locator("#main-ft-home").evaluate((node) => (node as HTMLElement).style.outline)).toBe("");
    expect(await page.locator("#child-ft-home").evaluate((node) => (node as HTMLElement).style.outline)).toBe("");
    expect(await page.locator("#other-home").evaluate((node) => (node as HTMLElement).style.outline)).toBe("");
    await page.close();
  });

  it("focuses the exact hidden first-half total selection", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="match default-match" id="R_25224742"></div>
      <div class="match" id="R_25252758">
        <div class="Dbox_b2"><span>0.5</span><i class="odds">-0.73</i><i class="odds">0.61</i></div>
        <div class="Dbox_b3"><span>2.5</span><i class="odds" id="child-ft-over">-0.71</i><i class="odds">0.59</i></div>
        <div class="Dbox_b5"><span>0/0.5</span><i class="odds">-0.67</i><i class="odds">0.53</i></div>
        <div class="Dbox_b3"><span>1/1.5</span><i class="odds">-0.64</i><i class="odds" id="child-fh-under">0.52</i></div>
      </div>
    `);
    const marketId = "legacy:25252758:8:1/1.5";
    const result = await page.evaluate(buildCmdSelectionFocusExpression({
      providerEventId: "25224742", providerMarketId: marketId, providerSelectionId: `${marketId}:under`
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(await page.locator("#child-fh-under").evaluate((node) => (node as HTMLElement).style.outlineWidth))
      .toBe("4px");
    expect(await page.locator("#child-ft-over").evaluate((node) => (node as HTMLElement).style.outline)).toBe("");
    await page.close();
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
