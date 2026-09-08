import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION } from "./saba-catalog-discovery.js";

interface DiscoveryResult {
  readonly kind: string;
  readonly scope: string;
  readonly sportsScope: { readonly headerLabel: string; readonly navParentClasses: readonly string[] } | null;
  readonly navControls: ReadonlyArray<{ readonly period: string; readonly label: string;
    readonly tag: string; readonly classes: readonly string[]; readonly selected: boolean;
    readonly expanded: boolean | null; readonly visible: boolean }>;
  readonly counts: { readonly footballTables: number; readonly compactRows: number;
    readonly legacyLeagues: number; readonly legacyRows: number; readonly prematchRows: number };
  readonly matches: ReadonlyArray<{ readonly matchId: string; readonly shape: string;
    readonly controls: ReadonlyArray<{ readonly label: string; readonly tag: string;
      readonly classes: readonly string[]; readonly expanded: boolean | null }> }>;
  readonly scroll: readonly unknown[];
  readonly truncated: boolean;
}

describe("SABA public catalog discovery", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("identifies period controls only in general Sports and samples a prematch More control", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="c-side-nav c-side-nav--event">
        <div class="c-side-nav__header"><span class="c-text">Asian Games</span></div>
        <button class="c-side-nav__tab selected">Today</button>
      </section>
      <section class="c-side-nav c-side-nav--event sports-shell">
        <div class="c-side-nav__header"><span class="c-text">Sports</span></div>
        <button class="c-side-nav__tab selected" aria-selected="true">Hôm Nay</button>
        <button class="c-side-nav__tab">Sớm</button>
        <button class="c-side-nav__tab" aria-expanded="false">Trực Tiếp</button>
      </section>
      <main class="catalog-scroll" style="height:100px; overflow:auto">
        <div style="height:500px">
          <section class="c-odds-table--sport1"><div class="c-league">
            <div class="c-match" data-matchid="live-1"><span class="c-match-time">2H31'</span></div>
            <div class="c-match" data-matchid="live-2"><span class="c-match-time">2H42'</span></div>
            <div class="c-match" data-matchid="live-3"><span class="c-match-time">1H45+2'</span></div>
            <div class="c-match" data-matchid="kickoff-1"><span class="c-match-time">TRỰC TIẾP 12:00AM</span></div>
            <div class="c-match" data-matchid="kickoff-2"><span class="c-match-time">11:00PM</span></div>
            <div class="c-match" data-matchid="kickoff-3"><span class="c-match-time">02:00AM</span></div>
            <div class="c-match" data-matchid="kickoff-4"><span class="c-match-time">09:00PM</span></div>
            <div class="c-match" data-matchid="kickoff-5"><span class="c-match-time">01:00AM</span></div>
            <div class="c-match" data-matchid="kickoff-6"><span class="c-match-time">06:00AM</span></div>
            <div class="c-match prematch-row" data-matchid="match-101">
              <span class="c-match-time">Trực Tiếp 09/08 02:30</span>
              <button class="c-match__more more-control" aria-expanded="false">More 27</button>
              <button class="c-odds-button"><span>Handicap</span><span class="c-odds" data-moid="secret-odd">0.91</span></button>
            </div>
          </div></section>
        </div>
      </main>
    `);

    const serialized = await page.evaluate(SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) as string;
    const result = JSON.parse(serialized) as DiscoveryResult;

    expect(result).toEqual(expect.objectContaining({
      kind: "SABA_PUBLIC_CATALOG_DISCOVERY",
      scope: "LEGACY_SPORTS",
      sportsScope: { headerLabel: "Sports",
        navParentClasses: ["c-side-nav", "c-side-nav--event", "sports-shell"] },
      counts: expect.objectContaining({ footballTables: 1, compactRows: 10, prematchRows: 7 })
    }));
    expect(result.navControls.map(({ period, label }) => [period, label])).toEqual([
      ["TODAY", "Hôm Nay"], ["EARLY", "Sớm"], ["LIVE", "Trực Tiếp"]
    ]);
    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]).toEqual(expect.objectContaining({
      matchId: "match-101", shape: "COMPACT",
      controls: [expect.objectContaining({ label: "More 27", tag: "button",
        classes: ["c-match__more", "more-control"], expanded: false })]
    }));
    expect(serialized).not.toContain("secret-odd");
    await page.close();
  });

  it("does not invoke controls or expose odds, bets, forms, URLs, or browser storage", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="c-side-nav c-side-nav--event">
        <div class="c-side-nav__header"><span class="c-text">Sports</span></div>
        <a class="c-side-nav__tab" href="https://secret.invalid/session-path">Today</a>
      </section>
      <section class="c-odds-table--sport1"><div class="c-match" data-matchid="match-safe">
        <span class="c-match-time">09/09 03:45PM</span>
        <button class="expand-detail" aria-expanded="true">View details</button>
        <button class="c-odds" data-moid="secret-market">secret-price</button>
        <div class="betslip"><button class="show-more">secret-betslip</button></div>
        <div class="account-panel"><button class="show-more">secret-account</button></div>
        <div class="wallet"><button class="expand-detail">secret-wallet</button></div>
        <form action="https://secret.invalid/wager"><input value="secret-input"></form>
        <img src="https://secret.invalid/image">
      </div></section>
    `);
    await page.evaluate(() => {
      (globalThis as unknown as { __clicks: number }).__clicks = 0;
      document.addEventListener("click", () => {
        (globalThis as unknown as { __clicks: number }).__clicks += 1;
      }, true);
      Object.defineProperty(document, "cookie", { get: () => { throw new Error("cookie-read"); } });
      Object.defineProperty(globalThis, "localStorage", { get: () => { throw new Error("storage-read"); } });
      Object.defineProperty(globalThis, "sessionStorage", { get: () => { throw new Error("storage-read"); } });
    });

    const serialized = await page.evaluate(SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) as string;
    const result = JSON.parse(serialized) as DiscoveryResult;

    expect(result.matches[0]?.controls).toEqual([
      expect.objectContaining({ label: "View details", classes: ["expand-detail"] })
    ]);
    expect(await page.evaluate(() => (globalThis as unknown as { __clicks: number }).__clicks)).toBe(0);
    expect(serialized).not.toMatch(/secret|href|src|form|input|betslip|price|moid/iu);
    await page.close();
  });

  it("enforces every sample/string limit and the 24 KiB serialized ceiling", async () => {
    const page = await browser.newPage();
    const longLabel = "More " + "x".repeat(200);
    const validClasses = Array.from({ length: 20 }, (_, index) => `class-${index}-${"x".repeat(55)}`).join(" ");
    await page.setContent(`
      <section class="c-side-nav c-side-nav--event">
        <div class="c-side-nav__header"><span class="c-text">Sports</span></div>
        ${Array.from({ length: 20 }, (_, index) =>
          `<button class="c-side-nav__tab ${validClasses}">${index % 3 === 0 ? "Today" : index % 3 === 1 ? "Early" : "Live"}</button>`).join("")}
      </section>
      ${Array.from({ length: 8 }, (_, matchIndex) => `
        <section class="c-odds-table--sport1"><div class="c-match" data-matchid="match-${matchIndex}">
          <span class="c-match-time">09/10 01:15AM</span>
          ${Array.from({ length: 20 }, (_, controlIndex) =>
            `<button class="more-${controlIndex} ${validClasses}">${longLabel}</button>`).join("")}
        </div></section>`).join("")}
      ${Array.from({ length: 10 }, (_, index) =>
        `<div class="scroll-${index}" style="height:20px;overflow:auto"><div style="height:100px"></div></div>`).join("")}
    `);

    const serialized = await page.evaluate(SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) as string;
    const result = JSON.parse(serialized) as DiscoveryResult;
    const descriptors = [...result.navControls, ...result.matches.flatMap(({ controls }) => controls)];

    expect(result.navControls).toHaveLength(12);
    expect(result.matches).toHaveLength(3);
    expect(result.matches.every(({ controls }) => controls.length === 12)).toBe(true);
    expect(result.scroll.length).toBeLessThanOrEqual(6);
    expect(descriptors.every(({ label, classes }) => label.length <= 80 && classes.length <= 12 &&
      classes.every((name) => name.length <= 64 && /^[a-z0-9_-]+$/iu.test(name)))).toBe(true);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(24 * 1024);
    expect(result.truncated).toBe(true);
    await page.close();
  });
});
