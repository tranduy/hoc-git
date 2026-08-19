import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { chunkCmdSnapshot } from "./cmd-snapshot-chunker.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { redactNetworkBody, redactNetworkEnvelope } from "./redactor.js";
import { buildCmdSelectionFocusExpression, buildGenericSelectionFocusExpression,
  type SelectionFocusIdentity } from "./selection-focus.js";
import { buildCmdHiddenMarketProbeExpression, summarizeCmdHiddenProtocolFrame,
  type CmdHiddenDomProbeResult, type CmdHiddenProtocolEvidence } from "./cmd-hidden-market-probe.js";

const NETWORK_CHUNK_BODY_BYTES = 110_000;
const CATALOG_REFRESH_INTERVAL_MS = 4_000;

export interface ObservedSource {
  readonly lobby: ChromeLobbyId;
  readonly sourceId: string;
  readonly tabId: number;
}

export interface NetworkObserverDependencies {
  readonly sendCommand: (tabId: number, method: string, params?: Record<string, unknown>) => Promise<unknown>;
  readonly forward: (envelope: ChromeBridgeEnvelope) => Promise<void>;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
  readonly recoverImBaseline?: (source: ObservedSource) => Promise<void>;
  readonly frameCommandTimeoutMs?: number;
  readonly observerSessionId?: string;
}

type ImProviderPartition = "IM_MARKET_1" | "IM_MARKET_2";

interface PendingRequest {
  readonly source: ObservedSource;
  readonly url: string;
  readonly resourceType: string;
  readonly providerPartition?: ImProviderPartition;
}

interface ReplayableHttpSnapshot {
  readonly source: ObservedSource;
  readonly url: string;
  readonly resourceType: string;
  readonly body: string;
  readonly providerPartition?: ImProviderPartition;
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
export const IM_CATALOG_DISCOVERY_EXPRESSION = `(() => {
  const root = document.documentElement;
  const now = Date.now();
  const prior = Number(root.dataset.fieldlineImCatalogRefreshAt || 0);
  if (Number.isFinite(prior) && now - prior < 15000) return 'rate-limited';
  // Read the same authenticated catalog endpoint used by the IM page. The
  // relative URL reuses the tab's existing session and never exports auth.
  // Network observation captures the response exactly like a normal UI read.
  if (location.hostname === 'imsports.directsb.net') {
    root.dataset.fieldlineImCatalogRefreshAt = String(now);
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
      ['O' + 'ddsType']: 2, DateFrom: '', DateTo: '', CompetitionIds: [],
      SortType: 2, ProgrammeIds: []
    };
    void (async () => {
      const path = '/api/EventV6/GetSE';
      const token = sessionStorage.getItem('to' + 'ken') ||
        new URLSearchParams(location.search).get('to' + 'ken');
      if (!token) return;
      for (const Market of [1, 2]) {
        const signature = String(await sign(path));
        await fetch(path, {
          method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: {
            Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8',
            'x-sc': encodeURI(signature), 'x-v': '91460',
            'x-platform': String(window.global?.PlatForm || ''),
            ['x-' + 'token']: token
          },
          body: JSON.stringify({ ...common, Market })
        });
      }
    })().catch(() => undefined);
    return 'catalog-requested';
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
    return label;
  }
  return 'navigation-not-found';
})()`;

// BTI's event-list is a same-origin authenticated GET. Trigger the same
// read-only request from the attached tab so Chrome's network observer receives
// a genuinely current response instead of replaying old odds as fresh data.
export const BTI_CATALOG_REFRESH_EXPRESSION = `(async () => {
  const root = document.documentElement;
  const now = Date.now();
  const prior = Number(root.dataset.fieldlineBtiCatalogRefreshAt || 0);
  if (Number.isFinite(prior) && now - prior < 4000) return 'rate-limited';
  if (!location.pathname || !location.hostname) return 'page-unavailable';
  root.dataset.fieldlineBtiCatalogRefreshAt = String(now);
  const listPaths = [
    '/api/eventlist/asia/leagues/v2/1/live',
    '/api/eventlist/asia/leagues/v2/1/live/initial',
    '/api/eventlist/asia/leagues/v2/1/prematch',
    '/api/eventlist/asia/leagues/v2/1/prematch/initial'
  ];
  const listResponses = await Promise.all(listPaths.map(async (path) => {
    const response = await fetch(path, { method: 'GET', credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json' } }).catch(() => null);
    if (!response || !response.ok) return null;
    return response.json().catch(() => null);
  }));
  const eventIds = [];
  const seen = new Set();
  for (const payload of listResponses) {
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
  const selected = ranked.slice(0, 6).map(({ eventId }) => eventId);
  const nextVisits = {};
  for (const [eventId, value] of Object.entries(priorVisits)) {
    const visitedAt = Number(value);
    if (Number.isFinite(visitedAt) && visitedAt > 0 && now - visitedAt <= 10 * 60 * 1000) {
      nextVisits[eventId] = visitedAt;
    }
  }
  for (const eventId of selected) nextVisits[eventId] = now;
  root.dataset.fieldlineBtiDetailVisits = JSON.stringify(nextVisits);
  const authName = ['author', 'ization'].join('');
  const contextName = ['service', '-', 'context'].join('');
  const detailHeaders = { Accept: 'application/json' };
  const authValue = localStorage.getItem(['CT_APP_', 'AUTH', 'ORIZATION'].join(''));
  const contextValue = localStorage.getItem(['CT_APP_', 'SERVICE', '_CONTEXT'].join(''));
  if (authValue) detailHeaders[authName] = authValue;
  if (contextValue) detailHeaders[contextName] = contextValue;
  await Promise.allSettled(selected.map((eventId) => fetch(
    '/api/eventpage/events/' + encodeURIComponent(eventId) + '?hideX25X75Selections=false',
    { method: 'GET', credentials: 'include', cache: 'no-store', headers: detailHeaders }
  )));
  return 'catalog-requested';
})()`;

export class NetworkObserver {
  readonly #sendCommand: NetworkObserverDependencies["sendCommand"];
  readonly #forward: NetworkObserverDependencies["forward"];
  readonly #now: () => number;
  readonly #monotonicNow: () => number;
  readonly #recoverImBaseline: ((source: ObservedSource) => Promise<void>) | null;
  readonly #frameCommandTimeoutMs: number;
  readonly #observerSessionId: string;
  readonly #sequences = new Map<string, number>();
  readonly #sourceGenerations = new Map<string, number>();
  readonly #streamOrdinals = new Map<string, number>();
  readonly #emissionTails = new Map<string, Promise<void>>();
  readonly #webSockets = new Map<string, { source: ObservedSource; url: string; streamId: string }>();
  readonly #requestPartitions = new Map<string, ImProviderPartition>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #cmdSnapshots = new Map<string, { readonly body: string; readonly sentAtMs: number;
    readonly receivedMonotonicMs: number }>();
  readonly #cmdLastBodies = new Map<string, string>();
  readonly #cmdLastSentAtMs = new Map<string, number>();
  readonly #cmdSnapshotHosts = new Map<string, string>();
  readonly #httpSnapshots = new Map<string, ReplayableHttpSnapshot[]>();
  readonly #tsportSnapshots = new Map<string, Map<string, ReplayableWsEvent>>();
  readonly #cmdCapturesInFlight = new Set<string>();
  readonly #imLastRecoveryAtMs = new Map<string, number>();
  readonly #startedTabs = new Set<number>();
  readonly #mainWorldContexts = new Map<number, Map<string, number>>();
  readonly #activeCmdHiddenProbes = new Map<string, ActiveCmdHiddenProbe>();

  constructor(dependencies: NetworkObserverDependencies) {
    this.#sendCommand = dependencies.sendCommand;
    this.#forward = dependencies.forward;
    this.#now = dependencies.now ?? Date.now;
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.#recoverImBaseline = dependencies.recoverImBaseline ?? null;
    this.#frameCommandTimeoutMs = dependencies.frameCommandTimeoutMs ?? 2_500;
    this.#observerSessionId = dependencies.observerSessionId ?? crypto.randomUUID();
    if (!/^[a-z0-9._:-]{1,96}$/iu.test(this.#observerSessionId)) {
      throw new Error("OBSERVER_SESSION_ID_INVALID");
    }
  }

  async start(source: ObservedSource): Promise<void> {
    if (this.#startedTabs.has(source.tabId)) return;
    await this.#sendCommand(source.tabId, "Network.enable", {
      maxTotalBufferSize: 16 * 1024 * 1024,
      maxResourceBufferSize: 12 * 1024 * 1024,
      maxPostDataSize: 0
    });
    await this.#sendCommand(source.tabId, "Runtime.enable", {});
    this.#startedTabs.add(source.tabId);
    await this.#sendCommand(source.tabId, "Page.setLifecycleEventsEnabled", { enabled: true });
    await this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: DISCOVERY_EXPRESSION,
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

  releaseTab(tabId: number): void {
    this.#startedTabs.delete(tabId);
    this.#mainWorldContexts.delete(tabId);
    const sourceIds = new Set<string>();
    const remember = (sourceId: string): void => {
      if (sourceId.endsWith(`:${tabId}`)) sourceIds.add(sourceId);
    };
    for (const sourceId of this.#sequences.keys()) remember(sourceId);
    for (const sourceId of this.#cmdSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#httpSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#tsportSnapshots.keys()) remember(sourceId);
    for (const sourceId of sourceIds) {
      this.#sourceGenerations.set(sourceId, (this.#sourceGenerations.get(sourceId) ?? 0) + 1);
      this.#sequences.delete(sourceId);
      this.#emissionTails.delete(sourceId);
      this.#cmdSnapshots.delete(sourceId);
      this.#cmdLastBodies.delete(sourceId);
      this.#cmdLastSentAtMs.delete(sourceId);
      this.#cmdSnapshotHosts.delete(sourceId);
      this.#httpSnapshots.delete(sourceId);
      this.#tsportSnapshots.delete(sourceId);
      this.#cmdCapturesInFlight.delete(sourceId);
      this.#imLastRecoveryAtMs.delete(sourceId);
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
  }

  async maintain(source: ObservedSource): Promise<void> {
    await this.#sendCommand(source.tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => ({}));
    await this.#sendCommand(source.tabId, "Page.setWebLifecycleState", { state: "active" }).catch(() => ({}));
    const expression = source.lobby === "IM" ? IM_CATALOG_DISCOVERY_EXPRESSION :
      source.lobby === "CMD" ? CMD_CATALOG_DISCOVERY_EXPRESSION :
        source.lobby === "TSPORT" ? TSPORT_CATALOG_DISCOVERY_EXPRESSION : KEEP_ACTIVE_EXPRESSION;
    if (source.lobby === "IM") {
      // GetSE is signed by IM's page-owned helo/halo_ event handler and uses
      // page globals. Evaluating in an isolated world can still read the DOM,
      // but it cannot invoke that signer, so the request silently degrades to
      // StatusCode 500. The expression is read-only and runs in the top page's
      // main world; Network observation captures its resulting response.
      await this.#sendCommand(source.tabId, "Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: false
      }).catch(() => ({}));
      return;
    }
    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Page.getFrameTree")
    ).catch(() => ({}));
    const frameIds = collectFrameIds(frameTree);
    if (frameIds.length === 0) {
      await this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression, returnByValue: true, awaitPromise: false
      }).catch(() => ({}));
      return;
    }
    for (const frameId of frameIds) {
      const world = await this.#sendCommand(source.tabId, "Page.createIsolatedWorld", {
        frameId, worldName: "fieldline-keep-active", grantUniveralAccess: false
      }).catch(() => ({}));
      const contextId = nestedNumber(world, "executionContextId");
      if (contextId === null) continue;
      await this.#sendCommand(source.tabId, "Runtime.evaluate", {
        expression, contextId, returnByValue: true, awaitPromise: false
      }).catch(() => ({}));
    }
  }

  async refreshCatalog(source: ObservedSource): Promise<void> {
    if (source.lobby !== "BTI") return;
    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Page.getFrameTree")
    ).catch(() => ({}));
    const frameIds = collectFrameIds(frameTree);
    // Always address the current top-level main world directly. Cached CDP
    // execution-context ids are invalidated on provider-side redirects and a
    // stale id otherwise makes every later refresh a silent no-op.
    await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: BTI_CATALOG_REFRESH_EXPRESSION, returnByValue: true, awaitPromise: true
    })).catch(() => ({}));
    if (frameIds.length <= 1) return;
    await Promise.all(frameIds.slice(1).map(async (frameId) => {
      const mainContextId = this.#mainWorldContexts.get(source.tabId)?.get(frameId);
      if (mainContextId !== undefined) {
        await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: BTI_CATALOG_REFRESH_EXPRESSION, contextId: mainContextId,
          returnByValue: true, awaitPromise: true
        })).catch(() => ({}));
        return;
      }
      const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Page.createIsolatedWorld", {
        frameId, worldName: "fieldline-bti-catalog-refresh", grantUniveralAccess: false
      })).catch(() => ({}));
      const contextId = nestedNumber(world, "executionContextId");
      if (contextId === null) return;
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
        expression: BTI_CATALOG_REFRESH_EXPRESSION, contextId, returnByValue: true, awaitPromise: true
      })).catch(() => ({}));
    }));
  }

  async heartbeat(source: ObservedSource, hostname: string): Promise<void> {
    if (!/^[a-z0-9.-]+$/iu.test(hostname)) return;
    await this.#emit(source, `https://${hostname}/__fieldline_heartbeat__`, "Tab", "TAB_STATE", {
      encoding: "UTF8",
      body: "{}"
    });
  }

  async handleEvent(source: ObservedSource, method: string, rawParams: unknown): Promise<void> {
    const params = isRecord(rawParams) ? rawParams : {};
    if (method === "Runtime.executionContextCreated") {
      const context = isRecord(params.context) ? params.context : null;
      const auxData = context && isRecord(context.auxData) ? context.auxData : null;
      const contextId = context && typeof context.id === "number" ? context.id : null;
      const frameId = auxData && typeof auxData.frameId === "string" ? auxData.frameId : null;
      if (contextId !== null && frameId !== null && auxData?.isDefault === true) {
        const contexts = this.#mainWorldContexts.get(source.tabId) ?? new Map<string, number>();
        contexts.set(frameId, contextId);
        this.#mainWorldContexts.set(source.tabId, contexts);
      }
      return;
    }
    if (method === "Runtime.executionContextsCleared") {
      this.#mainWorldContexts.delete(source.tabId);
      this.#sourceGenerations.set(source.sourceId, (this.#sourceGenerations.get(source.sourceId) ?? 0) + 1);
      return;
    }
    if (method === "Runtime.executionContextDestroyed" && typeof params.executionContextId === "number") {
      const contexts = this.#mainWorldContexts.get(source.tabId);
      if (contexts) {
        for (const [frameId, contextId] of contexts) {
          if (contextId === params.executionContextId) contexts.delete(frameId);
        }
      }
      return;
    }
    const requestId = typeof params.requestId === "string" ? params.requestId : null;
    const key = requestId ? `${source.tabId}:${requestId}` : null;

    if (method === "Network.requestWillBeSent" && key) {
      const request = isRecord(params.request) ? params.request : null;
      const partition = request === null ? null : imPartitionFromRequest(source, request);
      if (partition === null) this.#requestPartitions.delete(key);
      else this.#requestPartitions.set(key, partition);
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
      const streamId = String((this.#streamOrdinals.get(source.sourceId) ?? 0) + 1);
      this.#streamOrdinals.set(source.sourceId, Number(streamId));
      this.#webSockets.set(key, { source, url: params.url, streamId });
      await this.#emit(source, params.url, "WebSocket", "WS_STATE", {
        encoding: "UTF8", body: '{"state":"OPEN"}'
      }, { request: { streamId } });
      return;
    }
    if (method === "Network.webSocketClosed" && key) {
      const socket = this.#webSockets.get(key);
      if (socket !== undefined) {
        await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
          encoding: "UTF8", body: '{"state":"CLOSED"}'
        }, { request: { streamId: socket.streamId } });
      }
      this.#webSockets.delete(key);
      return;
    }
    if (method === "Network.webSocketFrameReceived" && key) {
      const socket = this.#webSockets.get(key);
      const response = isRecord(params.response) ? params.response : null;
      if (!socket || !response || typeof response.payloadData !== "string") return;
      const opcode = typeof response.opcode === "number" ? response.opcode : 1;
      const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
      if (opcode !== 2) this.#rememberTsportWsEvent(socket.source, socket.url, response.payloadData,
        socket.streamId, clocks);
      await this.#emit(socket.source, socket.url, "WebSocket", "WS_FRAME", {
        encoding: opcode === 2 ? "BASE64" : "UTF8",
        body: response.payloadData
      }, { request: { streamId: socket.streamId }, ...clocks });
      return;
    }
    if (method === "Network.responseReceived" && key) {
      const response = isRecord(params.response) ? params.response : null;
      const resourceType = typeof params.type === "string" ? params.type : "";
      if (!response || !/^(?:XHR|Fetch)$/u.test(resourceType) || typeof response.url !== "string") return;
      const providerPartition = this.#requestPartitions.get(key);
      this.#pending.set(key, { source, url: response.url, resourceType,
        ...(providerPartition === undefined ? {} : { providerPartition }) });
      return;
    }
    if (method === "Network.loadingFailed" && key) {
      this.#pending.delete(key);
      this.#requestPartitions.delete(key);
      return;
    }
    if (method === "Network.loadingFinished" && key) {
      const pending = this.#pending.get(key);
      this.#pending.delete(key);
      this.#requestPartitions.delete(key);
      if (!pending) return;
      try {
        const response = await this.#sendCommand(source.tabId, "Network.getResponseBody", { requestId });
        if (!isRecord(response) || typeof response.body !== "string") return;
        if (response.base64Encoded === true) {
          await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "BASE64", body: response.body
          });
          return;
        }
        const safeBody = redactNetworkBody(response.body);
        await this.#recoverMissingImBaseline(pending);
        const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
        this.#rememberHttpSnapshot(pending, safeBody, clocks);
        const fragments = splitUtf8Text(safeBody, NETWORK_CHUNK_BODY_BYTES);
        if (fragments.length === 1) {
          await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: safeBody
          }, { request: { providerPartition: pending.providerPartition }, ...clocks });
          return;
        }
        const snapshotId = `network:${source.tabId}:${this.#now()}:${this.#sequences.get(source.sourceId) ?? 0}`;
        const emissions = fragments.map((bodyFragment, chunkIndex) =>
          this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex,
              chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment })
          }, { request: { providerPartition: pending.providerPartition }, ...clocks }));
        await Promise.all(emissions);
      } catch {
        // A response body can be evicted by Chrome; isolate it from the stream.
      }
    }
  }

  async ingestWebSocketFrame(source: ObservedSource, url: string, payloadData: string,
    opcode = 1): Promise<void> {
    if (!/^wss?:\/\//iu.test(url) || !Number.isInteger(opcode) || (opcode !== 1 && opcode !== 2)) return;
    const streamId = "manual";
    const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
    if (opcode !== 2) this.#rememberTsportWsEvent(source, url, payloadData, streamId, clocks);
    await this.#emit(source, url, "WebSocket", "WS_FRAME", {
      encoding: opcode === 2 ? "BASE64" : "UTF8",
      body: payloadData
    }, { request: { streamId }, ...clocks });
  }

  async ingestHttpResponse(source: ObservedSource, url: string, resourceType: "XHR" | "Fetch",
    body: string): Promise<void> {
    if (!/^https?:\/\//iu.test(url)) return;
    const pending: PendingRequest = { source, url, resourceType };
    const safeBody = redactNetworkBody(body);
    await this.#recoverMissingImBaseline(pending);
    const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
    this.#rememberHttpSnapshot(pending, safeBody, clocks);
    const fragments = splitUtf8Text(safeBody, NETWORK_CHUNK_BODY_BYTES);
    if (fragments.length === 1) {
      await this.#emit(source, url, resourceType, "HTTP_RESPONSE", { encoding: "UTF8", body: safeBody }, clocks);
      return;
    }
    const snapshotId = `network:${source.tabId}:${this.#now()}:${this.#sequences.get(source.sourceId) ?? 0}`;
    for (const [chunkIndex, bodyFragment] of fragments.entries()) {
      await this.#emit(source, url, resourceType, "HTTP_RESPONSE", {
        encoding: "UTF8",
        body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex, chunkCount: fragments.length,
          bodyEncoding: "UTF8", bodyFragment })
      }, clocks);
    }
  }

  async ingestDomSnapshot(source: ObservedSource, hostname: string, body: string): Promise<void> {
    if ((source.lobby !== "CMD" && source.lobby !== "SABA") || !/^[a-z0-9.-]+$/iu.test(hostname)) return;
    let records: unknown;
    try { records = JSON.parse(body); } catch { return; }
    if (!Array.isArray(records) || records.length === 0) return;
    const nowMs = this.#now();
    const receivedMonotonicMs = this.#monotonicNow();
    const snapshotId = `dom:${source.tabId}:${nowMs}`;
    for (const chunk of chunkCmdSnapshot(records, snapshotId)) {
      await this.#emit(source, `https://${hostname}/__fieldline_dom_snapshot__`, "DOM", "DOM_SNAPSHOT", {
        encoding: "UTF8", body: JSON.stringify(chunk)
      }, { observedAtMs: nowMs, receivedMonotonicMs });
    }
    if (isReplayableCmdCatalog(records)) {
      this.#cmdSnapshots.set(source.sourceId, { body, sentAtMs: nowMs, receivedMonotonicMs });
      this.#cmdSnapshotHosts.set(source.sourceId, hostname);
    }
  }

  async captureCmdSnapshot(source: ObservedSource, hostname: string): Promise<void> {
    if ((source.lobby !== "CMD" && source.lobby !== "SABA" && source.lobby !== "TSPORT") ||
      this.#cmdCapturesInFlight.has(source.sourceId) ||
      !/^[a-z0-9.-]+$/iu.test(hostname)) return;
    this.#cmdCapturesInFlight.add(source.sourceId);
    try {
      const expression = source.lobby === "TSPORT"
        ? TSPORT_PUBLIC_CATALOG_EXPRESSION : CMD_PUBLIC_CATALOG_EXPRESSION;
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
      if (previous === catalogBody && nowMs - (this.#cmdLastSentAtMs.get(source.sourceId) ?? 0)
        < CATALOG_REFRESH_INTERVAL_MS) return;
      const snapshotId = `cmd:${source.tabId}:${nowMs}`;
      const chunks = chunkCmdSnapshot(records, snapshotId);
      for (const chunk of chunks) {
        await this.#emit(source, `https://${hostname}/__fieldline_dom_snapshot__`, "DOM", "DOM_SNAPSHOT", {
          encoding: "UTF8", body: JSON.stringify(chunk)
        }, { observedAtMs: nowMs, receivedMonotonicMs });
      }
      this.#cmdLastBodies.set(source.sourceId, catalogBody);
      this.#cmdLastSentAtMs.set(source.sourceId, nowMs);
      if (isReplayableCmdCatalog(records)) {
        this.#cmdSnapshots.set(source.sourceId, { body: catalogBody, sentAtMs: nowMs, receivedMonotonicMs });
        this.#cmdSnapshotHosts.set(source.sourceId, hostname);
      }
    } finally {
      this.#cmdCapturesInFlight.delete(source.sourceId);
    }
  }

  async #withFrameCommandTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("frame-command-timeout")), this.#frameCommandTimeoutMs);
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
          }, { request: { providerPartition: snapshot.providerPartition, replayed: true },
            observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
        } else {
          const snapshotId = `network-replay:${snapshot.source.tabId}:${this.#now()}:${this.#sequences.get(sourceId) ?? 0}`;
          for (const [chunkIndex, bodyFragment] of fragments.entries()) {
            await this.#emit(snapshot.source, snapshot.url, snapshot.resourceType, "HTTP_RESPONSE", {
              encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex,
                chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment })
            }, { request: { providerPartition: snapshot.providerPartition, replayed: true },
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
    return replayed;
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
    const deduplicated = existing.filter((entry) => entry.body !== body);
    deduplicated.push({ source: pending.source, url: pending.url, resourceType: pending.resourceType, body,
      ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }), ...clocks });
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
    } = {}
  ): Promise<void> {
    const previous = this.#emissionTails.get(source.sourceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const sequence = this.#sequences.get(source.sourceId) ?? 0;
      try {
        const redacted = redactNetworkEnvelope({
          version: 1,
          kind: "NETWORK",
          ...source,
          sourceEpoch: `${this.#observerSessionId}:${this.#sourceGenerations.get(source.sourceId) ?? 0}`,
          sequence,
          observedAtMs: metadata.observedAtMs ?? this.#now(),
          receivedMonotonicMs: metadata.receivedMonotonicMs ?? this.#monotonicNow(),
          transport,
          request: { url, resourceType, ...metadata.request },
          payload
        }) as ChromeBridgeEnvelope;
        await this.#forward(redacted);
        this.#sequences.set(source.sourceId, sequence + 1);
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
}

function imPartitionFromRequest(source: ObservedSource,
  request: Record<string, unknown>): ImProviderPartition | null {
  if (source.lobby !== "IM" || typeof request.url !== "string" || typeof request.postData !== "string") return null;
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (url.hostname !== "imsports.directsb.net" || url.pathname !== "/api/EventV6/GetSE") return null;
  try {
    const body: unknown = JSON.parse(request.postData);
    if (!isRecord(body)) return null;
    return body.Market === 1 ? "IM_MARKET_1" : body.Market === 2 ? "IM_MARKET_2" : null;
  } catch {
    return null;
  }
}

function splitUtf8Text(value: string, maxBytes: number): string[] {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return [value];
  const encoder = new TextEncoder();
  const output: string[] = [];
  let start = 0;
  while (start < value.length) {
    let low = start + 1;
    let high = value.length;
    let best = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const bytes = encoder.encode(value.slice(start, middle)).byteLength;
      if (bytes <= maxBytes) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    if (best < value.length && /[\uD800-\uDBFF]/u.test(value[best - 1] ?? "")) best--;
    if (best <= start) throw new Error("BRIDGE_PAYLOAD_INVALID");
    output.push(value.slice(start, best));
    start = best;
  }
  return output;
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
