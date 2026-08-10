import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { cmdProfileDirectoryName, readCmdFootballCatalog, readWithOneSessionRecovery, validateCmdLaunchUrl } from "./cmd-browser-manager.js";

describe("CMD browser manager safety", () => {
  it("invalidates a stale provider session and retries once with a fresh session", async () => {
    const stale = { id: "stale" };
    const fresh = { id: "fresh" };
    const acquired = [stale, fresh];
    const invalidated: string[] = [];

    const result = await readWithOneSessionRecovery({
      acquire: async () => acquired.shift()!,
      invalidate: async (session) => { invalidated.push(session.id); },
      recover: async () => { throw new Error("in-place recovery failed"); },
      read: async (session) => {
        if (session.id === "stale") throw new Error("CMD_CATALOG_UNAVAILABLE");
        return "catalog-ready";
      }
    });

    expect(result).toBe("catalog-ready");
    expect(invalidated).toEqual(["stale"]);
  });

  it("recovers the current provider page before consuming the launch URL again", async () => {
    const session = { recovered: false };
    const invalidated: typeof session[] = [];

    const result = await readWithOneSessionRecovery({
      acquire: async () => session,
      invalidate: async (failed) => { invalidated.push(failed); },
      recover: async (current) => { current.recovered = true; },
      read: async (current) => {
        if (!current.recovered) throw new Error("stale provider page");
        return "catalog-ready";
      }
    });

    expect(result).toBe("catalog-ready");
    expect(invalidated).toEqual([]);
  });

  it("invalidates both failed sessions and stops after one retry", async () => {
    const acquired = [{ id: "first" }, { id: "second" }];
    const invalidated: string[] = [];

    await expect(readWithOneSessionRecovery({
      acquire: async () => acquired.shift()!,
      invalidate: async (session) => { invalidated.push(session.id); },
      recover: async () => { throw new Error("in-place recovery failed"); },
      read: async () => { throw new Error("CMD_CATALOG_UNAVAILABLE"); }
    })).rejects.toThrow("CMD_CATALOG_UNAVAILABLE");

    expect(invalidated).toEqual(["first", "second"]);
    expect(acquired).toHaveLength(0);
  });

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

  it("selects the football category before accepting a stale visible table", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <button id="football"><i class="c-iconcolor-sport1" style="display:inline-block;width:10px;height:10px">Football</i></button>
        <section class="c-odds-table--sport1"><div class="c-league" data-leagueid="virtual">
          <span class="c-league__name">Soccer Marble</span><div class="c-match" data-matchid="virtual-match">
            <span class="c-match-time">08/17 02:30AM</span><span class="c-team-name">Virtual A</span><span class="c-team-name">Virtual B</span>
          </div></div></section>
        <script>document.querySelector('#football').onclick = () => {
          document.querySelector('.c-league').setAttribute('data-leagueid', 'real');
          document.querySelector('.c-league__name').textContent = 'Premier League';
          document.querySelector('.c-match').setAttribute('data-matchid', 'real-match');
          document.querySelectorAll('.c-team-name')[0].textContent = 'Arsenal';
          document.querySelectorAll('.c-team-name')[1].textContent = 'Chelsea';
        };</script>
      `);

      await expect(readCmdFootballCatalog(page)).resolves.toEqual([
        expect.objectContaining({ matchId: "real-match", leagueName: "Premier League", teamNames: ["Arsenal", "Chelsea"] })
      ]);
    } finally {
      await browser.close();
    }
  });
});
