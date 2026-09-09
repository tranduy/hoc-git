import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import type { SabaCollectorBinding, SabaCollectorRosterOwner } from
  "./saba-hidden-market-collector.js";
import { createSabaHiddenMarketPageAdapter, type SabaPeriodUnstableDiagnostic,
  type SabaRestoreRosterMismatchDiagnostic,
  type SabaUnrepresentedOwnerDiagnostic } from
  "./saba-hidden-market-page.js";

const BINDING: SabaCollectorBinding = {
  sourceEpoch: "worker-a:1",
  frameKey: "sports-frame",
  documentKey: "collector-document-1"
};

function firstOwner(): SabaCollectorRosterOwner {
  return { ownerMatchId: "match-0", control: "ELIGIBLE_MORE",
    kickoffDate: { kind: "EXPLICIT", isoDate: "2026-09-09" },
    capturedAtMs: 0, capturedMonotonicMs: 0,
    record: { sportId: "1", leagueId: "league-1", leagueName: "League One",
      matchId: "match-0", timeText: "11:00PM", teamNames: ["Home 0", "Away 0"],
      groups: [{ betTypeIds: ["3"], labels: [], odds: [
        { marketOddsId: "market-0", priceText: "0.91", status: null, greyedOut: null },
        { marketOddsId: "market-0", priceText: "-0.95", status: null, greyedOut: null }
      ] }] } };
}

async function installRoster(page: Page, ownerCount: number): Promise<void> {
  const rows = Array.from({ length: ownerCount }, (_, index) => `
    <div class="c-match" data-matchid="match-${index}">
      <span class="c-match-time">11:00PM</span>
      <span class="c-team-name">Home ${index}</span>
      <span class="c-team-name">Away ${index}</span>
      <div class="c-match__odds-group"><div data-bt="3">
        <span class="c-odds" data-moid="market-${index}">0.91</span>
        <span class="c-odds" data-moid="market-${index}">-0.95</span>
      </div></div>
      ${index === 0 ? '<a class="c-btn c-btn--more c-is-close">2</a>' : ""}
    </div>`).join("");
  await page.setContent(`
    <span id="systemTime" class="c-header__time">04:29:28AM Sep09,2026GMT+8</span>
    <style>
      .c-side-nav,.c-side-nav__header,.c-side-nav__tab,.c-odds-table--sport1,
      .c-match,.c-match-time,.c-team-name,.c-btn { display:block; width:120px; min-height:12px }
    </style>
    <section class="c-side-nav c-side-nav--event">
      <div class="c-side-nav__header"><span class="c-text">Sports</span></div>
      <div class="active"><div class="c-side-nav__tab" data-period="today">Today</div></div>
      <div><div class="c-side-nav__tab" data-period="early">Early</div></div>
    </section>
    <section class="c-odds-table--sport1" data-date="2026-09-09">
      <div class="c-league" data-leagueid="league-1">
        <span class="c-league__name">League One</span>${rows}
      </div>
    </section>`);
  await page.evaluate((documentKey) => {
    (globalThis as unknown as { __fieldlineSabaNavigationProbeDocV1: string })
      .__fieldlineSabaNavigationProbeDocV1 = documentKey;
  }, BINDING.documentKey);
}

async function installDelayedOwnerExpansion(page: Page, delayMs = 650): Promise<void> {
  await page.evaluate((delay) => {
    const state = globalThis as unknown as { moreClicks: string[]; openedAt?: number; closedAt?: number };
    state.moreClicks = [];
    const owner = document.querySelector('[data-matchid="match-0"]')!;
    const control = owner.querySelector('.c-btn--more')!;
    control.addEventListener('click', () => {
      if (control.classList.contains('c-is-close')) {
        state.moreClicks.push('open');
        setTimeout(() => {
          control.classList.remove('c-is-close');
          control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
            <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
            <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
          state.openedAt = Date.now();
        }, delay);
        return;
      }
      state.moreClicks.push('close');
      owner.querySelector('.collector-extra')?.remove();
      control.classList.remove('c-is-open');
      control.classList.add('c-is-close');
      state.closedAt = Date.now();
    });
  }, delayMs);
}

type RestoreRosterMutation = "REORDER" | "ADDED" | "MISSING" | "CONTROL" |
  "TIME" | "DATE" | "DUPLICATE" | "CATALOG_MEMBERSHIP" | "REPLACED" | "UNSAFE_ADDED";

type OpenRosterMutation = "GROWTH_253" | "GROWTH_OTHER_CONTROL" | "GROWTH_OLD_TIME" |
  "GROWTH_OLD_DATE" | "UNSAFE_ADDED" | "DUPLICATE";

async function installImmediateOpenRosterMutation(page: Page,
  mutation: OpenRosterMutation): Promise<void> {
  await page.evaluate((selectedMutation) => {
    const owner = document.querySelector('[data-matchid="match-0"]')!;
    const second = document.querySelector('[data-matchid="match-1"]')!;
    const control = owner.querySelector('.c-btn--more')!;
    control.addEventListener('click', () => {
      if (control.classList.contains('c-is-close')) {
        control.classList.remove('c-is-close'); control.classList.add('c-is-open');
        owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
          <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
          <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
        if (selectedMutation === 'GROWTH_253') {
          const league = owner.closest('.c-league')!;
          for (let index = 20; index < 253; index += 1) {
            const added = second.cloneNode(true) as Element;
            added.setAttribute('data-matchid', `match-${index}`);
            added.querySelectorAll('[data-moid]').forEach((node) =>
              node.setAttribute('data-moid', `market-${index}`));
            league.append(added);
          }
        }
        if (selectedMutation === 'GROWTH_OTHER_CONTROL' ||
          selectedMutation === 'GROWTH_OLD_TIME' || selectedMutation === 'GROWTH_OLD_DATE') {
          const added = second.cloneNode(true) as Element;
          added.classList.add('open-test-growth');
          added.setAttribute('data-matchid', 'match-added');
          added.querySelectorAll('[data-moid]').forEach((node) =>
            node.setAttribute('data-moid', 'market-added'));
          second.after(added);
        }
        if (selectedMutation === 'GROWTH_OTHER_CONTROL') {
          second.insertAdjacentHTML('beforeend',
            '<a class="c-btn c-btn--more c-is-close open-test-mutation">2</a>');
        }
        if (selectedMutation === 'GROWTH_OLD_TIME') {
          second.querySelector('.c-match-time')!.textContent = '09/10 11:00PM';
        }
        if (selectedMutation === 'GROWTH_OLD_DATE') second.setAttribute('data-date', '2026-09-10');
        if (selectedMutation === 'UNSAFE_ADDED' || selectedMutation === 'DUPLICATE') {
          const added = second.cloneNode(true) as Element;
          added.classList.add('open-test-mutation');
          if (selectedMutation === 'UNSAFE_ADDED') {
            added.setAttribute('data-matchid', 'match-added');
            added.querySelectorAll('[data-moid]').forEach((node) =>
              node.setAttribute('data-moid', 'market-added'));
            added.insertAdjacentHTML('beforeend', '<a class="c-btn c-btn--more c-is-open">2</a>');
          }
          second.after(added);
        }
        return;
      }
      owner.querySelector('.collector-extra')?.remove();
      control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      document.querySelector('.open-test-growth')?.remove();
      if (selectedMutation === 'GROWTH_OTHER_CONTROL') second.querySelector('.open-test-mutation')?.remove();
      if (selectedMutation === 'GROWTH_OLD_TIME') second.querySelector('.c-match-time')!.textContent = '11:00PM';
      if (selectedMutation === 'GROWTH_OLD_DATE') second.removeAttribute('data-date');
      if (selectedMutation === 'UNSAFE_ADDED' || selectedMutation === 'DUPLICATE') {
        document.querySelector('.c-match.open-test-mutation')?.remove();
      }
    });
  }, mutation);
}

async function installImmediateOwnerExpansionWithRestoreMutation(page: Page,
  mutation: RestoreRosterMutation): Promise<void> {
  await page.evaluate((selectedMutation) => {
    const owner = document.querySelector('[data-matchid="match-0"]')!;
    const control = owner.querySelector('.c-btn--more')!;
    const forceReorderedRoster = () => {
      const league = owner.closest('.c-league')!;
      const rows = Array.from(league.querySelectorAll(':scope > .c-match'));
      const second = rows.find((row) => row.getAttribute('data-matchid') === 'match-1');
      const first = rows.find((row) => row.getAttribute('data-matchid') === 'match-0');
      if (second && first) league.append(second, first);
    };
    control.addEventListener('click', () => {
      if (control.classList.contains('c-is-close')) {
        control.classList.remove('c-is-close'); control.classList.add('c-is-open');
        owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
          <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
          <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
        if (selectedMutation === 'REORDER') forceReorderedRoster();
        return;
      }
      owner.querySelector('.collector-extra')?.remove();
      control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      const second = document.querySelector('[data-matchid="match-1"]')!;
      if (selectedMutation === 'REORDER') forceReorderedRoster();
      if (selectedMutation === 'ADDED') {
        const added = second.cloneNode(true) as Element;
        added.setAttribute('data-matchid', 'match-added');
        added.querySelectorAll('[data-moid]').forEach((node) => node.setAttribute('data-moid', 'market-added'));
        second.after(added);
      }
      if (selectedMutation === 'REPLACED') {
        const added = second.cloneNode(true) as Element;
        added.setAttribute('data-matchid', 'match-added');
        added.querySelectorAll('[data-moid]').forEach((node) => node.setAttribute('data-moid', 'market-added'));
        second.replaceWith(added);
      }
      if (selectedMutation === 'UNSAFE_ADDED') {
        const added = second.cloneNode(true) as Element;
        added.setAttribute('data-matchid', 'match-added');
        added.querySelectorAll('[data-moid]').forEach((node) => node.setAttribute('data-moid', 'market-added'));
        added.insertAdjacentHTML('beforeend', '<a class="c-btn c-btn--more c-is-open">2</a>');
        second.after(added);
      }
      if (selectedMutation === 'MISSING') second.remove();
      if (selectedMutation === 'CONTROL') {
        second.insertAdjacentHTML('beforeend', '<a class="c-btn c-btn--more c-is-close">2</a>');
      }
      if (selectedMutation === 'TIME') second.querySelector('.c-match-time')!.textContent = '09/10 11:00PM';
      if (selectedMutation === 'DATE') second.setAttribute('data-date', '2026-09-10');
      if (selectedMutation === 'DUPLICATE') second.after(second.cloneNode(true));
      if (selectedMutation === 'CATALOG_MEMBERSHIP') {
        second.closest('.c-odds-table--sport1')!.append(second);
      }
    });
  }, mutation);
}

describe("SABA hidden-market page adapter", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it("reads every prematch owner without a 20-owner cap and keeps read-time clocks", async () => {
    const page = await browser.newPage();
    await installRoster(page, 25);
    let wallClock = 1_000;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => wallClock, monotonicNow: () => 77,
      wait: async (delayMs) => { wallClock += delayMs; } });

    const result = await adapter.readRoster("TODAY");

    expect(result).toMatchObject({ binding: BINDING, period: "TODAY", selectedPrematch: true });
    expect(result.owners).toHaveLength(25);
    expect(result.owners[0]).toMatchObject({ ownerMatchId: "match-0", control: "ELIGIBLE_MORE",
      kickoffDate: { kind: "EXPLICIT", isoDate: "2026-09-09" },
      capturedAtMs: 1_500, capturedMonotonicMs: 77,
      record: { matchId: "match-0", timeText: "11:00PM", groups: [{ betTypeIds: ["3"] }] } });
    expect(result.owners[24]).toMatchObject({ ownerMatchId: "match-24",
      control: "NO_ELIGIBLE_CONTROL", capturedAtMs: 1_500, capturedMonotonicMs: 77 });
    await page.close();
  });

  it("waits for a queued owner to join two stable closed reads before opening More", async () => {
    const page = await browser.newPage();
    await installRoster(page, 20);
    let phaseReads = 0;
    let clock = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: async (expression) => {
        const value = await page.evaluate(expression);
        if (expression.includes(CMD_PUBLIC_CATALOG_EXPRESSION) && ++phaseReads === 2) {
          await page.evaluate(() => {
            const league = document.querySelector('.c-league')!;
            const template = document.querySelector('[data-matchid="match-1"]')!;
            for (let index = 20; index < 253; index += 1) {
              const added = template.cloneNode(true) as Element;
              added.setAttribute('data-matchid', `match-${index}`);
              added.querySelectorAll('[data-moid]').forEach((node) =>
                node.setAttribute('data-moid', `market-${index}`));
              if (index === 252) {
                added.insertAdjacentHTML('beforeend', '<a class="c-btn c-btn--more c-is-close">2</a>');
                const control = added.querySelector('.c-btn--more')!;
                control.addEventListener('click', () => {
                  const opening = control.classList.contains('c-is-close');
                  control.classList.toggle('c-is-close', !opening);
                  control.classList.toggle('c-is-open', opening);
                });
              }
              league.append(added);
            }
          });
        }
        return value;
      },
      isCurrent: () => true, now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { clock += delayMs; } });
    const queuedOwner: SabaCollectorRosterOwner = { ...firstOwner(), ownerMatchId: "match-252",
      record: { ...firstOwner().record, matchId: "match-252", teamNames: ["Home 1", "Away 1"],
        groups: [{ ...firstOwner().record.groups[0]!, odds: firstOwner().record.groups[0]!.odds.map(
          (odd) => ({ ...odd, marketOddsId: "market-252" })) }] } };

    await expect(adapter.captureOwner("TODAY", queuedOwner)).resolves.toMatchObject({
      ownerMatchId: "match-252", controlOpened: true, restored: true,
      safeControlOutcome: "NO_STRUCTURAL_CHANGE"
    });
    expect(phaseReads).toBeGreaterThanOrEqual(8);
    await page.close();
  });

  it("distinguishes absent and noneligible requested-owner preparation", async () => {
    const absentPage = await browser.newPage();
    await installRoster(absentPage, 2);
    let absentClock = 0;
    const absentDiagnostics: SabaPeriodUnstableDiagnostic[] = [];
    const absent = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => absentPage.evaluate(expression), isCurrent: () => true,
      now: () => absentClock, monotonicNow: () => absentClock,
      wait: async (delayMs) => { absentClock += delayMs; },
      onPeriodUnstable: (diagnostic) => absentDiagnostics.push(diagnostic) });
    const missingOwner = { ...firstOwner(), ownerMatchId: "match-missing",
      record: { ...firstOwner().record, matchId: "match-missing" } };
    await expect(absent.captureOwner("TODAY", missingOwner))
      .rejects.toThrow("SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT");
    expect(absentDiagnostics.at(-1)?.ownerPreparationReason).toBe("OWNER_ABSENT");
    await absentPage.close();

    const controlPage = await browser.newPage();
    await installRoster(controlPage, 2);
    let controlClock = 0;
    const controlDiagnostics: SabaPeriodUnstableDiagnostic[] = [];
    const noneligible = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => controlPage.evaluate(expression), isCurrent: () => true,
      now: () => controlClock, monotonicNow: () => controlClock,
      wait: async (delayMs) => { controlClock += delayMs; },
      onPeriodUnstable: (diagnostic) => controlDiagnostics.push(diagnostic) });
    const owner = { ...firstOwner(), ownerMatchId: "match-1",
      record: { ...firstOwner().record, matchId: "match-1", teamNames: ["Home 1", "Away 1"],
        groups: [{ ...firstOwner().record.groups[0]!, odds: firstOwner().record.groups[0]!.odds.map(
          (odd) => ({ ...odd, marketOddsId: "market-1" })) }] } };
    await expect(noneligible.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_PREP_CONTROL_NOT_ELIGIBLE");
    expect(controlDiagnostics.at(-1)?.ownerPreparationReason).toBe("CONTROL_NOT_ELIGIBLE");
    expect(await controlPage.locator('.c-btn--more.c-is-open').count()).toBe(0);
    await controlPage.close();
  });

  it("waits for a stable requested-owner More fingerprint before preparation succeeds", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    let phaseReads = 0;
    let clock = 0;
    const diagnostics: SabaPeriodUnstableDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: async (expression) => {
        const value = await page.evaluate(expression);
        if (expression.includes(CMD_PUBLIC_CATALOG_EXPRESSION)) {
          phaseReads += 1;
          await page.evaluate((odd) => {
            document.querySelectorAll('[data-moid]').forEach((node) =>
              node.setAttribute('data-moid', odd ? 'market-odd' : 'market-even'));
          }, phaseReads % 2 === 1);
        }
        return value;
      }, isCurrent: () => true, now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { clock += delayMs; },
      onPeriodUnstable: (diagnostic) => diagnostics.push(diagnostic) });

    await expect(adapter.captureOwner("TODAY", firstOwner()))
      .rejects.toThrow("SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT");
    expect(diagnostics.at(-1)?.ownerPreparationReason).toBe("FINGERPRINT_UNSTABLE");
    expect(phaseReads).toBeGreaterThan(2);
    await page.close();
  });

  it("classifies an outer deadline crossed during owner preparation without opening More", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const state = globalThis as unknown as { moreClicks: number };
      state.moreClicks = 0;
      document.querySelector('.c-btn--more')?.addEventListener('click', () => {
        state.moreClicks += 1;
      });
    });
    let clock = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: async (expression) => {
        const value = await page.evaluate(expression);
        if (expression.includes(CMD_PUBLIC_CATALOG_EXPRESSION)) clock = 30_000;
        return value;
      },
      isCurrent: () => true, now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { clock += delayMs; } });

    await expect(adapter.captureOwner("TODAY", firstOwner()))
      .rejects.toThrow("SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT");
    expect(await page.evaluate(() =>
      (globalThis as unknown as { moreClicks: number }).moreClicks)).toBe(0);
    await page.close();
  });

  it("waits for a late More open, captures owner groups while open, and restores closed", async () => {
    const page = await browser.newPage();
    const initialMs = Date.parse("2026-09-08T00:00:00Z");
    await page.clock.install({ time: initialMs });
    let clock = initialMs;
    await installRoster(page, 2);
    await installDelayedOwnerExpansion(page);
    let evaluateCount = 0;
    const diagnostics: SabaUnrepresentedOwnerDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => { evaluateCount += 1; return page.evaluate(expression); },
      isCurrent: () => true, now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { await page.clock.runFor(delayMs); clock += delayMs; },
      onUnrepresentedOwner: (diagnostic) => diagnostics.push(diagnostic) });
    const result = await adapter.captureOwner("TODAY", firstOwner());
    const browserState = await page.evaluate(() => {
      const state = globalThis as unknown as { moreClicks: string[]; openedAt?: number; closedAt?: number };
      return { moreClicks: state.moreClicks, openedAt: state.openedAt, closedAt: state.closedAt,
        closed: document.querySelector('[data-matchid="match-0"] .c-btn--more')!
        .classList.contains('c-is-close') };
    });

    expect(result).toMatchObject({ binding: BINDING, period: "TODAY", ownerMatchId: "match-0",
      controlOpened: true, terminalControlState: "RESTORED_CLOSED", restored: true,
      safeControlOutcome: "OWNER_GROUPS_EXPANDED",
      capture: { record: { matchId: "match-0", groups: [
        { betTypeIds: ["3"] }, { betTypeIds: ["15"], odds: [
          { marketOddsId: "owner-extra" }, { marketOddsId: "owner-extra" }] }
      ] } } });
    expect(browserState).toMatchObject({ moreClicks: ["open", "close"], closed: true });
    expect(result.capture!.capturedAtMs).toBeGreaterThanOrEqual(browserState.openedAt!);
    expect(result.capture!.capturedAtMs).toBeLessThanOrEqual(browserState.closedAt!);
    expect(evaluateCount).toBe(10);
    expect(diagnostics).toEqual([]);
    await page.close();
  });

  it("accepts identical per-match metadata when More reorders the public roster", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(page, "REORDER");
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners.find(({ ownerMatchId }) =>
      ownerMatchId === "match-0")!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({
      safeControlOutcome: "OWNER_GROUPS_EXPANDED", restored: true
    });
    await page.close();
  });

  it("accepts stable append-only More restoration growth with unique safe catalog records", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(page, "ADDED");
    const diagnostics: SabaRestoreRosterMismatchDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      onRestoreRosterMismatch: (diagnostic) => diagnostics.push(diagnostic) });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({
      ownerMatchId: "match-0", restored: true, terminalControlState: "RESTORED_CLOSED"
    });
    expect(diagnostics).toEqual([]);
    await page.close();
  });

  it("rejects append-only metadata growth whose added owner has ambiguous catalog records", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(page, "ADDED");
    const diagnostics: SabaRestoreRosterMismatchDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: async (expression) => {
        const value = await page.evaluate(expression) as unknown;
        if (typeof value !== "object" || value === null || !("catalog" in value) ||
          typeof value.catalog !== "string") return value;
        const records = JSON.parse(value.catalog) as Array<{ matchId?: string }>;
        const added = records.find(({ matchId }) => matchId === "match-added");
        return added === undefined ? value : { ...value, catalog: JSON.stringify([...records, added]) };
      }, isCurrent: () => true,
      onRestoreRosterMismatch: (diagnostic) => diagnostics.push(diagnostic) });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_RESTORE_METADATA_MEMBERSHIP");
    expect(diagnostics).toHaveLength(1);
    await page.close();
  });

  it("accepts the observed 20 to 253 stable append-only restoration without weakening owner guards", async () => {
    const page = await browser.newPage();
    await installRoster(page, 20);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
            <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
            <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
          return;
        }
        owner.querySelector('.collector-extra')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
        const league = owner.closest('.c-league')!;
        const template = document.querySelector('[data-matchid="match-1"]')!;
        for (let index = 20; index < 253; index += 1) {
          const added = template.cloneNode(true) as Element;
          added.setAttribute('data-matchid', `match-${index}`);
          added.querySelectorAll('[data-moid]').forEach((node) =>
            node.setAttribute('data-moid', `market-${index}`));
          const old = league.querySelector(`[data-matchid="match-${index % 20}"]`);
          if (old) old.before(added); else league.append(added);
        }
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({
      ownerMatchId: "match-0", restored: true, terminalControlState: "RESTORED_CLOSED"
    });
    await page.close();
  });

  it("accepts stable 20 to 253 append-only growth while More is open", async () => {
    const page = await browser.newPage();
    await installRoster(page, 20);
    await installImmediateOpenRosterMutation(page, "GROWTH_253");
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({
      ownerMatchId: "match-0", restored: true, terminalControlState: "RESTORED_CLOSED",
      safeControlOutcome: "OWNER_GROUPS_EXPANDED",
      capture: { record: { matchId: "match-0" } }
    });
    await page.close();
  });

  it.each([
    ["GROWTH_OTHER_CONTROL", "METADATA_CONTROL"],
    ["GROWTH_OLD_TIME", "METADATA_TIME"],
    ["GROWTH_OLD_DATE", "METADATA_DATE"],
    ["UNSAFE_ADDED", "METADATA_MEMBERSHIP"],
    ["DUPLICATE", "METADATA_MEMBERSHIP"]
  ] as const)("rejects stable open-roster %s drift with exact %s", async (mutation, reason) => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await installImmediateOpenRosterMutation(page, mutation);
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow(`SABA_COLLECTOR_ALTERNATE_ROW_OWNERSHIP_UNPROVEN_${reason}`);
    await page.close();
  });

  it.each([
    ["MISSING", "METADATA_MEMBERSHIP"],
    ["CONTROL", "METADATA_CONTROL"],
    ["TIME", "METADATA_TIME"],
    ["DATE", "METADATA_DATE"],
    ["DUPLICATE", "METADATA_MEMBERSHIP"],
    ["UNSAFE_ADDED", "METADATA_MEMBERSHIP"],
    ["CATALOG_MEMBERSHIP", "CATALOG_MEMBERSHIP"]
  ] as const)("fails closed on %s roster drift with bounded %s evidence", async (mutation, reason) => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(page, mutation);
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners.find(({ ownerMatchId }) =>
      ownerMatchId === "match-0")!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow(`SABA_COLLECTOR_MORE_RESTORE_${reason}`);
    await page.close();
  });

  it("reports bounded public membership evidence only for an exact More restoration membership failure", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(page, "REPLACED");
    const diagnostics: SabaRestoreRosterMismatchDiagnostic[] = [];
    let wallClock = 1_000;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => wallClock, monotonicNow: () => 123.5,
      wait: async (delayMs) => { wallClock += delayMs; },
      onRestoreRosterMismatch: (diagnostic) => diagnostics.push(diagnostic) });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_RESTORE_METADATA_MEMBERSHIP");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ binding: BINDING, period: "TODAY",
      ownerMatchId: "match-0", reason: "METADATA_MEMBERSHIP",
      capturedAtMs: wallClock, capturedMonotonicMs: 123.5,
      baseline: { actualPeriod: "TODAY", rowCount: 2, uniqueCount: 2,
        addedCount: 0, missingCount: 0, duplicateCount: 0,
        addedMatchIds: [], missingMatchIds: [], duplicateMatchIds: [],
        controlCounts: { eligibleMore: 1, openMore: 0, noEligibleControl: 1, unsafe: 0 },
        timeShapeCounts: { datedKickoff: 0, prefixedKickoff: 0, undatedKickoff: 2 },
        dateCounts: { explicit: 2, unknown: 0 } },
      restoredReads: {
        first: { actualPeriod: "TODAY", rowCount: 2, uniqueCount: 2,
          addedCount: 1, missingCount: 1, duplicateCount: 0,
          addedMatchIds: ["match-added"], missingMatchIds: ["match-1"], duplicateMatchIds: [] },
        final: { actualPeriod: "TODAY", rowCount: 2, uniqueCount: 2,
          addedCount: 1, missingCount: 1, duplicateCount: 0,
          addedMatchIds: ["match-added"], missingMatchIds: ["match-1"], duplicateMatchIds: [] }
      } });
    await page.close();

    const controlPage = await browser.newPage();
    await installRoster(controlPage, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(controlPage, "CONTROL");
    const controlDiagnostics: SabaRestoreRosterMismatchDiagnostic[] = [];
    const controlAdapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => controlPage.evaluate(expression), isCurrent: () => true,
      onRestoreRosterMismatch: (diagnostic) => controlDiagnostics.push(diagnostic) });
    const controlOwner = (await controlAdapter.readRoster("TODAY")).owners[0]!;
    await expect(controlAdapter.captureOwner("TODAY", controlOwner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_RESTORE_METADATA_CONTROL");
    expect(controlDiagnostics).toEqual([expect.objectContaining({ binding: BINDING,
      period: "TODAY", ownerMatchId: "match-0", phase: "RESTORE", reason: "METADATA_CONTROL",
      changedRows: [{ matchId: "match-1", beforeControl: "NO_ELIGIBLE_CONTROL",
        afterControl: "ELIGIBLE_MORE", timeShapeChanged: false, dateChanged: false }]
    })]);
    await controlPage.close();

    const duplicatePage = await browser.newPage();
    await installRoster(duplicatePage, 2);
    await installImmediateOwnerExpansionWithRestoreMutation(duplicatePage, "DUPLICATE");
    const duplicateDiagnostics: SabaRestoreRosterMismatchDiagnostic[] = [];
    const duplicateAdapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => duplicatePage.evaluate(expression), isCurrent: () => true,
      onRestoreRosterMismatch: (diagnostic) => duplicateDiagnostics.push(diagnostic) });
    const duplicateOwner = (await duplicateAdapter.readRoster("TODAY")).owners[0]!;
    await expect(duplicateAdapter.captureOwner("TODAY", duplicateOwner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_RESTORE_METADATA_MEMBERSHIP");
    expect(duplicateDiagnostics).toHaveLength(1);
    expect(duplicateDiagnostics[0]!.restoredReads).toMatchObject({ first: null,
      final: { rowCount: 3, uniqueCount: 2, duplicateCount: 1,
        duplicateMatchIds: ["match-1"] } });
    await duplicatePage.close();
  }, 15_000);

  it("bounds restore membership ID samples while preserving their full counts", async () => {
    const page = await browser.newPage();
    await installRoster(page, 20);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
            <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
            <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
          return;
        }
        owner.querySelector('.collector-extra')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
        for (let index = 1; index < 20; index += 1) {
          document.querySelector(`[data-matchid="match-${index}"]`)!
            .setAttribute('data-matchid', `replacement-${index}`);
        }
      });
    });
    const diagnostics: SabaRestoreRosterMismatchDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      onRestoreRosterMismatch: (diagnostic) => diagnostics.push(diagnostic) });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_RESTORE_METADATA_MEMBERSHIP");

    expect(diagnostics[0]!.restoredReads.final).toMatchObject({
      addedCount: 19, missingCount: 19, duplicateCount: 0
    });
    expect(diagnostics[0]!.restoredReads.final!.addedMatchIds).toHaveLength(16);
    expect(diagnostics[0]!.restoredReads.final!.missingMatchIds).toHaveLength(16);
    await page.close();
  });

  it("requires two metadata-stable restored reads before accepting the closed owner", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await page.evaluate(() => {
      const state = globalThis as unknown as { restorationReads: number; restoring: boolean };
      state.restorationReads = 0;
      state.restoring = false;
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
            <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
            <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
          return;
        }
        owner.querySelector('.collector-extra')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
        document.querySelector('[data-matchid="match-1"] .c-match-time')!.textContent = '09/10 11:00PM';
        state.restoring = true;
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: async (expression) => {
        const value = await page.evaluate(expression);
        if (expression.includes("const probe=")) {
          await page.evaluate(() => {
            const state = globalThis as unknown as { restorationReads: number; restoring: boolean };
            if (!state.restoring) return;
            state.restorationReads += 1;
            if (state.restorationReads === 1) {
              document.querySelector('[data-matchid="match-1"] .c-match-time')!.textContent = '11:00PM';
            }
          });
        }
        return value;
      }, isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners.find(({ ownerMatchId }) =>
      ownerMatchId === "match-0")!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({ restored: true });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { restorationReads: number }).restorationReads)).toBe(3);
    await page.close();
  });

  it("captures public c-bettype odds outside modern groups by literal native market id", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<section class="more-public-wrapper">
            <div class="c-bettype c-bettype--cs">
              <h4 class="c-bettype__title">Public heading</h4>
              <div class="c-bettype__row"><span class="c-bettype__label">Home 1</span>
                <div class="c-bettype__col"><div class="c-odds-button" data-odds-status="open">
                  <span class="c-odds" data-moid="hidden-native-a">7.6</span></div></div>
                <div class="c-bettype__col"><div class="c-odds-button" data-grey-out="true">
                  <span class="c-odds" data-moid="hidden-native-a">8.2</span></div></div></div>
              <div class="c-bettype__row" data-bt="461"><span class="c-bettype__label">Away 2</span>
                <div class="c-odds-button"><span class="c-odds"
                  data-moid="hidden-native-b">5.4</span></div></div>
            </div></section>`);
          return;
        }
        owner.querySelector('.more-public-wrapper')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    const result = await adapter.captureOwner("TODAY", owner);

    expect(result).toMatchObject({ safeControlOutcome: "OWNER_GROUPS_EXPANDED", restored: true,
      capture: { record: { matchId: "match-0", groups: [
        { betTypeIds: ["3"] },
        { betTypeIds: [], labels: expect.arrayContaining(["Public heading", "Home 1"]), odds: [
          { marketOddsId: "hidden-native-a", priceText: "7.6", status: "open", greyedOut: null },
          { marketOddsId: "hidden-native-a", priceText: "8.2", status: null, greyedOut: "true" }
        ] },
        { betTypeIds: ["461"], labels: expect.arrayContaining(["Public heading", "Away 2"]),
          odds: [{ marketOddsId: "hidden-native-b", priceText: "5.4" }] }
      ] } } });
    expect(await page.evaluate(() => ({
      closed: document.querySelector('[data-matchid="match-0"] .c-btn--more')!
        .classList.contains('c-is-close'),
      publicBlockPresent: document.querySelector('.more-public-wrapper') !== null
    }))).toEqual({ closed: true, publicBlockPresent: false });
    await page.close();
  });

  it("retains cached public c-bettype inventory in roster reads without duplicates or private odds", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', `<div class="cached-more" style="display:none">
        <div class="c-bettype"><div class="c-bettype__row"><span>Cached label</span>
          <div class="c-odds-button"><span class="c-odds" data-moid="cached-native">3.90</span></div>
          <div class="c-odds-button"><span class="c-odds" data-moid="market-0">duplicate</span></div>
        </div></div></div>
        <form><div class="c-bettype"><span>Private label</span><span class="c-odds"
          data-moid="private-native">1.01</span></div></form>`);
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    const record = (await adapter.readRoster("TODAY")).owners[0]!.record;

    expect(record.groups).toHaveLength(2);
    expect(record.groups[1]).toMatchObject({ betTypeIds: [], labels: ["Cached label"],
      odds: [{ marketOddsId: "cached-native", priceText: "3.90" }] });
    expect(record.groups.flatMap(({ odds }) => odds.map(({ marketOddsId }) => marketOddsId)))
      .not.toContain("private-native");
    expect(record.groups.flatMap(({ odds }) => odds.map(({ marketOddsId }) => marketOddsId)))
      .toEqual(["market-0", "market-0", "cached-native"]);
    await page.close();
  });

  it.each(["461", "462"])(
    "enriches modern type %s from its exact public c-bettype header and native-id row", async (betType) => {
      const page = await browser.newPage();
      await installRoster(page, 2);
      await page.evaluate((type) => {
        const owner = document.querySelector('[data-matchid="match-0"]')!;
        owner.insertAdjacentHTML('beforeend', `<div class="c-bettype modern-public">
          <h4 class="c-bettype__title"><span>Public team scope</span></h4>
          <span class="c-team-name">Unrelated team text</span>
          <div class="c-bettype__row target-row"><span class="row-label">Target public row</span>
            <div class="c-match__odds-group"><div data-bt="${type}"><span>u</span>
              <span class="c-odds" data-moid="modern-${type}">2.72</span>
              <span class="c-odds" data-moid="modern-${type}">1.36</span>
            </div></div></div>
          <div class="c-bettype__row other-row"><span>Other native row</span>
            <span class="c-odds" data-moid="other-native">4.4</span></div>
          <form><span>Private account label</span></form>
        </div>`);
        document.querySelector('[data-matchid="match-1"]')!.insertAdjacentHTML('beforeend',
          `<div class="c-bettype"><h4>Other owner heading</h4><div class="c-match__odds-group">
          <div data-bt="${type}"><span class="c-odds" data-moid="modern-${type}">9.9</span>
          </div></div></div>`);
      }, betType);
      const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
        evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

      const group = (await adapter.readRoster("TODAY")).owners[0]!.record.groups
        .find(({ betTypeIds }) => betTypeIds.length === 1 && betTypeIds[0] === betType)!;

      expect(group.labels).toEqual(["u", "Public team scope", "Target public row"]);
      expect(group.odds).toEqual([
        { marketOddsId: `modern-${betType}`, priceText: "2.72", status: null, greyedOut: null },
        { marketOddsId: `modern-${betType}`, priceText: "1.36", status: null, greyedOut: null }
      ]);
      expect(group.labels.filter((label) => ["Other native row", "Private account label",
        "Unrelated team text", "Other owner heading"].includes(label))).toEqual([]);
      await page.close();
    });

  it("leaves a modern type label unchanged when exact block/native-id ownership is ambiguous", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', `<div class="c-bettype"><h4>Ambiguous scope</h4>
        <div class="c-bettype__row"><span>Mixed row</span><div class="c-match__odds-group">
          <div data-bt="462"><span>u</span><span class="c-odds" data-moid="typed-462">2.72</span>
          <span class="c-odds" data-moid="typed-462">1.36</span></div></div>
          <span class="c-odds" data-moid="another-native">4.5</span></div></div>`);
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    const group = (await adapter.readRoster("TODAY")).owners[0]!.record.groups
      .find(({ betTypeIds }) => betTypeIds[0] === "462")!;

    expect(group.labels).toEqual(["u"]);
    await page.close();
  });

  it("does not classify label-only More enrichment as new market structure", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', `<div class="c-bettype modern-public">
        <div class="c-bettype__row"><span>Target row</span><div class="c-match__odds-group">
          <div data-bt="462"><span>u</span><span class="c-odds" data-moid="typed-462">2.72</span>
          <span class="c-odds" data-moid="typed-462">1.36</span></div></div></div></div>`);
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.querySelector('.modern-public')!.insertAdjacentHTML('afterbegin',
            '<h4 class="temporary-title">Public team scope</h4>');
          return;
        }
        owner.querySelector('.temporary-title')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({
      safeControlOutcome: "NO_STRUCTURAL_CHANGE", restored: true
    });
    await page.close();
  });

  it("keeps invalid supplemental semantics out of a pure closed-Today restoration proof", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      (globalThis as unknown as { collectorActions: number }).collectorActions = 0;
      owner.querySelector('.c-btn--more')!.addEventListener('click', () => {
        (globalThis as unknown as { collectorActions: number }).collectorActions += 1;
      });
      document.querySelector('[data-period="today"]')!.addEventListener('click', () => {
        (globalThis as unknown as { collectorActions: number }).collectorActions += 1;
      });
      owner.insertAdjacentHTML('beforeend', `<div class="c-bettype"><span class="c-odds"
        data-moid="sibling-native">1.8</span></div><div class="c-bettype"><span class="c-odds"
        data-moid="sibling-native">2.1</span></div>`);
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.readRoster("TODAY"))
      .rejects.toThrow("SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE_DUPLICATE_NATIVE_ID_ACROSS_BLOCKS");
    await expect(adapter.restoreToday()).resolves.toMatchObject({ selectedPrematch: true,
      rosterMatchIds: ["match-0"] });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { collectorActions: number }).collectorActions)).toBe(0);

    await page.evaluate(() => {
      const control = document.querySelector('[data-matchid="match-0"] .c-btn--more')!;
      control.classList.remove('c-is-close'); control.classList.add('c-is-open');
    });
    await expect(adapter.restoreToday()).rejects.toThrow("SABA_COLLECTOR_TODAY_RESTORE_UNCONFIRMED");
    await page.close();
  });

  it("restores Today without evaluating the public catalog serializer", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    let catalogSerializerCalls = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: async (expression) => {
        if (expression.includes(CMD_PUBLIC_CATALOG_EXPRESSION)) {
          catalogSerializerCalls += 1;
          throw new Error("CATALOG_SERIALIZER_SENTINEL");
        }
        return page.evaluate(expression);
      },
      isCurrent: () => true });

    await expect(adapter.restoreToday()).resolves.toMatchObject({ selectedPrematch: true,
      rosterMatchIds: ["match-0", "match-1"] });
    expect(catalogSerializerCalls).toBe(0);

    await expect(adapter.readRoster("TODAY")).rejects.toThrow("CATALOG_SERIALIZER_SENTINEL");
    expect(catalogSerializerCalls).toBe(1);
    await page.close();
  });

  it("indexes the 253-record public owner snapshot once per full phase read", async () => {
    const page = await browser.newPage();
    await installRoster(page, 253);
    await page.evaluate(() => {
      const state = globalThis as unknown as { ownerSelectorCalls: number };
      state.ownerSelectorCalls = 0;
      const querySelectorAll = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function(selectors: string) {
        if (selectors === ".c-match[data-matchid]") state.ownerSelectorCalls += 1;
        return querySelectorAll.call(this, selectors);
      };
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    const roster = await adapter.readRoster("TODAY");

    expect(roster.owners).toHaveLength(253);
    expect(roster.owners[0]).toMatchObject({ ownerMatchId: "match-0",
      record: { matchId: "match-0", groups: [{ odds: [
        expect.objectContaining({ marketOddsId: "market-0", priceText: "0.91" }),
        expect.objectContaining({ marketOddsId: "market-0", priceText: "-0.95" })
      ] }] } });
    expect(roster.owners.at(-1)).toMatchObject({ ownerMatchId: "match-252",
      record: { matchId: "match-252" } });
    expect(await page.evaluate(() =>
      (globalThis as unknown as { ownerSelectorCalls: number }).ownerSelectorCalls)).toBe(2);
    await page.close();
  });

  it("keeps cached supplemental groups across a roster larger than the former global block cap", async () => {
    const page = await browser.newPage();
    await installRoster(page, 5);
    await page.evaluate(() => {
      for (const owner of Array.from(document.querySelectorAll<HTMLElement>('.c-match[data-matchid]'))) {
        const matchId = owner.getAttribute('data-matchid')!;
        owner.insertAdjacentHTML('beforeend', Array.from({ length: 19 }, (_, index) =>
          `<div class="c-bettype"><span class="c-odds"
            data-moid="${matchId}-extra-${index}">1.${String(index).padStart(2, '0')}</span></div>`)
          .join(''));
      }
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    const result = await adapter.readRoster("TODAY");

    expect(result.owners).toHaveLength(5);
    expect(result.owners.map(({ record }) => record.groups.length)).toEqual([20, 20, 20, 20, 20]);
    expect(result.owners[4]!.record.groups[19]).toMatchObject({ betTypeIds: [],
      odds: [{ marketOddsId: "match-4-extra-18", priceText: "1.18" }] });
    await page.close();
  });

  it("preserves every outcome for one unknown supplemental native market up to the record bound", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', `<div class="c-bettype"><div class="c-bettype__row">
        <span>Score grid</span>${Array.from({ length: 26 }, (_, index) =>
          `<span class="c-odds" data-moid="score-grid">${index}-${25 - index}</span>`).join('')}
        </div></div>`);
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    const group = (await adapter.readRoster("TODAY")).owners[0]!.record.groups[1]!;

    expect(group.betTypeIds).toEqual([]);
    expect(group.labels).toEqual(["Score grid"]);
    expect(group.odds).toHaveLength(26);
    expect(group.odds.map(({ marketOddsId }) => marketOddsId)).toEqual(
      Array.from({ length: 26 }, () => "score-grid"));
    expect(group.odds.map(({ priceText }) => priceText)).toEqual(
      Array.from({ length: 26 }, (_, index) => `${index}-${25 - index}`));
    await page.close();
  });

  it("fails closed instead of truncating a record with 129 supplemental groups", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', Array.from({ length: 129 }, (_, index) =>
        `<div class="c-bettype"><span class="c-odds" data-moid="extra-${index}">1.2</span></div>`)
        .join(''));
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.readRoster("TODAY"))
      .rejects.toThrow("SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE");
    await page.close();
  });

  it("fails closed instead of truncating 129 outcomes from one supplemental native market", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', `<div class="c-bettype">${Array.from({ length: 129 },
        (_, index) => `<span class="c-odds" data-moid="wide-native">${index + 1}</span>`).join('')}
        </div>`);
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.readRoster("TODAY"))
      .rejects.toThrow("SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE");
    await page.close();
  });

  it("fails closed instead of dropping oversized public c-bettype labels or status", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('beforeend', `<div class="c-bettype"><div class="c-bettype__row">
        <span>${"L".repeat(81)}</span><div class="c-odds-button" data-odds-status="${"S".repeat(33)}">
        <span class="c-odds" data-moid="oversized-public">1.2</span></div></div></div>`);
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.readRoster("TODAY"))
      .rejects.toThrow("SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE");
    await page.close();
  });

  it("restores Today and returns its exact prematch roster without live rows", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <style>.hidden{display:none}.c-side-nav,.c-side-nav__header,.c-side-nav__tab,
        .c-odds-table--sport1,.c-match,.c-match-time{display:block;width:120px;min-height:12px}</style>
      <section class="c-side-nav c-side-nav--event">
        <div class="c-side-nav__header"><span class="c-text">Sports</span></div>
        <div id="today-tab"><div class="c-side-nav__tab" data-period="today">Today</div></div>
        <div id="early-tab" class="active"><div class="c-side-nav__tab" data-period="early">Early</div></div>
      </section>
      <div id="today-view" class="hidden"><section class="c-odds-table--sport1">
        <div class="c-match" data-matchid="today-a"><span class="c-match-time">11:00PM</span></div>
        <div class="c-match" data-matchid="today-b"><span class="c-match-time">09/09 11:30PM</span></div>
        <div class="c-match" data-matchid="today-live"><span class="c-match-time">2H31'</span></div>
      </section></div>
      <div id="early-view"><section class="c-odds-table--sport1">
        <div class="c-match" data-matchid="early-a"><span class="c-match-time">09/10 01:00AM</span></div>
      </section></div>`);
    await page.evaluate((documentKey) => {
      (globalThis as unknown as { __fieldlineSabaNavigationProbeDocV1: string })
        .__fieldlineSabaNavigationProbeDocV1 = documentKey;
      const select = (period: "today" | "early") => {
        document.querySelector('#today-tab')!.classList.toggle('active', period === 'today');
        document.querySelector('#early-tab')!.classList.toggle('active', period === 'early');
        document.querySelector('#today-view')!.classList.toggle('hidden', period !== 'today');
        document.querySelector('#early-view')!.classList.toggle('hidden', period !== 'early');
      };
      document.querySelector('[data-period="today"]')!.addEventListener('click', () => select('today'));
      document.querySelector('[data-period="early"]')!.addEventListener('click', () => select('early'));
    }, BINDING.documentKey);
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.restoreToday()).resolves.toEqual({ binding: BINDING,
      selectedPrematch: true, rosterMatchIds: ["today-a", "today-b"] });
    await page.close();
  });

  it("waits read-only for same-document loading after Early selection and restores Today", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const state = globalThis as unknown as { pendingPeriod: "early" | null;
        periodClicks: string[]; todayMarkup: string };
      state.pendingPeriod = null;
      state.periodClicks = [];
      state.todayMarkup = document.querySelector('.c-odds-table--sport1')!.outerHTML;
      const select = (period: "today" | "early") => {
        state.periodClicks.push(period);
        document.querySelector('[data-period="today"]')!.parentElement!
          .classList.toggle('active', period === 'today');
        document.querySelector('[data-period="early"]')!.parentElement!
          .classList.toggle('active', period === 'early');
        document.querySelector('.c-odds-table--sport1')?.remove();
        if (period === 'early') state.pendingPeriod = 'early';
        else {
          document.body.insertAdjacentHTML('beforeend', state.todayMarkup);
          state.pendingPeriod = null;
        }
      };
      document.querySelector('[data-period="early"]')!.addEventListener('click', () => select('early'));
      document.querySelector('[data-period="today"]')!.addEventListener('click', () => select('today'));
    });
    let clock = 0;
    const waits: number[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => {
        waits.push(delayMs);
        clock += delayMs;
        await page.evaluate(() => {
          const state = globalThis as unknown as { pendingPeriod: "early" | null };
          if (state.pendingPeriod !== 'early') return;
          document.body.insertAdjacentHTML('beforeend', `<section class="c-odds-table--sport1"
            data-date="2026-09-10"><div class="c-league" data-leagueid="league-early">
            <span class="c-league__name">Early League</span>
            <div class="c-match" data-matchid="early-0"><span class="c-match-time">09/10 01:00AM</span>
            <span class="c-team-name">Early Home</span><span class="c-team-name">Early Away</span>
            <div class="c-match__odds-group"><div data-bt="3">
            <span class="c-odds" data-moid="early-market">0.88</span>
            <span class="c-odds" data-moid="early-market">-0.92</span>
            </div></div></div></div></section>`);
          state.pendingPeriod = null;
        });
      } });

    await expect(adapter.readRoster("EARLY")).resolves.toMatchObject({ period: "EARLY",
      owners: [{ ownerMatchId: "early-0" }] });
    await expect(adapter.restoreToday()).resolves.toMatchObject({ selectedPrematch: true,
      rosterMatchIds: ["match-0"] });

    expect(await page.evaluate(() =>
      (globalThis as unknown as { periodClicks: string[] }).periodClicks)).toEqual(["early", "today"]);
    expect(waits).toEqual([500, 500, 500]);
    await page.close();
  });

  it("hard-fails a document-token change during post-selection loading without further actions", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      (globalThis as unknown as { periodClicks: number }).periodClicks = 0;
      document.querySelector('[data-period="early"]')!.addEventListener('click', () => {
        (globalThis as unknown as { periodClicks: number }).periodClicks += 1;
        document.querySelector('.c-odds-table--sport1')?.remove();
        (globalThis as unknown as { __fieldlineSabaNavigationProbeDocV1: string })
          .__fieldlineSabaNavigationProbeDocV1 = 'replacement-document';
      });
    });
    let waits = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      wait: async () => { waits += 1; } });

    await expect(adapter.readRoster("EARLY")).rejects.toThrow("SABA_COLLECTOR_DOCUMENT_CHANGED");
    expect(await page.evaluate(() =>
      (globalThis as unknown as { periodClicks: number }).periodClicks)).toBe(1);
    expect(waits).toBe(0);
    await page.close();
  });

  it("bounds persistent same-document loading with PAGE_NOT_READY", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => document.querySelector('.c-odds-table--sport1')!.remove());
    let clock = 0;
    const waits: number[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => clock, wait: async (delayMs) => { waits.push(delayMs); clock += delayMs; } });

    await expect(adapter.readRoster("TODAY")).rejects.toThrow("SABA_COLLECTOR_PAGE_NOT_READY");
    expect(waits).toHaveLength(30);
    expect(waits.every((delayMs) => delayMs === 500)).toBe(true);
    expect(clock).toBe(15_000);
    await page.close();
  });

  it("rejects an unsafe More control instead of completing the owner as no-control", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await page.evaluate(() => document.querySelector('[data-matchid="match-0"] .c-btn--more')!
      .setAttribute('href', '#unsafe'));
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.readRoster("TODAY")).rejects.toThrow("SABA_COLLECTOR_ROSTER_UNSAFE");
    await page.close();
  });

  it("does not click a period when the current selection is unconfirmed", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      document.querySelector('[data-period="today"]')!.parentElement!.classList.remove('active');
      (globalThis as unknown as { periodClicks: number }).periodClicks = 0;
      document.querySelector('[data-period="today"]')!.addEventListener('click', () => {
        (globalThis as unknown as { periodClicks: number }).periodClicks += 1;
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    await expect(adapter.readRoster("TODAY")).rejects
      .toThrow("SABA_COLLECTOR_PERIOD_SELECTION_UNCONFIRMED");
    expect(await page.evaluate(() => (globalThis as unknown as { periodClicks: number }).periodClicks)).toBe(0);
    await page.close();
  });

  it("does not promote an ISO-looking metadata prefix into an explicit kickoff date", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => document.querySelector('.c-odds-table--sport1')!
      .setAttribute('data-date', '2026-09-09token-secret'));
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    expect((await adapter.readRoster("TODAY")).owners[0]?.kickoffDate).toEqual({ kind: "UNKNOWN" });
    await page.close();
  });

  it.each([7, 8])("normalizes zoned kickoff timestamps to the explicit provider GMT+%i calendar", async (offset) => {
    const page = await browser.newPage();
    await installRoster(page, 4);
    await page.evaluate((offset) => {
      document.querySelector('#systemTime')!.textContent = `04:29:28AM Sep09,2026GMT+${offset}`;
      document.querySelector('.c-odds-table--sport1')!.removeAttribute('data-date');
      document.querySelector('[data-matchid="match-0"] .c-match-time')!
        .setAttribute('datetime', '2026-09-07T16:30:00Z');
      document.querySelector('[data-matchid="match-1"]')!
        .setAttribute('data-start-time', '2026-09-08T00:30:00+09:00');
      document.querySelector('[data-matchid="match-2"]')!
        .setAttribute('data-kickoff', '2026-09-08T03:00:00');
      document.querySelector('[data-matchid="match-3"]')!
        .setAttribute('data-kickoff', '2026-02-29T03:00:00Z');
    }, offset);
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });

    const owners = (await adapter.readRoster("TODAY")).owners;
    expect(owners.map(({ kickoffDate }) => kickoffDate)).toEqual([
      { kind: "EXPLICIT", isoDate: offset === 7 ? "2026-09-07" : "2026-09-08" },
      { kind: "EXPLICIT", isoDate: "2026-09-07" },
      { kind: "UNKNOWN" },
      { kind: "UNKNOWN" }
    ]);
    expect(owners[0]?.record.providerTimezoneOffsetMinutes).toBe(offset * 60);
    await page.close();
  });

  it("rejects a document change between atomic phase reads with the fixed reason", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    let phaseReads = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING, isCurrent: () => true,
      evaluate: async (expression) => {
        if (expression.includes(CMD_PUBLIC_CATALOG_EXPRESSION) && ++phaseReads === 2) {
          await page.evaluate(() => {
            (globalThis as unknown as { __fieldlineSabaNavigationProbeDocV1: string })
              .__fieldlineSabaNavigationProbeDocV1 = "replacement-document";
          });
        }
        return page.evaluate(expression);
      } });

    await expect(adapter.readRoster("TODAY")).rejects.toThrow("SABA_COLLECTOR_DOCUMENT_CHANGED");
    await page.close();
  });

  it("reports bounded safe final phases when period selection remains conflicting", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      (globalThis as unknown as { periodClicks: number }).periodClicks = 0;
      document.querySelector('[data-period="early"]')!.addEventListener('click', () => {
        (globalThis as unknown as { periodClicks: number }).periodClicks += 1;
        document.querySelector('[data-period="early"]')!.parentElement!.classList.add('active');
      });
    });
    let clock = 0;
    const diagnostics: SabaPeriodUnstableDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => clock, wait: async (delayMs) => { clock += delayMs; },
      onPeriodUnstable: (diagnostic) => diagnostics.push(diagnostic) });

    await expect(adapter.readRoster("EARLY")).rejects.toThrow("SABA_COLLECTOR_PERIOD_NOT_STABLE");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ expectedPeriod: "EARLY", readCount: 32,
      elapsedMs: 15_000, fingerprintSame: true, metadataSame: true,
      finalPhases: [
        { actualPeriod: "UNKNOWN", activePeriodEvidence: "CONFLICT", tableCount: 1,
          publicRosterLength: 1, eligibleMoreCount: 1, metadataPrematchCount: 1 },
        { actualPeriod: "UNKNOWN", activePeriodEvidence: "CONFLICT", tableCount: 1,
          publicRosterLength: 1, eligibleMoreCount: 1, metadataPrematchCount: 1 },
        { actualPeriod: "UNKNOWN", activePeriodEvidence: "CONFLICT", tableCount: 1,
          publicRosterLength: 1, eligibleMoreCount: 1, metadataPrematchCount: 1 }
      ] });
    const serialized = JSON.stringify(diagnostics[0]);
    expect(serialized).not.toContain(BINDING.documentKey);
    expect(serialized).not.toContain("Home 0");
    expect(serialized).not.toContain('"fingerprint"');
    expect(await page.evaluate(() =>
      (globalThis as unknown as { periodClicks: number }).periodClicks)).toBe(1);
    await page.close();
  });

  it("distinguishes changing public rosters in bounded period-unstable evidence", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      document.querySelector('[data-period="early"]')!.addEventListener('click', () => {
        document.querySelector('[data-period="today"]')!.parentElement!.classList.remove('active');
        document.querySelector('[data-period="early"]')!.parentElement!.classList.add('active');
      });
      (globalThis as unknown as { rosterMutation: number }).rosterMutation = 0;
    });
    let clock = 0;
    const diagnostics: SabaPeriodUnstableDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING, isCurrent: () => true,
      now: () => clock, wait: async (delayMs) => { clock += delayMs; },
      evaluate: async (expression) => {
        if (expression.includes(CMD_PUBLIC_CATALOG_EXPRESSION) && await page.evaluate(() =>
          document.querySelector('[data-period="early"]')!.parentElement!.classList.contains('active'))) {
          await page.evaluate(() => {
            const state = globalThis as unknown as { rosterMutation: number };
            state.rosterMutation += 1;
            document.querySelector('.c-match[data-matchid]')!.setAttribute('data-matchid',
              state.rosterMutation % 2 === 0 ? 'early-b' : 'early-a');
          });
        }
        return page.evaluate(expression);
      },
      onPeriodUnstable: (diagnostic) => diagnostics.push(diagnostic) });

    await expect(adapter.readRoster("EARLY")).rejects.toThrow("SABA_COLLECTOR_PERIOD_NOT_STABLE");

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ expectedPeriod: "EARLY", readCount: 32,
      elapsedMs: 15_000, fingerprintSame: false, metadataSame: false });
    const finalPhases = diagnostics[0]!.finalPhases;
    expect(finalPhases).toHaveLength(3);
    expect(finalPhases.every((phase) => phase.actualPeriod === "EARLY" &&
      phase.activePeriodEvidence === "TAB_STATE" && phase.metadataPrematchCount === 1)).toBe(true);
    expect(new Set(finalPhases.map((phase) => phase.probeFingerprintHash)).size).toBe(2);
    expect(new Set(finalPhases.map((phase) => phase.metadataRowsHash)).size).toBe(2);
    await page.close();
  });

  it("restores More after rejecting an unproven alternate child row", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await page.evaluate(() => {
      const state = globalThis as unknown as { moreClicks: string[] };
      state.moreClicks = [];
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        const opened = control.classList.contains('c-is-open');
        state.moreClicks.push(opened ? 'close' : 'open');
        if (opened) {
          document.querySelector('.alternate-owner-row')?.remove();
          control.classList.remove('c-is-open'); control.classList.add('c-is-close');
          return;
        }
        control.classList.remove('c-is-close'); control.classList.add('c-is-open');
        owner.insertAdjacentHTML('afterend', `<div class="c-match alternate-owner-row"
          data-matchid="alternate-child"><span class="c-match-time">11:00PM</span>
          <span class="c-team-name">Alternate Home</span><span class="c-team-name">Alternate Away</span>
          <div class="c-match__odds-group"><div data-bt="3">
            <span class="c-odds" data-moid="alternate-market">0.81</span>
            <span class="c-odds" data-moid="alternate-market">-0.91</span>
          </div></div></div>`);
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_ALTERNATE_ROW_OWNERSHIP_UNPROVEN");
    expect(await page.evaluate(() => ({
      clicks: (globalThis as unknown as { moreClicks: string[] }).moreClicks,
      closed: document.querySelector('[data-matchid="match-0"] .c-btn--more')!
        .classList.contains('c-is-close'),
      alternatePresent: document.querySelector('.alternate-owner-row') !== null
    }))).toEqual({ clicks: ["open", "close"], closed: true, alternatePresent: false });
    await page.close();
  });

  it("does not treat an unchanged closed control as a successful More open", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    let clock = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { clock += delayMs; } });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_MORE_OPEN_NOT_STABLE");
    expect(await page.evaluate(() => document.querySelector('[data-matchid="match-0"] .c-btn--more')!
      .classList.contains('c-is-close'))).toBe(true);
    await page.close();
  });

  it("ignores unrelated live-roster churn while proving a prematch owner expansion", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      owner.insertAdjacentHTML('afterend', `<div class="c-match live-row" data-matchid="live-old">
        <span class="c-match-time">2H31'</span><span class="c-team-name">Live Home</span>
        <span class="c-team-name">Live Away</span></div>`);
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group collector-extra">
            <div data-bt="15"><span class="c-odds" data-moid="owner-extra">0.81</span>
            <span class="c-odds" data-moid="owner-extra">-0.91</span></div></div>`);
          document.querySelector('.live-row')!.setAttribute('data-matchid', 'live-new');
          return;
        }
        owner.querySelector('.collector-extra')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      });
    });
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner)).resolves.toMatchObject({
      safeControlOutcome: "OWNER_GROUPS_EXPANDED", restored: true,
      capture: { record: { matchId: "match-0" } }
    });
    await page.close();
  });

  it("starts a fresh bounded deadline for a later collector slice", async () => {
    const page = await browser.newPage();
    await installRoster(page, 1);
    let clock = 0;
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { clock += delayMs; } });

    await expect(adapter.readRoster("TODAY")).resolves.toMatchObject({ selectedPrematch: true });
    clock = 61_000;
    await expect(adapter.readRoster("TODAY")).resolves.toMatchObject({ selectedPrematch: true,
      owners: [{ ownerMatchId: "match-0", capturedAtMs: 61_500 }] });
    await page.close();
  });

  it("fails and restores when More changes owner structure without a capturable market", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend', `<div class="c-match__odds-group uncaptured">
            <div class="hidden-wrapper" data-bt="55">
              <span class="public-hidden-market" data-moid="hidden-native-1">+0.75</span>
              <span data-moid="market-0">represented duplicate</span>
            </div></div>`);
          return;
        }
        owner.querySelector('.uncaptured')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      });
    });
    const diagnostics: SabaUnrepresentedOwnerDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      onUnrepresentedOwner: (diagnostic) => diagnostics.push(diagnostic) });
    const owner = (await adapter.readRoster("TODAY")).owners[0]!;

    await expect(adapter.captureOwner("TODAY", owner))
      .rejects.toThrow("SABA_COLLECTOR_OWNER_STRUCTURE_UNCAPTURED");
    expect(await page.evaluate(() => ({
      closed: document.querySelector('[data-matchid="match-0"] .c-btn--more')!
        .classList.contains('c-is-close'),
      uncapturedPresent: document.querySelector('.uncaptured') !== null
    }))).toEqual({ closed: true, uncapturedPresent: false });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ binding: BINDING, period: "TODAY",
      reason: "ADDED_NATIVE_IDS",
      ownerMatchId: "match-0", before: { groupCount: 1, nativeTypes: ["3"], nativeIdCount: 1 },
      after: { groupCount: 2, nativeTypes: ["3", "55"], nativeIdCount: 2,
        addedNativeIds: ["hidden-native-1"] },
      catalog: { groupCount: 1, nativeIdCount: 1 }, unmatched: [{
        nativeId: "hidden-native-1", nativeType: "55", elementTag: "span",
        elementClasses: ["public-hidden-market"], inOddsGroup: true, isOdds: false,
        priceText: "+0.75"
      }], addedGroupShapes: [{ tag: "div", classes: ["c-match__odds-group", "uncaptured"],
        nativeAttributes: [{ name: "data-bt", value: "55" }], nativeIdCount: 2 }] });
    expect(diagnostics[0]!.unmatched.map(({ nativeId }) => nativeId)).not.toContain("market-0");
    await page.close();
  });

  it("reports an added empty owner group even when it has no unmatched native id", async () => {
    const page = await browser.newPage();
    await installRoster(page, 2);
    await page.evaluate(() => {
      const owner = document.querySelector('[data-matchid="match-0"]')!;
      const control = owner.querySelector('.c-btn--more')!;
      control.addEventListener('click', () => {
        if (control.classList.contains('c-is-close')) {
          control.classList.remove('c-is-close'); control.classList.add('c-is-open');
          owner.insertAdjacentHTML('beforeend',
            '<section class="c-match__odds-group empty-shell" data-type="special"></section>');
          return;
        }
        owner.querySelector('.empty-shell')?.remove();
        control.classList.remove('c-is-open'); control.classList.add('c-is-close');
      });
    });
    let clock = 0;
    const diagnostics: SabaUnrepresentedOwnerDiagnostic[] = [];
    const adapter = createSabaHiddenMarketPageAdapter({ binding: BINDING,
      evaluate: (expression) => page.evaluate(expression), isCurrent: () => true,
      now: () => clock, monotonicNow: () => clock,
      wait: async (delayMs) => { clock += delayMs; },
      onUnrepresentedOwner: (diagnostic) => diagnostics.push(diagnostic) });

    await expect(adapter.captureOwner("TODAY", firstOwner()))
      .rejects.toThrow("SABA_COLLECTOR_OWNER_STRUCTURE_UNCAPTURED");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ reason: "GROUP_COUNT_CHANGED", unmatched: [],
      addedGroupShapes: [{ tag: "section", classes: ["c-match__odds-group", "empty-shell"],
        nativeAttributes: [{ name: "data-type", value: "special" }], nativeIdCount: 0 }] });
    expect(await page.evaluate(() => document.querySelector('.empty-shell'))).toBeNull();
    await page.close();
  });
});
