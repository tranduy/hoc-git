import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { cmdProfileDirectoryName, readCmdFootballCatalog, readStableFootballCatalog,
  catalogStructuralFingerprint, readWithOneSessionRecovery, runCoalesced,
  isVerifiedCmdFootballIdentity, validateCmdLaunchUrl } from "./cmd-browser-manager.js";
import type { CmdCatalogInputRecord } from "@tool-chenh/adapters";

describe("CMD browser manager safety", () => {
  it("verifies the CMD Football runtime without requiring an unrelated eSports icon", () => {
    expect(isVerifiedCmdFootballIdentity({ runtime: true, football: true, esports: false, cmdBundle: true })).toBe(true);
    expect(isVerifiedCmdFootballIdentity({ runtime: true, football: true, esports: true, cmdBundle: false })).toBe(false);
    expect(isVerifiedCmdFootballIdentity({ runtime: false, football: true, esports: true, cmdBundle: true })).toBe(false);
  });

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
            <div class="c-match__odds-group"><div data-bt="1">
              <div class="c-odds-button"><span>0.5</span><div class="c-odds" data-moid="o1">0.8</div></div>
              <div class="c-odds-button"><div class="c-odds" data-moid="o1">-0.9</div></div>
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

  it("does not click Football again when a usable handicap table is already rendered", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`
        <button id="football"><i class="c-iconcolor-sport1" style="display:inline-block;width:10px;height:10px">Football</i></button>
        <section class="c-odds-table--sport1"><div class="c-league" data-leagueid="l1">
          <span class="c-league__name">League</span><div class="c-match" data-matchid="m1">
            <span class="c-match-time">1H12'</span><span class="c-team-name">A</span><span class="c-team-name">B</span>
            <div class="c-match__odds-group"><div data-bt="1">
              <div class="c-odds-button"><span>0.5</span><div class="c-odds" data-moid="ah">0.8</div></div>
              <div class="c-odds-button"><div class="c-odds" data-moid="ah">-0.9</div></div>
            </div></div>
          </div>
        </div></section>
        <script>window.footballClicks = 0; document.querySelector('#football').onclick = () => {
          window.footballClicks += 1; document.querySelector('.c-odds-table--sport1').remove();
        };</script>
      `);

      await expect(readCmdFootballCatalog(page)).resolves.toEqual([
        expect.objectContaining({ matchId: "m1", groups: [expect.objectContaining({ betTypeIds: ["1"] })] })
      ]);
      await expect(page.evaluate(() => (window as unknown as { footballClicks: number }).footballClicks)).resolves.toBe(0);
    } finally {
      await browser.close();
    }
  });

  it("waits for two structurally stable usable probes and returns the newest prices", async () => {
    const record = (marketOddsIds: readonly string[], prices: readonly string[]): CmdCatalogInputRecord => ({
      sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "1H12'", teamNames: ["A", "B"],
      groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: marketOddsIds.map((marketOddsId, index) => ({
        marketOddsId, priceText: prices[index]!, status: null, greyedOut: null, lineText: index === 0 ? "0.5" : null
      })) }]
    });
    const probes = [
      [] as readonly CmdCatalogInputRecord[],
      [record(["home"], ["0.7"])],
      [record(["home", "away"], ["0.8", "-0.9"])],
      [record(["home", "away"], ["0.81", "-0.91"])]
    ];
    let selected = 0;
    const result = await readStableFootballCatalog({
      read: async () => probes.shift() ?? [],
      select: async () => { selected += 1; return true; },
      wait: async () => undefined
    }, { maxWaitMs: 300, pollingIntervalMs: 75, stableSampleCount: 2 });

    expect(selected).toBe(1);
    expect(result[0]?.groups[0]?.odds.map((odd) => odd.priceText)).toEqual(["0.81", "-0.91"]);
  });

  it("accepts one fresh probe when its structure matches the previously verified catalog", async () => {
    const record = (priceText: string): CmdCatalogInputRecord => ({
      sportId: "1", leagueId: "l", leagueName: "League", matchId: "m", timeText: "1H12'",
      teamNames: ["A", "B"], groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
        { marketOddsId: "home", priceText, status: null, greyedOut: null, lineText: "0.5" },
        { marketOddsId: "away", priceText: "-0.9", status: null, greyedOut: null, lineText: null }
      ] }]
    });
    const previous = [record("0.8")];
    let reads = 0;

    const result = await readStableFootballCatalog({
      read: async () => { reads += 1; return [record("0.81")]; },
      select: async () => { throw new Error("must not select"); },
      wait: async () => { throw new Error("must not wait"); }
    }, {
      maxWaitMs: 300,
      pollingIntervalMs: 75,
      stableSampleCount: 2,
      trustedStructuralFingerprint: catalogStructuralFingerprint(previous)
    });

    expect(reads).toBe(1);
    expect(result[0]?.groups[0]?.odds[0]?.priceText).toBe("0.81");
  });

  it("coalesces concurrent reads for the same provider session", async () => {
    const pending = new Map<string, Promise<string>>();
    let calls = 0;
    let release!: (value: string) => void;
    const operation = () => {
      calls += 1;
      return new Promise<string>((resolve) => { release = resolve; });
    };

    const first = runCoalesced(pending, "session", operation);
    const second = runCoalesced(pending, "session", operation);
    await Promise.resolve();
    expect(calls).toBe(1);
    release("catalog");
    await expect(Promise.all([first, second])).resolves.toEqual(["catalog", "catalog"]);
    expect(pending.size).toBe(0);
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
            <div class="c-match__odds-group"><div data-bt="1">
              <div class="c-odds-button"><span>0.5</span><div class="c-odds" data-moid="virtual-ah">0.8</div></div>
              <div class="c-odds-button"><div class="c-odds" data-moid="virtual-ah">-0.9</div></div>
            </div></div>
          </div></div></section>
        <script>document.querySelector('#football').onclick = () => {
          document.querySelector('.c-league').setAttribute('data-leagueid', 'real');
          document.querySelector('.c-league__name').textContent = 'Premier League';
          document.querySelector('.c-match').setAttribute('data-matchid', 'real-match');
          document.querySelectorAll('.c-team-name')[0].textContent = 'Arsenal';
          document.querySelectorAll('.c-team-name')[1].textContent = 'Chelsea';
          document.querySelectorAll('.c-odds').forEach((odd) => odd.setAttribute('data-moid', 'real-ah'));
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
