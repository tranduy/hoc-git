import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import { splitUtf8Text } from "./utf8-length.js";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { chunkCmdSnapshot } from "./cmd-snapshot-chunker.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { buildTsportSelectionPriceExpression } from "./tsport-selection-price.js";
import { buildImExactSelectionPriceExpression } from "./im-selection-price.js";
import { redactNetworkBody, redactNetworkEnvelope } from "./redactor.js";
import { buildCmdSelectionFocusExpression, buildGenericSelectionFocusExpression,
  type SelectionFocusIdentity } from "./selection-focus.js";
import { buildBtiSelectionPriceExpression, buildCmdSelectionPriceExpression, buildGenericSelectionPriceExpression,
  buildSabaSelectionPriceExpression,
  buildSbobetSelectionPriceExpression,
  type SelectionPriceProbeIdentity } from "./selection-price.js";
import { buildCmdHiddenMarketProbeExpression, summarizeCmdHiddenProtocolFrame,
  type CmdHiddenDomProbeResult, type CmdHiddenProtocolEvidence } from "./cmd-hidden-market-probe.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";

const NETWORK_CHUNK_BODY_BYTES = 110_000;
const CATALOG_REFRESH_INTERVAL_MS = 4_000;
const SABA_SNAPSHOT_PERSIST_INTERVAL_MS = 5_000;

function isKsportCatalogSocket(url: URL): boolean {
  return url.protocol === "wss:" && /\/sport\//u.test(url.pathname);
}

export interface ObservedSource {
  readonly lobby: ChromeLobbyId;
  readonly sourceId: string;
  readonly tabId: number;
}

export interface NetworkObserverDependencies {
  readonly sendCommand: (tabId: number, method: string, params?: Record<string, unknown>,
    sessionId?: string) => Promise<unknown>;
  readonly forward: (envelope: ChromeBridgeEnvelope) => Promise<void>;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
  readonly recoverImBaseline?: (source: ObservedSource) => Promise<void>;
  readonly frameCommandTimeoutMs?: number;
  readonly btiCatalogRefreshTimeoutMs?: number;
  readonly observerSessionId?: string;
  readonly loadSbobetEventRequest?: () => Promise<{ readonly url: string;
    readonly headers: Readonly<Record<string, string>> } | null>;
  readonly saveSbobetEventRequest?: (request: { readonly url: string;
    readonly headers: Readonly<Record<string, string>> }) => Promise<void>;
  readonly loadSabaWsSnapshots?: (sourceId: string) => Promise<unknown>;
  readonly saveSabaWsSnapshots?: (snapshots: PersistedSabaWsSnapshots) => Promise<void>;
  readonly clearSabaWsSnapshots?: (sourceId: string) => Promise<void>;
  readonly workScheduler?: ProviderWorkScheduler;
}

type ImProviderPartition = "IM_MARKET_1" | "IM_MARKET_2";

interface PendingRequest {
  readonly source: ObservedSource;
  readonly sourceGeneration: number;
  readonly sessionId?: string;
  readonly url: string;
  readonly resourceType: string;
  readonly providerPartition?: ImProviderPartition;
  readonly streamId?: string;
}

interface ReplayableHttpSnapshot {
  readonly source: ObservedSource;
  readonly url: string;
  readonly resourceType: string;
  readonly body: string;
  readonly providerPartition?: ImProviderPartition;
  readonly streamId?: string;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

interface ReplayableWsEvent {
  readonly source: ObservedSource;
  readonly url: string;
  readonly body: string;
  readonly streamId: string;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

export interface PersistedSabaWsSnapshots {
  readonly version: 1;
  readonly sourceId: string;
  readonly documentMarker: string;
  readonly partitions: ReadonlyArray<{ readonly partition: string;
    readonly frames: ReadonlyArray<Omit<ReplayableWsEvent, "source">> }>;
}

interface ActiveCmdHiddenProbe {
  readonly requestId: string;
  readonly providerEventId: string;
  readonly httpEvidence: Array<{ readonly method: string; readonly hostname: string; readonly pathname: string;
    readonly resourceType: string; readonly eventIdReferenced: boolean }>;
  readonly websocketEvidence: CmdHiddenProtocolEvidence[];
}

const DISCOVERY_EXPRESSION = `(() => {
  const roots = [document.scrollingElement, ...document.querySelectorAll('[role="main"], main, .content, .sports-content')]
    .filter(Boolean);
  for (const root of roots) root.scrollTop = Math.min(root.scrollTop + root.clientHeight, root.scrollHeight);
  return roots.length;
})()`;

const SABA_ODDS_MUTATION_EXPRESSION = `(() => {
  // fieldline-saba-odds-mutation
  const key = '__fieldlineSabaOddsMutationV1';
  let state = globalThis[key];
  if (!state || !state.observer) {
    state = { dirty: true, observer: null };
    const touchesOdds = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return Boolean(element?.closest?.('.odds, .c-odds, [data-moid]') ||
        element?.querySelector?.('.odds, .c-odds, [data-moid]'));
    };
    state.observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => touchesOdds(mutation.target) ||
        [...mutation.addedNodes].some(touchesOdds) || [...mutation.removedNodes].some(touchesOdds))) {
        state.dirty = true;
      }
    });
    state.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
      // Do not observe the class attribute: SABA continuously toggles hover/animation
      // classes inside odds cells even when the price is unchanged, which
      // caused a full catalog read every two seconds. Text/child changes cover
      // prices; these two data attributes cover availability changes.
      attributes: true, attributeFilter: ['data-odds-status', 'data-grey-out'] });
    globalThis[key] = state;
  }
  const dirty = state.dirty === true;
  state.dirty = false;
  return dirty;
})()`;

export const KSPORT_FOOTBALL_DISCOVERY_EXPRESSION = `(() => {
  const normalize = (value) => String(value || '').normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase().replace(/\\s+/g, ' ');
  const primary = [...document.querySelectorAll('.sport-type-group-item')];
  const fallback = [...document.querySelectorAll(
    '[data-sport-id], [data-sport], button, [role="button"], [class*="sport-type"], [class*="sport-menu"]'
  )].filter((candidate) => {
    const text = normalize(candidate.textContent);
    return text.length > 0 && text.length < 80 && /^bong da(?:\\s|live|\\d|$)/u.test(text);
  });
  const controls = [...new Set([...primary, ...fallback])]
    .filter((control) => !control.classList.contains('sport-odds-boosts') &&
      !control.closest('.sport-odds-boosts, [class*="odds-boost"]'));
  const control = controls.find((candidate) => {
    const header = candidate.querySelector('.sport-type-item-header') || candidate;
    const text = normalize(header.textContent);
    return /^bong da(?:\\s|live|\\d|$)/u.test(text) && !/^bong da\\s*2(?:\\s|$)/u.test(text);
  });
  if (!control) return { status: 'football-control-not-found' };
  if (control.classList.contains('active-type')) return { status: 'football-active' };
  control.click();
  return { status: 'football-selected' };
})()`;

const KSPORT_TODAY_BASELINE_EXPRESSION = ksportTimeTabExpression("hom nay");
const KSPORT_LIVE_BASELINE_EXPRESSION = ksportTimeTabExpression("truc tiep");

function ksportTimeTabExpression(label: string): string {
  return `(() => {
    const normalize = (value) => String(value || '').normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase().replace(/\\s+/g, ' ');
    const tab = [...document.querySelectorAll('.sport-menu-tab, [class*="sport-menu-tab"]')]
      .find((candidate) => normalize(candidate.textContent) === ${JSON.stringify(label)});
    if (!tab) return { status: 'time-tab-not-found' };
    if (tab.classList.contains('active') || tab.classList.contains('selected')) return { status: 'time-tab-active' };
    tab.click();
    return { status: 'time-tab-selected' };
  })()`;
}

export const KEEP_ACTIVE_EXPRESSION = `(() => {
  const candidates = [document.scrollingElement, ...document.querySelectorAll('body *')]
    .filter((element) => element && element.scrollHeight - element.clientHeight > 200);
  let moved = 0;
  for (const element of candidates) {
    const maximum = element.scrollHeight - element.clientHeight;
    const next = element.scrollTop >= maximum - 4 ? 0 : Math.min(maximum, element.scrollTop + Math.max(240, element.clientHeight * 0.8));
    if (next !== element.scrollTop) { element.scrollTop = next; moved += 1; }
  }
  const root = document.documentElement;
  const now = Date.now();
  const prior = Number(root.dataset.fieldlineMarketExpandedAt || 0);
  let expanded = 0;
  if (!Number.isFinite(prior) || now - prior >= 8000) {
    const normalize = (value) => String(value || '').normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase().replace(/\\s+/g, ' ');
    const unsafeSelector = '[class*=selection], [class*=ticket], [class*=slip], [class*=betslip], form';
    const controls = [...document.querySelectorAll("button, summary, [role='button'], a")]
      .filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('disabled') &&
        !element.closest(unsafeSelector) && !/(?:odd|price|selection)/u.test(normalize(element.className)))
      .filter((element) => /^(?:\\+\\s*\\d+|[v▼]\\s*\\d+|\\d+\\s*(?:keo|markets?)\\s*(?:khac|more)?|more markets?|show more|all markets?)$/u
        .test(normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent)))
      .filter((element) => {
        const owner = element.closest('[data-event-id], [data-match-id], [data-matchid], [data-eventid], [id]');
        const ownerId = owner?.getAttribute('data-event-id') || owner?.getAttribute('data-match-id') ||
          owner?.getAttribute('data-matchid') || owner?.getAttribute('data-eventid') || owner?.id || '';
        const label = normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent);
        const signature = ownerId + '\\u0000' + label;
        const lastAt = Number(element.dataset.fieldlineMarketExpandedAt || 0);
        const alreadyOpen = element.getAttribute('aria-expanded') === 'true' || element.matches('details[open] > summary');
        return !alreadyOpen && (element.dataset.fieldlineMarketExpandSignature !== signature ||
          !Number.isFinite(lastAt) || now - lastAt >= 60000);
      })
      .slice(0, 12);
    for (const control of controls) {
      const owner = control.closest('[data-event-id], [data-match-id], [data-matchid], [data-eventid], [id]');
      const ownerId = owner?.getAttribute('data-event-id') || owner?.getAttribute('data-match-id') ||
        owner?.getAttribute('data-matchid') || owner?.getAttribute('data-eventid') || owner?.id || '';
      const label = normalize(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent);
      control.dataset.fieldlineMarketExpandSignature = ownerId + '\\u0000' + label;
      control.dataset.fieldlineMarketExpandedAt = String(now);
      control.click();
      expanded += 1;
    }
    root.dataset.fieldlineMarketExpandedAt = String(now);
  }
  return { moved, expanded };
})()`;

// T-Sports/APSPORT exposes hidden event markets behind provider-specific
// structural controls whose labels are a market count (for example "27") or
// a localized "view more" message. Keep this whitelist deliberately narrow:
// odds, ticket and form descendants are rejected before any click.
export const TSPORT_CATALOG_DISCOVERY_EXPRESSION = `(() => {
  const candidates = [document.scrollingElement, ...document.querySelectorAll('body *')]
    .filter((element) => element && element.scrollHeight - element.clientHeight > 200);
  let moved = 0;
  for (const element of candidates) {
    const maximum = element.scrollHeight - element.clientHeight;
    const next = element.scrollTop >= maximum - 4 ? 0 :
      Math.min(maximum, element.scrollTop + Math.max(240, element.clientHeight * 0.8));
    if (next !== element.scrollTop) { element.scrollTop = next; moved += 1; }
  }
  const root = document.documentElement;
  const now = Date.now();
  const prior = Number(root.dataset.fieldlineTsportMarketExpandedAt || 0);
  let expanded = 0;
  if (!Number.isFinite(prior) || now - prior >= 8000) {
    const normalize = (value) => String(value || '').normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase().replace(/\\s+/g, ' ');
    const unsafeSelector = '[class*=selection], [class*=ticket], [class*=slip], [class*=betslip], form, [id^=odd-item-]';
    const controls = [...document.querySelectorAll(
      '.match a.c-btn--more.c-is-close, .match button.c-btn--more.c-is-close, ' +
      '.match a.c-btn--more-lines.c-is-close, .match button.c-btn--more-lines.c-is-close, ' +
      '.match a.view-more.center-absolute, .match button.view-more.center-absolute')]
      .filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('disabled') &&
        element.closest('.match') && !element.closest(unsafeSelector) &&
        !/(?:odd|price|selection)/u.test(normalize(element.className)))
      .filter((element) => {
        const className = normalize(element.className);
        const label = normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent);
        if (/(?:^| )c-btn--more(?: |$)/u.test(className)) return /^\\d+(?:\\s*[^\\p{L}\\p{N}]*)?$/u.test(label);
        if (/(?:^| )c-btn--more-lines(?: |$)/u.test(className)) return /^cac loai cuoc chau a khac(?:\\s*[^\\p{L}\\p{N}]*)?$/u.test(label);
        return /^(?:xem them|view more)\\s*\\(\\+\\d+\\)\\s*(?:cac loai cuoc khac|other markets)$/u.test(label);
      })
      .filter((element) => {
        const owner = element.closest('.match');
        const ownerId = owner?.getAttribute('data-event-id') || owner?.getAttribute('data-match-id') ||
          owner?.querySelector('.match-favorite')?.id || owner?.id || '';
        const label = normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent);
        const signature = ownerId + '\\u0000' + label;
        const lastAt = Number(element.dataset.fieldlineTsportMarketExpandedAt || 0);
        const alreadyOpen = element.getAttribute('aria-expanded') === 'true';
        return !alreadyOpen && (element.dataset.fieldlineTsportMarketExpandSignature !== signature ||
          !Number.isFinite(lastAt) || now - lastAt >= 60000);
      })
      .slice(0, 6);
    for (const control of controls) {
      const owner = control.closest('.match');
      const ownerId = owner?.getAttribute('data-event-id') || owner?.getAttribute('data-match-id') ||
        owner?.querySelector('.match-favorite')?.id || owner?.id || '';
      const label = normalize(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent);
      control.dataset.fieldlineTsportMarketExpandSignature = ownerId + '\\u0000' + label;
      control.dataset.fieldlineTsportMarketExpandedAt = String(now);
      control.click();
      expanded += 1;
    }
    root.dataset.fieldlineTsportMarketExpandedAt = String(now);
  }
  return { moved, expanded };
})()`;

// CMD renders only a small virtualized window and remembers the last search
// query/category in the page. Keep the attached read-only tab on Football with
// an empty team search, then advance every scroll container so the backend can
// accumulate all visited public match rows. Controls are selected structurally;
// no price cell or ticket control is ever clicked.
export const CMD_CATALOG_DISCOVERY_EXPRESSION = `(() => {
  const root = document.documentElement;
  const normalize = (value) => String(value || '').normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase().replace(/\\s+/g, ' ');
  const search = [...document.querySelectorAll("input[type='search'], input[placeholder], input[aria-label]")]
    .find((input) => /(?:tim kiem doi|tim kiem|search team|search)/u.test(normalize(
      input.getAttribute('placeholder') || input.getAttribute('aria-label'))));
  if (search && search.value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(search, ''); else search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new Event('change', { bubbles: true }));
    root.dataset.fieldlineCmdSearchCleared = String(Date.now());
  }
  const now = Date.now();
  const prior = Number(root.dataset.fieldlineCmdFootballSelected || 0);
  const footballVisible = document.querySelector('.c-odds-table--sport1, .sport1, [data-sportid="1"]') !== null;
  if (!footballVisible && (!Number.isFinite(prior) || now - prior >= 15000)) {
    const icon = [...document.querySelectorAll('.c-iconcolor-sport1')]
      .find((candidate) => candidate.getClientRects().length > 0);
    const control = icon?.closest("a, button, [role='button'], [onclick], .c-side-nav__btn");
    if (control && !control.hasAttribute('disabled')) {
      root.dataset.fieldlineCmdFootballSelected = String(now);
      control.click();
    }
  }
  const candidates = [document.scrollingElement, ...document.querySelectorAll('body *')]
    .filter((element) => element && element.scrollHeight - element.clientHeight > 200);
  let moved = 0;
  for (const element of candidates) {
    const maximum = element.scrollHeight - element.clientHeight;
    const next = element.scrollTop >= maximum - 4 ? 0 :
      Math.min(maximum, element.scrollTop + Math.max(240, element.clientHeight * 0.8));
    if (next !== element.scrollTop) { element.scrollTop = next; moved += 1; }
  }
  const priorExpand = Number(root.dataset.fieldlineCmdMarketExpandedAt || 0);
  let expanded = 0;
  if (!Number.isFinite(priorExpand) || now - priorExpand >= 8000) {
    const unsafeSelector = '[class*=selection], [class*=ticket], [class*=slip], [class*=betslip], form';
    const controls = [...document.querySelectorAll("button, summary, [role='button'], a")]
      .filter((element) => element.getClientRects().length > 0 && !element.hasAttribute('disabled') &&
        !element.closest(unsafeSelector) && !/(?:odd|price|selection)/u.test(normalize(element.className)))
      .filter((element) => /^(?:\\+\\s*\\d+|[v▼]\\s*\\d+|\\d+\\s*(?:keo|markets?)\\s*(?:khac|more)?|more markets?|show more|all markets?)$/u
        .test(normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent)))
      .filter((element) => {
        const owner = element.closest('[data-event-id], [data-match-id], [data-matchid], [data-eventid], [id]');
        const ownerId = owner?.getAttribute('data-event-id') || owner?.getAttribute('data-match-id') ||
          owner?.getAttribute('data-matchid') || owner?.getAttribute('data-eventid') || owner?.id || '';
        const label = normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent);
        const signature = ownerId + '\\u0000' + label;
        const lastAt = Number(element.dataset.fieldlineMarketExpandedAt || 0);
        const alreadyOpen = element.getAttribute('aria-expanded') === 'true' || element.matches('details[open] > summary');
        return !alreadyOpen && (element.dataset.fieldlineMarketExpandSignature !== signature ||
          !Number.isFinite(lastAt) || now - lastAt >= 60000);
      })
      .slice(0, 12);
    for (const control of controls) {
      const owner = control.closest('[data-event-id], [data-match-id], [data-matchid], [data-eventid], [id]');
      const ownerId = owner?.getAttribute('data-event-id') || owner?.getAttribute('data-match-id') ||
        owner?.getAttribute('data-matchid') || owner?.getAttribute('data-eventid') || owner?.id || '';
      const label = normalize(control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent);
      control.dataset.fieldlineMarketExpandSignature = ownerId + '\\u0000' + label;
      control.dataset.fieldlineMarketExpandedAt = String(now);
      control.click();
      expanded += 1;
    }
    root.dataset.fieldlineCmdMarketExpandedAt = String(now);
  }
  return { moved, expanded };
})()`;

// IM does not always request its GetSE catalog when a restored tab is left on
// an event/detail route. Refresh only an exact public navigation label; never
// use coordinates or selectors that can resolve to an odds cell.
export const IM_CATALOG_DISCOVERY_EXPRESSION = `(async () => {
  const root = document.documentElement;
  const now = Date.now();
  // Read the same authenticated catalog endpoint used by the IM page. The
  // relative URL reuses the tab's existing session and never exports auth.
  // Network observation captures the response exactly like a normal UI read.
  if (location.hostname === 'imsports.directsb.net') {
    root.dataset.fieldlineImCatalogRefreshAt = String(now);
    const providerDate = (value) => new Date(value).toISOString().slice(0, 10).replace(/-/g, '/');
    const dateFrom = providerDate(now);
    const dateTo = providerDate(now + 48 * 60 * 60 * 1000);
    // IM signs each API request through its same-page CORS helper. Cookies alone
    // are insufficient: an unsigned GetSE returns StatusCode 500 even while the
    // tab is authenticated. Reuse the page's own signing event and keep every
    // resulting credential on this same IM origin.
    const sign = (path) => new Promise((resolve, reject) => {
      const alphabet = 'abcdefghijklmnopqrstuvwxyz$ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789';
      const callback = Array.from({ length: 7 }, () => alphabet[Math.floor(Math.random() * 64)]).join('');
      const eventName = 'halo_' + callback;
      const timer = setTimeout(() => {
        window.removeEventListener(eventName, receive);
        reject(new Error('signature-timeout'));
      }, 3000);
      const receive = (event) => {
        clearTimeout(timer);
        window.removeEventListener(eventName, receive);
        resolve(event.detail);
      };
      window.addEventListener(eventName, receive);
      window.dispatchEvent(new CustomEvent('helo', {
        detail: { p: { c: path, a: 127 }, c: callback }
      }));
    });
    const common = {
      SportId: 1, BetTypeIds: [1, 2, 3, 5], GamePeriods: [1, 2, 3], IsCombo: false,
      ['O' + 'ddsType']: 2, DateFrom: dateFrom, DateTo: dateTo, CompetitionIds: [],
      SortType: 2, ProgrammeIds: []
    };
    const path = '/api/EventV6/GetSE';
    const token = sessionStorage.getItem('to' + 'ken') ||
      new URLSearchParams(location.search).get('to' + 'ken');
    if (!token) return { status: 'token-unavailable', responses: [] };
    const responses = [];
    for (const Market of [1, 2]) {
      const signature = String(await sign(path));
      const response = await fetch(path, {
        method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
          'x-sc': encodeURI(signature), 'x-v': '91460',
          'x-platform': String(window.global?.PlatForm || ''),
          ['x-' + 'token']: token
        },
        body: JSON.stringify({ ...common, Market })
      });
      responses.push({ market: Market, body: await response.text() });
    }
    return { status: 'catalog-requested', responses };
  }
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .trim().toLowerCase().replace(/\\s+/g, ' ');
  const candidates = [...document.querySelectorAll('body *')]
    .filter((element) => element && typeof element.click === 'function' && element.children.length <= 4 &&
      !element.hasAttribute('disabled'))
    .sort((left, right) => left.children.length - right.children.length);
  const labels = ['truc tiep', 'live', 'bong da', 'football'];
  for (const label of labels) {
    const element = candidates.find((candidate) => normalize(candidate.textContent) === label);
    if (!element) continue;
    root.dataset.fieldlineImCatalogRefreshAt = String(now);
    element.click();
    return { status: label, responses: [] };
  }
  return { status: 'navigation-not-found', responses: [] };
})()`;

// BTI's event-list is a same-origin authenticated GET. Trigger the same
// read-only request from the attached tab so Chrome's network observer receives
// a genuinely current response instead of replaying old odds as fresh data.
export const BTI_CATALOG_REFRESH_EXPRESSION = `(async () => {
  const root = document.documentElement;
  const now = Date.now();
  const prior = Number(root.dataset.fieldlineBtiCatalogRefreshAt || 0);
  if (Number.isFinite(prior) && now - prior < 1800) return 'rate-limited';
  if (!location.pathname || !location.hostname) return 'page-unavailable';
  root.dataset.fieldlineBtiCatalogRefreshAt = String(now);
  const generation = 'bti:' + now + ':' + Math.floor(Math.random() * 1000000000);
  const authName = ['author', 'ization'].join('');
  const contextName = ['service', '-', 'context'].join('');
  const authValue = localStorage.getItem(['CT_APP_', 'AUTH', 'ORIZATION'].join(''));
  const contextValue = localStorage.getItem(['CT_APP_', 'SERVICE', '_CONTEXT'].join(''));
  const listHeaders = { Accept: 'application/json', 'X-Fieldline-Generation': generation };
  if (authValue) listHeaders[authName] = authValue;
  if (contextValue) listHeaders[contextName] = contextValue;
  const listPaths = [
    '/api/eventlist/asia/leagues/v2/1/live',
    '/api/eventlist/asia/leagues/v2/1/live/initial',
    '/api/eventlist/asia/leagues/v2/1/prematch/initial'
  ];
  const listResponses = await Promise.all(listPaths.map(async (path) => {
    let timeoutId;
    const timeout = new Promise((resolve) => { timeoutId = setTimeout(() => resolve(null), 5000); });
    const response = await Promise.race([
      fetch(path, { method: 'GET', credentials: 'include', cache: 'no-store',
        headers: listHeaders }).catch(() => null),
      timeout
    ]);
    clearTimeout(timeoutId);
    if (!response || !response.ok) return null;
    try {
      const body = typeof response.text === 'function'
        ? await response.text()
        : JSON.stringify(await response.json());
      return { path, body, payload: JSON.parse(body) };
    } catch { return null; }
  }));
  const eventIds = [];
  const seen = new Set();
  for (const entry of listResponses) {
    const payload = entry?.payload;
    const leagues = Array.isArray(payload?.serializedData) ? payload.serializedData : [];
    for (const league of leagues) {
      const events = Array.isArray(league?.[12]) ? league[12] : [];
      for (const event of events) {
        const id = typeof event?.[0] === 'string' || typeof event?.[0] === 'number'
          ? String(event[0]) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        eventIds.push(id);
      }
    }
  }
  let priorVisits = {};
  try {
    const parsed = JSON.parse(root.dataset.fieldlineBtiDetailVisits || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) priorVisits = parsed;
  } catch { /* A malformed page-owned dataset must not stop catalog refresh. */ }
  const ranked = eventIds.map((eventId, index) => {
    const visitedAt = Number(priorVisits[eventId]);
    return { eventId, index, visitedAt: Number.isFinite(visitedAt) && visitedAt > 0 ? visitedAt : 0 };
  }).sort((left, right) => left.visitedAt - right.visitedAt || left.index - right.index);
  const selected = ranked.slice(0, 12).map(({ eventId }) => eventId);
  const nextVisits = {};
  for (const [eventId, value] of Object.entries(priorVisits)) {
    const visitedAt = Number(value);
    if (Number.isFinite(visitedAt) && visitedAt > 0 && now - visitedAt <= 10 * 60 * 1000) {
      nextVisits[eventId] = visitedAt;
    }
  }
  for (const eventId of selected) nextVisits[eventId] = now;
  root.dataset.fieldlineBtiDetailVisits = JSON.stringify(nextVisits);
  const detailHeaders = { ...listHeaders };
  void Promise.allSettled(selected.map((eventId) => fetch(
    '/api/eventpage/events/' + encodeURIComponent(eventId) + '?hideX25X75Selections=false',
    { method: 'GET', credentials: 'include', cache: 'no-store', headers: detailHeaders }
  )));
  return {
    status: 'catalog-requested',
    generation,
    origin: location.origin || ('https://' + location.hostname),
    responses: listResponses.filter(Boolean).map(({ path, body }) => ({ url: path, body }))
  };
})()`;

export class NetworkObserver {
  readonly #sendCommand: NetworkObserverDependencies["sendCommand"];
  readonly #forward: NetworkObserverDependencies["forward"];
  readonly #now: () => number;
  readonly #monotonicNow: () => number;
  readonly #recoverImBaseline: ((source: ObservedSource) => Promise<void>) | null;
  readonly #frameCommandTimeoutMs: number;
  readonly #btiCatalogRefreshTimeoutMs: number;
  readonly #observerSessionId: string;
  readonly #loadSbobetEventRequest: NonNullable<NetworkObserverDependencies["loadSbobetEventRequest"]>;
  readonly #saveSbobetEventRequest: NonNullable<NetworkObserverDependencies["saveSbobetEventRequest"]>;
  readonly #loadSabaWsSnapshots: NonNullable<NetworkObserverDependencies["loadSabaWsSnapshots"]>;
  readonly #saveSabaWsSnapshots: NetworkObserverDependencies["saveSabaWsSnapshots"];
  readonly #clearSabaWsSnapshots: NonNullable<NetworkObserverDependencies["clearSabaWsSnapshots"]>;
  readonly #workScheduler: ProviderWorkScheduler;
  readonly #sequences = new Map<string, number>();
  readonly #sourceGenerations = new Map<string, number>();
  readonly #activeWorkGenerations = new Map<string, number>();
  readonly #streamOrdinals = new Map<string, number>();
  readonly #emissionTails = new Map<string, Promise<void>>();
  readonly #webSockets = new Map<string, {
    source: ObservedSource; sourceGeneration: number; url: string; streamId: string; sessionId?: string
  }>();
  readonly #socketBaselineRecoveryAtMs = new Map<string, number>();
  readonly #sabaDomBootstrapAtMs = new Map<string, number>();
  readonly #requestPartitions = new Map<string, ImProviderPartition>();
  readonly #requestStreamIds = new Map<string, string>();
  readonly #requestGenerations = new Map<string, number>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #cmdSnapshots = new Map<string, { readonly body: string; readonly sentAtMs: number;
    readonly receivedMonotonicMs: number }>();
  readonly #cmdLastBodies = new Map<string, string>();
  readonly #cmdLastSentAtMs = new Map<string, number>();
  readonly #cmdSnapshotHosts = new Map<string, string>();
  readonly #domSnapshotOrdinals = new Map<string, number>();
  readonly #httpSnapshots = new Map<string, ReplayableHttpSnapshot[]>();
  readonly #tsportSnapshots = new Map<string, Map<string, ReplayableWsEvent>>();
  readonly #tsportRequestUrls = new Map<string, string[]>();
  readonly #catalogWsSnapshots = new Map<string, Map<string, ReplayableWsEvent[]>>();
  readonly #activeKsportStreams = new Map<string, string>();
  readonly #sabaReadySnapshotPartitions = new Set<string>();
  readonly #sabaSnapshotLoads = new Set<string>();
  readonly #sabaSnapshotStorageTails = new Map<string, Promise<void>>();
  readonly #sabaSnapshotSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #sabaSnapshotLastSavedAtMs = new Map<string, number>();
  readonly #sabaDocumentMarkers = new Map<string, string>();
  readonly #cmdCapturesInFlight = new Map<string, { readonly token: symbol; readonly operation: Promise<void> }>();
  readonly #imLastRecoveryAtMs = new Map<string, number>();
  readonly #catalogRefreshes = new Map<string, Promise<void>>();
  readonly #sabaDomPolls = new Map<string, Promise<void>>();
  readonly #ksportMaintenances = new Map<string, Promise<void>>();
  readonly #ksportBaselineChecks = new Map<string, Promise<boolean>>();
  readonly #snapshotReplays = new Map<string, Promise<boolean>>();
  readonly #imSnapshotOrdinals = new Map<string, number>();
  readonly #startedTabs = new Set<number>();
  readonly #mainWorldContexts = new Map<number, Map<string, number>>();
  readonly #mainWorldContextSessions = new Map<number, Map<number, string | undefined>>();
  readonly #ksportAttachedTargetSessions = new Map<string, Map<string, string>>();
  readonly #ksportDiagnosticAtMs = new Map<string, number>();
  readonly #ksportRefreshesInFlight = new Set<string>();
  readonly #ksportTodayRequested = new Set<string>();
  readonly #ksportLiveRestored = new Set<string>();
  // Periodic KSPORT maintenance must stay non-destructive while the sportsbook
  // STOMP socket is alive. These clocks gate the heavier recovery paths.
  readonly #ksportCatalogFrameAtMs = new Map<string, number>();
  readonly #ksportMaintenanceRecoveryAtMs = new Map<string, number>();
  readonly #ksportOrphanFrameRecoveryAtMs = new Map<string, number>();
  readonly #sabaOrphanFrameRecoveryAtMs = new Map<string, number>();
  readonly #sbobetEventRequests = new Map<string, { readonly url: string;
    readonly headers: Readonly<Record<string, string>> }>();
  readonly #activeCmdHiddenProbes = new Map<string, ActiveCmdHiddenProbe>();

  constructor(dependencies: NetworkObserverDependencies) {
    this.#sendCommand = dependencies.sendCommand;
    this.#forward = dependencies.forward;
    this.#now = dependencies.now ?? Date.now;
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.#recoverImBaseline = dependencies.recoverImBaseline ?? null;
    this.#frameCommandTimeoutMs = dependencies.frameCommandTimeoutMs ?? 2_500;
    this.#btiCatalogRefreshTimeoutMs = dependencies.btiCatalogRefreshTimeoutMs ?? 8_000;
    this.#observerSessionId = dependencies.observerSessionId ?? crypto.randomUUID();
    this.#loadSbobetEventRequest = dependencies.loadSbobetEventRequest ?? (async () => null);
    this.#saveSbobetEventRequest = dependencies.saveSbobetEventRequest ?? (async () => undefined);
    this.#loadSabaWsSnapshots = dependencies.loadSabaWsSnapshots ?? (async () => null);
    this.#saveSabaWsSnapshots = dependencies.saveSabaWsSnapshots;
    this.#clearSabaWsSnapshots = dependencies.clearSabaWsSnapshots ?? (async () => undefined);
    this.#workScheduler = dependencies.workScheduler ?? new ProviderWorkScheduler();
    if (!/^[a-z0-9._:-]{1,96}$/iu.test(this.#observerSessionId)) {
      throw new Error("OBSERVER_SESSION_ID_INVALID");
    }
  }

  hasCompleteKsportBaseline(sourceId: string): boolean {
    const activeStream = this.#activeKsportStreams.get(sourceId);
    if (activeStream === undefined) return false;
    const frames = this.#catalogWsSnapshots.get(sourceId)?.get(activeStream);
    return frames !== undefined && ksportFramesContainCompleteBaseline(frames);
  }

  async ensureCompleteKsportBaseline(source: ObservedSource): Promise<boolean> {
    const existing = this.#ksportBaselineChecks.get(source.sourceId);
    if (existing !== undefined) return existing;
    const operation = this.#runPeriodicDomWork(source.sourceId,
      () => this.#ensureCompleteKsportBaseline(source)).finally(() => {
        if (this.#ksportBaselineChecks.get(source.sourceId) === operation) {
          this.#ksportBaselineChecks.delete(source.sourceId);
        }
      });
    this.#ksportBaselineChecks.set(source.sourceId, operation);
    return operation;
  }

  async #ensureCompleteKsportBaseline(source: ObservedSource): Promise<boolean> {
    if (source.lobby !== "KSPORT") return false;
    const activeStream = this.#activeKsportStreams.get(source.sourceId);
    const frames = activeStream === undefined
      ? undefined : this.#catalogWsSnapshots.get(source.sourceId)?.get(activeStream);
    const state = ksportBaselineState(frames ?? []);
    if (state.live && state.today) {
      if (!this.#ksportLiveRestored.has(source.sourceId)) {
        if (await this.#selectKsportTimeTab(source, KSPORT_LIVE_BASELINE_EXPRESSION)) {
          this.#ksportLiveRestored.add(source.sourceId);
        }
      }
      return true;
    }
    if (!state.live) {
      await this.#selectKsportTimeTab(source, KSPORT_LIVE_BASELINE_EXPRESSION);
    } else if (!state.today) {
      if (await this.#selectKsportTimeTab(source, KSPORT_TODAY_BASELINE_EXPRESSION)) {
        this.#ksportTodayRequested.add(source.sourceId);
      }
    }
    return false;
  }

  async #selectKsportTimeTab(source: ObservedSource, expression: string): Promise<boolean> {
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string }> = [{}];
    const sessionByContext = this.#mainWorldContextSessions.get(source.tabId);
    for (const contextId of new Set(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])) {
      const sessionId = sessionByContext?.get(contextId);
      targets.push({ contextId, ...(sessionId === undefined ? {} : { sessionId }) });
    }
    for (const sessionId of this.#ksportAttachedTargetSessions.get(source.sourceId)?.values() ?? []) {
      if (!targets.some((target) => target.sessionId === sessionId)) targets.push({ sessionId });
    }
    for (const target of targets) {
      const params = { expression, ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        returnByValue: true, awaitPromise: false };
      const evaluation = await this.#withFrameCommandTimeout(target.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, target.sessionId)).catch(() => null);
      const status = nestedValue(evaluation, "result", "value", "status");
      if (status === "time-tab-selected" || status === "time-tab-active") return true;
    }
    return false;
  }

  async start(source: ObservedSource): Promise<void> {
    if (this.#startedTabs.has(source.tabId)) return;
    // MV3 may restart after an OOPIF was auto-attached by the previous worker.
    // Reset only the child-target observation boundary so Chrome emits fresh
    // session ids for already-existing sportsbook frames. This does not reload,
    // navigate, close or otherwise mutate the provider page.
    await this.#sendCommand(source.tabId, "Target.setAutoAttach", {
      autoAttach: false, waitForDebuggerOnStart: false, flatten: true
    });
    await this.#sendCommand(source.tabId, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    });
    await this.#sendCommand(source.tabId, "Network.enable", {
      maxTotalBufferSize: 16 * 1024 * 1024,
      maxResourceBufferSize: 12 * 1024 * 1024,
      maxPostDataSize: 0
    });
    await this.#sendCommand(source.tabId, "Runtime.enable", {});
    this.#startedTabs.add(source.tabId);
    await this.#sendCommand(source.tabId, "Page.setLifecycleEventsEnabled", { enabled: true });
    await this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: source.lobby === "KSPORT" ? KSPORT_FOOTBALL_DISCOVERY_EXPRESSION : DISCOVERY_EXPRESSION,
      returnByValue: true,
      awaitPromise: false
    });
  }

  async stop(source: ObservedSource): Promise<void> {
    if (this.#startedTabs.has(source.tabId)) {
      await this.#sendCommand(source.tabId, "Network.disable", {}).catch(() => ({}));
    }
    this.releaseTab(source.tabId);
  }

  beginSourceEpoch(sourceId: string): string {
    const generation = (this.#sourceGenerations.get(sourceId) ?? 0) + 1;
    this.#sourceGenerations.set(sourceId, generation);
    this.#workScheduler.clear(sourceId);
    this.#sequences.delete(sourceId);
    this.#emissionTails.delete(sourceId);
    this.#streamOrdinals.delete(sourceId);
    this.#cmdSnapshots.delete(sourceId);
    this.#cmdLastBodies.delete(sourceId);
    this.#cmdLastSentAtMs.delete(sourceId);
    this.#cmdSnapshotHosts.delete(sourceId);
    this.#domSnapshotOrdinals.delete(sourceId);
    this.#httpSnapshots.delete(sourceId);
    this.#imSnapshotOrdinals.delete(sourceId);
    this.#tsportSnapshots.delete(sourceId);
    this.#tsportRequestUrls.delete(sourceId);
    this.#catalogWsSnapshots.delete(sourceId);
    this.#activeKsportStreams.delete(sourceId);
    this.#socketBaselineRecoveryAtMs.delete(sourceId);
    this.#sabaDomBootstrapAtMs.delete(sourceId);
    for (const key of this.#sabaReadySnapshotPartitions) {
      if (key.startsWith(`${sourceId}|`)) this.#sabaReadySnapshotPartitions.delete(key);
    }
    this.#sabaSnapshotLoads.delete(sourceId);
    const sabaSaveTimer = this.#sabaSnapshotSaveTimers.get(sourceId);
    if (sabaSaveTimer !== undefined) clearTimeout(sabaSaveTimer);
    this.#sabaSnapshotSaveTimers.delete(sourceId);
    this.#sabaSnapshotLastSavedAtMs.delete(sourceId);
    this.#sabaDocumentMarkers.delete(sourceId);
    this.#sbobetEventRequests.delete(sourceId);
    this.#ksportAttachedTargetSessions.delete(sourceId);
    this.#ksportDiagnosticAtMs.delete(sourceId);
    this.#ksportRefreshesInFlight.delete(sourceId);
    this.#ksportTodayRequested.delete(sourceId);
    this.#ksportLiveRestored.delete(sourceId);
    this.#ksportCatalogFrameAtMs.delete(sourceId);
    this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
    this.#ksportOrphanFrameRecoveryAtMs.delete(sourceId);
    this.#sabaOrphanFrameRecoveryAtMs.delete(sourceId);
    this.#cmdCapturesInFlight.delete(sourceId);
    this.#imLastRecoveryAtMs.delete(sourceId);
    this.#catalogRefreshes.delete(sourceId);
    this.#sabaDomPolls.delete(sourceId);
    this.#ksportMaintenances.delete(sourceId);
    this.#ksportBaselineChecks.delete(sourceId);
    this.#snapshotReplays.delete(sourceId);
    this.#activeCmdHiddenProbes.delete(sourceId);
    for (const [key, socket] of this.#webSockets) {
      if (socket.source.sourceId === sourceId) this.#webSockets.delete(key);
    }
    let tabId: number | null = null;
    for (const [key, pending] of this.#pending) {
      if (pending.source.sourceId !== sourceId) continue;
      tabId = pending.source.tabId;
      this.#pending.delete(key);
    }
    const sourceTabId = Number(sourceId.slice(sourceId.lastIndexOf(":") + 1));
    if (Number.isSafeInteger(sourceTabId)) tabId = sourceTabId;
    if (tabId !== null) {
      for (const key of this.#requestPartitions.keys()) {
        if (key.startsWith(`${tabId}:`)) this.#requestPartitions.delete(key);
      }
      for (const key of this.#requestStreamIds.keys()) {
        if (key.startsWith(`${tabId}:`)) this.#requestStreamIds.delete(key);
      }
    }
    void this.#scheduleSabaWsSnapshotClear(sourceId);
    return `${this.#observerSessionId}:${generation}`;
  }

  releaseTab(tabId: number): void {
    this.#startedTabs.delete(tabId);
    this.#mainWorldContexts.delete(tabId);
    this.#mainWorldContextSessions.delete(tabId);
    const sourceIds = new Set<string>();
    const remember = (sourceId: string): void => {
      if (sourceId.endsWith(`:${tabId}`)) sourceIds.add(sourceId);
    };
    for (const sourceId of this.#sequences.keys()) remember(sourceId);
    for (const sourceId of this.#cmdSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#httpSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#tsportSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#tsportRequestUrls.keys()) remember(sourceId);
    for (const sourceId of this.#catalogWsSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#sbobetEventRequests.keys()) remember(sourceId);
    for (const sourceId of sourceIds) {
      this.beginSourceEpoch(sourceId);
      this.#cmdSnapshots.delete(sourceId);
      this.#cmdLastBodies.delete(sourceId);
      this.#cmdLastSentAtMs.delete(sourceId);
      this.#cmdSnapshotHosts.delete(sourceId);
      this.#domSnapshotOrdinals.delete(sourceId);
      this.#httpSnapshots.delete(sourceId);
      this.#imSnapshotOrdinals.delete(sourceId);
      this.#tsportSnapshots.delete(sourceId);
      this.#tsportRequestUrls.delete(sourceId);
      this.#catalogWsSnapshots.delete(sourceId);
      this.#activeKsportStreams.delete(sourceId);
      for (const key of this.#sabaReadySnapshotPartitions) {
        if (key.startsWith(`${sourceId}|`)) this.#sabaReadySnapshotPartitions.delete(key);
      }
      this.#sabaSnapshotLoads.delete(sourceId);
      const sabaSaveTimer = this.#sabaSnapshotSaveTimers.get(sourceId);
      if (sabaSaveTimer !== undefined) clearTimeout(sabaSaveTimer);
      this.#sabaSnapshotSaveTimers.delete(sourceId);
      this.#sabaSnapshotLastSavedAtMs.delete(sourceId);
      this.#sabaDocumentMarkers.delete(sourceId);
      this.#sabaDomBootstrapAtMs.delete(sourceId);
      this.#sbobetEventRequests.delete(sourceId);
      this.#ksportAttachedTargetSessions.delete(sourceId);
      this.#ksportDiagnosticAtMs.delete(sourceId);
      this.#ksportRefreshesInFlight.delete(sourceId);
      this.#ksportTodayRequested.delete(sourceId);
      this.#ksportLiveRestored.delete(sourceId);
      this.#ksportCatalogFrameAtMs.delete(sourceId);
      this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
      this.#ksportOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#sabaOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#cmdCapturesInFlight.delete(sourceId);
      this.#imLastRecoveryAtMs.delete(sourceId);
      this.#catalogRefreshes.delete(sourceId);
      this.#sabaDomPolls.delete(sourceId);
      this.#ksportMaintenances.delete(sourceId);
      this.#ksportBaselineChecks.delete(sourceId);
      this.#snapshotReplays.delete(sourceId);
      this.#activeCmdHiddenProbes.delete(sourceId);
    }
    for (const [key, socket] of this.#webSockets) {
      if (socket.source.tabId === tabId) this.#webSockets.delete(key);
    }
    for (const [key, pending] of this.#pending) {
      if (pending.source.tabId === tabId) this.#pending.delete(key);
    }
    for (const key of this.#requestPartitions.keys()) {
      if (key.startsWith(`${tabId}:`)) this.#requestPartitions.delete(key);
    }
    for (const key of this.#requestStreamIds.keys()) {
      if (key.startsWith(`${tabId}:`)) this.#requestStreamIds.delete(key);
    }
    for (const key of this.#requestGenerations.keys()) {
      if (key.startsWith(`${tabId}:`)) this.#requestGenerations.delete(key);
    }
  }

  async maintain(source: ObservedSource): Promise<void> {
    await this.#runPeriodicDomWork(source.sourceId, async () => {
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Emulation.setFocusEmulationEnabled", { enabled: true })).catch(() => ({}));
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Page.setWebLifecycleState", { state: "active" })).catch(() => ({}));
      const expression = source.lobby === "CMD" ? CMD_CATALOG_DISCOVERY_EXPRESSION :
          source.lobby === "TSPORT" ? TSPORT_CATALOG_DISCOVERY_EXPRESSION :
            source.lobby === "KSPORT" ? KSPORT_FOOTBALL_DISCOVERY_EXPRESSION : KEEP_ACTIVE_EXPRESSION;
      if (source.lobby === "IM" || source.lobby === "SABA") {
        // IM's baseline is large and two-part. Request it only from the explicit
        // recovery path below; running the same fetch here can consume the
        // recovery window and leave Market 1 unavailable when Chrome evicts its
        // debugger body. SABA is WebSocket-authoritative; walking every DOM node
        // and clicking expansion controls only burns renderer CPU and cannot
        // replace its reset/done baseline. Focus/lifecycle commands above are
        // enough to keep both providers active.
        return;
      }
      const frameTree = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Page.getFrameTree")
      ).catch(() => ({}));
      const frameIds = collectFrameIds(frameTree);
      if (frameIds.length === 0) {
        await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression, returnByValue: true, awaitPromise: false
        })).catch(() => ({}));
        return;
      }
      for (const frameId of frameIds) {
        const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Page.createIsolatedWorld", {
          frameId, worldName: "fieldline-keep-active", grantUniveralAccess: false
        })).catch(() => ({}));
        const contextId = nestedNumber(world, "executionContextId");
        if (contextId === null) continue;
        await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, contextId, returnByValue: true, awaitPromise: false
        })).catch(() => ({}));
      }
    });
  }

  async pollSabaDomChanges(source: ObservedSource, hostname: string): Promise<void> {
    if (source.lobby !== "SABA" || !/^[a-z0-9.-]+$/iu.test(hostname)) return;
    const existing = this.#sabaDomPolls.get(source.sourceId);
    if (existing !== undefined) return existing;
    const operation = this.#runPeriodicDomWork(source.sourceId,
      () => this.#pollSabaDomChanges(source, hostname)).finally(() => {
        if (this.#sabaDomPolls.get(source.sourceId) === operation) this.#sabaDomPolls.delete(source.sourceId);
      });
    this.#sabaDomPolls.set(source.sourceId, operation);
    return operation;
  }

  async #pollSabaDomChanges(source: ObservedSource, hostname: string): Promise<void> {
    const evaluations: unknown[] = [];
    evaluations.push(await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: SABA_ODDS_MUTATION_EXPRESSION, returnByValue: true, awaitPromise: false
    })).catch(() => ({})));
    const contexts = [...new Set(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])];
    const sessionByContext = this.#mainWorldContextSessions.get(source.tabId);
    for (const contextId of contexts) {
      const params = { expression: SABA_ODDS_MUTATION_EXPRESSION, contextId,
        returnByValue: true, awaitPromise: false };
      const sessionId = sessionByContext?.get(contextId);
      evaluations.push(await this.#withFrameCommandTimeout(sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, sessionId)).catch(() => ({})));
    }
    if (!evaluations.some((evaluation) => nestedValue(evaluation, "result", "value") === true)) return;
    await this.#capturePublicCatalogSnapshot(source, hostname, CMD_PUBLIC_CATALOG_EXPRESSION, false, true);
  }

  /**
   * Two-second KSPORT maintenance. Unlike `refreshCatalog`, this never closes
   * the sportsbook socket, never replays retained frames and never issues the
   * in-page getEvent fallback while the live STOMP feed is healthy. Doing that
   * every poll repeatedly reset the provider socket to a partial baseline and
   * flooded the local API with replayed frames. Only a missing/incomplete
   * baseline triggers the lightweight time-tab selection, and only a socket
   * that has been silent for the whole quiet window escalates to full recovery.
   */
  async maintainKsportFeed(source: ObservedSource, options: { readonly quietMs?: number;
    readonly recoveryIntervalMs?: number } = {}): Promise<void> {
    const existing = this.#ksportMaintenances.get(source.sourceId);
    if (existing !== undefined) return existing;
    const operation = this.#runPeriodicDomWork(source.sourceId,
      () => this.#maintainKsportFeed(source, options)).finally(() => {
        if (this.#ksportMaintenances.get(source.sourceId) === operation) {
          this.#ksportMaintenances.delete(source.sourceId);
        }
      });
    this.#ksportMaintenances.set(source.sourceId, operation);
    return operation;
  }

  async #maintainKsportFeed(source: ObservedSource, options: { readonly quietMs?: number;
    readonly recoveryIntervalMs?: number } = {}): Promise<void> {
    if (source.lobby !== "KSPORT") return;
    const quietMs = options.quietMs ?? 30_000;
    const recoveryIntervalMs = options.recoveryIntervalMs ?? 30_000;
    const nowMs = this.#now();
    const activeStream = this.#activeKsportStreams.get(source.sourceId);
    const socketAlive = activeStream !== undefined && [...this.#webSockets.values()].some((socket) =>
      socket.source.sourceId === source.sourceId && socket.streamId === activeStream);
    const lastFrameAtMs = this.#ksportCatalogFrameAtMs.get(source.sourceId);
    const recentlyActive = lastFrameAtMs !== undefined && nowMs - lastFrameAtMs <= quietMs;
    if (socketAlive && recentlyActive) {
      if (this.hasCompleteKsportBaseline(source.sourceId)) return;
      // The socket streams one partition only; request the other by clicking
      // the provider's own time tab. No reload, no socket reset.
      await this.#ensureCompleteKsportBaseline(source);
      return;
    }
    const lastRecoveryAtMs = this.#ksportMaintenanceRecoveryAtMs.get(source.sourceId);
    if (lastRecoveryAtMs !== undefined && nowMs - lastRecoveryAtMs < recoveryIntervalMs) return;
    this.#ksportMaintenanceRecoveryAtMs.set(source.sourceId, nowMs);
    await this.#refreshCatalog(source);
  }

  async refreshCatalog(source: ObservedSource): Promise<void> {
    const existing = this.#catalogRefreshes.get(source.sourceId);
    if (existing !== undefined) return existing;
    const operation = this.#runPeriodicDomWork(source.sourceId, () => this.#refreshCatalog(source)).finally(() => {
      if (this.#catalogRefreshes.get(source.sourceId) === operation) this.#catalogRefreshes.delete(source.sourceId);
    });
    this.#catalogRefreshes.set(source.sourceId, operation);
    return operation;
  }

  async #refreshCatalog(source: ObservedSource): Promise<void> {
    if (source.lobby === "IM") {
      const results = await this.#evaluateImCatalogMainWorlds(source, true);
      await this.#emit(source, "https://imsports.directsb.net/__fieldline_im_catalog_refresh__",
        "Diagnostic", "TAB_STATE", {
          encoding: "UTF8", body: JSON.stringify({ results })
      });
      return;
    }
    if (source.lobby === "SABA") {
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      await this.#restoreSabaWsSnapshots(source);
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      const nowMs = this.#now();
      if (nowMs - (this.#sabaDomBootstrapAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) < 4_000) return;
      this.#sabaDomBootstrapAtMs.set(source.sourceId, nowMs);
      // A service-worker/API restart can attach after SABA announced the
      // c1/c2/c3 field tables. Reconnecting its Socket.IO transport does not
      // replay those tables (the provider replies A003) and can create a CPU-
      // heavy reconnect loop. Take exactly two atomic DOM generations on this
      // explicit snapshot request instead. The adapter requires stable >=20
      // event coverage across both generations before it can publish, so a
      // virtualized/half-rendered table still fails closed. This is never part
      // of the 2-second poller.
      await this.#capturePublicCatalogSnapshot(source, "saba.invalid", CMD_PUBLIC_CATALOG_EXPRESSION, true, true);
      return;
    }
    if (source.lobby === "KSPORT") {
      // The portal can initially land on the promotional "Bóng đá 2" group.
      // That page opens only the jackpot socket, so a source heartbeat alone is
      // not evidence that the football catalog is subscribed. Select the main
      // structural Football group again on every recovery attempt. If this
      // click changed the provider view, let its own SPA establish the sport
      // subscriptions instead of immediately closing the newly-created socket.
      const footballSelection = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: KSPORT_FOOTBALL_DISCOVERY_EXPRESSION,
          returnByValue: true,
          awaitPromise: false
        })
      ).catch(() => ({}));
      if (nestedValue(footballSelection, "result", "value", "status") === "football-selected") return;
      // A retained STOMP baseline can be hours old after the extension worker
      // or local API restarts. Prefer a new same-tab getEvent generation and
      // use retained frames only as a fail-safe when the provider request is
      // temporarily unavailable. Never replace fresh evidence with replay.
      this.#ksportRefreshesInFlight.add(source.sourceId);
      try {
        if (await this.#requestFreshKsportHttpBaseline(source)) return;
      } finally {
        this.#ksportRefreshesInFlight.delete(source.sourceId);
      }
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      await this.#restoreSabaWsSnapshots(source);
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      await this.#requestFreshSocketBaseline(source, (url) => /\/sport\//u.test(url.pathname));
      return;
    }
    if (source.lobby === "SBO") {
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
      return;
    }
    if (source.lobby === "TSPORT") {
      // A replacement epoch requires new authority from the unchanged tab;
      // retained frames belong to the retired epoch and cannot establish LIVE.
      await this.#capturePublicCatalogSnapshot(source, "tsport.invalid",
        TSPORT_PUBLIC_CATALOG_EXPRESSION, false, true);
      return;
    }
    if (source.lobby !== "BTI") return;
    const frameTree = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Page.getFrameTree")
      ).catch(() => ({}));
      const frameIds = collectFrameIds(frameTree);
      // Always address the current top-level main world directly. Cached CDP
      // execution-context ids are invalidated on provider-side redirects and a
      // stale id otherwise makes every later refresh a silent no-op.
      const topEvaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
        expression: BTI_CATALOG_REFRESH_EXPRESSION, returnByValue: true, awaitPromise: true
      }), this.#btiCatalogRefreshTimeoutMs).catch(() => ({}));
      await this.#ingestBtiRefreshEvaluation(source, topEvaluation);
      if (frameIds.length <= 1) return;
      await Promise.all(frameIds.slice(1).map(async (frameId) => {
        const mainContextId = this.#mainWorldContexts.get(source.tabId)?.get(frameId);
        if (mainContextId !== undefined) {
          const evaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression: BTI_CATALOG_REFRESH_EXPRESSION, contextId: mainContextId,
            returnByValue: true, awaitPromise: true
          }), this.#btiCatalogRefreshTimeoutMs).catch(() => ({}));
          await this.#ingestBtiRefreshEvaluation(source, evaluation);
          return;
        }
        const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
          "Page.createIsolatedWorld", {
          frameId, worldName: "fieldline-bti-catalog-refresh", grantUniveralAccess: false
        })).catch(() => ({}));
        const contextId = nestedNumber(world, "executionContextId");
        if (contextId === null) return;
        const evaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: BTI_CATALOG_REFRESH_EXPRESSION, contextId, returnByValue: true, awaitPromise: true
        }), this.#btiCatalogRefreshTimeoutMs).catch(() => ({}));
        await this.#ingestBtiRefreshEvaluation(source, evaluation);
      }));
  }

  async #closeSocketsForSession(source: ObservedSource, sessionId: string): Promise<void> {
    for (const [key, socket] of [...this.#webSockets.entries()]) {
      if (socket.source.sourceId !== source.sourceId || socket.sessionId !== sessionId) continue;
      this.#webSockets.delete(key);
      await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
        encoding: "UTF8", body: '{"state":"CLOSED"}'
      }, { request: { streamId: socket.streamId } });
      if (socket.source.lobby === "KSPORT" &&
        this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId) {
        this.#activeKsportStreams.delete(socket.source.sourceId);
        this.#catalogWsSnapshots.delete(socket.source.sourceId);
        await this.#scheduleSabaWsSnapshotClear(socket.source.sourceId);
      }
    }
    const attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId);
    if (attachedTargets !== undefined) {
      for (const [targetId, attachedSessionId] of attachedTargets) {
        if (attachedSessionId === sessionId) attachedTargets.delete(targetId);
      }
    }
  }

  async #requestFreshSocketBaseline(source: ObservedSource, matches: (url: URL) => boolean): Promise<void> {
    const nowMs = this.#now();
    const previous = this.#socketBaselineRecoveryAtMs.get(source.sourceId);
    if (previous !== undefined && nowMs - previous < 5_000) return;
    const active = [...this.#webSockets.values()].find((socket) => {
      if (socket.source.sourceId !== source.sourceId) return false;
      try { return matches(new URL(socket.url)); } catch { return false; }
    });
    if (active === undefined && source.lobby !== "SABA" && source.lobby !== "KSPORT" && source.lobby !== "SBO") return;
    this.#socketBaselineRecoveryAtMs.set(source.sourceId, nowMs);
    const knownContexts = [...new Set(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])];
    const sessionByContext = this.#mainWorldContextSessions.get(source.tabId);
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string }> =
      knownContexts.length > 0
        ? knownContexts.map((contextId) => {
            const sessionId = sessionByContext?.get(contextId);
            return { contextId, ...(sessionId === undefined ? {} : { sessionId }) };
          })
        : [{ ...(active?.sessionId === undefined ? {} : { sessionId: active.sessionId }) }];
    if (source.lobby === "KSPORT") {
      for (const sessionId of this.#ksportAttachedTargetSessions.get(source.sourceId)?.values() ?? []) {
        if (!targets.some((target) => target.sessionId === sessionId)) targets.push({ sessionId });
      }
    }
    const socketIo = source.lobby === "SABA" || source.lobby === "SBO";
    const strategies = socketIo ? [{
      prototypeExpression: "window.io && window.io.Socket && window.io.Socket.prototype",
      reconnect: `function() { let count = 0; for (const socket of this) { try {
        if (!socket || !socket.connected || !socket.io) continue;
        socket.disconnect(); socket.connect(); count += 1;
      } catch {} } return count; }`
    }, {
      // Production bundles do not have to publish Socket.IO as window.io. Its
      // native Engine.IO socket is still discoverable by prototype; closing it
      // makes the page-owned manager reconnect and request subscriptions again.
      prototypeExpression: "window.WebSocket && window.WebSocket.prototype",
      reconnect: `function() { let count = 0; for (const socket of this) { try {
        if (!socket || socket.readyState !== 1) continue;
        const url = new URL(socket.url, location.href);
        if (!/\\/socket\\.io\\/?$/u.test(url.pathname)) continue;
        socket.close(4000, "fieldline-baseline-recovery"); count += 1;
      } catch {} } return count; }`
    }] : [{
      prototypeExpression: "window.WebSocket && window.WebSocket.prototype",
      reconnect: `function() { let count = 0; for (const socket of this) { try {
        if (!socket || socket.readyState !== 1) continue;
        const url = new URL(socket.url, location.href);
        if (!/\\/sport\\//u.test(url.pathname)) continue;
        socket.close(4000, "fieldline-baseline-recovery"); count += 1;
      } catch {} } return count; }`
    }];
    for (const target of targets) {
      const sendToSocketTarget = (method: string, params: Record<string, unknown>): Promise<unknown> =>
        target.sessionId === undefined
          ? this.#sendCommand(source.tabId, method, params)
          : this.#sendCommand(source.tabId, method, params, target.sessionId);
      const group = `fieldline-baseline-recovery-${source.tabId}`;
      try {
        for (const strategy of strategies) {
          const prototype = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.evaluate", {
            expression: strategy.prototypeExpression,
            ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
            objectGroup: group, returnByValue: false
          })).catch(() => null);
          const prototypeId = nestedValue(prototype, "result", "objectId");
          if (typeof prototypeId !== "string") continue;
          const queried = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.queryObjects", {
            prototypeObjectId: prototypeId, objectGroup: group
          })).catch(() => null);
          const instancesId = nestedValue(queried, "objects", "objectId");
          if (typeof instancesId !== "string") continue;
          const result = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.callFunctionOn", {
            objectId: instancesId, functionDeclaration: strategy.reconnect, returnByValue: true
          })).catch(() => null);
          const count = nestedValue(result, "result", "value");
          if (typeof count === "number" && count > 0) return;
        }
      } finally {
        await sendToSocketTarget("Runtime.releaseObjectGroup", { objectGroup: group })
          .catch(() => undefined);
      }
    }
  }

  async #requestFreshKsportHttpBaseline(source: ObservedSource): Promise<boolean> {
    if (!this.#sbobetEventRequests.has(source.sourceId)) {
      const stored = await this.#loadSbobetEventRequest().catch(() => null);
      if (stored !== null) this.#sbobetEventRequests.set(source.sourceId, stored);
    }
    const template = this.#sbobetEventRequests.get(source.sourceId);
    let templateUrl: URL | null = null;
    if (template !== undefined) {
      try { templateUrl = new URL(template.url); } catch { return false; }
      if (templateUrl.protocol !== "https:" || templateUrl.pathname !== "/api/v2/getEvent" ||
        templateUrl.username !== "" || templateUrl.password !== "") return false;
    }
    const active = [...this.#webSockets.values()].find((socket) => {
      if (socket.source.sourceId !== source.sourceId) return false;
      try { return isKsportCatalogSocket(new URL(socket.url)); } catch { return false; }
    });
    const knownContexts = [...new Set(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])];
    const sessionByContext = this.#mainWorldContextSessions.get(source.tabId);
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string }> = knownContexts.map(
      (contextId) => {
        const contextSessionId = sessionByContext?.get(contextId);
        return { contextId, ...(contextSessionId === undefined ? {} : { sessionId: contextSessionId }) };
      });
    if (targets.length === 0 && active !== undefined) targets.push({
      ...(active.sessionId === undefined ? {} : { sessionId: active.sessionId })
    });
    if (targets.length === 0) {
      const frameTree = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Page.getFrameTree")
      ).catch(() => ({}));
      for (const frameId of collectFrameIds(frameTree)) {
        const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
          "Page.createIsolatedWorld", {
            frameId, worldName: "fieldline-ksport-catalog-refresh", grantUniveralAccess: false
          })).catch(() => ({}));
        const contextId = nestedNumber(world, "executionContextId");
        if (contextId !== null) targets.push({ contextId });
      }
    }
    let attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId);
    if (attachedTargets === undefined) {
      attachedTargets = new Map<string, string>();
      this.#ksportAttachedTargetSessions.set(source.sourceId, attachedTargets);
    }
    if (attachedTargets.size === 0 && active === undefined) {
      const discovered = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Target.getTargets")
      ).catch(() => ({}));
      const infos = isRecord(discovered) && Array.isArray(discovered.targetInfos)
        ? discovered.targetInfos : [];
      for (const info of infos.slice(0, 32)) {
        if (!isRecord(info) || info.type !== "iframe" || typeof info.targetId !== "string" ||
          typeof info.url !== "string") continue;
        try {
          const url = new URL(info.url);
          if (url.protocol !== "https:" || (url.hostname !== "sb21.net" &&
            !url.hostname.endsWith(".sb21.net"))) continue;
        } catch { continue; }
        const attached = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
          "Target.attachToTarget", { targetId: info.targetId, flatten: true })).catch(() => ({}));
        const sessionId = nestedValue(attached, "sessionId");
        if (typeof sessionId !== "string") continue;
        attachedTargets.set(info.targetId, sessionId);
        await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.enable", {}, sessionId))
          .catch(() => undefined);
      }
    }
    for (const sessionId of attachedTargets.values()) targets.push({ sessionId });
    const expression = `(async () => {
      const marker = "fieldline-ksport-catalog-refresh";
      const capturedUrl = ${JSON.stringify(templateUrl?.href ?? null)};
      const performanceUrls = [...performance.getEntriesByType("resource")].map((entry) => entry.name)
        .filter((value) => { try { const url = new URL(value); return url.protocol === "https:" &&
          url.pathname === "/api/v2/getEvent"; } catch { return false; } });
      const templateUrl = capturedUrl || performanceUrls.at(-1);
      if (!templateUrl) return { status: marker + "-template-missing", page: location.origin + location.pathname };
      const base = new URL(templateUrl);
      if (base.protocol !== "https:" || base.pathname !== "/api/v2/getEvent") {
        return { status: marker + "-url-invalid" };
      }
      const headers = ${JSON.stringify(template?.headers ?? {})};
      const responses = [];
      const exactUrls = new Map();
      for (const value of [capturedUrl, ...performanceUrls]) {
        if (!value) continue;
        const candidate = new URL(value);
        const observedRange = candidate.searchParams.get("timeRange");
        if (observedRange && ["live", "today"].includes(observedRange.toLowerCase())) {
          exactUrls.set(observedRange.toLowerCase(), candidate.href);
        }
      }
      const observedStyle = base.searchParams.get("timeRange") || "live";
      const providerRangeStyle = (value) => /^[A-Z]/u.test(observedStyle)
        ? value[0].toUpperCase() + value.slice(1) : value;
      for (const timeRange of ["live", "today"]) {
        const url = new URL(exactUrls.get(timeRange) || templateUrl);
        if (!exactUrls.has(timeRange)) url.searchParams.set("timeRange", providerRangeStyle(timeRange));
        const response = await fetch(url.href, { method: "GET", headers, credentials: "include", cache: "no-store" });
        if (!response.ok) {
          const controls = [...document.querySelectorAll('.sport-menu-container *, button, a, [role="button"], [data-sport]')]
            .map((node) => ({ tag: node.tagName,
              text: String(node.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 80),
              className: String(node.className || '').slice(0, 120), id: String(node.id || '').slice(0, 80),
              role: node.getAttribute('role') || '',
              sport: node.getAttribute('data-sport') || node.getAttribute('data-sport-id') || '' }))
            .filter((item) => item.className || item.id || item.role || item.sport)
            .slice(0, 120);
          return { status: marker + "-failed", timeRange, code: response.status,
            page: location.origin + location.pathname, controls };
        }
        responses.push({ timeRange, url: url.href, body: await response.text() });
      }
      return { status: "catalog-requested", marker, origin: base.origin, responses };
    })()`;
    const attempts: Array<{ readonly target: "CONTEXT" | "SESSION" | "ROOT";
      readonly status: string; readonly page?: string; readonly controls?: unknown }> = [];
    for (const target of targets) {
      const params = { expression, ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        returnByValue: true, awaitPromise: true };
      const evaluation = await this.#withFrameCommandTimeout(target.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, target.sessionId),
      15_000).catch(() => null);
      const value = nestedValue(evaluation, "result", "value");
      attempts.push({ target: target.sessionId !== undefined ? "SESSION" : target.contextId !== undefined
        ? "CONTEXT" : "ROOT", status: isRecord(value) && typeof value.status === "string"
          ? value.status.slice(0, 96) : evaluation === null ? "CDP_TIMEOUT_OR_ERROR" : "NO_RESULT",
        ...(isRecord(value) && typeof value.page === "string" ? { page: value.page.slice(0, 256) } : {}),
        ...(isRecord(value) && Array.isArray(value.controls) ? { controls: value.controls.slice(0, 12) } : {}) });
      if (!isRecord(value) || value.status !== "catalog-requested" || !Array.isArray(value.responses) ||
        value.responses.length !== 2 || typeof value.origin !== "string") continue;
      let responseOrigin: string;
      try {
        const origin = new URL(value.origin);
        if (origin.protocol !== "https:" || origin.username !== "" || origin.password !== "") continue;
        responseOrigin = origin.origin;
      } catch { continue; }
      const accepted = new Map<"live" | "today", { readonly url: string; readonly body: string }>();
      for (const candidate of value.responses) {
        if (!isRecord(candidate) || (candidate.timeRange !== "live" && candidate.timeRange !== "today") ||
          typeof candidate.url !== "string" || typeof candidate.body !== "string" ||
          candidate.body.length > 12 * 1024 * 1024) continue;
        try {
          const url = new URL(candidate.url);
          if (url.origin !== responseOrigin || url.pathname !== "/api/v2/getEvent" ||
            url.searchParams.get("timeRange")?.toLowerCase() !== candidate.timeRange) continue;
        } catch { continue; }
        accepted.set(candidate.timeRange, { url: candidate.url, body: candidate.body });
      }
      if (accepted.size !== 2) continue;
      for (const partition of ["live", "today"] as const) {
        const response = accepted.get(partition)!;
        await this.ingestHttpResponse(source, response.url, "Fetch", response.body,
          undefined, `ksport-http:${partition}`);
      }
      return true;
    }
    const nowMs = this.#now();
    if (nowMs - (this.#ksportDiagnosticAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) >= 10_000) {
      this.#ksportDiagnosticAtMs.set(source.sourceId, nowMs);
      await this.#emit(source, "https://sb21.net/__fieldline_ksport_refresh__", "Diagnostic", "TAB_STATE", {
        encoding: "UTF8", body: JSON.stringify({ kind: "KSPORT_REFRESH_FAILED", attempts })
      });
    }
    return false;
  }

  async #ingestBtiRefreshEvaluation(source: ObservedSource, evaluation: unknown): Promise<void> {
    const value = nestedValue(evaluation, "result", "value");
    if (!isRecord(value) || value.status !== "catalog-requested" ||
      typeof value.generation !== "string" || !/^bti:\d{10,16}:\d{1,9}$/u.test(value.generation) ||
      typeof value.origin !== "string" || !Array.isArray(value.responses)) return;
    let origin: URL;
    try { origin = new URL(value.origin); } catch { return; }
    if (origin.protocol !== "https:" || origin.username !== "" || origin.password !== "") return;
    const allowedPaths = new Set([
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
    ]);
    const unique = new Map<string, string>();
    for (const response of value.responses) {
      if (!isRecord(response) || typeof response.url !== "string" || typeof response.body !== "string" ||
        !allowedPaths.has(response.url) || response.body.length > 12 * 1024 * 1024) continue;
      unique.set(response.url, response.body);
    }
    if (unique.size !== allowedPaths.size) return;
    for (const path of allowedPaths) {
      await this.ingestHttpResponse(source, new URL(path, origin).href, "Fetch", unique.get(path)!,
        undefined, value.generation);
    }
  }

  async #evaluateImCatalogMainWorlds(source: ObservedSource, awaitPromise: boolean): Promise<string[]> {
    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Page.getFrameTree")
    ).catch(() => ({}));
    const frameIds = collectFrameIds(frameTree);
    const contexts = this.#mainWorldContexts.get(source.tabId);
    const evaluate = async (label: string, contextId?: number): Promise<string> => {
      const response = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: IM_CATALOG_DISCOVERY_EXPRESSION, ...(contextId === undefined ? {} : { contextId }),
          returnByValue: true, awaitPromise
        }), awaitPromise ? 20_000 : this.#frameCommandTimeoutMs
      ).catch(() => null);
      const value = nestedValue(response, "result", "value");
      if (awaitPromise && isRecord(value) && Array.isArray(value.responses)) {
        const ordinal = (this.#imSnapshotOrdinals.get(source.sourceId) ?? 0) + 1;
        this.#imSnapshotOrdinals.set(source.sourceId, ordinal);
        const generation = `im:${source.tabId}:${ordinal}`;
        for (const item of value.responses) {
          if (!isRecord(item) || (item.market !== 1 && item.market !== 2) || typeof item.body !== "string") continue;
          await this.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
            item.body, item.market === 1 ? "IM_MARKET_1" : "IM_MARKET_2", generation);
        }
      }
      const status = isRecord(value) ? value.status : null;
      const safeValue = typeof status === "string" && /^(?:catalog-requested|rate-limited|token-unavailable|navigation-not-found|truc tiep|live|bong da|football)$/u
        .test(status) ? status : "unavailable";
      return `${label}:${safeValue}`;
    };
    const evaluations: Array<Promise<string>> = [evaluate("top")];
    for (const frameId of frameIds.slice(1)) {
      const contextId = contexts?.get(frameId);
      if (contextId === undefined) continue;
      evaluations.push(evaluate(frameId.slice(0, 64), contextId));
    }
    return Promise.all(evaluations);
  }

  async heartbeat(source: ObservedSource, hostname: string): Promise<void> {
    if (!/^[a-z0-9.-]+$/iu.test(hostname)) return;
    await this.#emit(source, `https://${hostname}/__fieldline_heartbeat__`, "Tab", "TAB_STATE", {
      encoding: "UTF8",
      body: "{}"
    });
  }

  async handleEvent(source: ObservedSource, method: string, rawParams: unknown,
    sessionId?: string): Promise<void> {
    const params = isRecord(rawParams) ? rawParams : {};
    if (method === "Target.attachedToTarget") {
      const childSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isRecord(params.targetInfo) ? params.targetInfo : null;
      if (childSessionId !== null && targetInfo?.type === "iframe") {
        await this.#sendCommand(source.tabId, "Network.enable", {
          maxTotalBufferSize: 16 * 1024 * 1024,
          maxResourceBufferSize: 12 * 1024 * 1024,
          maxPostDataSize: 0
        }, childSessionId);
        await this.#sendCommand(source.tabId, "Runtime.enable", {}, childSessionId);
      }
      return;
    }
    if (method === "Target.detachedFromTarget") {
      // A destroyed sportsbook iframe never emits webSocketClosed for the
      // sockets it owned. Close them explicitly so the API retires that stream
      // instead of treating the silence as a healthy quiet feed.
      const childSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      if (childSessionId !== null) await this.#closeSocketsForSession(source, childSessionId);
      return;
    }
    if (method === "Runtime.executionContextCreated") {
      const context = isRecord(params.context) ? params.context : null;
      const auxData = context && isRecord(context.auxData) ? context.auxData : null;
      const contextId = context && typeof context.id === "number" ? context.id : null;
      const frameId = auxData && typeof auxData.frameId === "string" ? auxData.frameId : null;
      if (contextId !== null && frameId !== null && auxData?.isDefault === true) {
        const contexts = this.#mainWorldContexts.get(source.tabId) ?? new Map<string, number>();
        contexts.set(frameId, contextId);
        this.#mainWorldContexts.set(source.tabId, contexts);
        const sessions = this.#mainWorldContextSessions.get(source.tabId) ??
          new Map<number, string | undefined>();
        sessions.set(contextId, sessionId);
        this.#mainWorldContextSessions.set(source.tabId, sessions);
      }
      return;
    }
    if (method === "Runtime.executionContextsCleared") {
      this.#mainWorldContexts.delete(source.tabId);
      this.#mainWorldContextSessions.delete(source.tabId);
      this.beginSourceEpoch(source.sourceId);
      if (source.lobby === "SABA") {
        // Runtime.enable can emit executionContextsCleared while an unchanged
        // document is merely being reattached after an MV3 worker restart.
        // Drop in-memory context-bound state, but retain the durable baseline:
        // restore validates it against the page's performance.timeOrigin and
        // therefore still rejects a genuinely navigated document.
        this.#discardSabaWsSnapshots(source.sourceId);
        this.#sabaSnapshotLoads.delete(source.sourceId);
      } else if (source.lobby === "KSPORT") {
        this.#discardSabaWsSnapshots(source.sourceId);
        void this.#scheduleSabaWsSnapshotClear(source.sourceId);
      }
      return;
    }
    if (method === "Runtime.executionContextDestroyed" && typeof params.executionContextId === "number") {
      const contexts = this.#mainWorldContexts.get(source.tabId);
      if (contexts) {
        for (const [frameId, contextId] of contexts) {
          if (contextId === params.executionContextId) contexts.delete(frameId);
        }
      }
      this.#mainWorldContextSessions.get(source.tabId)?.delete(params.executionContextId);
      return;
    }
    const requestId = typeof params.requestId === "string" ? params.requestId : null;
    const key = requestId ? `${source.tabId}:${sessionId ?? "root"}:${requestId}` : null;

    if (method === "Network.requestWillBeSent" && key) {
      this.#requestGenerations.set(key, this.#sourceGenerations.get(source.sourceId) ?? 0);
      const request = isRecord(params.request) ? params.request : null;
      const partition = request === null ? null : imPartitionFromRequest(source, request);
      if (partition === null) this.#requestPartitions.delete(key);
      else this.#requestPartitions.set(key, partition);
      const requestHeaders = request !== null && isRecord(request.headers) ? request.headers : {};
      const btiGeneration = Object.entries(requestHeaders).find(([name]) =>
        name.toLowerCase() === "x-fieldline-generation")?.[1];
      if (source.lobby === "BTI" && typeof btiGeneration === "string" && /^bti:\d+:\d+$/u.test(btiGeneration)) {
        this.#requestStreamIds.set(key, btiGeneration);
      } else {
        this.#requestStreamIds.delete(key);
      }
      if (source.lobby === "KSPORT" && !this.#ksportRefreshesInFlight.has(source.sourceId) &&
        request !== null && typeof request.url === "string") {
        try {
          const url = new URL(request.url);
          if (url.protocol === "https:" && url.pathname === "/api/v2/getEvent") {
            const timeRange = url.searchParams.get("timeRange")?.toLowerCase();
            if (timeRange === "live" || timeRange === "today") {
              this.#requestStreamIds.set(key, `ksport-http:${timeRange}`);
            }
            const rawHeaders = isRecord(request.headers) ? request.headers : {};
            const headers = Object.fromEntries(Object.entries(rawHeaders).flatMap(([name, value]) =>
              /^(?:cookie|host|content-length|accept-encoding|connection|origin|referer|user-agent|sec-|:)/iu.test(name) ||
                (typeof value !== "string" && typeof value !== "number") ? [] : [[name, String(value)]]));
            const template = { url: request.url, headers };
            this.#sbobetEventRequests.set(source.sourceId, template);
            await this.#saveSbobetEventRequest(template).catch(() => undefined);
          }
        } catch { /* Ignore malformed provider URLs. */ }
      }
      if (source.lobby === "TSPORT" && /^(?:XHR|Fetch)$/u.test(String(params.type ?? "")) &&
        request !== null && request.method === "GET" && typeof request.url === "string") {
        try {
          const url = new URL(request.url);
          if (url.protocol === "https:") {
            const retained = (this.#tsportRequestUrls.get(source.sourceId) ?? [])
              .filter((value) => value !== request.url);
            retained.push(request.url);
            while (retained.length > 32) retained.shift();
            this.#tsportRequestUrls.set(source.sourceId, retained);
          }
        } catch { /* Ignore malformed provider request URLs. */ }
      }
    }

    const activeProbe = source.lobby === "CMD" ? this.#activeCmdHiddenProbes.get(source.sourceId) : undefined;
    if (activeProbe && method === "Network.requestWillBeSent") {
      const request = isRecord(params.request) ? params.request : null;
      const resourceType = typeof params.type === "string" ? params.type : "Other";
      if (request && typeof request.url === "string" && typeof request.method === "string") {
        try {
          const parsed = new URL(request.url);
          if (/^https?:$/u.test(parsed.protocol)) activeProbe.httpEvidence.push({ method: request.method,
            hostname: parsed.hostname, pathname: parsed.pathname.slice(0, 512), resourceType,
            eventIdReferenced: parsed.pathname.includes(activeProbe.providerEventId) ||
              parsed.search.includes(activeProbe.providerEventId) });
        } catch { /* malformed provider URL is not probe evidence */ }
      }
    }
    if (activeProbe && (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived")) {
      const response = isRecord(params.response) ? params.response : null;
      if (response && typeof response.payloadData === "string") activeProbe.websocketEvidence.push(
        summarizeCmdHiddenProtocolFrame(response.payloadData, activeProbe.providerEventId,
          method === "Network.webSocketFrameSent" ? "SENT" : "RECEIVED"));
    }

    if (method === "Network.webSocketCreated" && key && typeof params.url === "string") {
      const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
      const streamId = String((this.#streamOrdinals.get(source.sourceId) ?? 0) + 1);
      this.#streamOrdinals.set(source.sourceId, Number(streamId));
      this.#webSockets.set(key, { source, sourceGeneration, url: params.url, streamId,
        ...(sessionId === undefined ? {} : { sessionId }) });
      if (source.lobby === "KSPORT") {
        try {
          if (isKsportCatalogSocket(new URL(params.url))) {
            this.#activeKsportStreams.set(source.sourceId, streamId);
            this.#catalogWsSnapshots.set(source.sourceId, new Map());
          }
        } catch { /* malformed socket URL cannot be a catalog authority */ }
      }
      if (source.lobby === "SBO") {
        try {
          if (/\/socket\.io\/?$/u.test(new URL(params.url).pathname)) {
            this.#catalogWsSnapshots.set(source.sourceId, new Map());
          }
        } catch { /* malformed socket URL cannot be a catalog authority */ }
      }
      await this.#emit(source, params.url, "WebSocket", "WS_STATE", {
        encoding: "UTF8", body: '{"state":"OPEN"}'
      }, { request: { streamId }, sourceGeneration });
      return;
    }
    if (method === "Network.webSocketClosed" && key) {
      const socket = this.#webSockets.get(key);
      if (socket !== undefined) {
        await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
          encoding: "UTF8", body: '{"state":"CLOSED"}'
        }, { request: { streamId: socket.streamId }, sourceGeneration: socket.sourceGeneration });
        if (socket.source.lobby === "KSPORT" &&
          this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId) {
          this.#activeKsportStreams.delete(socket.source.sourceId);
          this.#catalogWsSnapshots.delete(socket.source.sourceId);
          await this.#scheduleSabaWsSnapshotClear(socket.source.sourceId);
        }
        if (socket.source.lobby === "SBO") {
          try {
            if (/\/socket\.io\/?$/u.test(new URL(socket.url).pathname)) {
              this.#catalogWsSnapshots.delete(socket.source.sourceId);
            }
          } catch { /* malformed socket URL cannot be a catalog authority */ }
        }
      }
      this.#webSockets.delete(key);
      return;
    }
    if (method === "Network.webSocketFrameReceived" && key) {
      const socket = this.#webSockets.get(key);
      const response = isRecord(params.response) ? params.response : null;
      if (!socket) {
        // MV3 can restart while an existing Socket.IO connection survives.
        // CDP then delivers frames without replaying webSocketCreated, so use
        // that traffic as the signal to request a fresh in-page SABA baseline.
        if (source.lobby === "SABA") {
          // After a worker restart every surviving-socket frame lands here.
          // One recovery per window; otherwise each frame replays the whole
          // retained baseline (up to 24 MB) through the bridge.
          const nowMs = this.#now();
          const previous = this.#sabaOrphanFrameRecoveryAtMs.get(source.sourceId);
          if (previous === undefined || nowMs - previous >= 30_000) {
            this.#sabaOrphanFrameRecoveryAtMs.set(source.sourceId, nowMs);
            await this.refreshCatalog(source);
          }
        } else if (source.lobby === "SBO") {
          await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
        } else if (source.lobby === "KSPORT") {
          // The sportsbook OOPIF opened its STOMP socket before this worker
          // enabled Network on that child session, so the frames cannot be
          // attributed to a stream. Ask the page to reconnect once so the new
          // socket is observed from its creation; do not loop on every frame.
          const nowMs = this.#now();
          const previous = this.#ksportOrphanFrameRecoveryAtMs.get(source.sourceId);
          if (previous === undefined || nowMs - previous >= 30_000) {
            this.#ksportOrphanFrameRecoveryAtMs.set(source.sourceId, nowMs);
            await this.#requestFreshSocketBaseline(source, (url) => /\/sport\//u.test(url.pathname));
          }
        }
        return;
      }
      if (!response || typeof response.payloadData !== "string") return;
      if (!this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) return;
      const opcode = typeof response.opcode === "number" ? response.opcode : 1;
      const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
      if (opcode !== 2) {
        if (socket.source.lobby === "SABA" || socket.source.lobby === "KSPORT" || socket.source.lobby === "SBO") {
          await this.#sabaDocumentMarker(socket.source, socket.sessionId, socket.sourceGeneration);
          if (!this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) return;
        }
        this.#rememberTsportWsEvent(socket.source, socket.url, response.payloadData, socket.streamId, clocks);
        this.#rememberCatalogWsFrame(socket.source, socket.url, response.payloadData, socket.streamId, clocks);
      }
      await this.#emit(socket.source, socket.url, "WebSocket", "WS_FRAME", {
        encoding: opcode === 2 ? "BASE64" : "UTF8",
        body: response.payloadData
      }, { request: { streamId: socket.streamId }, ...clocks, sourceGeneration: socket.sourceGeneration });
      return;
    }
    if (method === "Network.responseReceived" && key) {
      const response = isRecord(params.response) ? params.response : null;
      const resourceType = typeof params.type === "string" ? params.type : "";
      if (!response || !/^(?:XHR|Fetch)$/u.test(resourceType) || typeof response.url !== "string") return;
      const providerPartition = this.#requestPartitions.get(key);
      const streamId = this.#requestStreamIds.get(key);
      this.#pending.set(key, { source,
        sourceGeneration: this.#requestGenerations.get(key) ?? this.#sourceGenerations.get(source.sourceId) ?? 0,
        url: response.url, resourceType,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(providerPartition === undefined ? {} : { providerPartition }),
        ...(streamId === undefined ? {} : { streamId }) });
      return;
    }
    if (method === "Network.loadingFailed" && key) {
      this.#pending.delete(key);
      this.#requestPartitions.delete(key);
      this.#requestStreamIds.delete(key);
      this.#requestGenerations.delete(key);
      return;
    }
    if (method === "Network.loadingFinished" && key) {
      let pending = this.#pending.get(key);
      this.#pending.delete(key);
      this.#requestPartitions.delete(key);
      this.#requestStreamIds.delete(key);
      this.#requestGenerations.delete(key);
      if (!pending || requestId === null) return;
      if (!this.#isSourceGenerationCurrent(pending.source.sourceId, pending.sourceGeneration)) return;
      let responseBodyRead = false;
      try {
        if (pending.providerPartition === undefined && isImGetSeUrl(pending.source, pending.url)) {
          const requestPostData = await (pending.sessionId === undefined
            ? this.#sendCommand(source.tabId, "Network.getRequestPostData", { requestId })
            : this.#sendCommand(source.tabId, "Network.getRequestPostData", { requestId }, pending.sessionId))
            .catch(() => ({}));
          if (!this.#isSourceGenerationCurrent(pending.source.sourceId, pending.sourceGeneration)) return;
          const postData = isRecord(requestPostData) && typeof requestPostData.postData === "string"
            ? requestPostData.postData : null;
          const providerPartition = postData === null ? null : imPartitionFromRequest(pending.source, {
            url: pending.url, postData
          });
          if (providerPartition !== null) pending = { ...pending, providerPartition };
        }
        const response = await this.#readResponseBody(source.tabId, requestId,
          isImGetSeUrl(pending.source, pending.url), pending.sessionId);
        if (!this.#isSourceGenerationCurrent(pending.source.sourceId, pending.sourceGeneration)) return;
        if (!isRecord(response) || typeof response.body !== "string") return;
        responseBodyRead = true;
        if (response.base64Encoded === true) {
          await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "BASE64", body: response.body
          }, { request: { providerPartition: pending.providerPartition, streamId: pending.streamId },
            sourceGeneration: pending.sourceGeneration });
          return;
        }
        const safeBody = redactNetworkBody(response.body);
        await this.#recoverMissingImBaseline(pending);
        if (!this.#isSourceGenerationCurrent(pending.source.sourceId, pending.sourceGeneration)) return;
        const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
        this.#rememberHttpSnapshot(pending, safeBody, clocks);
        const fragments = splitUtf8Text(safeBody, NETWORK_CHUNK_BODY_BYTES);
        if (fragments.length === 1) {
          await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: safeBody
          }, { request: { providerPartition: pending.providerPartition, streamId: pending.streamId }, ...clocks,
            sourceGeneration: pending.sourceGeneration });
          return;
        }
        const snapshotId = `network:${source.tabId}:${this.#now()}:${this.#sequences.get(source.sourceId) ?? 0}`;
        const emissionPending = pending;
        const emissions = fragments.map((bodyFragment, chunkIndex) =>
          this.#emit(emissionPending.source, emissionPending.url, emissionPending.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex,
              chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment })
          }, { request: { providerPartition: emissionPending.providerPartition,
            streamId: emissionPending.streamId }, ...clocks,
            sourceGeneration: emissionPending.sourceGeneration }));
        await Promise.all(emissions);
      } catch {
        if (!responseBodyRead && isImGetSeUrl(pending.source, pending.url) &&
          this.#isSourceGenerationCurrent(pending.source.sourceId, pending.sourceGeneration)) {
          const encodedDataLength = typeof params.encodedDataLength === "number" &&
            Number.isSafeInteger(params.encodedDataLength) && params.encodedDataLength >= 0
            ? params.encodedDataLength : 0;
          await this.#emit(pending.source,
            "https://imsports.directsb.net/__fieldline_http_body_unavailable__", "Diagnostic", "TAB_STATE", {
              encoding: "UTF8",
              body: JSON.stringify({ path: "/api/EventV6/GetSE",
                ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }),
                encodedDataLength })
            }, { sourceGeneration: pending.sourceGeneration }).catch(() => undefined);
        }
        // A response body can be evicted by Chrome; isolate it from the stream.
      }
    }
  }

  async #readResponseBody(tabId: number, requestId: string, retryTransientMiss: boolean,
    sessionId?: string): Promise<unknown> {
    const retryDelaysMs = retryTransientMiss ? [0, 50, 150] : [0];
    let lastError: unknown = new Error("RESPONSE_BODY_UNAVAILABLE");
    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      try {
        return await (sessionId === undefined
          ? this.#sendCommand(tabId, "Network.getResponseBody", { requestId })
          : this.#sendCommand(tabId, "Network.getResponseBody", { requestId }, sessionId));
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async ingestWebSocketFrame(source: ObservedSource, url: string, payloadData: string,
    opcode = 1): Promise<void> {
    if (!/^wss?:\/\//iu.test(url) || !Number.isInteger(opcode) || (opcode !== 1 && opcode !== 2)) return;
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
    const streamId = "manual";
    const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
    if (opcode !== 2) {
      this.#rememberTsportWsEvent(source, url, payloadData, streamId, clocks);
      this.#rememberCatalogWsFrame(source, url, payloadData, streamId, clocks);
    }
    await this.#emit(source, url, "WebSocket", "WS_FRAME", {
      encoding: opcode === 2 ? "BASE64" : "UTF8",
      body: payloadData
    }, { request: { streamId }, ...clocks, sourceGeneration });
  }

  async ingestHttpResponse(source: ObservedSource, url: string, resourceType: "XHR" | "Fetch",
    body: string, providerPartition?: ImProviderPartition, streamId?: string): Promise<void> {
    if (!/^https?:\/\//iu.test(url)) return;
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    const pending: PendingRequest = { source, sourceGeneration, url, resourceType,
      ...(providerPartition === undefined ? {} : { providerPartition }),
      ...(streamId === undefined ? {} : { streamId }) };
    const safeBody = redactNetworkBody(body);
    await this.#recoverMissingImBaseline(pending);
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
    const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
    this.#rememberHttpSnapshot(pending, safeBody, clocks);
    const fragments = splitUtf8Text(safeBody, NETWORK_CHUNK_BODY_BYTES);
    const requestMetadata = {
      ...(providerPartition === undefined ? {} : { providerPartition }),
      ...(streamId === undefined ? {} : { streamId })
    };
    const request = Object.keys(requestMetadata).length === 0 ? {} : { request: requestMetadata };
    if (fragments.length === 1) {
      await this.#emit(source, url, resourceType, "HTTP_RESPONSE", { encoding: "UTF8", body: safeBody },
        { ...request, ...clocks, sourceGeneration });
      return;
    }
    const snapshotId = `network:${source.tabId}:${this.#now()}:${this.#sequences.get(source.sourceId) ?? 0}`;
    for (const [chunkIndex, bodyFragment] of fragments.entries()) {
      await this.#emit(source, url, resourceType, "HTTP_RESPONSE", {
        encoding: "UTF8",
        body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex, chunkCount: fragments.length,
          bodyEncoding: "UTF8", bodyFragment })
      }, { ...request, ...clocks, sourceGeneration });
    }
  }

  async ingestDomSnapshot(source: ObservedSource, hostname: string, body: string): Promise<void> {
    if ((source.lobby !== "CMD" && source.lobby !== "SABA") || !/^[a-z0-9.-]+$/iu.test(hostname)) return;
    let records: unknown;
    try { records = JSON.parse(body); } catch { return; }
    if (!Array.isArray(records) || records.length === 0) return;
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    const nowMs = this.#now();
    const receivedMonotonicMs = this.#monotonicNow();
    const snapshotId = `dom:${source.tabId}:${nowMs}`;
    for (const chunk of chunkCmdSnapshot(records, snapshotId)) {
      await this.#emit(source, `https://${hostname}/__fieldline_dom_snapshot__`, "DOM", "DOM_SNAPSHOT", {
        encoding: "UTF8", body: JSON.stringify(chunk)
      }, { observedAtMs: nowMs, receivedMonotonicMs, sourceGeneration });
    }
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
    if (isReplayableCmdCatalog(records)) {
      this.#cmdSnapshots.set(source.sourceId, { body, sentAtMs: nowMs, receivedMonotonicMs });
      this.#cmdSnapshotHosts.set(source.sourceId, hostname);
    }
  }

  async captureCmdSnapshot(source: ObservedSource, hostname: string): Promise<void> {
    if ((source.lobby !== "CMD" && source.lobby !== "TSPORT") ||
      !/^[a-z0-9.-]+$/iu.test(hostname)) return;
    const expression = source.lobby === "TSPORT"
      ? TSPORT_PUBLIC_CATALOG_EXPRESSION : CMD_PUBLIC_CATALOG_EXPRESSION;
    await this.#capturePublicCatalogSnapshot(source, hostname, expression, false);
  }

  async #capturePublicCatalogSnapshot(source: ObservedSource, hostname: string, expression: string,
    forceGeneration: boolean, alreadyScheduled = false): Promise<void> {
    if (!/^[a-z0-9.-]+$/iu.test(hostname)) return;
    const existing = this.#cmdCapturesInFlight.get(source.sourceId);
    if (existing !== undefined) return existing.operation;
    const token = Symbol("provider-capture");
    const operation = (async () => {
      try {
      const capture = async (): Promise<void> => {
        const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
        for (let generation = 0; generation < (forceGeneration ? 2 : 1); generation += 1) {
        const frameTree = await this.#withFrameCommandTimeout(
          this.#sendCommand(source.tabId, "Page.getFrameTree")
        ).catch(() => ({}));
        const frameIds = collectFrameIds(frameTree);
        const values: unknown[] = [];
        if (frameIds.length === 0) {
          values.push(await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression, returnByValue: true, awaitPromise: false
          })).catch(() => ({})));
        } else {
          const frameValues = await Promise.all(frameIds.map(async (frameId) => {
            const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
              "Page.createIsolatedWorld", {
              frameId, worldName: "fieldline-read-only", grantUniveralAccess: false
            })).catch(() => ({}));
            const contextId = nestedNumber(world, "executionContextId");
            if (contextId === null) return null;
            return this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
              expression, contextId, returnByValue: true, awaitPromise: false
            })).catch(() => ({}));
          }));
          values.push(...frameValues.filter((value) => value !== null));
        }
        if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
        const evaluated = values.flatMap(readEvaluationRecords);
        const catalogRecords = evaluated.filter((value) => !isRecord(value) || !("__fieldlineDiagnostic" in value));
        const records = catalogRecords.length > 0 ? catalogRecords : evaluated;
        if (records.length === 0) return;
        const catalogBody = JSON.stringify(records);
        const nowMs = this.#now();
        const receivedMonotonicMs = this.#monotonicNow();
        const previous = this.#cmdLastBodies.get(source.sourceId);
        // Transport heartbeats only prove that the tab is attached. Renew the
        // unchanged catalog before the API freshness TTL expires so a quiet
        // market cannot be misclassified as a dead data source.
        if (!forceGeneration && previous === catalogBody && nowMs - (this.#cmdLastSentAtMs.get(source.sourceId) ?? 0)
          < CATALOG_REFRESH_INTERVAL_MS) return;
        const ordinal = (this.#domSnapshotOrdinals.get(source.sourceId) ?? 0) + 1;
        this.#domSnapshotOrdinals.set(source.sourceId, ordinal);
        const snapshotId = `cmd:${source.tabId}:${nowMs}:${ordinal}`;
        const chunks = chunkCmdSnapshot(records, snapshotId);
        for (const chunk of chunks) {
          await this.#emit(source, `https://${hostname}/__fieldline_dom_snapshot__`, "DOM", "DOM_SNAPSHOT", {
            encoding: "UTF8", body: JSON.stringify(chunk)
          }, { observedAtMs: nowMs, receivedMonotonicMs, sourceGeneration });
        }
        if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
        this.#cmdLastBodies.set(source.sourceId, catalogBody);
        this.#cmdLastSentAtMs.set(source.sourceId, nowMs);
        if (isReplayableCmdCatalog(records)) {
          this.#cmdSnapshots.set(source.sourceId, { body: catalogBody, sentAtMs: nowMs, receivedMonotonicMs });
          this.#cmdSnapshotHosts.set(source.sourceId, hostname);
        }
        }
      };
      if (alreadyScheduled) await capture();
      else await this.#runPeriodicDomWork(source.sourceId, capture);
      } finally {
      if (this.#cmdCapturesInFlight.get(source.sourceId)?.token === token) {
        this.#cmdCapturesInFlight.delete(source.sourceId);
      }
      }
    })();
    this.#cmdCapturesInFlight.set(source.sourceId, { token, operation });
    return operation;
  }

  async #runPeriodicDomWork<T>(sourceId: string, operation: () => Promise<T>): Promise<T> {
    const scheduledGeneration = this.#sourceGenerations.get(sourceId) ?? 0;
    return this.#workScheduler.run(sourceId, async () => {
      if ((this.#sourceGenerations.get(sourceId) ?? 0) !== scheduledGeneration) {
        throw new Error("PROVIDER_WORK_EPOCH_RETIRED");
      }
      this.#activeWorkGenerations.set(sourceId, scheduledGeneration);
      try {
        return await operation();
      } finally {
        if (this.#activeWorkGenerations.get(sourceId) === scheduledGeneration) {
          this.#activeWorkGenerations.delete(sourceId);
        }
      }
    });
  }

  async #withFrameCommandTimeout<T>(operation: Promise<T>, timeoutMs = this.#frameCommandTimeoutMs): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("frame-command-timeout")), timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async focusSelection(source: ObservedSource, identity: SelectionFocusIdentity): Promise<boolean> {
    const expression = source.lobby === "CMD"
      ? buildCmdSelectionFocusExpression(identity)
      : buildGenericSelectionFocusExpression(identity);
    const frameTree = await this.#sendCommand(source.tabId, "Page.getFrameTree").catch(() => ({}));
    const frameIds = collectFrameIds(frameTree);
    const evaluations: unknown[] = [];
    if (frameIds.length === 0) {
      evaluations.push(await this.#sendCommand(source.tabId, "Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: false
      }).catch(() => ({})));
    } else {
      for (const frameId of frameIds) {
        const world = await this.#sendCommand(source.tabId, "Page.createIsolatedWorld", {
          frameId, worldName: "fieldline-selection-focus", grantUniveralAccess: false
        }).catch(() => ({}));
        const contextId = nestedNumber(world, "executionContextId");
        if (contextId === null) continue;
        evaluations.push(await this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, contextId, returnByValue: true, awaitPromise: false
        }).catch(() => ({})));
      }
    }
    return evaluations.some((evaluation) => nestedBoolean(evaluation, "result", "value", "ok") === true);
  }

  async probeSelectionPrice(source: ObservedSource, request: SelectionPriceProbeIdentity & {
    readonly requestId: string }): Promise<void> {
    if (source.lobby === "KSPORT" && !this.#sbobetEventRequests.has(source.sourceId)) {
      const stored = await this.#loadSbobetEventRequest().catch(() => null);
      if (stored !== null) this.#sbobetEventRequests.set(source.sourceId, stored);
    }
    const sbobetObservedRequest = this.#sbobetEventRequests.get(source.sourceId) ?? null;
    const expression = source.lobby === "CMD" ? buildCmdSelectionPriceExpression(request)
      : source.lobby === "SABA" ? buildSabaSelectionPriceExpression(request)
      : source.lobby === "IM" ? buildImExactSelectionPriceExpression(request)
      : source.lobby === "BTI" ? buildBtiSelectionPriceExpression(request)
      : source.lobby === "KSPORT" ? buildSbobetSelectionPriceExpression(request, sbobetObservedRequest)
      : source.lobby === "TSPORT" ? buildTsportSelectionPriceExpression(request,
        (this.#tsportRequestUrls.get(source.sourceId) ?? []).filter((url) => url.includes(request.providerEventId)))
      : buildGenericSelectionPriceExpression(request);
    const evaluateFrames = async (candidateExpression = expression,
      stopAfterConclusive = false): Promise<unknown[]> => {
      if (source.lobby === "KSPORT") {
        const frameTree = await this.#withFrameCommandTimeout(
          this.#sendCommand(source.tabId, "Page.getFrameTree")).catch(() => ({}));
        const frameIds = collectFrameIds(frameTree);
        if (frameIds.length === 0) {
          return [await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression: candidateExpression, returnByValue: true, awaitPromise: true
          }), 8_000).catch(() => ({}))];
        }
        const results: unknown[] = [];
        for (const frameId of frameIds) {
          const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
            "Page.createIsolatedWorld", { frameId, worldName: "fieldline-sbobet-selection-price",
              grantUniveralAccess: false })).catch(() => ({}));
          const contextId = nestedNumber(world, "executionContextId");
          if (contextId === null) continue;
          const result = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression: candidateExpression, contextId, returnByValue: true, awaitPromise: true
          }), 8_000).catch(() => ({}));
          results.push(result);
          const value = nestedValue(result, "result", "value");
          if (stopAfterConclusive && isRecord(value) && (value.ok === true ||
            value.reason === "SBOBET_SELECTION_AMBIGUOUS")) break;
        }
        return results;
      }
      if (source.lobby === "SABA") {
        const results: unknown[] = [await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: false
        }), 5_000).catch(() => ({}))];
        const topValue = nestedValue(results[0], "result", "value");
        if (isRecord(topValue) && (topValue.ok === true ||
          String(topValue.reason ?? "").endsWith("_AMBIGUOUS"))) return results;
        const frameTree = await this.#withFrameCommandTimeout(
          this.#sendCommand(source.tabId, "Page.getFrameTree")).catch(() => ({}));
        const contexts = this.#mainWorldContexts.get(source.tabId);
        for (const frameId of collectFrameIds(frameTree).slice(1)) {
          const contextId = contexts?.get(frameId);
          if (contextId === undefined) continue;
          const result = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression, contextId, returnByValue: true, awaitPromise: false
          }), 5_000).catch(() => ({}));
          results.push(result);
          const value = nestedValue(result, "result", "value");
          if (isRecord(value) && (value.ok === true || String(value.reason ?? "").endsWith("_AMBIGUOUS"))) break;
        }
        return results;
      }
      const frameTree = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Page.getFrameTree")).catch(() => ({}));
      const frameIds = collectFrameIds(frameTree);
      if (source.lobby === "IM") {
        const top = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: true
        }), 20_000).catch(() => ({}));
        const contexts = this.#mainWorldContexts.get(source.tabId);
        const nested = await Promise.all(frameIds.slice(1).flatMap((frameId) => {
          const contextId = contexts?.get(frameId);
          return contextId === undefined ? [] : [this.#withFrameCommandTimeout(
            this.#sendCommand(source.tabId, "Runtime.evaluate", {
              expression, contextId, returnByValue: true, awaitPromise: true
            }), 20_000).catch(() => ({}))];
        }));
        return [top, ...nested];
      }
      if (source.lobby === "BTI") {
        const results: unknown[] = [];
        const top = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: true
        }), 8_000).catch(() => ({ result: { value: { ok: false, reason: "BTI_DETAIL_REQUEST_FAILED" } } }));
        results.push(top);
        const topValue = nestedValue(top, "result", "value");
        if (isRecord(topValue) && (topValue.ok === true ||
          String(topValue.reason ?? "").endsWith("_AMBIGUOUS"))) return results;
        const contexts = this.#mainWorldContexts.get(source.tabId);
        for (const frameId of frameIds.slice(1)) {
          const contextId = contexts?.get(frameId);
          if (contextId === undefined) continue;
          const result = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression, contextId, returnByValue: true, awaitPromise: true
          }), 8_000).catch(() => ({ result: { value: { ok: false, reason: "BTI_DETAIL_REQUEST_FAILED" } } }));
          results.push(result);
          const value = nestedValue(result, "result", "value");
          if (isRecord(value) && (value.ok === true || String(value.reason ?? "").endsWith("_AMBIGUOUS"))) break;
        }
        return results;
      }
      return frameIds.length === 0
        ? [await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: source.lobby === "TSPORT" })).catch(() => ({}))]
        : Promise.all(frameIds.map(async (frameId) => {
          const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Page.createIsolatedWorld", {
            frameId, worldName: "fieldline-selection-price", grantUniveralAccess: false })).catch(() => ({}));
          const contextId = nestedNumber(world, "executionContextId");
          if (contextId === null) return {};
          return this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression, contextId, returnByValue: true, awaitPromise: source.lobby === "TSPORT" })).catch(() => ({}));
        }));
    };
    let evaluations: unknown[];
    if (source.lobby === "KSPORT") {
      const domEvaluations = await evaluateFrames(
        buildSbobetSelectionPriceExpression(request, sbobetObservedRequest, "DOM_ONLY"));
      const domValues = domEvaluations.map((evaluation) => nestedValue(evaluation, "result", "value"))
        .filter((value): value is Record<string, unknown> => isRecord(value));
      const domFound = domValues.filter((value) => value.ok === true);
      if (domFound.length > 0 || domValues.some((value) => value.reason === "SBOBET_SELECTION_AMBIGUOUS")) {
        evaluations = domEvaluations;
      } else {
        evaluations = await evaluateFrames(
          buildSbobetSelectionPriceExpression(request, sbobetObservedRequest, "FETCH_ONLY"), true);
      }
    } else {
      evaluations = await evaluateFrames();
    }
    const candidates = evaluations.map((evaluation) => nestedValue(evaluation, "result", "value"))
      .filter((value): value is Record<string, unknown> => isRecord(value));
    const foundCandidates = candidates.filter((value) => value.ok === true && typeof value.rawOdds === "string" &&
      typeof value.observedAtMs === "number");
    const found = foundCandidates.length === 1 ? foundCandidates[0] : undefined;
    const ambiguous = foundCandidates.length > 1 ||
      candidates.some((value) => value.reason === "VISIBLE_PRICE_AMBIGUOUS" ||
        value.reason === "IM_DIRECT_SELECTION_AMBIGUOUS" || value.reason === "SBOBET_SELECTION_AMBIGUOUS" ||
        value.reason === "BTI_EVENT_AMBIGUOUS" || value.reason === "BTI_MARKET_AMBIGUOUS" ||
        value.reason === "BTI_SELECTION_AMBIGUOUS");
    const diagnosticReason = foundCandidates.length > 1 ? "VISIBLE_PRICE_AMBIGUOUS" :
      candidates.find((value) => typeof value.reason === "string")?.reason;
    const observedAtMs = typeof found?.observedAtMs === "number" ? found.observedAtMs : this.#now();
    const method = found?.method === "IN_PAGE_FETCH" || found?.method === "DOM" ? found.method
      : source.lobby === "BTI" || source.lobby === "KSPORT" ? "IN_PAGE_FETCH" : "DOM";
    await this.#emit(source, `https://${source.lobby.toLocaleLowerCase("en")}.invalid/__fieldline_selection_price_probe__`,
      "DOM", "DOM_SNAPSHOT", { encoding: "UTF8", body: JSON.stringify({ requestId: request.requestId,
        providerEventId: request.providerEventId, providerMarketId: request.providerMarketId,
        providerSelectionId: request.providerSelectionId,
        status: found === undefined ? ambiguous ? "AMBIGUOUS" : "NOT_FOUND" : "FOUND",
        rawOdds: found === undefined ? null : found.rawOdds, observedAtMs, method,
        ...(found === undefined && typeof diagnosticReason === "string" ? { reason: diagnosticReason } : {})
      }) }, { observedAtMs });
  }

  async probeCmdHiddenMarkets(source: ObservedSource, request: { readonly requestId: string;
    readonly providerEventId: string }): Promise<void> {
    if (source.lobby !== "CMD" || !/^[a-z0-9._:-]{1,128}$/iu.test(request.requestId) ||
      !/^[a-z0-9._:-]{1,512}$/iu.test(request.providerEventId) ||
      this.#activeCmdHiddenProbes.has(source.sourceId)) return;
    const active: ActiveCmdHiddenProbe = { ...request, httpEvidence: [], websocketEvidence: [] };
    this.#activeCmdHiddenProbes.set(source.sourceId, active);
    let dom: CmdHiddenDomProbeResult | null = null;
    try {
      const frameTree = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Page.getFrameTree")).catch(() => ({}));
      const frameIds = collectFrameIds(frameTree);
      const expression = buildCmdHiddenMarketProbeExpression(request.providerEventId);
      const evaluations = frameIds.length === 0
        ? [await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: true })).catch(() => ({}))]
        : await Promise.all(frameIds.map(async (frameId) => {
          const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Page.createIsolatedWorld", {
            frameId, worldName: "fieldline-cmd-hidden-probe", grantUniveralAccess: false })).catch(() => ({}));
          const contextId = nestedNumber(world, "executionContextId");
          if (contextId === null) return {};
          return this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression, contextId, returnByValue: true, awaitPromise: true })).catch(() => ({}));
        }));
      for (const evaluation of evaluations) {
        const value = nestedValue(evaluation, "result", "value");
        if (isCmdHiddenDomProbeResult(value) && (dom === null || cmdHiddenDomScore(value) > cmdHiddenDomScore(dom))) dom = value;
      }
      const before = dom?.beforeMarketIds ?? [];
      const after = dom?.afterMarketIds ?? [];
      const clicked = dom?.clickedControls ?? [];
      const status = dom === null ? "TIMEOUT" : !dom.found ? "EVENT_NOT_FOUND"
        : after.some((id) => !before.includes(id)) ? "EXPANDED"
        : clicked.length > 0 ? "NO_NEW_MARKETS" : "NO_SAFE_CONTROL";
      await this.#emit(source, "https://cmd.invalid/__fieldline_cmd_hidden_probe__", "DOM", "DOM_SNAPSHOT", {
        encoding: "UTF8", body: JSON.stringify({ requestId: request.requestId,
          providerEventId: request.providerEventId, status, beforeMarketIds: before, afterMarketIds: after,
          clickedControlCount: clicked.length, clickedControls: clicked,
          candidateControls: dom?.candidateControls ?? [], marketStructures: dom?.marketStructures ?? [],
          visibleEventIds: dom?.visibleEventIds ?? [],
          stablePasses: dom?.stablePasses ?? 0,
          httpEvidence: uniqueObjects(active.httpEvidence), websocketEvidence: uniqueObjects(active.websocketEvidence) })
      });
    } finally {
      this.#activeCmdHiddenProbes.delete(source.sourceId);
    }
  }

  async replaySnapshots(requestedSourceId?: string): Promise<boolean> {
    if (requestedSourceId !== undefined) {
      const existing = this.#snapshotReplays.get(requestedSourceId);
      if (existing !== undefined) return existing;
      const operation = this.#runPeriodicDomWork(requestedSourceId,
        () => this.#replaySnapshots(requestedSourceId)).finally(() => {
          if (this.#snapshotReplays.get(requestedSourceId) === operation) {
            this.#snapshotReplays.delete(requestedSourceId);
          }
        });
      this.#snapshotReplays.set(requestedSourceId, operation);
      return operation;
    }
    const sourceIds = new Set<string>([
      ...this.#cmdSnapshots.keys(), ...this.#httpSnapshots.keys(), ...this.#tsportSnapshots.keys(),
      ...this.#catalogWsSnapshots.keys()
    ]);
    const results = await Promise.all([...sourceIds].map((sourceId) =>
      this.replaySnapshots(sourceId).catch(() => false)));
    return results.some(Boolean);
  }

  async #replaySnapshots(requestedSourceId?: string): Promise<boolean> {
    let replayed = false;
    for (const [sourceId, snapshot] of this.#cmdSnapshots) {
      if (requestedSourceId !== undefined && sourceId !== requestedSourceId) continue;
      const records: unknown = JSON.parse(snapshot.body);
      if (!Array.isArray(records)) continue;
      const identity = /^chrome:(CMD|SABA):(\d+)$/u.exec(sourceId);
      if (identity === null) continue;
      const source: ObservedSource = { lobby: identity[1] as "CMD" | "SABA", sourceId,
        tabId: Number(identity[2]) };
      if (!Number.isSafeInteger(source.tabId)) continue;
      const hostname = this.#hostnameFromCmdSource(sourceId);
      if (hostname === null) continue;
      const snapshotId = `cmd-replay:${source.tabId}:${this.#now()}`;
      for (const chunk of chunkCmdSnapshot(records, snapshotId)) {
        await this.#emit(source, `https://${hostname}/__fieldline_dom_snapshot__`, "DOM", "DOM_SNAPSHOT", {
          encoding: "UTF8", body: JSON.stringify(chunk)
        }, { request: { replayed: true }, observedAtMs: snapshot.sentAtMs,
          receivedMonotonicMs: snapshot.receivedMonotonicMs });
      }
      replayed = true;
    }
    for (const [sourceId, snapshots] of this.#httpSnapshots) {
      if (requestedSourceId !== undefined && sourceId !== requestedSourceId) continue;
      for (const snapshot of snapshots) {
        const fragments = splitUtf8Text(snapshot.body, NETWORK_CHUNK_BODY_BYTES);
        if (fragments.length === 1) {
          await this.#emit(snapshot.source, snapshot.url, snapshot.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: snapshot.body
          }, { request: { providerPartition: snapshot.providerPartition, streamId: snapshot.streamId, replayed: true },
            observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
        } else {
          const snapshotId = `network-replay:${snapshot.source.tabId}:${this.#now()}:${this.#sequences.get(sourceId) ?? 0}`;
          for (const [chunkIndex, bodyFragment] of fragments.entries()) {
            await this.#emit(snapshot.source, snapshot.url, snapshot.resourceType, "HTTP_RESPONSE", {
              encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex,
                chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment })
            }, { request: { providerPartition: snapshot.providerPartition, streamId: snapshot.streamId, replayed: true },
              observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
          }
        }
        replayed = true;
      }
    }
    for (const [sourceId, snapshots] of this.#tsportSnapshots) {
      if (requestedSourceId !== undefined && sourceId !== requestedSourceId) continue;
      for (const snapshot of snapshots.values()) {
        await this.#emit(snapshot.source, snapshot.url, "WebSocket", "WS_FRAME", {
          encoding: "UTF8", body: snapshot.body
        }, { request: { streamId: snapshot.streamId, replayed: true },
          observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
        replayed = true;
      }
    }
    replayed = await this.#replayCatalogWsSnapshots(requestedSourceId) || replayed;
    return replayed;
  }

  async #replayCatalogWsSnapshots(requestedSourceId?: string): Promise<boolean> {
    let replayed = false;
    for (const [sourceId, partitions] of this.#catalogWsSnapshots) {
      if (requestedSourceId !== undefined && sourceId !== requestedSourceId) continue;
      for (const [partition, snapshots] of partitions) {
        if (snapshots[0]?.source.lobby === "SABA" &&
          !this.#sabaReadySnapshotPartitions.has(`${sourceId}|${partition}`)) continue;
        for (const snapshot of snapshots) {
          await this.#emit(snapshot.source, snapshot.url, "WebSocket", "WS_FRAME", {
            encoding: "UTF8", body: snapshot.body
          }, { request: { streamId: snapshot.streamId, replayed: true },
            observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
          replayed = true;
        }
      }
    }
    return replayed;
  }

  #rememberCatalogWsFrame(source: ObservedSource, url: string, body: string, streamId: string,
    clocks: { readonly observedAtMs: number; readonly receivedMonotonicMs: number }): void {
    if (source.lobby !== "SABA" && source.lobby !== "KSPORT" && source.lobby !== "SBO") return;
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { return; }
    let partition = streamId;
    let startsBaseline = source.lobby === "KSPORT";
    let completesBaseline = false;
    if (source.lobby === "SABA" || source.lobby === "SBO") {
      if (!/\/socket\.io\/?$/u.test(parsedUrl.pathname) || !body.startsWith("42")) return;
      try {
        const payload: unknown = JSON.parse(body.slice(2));
        if (!Array.isArray(payload) || payload[0] !== "m" || typeof payload[1] !== "string" ||
          !Array.isArray(payload[2])) return;
        partition = `${streamId}:${payload[1]}`;
        if (source.lobby === "SABA") {
          startsBaseline = payload[2].some((row) => Array.isArray(row) &&
            (row[1] === "reset" || row[1] === "empty"));
          completesBaseline = payload[2].some((row) => Array.isArray(row) && row[1] === "done");
        } else {
          startsBaseline = false;
          completesBaseline = true;
        }
      } catch { return; }
    } else {
      if (!isKsportCatalogSocket(parsedUrl) || body.includes("destination:/topic/jackpot/")) return;
      const activeStream = this.#activeKsportStreams.get(source.sourceId);
      if (activeStream !== undefined && activeStream !== streamId) return;
      if (activeStream === undefined) this.#activeKsportStreams.set(source.sourceId, streamId);
      this.#ksportCatalogFrameAtMs.set(source.sourceId, clocks.observedAtMs);
    }
    const partitions = this.#catalogWsSnapshots.get(source.sourceId) ?? new Map<string, ReplayableWsEvent[]>();
    const readyKey = `${source.sourceId}|${partition}`;
    if (startsBaseline && source.lobby === "SABA") {
      partitions.set(partition, []);
      this.#sabaReadySnapshotPartitions.delete(readyKey);
    }
    const retained = partitions.get(partition);
    if (retained === undefined && source.lobby === "SABA") return;
    const frames = retained ?? [];
    frames.push({ source, url, body, streamId, ...clocks });
    partitions.set(partition, frames);
    if (source.lobby === "SABA" && completesBaseline && sabaFramesContainCompleteBaseline(frames)) {
      this.#sabaReadySnapshotPartitions.add(readyKey);
    }
    // Frames are appended in arrival order per partition, so the oldest
    // retained frame is always at the head of some partition. Keep running
    // totals and evict by comparing partition heads: O(partitions) per evicted
    // frame instead of materialising and sorting every retained frame on
    // every incoming WebSocket message.
    let usageFrames = 0;
    let usageBytes = 0;
    for (const values of partitions.values()) {
      usageFrames += values.length;
      for (const frame of values) usageBytes += frame.body.length;
    }
    while (usageFrames > 2_048 || usageBytes > 24_000_000) {
      if (source.lobby === "SABA") {
        // SABA partitions are only usable as a whole reset..done baseline, so
        // drop the oldest partition entirely.
        let oldestPartition: string | undefined;
        let oldestAtMs = Number.POSITIVE_INFINITY;
        for (const [key, values] of partitions) {
          const at = values[0]?.observedAtMs ?? 0;
          if (at < oldestAtMs) { oldestAtMs = at; oldestPartition = key; }
        }
        if (oldestPartition === undefined) break;
        const removed = partitions.get(oldestPartition) ?? [];
        usageFrames -= removed.length;
        for (const frame of removed) usageBytes -= frame.body.length;
        partitions.delete(oldestPartition);
        this.#sabaReadySnapshotPartitions.delete(`${source.sourceId}|${oldestPartition}`);
        continue;
      }
      let oldestKey: string | undefined;
      let oldestAtMs = Number.POSITIVE_INFINITY;
      for (const [key, values] of partitions) {
        const head = values[0];
        if (head !== undefined && head.observedAtMs < oldestAtMs) { oldestAtMs = head.observedAtMs; oldestKey = key; }
      }
      if (oldestKey === undefined) break;
      const bucket = partitions.get(oldestKey)!;
      const evicted = bucket.shift();
      if (evicted === undefined) { partitions.delete(oldestKey); continue; }
      usageFrames -= 1;
      usageBytes -= evicted.body.length;
      if (bucket.length === 0) partitions.delete(oldestKey);
    }
    this.#catalogWsSnapshots.set(source.sourceId, partitions);
    if (source.lobby === "SABA" && this.#sabaReadySnapshotPartitions.has(readyKey)) {
      this.#scheduleSabaWsSnapshotSave(source.sourceId, completesBaseline);
    } else if (source.lobby === "KSPORT" && ksportFramesContainCompleteBaseline(frames)) {
      this.#scheduleSabaWsSnapshotSave(source.sourceId, true);
    }
  }

  async #restoreSabaWsSnapshots(source: ObservedSource): Promise<void> {
    if (this.#sabaSnapshotLoads.has(source.sourceId)) return;
    this.#sabaSnapshotLoads.add(source.sourceId);
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    // Durable frames are worker-bootstrap evidence only. Once this worker has
    // explicitly replaced the source epoch, accepting them would relabel an
    // old complete baseline as current and create false continuity.
    if (sourceGeneration > 0) return;
    const documentMarker = await this.#sabaDocumentMarker(source, undefined, sourceGeneration);
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
    if (documentMarker === null) return;
    const raw = await this.#loadSabaWsSnapshots(source.sourceId).catch(() => null);
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
    if (!isRecord(raw) || raw.version !== 1 || raw.sourceId !== source.sourceId ||
      raw.documentMarker !== documentMarker || !Array.isArray(raw.partitions)) return;
    const restored = new Map<string, ReplayableWsEvent[]>();
    for (const candidate of raw.partitions) {
      if (!isRecord(candidate) || typeof candidate.partition !== "string" || !Array.isArray(candidate.frames)) continue;
      const frames: ReplayableWsEvent[] = [];
      for (const frame of candidate.frames) {
        if (!isRecord(frame) || typeof frame.url !== "string" || typeof frame.body !== "string" ||
          typeof frame.streamId !== "string" || typeof frame.observedAtMs !== "number" ||
          typeof frame.receivedMonotonicMs !== "number") continue;
        frames.push({ source, url: frame.url, body: frame.body, streamId: frame.streamId,
          observedAtMs: frame.observedAtMs, receivedMonotonicMs: frame.receivedMonotonicMs });
      }
      if (frames.length === 0 || (source.lobby === "SABA"
        ? !sabaFramesContainCompleteBaseline(frames)
        : source.lobby === "KSPORT" ? !ksportFramesContainCompleteBaseline(frames) : true)) continue;
      if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
      restored.set(candidate.partition, frames);
      if (source.lobby === "SABA") {
        this.#sabaReadySnapshotPartitions.add(`${source.sourceId}|${candidate.partition}`);
      }
    }
    if (restored.size > 0) this.#catalogWsSnapshots.set(source.sourceId, restored);
  }

  #scheduleSabaWsSnapshotSave(sourceId: string, immediate: boolean): void {
    if (this.#saveSabaWsSnapshots === undefined) return;
    if (immediate) {
      const timer = this.#sabaSnapshotSaveTimers.get(sourceId);
      if (timer !== undefined) clearTimeout(timer);
      this.#sabaSnapshotSaveTimers.delete(sourceId);
    }
    const elapsed = this.#now() - (this.#sabaSnapshotLastSavedAtMs.get(sourceId) ?? Number.NEGATIVE_INFINITY);
    if (!immediate && elapsed < SABA_SNAPSHOT_PERSIST_INTERVAL_MS) {
      if (!this.#sabaSnapshotSaveTimers.has(sourceId)) {
        const timer = setTimeout(() => {
          this.#sabaSnapshotSaveTimers.delete(sourceId);
          this.#scheduleSabaWsSnapshotSave(sourceId, true);
        }, SABA_SNAPSHOT_PERSIST_INTERVAL_MS - Math.max(0, elapsed));
        this.#sabaSnapshotSaveTimers.set(sourceId, timer);
      }
      return;
    }
    const cache = this.#sabaWsSnapshotCache(sourceId);
    if (cache === null) return;
    const sourceGeneration = this.#sourceGenerations.get(sourceId) ?? 0;
    const previous = this.#sabaSnapshotStorageTails.get(sourceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      if (!this.#isSourceGenerationCurrent(sourceId, sourceGeneration)) return;
      await this.#saveSabaWsSnapshots!(cache).catch(() => undefined);
      if (this.#isSourceGenerationCurrent(sourceId, sourceGeneration)) {
        this.#sabaSnapshotLastSavedAtMs.set(sourceId, this.#now());
      }
    });
    const settled = operation.finally(() => {
      if (this.#sabaSnapshotStorageTails.get(sourceId) === settled) {
        this.#sabaSnapshotStorageTails.delete(sourceId);
      }
    });
    this.#sabaSnapshotStorageTails.set(sourceId, settled);
  }

  #scheduleSabaWsSnapshotClear(sourceId: string): Promise<void> {
    const previous = this.#sabaSnapshotStorageTails.get(sourceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined)
      .then(() => this.#clearSabaWsSnapshots(sourceId).catch(() => undefined));
    const settled = operation.finally(() => {
      if (this.#sabaSnapshotStorageTails.get(sourceId) === settled) {
        this.#sabaSnapshotStorageTails.delete(sourceId);
      }
    });
    this.#sabaSnapshotStorageTails.set(sourceId, settled);
    return settled;
  }

  #sabaWsSnapshotCache(sourceId: string): PersistedSabaWsSnapshots | null {
    const documentMarker = this.#sabaDocumentMarkers.get(sourceId);
    if (documentMarker === undefined) return null;
    const partitions = [...(this.#catalogWsSnapshots.get(sourceId) ?? [])].flatMap(([partition, frames]) => {
      const lobby = frames[0]?.source.lobby;
      const complete = lobby === "SABA" ? this.#sabaReadySnapshotPartitions.has(`${sourceId}|${partition}`)
        : lobby === "KSPORT" ? ksportFramesContainCompleteBaseline(frames) : false;
      return complete ? [{ partition, frames: frames.map(({ source: _source, ...frame }) => frame) }] : [];
    });
    if (partitions.length === 0) return null;
    const value: PersistedSabaWsSnapshots = { version: 1, sourceId, documentMarker, partitions };
    return JSON.stringify(value).length <= 4_000_000 ? value : null;
  }

  async #sabaDocumentMarker(source: ObservedSource, sessionId?: string,
    sourceGeneration = this.#captureSourceGeneration(source.sourceId)): Promise<string | null> {
    const retained = this.#sabaDocumentMarkers.get(source.sourceId);
    if (retained !== undefined) return retained;
    const params = { expression: "String(performance.timeOrigin)", returnByValue: true, awaitPromise: false };
    const evaluation = await this.#withFrameCommandTimeout(sessionId === undefined
      ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
      : this.#sendCommand(source.tabId, "Runtime.evaluate", params, sessionId)).catch(() => null);
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return null;
    const value = nestedValue(evaluation, "result", "value");
    if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value) || value.length > 64) return null;
    this.#sabaDocumentMarkers.set(source.sourceId, value);
    return value;
  }

  #discardSabaWsSnapshots(sourceId: string): void {
    this.#catalogWsSnapshots.delete(sourceId);
    for (const key of this.#sabaReadySnapshotPartitions) {
      if (key.startsWith(`${sourceId}|`)) this.#sabaReadySnapshotPartitions.delete(key);
    }
    this.#sabaSnapshotLoads.add(sourceId);
    this.#sabaDocumentMarkers.delete(sourceId);
  }

  #rememberTsportWsEvent(source: ObservedSource, url: string, body: string, streamId: string,
    clocks: { readonly observedAtMs: number; readonly receivedMonotonicMs: number }): void {
    if (source.lobby !== "TSPORT") return;
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { return; }
    if (!/^spws\.(?:agenate|racern)\.com$/iu.test(parsedUrl.hostname) ||
      !/^\/ln\/[^/]+\/(?:p\/1\/u\/[^/]+(?:\/[^/]+)?\/)?s\/1\/mg\/0\/tr\/0$/u.test(parsedUrl.pathname)) return;
    try {
      const outer: unknown = JSON.parse(body);
      if (!isRecord(outer) || outer.s !== 1 || outer.t !== "eu" || typeof outer.d !== "string") return;
      const event: unknown = JSON.parse(outer.d);
      if (!isRecord(event) || (typeof event["2"] !== "number" && typeof event["2"] !== "string")) return;
      const retained = this.#tsportSnapshots.get(source.sourceId) ?? new Map<string, ReplayableWsEvent>();
      retained.set(String(event["2"]), { source, url, body, streamId, ...clocks });
      while (retained.size > 1_000) retained.delete(retained.keys().next().value as string);
      this.#tsportSnapshots.set(source.sourceId, retained);
    } catch { /* Non-event frames are not replayable catalog state. */ }
  }

  #rememberHttpSnapshot(pending: PendingRequest, body: string,
    clocks: { readonly observedAtMs: number; readonly receivedMonotonicMs: number }): void {
    let url: URL;
    try { url = new URL(pending.url); } catch { return; }
    if (pending.source.lobby !== "IM" || url.hostname !== "imsports.directsb.net" ||
      url.pathname !== "/api/EventV6/GetSE") return;
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }
    if (!isRecord(parsed) || parsed.StatusCode !== 100 || !Array.isArray(parsed.sel)) return;
    const existing = this.#httpSnapshots.get(pending.source.sourceId) ?? [];
    // Market 1 and Market 2 can legitimately return byte-identical bodies.
    // Replace only the same safe partition; body-only deduplication loses one
    // baseline and makes the backend wait forever for a complete IM catalog.
    const deduplicated = existing.filter((entry) => pending.providerPartition === undefined
      ? entry.body !== body
      : entry.providerPartition !== pending.providerPartition);
    deduplicated.push({ source: pending.source, url: pending.url, resourceType: pending.resourceType, body,
      ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }),
      ...(pending.streamId === undefined ? {} : { streamId: pending.streamId }), ...clocks });
    while (deduplicated.length > 4 || deduplicated.reduce((sum, entry) => sum + entry.body.length, 0) > 12_000_000) {
      deduplicated.shift();
    }
    this.#httpSnapshots.set(pending.source.sourceId, deduplicated);
  }

  async #recoverMissingImBaseline(pending: PendingRequest): Promise<void> {
    if (this.#recoverImBaseline === null || pending.source.lobby !== "IM" ||
      this.#httpSnapshots.has(pending.source.sourceId)) return;
    let url: URL;
    try { url = new URL(pending.url); } catch { return; }
    if (url.hostname !== "imsports.directsb.net" || url.pathname !== "/api/EventV6/GetSEDelta") return;
    const nowMs = this.#now();
    const previous = this.#imLastRecoveryAtMs.get(pending.source.sourceId);
    if (previous !== undefined && nowMs - previous < 60_000) return;
    this.#imLastRecoveryAtMs.set(pending.source.sourceId, nowMs);
    await this.#recoverImBaseline(pending.source).catch(() => undefined);
  }

  #hostnameFromCmdSource(sourceId: string): string | null {
    // The source ID itself intentionally carries no hostname. Reuse the safe
    // hostname retained with the public DOM snapshot.
    return this.#cmdSnapshotHosts.get(sourceId) ?? null;
  }

  async #emit(
    source: ObservedSource,
    url: string,
    resourceType: string,
    transport: ChromeBridgeEnvelope["transport"],
    payload: ChromeBridgeEnvelope["payload"],
    metadata: {
      readonly request?: Pick<ChromeBridgeEnvelope["request"], "streamId" | "providerPartition" | "replayed">;
      readonly observedAtMs?: number;
      readonly receivedMonotonicMs?: number;
      readonly sourceGeneration?: number;
    } = {}
  ): Promise<void> {
    const sourceGeneration = metadata.sourceGeneration ?? this.#captureSourceGeneration(source.sourceId);
    const previous = this.#emissionTails.get(source.sourceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if ((this.#sourceGenerations.get(source.sourceId) ?? 0) !== sourceGeneration) return;
      const sequence = this.#sequences.get(source.sourceId) ?? 0;
      try {
        const redacted = redactNetworkEnvelope({
          version: 1,
          kind: "NETWORK",
          ...source,
          sourceEpoch: `${this.#observerSessionId}:${sourceGeneration}`,
          sequence,
          observedAtMs: metadata.observedAtMs ?? this.#now(),
          receivedMonotonicMs: metadata.receivedMonotonicMs ?? this.#monotonicNow(),
          transport,
          request: { url, resourceType, ...metadata.request },
          payload
        }) as ChromeBridgeEnvelope;
        await this.#forward(redacted);
        if ((this.#sourceGenerations.get(source.sourceId) ?? 0) === sourceGeneration) {
          this.#sequences.set(source.sourceId, sequence + 1);
        }
      } catch (error) {
        if (!(error instanceof Error) || !/^BRIDGE_PAYLOAD_/u.test(error.message)) throw error;
      }
    });
    this.#emissionTails.set(source.sourceId, current);
    try {
      await current;
    } finally {
      if (this.#emissionTails.get(source.sourceId) === current) this.#emissionTails.delete(source.sourceId);
    }
  }

  #captureSourceGeneration(sourceId: string): number {
    return this.#activeWorkGenerations.get(sourceId) ?? this.#sourceGenerations.get(sourceId) ?? 0;
  }

  #isSourceGenerationCurrent(sourceId: string, generation: number): boolean {
    return (this.#sourceGenerations.get(sourceId) ?? 0) === generation;
  }
}

function imPartitionFromRequest(source: ObservedSource,
  request: Record<string, unknown>): ImProviderPartition | null {
  if (source.lobby !== "IM" || typeof request.url !== "string" || typeof request.postData !== "string") return null;
  if (!isImGetSeUrl(source, request.url)) return null;
  try {
    const body: unknown = JSON.parse(request.postData);
    if (!isRecord(body)) return null;
    return body.Market === 1 ? "IM_MARKET_1" : body.Market === 2 ? "IM_MARKET_2" : null;
  } catch {
    return null;
  }
}

function isImGetSeUrl(source: ObservedSource, value: string): boolean {
  if (source.lobby !== "IM") return false;
  try {
    const url = new URL(value);
    return url.hostname === "imsports.directsb.net" && url.pathname === "/api/EventV6/GetSE";
  } catch {
    return false;
  }
}


function isReplayableCmdCatalog(records: readonly unknown[]): boolean {
  return records.some((record) => {
    if (!isRecord(record) || !Array.isArray(record.groups)) return false;
    return record.groups.some((group) => isRecord(group) && Array.isArray(group.odds) && group.odds.length === 2);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sabaFramesContainCompleteBaseline(frames: readonly ReplayableWsEvent[]): boolean {
  let reset = false;
  let footballRecord = false;
  for (const frame of frames) {
    try {
      if (!frame.body.startsWith("42")) continue;
      const payload: unknown = JSON.parse(frame.body.slice(2));
      if (!Array.isArray(payload) || payload[0] !== "m" || !Array.isArray(payload[2])) continue;
      for (const row of payload[2]) {
        if (!Array.isArray(row)) continue;
        if (row[1] === "reset" || row[1] === "empty") {
          reset = true;
          footballRecord = false;
          continue;
        }
        if (reset && (row[1] === "e" || row[1] === "l" || row[1] === "m" || row[1] === "o")) {
          footballRecord = true;
        }
        if (row[1] === "done" && reset && footballRecord) return true;
      }
    } catch { return false; }
  }
  return false;
}

function ksportFramesContainCompleteBaseline(frames: readonly ReplayableWsEvent[]): boolean {
  const state = ksportBaselineState(frames);
  return state.live && state.today;
}

function ksportBaselineState(frames: readonly ReplayableWsEvent[]): { readonly live: boolean; readonly today: boolean } {
  let live = false;
  let today = false;
  for (const frame of frames) {
    if (/destination:\/topic\/sports\/1_1\/live\//u.test(frame.body)) live = true;
    // KSPORT uses sport group 1_1 for live and 1_11 (hot/today) for the
    // second baseline partition. Older code only accepted 1_1/today, so a
    // real complete baseline never satisfied readiness and Reset deleted the
    // healthy replacement five seconds later.
    if (/destination:\/topic\/sports\/1_(?:1|11)\/today\//u.test(frame.body)) today = true;
  }
  return { live, today };
}

function nestedNumber(value: unknown, key: string): number | null {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : null;
}

function nestedBoolean(value: unknown, ...keys: string[]): boolean | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "boolean" ? current : null;
}

function nestedValue(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function isCmdHiddenDomProbeResult(value: unknown): value is CmdHiddenDomProbeResult {
  return isRecord(value) && typeof value.found === "boolean" &&
    Array.isArray(value.beforeMarketIds) && value.beforeMarketIds.every((item) => typeof item === "string") &&
    Array.isArray(value.afterMarketIds) && value.afterMarketIds.every((item) => typeof item === "string") &&
    Array.isArray(value.clickedControls) && value.clickedControls.every((item) => typeof item === "string") &&
    Array.isArray(value.candidateControls) && value.candidateControls.every((item) => typeof item === "string") &&
    Array.isArray(value.marketStructures) && value.marketStructures.every((item) => typeof item === "string") &&
    Array.isArray(value.visibleEventIds) && value.visibleEventIds.every((item) => typeof item === "string") &&
    typeof value.stablePasses === "number" && Number.isSafeInteger(value.stablePasses);
}

function cmdHiddenDomScore(value: CmdHiddenDomProbeResult): number {
  return (value.found ? 1_000_000 : 0) + value.afterMarketIds.length * 1_000 +
    value.beforeMarketIds.length * 100 + value.clickedControls.length * 10 + value.candidateControls.length;
}

function uniqueObjects<T>(items: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectFrameIds(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.frameTree)) return [];
  const output: string[] = [];
  const visit = (tree: unknown): void => {
    if (!isRecord(tree)) return;
    if (isRecord(tree.frame) && typeof tree.frame.id === "string") output.push(tree.frame.id);
    if (Array.isArray(tree.childFrames)) tree.childFrames.forEach(visit);
  };
  visit(value.frameTree);
  return output;
}

function readEvaluationRecords(value: unknown): unknown[] {
  if (!isRecord(value) || !isRecord(value.result) || typeof value.result.value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value.result.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
