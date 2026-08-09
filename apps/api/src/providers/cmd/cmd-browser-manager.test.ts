import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { cmdProfileDirectoryName, readCmdFootballCatalog, validateCmdLaunchUrl } from "./cmd-browser-manager.js";

describe("CMD browser manager safety", () => {
  it("accepts opaque HTTPS launch URLs without rewriting credential-bearing query data", () => {
    const input = "https://provider.test/launch?opaque=unit-test-value#route";
    expect(validateCmdLaunchUrl(input)).toBe(input);
  });

  it.each([
    "http://provider.test/launch",
    "https://user:pass@provider.test/launch",
    "javascript:alert(1)",
    "not-a-url"
  ])("rejects unsafe launch URL %s", (input) => {
    expect(() => validateCmdLaunchUrl(input)).toThrow("CMD_LAUNCH_URL_INVALID");
  });

  it("derives a stable profile directory without exposing the session identifier", () => {
    const sessionId = "private-session-canary";
    const directory = cmdProfileDirectoryName(sessionId);
    expect(directory).toMatch(/^cmd-[a-f0-9]{24}$/u);
    expect(directory).not.toContain(sessionId);
    expect(cmdProfileDirectoryName(sessionId)).toBe(directory);
  });

  it("reads an already-visible football table without requiring a navigation icon", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <section class="c-odds-table--sport1"><div class="c-league" data-leagueid="l1">
          <span class="c-league__name">League</span>
          <div class="c-match" data-matchid="m1">
            <span class="c-match-time">08/17 02:30AM</span><span class="c-team-name">A</span><span class="c-team-name">B</span>
            <div class="c-match__odds-group"><div data-bt="5">
              <div class="c-odds" data-moid="o1">2.1</div><div class="c-odds" data-moid="o1">3.2</div><div class="c-odds" data-moid="o1">3.4</div>
            </div></div>
          </div>
        </div></section>
      `);
      await expect(readCmdFootballCatalog(page)).resolves.toEqual([
        expect.objectContaining({ sportId: "1", matchId: "m1", teamNames: ["A", "B"] })
      ]);
      await page.close();
    } finally {
      await browser.close();
    }
  });
});
