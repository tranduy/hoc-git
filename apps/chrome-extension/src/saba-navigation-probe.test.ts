import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION } from "./saba-catalog-discovery.js";
import { classifySabaMoreChange, runSabaNavigationProbe, SABA_NAVIGATION_PROBE_READ_EXPRESSION,
  type SabaMoreState } from "./saba-navigation-probe.js";

async function installProbeFixture(page: Page): Promise<void> {
  await page.setContent(`
    <style>.hidden { display:none } .c-match,.c-side-nav__tab,.c-btn { display:block }</style>
    <section class="c-side-nav c-side-nav--event">
      <div class="c-side-nav__header"><span class="c-text">Asian Games</span></div>
      <div class="c-side-nav__tab">Hôm Nay</div><div class="c-side-nav__tab">Sớm</div>
    </section>
    <section class="c-side-nav c-side-nav--event sports-nav current-period">
      <div class="c-side-nav__header"><span class="c-text">Sports</span></div>
      <div class="period-wrap active-period"><div class="c-side-nav__tab" data-period="today">Hôm Nay</div></div>
      <div class="period-wrap"><div class="c-side-nav__tab" data-period="early">Sớm</div></div>
    </section>
    <div id="today-view">
      <div class="table-date" data-date="2026-09-07">Today 09/07</div>
      <section class="c-odds-table--sport1" data-date="2026-09-07">
        <header class="c-odds-table__header">
          <button class="all-markets">All Markets</button>
          <select aria-label="Market filter"><option>All</option><option>Corner</option><option>Cards</option></select>
        </header>
        <div class="c-league" data-leagueid="league-1">
          <span class="c-league__name">League One</span>
          <div class="c-match" data-matchid="today-more">
            <span class="c-match-time">09/07 11:00PM</span>
            <span class="c-team-name">Alpha</span><span class="c-team-name">Beta</span>
            <div class="c-match__odds-group"><div data-bt="1"><span class="c-odds" data-moid="base-ah">1.91</span></div></div>
            <a class="c-btn c-btn--more c-is-close">2</a>
          </div>
          <div class="c-match" data-matchid="today-prefixed"><span class="c-match-time">TRỰC TIẾP 12:00AM</span><a class="c-btn c-btn--more c-is-close" href="https://secret.invalid/navigation">3</a></div>
          <div class="c-match" data-matchid="today-clock" data-date="2026-09-08"><span class="c-match-time" title="Tomorrow 09/08" data-start-time="2026-09-08T02:00:00">02:00AM</span></div>
          <div class="c-match" data-matchid="today-live" data-date="token=abc123"><span class="c-match-time" title="https://secret.invalid/?token=abc" data-kickoff="1.91">TRỰC TIẾP</span></div>
          <div class="c-match" data-matchid="today-live-clock"><span class="c-match-time">2H31'</span></div>
        </div>
      </section>
    </div>
    <div id="early-view" class="hidden">
      <div class="table-date" data-date="2026-09-08">Early 09/08</div>
      <section class="c-odds-table--sport1" data-date="2026-09-08">
        <header class="market-header"><button class="corner-menu">Corners</button></header>
        <div class="c-league" data-leagueid="league-2">
          <div class="c-match" data-matchid="early-1"><span class="c-match-time">09/08 01:00AM</span></div>
        </div>
      </section>
    </div>
    <div class="betslip"><button class="c-btn--more">secret-betslip</button></div>
    <div class="account-panel"><button class="c-btn--more">secret-account</button></div>
    <form action="https://secret.invalid/wager"><input value="secret-input"></form>
    <button class="c-odds-button"><span class="c-odds" data-moid="secret-odd">9.99</span></button>
  `);
  await page.evaluate(() => {
    const state = globalThis as unknown as { clicks: string[] };
    state.clicks = [];
    const today = document.querySelector('[data-period="today"]')!;
    const early = document.querySelector('[data-period="early"]')!;
    const todayView = document.querySelector('#today-view')!;
    const earlyView = document.querySelector('#early-view')!;
    const selectPeriod = (period: "today" | "early") => {
      state.clicks.push(period);
      todayView.classList.toggle('hidden', period !== 'today');
      earlyView.classList.toggle('hidden', period !== 'early');
      today.parentElement!.classList.toggle('active-period', period === 'today');
      early.parentElement!.classList.toggle('active-period', period === 'early');
    };
    today.addEventListener('click', () => selectPeriod('today'));
    early.addEventListener('click', () => selectPeriod('early'));
    document.querySelector('.c-btn--more')!.addEventListener('click', (event) => {
      state.clicks.push('more');
      const control = event.currentTarget as HTMLElement;
      const existing = document.querySelector('[data-matchid="today-corners"]');
      if (existing) {
        existing.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
        return;
      }
      control.classList.remove('c-is-close'); control.classList.add('c-is-open');
      control.closest('.c-match')!.insertAdjacentHTML('afterend', `
        <div class="c-match alternate-row" data-matchid="today-corners">
          <span class="c-match-time">09/07 11:00PM</span>
          <span class="c-team-name">Alpha No. of Corners</span><span class="c-team-name">Beta No. of Corners</span>
          <div class="c-match__odds-group"><div data-bt="7">
            <span class="c-odds" data-moid="corner-home">0.91</span>
            <span class="c-odds" data-moid="corner-away">0.95</span>
          </div></div>
        </div>`);
    });
    for (const control of Array.from(document.querySelectorAll('.all-markets,.corner-menu,.c-odds-button,.betslip button,.account-panel button'))) {
      control.addEventListener('click', () => state.clicks.push(`forbidden:${control.className}`));
    }
  });
}

async function installHeadingProbeFixture(page: Page): Promise<void> {
  await page.setContent(`
    <style>.hidden{display:none}.c-side-nav__tab,.c-side-nav__content,.c-match,.c-odds-table--sport1,.c-odds-page__header{display:block}</style>
    <section class="c-side-nav c-side-nav--event asian-nav">
      <div class="c-side-nav__header"><span class="c-text">Asian Games</span></div>
      <div class="c-side-nav__content"><span class="c-text">Bóng đá</span></div>
      <div class="c-side-nav__tab">Hôm Nay</div>
    </section>
    <section class="c-side-nav c-side-nav--event sports-nav">
      <div class="c-side-nav__header"><span class="c-text">Thể Thao</span></div>
      <div class="c-side-nav__tab-group"><div class="c-side-nav__tab" data-period="today">Hôm Nay</div></div>
      <div class="c-side-nav__tab-group"><div class="c-side-nav__tab" data-period="early">Sớm</div></div>
      <div class="c-side-nav__content"><span class="c-text football-label">Bóng đá</span></div>
    </section>
    <main id="football-page">
      <div class="c-odds-page__header">Bóng đá / Hôm NayTất CảTất Cả1X2Tỷ Số Chính XácLẻ/Chẵn</div>
      <section class="c-odds-table--sport1"><div class="c-match" data-matchid="today-a"><span class="c-match-time">11:00PM</span></div></section>
      <section class="c-odds-table--sport1"><div class="c-match" data-matchid="today-b"><span class="c-match-time">TRỰC TIẾP 12:00AM</span></div></section>
    </main>
  `);
  await page.evaluate(() => {
    const state = globalThis as unknown as { clicks: string[] };
    state.clicks = [];
    const header = document.querySelector('.c-odds-page__header')!;
    const rows = Array.from(document.querySelectorAll('.c-match'));
    const select = (period: "today" | "early") => {
      state.clicks.push(period);
      header.textContent = period === "today" ?
        "Bóng đá / Hôm NayTất CảTất Cả1X2Tỷ Số Chính XácLẻ/Chẵn" :
        "Bóng đá / SớmTất CảCác Trận Khác";
      rows.forEach((row, index) => row.setAttribute('data-matchid', `${period}-${index === 0 ? 'a' : 'b'}`));
    };
    document.querySelector('[data-period="today"]')!.addEventListener('click', () => select('today'));
    document.querySelector('[data-period="early"]')!.addEventListener('click', () => select('early'));
  });
}

describe("SABA bounded navigation probe", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("reads the exact Vietnamese Sports section already accepted by public discovery", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      document.querySelector('.sports-nav > .c-side-nav__header .c-text')!.textContent =
        "Th\u1ec3 Thao";
    });

    const discovery = JSON.parse(await page.evaluate(
      SABA_PUBLIC_CATALOG_DISCOVERY_EXPRESSION) as string) as Record<string, any>;
    const probe = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any> | null;

    expect(discovery.scope).toBe("LEGACY_SPORTS");
    expect(discovery.sportsScope).toEqual({ headerLabel: "Th\u1ec3 Thao",
      navParentClasses: ["c-side-nav", "c-side-nav--event", "sports-nav", "current-period"] });
    expect(probe).toMatchObject({ activePeriod: "TODAY", rowCount: 5 });
    await page.close();
  });

  it("uses the uniquely owned Vietnamese football page heading and restores Today after Early", async () => {
    const page = await browser.newPage();
    await installHeadingProbeFixture(page);
    const initial = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any>;
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; } });

    expect(initial).toMatchObject({ tableCount: 2, activePeriod: "TODAY",
      activePeriodEvidence: "FOOTBALL_PAGE_HEADING" });
    expect(result?.viewRestored).toBe(true);
    expect(JSON.parse(result!.body)).toMatchObject({ status: "COMPLETE_EVIDENCE",
      today: { activePeriod: "TODAY", activePeriodEvidence: "FOOTBALL_PAGE_HEADING" },
      early: { activePeriod: "EARLY", activePeriodEvidence: "FOOTBALL_PAGE_HEADING" } });
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks))
      .toEqual(["early", "today"]);
    await page.close();
  });

  it("returns safe no-action evidence when an initial Today view cannot settle", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    let clock = 1_000;
    let reads = 0;
    let actions = 0;
    const result = await runSabaNavigationProbe({
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          reads += 1;
          return reads === 1 ? page.evaluate(expression) : null;
        }
        actions += Number(expression.includes('.click()') || expression.includes('control.click'));
        return page.evaluate(expression);
      },
      isCurrent: () => true,
      now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }
    });

    expect(result?.viewRestored).toBe(true);
    expect(JSON.parse(result!.body)).toMatchObject({
      status: "NO_ACTION_INITIAL_TODAY_NOT_STABLE", mutated: false, viewRestored: true
    });
    expect(actions).toBe(0);
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks)).toEqual([]);
    await page.close();
  });

  it("binds a discovery-only Today target after exactly one public read without a coverage claim", async () => {
    const initial = { documentToken: "collector-document", pageNowMs: 1_000,
      rowCount: 75, tableCount: 2, activePeriod: "TODAY" as const,
      activePeriodEvidence: "FOOTBALL_PAGE_HEADING" as const,
      eligibleMoreCount: 2, eligibleMoreOwners: ["owner-1", "owner-2"], moreCandidates: [],
      rosterMatchIds: ["owner-1", "owner-2"], rosterSamples: [], timeShapes: {},
      dateContexts: [], headerControls: [], periodControls: [], navRootChildren: [],
      navRootTopology: [], fingerprint: "today:owner-1,owner-2", truncated: false };
    let clock = 1_000;
    const evaluate = vi.fn(async (expression: string) => {
      if (expression !== SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
        throw new Error("unexpected discovery-only expression");
      }
      return initial;
    });
    const wait = vi.fn(async (delayMs: number) => { clock += delayMs; });

    const result = await runSabaNavigationProbe({ evaluate, isCurrent: () => true,
      now: () => clock, wait, discoveryOnly: true });
    const body = JSON.parse(result!.body) as Record<string, any>;

    expect(result?.viewRestored).toBe(true);
    expect(body).toEqual({ kind: "SABA_NAVIGATION_PROBE", version: 1,
      status: "NO_ACTION_COLLECTOR_TARGET_BOUND", mutated: false, viewRestored: true,
      initial: { documentToken: "collector-document", activePeriod: "TODAY",
        activePeriodEvidence: "FOOTBALL_PAGE_HEADING" }, truncated: false });
    expect(body).not.toHaveProperty("coverageClaim");
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(SABA_NAVIGATION_PROBE_READ_EXPRESSION);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each(["EARLY", "UNKNOWN"] as const)(
    "keeps discovery-only %s input read-only and refuses collector target admission",
    async (activePeriod) => {
      const initial = { documentToken: "collector-document", pageNowMs: 1_000,
        rowCount: 75, tableCount: 2, activePeriod,
        activePeriodEvidence: "FOOTBALL_PAGE_HEADING" as const,
        eligibleMoreCount: 2, eligibleMoreOwners: ["owner-1", "owner-2"], moreCandidates: [],
        rosterMatchIds: ["owner-1", "owner-2"], rosterSamples: [], timeShapes: {},
        dateContexts: [], headerControls: [], periodControls: [], navRootChildren: [],
        navRootTopology: [], fingerprint: `${activePeriod}:owner-1,owner-2`, truncated: false };
      let clock = 1_000;
      const evaluate = vi.fn(async (expression: string) => {
        if (expression !== SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          throw new Error("unexpected discovery-only expression");
        }
        return initial;
      });
      const wait = vi.fn(async (delayMs: number) => { clock += delayMs; });

      const result = await runSabaNavigationProbe({ evaluate, isCurrent: () => true,
        now: () => clock, wait, discoveryOnly: true });
      const body = JSON.parse(result!.body) as Record<string, any>;

      expect(result?.viewRestored).toBe(true);
      expect(body).toMatchObject({ status: "NO_ACTION_UNCONFIRMED_SELECTION",
        mutated: false, viewRestored: true, initial: { activePeriod } });
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  );

  it("returns bounded no-action evidence when the initial state is unavailable but ownership remains current", async () => {
    const evaluate = vi.fn(async () => null);
    const result = await runSabaNavigationProbe({ evaluate, isCurrent: () => true,
      now: () => 1_000, wait: async () => undefined });

    expect(result?.viewRestored).toBe(true);
    expect(JSON.parse(result!.body)).toEqual({
      kind: "SABA_NAVIGATION_PROBE", version: 1,
      status: "NO_ACTION_INITIAL_STATE_UNAVAILABLE",
      coverageClaim: "PUBLIC_STRUCTURE_ONLY", mutated: false, viewRestored: true, truncated: false,
      failureTrace: [{ stage: "INITIAL_READ", reads: 1, elapsedMs: 0,
        outcome: "LAST_READ_ABSENT", evaluationFailure: "PAGE_NULL" }]
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("reports actual elapsed time for an unavailable initial evaluation", async () => {
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async () => undefined, evaluate: async () => { clock += 2_500; return null; } });

    expect(JSON.parse(result!.body).failureTrace).toEqual([{ stage: "INITIAL_READ",
      reads: 1, elapsedMs: 2_500, outcome: "LAST_READ_ABSENT", evaluationFailure: "PAGE_NULL" }]);
    expect(result?.viewRestored).toBe(true);
  });

  it("preserves null when source ownership retires during the initial read", async () => {
    let currentChecks = 0;
    const result = await runSabaNavigationProbe({ evaluate: async () => null,
      isCurrent: () => (currentChecks += 1) < 3, now: () => 1_000,
      wait: async () => undefined });

    expect(result).toBeNull();
  });

  it("takes no action when the initial Today document token changes while settling", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    let reads = 0;
    let clock = 1_000;
    let actions = 0;
    const result = await runSabaNavigationProbe({
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          reads += 1;
          if (reads === 2) await page.evaluate(() => {
            (globalThis as unknown as { __fieldlineSabaNavigationProbeDocV1: string })
              .__fieldlineSabaNavigationProbeDocV1 = "replacement-document";
          });
          return page.evaluate(expression);
        }
        actions += Number(expression.includes('.click()') || expression.includes('control.click'));
        return page.evaluate(expression);
      },
      isCurrent: () => true,
      now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }
    });

    expect(result?.viewRestored).toBe(true);
    expect(JSON.parse(result!.body)).toMatchObject({
      status: "NO_ACTION_INITIAL_TODAY_NOT_STABLE", mutated: false, viewRestored: true
    });
    expect(actions).toBe(0);
    await page.close();
  });

  it("still performs the guarded Today action when the initial verified period is Early", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      document.querySelector('[data-period="today"]')!.parentElement!.classList.remove('active-period');
      document.querySelector('[data-period="early"]')!.parentElement!.classList.add('active-period');
      document.querySelector('#today-view')!.classList.add('hidden');
      document.querySelector('#early-view')!.classList.remove('hidden');
      (globalThis as unknown as { clicks: string[] }).clicks = [];
    });
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; } });

    expect(result?.viewRestored).toBe(true);
    expect((await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks))[0]).toBe("today");
    await page.close();
  });

  it("does not treat arbitrary text after a period label as the observed filter delimiter", async () => {
    const page = await browser.newPage();
    await installHeadingProbeFixture(page);
    await page.evaluate(() => {
      document.querySelector('.c-odds-page__header')!.textContent = "Bóng đá / Hôm NayFootball";
    });
    const state = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any>;
    expect(state).toMatchObject({ activePeriod: "UNKNOWN", activePeriodEvidence: "NONE" });
    await page.close();
  });

  it.each(["unowned", "hidden-football", "duplicate", "today-state-early-heading",
    "early-state-today-heading", "multiple-selected", "selected-live"] as const)(
    "fails heading authority closed for %s evidence", async (scenario) => {
      const page = await browser.newPage();
      await installHeadingProbeFixture(page);
      await page.evaluate((name) => {
        const pageRoot = document.querySelector('#football-page')!;
        const heading = document.querySelector('.c-odds-page__header')!;
        if (name === "unowned") document.body.insertBefore(heading, pageRoot);
        if (name === "hidden-football") (document.querySelector('.football-label') as HTMLElement).style.display = "none";
        if (name === "duplicate") heading.insertAdjacentHTML('afterend',
          '<div class="c-odds-page__header">Bóng đá / Hôm Nay</div>');
        if (name === "today-state-early-heading") {
          document.querySelector('[data-period="today"]')!.parentElement!.classList.add('active-period');
          heading.textContent = "Bóng đá / Sớm";
        }
        if (name === "early-state-today-heading") {
          document.querySelector('[data-period="early"]')!.parentElement!.classList.add('active-period');
          heading.textContent = "Bóng đá / Hôm Nay";
        }
        if (name === "multiple-selected") {
          document.querySelector('[data-period="today"]')!.parentElement!.classList.add('active-period');
          document.querySelector('[data-period="early"]')!.parentElement!.classList.add('active-period');
        }
        if (name === "selected-live") {
          document.querySelector('.sports-nav')!.insertAdjacentHTML('beforeend',
            '<div class="active-period"><div class="c-side-nav__tab">Trực tiếp156</div></div>');
        }
      }, scenario);
      const state = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any>;
      expect(state.activePeriod, scenario).toBe("UNKNOWN");
      expect(state.activePeriodEvidence, scenario).toBe(
        scenario.includes("state") || scenario === "duplicate" || scenario === "multiple-selected" ||
          scenario === "selected-live" ? "CONFLICT" : "NONE");
      await page.close();
  });

  it("keeps existing sole tab-state authority and reports its evidence", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    const state = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any>;
    expect(state).toMatchObject({ activePeriod: "TODAY", activePeriodEvidence: "TAB_STATE" });
    await page.close();
  });

  it("keeps aggregate rows in the roster but never samples them as More owners", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      document.querySelector('.c-league')!.innerHTML = `
        <div class="c-match" data-matchid="134003685"><span class="c-match-time">09/08 12:00AM</span><span class="c-team-name">Đội Nhà - Thứ Hai - 2 Trận Đấu</span><span class="c-team-name">Đội Khách - Thứ Hai - 2 Trận Đấu</span><a class="c-btn c-btn--more c-is-close">2</a></div>
        <div class="c-match" data-matchid="134003749"><span class="c-match-time">09/08 12:00AM</span><span class="c-team-name">Đội Nhà - Thứ Hai - 2 Trận Đấu</span><span class="c-team-name">Đội Khách - Thứ Hai - 2 Trận Đấu</span><a class="c-btn c-btn--more c-is-close">2</a></div>
        <div class="c-match" data-matchid="134019593"><span class="c-match-time">09/08 12:00AM</span><span class="c-team-name">Đội Nhà - Thứ Hai - 3 Trận Đấu</span><span class="c-team-name">Đội Khách - Thứ Hai - 3 Trận Đấu</span><a class="c-btn c-btn--more c-is-close">2</a></div>
        <div class="c-match" data-matchid="real-1"><span class="c-match-time">TRỰC TIẾP 12:00AM</span><span class="c-team-name">Real Home</span><span class="c-team-name">Real Away</span><a class="c-btn c-btn--more c-is-close">2</a></div>
        <div class="c-match" data-matchid="real-2"><span class="c-match-time">TRỰC TIẾP 01:00AM</span><span class="c-team-name">Club 2 Trận Đấu</span><span class="c-team-name">Other Club</span><a class="c-btn c-btn--more c-is-close">2</a></div>`;
    });

    const state = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any>;
    expect(state.rosterMatchIds).toEqual(["134003685", "134003749", "134019593", "real-1", "real-2"]);
    expect(state.eligibleMoreOwners).toEqual(["real-1", "real-2"]);
    expect(state.moreCandidates.filter((candidate: { ownerMatchId: string }) =>
      candidate.ownerMatchId.startsWith("134")).every((candidate: { eligible: boolean }) =>
      candidate.eligible === false)).toBe(true);
    await page.close();
  });

  it("reads and clicks English controls when the exact Sports wrapper has no layout box", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      (document.querySelector('.sports-nav') as HTMLElement).style.display = "contents";
      document.querySelector('[data-period="today"]')!.textContent = "Today";
      document.querySelector('[data-period="early"]')!.textContent = "Early";
    });

    const probe = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any> | null;
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true, now: () => clock, wait: async (delayMs) => { clock += delayMs; } });

    expect(probe).toMatchObject({ activePeriod: "TODAY", rowCount: 5 });
    expect(result?.viewRestored).toBe(true);
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks))
      .toEqual(["more", "more", "early", "today"]);
    await page.close();
  });

  it("probes exact More alternate rows, inventories headers, visits Early, and restores Today", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    let clock = 1_000;
    const result = await runSabaNavigationProbe({
      evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true,
      now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }
    });

    expect(result?.viewRestored).toBe(true);
    const body = JSON.parse(result!.body) as Record<string, any>;
    expect(body).toMatchObject({ kind: "SABA_NAVIGATION_PROBE", version: 1,
      status: "COMPLETE_EVIDENCE", coverageClaim: "PUBLIC_STRUCTURE_ONLY" });
    expect(body.today).toMatchObject({ rowCount: 5, eligibleMoreCount: 1,
      timeShapes: { DATED_KICKOFF: 1, PREFIXED_KICKOFF: 1, UNDATED_KICKOFF: 1,
        BARE_LIVE: 1, LIVE_CLOCK: 1, UNKNOWN: 0 } });
    expect(body.today.moreCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerMatchId: "today-more", hasHref: false, hrefKind: "EMPTY",
        eligible: true }),
      expect.objectContaining({ ownerMatchId: "today-prefixed", hasHref: true,
        hrefKind: "NAVIGATION", eligible: false })
    ]));
    expect(body.today.rosterSamples).toEqual(expect.arrayContaining([
      expect.objectContaining({ matchId: "today-clock", timeMetadata: {
        title: "Tomorrow 09/08", dataDate: "2026-09-08",
        dataStartTime: "2026-09-08T02:00:00"
      } })
    ]));
    expect(body.today.rosterSamples.find((row: { matchId: string }) => row.matchId === "today-live")
      .timeMetadata).toEqual({});
    expect(body.early).toMatchObject({ rowCount: 1, eligibleMoreCount: 0 });
    expect(body.expansions).toEqual([expect.objectContaining({ ownerMatchId: "today-more",
      outcome: "ALTERNATE_ROWS_ADDED", addedMatchIds: ["today-corners"], restored: true,
      addedNativeTypes: ["7"], addedMarketIds: ["corner-home", "corner-away"] })]);
    expect(body.today.dateContexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Today 09/07", dataDate: "2026-09-07" })
    ]));
    expect(body.today.headerControls).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "All Markets", tag: "button" }),
      expect.objectContaining({ tag: "select", optionTexts: ["All", "Corner", "Cards"] })
    ]));
    expect(body.early.headerControls).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Corners", tag: "button" })
    ]));
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks)).toEqual([
      "more", "more", "early", "today"
    ]);
    expect(result!.body).not.toMatch(/secret\.invalid|1\.91|9\.99|action|input/iu);
    await page.close();
  });

  it("distinguishes owner-group and panel changes without inferring numeric More membership", () => {
    const base: SabaMoreState = { ownerMatchId: "m1", controlClasses: ["c-is-close"],
      relatedRows: [{ matchId: "m1", teamNames: ["A", "B"], timeText: "11:00PM",
        groupCount: 1, nativeTypes: ["1"], marketIds: ["a", "b"] }], panels: [],
      fingerprint: "before", truncated: false };
    const ownerExpanded: SabaMoreState = { ...base, controlClasses: ["c-is-open"],
      relatedRows: [{ ...base.relatedRows[0]!, groupCount: 2, nativeTypes: ["1", "3"],
        marketIds: ["a", "b", "c", "d"] }], fingerprint: "owner-expanded" };
    const panel: SabaMoreState = { ...base, controlClasses: ["c-is-open"],
      panels: [{ tag: "section", classes: ["all-market-panel"], text: "All Markets" }],
      fingerprint: "panel" };

    expect(classifySabaMoreChange(base, ownerExpanded, true)).toMatchObject({
      outcome: "OWNER_GROUPS_EXPANDED", restored: true, addedNativeTypes: ["3"],
      addedMarketIds: ["c", "d"]
    });
    expect(classifySabaMoreChange(base, panel, true)).toMatchObject({
      outcome: "PANEL_APPEARED", restored: true
    });
    expect(classifySabaMoreChange(base, base, true)).toMatchObject({
      outcome: "NO_STRUCTURAL_CHANGE", restored: true
    });
    expect(classifySabaMoreChange(base, ownerExpanded, false).outcome)
      .toBe("AMBIGUOUS_OR_RESTORE_FAILED");
  });

  it("cancels before the next page action when ownership becomes stale", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    let currentChecks = 0;
    const result = await runSabaNavigationProbe({
      evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => (currentChecks += 1) < 3,
      now: () => 1_000,
      wait: async () => undefined
    });

    expect(result).toBeNull();
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks)).toEqual([]);
    await page.close();
  });

  it("does not mutate an UNKNOWN preflight and reports exact public tab and parent classes", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      const active = document.querySelector('.active-period')!;
      active.className = 'c-side-nav__tab-group';
      active.setAttribute('aria-expanded', 'true');
      active.setAttribute('data-state', 'open');
      const today = active.querySelector('[data-period="today"]')!;
      today.insertAdjacentHTML('beforeend',
        '<span class="tab-marker" style="display:block;width:1px;height:1px" aria-current="page" data-state="selected" aria-label="secret-user-text"></span>');
      active.insertAdjacentHTML('beforeend',
        '<div class="football-pane is-shown" aria-current="true" data-state="active"><a class="safe-link https://secret.invalid" href="https://secret.invalid/account">secret-link-text</a></div>');
      document.querySelector('.sports-nav')!.insertAdjacentHTML('beforeend',
        '<section class="sports-content shown" aria-current="location" data-state="expanded">' +
        '<div class="football-item c-is-active selected-view" style="width:1px;height:1px" aria-selected="true" data-state="current" aria-label="secret-content-label">B\u00f3ng \u0110\u00e1</div></section>' +
        '<div class="c-side-nav__tab">Tr\u1ef1c ti\u1ebfp156</div>');
    });
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true, now: () => clock, wait: async (delayMs) => { clock += delayMs; } });
    const body = JSON.parse(result!.body) as Record<string, any>;

    expect(body).toMatchObject({ status: "NO_ACTION_UNCONFIRMED_SELECTION", mutated: false,
      viewRestored: true });
    expect(body.periodControls).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "Hôm Nay", classes: ["c-side-nav__tab"],
        parentClasses: ["c-side-nav__tab-group"], structure: expect.objectContaining({
          ancestors: expect.arrayContaining([
            expect.objectContaining({ distance: 1, tag: "div",
              classes: ["c-side-nav__tab-group"], ariaExpanded: true, dataState: "OPEN" }),
            expect.objectContaining({ tag: "section",
              classes: ["c-side-nav", "c-side-nav--event", "sports-nav", "current-period"] })
          ]),
          descendants: expect.arrayContaining([
            expect.objectContaining({ path: [0], tag: "span", classes: ["tab-marker"],
              ariaCurrent: "PAGE", dataState: "SELECTED" })
          ]),
          groupDescendants: expect.arrayContaining([
            expect.objectContaining({ tag: "div", classes: ["football-pane", "is-shown"],
              ariaCurrent: "TRUE", dataState: "ACTIVE" })
          ]),
          truncated: false
        }) }),
      expect.objectContaining({ text: "Sớm", classes: ["c-side-nav__tab"] })
      , expect.objectContaining({ text: "Tr\u1ef1c ti\u1ebfp156", period: "LIVE" })
    ]));
    expect(body.initial).toMatchObject({ rowCount: 5, tableCount: 1,
      activePeriod: "UNKNOWN", eligibleMoreCount: 1,
      rosterSamples: expect.arrayContaining([expect.objectContaining({ matchId: "today-more",
        timeText: "09/07 11:00PM" })]),
      moreCandidates: expect.arrayContaining([expect.objectContaining({ ownerMatchId: "today-more",
        eligible: true })]),
      dateContexts: expect.arrayContaining([expect.objectContaining({ dataDate: "2026-09-07" })]),
      headerControls: expect.arrayContaining([expect.objectContaining({ text: "All Markets" })]) });
    expect(body.initial.navRootChildren).toEqual(expect.arrayContaining([
      expect.objectContaining({ childIndex: 3, tag: "section", classes: ["sports-content", "shown"],
        ariaCurrent: "LOCATION", dataState: "EXPANDED" })
    ]));
    expect(body.initial.navRootTopology).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: [3, 0], tag: "div",
        classes: ["football-item", "c-is-active", "selected-view"],
        ariaSelected: true, dataState: "CURRENT", knownLabel: "B\u00f3ng \u0110\u00e1" })
    ]));
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks)).toEqual([]);
    expect(result!.body).not.toMatch(/secret-user-text|secret-link-text|secret\.invalid/iu);
    await page.close();
  });

  it("caps an UNKNOWN initial snapshot while retaining bounded selection evidence", async () => {
    const huge = "x".repeat(160);
    const className = "c".repeat(64);
    const topologyNode = { tag: "div", classes: ["base-node", "c-is-active", "selected-view",
      ...Array.from({ length: 13 }, () => className)],
      visible: true, ariaSelected: null, ariaCurrent: "OTHER", ariaExpanded: null,
      dataState: "OTHER", path: [0, 1, 2, 3, 4] };
    const periodControls = Array.from({ length: 6 }, (_, index) => ({ tag: "div",
      classes: Array.from({ length: 16 }, () => className), text: index === 0 ? "Hôm Nay" : "Sớm",
      period: index === 0 ? "TODAY" : "EARLY", parentTag: "div",
      parentClasses: Array.from({ length: 16 }, () => className), ariaSelected: null,
      ariaCurrent: null, ariaExpanded: null, dataState: null,
      structure: { ancestors: Array.from({ length: 6 }, () => topologyNode),
        descendants: Array.from({ length: 12 }, () => topologyNode),
        groupDescendants: Array.from({ length: 32 }, () => topologyNode), truncated: true } }));
    const initial = { documentToken: "unknown-large", pageNowMs: 1_000, rowCount: 512,
      tableCount: 1, activePeriod: "UNKNOWN" as const, eligibleMoreCount: 0,
      eligibleMoreOwners: [], moreCandidates: [], rosterMatchIds: Array.from({ length: 512 },
        (_, index) => `${index}-${huge}`), rosterSamples: Array.from({ length: 20 }, (_, index) => ({
        matchId: `${index}-${huge}`, timeText: huge, teamNames: [huge, huge], timeMetadata: {} })),
      timeShapes: { UNKNOWN: 512 }, dateContexts: [], headerControls: [], fingerprint: huge,
      periodControls, navRootChildren: Array.from({ length: 16 }, () => topologyNode),
      navRootTopology: Array.from({ length: 96 }, () => topologyNode), truncated: true };

    const result = await runSabaNavigationProbe({ evaluate: async () => initial,
      isCurrent: () => true, now: () => 1_000, wait: async () => undefined });
    const body = JSON.parse(result!.body) as Record<string, any>;

    expect(new TextEncoder().encode(result!.body).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(body).toMatchObject({ status: "NO_ACTION_UNCONFIRMED_SELECTION", mutated: false,
      viewRestored: true, truncated: true,
      initial: { rowCount: 512, tableCount: 1, activePeriod: "UNKNOWN",
        periodControls: expect.any(Array) } });
    expect(body.initial.periodControls[0].structure.ancestors[0].classes)
      .toEqual(expect.arrayContaining(["c-is-active", "selected-view"]));
  });

  it("counts hidden children against each structural walk budget", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      const today = document.querySelector('[data-period="today"]')!;
      for (let index = 0; index < 20; index += 1) {
        today.insertAdjacentHTML('beforeend', `<span class="hidden-node-${index}" hidden></span>`);
      }
      today.insertAdjacentHTML('beforeend',
        '<span class="beyond-visited-budget" style="display:block;width:1px;height:1px"></span>');
    });

    const state = await page.evaluate(SABA_NAVIGATION_PROBE_READ_EXPRESSION) as Record<string, any>;
    const today = state.periodControls.find((control: { period: string }) => control.period === "TODAY");

    expect(today.structure.truncated).toBe(true);
    expect(today.structure.descendants).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ classes: ["beyond-visited-budget"] })
    ]));
    await page.close();
  });

  it("requires 500ms stable after a late period transition instead of accepting near deadline", async () => {
    let clock = 0;
    let activePeriod: "TODAY" | "EARLY" | "UNKNOWN" = "EARLY";
    let switchAt = Number.POSITIVE_INFINITY;
    const actions: string[] = [];
    const state = () => ({ documentToken: "late-period", rowCount: 2, tableCount: 1,
      activePeriod, eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds: ["a", "b"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [],
      periodControls: [], fingerprint: `${activePeriod}:a,b`, truncated: false });
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; if (clock >= switchAt) activePeriod = "TODAY"; },
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return state();
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) {
          const early = expression.includes('==="SOM"');
          actions.push(early ? "early" : "today");
          if (!early && actions.length === 1) { activePeriod = "UNKNOWN"; switchAt = 14_800; }
          else activePeriod = early ? "EARLY" : "TODAY";
          return true;
        }
        return null;
      } });

    expect(JSON.parse(result!.body).status).toBe("AMBIGUOUS_OR_RESTORE_FAILED");
    expect(actions).not.toContain("early");
  });

  it("clamps a settle sleep to the remaining shared probe deadline", async () => {
    let clock = 900;
    const waits: number[] = [];
    const state = { documentToken: "shared-wait", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY" as const, eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: "today:m1", truncated: false };

    await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock, deadlineMs: 950,
      wait: async (delayMs) => { waits.push(delayMs); clock += delayMs; },
      evaluate: async (expression) => expression.includes('.click()') ? true : state });

    expect(waits).toEqual([50]);
    expect(clock).toBe(950);
  });

  it("does not sleep beyond a settle loop's local five-second deadline", async () => {
    let clock = 0;
    const waits: number[] = [];
    let shifted = false;
    const state = () => ({ documentToken: "local-wait", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY" as const, eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: `today:${clock}`, truncated: false });

    await runSabaNavigationProbe({ isCurrent: () => clock < 5_000, now: () => clock,
      wait: async (delayMs) => { waits.push(delayMs); clock += delayMs; },
      evaluate: async (expression) => {
        if (expression.includes('.click()')) return true;
        if (!shifted && clock === 4_900) { shifted = true; clock = 4_975; }
        return state();
      } });

    expect(waits).toHaveLength(50);
    expect(waits.at(-1)).toBe(25);
    expect(clock).toBe(5_000);
  });

  it("traces a non-null page read that consumes the local settle deadline", async () => {
    let clock = 0;
    let reads = 0;
    const state = { documentToken: "slow-read", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY" as const, eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: "today:m1", truncated: false };

    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async () => undefined, evaluate: async () => {
        reads += 1;
        if (reads === 2) clock += 5_000;
        return state;
      } });

    expect(JSON.parse(result!.body).failureTrace).toEqual([expect.objectContaining({
      stage: "INITIAL_TODAY_SETTLE", outcome: "STABILITY_WINDOW_EXHAUSTED",
      reads: 1, elapsedMs: 5_000
    })]);
  });

  it("tolerates a transient PAGE_NULL while Early loads and then completes", async () => {
    let clock = 0;
    let activePeriod: "TODAY" | "EARLY" = "TODAY";
    let earlyReads = 0;
    let evaluationFailure: "PAGE_NULL" | null = null;
    const state = () => ({ documentToken: "transient-early", rowCount: 2, tableCount: 1,
      activePeriod, eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds: ["a", "b"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [], periodControls: [],
      fingerprint: `${activePeriod}:a,b`, truncated: false });
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }, evaluationFailure: () => evaluationFailure,
      evaluate: async (expression) => {
        evaluationFailure = null;
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          if (activePeriod === "EARLY" && earlyReads++ === 0) {
            evaluationFailure = "PAGE_NULL";
            return null;
          }
          return state();
        }
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) {
          activePeriod = expression.includes('==="SOM"') ? "EARLY" : "TODAY";
          return true;
        }
        return null;
      } });

    expect(JSON.parse(result!.body)).toMatchObject({ status: "COMPLETE_EVIDENCE",
      early: { activePeriod: "EARLY" }, viewRestored: true });
  });

  it("bounds persistent PAGE_NULL page settling with an explicit trace and no completion", async () => {
    let clock = 0;
    let activePeriod: "TODAY" | "EARLY" = "TODAY";
    let evaluationFailure: "PAGE_NULL" | null = null;
    const state = () => ({ documentToken: "persistent-null", rowCount: 2, tableCount: 1,
      activePeriod, eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds: ["a", "b"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [], periodControls: [],
      fingerprint: `${activePeriod}:a,b`, truncated: false });
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }, evaluationFailure: () => evaluationFailure,
      evaluate: async (expression) => {
        evaluationFailure = null;
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          if (activePeriod === "EARLY") {
            evaluationFailure = "PAGE_NULL";
            return null;
          }
          return state();
        }
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) {
          activePeriod = expression.includes('==="SOM"') ? "EARLY" : "TODAY";
          return true;
        }
        return null;
      } });
    const body = JSON.parse(result!.body);

    expect(body.status).toBe("AMBIGUOUS_OR_RESTORE_FAILED");
    expect(body.early).toBeNull();
    expect(body.failureTrace).toEqual(expect.arrayContaining([expect.objectContaining({
      stage: "EARLY_SETTLE", outcome: "LAST_READ_ABSENT", evaluationFailure: "PAGE_NULL",
      elapsedMs: 15_000
    })]));
  });

  it("allows a guarded Early transition six seconds to change and then prove 500ms stable", async () => {
    let clock = 0;
    let activePeriod: "TODAY" | "EARLY" = "TODAY";
    const state = () => ({ documentToken: "delayed-early", rowCount: 2, tableCount: 1,
      activePeriod, eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds: ["a", "b"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [], periodControls: [],
      fingerprint: activePeriod === "EARLY" && clock < 6_500 ? `EARLY:${clock}` : `${activePeriod}:stable`,
      truncated: false });
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }, evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return state();
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) {
          activePeriod = expression.includes('==="SOM"') ? "EARLY" : "TODAY";
          return true;
        }
        return null;
      } });

    expect(JSON.parse(result!.body)).toMatchObject({ status: "COMPLETE_EVIDENCE",
      early: { activePeriod: "EARLY" }, viewRestored: true });
  });

  it("caps post-navigation page settling at the remaining shared deadline", async () => {
    let clock = 0;
    let activePeriod: "TODAY" | "EARLY" = "TODAY";
    const waits: number[] = [];
    const state = () => ({ documentToken: "period-shared-cap", rowCount: 2, tableCount: 1,
      activePeriod, eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds: ["a", "b"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [], periodControls: [],
      fingerprint: activePeriod === "TODAY" ? "TODAY:stable" : `EARLY:${clock}`, truncated: false });
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      deadlineMs: 6_000, wait: async (delayMs) => { waits.push(delayMs); clock += delayMs; },
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return state();
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) {
          activePeriod = expression.includes('==="SOM"') ? "EARLY" : "TODAY";
          return true;
        }
        return null;
      } });

    expect(clock).toBe(6_000);
    expect(waits.every((delayMs) => delayMs <= 100)).toBe(true);
    expect(JSON.parse(result!.body).status).not.toBe("COMPLETE_EVIDENCE");
  });

  it("requires a fresh 500ms stable window after a PAGE_NULL between matching Early reads", async () => {
    let clock = 0;
    let activePeriod: "TODAY" | "EARLY" = "TODAY";
    let earlyReads = 0;
    let finalTodayClickAt = -1;
    let evaluationFailure: "PAGE_NULL" | null = null;
    const state = () => ({ documentToken: "null-gap", rowCount: 2, tableCount: 1,
      activePeriod, eligibleMoreCount: 0, eligibleMoreOwners: [], rosterMatchIds: ["a", "b"],
      rosterSamples: [], timeShapes: {}, dateContexts: [], headerControls: [], periodControls: [],
      fingerprint: `${activePeriod}:a,b`, truncated: false });
    await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }, evaluationFailure: () => evaluationFailure,
      evaluate: async (expression) => {
        evaluationFailure = null;
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) {
          if (activePeriod === "EARLY" && earlyReads++ === 1) {
            evaluationFailure = "PAGE_NULL";
            return null;
          }
          return state();
        }
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) {
          const early = expression.includes('==="SOM"');
          if (!early && activePeriod === "EARLY") finalTodayClickAt = clock;
          activePeriod = early ? "EARLY" : "TODAY";
          return true;
        }
        return null;
      } });

    expect(finalTodayClickAt).toBeGreaterThanOrEqual(1_200);
  });

  it("traces later period action failures with their actual elapsed times", async () => {
    let clock = 0;
    let actionCount = 0;
    const state = { documentToken: "later-actions", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY", eligibleMoreCount: 0, eligibleMoreOwners: [],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: "TODAY:m1", truncated: false };
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; },
      evaluationFailure: () => "FRAME_COMMAND_TIMEOUT",
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return state;
        if (expression.includes('.click()')) { actionCount += 1; clock += 2_500; return null; }
        throw new Error("unexpected probe read");
      } });

    expect(actionCount).toBe(3);
    expect(result?.viewRestored).toBe(false);
    expect(JSON.parse(result!.body).failureTrace).toEqual([
      { stage: "EARLY_ACTION", outcome: "ACTION_UNCONFIRMED", reads: 1,
        elapsedMs: 2_500, evaluationFailure: "FRAME_COMMAND_TIMEOUT" },
      { stage: "FINAL_TODAY_ACTION", outcome: "ACTION_UNCONFIRMED", reads: 1,
        elapsedMs: 2_500, evaluationFailure: "FRAME_COMMAND_TIMEOUT" },
      { stage: "FINAL_TODAY_RETRY_ACTION", outcome: "ACTION_UNCONFIRMED", reads: 1,
        elapsedMs: 2_500, evaluationFailure: "FRAME_COMMAND_TIMEOUT" }
    ]);
  });

  it("traces a More restore action failure without reporting restoration", async () => {
    let clock = 0;
    let moreClicks = 0;
    const state = { documentToken: "restore-trace", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY", eligibleMoreCount: 1, eligibleMoreOwners: ["m1"],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: "TODAY:m1", truncated: false };
    const before: SabaMoreState = { ownerMatchId: "m1", controlClasses: ["c-is-close"],
      relatedRows: [{ matchId: "m1", teamNames: [], timeText: "11:00PM", groupCount: 1,
        nativeTypes: ["1"], marketIds: ["a"] }], panels: [], fingerprint: "before", truncated: false };
    const after: SabaMoreState = { ...before, controlClasses: ["c-is-open"], fingerprint: "after" };
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }, evaluationFailure: () => "CONTEXT_UNAVAILABLE",
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return state;
        if (expression.includes('control.click')) {
          moreClicks += 1;
          if (moreClicks === 1) return true;
          clock += 700; return null;
        }
        if (expression.includes('.click()')) return true;
        if (expression.includes('relatedRows')) return moreClicks === 0 ? before : after;
        throw new Error("unexpected probe read");
      } });

    expect(moreClicks).toBe(2);
    expect(result?.viewRestored).toBe(false);
    expect(JSON.parse(result!.body).failureTrace).toEqual([
      { stage: "MORE_RESTORE_ACTION", ownerMatchId: "m1", outcome: "ACTION_UNCONFIRMED",
        reads: 1, elapsedMs: 700, evaluationFailure: "CONTEXT_UNAVAILABLE" }
    ]);
  });

  it("does not click More again for unrelated drift without owner expansion or open transition", async () => {
    let clock = 0;
    let moreClicks = 0;
    const pageState = { documentToken: "unrelated", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY", eligibleMoreCount: 1, eligibleMoreOwners: ["m1"],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: "TODAY:m1", truncated: false };
    const before: SabaMoreState = { ownerMatchId: "m1", controlClasses: ["c-is-close"],
      relatedRows: [{ matchId: "m1", teamNames: ["A", "B"], timeText: "11:00PM",
        groupCount: 1, nativeTypes: ["1"], marketIds: ["a", "b"] }], panels: [],
      fingerprint: "before", truncated: false };
    const unrelated: SabaMoreState = { ...before,
      panels: [{ tag: "section", classes: ["unrelated-panel"], text: "Other" }],
      fingerprint: "unrelated" };
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }, evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return pageState;
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) return true;
        if (expression.includes('control.click') && expression.includes('c-btn--more')) {
          moreClicks += 1; return true;
        }
        if (expression.includes('relatedRows')) return moreClicks === 0 ? before : unrelated;
        return null;
      } });

    expect(moreClicks).toBe(1);
    expect(JSON.parse(result!.body).expansions[0]).toMatchObject({
      outcome: "AMBIGUOUS_OR_RESTORE_FAILED", restored: false
    });
  });

  it("rejects a More transition that leaves less than 500ms stable before its settle deadline", async () => {
    let clock = 0;
    let moreClicks = 0;
    let expanded = false;
    const pageState = { documentToken: "late-more", rowCount: 1, tableCount: 1,
      activePeriod: "TODAY", eligibleMoreCount: 1, eligibleMoreOwners: ["m1"],
      rosterMatchIds: ["m1"], rosterSamples: [], timeShapes: {}, dateContexts: [],
      headerControls: [], periodControls: [], fingerprint: "TODAY:m1", truncated: false };
    const before: SabaMoreState = { ownerMatchId: "m1", controlClasses: ["c-is-close"],
      relatedRows: [{ matchId: "m1", teamNames: [], timeText: "11:00PM", groupCount: 1,
        nativeTypes: ["1"], marketIds: ["a"] }], panels: [], fingerprint: "before", truncated: false };
    const after: SabaMoreState = { ...before, controlClasses: ["c-is-open"],
      relatedRows: [{ ...before.relatedRows[0]!, groupCount: 2, marketIds: ["a", "b"] }],
      fingerprint: "after" };
    const result = await runSabaNavigationProbe({ isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; if (clock >= 5_300) expanded = true; },
      evaluate: async (expression) => {
        if (expression === SABA_NAVIGATION_PROBE_READ_EXPRESSION) return pageState;
        if (expression.includes('.c-side-nav__tab') && expression.includes('.click()')) return true;
        if (expression.includes('control.click') && expression.includes('c-btn--more')) {
          moreClicks += 1; return true;
        }
        if (expression.includes('relatedRows')) return expanded ? after :
          (Math.floor(clock / 100) % 2 === 0 ? before : { ...before, fingerprint: "before-jitter" });
        return null;
      } });

    const body = JSON.parse(result!.body);
    expect(body.status).toBe("AMBIGUOUS_OR_RESTORE_FAILED");
    expect(body.failureTrace).toEqual(expect.arrayContaining([expect.objectContaining({
      stage: "MORE_AFTER_SETTLE", ownerMatchId: "m1", outcome: "FINGERPRINT_UNSTABLE",
      reads: expect.any(Number), elapsedMs: 5_000,
      before: expect.objectContaining({ relatedRowCount: 1, marketIdCount: 1 }),
      last: expect.objectContaining({ relatedRowCount: 1, marketIdCount: 2 })
    })]));
    expect(moreClicks).toBe(1);
  });

  it("reports the exact safe More-read guard without exposing page content", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    let removed = false;
    let clock = 1_000;
    const result = await runSabaNavigationProbe({
      evaluate: async (expression) => {
        if (!removed && expression.includes('relatedRows')) {
          removed = true;
          await page.evaluate(() => document.querySelector('[data-matchid="today-more"]')!.remove());
        }
        return page.evaluate(expression);
      },
      isCurrent: () => true, now: () => clock,
      wait: async (delayMs) => { clock += delayMs; }
    });
    const body = JSON.parse(result!.body);

    expect(body.reason).toBe("MORE_BEFORE_UNAVAILABLE");
    expect(body.failureTrace).toEqual(expect.arrayContaining([{
      stage: "MORE_BEFORE", ownerMatchId: "today-more", outcome: "LAST_READ_ABSENT",
      reads: 1, elapsedMs: 0, guard: "OWNER_ABSENT"
    }]));
    expect(JSON.stringify(body.failureTrace)).not.toMatch(/Alpha|Beta|secret|https?:/iu);
    await page.close();
  });

  it("fails closed when an exact More owner cannot be restored", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      const old = document.querySelector('.c-btn--more')!;
      const replacement = old.cloneNode(true) as HTMLElement;
      old.replaceWith(replacement);
      replacement.addEventListener('click', () => {
        const state = globalThis as unknown as { clicks: string[] };
        state.clicks.push('more');
        replacement.classList.remove('c-is-close');
        replacement.classList.add('c-is-open');
        if (!document.querySelector('[data-matchid="unrestored"]')) {
          replacement.closest('.c-match')!.insertAdjacentHTML('afterend',
            '<div class="c-match" data-matchid="unrestored"><span class="c-match-time">09/07 11:00PM</span></div>');
        }
      });
    });
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true, now: () => clock, wait: async (delayMs) => { clock += delayMs; } });
    const body = JSON.parse(result!.body) as Record<string, any>;

    expect(result?.viewRestored).toBe(false);
    expect(body.status).toBe("AMBIGUOUS_OR_RESTORE_FAILED");
    expect(body.expansions[0]).toMatchObject({ outcome: "AMBIGUOUS_OR_RESTORE_FAILED",
      restored: false, addedMatchIds: ["unrestored"] });
    expect(await page.evaluate(() => (globalThis as unknown as { clicks: string[] }).clicks))
      .toEqual(["more", "more", "today", "today"]);
    await page.close();
  });

  it("caps the terminal diagnostic at 64 KiB and every public string", async () => {
    const page = await browser.newPage();
    await installProbeFixture(page);
    await page.evaluate(() => {
      const long = "X".repeat(2_000);
      for (let index = 0; index < 100; index += 1) {
        document.querySelector('#today-view')!.insertAdjacentHTML('beforeend',
          `<div class="header-${index}"><button class="all-market-${index}">${long}</button></div>`);
      }
    });
    let clock = 1_000;
    const result = await runSabaNavigationProbe({ evaluate: (expression) => page.evaluate(expression),
      isCurrent: () => true, now: () => clock, wait: async (delayMs) => { clock += delayMs; } });

    expect(new TextEncoder().encode(result!.body).byteLength).toBeLessThanOrEqual(64 * 1024);
    expect(result!.body).not.toContain("X".repeat(513));
    await page.close();
  });

  it("propagates capped More-state evidence to the diagnostic", () => {
    const state: SabaMoreState = { ownerMatchId: "m1", controlClasses: ["c-is-close"],
      relatedRows: [], panels: [], fingerprint: "same", truncated: true };
    expect(classifySabaMoreChange(state, { ...state, truncated: false }, true)).toMatchObject({
      outcome: "NO_STRUCTURAL_CHANGE", truncated: true
    });
  });

  it("dispatches no evaluation or action at exact total-deadline equality", async () => {
    const evaluate = vi.fn(async () => null);
    const result = await runSabaNavigationProbe({ evaluate, isCurrent: () => true,
      now: () => 5_000, deadlineMs: 5_000, wait: async () => undefined });

    expect(result).toBeNull();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
