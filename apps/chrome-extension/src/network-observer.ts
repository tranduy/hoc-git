import type { ChromeBridgeEnvelope, ChromeBridgeHttpMethod, ChromeLobbyId } from "@tool-chenh/contracts";
import { splitUtf8Text } from "./utf8-length.js";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { chunkCmdSnapshot } from "./cmd-snapshot-chunker.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { LIVE_TAB_LABELS, TODAY_TAB_LABELS, timeTabExpression } from "./time-tab-selector.js";
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
import { CmdRecoveryState, type CmdRecoveryDocument, type CmdRecoverySession } from "./cmd-recovery-state.js";
import { ProviderWorkScheduler } from "./provider-work-scheduler.js";
import { KsportRecoveryGenerationTracker } from "./ksport-recovery-generation.js";

const NETWORK_CHUNK_BODY_BYTES = 110_000;
const CATALOG_REFRESH_INTERVAL_MS = 4_000;
const KSPORT_BASELINE_FALLBACK_DELAY_MS = 2_000;
const PREEXISTING_SOCKET_GRACE_MS = 8_000;
const PREEXISTING_SOCKET_MAX_ATTEMPTS = 5;
const KSPORT_HTTP_RECONCILE_INTERVAL_MS = 4_000;
const KSPORT_IGNORED_SOCKETS_PER_SOURCE = 64;
// Long enough that a failed reconnect cannot become a per-frame storm, short
// enough that a provider is never dark for more than a minute.
const KSPORT_ORPHAN_FRAME_RETRY_MS = 30_000;
// Long enough that a click cannot become a storm, short enough that a missing
// partition is retried well inside the feed's baseline lease.
const KSPORT_BASELINE_REQUEST_RETRY_MS = 45_000;
// Re-selecting a period tab drives the provider's own SPA. Measured 35 toggles
// in eight minutes before this cap, which is churn on a page the operator is
// also using. Bounded per attempt generation; a genuinely new generation gets a
// fresh budget.
const KSPORT_BASELINE_REQUESTS_PER_GENERATION = 6;
// Measured 2026-08-26: this source forwards two or three catalog frames per five
// minutes, so 100-150 s gaps are its normal cadence, not silence. The previous
// 30 s window made a healthy socket look idle for most of every gap, and the
// baseline request that yields the first full snapshot only ran in the rare
// seconds right after a frame.
const KSPORT_QUIET_WINDOW_MS = 180_000;
const KSPORT_HEARTBEAT_FORWARD_INTERVAL_MS = 5_000;
const KSPORT_TRANSPORT_HEARTBEAT_MAX_CHARS = 256;
const SABA_SOCKET_RECOVERY_QUERY_TIMEOUT_MS = 10_000;
// SABA publishes only what its page is showing, so a lobby left on the running
// fixtures never reports the ones that have not kicked off - and those are
// almost all of what another book can be compared against. Visiting the day's
// list moves the user's view, so do it rarely and always come back.
const SABA_TODAY_CAPTURE_INTERVAL_MS = 600_000;
const SABA_TODAY_TAB_EXPRESSION = timeTabExpression([...TODAY_TAB_LABELS], true);
const SABA_LIVE_TAB_EXPRESSION = timeTabExpression([...LIVE_TAB_LABELS], true);
const SABA_SNAPSHOT_PERSIST_INTERVAL_MS = 5_000;
const CMD_RECOVERY_MAX_ATTEMPTS = 6;
const CMD_RECOVERY_DEADLINE_MS = 10_000;
const CMD_RECOVERY_RETRY_MS = 500;

function isKsportCatalogSocket(url: URL): boolean {
  return url.protocol === "wss:" && url.username === "" && url.password === "" &&
    isKsportProviderHost(url.hostname) && /^\/sport\//u.test(url.pathname);
}

function isKsportProviderHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "sb21.net" || normalized.endsWith(".sb21.net");
}

function isKsportTransportHeartbeat(payload: string): boolean {
  if (payload === "h") return true;
  if (payload.length > KSPORT_TRANSPORT_HEARTBEAT_MAX_CHARS) return false;
  if (payload.trim() === "") return true;
  const candidate = payload.startsWith("a[") ? payload.slice(1) : payload.startsWith("[") ? payload : null;
  if (candidate === null) return false;
  try {
    const values: unknown = JSON.parse(candidate);
    return Array.isArray(values) && values.length > 0 &&
      values.every((value) => typeof value === "string" && value.trim() === "");
  } catch { return false; }
}

function isPotentialKsportCatalogPayload(payload: string): boolean {
  if (payload === "" || isKsportTransportHeartbeat(payload)) return false;
  return payload.includes("destination:/topic/sports/");
}

function isTsportEventSocket(url: URL): boolean {
  return url.protocol === "wss:" && /^spws\.(?:agenate|racern)\.com$/iu.test(url.hostname) &&
    /^\/ln\/[^/]+\/(?:p\/1\/u\/[^/]+(?:\/[^/]+)?\/)?s\/1\/mg\/0\/tr\/0$/u.test(url.pathname);
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
  readonly cmdRecoveryMaxAttempts?: number;
  readonly cmdRecoveryDeadlineMs?: number;
  readonly cmdRecoveryRetryMs?: number;
  readonly observerSessionId?: string;
  readonly loadSabaWsSnapshots?: (sourceId: string) => Promise<unknown>;
  readonly saveSabaWsSnapshots?: (snapshots: PersistedSabaWsSnapshots) => Promise<void>;
  readonly clearSabaWsSnapshots?: (sourceId: string) => Promise<void>;
  readonly workScheduler?: ProviderWorkScheduler;
}

type ImProviderPartition = "IM_MARKET_1" | "IM_MARKET_2";
type KsportProviderPartition = "KSPORT_LIVE" | "KSPORT_TODAY";
type ProviderPartition = ImProviderPartition | KsportProviderPartition;

interface EmissionRequestMetadata {
  readonly streamId?: string;
  readonly providerPartition?: ProviderPartition;
  readonly replayed?: boolean;
  readonly providerFunctionCode?: number;
  readonly reconcileCutoffSequence?: number;
  readonly method?: ChromeBridgeHttpMethod;
  readonly observerRequestId?: string;
  readonly requestFrameKey?: string;
  readonly requestDocumentKey?: string;
  readonly recoveryGeneration?: number;
  readonly providerContentIntent?: "FOOTBALL_FULL_CATALOG";
  readonly requestStartSequence?: number;
}

interface PendingRequest {
  readonly source: ObservedSource;
  readonly sourceGeneration: number;
  readonly tabGeneration: number;
  readonly sessionId?: string;
  readonly url: string;
  readonly resourceType: string;
  readonly method: ChromeBridgeHttpMethod;
  readonly observerRequestId: string;
  readonly observerRequestOrdinal: number;
  readonly frameId?: string;
  readonly loaderId?: string;
  readonly requestFrameKey?: string;
  readonly requestDocumentKey?: string;
  readonly providerPartition?: ProviderPartition;
  readonly providerContentIntent?: "FOOTBALL_FULL_CATALOG";
  readonly requestStartSequence?: number;
  readonly streamId?: string;
  readonly providerFunctionCode?: number;
  readonly reconcileCutoffSequence?: number;
}

interface ReplayableHttpSnapshot {
  readonly source: ObservedSource;
  readonly url: string;
  readonly resourceType: string;
  readonly body: string;
  readonly method: ChromeBridgeHttpMethod;
  readonly observerRequestId: string;
  readonly observerRequestOrdinal: number;
  readonly requestFrameKey?: string;
  readonly requestDocumentKey?: string;
  readonly providerPartition?: ProviderPartition;
  readonly providerContentIntent?: "FOOTBALL_FULL_CATALOG";
  readonly requestStartSequence?: number;
  readonly streamId?: string;
  readonly providerFunctionCode?: number;
  readonly reconcileCutoffSequence?: number;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

interface ReplayableWsEvent {
  readonly source: ObservedSource;
  readonly url: string;
  readonly body: string;
  readonly streamId: string;
  readonly recoveryGeneration?: number;
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

interface RetainedWsUsage {
  frames: number;
  bytes: number;
}

interface ObservedWebSocketState {
  source: ObservedSource;
  sourceGeneration: number;
  url: string;
  streamId: string;
  recoveryGeneration?: number;
  sessionId?: string;
  ksportRecovery?: KsportRecoveryGenerationTracker;
  ksportFrameTail?: Promise<void>;
  urgentKsportRecoveryStarted?: boolean;
  closing?: boolean;
}

interface WsAttachDiagnosticState {
  readonly sourceGeneration: number;
  webSocketCreated: number;
  ksportTargets: number;
  attachedTargets: number;
  // A source can create sockets and still forward nothing. These separate
  // "no frames arrive" from "frames arrive but are dropped before forwarding",
  // which are different faults with different fixes.
  framesReceived: number;
  framesOrphan: number;
  framesForwarded: number;
  ignoredSockets: number;
  // A frame can reach its socket and still never be forwarded. These name the
  // exact gate that consumed it, so the fault does not have to be guessed.
  framesBinary: number;
  framesNotOwner: number;
  framesUnattributed: number;
  framesNotActiveStream: number;
  framesDecoderFailed: number;
  // Classification only: the leading SockJS frame character and the decoder's
  // own reason code. No payload content is ever recorded.
  sockjsOpen: number;
  sockjsHeartbeat: number;
  sockjsArray: number;
  sockjsClose: number;
  sockjsOther: number;
  decoderFailCode: string;
  stompFrames: number;
  stompMessages: number;
  stompPartitionRejected: number;
  /** Which predicate refused a partition payload as a full snapshot, with counts. */
  snapshotRejections: string;
  stompPendingChars: number;
  stompCommandFragments: number;
  stompFragments: number;
  destLiveLike: number;
  destTodayLike: number;
  destSportsLike: number;
  subSportLike: number;
  // Target discovery shape: distinguishes "no child target is visible at all"
  // from "iframes are visible but none is on the provider host".
  targetsTotal: number;
  targetsIframe: number;
  autoAttachEvents: number;
  // Authority promotion needs a complete baseline: a full snapshot for both
  // partitions. These say which half is missing instead of leaving it to guesswork.
  baselineLive: number;
  baselineToday: number;
  baselineTabSelections: number;
  /** Last status the in-page time-tab selector returned, so a stale selector is
   *  distinguishable from a page that simply refused to re-emit its table. */
  baselineTabStatus: string;
  baselineTabTargets: number;
  /** Which selector step failed and how many nodes each step sees, so a renamed
   *  class is separable from a page that simply has no football group open. */
  baselineTabStep: string;
  baselineTabGroups: number;
  baselineTabScopes: number;
  baselineTabPeriods: number;
  baselineTabLabels: string;
}

interface PreexistingSocketReconnectState {
  readonly source: ObservedSource;
  readonly sourceGeneration: number;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
}

export interface PersistedSabaWsSnapshots {
  readonly version: 1;
  readonly sourceId: string;
  readonly documentMarker: string;
  readonly partitions: ReadonlyArray<{ readonly partition: string;
    readonly frames: ReadonlyArray<Omit<ReplayableWsEvent, "source">> }>;
}

export interface DirectHttpRequestMetadata {
  readonly method: ChromeBridgeHttpMethod;
  readonly providerPartition?: ProviderPartition;
  readonly providerContentIntent?: "FOOTBALL_FULL_CATALOG";
  readonly requestStartSequence?: number;
  readonly streamId?: string;
  readonly providerFunctionCode?: number;
  readonly reconcileCutoffSequence?: number;
  readonly verifiedDocument?: {
    readonly frameId: string;
    readonly loaderId: string;
    readonly sessionId?: string;
  };
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
      const semanticAttributeChanged = (mutation) => {
        if (mutation.type !== 'attributes' || !touchesOdds(mutation.target)) return false;
        if (mutation.attributeName !== 'class') return true;
        const disabled = (value) => /(?:^|\\s)(?:disabled|no-hover|suspended|locked)(?:\\s|$)/iu.test(String(value || ''));
        return disabled(mutation.oldValue) !== disabled(mutation.target?.getAttribute?.('class'));
      };
      if (mutations.some((mutation) => semanticAttributeChanged(mutation) ||
        (mutation.type !== 'attributes' && (touchesOdds(mutation.target) ||
          [...mutation.addedNodes].some(touchesOdds) || [...mutation.removedNodes].some(touchesOdds))))) {
        state.dirty = true;
      }
    });
    state.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeOldValue: true,
      attributeFilter: ['data-odds-status', 'data-grey-out', 'class', 'aria-disabled'] });
    globalThis[key] = state;
  }
  const dirty = state.dirty === true;
  state.dirty = false;
  return dirty;
})()`;

const SABA_ODDS_MUTATION_CLEANUP_EXPRESSION = `(() => {
  const observer = globalThis.__fieldlineSabaOddsMutationV1?.observer;
  try { if (observer) observer.disconnect(); } catch {}
  delete globalThis.__fieldlineSabaOddsMutationV1;
  return true;
})()`;

export const KSPORT_FOOTBALL_DISCOVERY_EXPRESSION = `(() => {
  const normalize = (value) => String(value || '').normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').trim().toLowerCase().replace(/\\s+/g, ' ');
  const primary = [...document.querySelectorAll('.sport-type-group-item')];
  const fallback = [...document.querySelectorAll(
    '[data-sport-id], [data-sport], button, [role="button"], [class*="sport-type"], [class*="sport-menu"]'
  )].filter((candidate) => {
    const text = normalize(candidate.textContent);
    return text.length > 0 && text.length < 80 && /^(?:bong da|football)(?:\\s|live|\\d|$)/u.test(text);
  });
  const controls = [...new Set([...primary, ...fallback])]
    .filter((control) => !control.classList.contains('sport-odds-boosts') &&
      !control.closest('.sport-odds-boosts, [class*="odds-boost"]'));
  const control = controls.find((candidate) => {
    const header = candidate.querySelector('.sport-type-item-header') || candidate;
    const text = normalize(header.textContent);
    return /^(?:bong da|football)(?:\\s|live|\\d|$)/u.test(text) && !/^(?:bong da|football)\\s*2(?:\\s|$)/u.test(text);
  });
  if (!control) return { status: 'football-control-not-found' };
  if (control.classList.contains('active-type')) return { status: 'football-active' };
  control.click();
  return { status: 'football-selected' };
})()`;

// The page renders its period tabs in the site language, so each tab is named
// in both. Measured 2026-08-26: the group step passed and the tab step failed
// with 24 period tabs present, none matching the Vietnamese label alone.
const KSPORT_TODAY_BASELINE_EXPRESSION = ksportTimeTabExpression(["hom nay", "today"]);
const KSPORT_LIVE_BASELINE_EXPRESSION = ksportTimeTabExpression(["truc tiep", "live"]);
// Used only when a partition is still missing: the tab may already be selected,
// and then nothing short of re-selecting it makes the page resend its table.
const KSPORT_TODAY_FORCE_EXPRESSION = ksportTimeTabExpression(["hom nay", "today"], true);
const KSPORT_LIVE_FORCE_EXPRESSION = ksportTimeTabExpression(["truc tiep", "live"], true);

export function ksportTimeTabExpressionForTest(labels: readonly string[], force = false): string {
  return ksportTimeTabExpression(labels, force);
}

function ksportTimeTabExpression(labels: readonly string[], force = false): string {
  return `(() => {
    const normalize = (value) => String(value || '').normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').trim().toLowerCase().replace(/\\s+/g, ' ');
    const group = [...document.querySelectorAll('.sport-type-group-item')].find((candidate) => {
      const header = candidate.querySelector('.sport-type-item-header') || candidate;
      const text = normalize(header.textContent);
      return !candidate.closest('.sport-odds-boosts, [class*="odds-boost"]') &&
        /^(?:bong da|football)(?:\\s|live|\\d|$)/u.test(text) && !/^(?:bong da|football)\\s*2(?:\\s|$)/u.test(text);
    });
    const groups = document.querySelectorAll('.sport-type-group-item').length;
    const scopes = document.querySelectorAll('.header-tab-content').length;
    const periods = document.querySelectorAll('.sport-menu-tab .period-item').length;
    const shape = { groups, scopes, periods };
    if (!group) return { status: 'time-tab-not-found', step: 'group', ...shape };
    const scope = group.closest('.header-tab-content');
    if (!scope) return { status: 'time-tab-not-found', step: 'scope', ...shape };
    const tab = [...scope.querySelectorAll('.sport-menu-tab .period-item')]
      .find((candidate) => {
        // Measured 2026-08-26: the live tab renders as "truc tiep42" because the
        // page appends a running-match count to the label text. Exact equality
        // therefore never matched. Accept the label followed only by that count.
        const text = normalize((candidate.querySelector('.period-tab') || candidate).textContent);
        return ${JSON.stringify(labels)}.some((name) => text === name ||
          (text.startsWith(name) && /^[\\s\\d]*$/u.test(text.slice(name.length))));
      });
    if (!tab) {
      // UI labels only, so the tab can be named instead of guessed: normalized,
      // letters/digits/spaces, each capped and at most eight reported.
      const seen = [...scope.querySelectorAll('.sport-menu-tab .period-item')]
        .map((candidate) => normalize((candidate.querySelector('.period-tab') || candidate).textContent))
        .map((value) => value.replace(/[^a-z0-9 ]+/g, '').slice(0, 24))
        .filter((value) => value.length > 0)
        .slice(0, 8);
      return { status: 'time-tab-not-found', step: 'tab', labels: seen, ...shape };
    }
    if (tab.classList.contains('active-period')) {
      if (!${JSON.stringify(force)}) return { status: 'time-tab-active' };
      // An already-selected tab produces no click, so the page never re-emits
      // its table and the feed never gets a complete baseline. Move to a
      // sibling period and come back, letting the page's own SPA rebuild the
      // subscription. Only period tabs are touched; no odds cell is involved.
      const sibling = [...scope.querySelectorAll('.sport-menu-tab .period-item')]
        .find((candidate) => candidate !== tab);
      if (!sibling) return { status: 'time-tab-active' };
      sibling.click();
      setTimeout(() => { try { tab.click(); } catch (error) { void error; } }, 400);
      return { status: 'time-tab-reselected' };
    }
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
      .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').trim().toLowerCase().replace(/\\s+/g, ' ');
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
      .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').trim().toLowerCase().replace(/\\s+/g, ' ');
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
  const beginSweep = () => {
    root.dataset.fieldlineCmdSweepId = 'cmd-sweep-' + Date.now();
    root.dataset.fieldlineCmdSweepComplete = 'false';
  };
  if (!/^cmd-sweep-\\d+$/u.test(root.dataset.fieldlineCmdSweepId || '')) beginSweep();
  const normalize = (value) => String(value || '').normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').trim().toLowerCase().replace(/\\s+/g, ' ');
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
  const sweepComplete = candidates.length > 0 && candidates.every((element) =>
    element.scrollTop >= element.scrollHeight - element.clientHeight - 4);
  for (const element of candidates) {
    const maximum = element.scrollHeight - element.clientHeight;
    const next = element.scrollTop >= maximum - 4 ? 0 :
      Math.min(maximum, element.scrollTop + Math.max(240, element.clientHeight * 0.8));
    if (next !== element.scrollTop) { element.scrollTop = next; moved += 1; }
  }
  if (sweepComplete) root.dataset.fieldlineCmdSweepComplete = 'true';
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
  return { moved, expanded, sweepId: root.dataset.fieldlineCmdSweepId,
    sweepComplete: root.dataset.fieldlineCmdSweepComplete === 'true' };
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
    const controllerKey = '__fieldlineImCatalogAbortV1';
    const priorController = window[controllerKey];
    if (priorController && typeof priorController.abort === 'function') priorController.abort();
    const controller = new AbortController();
    window[controllerKey] = controller;
    const requestTimer = setTimeout(() => controller.abort(), 8000);
    try {
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
        method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal,
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
    } catch (error) {
      if (controller.signal.aborted) return { status: 'request-timeout', responses: [] };
      return { status: 'request-failed', responses: [] };
    } finally {
      clearTimeout(requestTimer);
      if (window[controllerKey] === controller) delete window[controllerKey];
    }
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

// Observed provider startup contract: this exact function issues fc=1 and the
// provider callback atomically replaces both running and today before setting
// their full-data flags. It is deliberately invoked only in the known odds
// frame; no URL, filter, or tab navigation is changed.
export const CMD_FULL_BASELINE_EXPRESSION = `(() => {
  if (location.hostname !== 'cgnew.fts368.com' ||
    location.pathname !== '/Member/BetOdds/HdpDouble.aspx') return 'frame-unavailable';
  if (typeof globalThis.LoadFullRunningTodayData !== 'function') return 'function-unavailable';
  if (globalThis.RunningDataUpdating === true || globalThis.TodayDataUpdating === true) return 'busy';
  globalThis.LoadFullRunningTodayData();
  return 'baseline-requested';
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
  const detailWorkerKey = '__fieldlineBtiDetailWorkerV1';
  if (listResponses.length === listPaths.length && listResponses.every(Boolean)) {
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
    const nextJob = { generation, headers: { ...listHeaders }, eventIds: selected };
    const currentWorker = root[detailWorkerKey];
    if (currentWorker && typeof currentWorker.replace === 'function') {
      currentWorker.replace(nextJob);
    } else {
      // A worker from an older extension document cannot be cancelled, but it
      // must not retain ownership or delete the replacement when it settles.
      if (currentWorker) delete root[detailWorkerKey];
      const detailWorker = {
        generation,
        pending: nextJob,
        controller: null,
        replace(job) {
          if (this.generation === job.generation) return;
          this.generation = job.generation;
          this.pending = job;
          if (this.controller) this.controller.abort();
        }
      };
      root[detailWorkerKey] = detailWorker;
      detailWorker.promise = (async () => {
        while (root[detailWorkerKey] === detailWorker && detailWorker.pending) {
          const job = detailWorker.pending;
          detailWorker.pending = null;
          for (const eventId of job.eventIds) {
            if (detailWorker.pending) break;
            const controller = new AbortController();
            detailWorker.controller = controller;
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            try {
              const response = await fetch('/api/eventpage/events/' + encodeURIComponent(eventId) +
                '?hideX25X75Selections=false',
              { method: 'GET', credentials: 'include', cache: 'no-store', headers: job.headers,
                signal: controller.signal });
              if (typeof response?.arrayBuffer === 'function') await response.arrayBuffer();
              else if (typeof response?.text === 'function') await response.text();
              else if (typeof response?.json === 'function') await response.json();
            } catch { /* Detail enrichment must not invalidate the complete list generation. */ }
            finally {
              clearTimeout(timeoutId);
              if (detailWorker.controller === controller) detailWorker.controller = null;
            }
          }
        }
      })().finally(() => {
        if (root[detailWorkerKey] === detailWorker) delete root[detailWorkerKey];
      });
    }
  }
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
  readonly #cmdRecoveryMaxAttempts: number;
  readonly #cmdRecoveryDeadlineMs: number;
  readonly #cmdRecoveryRetryMs: number;
  readonly #observerSessionId: string;
  readonly #loadSabaWsSnapshots: NonNullable<NetworkObserverDependencies["loadSabaWsSnapshots"]>;
  readonly #saveSabaWsSnapshots: NetworkObserverDependencies["saveSabaWsSnapshots"];
  readonly #clearSabaWsSnapshots: NonNullable<NetworkObserverDependencies["clearSabaWsSnapshots"]>;
  readonly #workScheduler: ProviderWorkScheduler;
  readonly #sequences = new Map<string, number>();
  readonly #sourceGenerations = new Map<string, number>();
  readonly #tabGenerations = new Map<number, number>();
  readonly #publicSourceEpochs = new Map<string, { readonly sourceGeneration: number; readonly ordinal: number }>();
  #nextPublicEpochOrdinal = 0;
  readonly #activeWorkGenerations = new Map<string, number>();
  readonly #streamOrdinals = new Map<string, number>();
  readonly #emissionTails = new Map<string, Promise<void>>();
  readonly #webSockets = new Map<string, ObservedWebSocketState>();
  readonly #ignoredWebSockets = new Map<string, string>();
  readonly #socketBaselineRecoveryAtMs = new Map<string, number>();
  readonly #socketBaselineRecoveries = new Map<string, { readonly token: symbol;
    readonly operation: Promise<void> }>();
  readonly #sabaDomBootstrapAtMs = new Map<string, number>();
  readonly #sabaTodayCaptureAtMs = new Map<string, number>();
  readonly #requestPartitions = new Map<string, ImProviderPartition>();
  readonly #requestStreamIds = new Map<string, string>();
  readonly #requestFunctionCodes = new Map<string, number>();
  readonly #requestGenerations = new Map<string, number>();
  readonly #requestIdentities = new Map<string, { readonly method: ChromeBridgeHttpMethod;
    readonly observerRequestId: string; readonly observerRequestOrdinal: number;
    readonly tabGeneration: number; readonly frameId?: string; readonly loaderId?: string;
    readonly requestFrameKey?: string; readonly requestDocumentKey?: string }>();
  #nextObserverRequestOrdinal = 0;
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
  readonly #tsportCompletedSweepOrdinals = new Map<string, number>();
  readonly #catalogWsSnapshots = new Map<string, Map<string, ReplayableWsEvent[]>>();
  readonly #catalogWsSnapshotUsage = new Map<string, RetainedWsUsage>();
  readonly #activeKsportStreams = new Map<string, string>();
  readonly #ksportAuthorityTransitions = new Map<string, Promise<void>>();
  readonly #sabaReadySnapshotPartitions = new Set<string>();
  readonly #sabaSnapshotLoads = new Set<string>();
  readonly #sabaSnapshotStorageTails = new Map<string, Promise<void>>();
  readonly #sabaSnapshotSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #sabaSnapshotLastSavedAtMs = new Map<string, number>();
  readonly #sabaDocumentMarkers = new Map<string, string>();
  readonly #cmdCapturesInFlight = new Map<string, { readonly token: symbol; readonly operation: Promise<void> }>();
  readonly #imLastRecoveryAtMs = new Map<string, number>();
  readonly #catalogRefreshes = new Map<string, Promise<void>>();
  readonly #cmdRecoveryState = new CmdRecoveryState();
  readonly #cmdRecoveries = new Map<string, ActiveCmdRecovery>();
  readonly #cmdRecoveryRequests = new Map<string, symbol>();
  readonly #sabaDomPolls = new Map<string, Promise<void>>();
  readonly #sabaDomObserversCleaned = new Set<string>();
  readonly #ksportMaintenances = new Map<string, Promise<void>>();
  readonly #ksportBaselineChecks = new Map<string, Promise<boolean>>();
  readonly #snapshotReplays = new Map<string, Promise<boolean>>();
  readonly #imSnapshotOrdinals = new Map<string, number>();
  readonly #ksportSnapshotOrdinals = new Map<string, number>();
  readonly #startedTabs = new Set<number>();
  readonly #mainWorldContexts = new Map<number, Map<string, MainWorldContextBinding>>();
  readonly #observedChildSessions = new Map<string, Set<string>>();
  readonly #ksportAttachedTargetSessions = new Map<string, Map<string, string>>();
  readonly #wsAttachDiagnostics = new Map<string, WsAttachDiagnosticState>();
  readonly #preexistingSocketReconnects = new Map<string, PreexistingSocketReconnectState>();
  readonly #preexistingSocketReconnectSources = new Map<string, ObservedSource>();
  readonly #ksportDiagnosticAtMs = new Map<string, number>();
  readonly #ksportRefreshesInFlight = new Set<string>();
  readonly #ksportBaselineRequests = new Map<string, { readonly streamId: string;
    readonly recoveryGeneration: number; readonly requested: Map<"live" | "today", number>;
    attempts: number }>();
  readonly #ksportLiveRestored = new Set<string>();
  // Periodic KSPORT maintenance must stay non-destructive while the sportsbook
  // STOMP socket is alive. These clocks gate the heavier recovery paths.
  readonly #ksportCatalogFrameAtMs = new Map<string, number>();
  readonly #ksportHeartbeatForwardAtMs = new Map<string, number>();
  readonly #ksportBaselineAttemptAtMs = new Map<string, number>();
  readonly #ksportMaintenanceRecoveryAtMs = new Map<string, number>();
  readonly #ksportHttpFallbackModes = new Map<string, KsportHttpFallbackMode>();
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
    this.#cmdRecoveryMaxAttempts = dependencies.cmdRecoveryMaxAttempts ?? CMD_RECOVERY_MAX_ATTEMPTS;
    this.#cmdRecoveryDeadlineMs = dependencies.cmdRecoveryDeadlineMs ?? CMD_RECOVERY_DEADLINE_MS;
    this.#cmdRecoveryRetryMs = dependencies.cmdRecoveryRetryMs ?? CMD_RECOVERY_RETRY_MS;
    this.#observerSessionId = dependencies.observerSessionId ?? crypto.randomUUID();
    this.#loadSabaWsSnapshots = dependencies.loadSabaWsSnapshots ?? (async () => null);
    this.#saveSabaWsSnapshots = dependencies.saveSabaWsSnapshots;
    this.#clearSabaWsSnapshots = dependencies.clearSabaWsSnapshots ?? (async () => undefined);
    this.#workScheduler = dependencies.workScheduler ?? new ProviderWorkScheduler();
    if (!/^[a-z0-9._:-]{1,96}$/iu.test(this.#observerSessionId)) {
      throw new Error("OBSERVER_SESSION_ID_INVALID");
    }
    if (!Number.isSafeInteger(this.#cmdRecoveryMaxAttempts) || this.#cmdRecoveryMaxAttempts <= 0 ||
      !Number.isSafeInteger(this.#cmdRecoveryDeadlineMs) || this.#cmdRecoveryDeadlineMs <= 0 ||
      !Number.isSafeInteger(this.#cmdRecoveryRetryMs) || this.#cmdRecoveryRetryMs <= 0) {
      throw new Error("CMD_RECOVERY_BOUNDS_INVALID");
    }
  }

  /** Age of the last frame that proved this source's catalog socket alive. */
  ksportCatalogFrameAgeMs(sourceId: string, nowMs = this.#now()): number | null {
    const atMs = this.#ksportCatalogFrameAtMs.get(sourceId);
    return atMs === undefined ? null : nowMs - atMs;
  }

  hasCompleteKsportBaseline(sourceId: string): boolean {
    const activeStream = this.#activeKsportStreams.get(sourceId);
    if (activeStream === undefined) return false;
    const tracker = this.#ksportRecoveryForStream(sourceId, activeStream);
    if (tracker !== undefined) return tracker.currentBaselineState.complete;
    const frames = this.#catalogWsSnapshots.get(sourceId)?.get(activeStream);
    return frames !== undefined && ksportFramesContainCompleteBaseline(frames);
  }

  #ksportRecoveryForStream(sourceId: string,
    streamId: string): KsportRecoveryGenerationTracker | undefined {
    return [...this.#webSockets.values()].find((socket) => socket.source.sourceId === sourceId &&
      socket.streamId === streamId && socket.closing !== true &&
      this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration))?.ksportRecovery;
  }

  #activeKsportSocket(sourceId: string): [string, ObservedWebSocketState] | undefined {
    const activeStream = this.#activeKsportStreams.get(sourceId);
    if (activeStream === undefined) return undefined;
    return [...this.#webSockets.entries()].find(([, socket]) => socket.source.sourceId === sourceId &&
      socket.streamId === activeStream && socket.closing !== true &&
      this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration) &&
      (() => { try { return isKsportCatalogSocket(new URL(socket.url)); } catch { return false; } })());
  }

  async #activateKsportSocket(key: string, socket: ObservedWebSocketState,
    replaceExisting = false): Promise<boolean> {
    const sourceId = socket.source.sourceId;
    let activated = false;
    const previous = this.#ksportAuthorityTransitions.get(sourceId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      activated = await this.#commitKsportSocketActivation(key, socket, replaceExisting);
    });
    const settled = operation.finally(() => {
      if (this.#ksportAuthorityTransitions.get(sourceId) === settled) {
        this.#ksportAuthorityTransitions.delete(sourceId);
      }
    });
    this.#ksportAuthorityTransitions.set(sourceId, settled);
    await operation;
    return activated;
  }

  async #commitKsportSocketActivation(key: string, socket: ObservedWebSocketState,
    replaceExisting: boolean): Promise<boolean> {
    const sourceId = socket.source.sourceId;
    const activeStream = this.#activeKsportStreams.get(sourceId);
    if (activeStream === socket.streamId) {
      return socket.closing !== true && this.#webSockets.get(key) === socket &&
        this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration);
    }
    if (activeStream !== undefined && !replaceExisting) return false;
    if (socket.closing === true || this.#webSockets.get(key) !== socket ||
      !this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration)) return false;
    try {
      if (!isKsportCatalogSocket(new URL(socket.url))) return false;
    } catch { return false; }
    const retired = activeStream === undefined ? undefined : this.#activeKsportSocket(sourceId);
    if (retired !== undefined) {
      const [retiredKey, retiredSocket] = retired;
      retiredSocket.closing = true;
      this.#webSockets.delete(retiredKey);
      this.#rememberIgnoredWebSocket(sourceId, retiredKey);
    }
    this.#activeKsportStreams.set(sourceId, socket.streamId);
    this.#ksportBaselineRequests.delete(sourceId);
    this.#ksportLiveRestored.delete(sourceId);
    this.#ksportBaselineAttemptAtMs.delete(sourceId);
    this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
    this.#ksportHeartbeatForwardAtMs.delete(sourceId);
    this.#replaceCatalogWsSnapshots(sourceId, new Map());
    const durableRetirement = this.#scheduleSabaWsSnapshotClear(sourceId);
    if (retired !== undefined) {
      const [, retiredSocket] = retired;
      await retiredSocket.ksportFrameTail?.catch(() => undefined);
      if (this.#activeKsportStreams.get(sourceId) !== socket.streamId ||
        this.#webSockets.get(key) !== socket ||
        !this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration)) return false;
      const retiredRecoveryGeneration = retiredSocket.ksportRecovery?.currentGeneration ??
        retiredSocket.recoveryGeneration;
      await this.#emit(retiredSocket.source, retiredSocket.url, "WebSocket", "WS_STATE", {
        encoding: "UTF8", body: '{"state":"CLOSED"}'
      }, { request: { streamId: retiredSocket.streamId,
        ...(retiredRecoveryGeneration === undefined ? {} :
          { recoveryGeneration: retiredRecoveryGeneration }) },
        sourceGeneration: retiredSocket.sourceGeneration });
    }
    if (this.#activeKsportStreams.get(sourceId) !== socket.streamId ||
      this.#webSockets.get(key) !== socket ||
      !this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration)) return false;
    await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
      encoding: "UTF8", body: '{"state":"OPEN"}'
    }, { request: { streamId: socket.streamId,
      ...(socket.ksportRecovery === undefined ? {} :
        { recoveryGeneration: socket.ksportRecovery.currentGeneration }) },
      sourceGeneration: socket.sourceGeneration });
    await durableRetirement;
    return this.#activeKsportStreams.get(sourceId) === socket.streamId &&
      this.#webSockets.get(key) === socket;
  }

  #newerCompleteKsportSocketOwnsAuthority(sourceId: string, mode: KsportHttpFallbackMode): boolean {
    const active = this.#activeKsportSocket(sourceId)?.[1];
    if (active?.ksportRecovery === undefined || !this.hasCompleteKsportBaseline(sourceId)) return false;
    return mode.streamId === null || active.streamId !== mode.streamId || mode.recoveryGeneration === null ||
      active.ksportRecovery.currentGeneration > mode.recoveryGeneration;
  }

  #retireKsportHttpFallbackIfRecovered(sourceId: string): boolean {
    const mode = this.#ksportHttpFallbackModes.get(sourceId);
    if (mode === undefined || !this.#newerCompleteKsportSocketOwnsAuthority(sourceId, mode)) return false;
    this.#ksportHttpFallbackModes.delete(sourceId);
    return true;
  }

  #rememberIgnoredWebSocket(sourceId: string, key: string): void {
    let retained = 0;
    for (const ignoredSourceId of this.#ignoredWebSockets.values()) {
      if (ignoredSourceId === sourceId) retained += 1;
    }
    const diagnostic = this.#wsAttachDiagnostics.get(sourceId);
    if (diagnostic !== undefined) diagnostic.ignoredSockets = retained;
    // Auxiliary-socket churn must stay bounded, but marking the source as
    // permanently overflowed also discarded every later orphan frame for the
    // life of that source, which is how KSPORT went dark for hours. Evict the
    // oldest ignored key instead so the ledger stays capped and recoverable;
    // the orphan reconnect itself is rate-limited by its own retry interval.
    for (const [oldestKey, ignoredSourceId] of this.#ignoredWebSockets) {
      if (retained < KSPORT_IGNORED_SOCKETS_PER_SOURCE) break;
      if (ignoredSourceId !== sourceId) continue;
      this.#ignoredWebSockets.delete(oldestKey);
      retained -= 1;
    }
    this.#ignoredWebSockets.set(key, sourceId);
  }

  hasCompleteSabaBaseline(sourceId: string): boolean {
    for (const socket of this.#webSockets.values()) {
      if (socket.source.sourceId !== sourceId || socket.source.lobby !== "SABA" ||
        socket.closing === true ||
        !this.#isSourceGenerationCurrent(sourceId, socket.sourceGeneration)) continue;
      try {
        if (!/\/socket\.io\/?$/u.test(new URL(socket.url).pathname)) continue;
      } catch { continue; }
      const partitionPrefix = `${sourceId}|${socket.streamId}:`;
      for (const readyKey of this.#sabaReadySnapshotPartitions) {
        if (readyKey.startsWith(partitionPrefix)) return true;
      }
    }
    return false;
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
    const tracker = activeStream === undefined
      ? undefined : this.#ksportRecoveryForStream(source.sourceId, activeStream);
    const state = activeStream === undefined ? { live: false, today: false }
      : tracker?.currentBaselineState ??
        ksportBaselineState(frames ?? []);
    if (state.live && state.today) {
      this.#ksportBaselineRequests.delete(source.sourceId);
      this.#ksportBaselineAttemptAtMs.delete(source.sourceId);
      if (!this.#ksportLiveRestored.has(source.sourceId)) {
        if (await this.#selectTimeTab(source, KSPORT_LIVE_BASELINE_EXPRESSION)) {
          this.#ksportLiveRestored.add(source.sourceId);
        }
      }
      return true;
    }
    if (activeStream === undefined) return false;
    const recoveryGeneration = tracker?.currentGeneration ?? frames?.[0]?.recoveryGeneration ?? 0;
    let requests = this.#ksportBaselineRequests.get(source.sourceId);
    if (requests === undefined || requests.streamId !== activeStream ||
      requests.recoveryGeneration !== recoveryGeneration) {
      requests = { streamId: activeStream, recoveryGeneration, requested: new Map(), attempts: 0 };
      this.#ksportBaselineRequests.set(source.sourceId, requests);
    }
    const missing = !state.live ? "live" : "today";
    // Asking exactly once per generation left the partition permanently missing
    // whenever that single click did not produce a snapshot, and without both
    // partitions the feed can never be promoted. Retry on a bounded interval.
    const nowMs = this.#now();
    const requestedAtMs = requests.requested.get(missing);
    if (requestedAtMs !== undefined && nowMs - requestedAtMs < KSPORT_BASELINE_REQUEST_RETRY_MS) return false;
    if (requests.attempts >= KSPORT_BASELINE_REQUESTS_PER_GENERATION) return false;
    requests.attempts += 1;
    requests.requested.set(missing, nowMs);
    const selected = await this.#selectTimeTab(source,
      missing === "live" ? KSPORT_LIVE_FORCE_EXPRESSION : KSPORT_TODAY_FORCE_EXPRESSION);
    if (!selected) this.#ksportBaselineAttemptAtMs.set(source.sourceId, this.#now());
    return false;
  }

  /**
   * Visits SABA's day list long enough for its socket to publish the fixtures
   * that have not kicked off, then returns the lobby to the running ones. The
   * live view alone left SABA reporting 39 running fixtures and 3 upcoming
   * while BTI held the same day a median of twelve hours ahead, so nothing
   * could be paired.
   */
  async #captureSabaTodayBaseline(source: ObservedSource): Promise<void> {
    const nowMs = this.#now();
    const lastAtMs = this.#sabaTodayCaptureAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY;
    if (nowMs - lastAtMs < SABA_TODAY_CAPTURE_INTERVAL_MS) return;
    this.#sabaTodayCaptureAtMs.set(source.sourceId, nowMs);
    if (!await this.#selectTimeTab(source, SABA_TODAY_TAB_EXPRESSION)) return;
    try {
      await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
    } finally {
      // The lobby must never be left on a view the user did not choose, even if
      // the day's baseline never arrives.
      await this.#selectTimeTab(source, SABA_LIVE_TAB_EXPRESSION);
    }
  }

  async #selectTimeTab(source: ObservedSource, expression: string): Promise<boolean> {
    const diagnostic = this.#wsAttachDiagnostic(source);
    diagnostic.baselineTabSelections += 1;
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string }> = [];
    const activeStream = this.#activeKsportStreams.get(source.sourceId);
    const ownerSessionId = activeStream === undefined ? undefined : [...this.#webSockets.values()]
      .find((socket) => socket.source.sourceId === source.sourceId && socket.streamId === activeStream &&
        socket.closing !== true)?.sessionId;
    const contexts = [...(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])];
    if (ownerSessionId !== undefined) {
      for (const binding of contexts.filter((value) => value.sessionId === ownerSessionId)) {
        targets.push({ contextId: binding.contextId, sessionId: ownerSessionId });
      }
    }
    if (ownerSessionId !== undefined && !targets.some((target) => target.sessionId === ownerSessionId)) {
      targets.push({ sessionId: ownerSessionId });
    }
    for (const binding of contexts) {
      if (targets.some((target) => target.contextId === binding.contextId &&
        target.sessionId === binding.sessionId)) continue;
      targets.push({ contextId: binding.contextId,
        ...(binding.sessionId === undefined ? {} : { sessionId: binding.sessionId }) });
    }
    targets.push({});
    for (const sessionId of this.#ksportAttachedTargetSessions.get(source.sourceId)?.values() ?? []) {
      if (!targets.some((target) => target.sessionId === sessionId)) targets.push({ sessionId });
    }
    diagnostic.baselineTabTargets = targets.length;
    for (const target of targets) {
      const params = { expression, ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        returnByValue: true, awaitPromise: false };
      const evaluation = await this.#withFrameCommandTimeout(target.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, target.sessionId)).catch(() => null);
      const status = nestedValue(evaluation, "result", "value", "status");
      const step = nestedValue(evaluation, "result", "value", "step");
      if (typeof step === "string") diagnostic.baselineTabStep = step;
      for (const [field, key] of [["baselineTabGroups", "groups"],
        ["baselineTabScopes", "scopes"], ["baselineTabPeriods", "periods"]] as const) {
        const count = nestedValue(evaluation, "result", "value", key);
        if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
          diagnostic[field] = count;
        }
      }
      const labels = nestedValue(evaluation, "result", "value", "labels");
      if (Array.isArray(labels)) {
        diagnostic.baselineTabLabels = labels
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/[^a-z0-9 ]+/gu, "").slice(0, 24))
          .filter((value) => value.length > 0)
          .slice(0, 8)
          .join("|");
      }
      if (typeof status === "string") diagnostic.baselineTabStatus = status;
      else if (evaluation === null) diagnostic.baselineTabStatus = "EVALUATE_FAILED";
      if (status === "time-tab-selected" || status === "time-tab-active" ||
        status === "time-tab-reselected") return true;
    }
    return false;
  }

  async start(source: ObservedSource): Promise<void> {
    if (this.#startedTabs.has(source.tabId)) return;
    if (source.lobby === "KSPORT" || source.lobby === "TSPORT" ||
      source.lobby === "SABA") this.#wsAttachDiagnostic(source);
    if (source.lobby === "SABA" || source.lobby === "CMD" || source.lobby === "KSPORT") {
      // Runtime is sticky across MV3 workers. Reset the root domain before
      // reattaching child targets. SABA needs its OOPIF context replayed, while
      // CMD and KSPORT can keep their provider frames in the root target and
      // need those existing same-process main-world contexts replayed as well.
      await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Runtime.disable", {})
      );
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.enable", {}));
    }
    // MV3 may restart after an OOPIF was auto-attached by the previous worker.
    // Reset only the child-target observation boundary so Chrome emits fresh
    // session ids for already-existing sportsbook frames. This does not reload,
    // navigate, close or otherwise mutate the provider page.
    await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Target.setAutoAttach", {
      autoAttach: false, waitForDebuggerOnStart: false, flatten: true
    }));
    await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    }));
    await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Network.enable", {
      maxTotalBufferSize: 16 * 1024 * 1024,
      maxResourceBufferSize: 12 * 1024 * 1024,
      maxPostDataSize: 0
    }));
    if (source.lobby === "KSPORT" || source.lobby === "TSPORT" || source.lobby === "SABA") {
      this.#preexistingSocketReconnectSources.set(source.sourceId, source);
      this.#schedulePreexistingSocketReconnect(source);
    }
    if (source.lobby === "KSPORT") {
      await this.#discoverExistingKsportChildTargets(source);
    }
    if (source.lobby !== "SABA" && source.lobby !== "CMD" && source.lobby !== "KSPORT") {
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.enable", {}));
    }
    await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
      "Page.setLifecycleEventsEnabled", { enabled: true }));
    await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: source.lobby === "KSPORT" ? KSPORT_FOOTBALL_DISCOVERY_EXPRESSION : DISCOVERY_EXPRESSION,
      returnByValue: true,
      awaitPromise: false
    }));
    this.#startedTabs.add(source.tabId);
  }

  async stop(source: ObservedSource): Promise<void> {
    if (this.#startedTabs.has(source.tabId)) {
      await this.#sendCommand(source.tabId, "Network.disable", {}).catch(() => ({}));
    }
    this.releaseTab(source.tabId);
  }

  beginSourceEpoch(sourceId: string): string {
    this.#retireCmdRecovery(sourceId, "DOCUMENT_CHANGED");
    const priorGeneration = this.#sourceGenerations.get(sourceId) ?? 0;
    this.#publicSourceEpochOrdinal(sourceId, priorGeneration);
    const generation = priorGeneration + 1;
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
    this.#ksportSnapshotOrdinals.delete(sourceId);
    this.#tsportSnapshots.delete(sourceId);
    this.#tsportRequestUrls.delete(sourceId);
    this.#tsportCompletedSweepOrdinals.delete(sourceId);
    this.#clearCatalogWsSnapshots(sourceId);
    this.#activeKsportStreams.delete(sourceId);
    this.#ksportAuthorityTransitions.delete(sourceId);
    this.#socketBaselineRecoveryAtMs.delete(sourceId);
    this.#socketBaselineRecoveries.delete(sourceId);
    this.#sabaDomBootstrapAtMs.delete(sourceId);
    this.#sabaDomObserversCleaned.delete(sourceId);
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
    this.#observedChildSessions.delete(sourceId);
    this.#ksportAttachedTargetSessions.delete(sourceId);
    this.#wsAttachDiagnostics.delete(sourceId);
    this.#clearPreexistingSocketReconnect(sourceId);
    this.#ksportDiagnosticAtMs.delete(sourceId);
    this.#ksportRefreshesInFlight.delete(sourceId);
    this.#ksportBaselineRequests.delete(sourceId);
    this.#ksportLiveRestored.delete(sourceId);
    this.#ksportCatalogFrameAtMs.delete(sourceId);
    this.#ksportHeartbeatForwardAtMs.delete(sourceId);
    this.#ksportBaselineAttemptAtMs.delete(sourceId);
    this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
    this.#ksportHttpFallbackModes.delete(sourceId);
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
    for (const [key, ignoredSourceId] of this.#ignoredWebSockets) {
      if (ignoredSourceId === sourceId) this.#ignoredWebSockets.delete(key);
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
      for (const key of this.#requestFunctionCodes.keys()) {
        if (key.startsWith(`${tabId}:`)) this.#requestFunctionCodes.delete(key);
      }
      for (const key of this.#requestGenerations.keys()) {
        if (key.startsWith(`${tabId}:`)) this.#requestGenerations.delete(key);
      }
      for (const key of this.#requestIdentities.keys()) {
        if (key.startsWith(`${tabId}:`)) this.#requestIdentities.delete(key);
      }
    }
    void this.#scheduleSabaWsSnapshotClear(sourceId);
    return `${this.#observerSessionId}:${this.#publicSourceEpochOrdinal(sourceId, generation)}`;
  }

  releaseTab(tabId: number): void {
    this.#tabGenerations.set(tabId, this.#captureTabGeneration(tabId) + 1);
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
    for (const sourceId of this.#tsportRequestUrls.keys()) remember(sourceId);
    for (const sourceId of this.#catalogWsSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#sbobetEventRequests.keys()) remember(sourceId);
    for (const sourceId of this.#publicSourceEpochs.keys()) remember(sourceId);
    for (const sourceId of this.#sourceGenerations.keys()) remember(sourceId);
    for (const sourceId of this.#activeWorkGenerations.keys()) remember(sourceId);
    for (const sourceId of this.#preexistingSocketReconnectSources.keys()) remember(sourceId);
    for (const sourceId of this.#cmdRecoveries.keys()) remember(sourceId);
    for (const pending of this.#pending.values()) if (pending.source.tabId === tabId) remember(pending.source.sourceId);
    for (const socket of this.#webSockets.values()) if (socket.source.tabId === tabId) remember(socket.source.sourceId);
    for (const sourceId of sourceIds) {
      this.#retireCmdRecovery(sourceId, "RELEASED");
      this.beginSourceEpoch(sourceId);
      this.#publicSourceEpochs.delete(sourceId);
      this.#cmdSnapshots.delete(sourceId);
      this.#cmdLastBodies.delete(sourceId);
      this.#cmdLastSentAtMs.delete(sourceId);
      this.#cmdSnapshotHosts.delete(sourceId);
      this.#domSnapshotOrdinals.delete(sourceId);
      this.#httpSnapshots.delete(sourceId);
      this.#imSnapshotOrdinals.delete(sourceId);
      this.#ksportSnapshotOrdinals.delete(sourceId);
      this.#tsportSnapshots.delete(sourceId);
      this.#tsportRequestUrls.delete(sourceId);
      this.#clearCatalogWsSnapshots(sourceId);
      this.#activeKsportStreams.delete(sourceId);
      this.#ksportAuthorityTransitions.delete(sourceId);
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
      this.#observedChildSessions.delete(sourceId);
      this.#ksportAttachedTargetSessions.delete(sourceId);
      this.#wsAttachDiagnostics.delete(sourceId);
      this.#clearPreexistingSocketReconnect(sourceId);
      this.#preexistingSocketReconnectSources.delete(sourceId);
      this.#ksportDiagnosticAtMs.delete(sourceId);
      this.#ksportRefreshesInFlight.delete(sourceId);
      this.#ksportBaselineRequests.delete(sourceId);
      this.#ksportLiveRestored.delete(sourceId);
      this.#ksportCatalogFrameAtMs.delete(sourceId);
      this.#ksportBaselineAttemptAtMs.delete(sourceId);
      this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
      this.#ksportOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#sabaOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#socketBaselineRecoveries.delete(sourceId);
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
    for (const key of this.#requestFunctionCodes.keys()) {
      if (key.startsWith(`${tabId}:`)) this.#requestFunctionCodes.delete(key);
    }
    for (const key of this.#requestGenerations.keys()) {
      if (key.startsWith(`${tabId}:`)) this.#requestGenerations.delete(key);
    }
    for (const key of this.#requestIdentities.keys()) {
      if (key.startsWith(`${tabId}:`)) this.#requestIdentities.delete(key);
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
    if (this.hasCompleteSabaBaseline(source.sourceId)) {
      if (this.#sabaDomObserversCleaned.has(source.sourceId)) return;
      const evaluations: Array<Promise<unknown>> = [
        this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: SABA_ODDS_MUTATION_CLEANUP_EXPRESSION, returnByValue: true, awaitPromise: false
        })).catch(() => null)
      ];
      for (const binding of this.#mainWorldContexts.get(source.tabId)?.values() ?? []) {
        const params = { expression: SABA_ODDS_MUTATION_CLEANUP_EXPRESSION, contextId: binding.contextId,
          returnByValue: true, awaitPromise: false };
        evaluations.push(this.#withFrameCommandTimeout(binding.sessionId === undefined
          ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
          : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId)).catch(() => null));
      }
      const results = await Promise.all(evaluations);
      if (results.every((result) => nestedValue(result, "result", "value") === true) &&
        this.hasCompleteSabaBaseline(source.sourceId)) {
        this.#sabaDomObserversCleaned.add(source.sourceId);
      }
      return;
    }
    this.#sabaDomObserversCleaned.delete(source.sourceId);
    const evaluations: unknown[] = [];
    evaluations.push(await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
      expression: SABA_ODDS_MUTATION_EXPRESSION, returnByValue: true, awaitPromise: false
    })).catch(() => ({})));
    const contexts = [...(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])];
    for (const binding of contexts) {
      const params = { expression: SABA_ODDS_MUTATION_EXPRESSION, contextId: binding.contextId,
        returnByValue: true, awaitPromise: false };
      evaluations.push(await this.#withFrameCommandTimeout(binding.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId)).catch(() => ({})));
    }
    if (!evaluations.some((evaluation) => nestedValue(evaluation, "result", "value") === true)) return;
    await this.#capturePublicCatalogSnapshot(source, hostname, CMD_PUBLIC_CATALOG_EXPRESSION, false, true);
  }

  /**
   * KSPORT maintenance. This leaves a healthy live STOMP feed untouched. A
   * missing or quiet socket enters paired HTTP authority on the four-second
   * start cadence while targeted socket recovery remains independently paced;
   * a strictly newer complete socket generation retires that fallback mode.
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
    const quietMs = options.quietMs ?? KSPORT_QUIET_WINDOW_MS;
    const nowMs = this.#now();
    const activeStream = this.#activeKsportStreams.get(source.sourceId);
    const socketAlive = activeStream !== undefined && [...this.#webSockets.values()].some((socket) =>
      socket.source.sourceId === source.sourceId && socket.streamId === activeStream);
    const lastFrameAtMs = this.#ksportCatalogFrameAtMs.get(source.sourceId);
    const recentlyActive = lastFrameAtMs !== undefined && nowMs - lastFrameAtMs <= quietMs;
    const fallbackMode = this.#ksportHttpFallbackModes.get(source.sourceId);
    if (fallbackMode !== undefined) {
      if (this.#retireKsportHttpFallbackIfRecovered(source.sourceId)) return;
      await this.#refreshKsportHttpFallback(source, nowMs, fallbackMode);
      await this.#requestFreshSocketBaseline(source, isKsportCatalogSocket);
      return;
    }
    if (socketAlive && recentlyActive) {
      if (this.hasCompleteKsportBaseline(source.sourceId)) {
        this.#ksportBaselineRequests.delete(source.sourceId);
        this.#ksportBaselineAttemptAtMs.delete(source.sourceId);
        return;
      }
      const lastAttemptAtMs = this.#ksportBaselineAttemptAtMs.get(source.sourceId);
      const request = this.#ksportBaselineRequests.get(source.sourceId);
      if (lastAttemptAtMs === undefined || request === undefined || request.requested.size === 0) {
        if (lastAttemptAtMs !== undefined && nowMs - lastAttemptAtMs < KSPORT_HTTP_RECONCILE_INTERVAL_MS) return;
        this.#ksportBaselineAttemptAtMs.set(source.sourceId, nowMs);
        // Ask for the missing provider partition once on the exact socket
        // owner's document. A duplicate SUBSCRIBE is ambiguous on this socket,
        // so failed/partial attempts fall back to a paired HTTP generation.
        await this.#ensureCompleteKsportBaseline(source);
        return;
      }
      if (nowMs - lastAttemptAtMs < KSPORT_BASELINE_FALLBACK_DELAY_MS) return;
      await this.#refreshKsportHttpFallback(source, nowMs);
      return;
    }
    await this.#refreshKsportHttpFallback(source, nowMs);
    await this.#requestFreshSocketBaseline(source, isKsportCatalogSocket);
  }

  async #refreshKsportHttpFallback(source: ObservedSource, nowMs: number,
    mode?: KsportHttpFallbackMode): Promise<void> {
    const lastRecoveryAtMs = this.#ksportMaintenanceRecoveryAtMs.get(source.sourceId);
    if (lastRecoveryAtMs !== undefined &&
      nowMs - lastRecoveryAtMs < KSPORT_HTTP_RECONCILE_INTERVAL_MS) return;
    this.#ksportMaintenanceRecoveryAtMs.set(source.sourceId, nowMs);
    this.#ksportRefreshesInFlight.add(source.sourceId);
    try {
      const refreshed = await this.#requestFreshKsportHttpBaseline(source);
      if (!refreshed) return;
      if (mode === undefined) {
        const active = this.#activeKsportSocket(source.sourceId)?.[1];
        this.#ksportHttpFallbackModes.set(source.sourceId, {
          streamId: active?.streamId ?? null,
          recoveryGeneration: active?.ksportRecovery?.currentGeneration ?? null
        });
      }
    } finally {
      this.#ksportRefreshesInFlight.delete(source.sourceId);
    }
  }

  recoverCmdCatalog(source: ObservedSource): Promise<void> {
    if (source.lobby !== "CMD") return Promise.resolve();
    const existing = this.#cmdRecoveries.get(source.sourceId);
    if (existing !== undefined) return existing.done;

    const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
    const tabGeneration = this.#captureTabGeneration(source.tabId);
    const startedAtMs = this.#now();
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const active: ActiveCmdRecovery = {
      token: Symbol("cmd-recovery"), source, sourceGeneration, tabGeneration,
      deadlineAtMs: startedAtMs + this.#cmdRecoveryDeadlineMs,
      done, resolveDone, target: null, session: null, attemptWindow: false,
      baselineRequested: false, finished: false, deadlineTimer: null
    };
    this.#cmdRecoveries.set(source.sourceId, active);
    active.deadlineTimer = setTimeout(() => {
      active.session?.expire(active.deadlineAtMs);
      this.#finishCmdRecovery(active);
    }, this.#cmdRecoveryDeadlineMs);

    void this.#runPeriodicDomWork(source.sourceId, () => this.#runCmdRecovery(active))
      .catch(() => undefined)
      .finally(() => {
        if (!active.finished) active.session?.abort("ABORTED");
        this.#finishCmdRecovery(active);
        if (active.deadlineTimer !== null) clearTimeout(active.deadlineTimer);
        if (this.#cmdRecoveries.get(source.sourceId)?.token === active.token) {
          this.#cmdRecoveries.delete(source.sourceId);
        }
      });
    return done;
  }

  async #runCmdRecovery(active: ActiveCmdRecovery): Promise<void> {
    const target = await this.#resolveCmdRecoveryTarget(active);
    if (active.finished) return;
    if (target === null) {
      this.#finishCmdRecovery(active);
      return;
    }
    active.target = target;
    active.session = this.#cmdRecoveryState.begin(target.document, {
      nowMs: this.#now(), maxAttempts: this.#cmdRecoveryMaxAttempts,
      deadlineMs: Math.max(1, active.deadlineAtMs - this.#now())
    });

    while (!active.finished) {
      if (!await this.#cmdRecoveryTargetIsCurrent(active)) {
        active.session.abort("DOCUMENT_CHANGED");
        this.#finishCmdRecovery(active);
        return;
      }
      const step = active.session.nextAttempt(this.#now());
      if (step.kind === "RESOLVED") {
        this.#finishCmdRecovery(active);
        return;
      }
      if (step.kind === "WAITING") {
        await this.#waitForCmdRecovery(active, this.#cmdRecoveryRetryMs);
        continue;
      }

      active.attemptWindow = true;
      const evaluation = await this.#awaitCmdRecovery(active, this.#withFrameCommandTimeout(
        this.#sendCommand(active.source.tabId, "Runtime.evaluate", {
          expression: CMD_FULL_BASELINE_EXPRESSION, contextId: target.contextId,
          returnByValue: true, awaitPromise: false
        }, target.sessionId)
      ).catch(() => null));
      if (evaluation.kind === "FINISHED") return;
      if (!await this.#cmdRecoveryTargetIsCurrent(active)) {
        active.session.abort("DOCUMENT_CHANGED");
        this.#finishCmdRecovery(active);
        return;
      }
      const value = nestedValue(evaluation.value, "result", "value");
      active.attemptWindow = false;
      if (value !== "busy" && value !== "baseline-requested") {
        active.session.abort("ABORTED");
        this.#finishCmdRecovery(active);
        return;
      }
      if (value === "baseline-requested") active.baselineRequested = true;
      const resolution = active.session.recordPageResult(step.attempt, value, this.#now());
      if (resolution !== null) {
        this.#finishCmdRecovery(active);
        return;
      }
      await this.#waitForCmdRecovery(active, this.#cmdRecoveryRetryMs);
    }
  }

  async #resolveCmdRecoveryTarget(active: ActiveCmdRecovery): Promise<CmdRecoveryTarget | null> {
    if (!this.#cmdRecoveryIdentityIsCurrent(active)) return null;
    const frameTreeResult = await this.#awaitCmdRecovery(active, this.#withFrameCommandTimeout(
      this.#sendCommand(active.source.tabId, "Page.getFrameTree")
    ).catch(() => null));
    if (frameTreeResult.kind === "FINISHED" || frameTreeResult.value === null ||
      !this.#cmdRecoveryIdentityIsCurrent(active)) return null;
    const frames = collectCmdRecoveryFrameDescriptors(frameTreeResult.value);
    if (frames.length !== 1) return null;
    const frame = frames[0]!;
    const binding = this.#mainWorldContexts.get(active.source.tabId)?.get(frame.id);
    if (binding === undefined) return null;
    const { contextId, sessionId } = binding;
    const owningTree = await this.#awaitCmdRecovery(active, this.#withFrameCommandTimeout(
      this.#sendCommand(active.source.tabId, "Page.getFrameTree", {}, sessionId)
    ).catch(() => null));
    if (owningTree.kind === "FINISHED" || owningTree.value === null ||
      !this.#cmdRecoveryIdentityIsCurrent(active) ||
      currentFrameLoader(owningTree.value, frame.id) !== frame.loaderId ||
      this.#mainWorldContexts.get(active.source.tabId)?.get(frame.id)?.contextId !== contextId ||
      this.#mainWorldContexts.get(active.source.tabId)?.get(frame.id)?.sessionId !== sessionId) return null;
    return {
      document: { sourceId: active.source.sourceId,
        sourceEpoch: `${this.#observerSessionId}:${this.#publicSourceEpochOrdinal(
          active.source.sourceId, active.sourceGeneration)}`,
        frameId: frame.id, loaderId: frame.loaderId },
      sourceGeneration: active.sourceGeneration, tabGeneration: active.tabGeneration,
      contextId, ...(sessionId === undefined ? {} : { sessionId })
    };
  }

  async #cmdRecoveryTargetIsCurrent(active: ActiveCmdRecovery): Promise<boolean> {
    const target = active.target;
    if (target === null || !this.#cmdRecoveryIdentityIsCurrent(active) ||
      this.#mainWorldContexts.get(active.source.tabId)?.get(target.document.frameId)?.contextId !== target.contextId ||
      this.#mainWorldContexts.get(active.source.tabId)?.get(target.document.frameId)?.sessionId !==
        target.sessionId) return false;
    const frameTree = await this.#awaitCmdRecovery(active, this.#withFrameCommandTimeout(
      this.#sendCommand(active.source.tabId, "Page.getFrameTree", {}, target.sessionId)
    ).catch(() => null));
    return frameTree.kind === "VALUE" && frameTree.value !== null &&
      this.#cmdRecoveryIdentityIsCurrent(active) &&
      currentFrameLoader(frameTree.value, target.document.frameId) === target.document.loaderId;
  }

  #cmdRecoveryIdentityIsCurrent(active: ActiveCmdRecovery): boolean {
    return !active.finished && (this.#sourceGenerations.get(active.source.sourceId) ?? 0) ===
      active.sourceGeneration && this.#captureTabGeneration(active.source.tabId) === active.tabGeneration;
  }

  #finishCmdRecovery(active: ActiveCmdRecovery): void {
    if (active.finished) return;
    active.finished = true;
    active.attemptWindow = false;
    for (const [key, token] of this.#cmdRecoveryRequests) {
      if (token === active.token) this.#cmdRecoveryRequests.delete(key);
    }
    active.resolveDone();
  }

  #retireCmdRecovery(sourceId: string, reason: "DOCUMENT_CHANGED" | "RELEASED"): void {
    const active = this.#cmdRecoveries.get(sourceId);
    if (active !== undefined) {
      if (reason === "DOCUMENT_CHANGED") active.session?.abort("DOCUMENT_CHANGED");
      this.#finishCmdRecovery(active);
      if (active.deadlineTimer !== null) clearTimeout(active.deadlineTimer);
      if (this.#cmdRecoveries.get(sourceId)?.token === active.token) this.#cmdRecoveries.delete(sourceId);
    }
    // Remove the state-machine entry as part of the same synchronous lifetime
    // fence. A later refresh must never reuse a resolved session from the
    // retired document/tab.
    this.#cmdRecoveryState.release(sourceId);
  }

  #correlateCmdRecoveryRequest(source: ObservedSource, key: string, sessionId: string | undefined,
    frameId: unknown, loaderId: unknown, providerFunctionCode: number | undefined): void {
    const active = this.#cmdRecoveries.get(source.sourceId);
    const target = active?.target;
    if (active === undefined || target === undefined || target === null || active.finished || providerFunctionCode !== 1 ||
      (!active.attemptWindow && !active.baselineRequested) || sessionId !== target.sessionId ||
      frameId !== target.document.frameId || loaderId !== target.document.loaderId ||
      !this.#cmdRecoveryIdentityIsCurrent(active)) return;
    this.#cmdRecoveryRequests.set(key, active.token);
  }

  #completeCmdRecoveryRequest(token: symbol | undefined, pending: PendingRequest, body: string): void {
    if (token === undefined) return;
    const active = this.#cmdRecoveries.get(pending.source.sourceId);
    const target = active?.target;
    if (active === undefined || target === undefined || target === null || active.token !== token || active.finished ||
      pending.providerFunctionCode !== 1 || pending.sessionId !== target.sessionId ||
      pending.frameId !== target.document.frameId || pending.loaderId !== target.document.loaderId ||
      pending.sourceGeneration !== target.sourceGeneration || pending.tabGeneration !== target.tabGeneration ||
      !this.#cmdRecoveryIdentityIsCurrent(active) || !isCompleteCmdFullResponse(body)) return;
    const resolution = this.#cmdRecoveryState.complete({ document: target.document,
      providerFunctionCode: 1, responseComplete: true }, this.#now());
    if (resolution?.outcome === "SUCCESS") this.#finishCmdRecovery(active);
  }

  async #awaitCmdRecovery<T>(active: ActiveCmdRecovery, operation: Promise<T>): Promise<CmdRecoveryAwait<T>> {
    return Promise.race([
      operation.then((value) => ({ kind: "VALUE", value }) as const),
      active.done.then(() => ({ kind: "FINISHED" }) as const)
    ]);
  }

  async #waitForCmdRecovery(active: ActiveCmdRecovery, delayMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await this.#awaitCmdRecovery(active, new Promise<void>((resolve) => {
        timer = setTimeout(resolve, delayMs);
      }));
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async refreshCatalog(source: ObservedSource): Promise<void> {
    if (source.lobby === "CMD") return this.recoverCmdCatalog(source);
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
      const replayed = await this.#replayCatalogWsSnapshots(source.sourceId);
      if (!replayed) {
        await this.#restoreSabaWsSnapshots(source);
        await this.#replayCatalogWsSnapshots(source.sourceId);
      }
      const nowMs = this.#now();
      if (nowMs - (this.#sabaDomBootstrapAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) < 4_000) return;
      this.#sabaDomBootstrapAtMs.set(source.sourceId, nowMs);
      // Durable frames prime decoder state only. Always follow them with two
      // bounded current-document DOM generations; neither path is allowed to
      // establish or renew network authority. A fresh Socket.IO OPEN plus
      // reset/done remains the only SABA LIVE proof.
      await this.#capturePublicCatalogSnapshot(source, "saba.invalid", CMD_PUBLIC_CATALOG_EXPRESSION, true, true);
      await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
      await this.#captureSabaTodayBaseline(source);
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
      // A retained in-memory STOMP baseline can be hours old after the local
      // API restarts. Prefer a new same-tab getEvent generation and use
      // retained frames only as a fail-safe when the provider request is
      // temporarily unavailable. Never replace fresh evidence with replay.
      this.#ksportRefreshesInFlight.add(source.sourceId);
      try {
        if (await this.#requestFreshKsportHttpBaseline(source)) return;
      } finally {
        this.#ksportRefreshesInFlight.delete(source.sourceId);
      }
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      await this.#requestFreshSocketBaseline(source, isKsportCatalogSocket);
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
      const previousSweep = this.#tsportCompletedSweepOrdinals.get(source.sourceId) ?? 0;
      await this.#capturePublicCatalogSnapshot(source, "tsport.invalid",
        TSPORT_PUBLIC_CATALOG_EXPRESSION, false, true);
      if ((this.#tsportCompletedSweepOrdinals.get(source.sourceId) ?? 0) <= previousSweep) return;
      await this.#requestFreshSocketBaseline(source, isTsportEventSocket);
      return;
    }
    if (source.lobby !== "BTI") return;
    const frameTree = await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Page.getFrameTree")
      ).catch(() => ({}));
      const frameIds = collectFrameIds(frameTree);
      const frameDescriptors = collectFrameDescriptors(frameTree);
      // Always address the current top-level main world directly. Cached CDP
      // execution-context ids are invalidated on provider-side redirects and a
      // stale id otherwise makes every later refresh a silent no-op.
      const topEvaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
        expression: BTI_CATALOG_REFRESH_EXPRESSION, returnByValue: true, awaitPromise: true
      }), this.#btiCatalogRefreshTimeoutMs).catch(() => ({}));
      if (await this.#ingestBtiRefreshEvaluation(source, topEvaluation,
        verifiedDocumentForDescriptor(frameDescriptors[0]))) return;
      if (frameIds.length <= 1) return;
      let discoveryExpired = false;
      const evaluateChild = async (frameId: string): Promise<boolean> => {
        const mainWorld = this.#mainWorldContexts.get(source.tabId)?.get(frameId);
        if (mainWorld !== undefined) {
          const params = { expression: BTI_CATALOG_REFRESH_EXPRESSION, contextId: mainWorld.contextId,
            returnByValue: true, awaitPromise: true };
          const evaluation = await this.#withFrameCommandTimeout(mainWorld.sessionId === undefined
            ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
            : this.#sendCommand(source.tabId, "Runtime.evaluate", params, mainWorld.sessionId),
          this.#btiCatalogRefreshTimeoutMs).catch(() => ({}));
          return !discoveryExpired && this.#ingestBtiRefreshEvaluation(source, evaluation,
            verifiedDocumentForDescriptor(frameDescriptors.find((frame) => frame.id === frameId),
              mainWorld.sessionId));
        }
        const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
          "Page.createIsolatedWorld", {
          frameId, worldName: "fieldline-bti-catalog-refresh", grantUniveralAccess: false
        })).catch(() => ({}));
        const contextId = nestedNumber(world, "executionContextId");
        if (contextId === null || discoveryExpired) return false;
        const evaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: BTI_CATALOG_REFRESH_EXPRESSION, contextId, returnByValue: true, awaitPromise: true
        }), this.#btiCatalogRefreshTimeoutMs).catch(() => ({}));
        return !discoveryExpired && this.#ingestBtiRefreshEvaluation(source, evaluation,
          verifiedDocumentForDescriptor(frameDescriptors.find((frame) => frame.id === frameId)));
      };
      const discoverChildren = async (): Promise<void> => {
        const children = frameIds.slice(1);
        for (let index = 0; index < children.length && !discoveryExpired; index += 2) {
          const accepted = await Promise.all(children.slice(index, index + 2).map(evaluateChild));
          if (accepted.some(Boolean)) return;
        }
      };
      try {
        await this.#withFrameCommandTimeout(discoverChildren(), this.#btiCatalogRefreshTimeoutMs);
      } catch { /* A bounded refresh will retry on the next normal cadence. */ }
      finally { discoveryExpired = true; }
  }

  async #closeSocketsForSession(source: ObservedSource, sessionId: string): Promise<void> {
    const ownedSockets = [...this.#webSockets.entries()].filter(([, socket]) =>
      socket.source.sourceId === source.sourceId && socket.sessionId === sessionId && socket.closing !== true);
    // Fence the entire detached child session synchronously before awaiting a
    // single in-flight forward. No later event from that session may extend a
    // socket tail beyond the close operation's captured boundary.
    for (const [, socket] of ownedSockets) socket.closing = true;
    for (const [key, socket] of ownedSockets) {
      await socket.ksportFrameTail?.catch(() => undefined);
      if (this.#webSockets.get(key) !== socket ||
        !this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) continue;
      this.#webSockets.delete(key);
      const lifecycleRecoveryGeneration = socket.ksportRecovery?.currentGeneration ??
        socket.recoveryGeneration;
      await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
        encoding: "UTF8", body: '{"state":"CLOSED"}'
      }, { request: { streamId: socket.streamId,
        ...(lifecycleRecoveryGeneration === undefined ? {} :
          { recoveryGeneration: lifecycleRecoveryGeneration }) },
        sourceGeneration: socket.sourceGeneration });
      if (!this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) continue;
      if (socket.source.lobby === "KSPORT" &&
        this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId) {
        this.#activeKsportStreams.delete(socket.source.sourceId);
        this.#clearCatalogWsSnapshots(socket.source.sourceId);
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

  #scheduleFailedKsportSocketRecovery(key: string, socket: ObservedWebSocketState): void {
    // Attribution failure invalidates this one socket permanently. Claim its
    // urgent recovery synchronously so later frames cannot enqueue retries.
    // This path intentionally bypasses the provider work lane and the generic
    // five-second source cooldown: both can already be occupied by the recovery
    // attempt whose ambiguity caused the tracker to fail.
    if (socket.urgentKsportRecoveryStarted === true) return;
    socket.urgentKsportRecoveryStarted = true;
    void this.#recoverFailedKsportSocket(key, socket).catch(() => undefined);
  }

  async #recoverFailedKsportSocket(key: string, socket: ObservedWebSocketState): Promise<void> {
    let exactUrl: string;
    try {
      const parsed = new URL(socket.url);
      if (!isKsportCatalogSocket(parsed)) return;
      exactUrl = parsed.href;
    } catch { return; }
    const ownsSocket = (): boolean => socket.closing !== true &&
      socket.ksportRecovery?.failed === true && this.#webSockets.get(key) === socket &&
      this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration);
    if (!ownsSocket()) return;
    const sendToOwner = (method: string, params: Record<string, unknown>): Promise<unknown> =>
      socket.sessionId === undefined
        ? this.#sendCommand(socket.source.tabId, method, params)
        : this.#sendCommand(socket.source.tabId, method, params, socket.sessionId);
    const group = `fieldline-ksport-tracker-recovery-${socket.source.tabId}-${socket.streamId}`;
    try {
      const prototype = await this.#withFrameCommandTimeout(sendToOwner("Runtime.evaluate", {
        expression: "window.WebSocket && window.WebSocket.prototype",
        objectGroup: group, returnByValue: false
      })).catch(() => null);
      if (!ownsSocket()) return;
      const prototypeId = nestedValue(prototype, "result", "objectId");
      if (typeof prototypeId !== "string") return;
      const queried = await this.#withFrameCommandTimeout(sendToOwner("Runtime.queryObjects", {
        prototypeObjectId: prototypeId, objectGroup: group
      })).catch(() => null);
      if (!ownsSocket()) return;
      const instancesId = nestedValue(queried, "objects", "objectId");
      if (typeof instancesId !== "string") return;
      await this.#withFrameCommandTimeout(sendToOwner("Runtime.callFunctionOn", {
        objectId: instancesId,
        functionDeclaration: `function(expectedUrl) { for (const socket of this) { try {
          if (!socket || socket.readyState !== 1 || String(socket.url) !== expectedUrl) continue;
          socket.close(4000, "fieldline-baseline-recovery"); return 1;
        } catch {} } return 0; }`,
        arguments: [{ value: exactUrl }], returnByValue: true
      })).catch(() => null);
    } finally {
      await this.#withFrameCommandTimeout(sendToOwner("Runtime.releaseObjectGroup", {
        objectGroup: group
      })).catch(() => undefined);
    }
  }

  async #requestFreshSocketBaseline(source: ObservedSource, matches: (url: URL) => boolean): Promise<void> {
    const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
    const isCurrent = (): boolean => this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration);
    if (!isCurrent()) return;
    const nowMs = this.#now();
    const previous = this.#socketBaselineRecoveryAtMs.get(source.sourceId);
    if (previous !== undefined && nowMs - previous < 5_000) return;
    const active = [...this.#webSockets.values()].find((socket) => {
      if (socket.source.sourceId !== source.sourceId) return false;
      try { return matches(new URL(socket.url)); } catch { return false; }
    });
    if (active === undefined && source.lobby !== "SABA" && source.lobby !== "KSPORT" &&
      source.lobby !== "SBO" && source.lobby !== "TSPORT") return;
    if (!isCurrent()) return;
    this.#socketBaselineRecoveryAtMs.set(source.sourceId, nowMs);
    if (source.lobby === "TSPORT") {
      // CDP exposes WebSocket lifecycle events but no supported socket-close
      // command. Heap-wide Runtime.queryObjects takes tens of seconds on this
      // provider and continues running after our timeout, so soft recovery must
      // end here. The API's bounded hard stage reloads only this exact APSPORT
      // source and confirms a replacement epoch/generation before promotion.
      return;
    }
    const knownContexts = [...(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])];
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string }> =
      knownContexts.length > 0
        ? knownContexts.map((binding) => ({ contextId: binding.contextId,
            ...(binding.sessionId === undefined ? {} : { sessionId: binding.sessionId }) }))
        : [{ ...(active?.sessionId === undefined ? {} : { sessionId: active.sessionId }) }];
    if (active !== undefined && !targets.some((target) => target.contextId === undefined &&
      target.sessionId === active.sessionId)) {
      targets.push({ ...(active.sessionId === undefined ? {} : { sessionId: active.sessionId }) });
    }
    if (source.lobby === "KSPORT") {
      for (const sessionId of this.#ksportAttachedTargetSessions.get(source.sourceId)?.values() ?? []) {
        if (!targets.some((target) => target.contextId === undefined && target.sessionId === sessionId)) {
          targets.push({ sessionId });
        }
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
          if (!isCurrent()) return;
          const prototype = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.evaluate", {
            expression: strategy.prototypeExpression,
            ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
            objectGroup: group, returnByValue: false
          }), this.#frameCommandTimeoutMs).catch(() => null);
          if (!isCurrent()) return;
          const prototypeId = nestedValue(prototype, "result", "objectId");
          if (typeof prototypeId !== "string") continue;
          if (!isCurrent()) return;
          const queried = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.queryObjects", {
            prototypeObjectId: prototypeId, objectGroup: group
          }), source.lobby === "SABA" ? SABA_SOCKET_RECOVERY_QUERY_TIMEOUT_MS :
              this.#frameCommandTimeoutMs)
            .catch(() => null);
          if (!isCurrent()) return;
          const instancesId = nestedValue(queried, "objects", "objectId");
          if (typeof instancesId !== "string") continue;
          if (!isCurrent()) return;
          const result = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.callFunctionOn", {
            objectId: instancesId, functionDeclaration: strategy.reconnect, returnByValue: true
          })).catch(() => null);
          if (!isCurrent()) return;
          const count = nestedValue(result, "result", "value");
          if (typeof count === "number" && count > 0) return;
        }
      } finally {
        // Remote object handles belong to the target session, not to our
        // source epoch. Release them even if the epoch retired while a slow
        // heap query was pending; detached sessions simply reject safely.
        await this.#withFrameCommandTimeout(
          sendToSocketTarget("Runtime.releaseObjectGroup", { objectGroup: group })
        ).catch(() => undefined);
        // SABA heap discovery can legitimately take several seconds. Pace a
        // queued orphan recovery from completion so it cannot immediately
        // repeat the same expensive scan after waiting behind this operation.
        if (source.lobby === "SABA" && isCurrent()) {
          this.#socketBaselineRecoveryAtMs.set(source.sourceId, this.#now());
        }
      }
    }
  }

  async #observeChildTarget(source: ObservedSource, sessionId: string, targetId?: string,
    watchPreexistingSocket = false): Promise<void> {
    const observedSessions = this.#observedChildSessions.get(source.sourceId) ?? new Set<string>();
    if (observedSessions.has(sessionId)) return;
    observedSessions.add(sessionId);
    this.#observedChildSessions.set(source.sourceId, observedSessions);
    try {
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Network.enable", {
        maxTotalBufferSize: 16 * 1024 * 1024,
        maxResourceBufferSize: 12 * 1024 * 1024,
        maxPostDataSize: 0
      }, sessionId));
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.enable", {}, sessionId));
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Target.setAutoAttach", {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true
      }, sessionId));
      await this.#withFrameCommandTimeout(
        this.#sendCommand(source.tabId, "Runtime.runIfWaitingForDebugger", {}, sessionId)
      );
    } catch (error) {
      observedSessions.delete(sessionId);
      if (observedSessions.size === 0) this.#observedChildSessions.delete(source.sourceId);
      throw error;
    }
    if (source.lobby !== "KSPORT") return;
    if (targetId !== undefined) {
      const attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId) ?? new Map<string, string>();
      attachedTargets.set(targetId, sessionId);
      this.#ksportAttachedTargetSessions.set(source.sourceId, attachedTargets);
      if (watchPreexistingSocket) this.#schedulePreexistingSocketReconnect(source);
    }
  }

  async #discoverExistingKsportChildTargets(source: ObservedSource): Promise<void> {
    const discovered = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Target.getTargets")
    ).catch(() => ({}));
    const infos = isRecord(discovered) && Array.isArray(discovered.targetInfos)
      ? discovered.targetInfos : [];
    const matchingTargets = infos.slice(0, 32).filter((info) => {
      if (!isRecord(info) || info.type !== "iframe" || typeof info.targetId !== "string" ||
        typeof info.url !== "string") return false;
      try {
        const url = new URL(info.url);
        return url.protocol === "https:" && url.username === "" && url.password === "" &&
          isKsportProviderHost(url.hostname);
      } catch { return false; }
    });
    const diagnostic = this.#wsAttachDiagnostic(source);
    diagnostic.ksportTargets = matchingTargets.length;
    diagnostic.targetsTotal = infos.length;
    diagnostic.targetsIframe = infos.filter((info) => isRecord(info) && info.type === "iframe").length;
    for (const info of infos.slice(0, 32)) {
      if (!isRecord(info) || info.type !== "iframe" || typeof info.targetId !== "string" ||
        typeof info.url !== "string" ||
        this.#ksportAttachedTargetSessions.get(source.sourceId)?.has(info.targetId) === true) continue;
      try {
        const url = new URL(info.url);
        if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
          !isKsportProviderHost(url.hostname)) continue;
      } catch { continue; }
      const attached = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Target.attachToTarget", { targetId: info.targetId, flatten: true })).catch(() => ({}));
      const childSessionId = nestedValue(attached, "sessionId");
      if (typeof childSessionId !== "string") continue;
      await this.#observeChildTarget(source, childSessionId, info.targetId, true).catch(() => undefined);
    }
    diagnostic.attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId)?.size ?? 0;
  }

  #wsAttachDiagnostic(source: ObservedSource): WsAttachDiagnosticState {
    const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
    const existing = this.#wsAttachDiagnostics.get(source.sourceId);
    if (existing !== undefined && existing.sourceGeneration === sourceGeneration) return existing;
    const created: WsAttachDiagnosticState = {
      sourceGeneration, webSocketCreated: 0, ksportTargets: 0, attachedTargets: 0,
      framesReceived: 0, framesOrphan: 0, framesForwarded: 0, ignoredSockets: 0,
      framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0,
      framesDecoderFailed: 0, sockjsOpen: 0, sockjsHeartbeat: 0, sockjsArray: 0,
      sockjsClose: 0, sockjsOther: 0, decoderFailCode: "NONE",
      stompFrames: 0, stompMessages: 0, stompPartitionRejected: 0, snapshotRejections: "",
      stompPendingChars: 0, stompCommandFragments: 0, stompFragments: 0,
      destLiveLike: 0, destTodayLike: 0, destSportsLike: 0, subSportLike: 0,
      targetsTotal: 0, targetsIframe: 0, autoAttachEvents: 0,
      baselineLive: 0, baselineToday: 0, baselineTabSelections: 0,
      baselineTabStatus: "NONE", baselineTabTargets: 0, baselineTabStep: "NONE",
      baselineTabGroups: 0, baselineTabScopes: 0, baselineTabPeriods: 0, baselineTabLabels: ""
    };
    this.#wsAttachDiagnostics.set(source.sourceId, created);
    return created;
  }

  #schedulePreexistingSocketReconnect(source: ObservedSource): void {
    const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
    let state = this.#preexistingSocketReconnects.get(source.sourceId);
    if (state === undefined || state.sourceGeneration !== sourceGeneration) {
      if (state?.timer !== undefined) clearTimeout(state.timer);
      state = { source, sourceGeneration, attempts: 0, inFlight: false };
      this.#preexistingSocketReconnects.set(source.sourceId, state);
    }
    if (state.timer !== undefined || state.inFlight || state.attempts >= PREEXISTING_SOCKET_MAX_ATTEMPTS) return;
    const delayMs = state.attempts === 0 ? PREEXISTING_SOCKET_GRACE_MS : state.attempts === 1 ? 30_000 : 60_000;
    state.timer = setTimeout(() => {
      if (this.#preexistingSocketReconnects.get(source.sourceId) !== state) return;
      delete state.timer;
      void this.#runPreexistingSocketReconnect(state).catch(() => undefined);
    }, delayMs);
  }

  async #runPreexistingSocketReconnect(state: PreexistingSocketReconnectState): Promise<void> {
    const { source, sourceGeneration } = state;
    if (this.#preexistingSocketReconnects.get(source.sourceId) !== state || state.inFlight ||
      !this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration) ||
      state.attempts >= PREEXISTING_SOCKET_MAX_ATTEMPTS) return;
    state.inFlight = true;
    state.attempts += 1;
    try {
      const matches = source.lobby === "KSPORT" ? isKsportCatalogSocket :
        source.lobby === "TSPORT" ? isTsportEventSocket :
          (url: URL): boolean => /\/socket\.io\/?$/u.test(url.pathname);
      await this.#requestFreshSocketBaseline(source, matches);
    } catch { /* A bounded failed attempt is retried by the same backoff. */ }
    finally {
      state.inFlight = false;
    }
    if (this.#preexistingSocketReconnects.get(source.sourceId) === state &&
      this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) {
      this.#schedulePreexistingSocketReconnect(source);
    }
  }

  #clearPreexistingSocketReconnect(sourceId: string): void {
    const state = this.#preexistingSocketReconnects.get(sourceId);
    if (state?.timer !== undefined) clearTimeout(state.timer);
    this.#preexistingSocketReconnects.delete(sourceId);
  }

  #scheduleFreshSocketBaseline(source: ObservedSource, matches: (url: URL) => boolean): Promise<void> {
    const existing = this.#socketBaselineRecoveries.get(source.sourceId);
    if (existing !== undefined) return existing.operation;
    const token = Symbol(source.sourceId);
    const operation = this.#runPeriodicDomWork(source.sourceId,
      () => this.#requestFreshSocketBaseline(source, matches)).finally(() => {
        if (this.#socketBaselineRecoveries.get(source.sourceId)?.token === token) {
          this.#socketBaselineRecoveries.delete(source.sourceId);
        }
      });
    this.#socketBaselineRecoveries.set(source.sourceId, { token, operation });
    return operation;
  }

  async #requestFreshKsportHttpBaseline(source: ObservedSource): Promise<boolean> {
    const activeEntry = this.#activeKsportSocket(source.sourceId);
    if (activeEntry === undefined) return this.#requestFreshKsportHttpBaselineAfterDrain(source);
    const [key, socket] = activeEntry;
    const prior = socket.ksportFrameTail ?? Promise.resolve();
    let refreshed = false;
    const operation = prior.catch(() => undefined).then(async () => {
      const ownsSocket = this.#webSockets.get(key) === socket && socket.closing !== true &&
        this.#activeKsportStreams.get(source.sourceId) === socket.streamId &&
        this.#isSourceGenerationCurrent(source.sourceId, socket.sourceGeneration);
      if (!ownsSocket) return;
      const catalogAuthorityGeneration = socket.ksportRecovery?.catalogAuthorityGeneration ?? 0;
      refreshed = await this.#requestFreshKsportHttpBaselineAfterDrain(source,
        { key, socket, catalogAuthorityGeneration });
    });
    socket.ksportFrameTail = operation;
    await operation;
    return refreshed;
  }

  async #requestFreshKsportHttpBaselineAfterDrain(source: ObservedSource, fence?: {
    readonly key: string;
    readonly socket: ObservedWebSocketState;
    readonly catalogAuthorityGeneration: number;
  }): Promise<boolean> {
    const sourceGenerationAtStart = this.#captureSourceGeneration(source.sourceId);
    const template = this.#sbobetEventRequests.get(source.sourceId);
    let templateUrl: URL | null = null;
    if (template !== undefined) {
      try { templateUrl = new URL(template.url); } catch { return false; }
      if (templateUrl.protocol !== "https:" || templateUrl.pathname !== "/api/v2/getEvent" ||
        templateUrl.username !== "" || templateUrl.password !== "" ||
        !isKsportProviderHost(templateUrl.hostname)) return false;
    }
    const owner = fence?.socket;
    const targetSocket = owner ?? [...this.#webSockets.values()].find((socket) => {
      if (socket.source.sourceId !== source.sourceId) return false;
      if (socket.closing === true ||
        !this.#isSourceGenerationCurrent(source.sourceId, socket.sourceGeneration)) return false;
      try { return isKsportCatalogSocket(new URL(socket.url)); } catch { return false; }
    });
    const activeStreamAtStart = owner?.streamId ?? null;
    const recoveryGenerationAtStart = owner?.ksportRecovery?.currentGeneration ?? null;
    const attemptIsCurrent = (): boolean =>
      this.#isSourceGenerationCurrent(source.sourceId, sourceGenerationAtStart) &&
      (fence === undefined
        ? this.#activeKsportSocket(source.sourceId) === undefined
        : (this.#activeKsportStreams.get(source.sourceId) ?? null) === activeStreamAtStart &&
          (this.#ksportRecoveryForStream(source.sourceId, activeStreamAtStart!)?.currentGeneration ?? null) ===
            recoveryGenerationAtStart && this.#webSockets.get(fence.key) === fence.socket &&
          fence.socket.closing !== true &&
          (fence.socket.ksportRecovery?.catalogAuthorityGeneration ?? 0) ===
            fence.catalogAuthorityGeneration);
    const knownContexts = [...(this.#mainWorldContexts.get(source.tabId)?.entries() ?? [])];
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string;
      readonly frameId?: string }> = knownContexts.map(
      ([frameId, binding]) => ({ contextId: binding.contextId, frameId,
        ...(binding.sessionId === undefined ? {} : { sessionId: binding.sessionId }) }));
    if (targets.length === 0 && targetSocket !== undefined) targets.push({
      ...(targetSocket.sessionId === undefined ? {} : { sessionId: targetSocket.sessionId })
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
        if (contextId !== null) targets.push({ contextId, frameId });
      }
    }
    let attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId);
    if (attachedTargets === undefined) {
      attachedTargets = new Map<string, string>();
      this.#ksportAttachedTargetSessions.set(source.sourceId, attachedTargets);
    }
    if (attachedTargets.size === 0 && targetSocket === undefined) {
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
          if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
            !isKsportProviderHost(url.hostname)) continue;
        } catch { continue; }
        const attached = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
          "Target.attachToTarget", { targetId: info.targetId, flatten: true })).catch(() => ({}));
        const sessionId = nestedValue(attached, "sessionId");
        if (typeof sessionId !== "string") continue;
        attachedTargets.set(info.targetId, sessionId);
        await this.#observeChildTarget(source, sessionId, info.targetId).catch(() => undefined);
      }
    }
    for (const sessionId of attachedTargets.values()) targets.push({ sessionId });
    const expression = `(async () => {
      const marker = "fieldline-ksport-catalog-refresh";
      const isProviderHost = (hostname) => hostname === "sb21.net" || hostname.endsWith(".sb21.net");
      const capturedUrl = ${JSON.stringify(templateUrl?.href ?? null)};
      const performanceUrls = [...performance.getEntriesByType("resource")].map((entry) => entry.name)
        .filter((value) => { try { const url = new URL(value); return url.protocol === "https:" &&
          url.username === "" && url.password === "" && isProviderHost(url.hostname) &&
          url.pathname === "/api/v2/getEvent"; } catch { return false; } });
      const templateUrl = capturedUrl || performanceUrls.at(-1);
      if (!templateUrl) return { status: marker + "-template-missing", page: location.origin + location.pathname };
      const base = new URL(templateUrl);
      if (base.protocol !== "https:" || base.username !== "" || base.password !== "" ||
        !isProviderHost(base.hostname) || base.pathname !== "/api/v2/getEvent") {
        return { status: marker + "-url-invalid" };
      }
      const headers = ${JSON.stringify(template?.headers ?? {})};
      const responses = [];
      const exactUrls = new Map();
      for (const value of [capturedUrl, ...performanceUrls]) {
        if (!value) continue;
        const candidate = new URL(value);
        if (candidate.protocol !== "https:" || candidate.username !== "" || candidate.password !== "" ||
          !isProviderHost(candidate.hostname) || candidate.pathname !== "/api/v2/getEvent") continue;
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
      if (!attemptIsCurrent()) return false;
      const frameTree = await this.#withFrameCommandTimeout(target.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Page.getFrameTree")
        : this.#sendCommand(source.tabId, "Page.getFrameTree", {}, target.sessionId)).catch(() => ({}));
      const descriptors = collectFrameDescriptors(frameTree);
      const verifiedDocument = verifiedDocumentForDescriptor(target.frameId === undefined
        ? descriptors[0]
        : descriptors.find((frame) => frame.id === target.frameId), target.sessionId);
      const sequenceBeforeBoundary = this.#sequences.get(source.sourceId) ?? 0;
      await this.#emit(source, "https://sb21.net/__fieldline_ksport_http_recovery_start__",
        "Diagnostic", "TAB_STATE", { encoding: "UTF8",
          body: '{"kind":"KSPORT_HTTP_RECOVERY_START"}' });
      const sequenceAfterBoundary = this.#sequences.get(source.sourceId) ?? 0;
      if (sequenceAfterBoundary !== sequenceBeforeBoundary + 1) continue;
      const requestStartSequence = sequenceBeforeBoundary;
      const params = { expression, ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        returnByValue: true, awaitPromise: true };
      const evaluation = await this.#withFrameCommandTimeout(target.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, target.sessionId),
      15_000).catch(() => null);
      const value = nestedValue(evaluation, "result", "value");
      if (!attemptIsCurrent()) return false;
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
        if (origin.protocol !== "https:" || origin.username !== "" || origin.password !== "" ||
          !isKsportProviderHost(origin.hostname)) continue;
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
      if (accepted.size !== 2 || verifiedDocument === undefined) continue;
      if (!attemptIsCurrent()) return false;
      const ordinal = (this.#ksportSnapshotOrdinals.get(source.sourceId) ?? 0) + 1;
      this.#ksportSnapshotOrdinals.set(source.sourceId, ordinal);
      const generation = `ksport-http:${source.tabId}:${ordinal}`;
      for (const partition of ["live", "today"] as const) {
        if (!attemptIsCurrent()) return false;
        const response = accepted.get(partition)!;
        await this.ingestHttpResponse(source, response.url, "Fetch", response.body,
          { method: "GET", streamId: generation,
            providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
            providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence,
            ...(verifiedDocument === undefined ? {} : { verifiedDocument }) });
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

  async #ingestBtiRefreshEvaluation(source: ObservedSource, evaluation: unknown,
    verifiedDocument?: NonNullable<DirectHttpRequestMetadata["verifiedDocument"]>): Promise<boolean> {
    const value = nestedValue(evaluation, "result", "value");
    if (!isRecord(value) || value.status !== "catalog-requested" ||
      typeof value.generation !== "string" || !/^bti:\d{10,16}:\d{1,9}$/u.test(value.generation) ||
      typeof value.origin !== "string" || !Array.isArray(value.responses)) return false;
    let origin: URL;
    try { origin = new URL(value.origin); } catch { return false; }
    if (origin.protocol !== "https:" || origin.username !== "" || origin.password !== "") return false;
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
    if (unique.size !== allowedPaths.size) return false;
    for (const path of allowedPaths) {
      await this.ingestHttpResponse(source, new URL(path, origin).href, "Fetch", unique.get(path)!,
        { method: "GET", streamId: value.generation,
          ...(verifiedDocument === undefined ? {} : { verifiedDocument }) });
    }
    return true;
  }

  async #evaluateImCatalogMainWorlds(source: ObservedSource, awaitPromise: boolean): Promise<string[]> {
    let generation: string | undefined;
    let reconcileCutoffSequence: number | undefined;
    if (awaitPromise) {
      const ordinal = (this.#imSnapshotOrdinals.get(source.sourceId) ?? 0) + 1;
      this.#imSnapshotOrdinals.set(source.sourceId, ordinal);
      generation = `im:${source.tabId}:${ordinal}`;
      reconcileCutoffSequence = this.#sequences.get(source.sourceId) ?? 0;
      await this.#emit(source, "https://imsports.directsb.net/__fieldline_im_reconciliation_start__",
        "Diagnostic", "TAB_STATE", { encoding: "UTF8", body: "{}" },
        { request: { streamId: generation, reconcileCutoffSequence } });
    }
    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Page.getFrameTree")
    ).catch(() => ({}));
    const frameIds = collectFrameIds(frameTree);
    const frameDescriptors = collectFrameDescriptors(frameTree);
    const contexts = this.#mainWorldContexts.get(source.tabId);
    const evaluate = async (label: string, descriptor?: { readonly id: string;
      readonly loaderId: string | null }, binding?: MainWorldContextBinding): Promise<string> => {
      const verifiedDocument = verifiedDocumentForDescriptor(descriptor, binding?.sessionId);
      const params = { expression: IM_CATALOG_DISCOVERY_EXPRESSION,
        ...(binding === undefined ? {} : { contextId: binding.contextId }),
        returnByValue: true, awaitPromise };
      const response = await this.#withFrameCommandTimeout(binding?.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId),
      awaitPromise ? 20_000 : this.#frameCommandTimeoutMs).catch(() => null);
      const value = nestedValue(response, "result", "value");
      if (awaitPromise && isRecord(value) && Array.isArray(value.responses)) {
        for (const item of value.responses) {
          if (!isRecord(item) || (item.market !== 1 && item.market !== 2) || typeof item.body !== "string") continue;
          await this.ingestHttpResponse(source, "https://imsports.directsb.net/api/EventV6/GetSE", "Fetch",
            item.body, { method: "POST", providerPartition: item.market === 1 ? "IM_MARKET_1" : "IM_MARKET_2",
              ...(generation === undefined ? {} : { streamId: generation }),
              ...(verifiedDocument === undefined ? {} : { verifiedDocument }),
              reconcileCutoffSequence: reconcileCutoffSequence! });
        }
      }
      const status = isRecord(value) ? value.status : null;
      const safeValue = typeof status === "string" && /^(?:catalog-requested|rate-limited|token-unavailable|navigation-not-found|truc tiep|live|bong da|football)$/u
        .test(status) ? status : "unavailable";
      return `${label}:${safeValue}`;
    };
    const evaluations: Array<Promise<string>> = [evaluate("top", frameDescriptors[0])];
    for (const frameId of frameIds.slice(1)) {
      const binding = contexts?.get(frameId);
      if (binding === undefined) continue;
      evaluations.push(evaluate(frameId.slice(0, 64),
        frameDescriptors.find((frame) => frame.id === frameId), binding));
    }
    return Promise.all(evaluations);
  }

  async heartbeat(source: ObservedSource, hostname: string): Promise<void> {
    if (!/^[a-z0-9.-]+$/iu.test(hostname)) return;
    // SABA now visits its day list too, and without this its selector could
    // only be judged by whether the fixtures appeared - not by whether it
    // found the tab at all.
    const diagnostic = source.lobby === "KSPORT" || source.lobby === "TSPORT" ||
      source.lobby === "SABA"
      ? this.#wsAttachDiagnostic(source) : null;
    const webSockets = diagnostic === null ? 0 : [...this.#webSockets.values()].filter((socket) =>
      socket.source.sourceId === source.sourceId && socket.sourceGeneration === diagnostic.sourceGeneration).length;
    await this.#emit(source, `https://${hostname}/__fieldline_heartbeat__`, "Tab", "TAB_STATE", {
      encoding: "UTF8",
      body: diagnostic === null ? "{}" : JSON.stringify({ kind: "WS_ATTACH",
        sourceGeneration: diagnostic.sourceGeneration, webSocketCreated: diagnostic.webSocketCreated,
        webSockets, ksportTargets: diagnostic.ksportTargets, attachedTargets: diagnostic.attachedTargets,
        framesReceived: diagnostic.framesReceived, framesOrphan: diagnostic.framesOrphan,
        framesForwarded: diagnostic.framesForwarded, ignoredSockets: diagnostic.ignoredSockets,
        framesBinary: diagnostic.framesBinary, framesNotOwner: diagnostic.framesNotOwner,
        framesUnattributed: diagnostic.framesUnattributed,
        framesNotActiveStream: diagnostic.framesNotActiveStream,
        framesDecoderFailed: diagnostic.framesDecoderFailed,
        sockjsOpen: diagnostic.sockjsOpen, sockjsHeartbeat: diagnostic.sockjsHeartbeat,
        sockjsArray: diagnostic.sockjsArray, sockjsClose: diagnostic.sockjsClose,
        sockjsOther: diagnostic.sockjsOther, decoderFailCode: diagnostic.decoderFailCode,
        stompFrames: diagnostic.stompFrames, stompMessages: diagnostic.stompMessages,
        stompPartitionRejected: diagnostic.stompPartitionRejected,
        snapshotRejections: diagnostic.snapshotRejections,
        stompPendingChars: diagnostic.stompPendingChars,
        stompCommandFragments: diagnostic.stompCommandFragments,
        stompFragments: diagnostic.stompFragments, destLiveLike: diagnostic.destLiveLike,
        destTodayLike: diagnostic.destTodayLike, destSportsLike: diagnostic.destSportsLike,
        subSportLike: diagnostic.subSportLike, targetsTotal: diagnostic.targetsTotal,
        targetsIframe: diagnostic.targetsIframe, autoAttachEvents: diagnostic.autoAttachEvents,
        baselineLive: diagnostic.baselineLive, baselineToday: diagnostic.baselineToday,
        baselineTabSelections: diagnostic.baselineTabSelections,
        baselineTabStatus: diagnostic.baselineTabStatus,
        baselineTabTargets: diagnostic.baselineTabTargets, baselineTabStep: diagnostic.baselineTabStep,
        baselineTabGroups: diagnostic.baselineTabGroups, baselineTabScopes: diagnostic.baselineTabScopes,
        baselineTabPeriods: diagnostic.baselineTabPeriods,
        baselineTabLabels: diagnostic.baselineTabLabels })
    });
  }

  async emitWorkHealth(source: ObservedSource, health: {
    readonly kind: "WORK_HEALTH";
    readonly counters: Readonly<Record<string, number>>;
    readonly lastOutcome: Readonly<Record<string, unknown>> | null;
    readonly lastErrorCode: string | null;
    readonly inFlightAgeMs: number;
  }): Promise<void> {
    await this.#emit(source,
      `https://${source.lobby.toLocaleLowerCase("en")}.invalid/__fieldline_work_health__`,
      "Diagnostic", "TAB_STATE", { encoding: "UTF8", body: JSON.stringify(health) });
  }

  async handleEvent(source: ObservedSource, method: string, rawParams: unknown,
    sessionId?: string): Promise<void> {
    const params = isRecord(rawParams) ? rawParams : {};
    if (method === "Network.webSocketCreated" && (source.lobby === "KSPORT" || source.lobby === "TSPORT")) {
      this.#wsAttachDiagnostic(source).webSocketCreated += 1;
    }
    if (method === "Target.attachedToTarget") {
      const childSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isRecord(params.targetInfo) ? params.targetInfo : null;
      if (source.lobby === "KSPORT") this.#wsAttachDiagnostic(source).autoAttachEvents += 1;
      if (childSessionId !== null && targetInfo?.type === "iframe") {
        const targetId = typeof targetInfo.targetId === "string" ? targetInfo.targetId : undefined;
        await this.#observeChildTarget(source, childSessionId, targetId, true);
      }
      return;
    }
    if (method === "Target.detachedFromTarget") {
      // A destroyed sportsbook iframe never emits webSocketClosed for the
      // sockets it owned. Close them explicitly so the API retires that stream
      // instead of treating the silence as a healthy quiet feed.
      const childSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      if (childSessionId !== null) {
        const observedSessions = this.#observedChildSessions.get(source.sourceId);
        observedSessions?.delete(childSessionId);
        if (observedSessions?.size === 0) this.#observedChildSessions.delete(source.sourceId);
        const attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId);
        if (attachedTargets !== undefined) {
          for (const [targetId, attachedSessionId] of attachedTargets) {
            if (attachedSessionId === childSessionId) attachedTargets.delete(targetId);
          }
          if (attachedTargets.size === 0) this.#ksportAttachedTargetSessions.delete(source.sourceId);
        }
        const cmdRecovery = this.#cmdRecoveries.get(source.sourceId);
        if (cmdRecovery?.target?.sessionId === childSessionId) {
          this.#retireCmdRecovery(source.sourceId, "DOCUMENT_CHANGED");
        }
        const contexts = this.#mainWorldContexts.get(source.tabId);
        if (contexts !== undefined) {
          for (const [frameId, binding] of contexts) {
            if (binding.sessionId === childSessionId) contexts.delete(frameId);
          }
          if (contexts.size === 0) this.#mainWorldContexts.delete(source.tabId);
        }
        await this.#closeSocketsForSession(source, childSessionId);
      }
      return;
    }
    if (method === "Runtime.executionContextCreated") {
      const context = isRecord(params.context) ? params.context : null;
      const auxData = context && isRecord(context.auxData) ? context.auxData : null;
      const contextId = context && typeof context.id === "number" ? context.id : null;
      const frameId = auxData && typeof auxData.frameId === "string" ? auxData.frameId : null;
      if (contextId !== null && frameId !== null && auxData?.isDefault === true) {
        const contexts = this.#mainWorldContexts.get(source.tabId) ??
          new Map<string, MainWorldContextBinding>();
        contexts.set(frameId, { contextId, ...(sessionId === undefined ? {} : { sessionId }) });
        this.#mainWorldContexts.set(source.tabId, contexts);
      }
      return;
    }
    if (method === "Runtime.executionContextsCleared") {
      const contexts = this.#mainWorldContexts.get(source.tabId);
      if (contexts !== undefined) {
        for (const [frameId, binding] of contexts) {
          if (binding.sessionId === sessionId) contexts.delete(frameId);
        }
        if (contexts.size === 0) this.#mainWorldContexts.delete(source.tabId);
      }
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
      const cmdRecovery = this.#cmdRecoveries.get(source.sourceId);
      if (cmdRecovery?.target?.contextId === params.executionContextId &&
        cmdRecovery.target.sessionId === sessionId) {
        this.#retireCmdRecovery(source.sourceId, "DOCUMENT_CHANGED");
      }
      const contexts = this.#mainWorldContexts.get(source.tabId);
      if (contexts) {
        for (const [frameId, binding] of contexts) {
          if (binding.contextId === params.executionContextId && binding.sessionId === sessionId) {
            contexts.delete(frameId);
          }
        }
        if (contexts.size === 0) this.#mainWorldContexts.delete(source.tabId);
      }
      return;
    }
    const requestId = typeof params.requestId === "string" ? params.requestId : null;
    const key = requestId ? `${source.tabId}:${sessionId ?? "root"}:${requestId}` : null;

    if (key !== null && this.#ignoredWebSockets.has(key) &&
      (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived" ||
        method === "Network.webSocketClosed")) {
      if (method === "Network.webSocketClosed") this.#ignoredWebSockets.delete(key);
      return;
    }

    if (method === "Network.requestWillBeSent" && key) {
      this.#requestGenerations.set(key, this.#sourceGenerations.get(source.sourceId) ?? 0);
      const request = isRecord(params.request) ? params.request : null;
      const requestMethod = sanitizeHttpMethod(request?.method);
      const requestIdentity = this.#allocateObserverRequestIdentity();
      const requestDocument = requestDocumentBinding(this.#observerSessionId, source.tabId,
        this.#sourceGenerations.get(source.sourceId) ?? 0, sessionId,
        params.frameId, params.loaderId);
      if (requestMethod === null) this.#requestIdentities.delete(key);
      else this.#requestIdentities.set(key, { method: requestMethod, ...requestIdentity,
        tabGeneration: this.#captureTabGeneration(source.tabId),
        ...(requestDocument === null ? {} : requestDocument) });
      if (source.lobby === "CMD" && request !== null && typeof request.url === "string") {
        const functionCode = cmdProviderFunctionCode(request);
        if (functionCode === null) this.#requestFunctionCodes.delete(key);
        else this.#requestFunctionCodes.set(key, functionCode);
      } else this.#requestFunctionCodes.delete(key);
      this.#correlateCmdRecoveryRequest(source, key, sessionId, params.frameId, params.loaderId,
        this.#requestFunctionCodes.get(key));
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
          if (url.protocol === "https:" && url.username === "" && url.password === "" &&
            isKsportProviderHost(url.hostname) && url.pathname === "/api/v2/getEvent") {
            const rawHeaders = isRecord(request.headers) ? request.headers : {};
            const headers = Object.fromEntries(Object.entries(rawHeaders).flatMap(([name, value]) =>
              /^(?:cookie|host|content-length|accept-encoding|connection|origin|referer|user-agent|sec-|:)/iu.test(name) ||
                (typeof value !== "string" && typeof value !== "number") ? [] : [[name, String(value)]]));
            const template = { url: request.url, headers };
            this.#sbobetEventRequests.set(source.sourceId, template);
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

    if (method === "Network.webSocketCreated" && key !== null && requestId !== null &&
      typeof params.url === "string") {
      if (!isProviderCatalogWebSocket(source, params.url)) {
        if (source.lobby === "KSPORT") this.#rememberIgnoredWebSocket(source.sourceId, key);
        return;
      }
      const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
      const streamId = String((this.#streamOrdinals.get(source.sourceId) ?? 0) + 1);
      this.#streamOrdinals.set(source.sourceId, Number(streamId));
      let recoveryGeneration: number | undefined;
      let ksportRecovery: KsportRecoveryGenerationTracker | undefined;
      if (source.lobby === "KSPORT") {
        try {
          // Recovery generation is scoped by the canonical stream in the API.
          // A newly observed provider stream always starts baseline attempt 1;
          // it is not the unrelated tab-wide socket ordinal.
          if (isKsportCatalogSocket(new URL(params.url))) {
            ksportRecovery = new KsportRecoveryGenerationTracker();
            recoveryGeneration = ksportRecovery.currentGeneration;
          }
        } catch { /* malformed socket URL has no recovery authority */ }
      }
      this.#webSockets.set(key, { source, sourceGeneration, url: params.url, streamId,
        ...(recoveryGeneration === undefined ? {} : { recoveryGeneration }),
        ...(ksportRecovery === undefined ? {} : { ksportRecovery, ksportFrameTail: Promise.resolve(),
          ksportObservedFrameCount: 0 }),
        ...(sessionId === undefined ? {} : { sessionId }) });
      if (source.lobby === "SBO") {
        try {
          if (/\/socket\.io\/?$/u.test(new URL(params.url).pathname)) {
            this.#replaceCatalogWsSnapshots(source.sourceId, new Map());
          }
        } catch { /* malformed socket URL cannot be a catalog authority */ }
      }
      // KSPORT pages can open several /sport sockets in one document. An OPEN
      // alone is not ownership evidence: defer the public OPEN until this exact
      // socket sends or receives a recognized catalog subscription/receipt.
      if (ksportRecovery !== undefined) return;
      await this.#emit(source, params.url, "WebSocket", "WS_STATE", {
        encoding: "UTF8", body: '{"state":"OPEN"}'
      }, { request: { streamId,
        ...(recoveryGeneration === undefined ? {} : { recoveryGeneration }) }, sourceGeneration });
      return;
    }
    if (method === "Network.webSocketFrameSent" && key) {
      const socket = this.#webSockets.get(key);
      const response = isRecord(params.response) ? params.response : null;
      if (socket?.ksportRecovery !== undefined && socket.closing !== true &&
        response !== null && response.opcode !== 2 &&
        typeof response.payloadData === "string" &&
        this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) {
        const previousGeneration = socket.ksportRecovery.currentGeneration;
        const wasFailed = socket.ksportRecovery.failed;
        const observedGeneration = socket.ksportRecovery.observeSent(response.payloadData);
        if (observedGeneration !== null &&
          this.#activeKsportStreams.get(socket.source.sourceId) === undefined) {
          await this.#activateKsportSocket(key, socket);
        }
        const ownsAuthority = this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId;
        if (socket.ksportRecovery.failed && ownsAuthority) {
          this.#scheduleFailedKsportSocketRecovery(key, socket);
        }
        if (ownsAuthority && (socket.ksportRecovery.currentGeneration !== previousGeneration ||
          (!wasFailed && socket.ksportRecovery.failed))) {
          this.#ksportBaselineRequests.delete(socket.source.sourceId);
          this.#ksportLiveRestored.delete(socket.source.sourceId);
          this.#ksportBaselineAttemptAtMs.delete(socket.source.sourceId);
          if (this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId) {
            await this.#scheduleSabaWsSnapshotClear(socket.source.sourceId);
          }
        }
      }
      return;
    }
    if (method === "Network.webSocketClosed" && key) {
      const socket = this.#webSockets.get(key);
      if (socket !== undefined) {
        if (socket.closing === true) return;
        socket.closing = true;
        await socket.ksportFrameTail?.catch(() => undefined);
        if (!this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration) ||
          this.#webSockets.get(key) !== socket) return;
        if (socket.source.lobby === "KSPORT" &&
          this.#activeKsportStreams.get(socket.source.sourceId) !== socket.streamId) {
          this.#webSockets.delete(key);
          return;
        }
        const lifecycleRecoveryGeneration = socket.ksportRecovery?.currentGeneration ??
          socket.recoveryGeneration;
        await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
          encoding: "UTF8", body: '{"state":"CLOSED"}'
        }, { request: { streamId: socket.streamId,
          ...(lifecycleRecoveryGeneration === undefined ? {} :
            { recoveryGeneration: lifecycleRecoveryGeneration }) }, sourceGeneration: socket.sourceGeneration });
        const ownsSocket = (): boolean =>
          this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration) &&
          this.#webSockets.get(key) === socket;
        if (!ownsSocket()) return;
        if (socket.source.lobby === "KSPORT" &&
          this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId) {
          this.#activeKsportStreams.delete(socket.source.sourceId);
          this.#clearCatalogWsSnapshots(socket.source.sourceId);
          await this.#scheduleSabaWsSnapshotClear(socket.source.sourceId);
          if (!ownsSocket()) return;
        }
        if (socket.source.lobby === "SBO") {
          try {
            if (/\/socket\.io\/?$/u.test(new URL(socket.url).pathname)) {
              this.#clearCatalogWsSnapshots(socket.source.sourceId);
            }
          } catch { /* malformed socket URL cannot be a catalog authority */ }
        }
      }
      if (this.#webSockets.get(key) === socket && (socket === undefined ||
        this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration))) {
        this.#webSockets.delete(key);
      }
      return;
    }
    if (method === "Network.webSocketFrameReceived" && key) {
      const socket = this.#webSockets.get(key);
      const response = isRecord(params.response) ? params.response : null;
      this.#wsAttachDiagnostic(source).framesReceived += 1;
      if (!socket) {
        this.#wsAttachDiagnostic(source).framesOrphan += 1;
        // MV3 can restart while an existing Socket.IO connection survives.
        // CDP then delivers frames without replaying webSocketCreated, so use
        // that traffic as the signal to request a fresh in-page SABA baseline.
        if (source.lobby === "SABA") {
          // After an MV3 restart the old request id is unattributed. Never
          // forward that payload as a delta: reconnect only this provider's
          // Socket.IO instance once in the public source epoch so CDP observes
          // a new OPEN and complete reset/done baseline.
          const nowMs = this.#now();
          const lastAttemptAtMs = this.#sabaOrphanFrameRecoveryAtMs.get(source.sourceId);
          if (lastAttemptAtMs === undefined || nowMs - lastAttemptAtMs >= 5_000) {
            this.#sabaOrphanFrameRecoveryAtMs.set(source.sourceId, nowMs);
            await this.#scheduleFreshSocketBaseline(source,
              (url) => /\/socket\.io\/?$/u.test(url.pathname));
          }
        } else if (source.lobby === "SBO") {
          await this.#scheduleFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
        } else if (source.lobby === "KSPORT") {
          const payload = isRecord(params.response) && typeof params.response.payloadData === "string"
            ? params.response.payloadData : "";
          if (!isPotentialKsportCatalogPayload(payload)) return;
          // The sportsbook OOPIF opened its STOMP socket before this worker
          // enabled Network on that child session, so the frames cannot be
          // attributed to a stream. Ask the page to reconnect so the new socket
          // is observed from its creation. A single attempt per source lifetime
          // left the provider dark for hours whenever that attempt failed, so
          // retry on the same bounded interval SABA uses instead of latching.
          const nowMs = this.#now();
          const lastAttemptAtMs = this.#ksportOrphanFrameRecoveryAtMs.get(source.sourceId);
          if (lastAttemptAtMs === undefined ||
            nowMs - lastAttemptAtMs >= KSPORT_ORPHAN_FRAME_RETRY_MS) {
            this.#ksportOrphanFrameRecoveryAtMs.set(source.sourceId, nowMs);
            await this.#scheduleFreshSocketBaseline(source, isKsportCatalogSocket);
          }
        }
        return;
      }
      if (socket.closing === true) return;
      if (!response || typeof response.payloadData !== "string") return;
      if (!this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) return;
      const opcode = typeof response.opcode === "number" ? response.opcode : 1;
      const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
      if (socket.ksportRecovery !== undefined) {
        const ksportRecovery = socket.ksportRecovery;
        const payloadData = response.payloadData;
        // KSPORT recovery identity exists only for text STOMP traffic on the
        // exact canonical socket. Attribute synchronously in CDP arrival order,
        // then serialize the marker/cache/forward side effects behind the same
        // socket so async Runtime.evaluate cannot reorder provider receipts.
        if (opcode === 2) { this.#wsAttachDiagnostic(source).framesBinary += 1; return; }
        const ownsIdentity = (): boolean => socket.closing !== true &&
          this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration) &&
          this.#webSockets.get(key) === socket;
        const ownsSocket = (): boolean => ownsIdentity() &&
          this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId;
        if (!ownsIdentity()) { this.#wsAttachDiagnostic(source).framesNotOwner += 1; return; }
        // A frame arriving here proves the catalog socket is alive, whether or
        // not its receipt maps to a catalog partition. Marking liveness only on
        // a heartbeat or an already-forwarded frame deadlocked this deployment:
        // it sends no heartbeats, so the baseline request that yields the first
        // full snapshot was never allowed to run, and without that snapshot no
        // frame is ever forwarded. Jackpot traffic on the sibling stream is
        // excluded, exactly as the retained-frame path already excludes it.
        if (!payloadData.includes("destination:/topic/jackpot/")) {
          this.#ksportCatalogFrameAtMs.set(socket.source.sourceId, clocks.observedAtMs);
        }
        if (isKsportTransportHeartbeat(payloadData)) {
          if (!ownsSocket()) return;
          const prior = socket.ksportFrameTail ?? Promise.resolve();
          const operation = prior.catch(() => undefined).then(async () => {
            if (!ownsSocket()) return;
            this.#ksportCatalogFrameAtMs.set(socket.source.sourceId, clocks.observedAtMs);
            this.#clearPreexistingSocketReconnect(socket.source.sourceId);
            const lastForwardAtMs = this.#ksportHeartbeatForwardAtMs.get(socket.source.sourceId);
            if (ksportRecovery.currentBaselineState.complete &&
              (lastForwardAtMs === undefined ||
                clocks.observedAtMs - lastForwardAtMs >= KSPORT_HEARTBEAT_FORWARD_INTERVAL_MS)) {
              this.#ksportHeartbeatForwardAtMs.set(socket.source.sourceId, clocks.observedAtMs);
              await this.#emit(socket.source, socket.url, "WebSocket", "WS_FRAME", {
                encoding: "UTF8", body: payloadData
              }, { request: { streamId: socket.streamId,
                recoveryGeneration: ksportRecovery.currentGeneration }, ...clocks,
                sourceGeneration: socket.sourceGeneration });
            }
          });
          socket.ksportFrameTail = operation;
          await operation;
          return;
        }
        const wasFailed = ksportRecovery.failed;
        const frameDiagnostic = this.#wsAttachDiagnostic(source);
        const lead = payloadData.charAt(0);
        if (lead === "o") frameDiagnostic.sockjsOpen += 1;
        else if (lead === "h") frameDiagnostic.sockjsHeartbeat += 1;
        else if (lead === "a" || lead === "[") frameDiagnostic.sockjsArray += 1;
        else if (lead === "c") frameDiagnostic.sockjsClose += 1;
        else frameDiagnostic.sockjsOther += 1;
        if (wasFailed) frameDiagnostic.framesDecoderFailed += 1;
        const attributed = ksportRecovery.push(payloadData);
        // A STOMP decoder that has failed returns nothing for every later frame
        // on this socket. Gating its rebuild behind ownsSocket() meant a socket
        // whose decoder failed before it was ever promoted to the active stream
        // could never be rebuilt, so the provider stayed dark until the tab was
        // reloaded. Owning the source identity is enough to ask for a rebuild.
        if (ksportRecovery.failed) frameDiagnostic.decoderFailCode = ksportRecovery.failReason;
        const shape = ksportRecovery.frameShape;
        frameDiagnostic.stompFrames = shape.stompFrames;
        frameDiagnostic.stompMessages = shape.stompMessages;
        frameDiagnostic.stompPartitionRejected = shape.partitionRejected;
        frameDiagnostic.stompPendingChars = shape.pendingChars;
        frameDiagnostic.stompCommandFragments = shape.commandFragments;
        frameDiagnostic.stompFragments = shape.fragments;
        frameDiagnostic.destLiveLike = shape.destLiveLike;
        frameDiagnostic.destTodayLike = shape.destTodayLike;
        frameDiagnostic.destSportsLike = shape.destSportsLike;
        frameDiagnostic.subSportLike = shape.subSportLike;
        frameDiagnostic.snapshotRejections = shape.snapshotRejections;
        const baseline = ksportRecovery.currentBaselineState;
        frameDiagnostic.baselineLive = baseline.live ? 1 : 0;
        frameDiagnostic.baselineToday = baseline.today ? 1 : 0;
        if (ksportRecovery.failed && ownsIdentity()) {
          this.#scheduleFailedKsportSocketRecovery(key, socket);
        }
        if (!wasFailed && ksportRecovery.failed && ownsSocket()) {
          await this.#scheduleSabaWsSnapshotClear(socket.source.sourceId);
        }
        if (attributed.length === 0) { this.#wsAttachDiagnostic(source).framesUnattributed += 1; return; }
        const prior = socket.ksportFrameTail ?? Promise.resolve();
        const operation = prior.catch(() => undefined).then(async () => {
          if (!ownsIdentity()) return;
          if (this.#activeKsportStreams.get(socket.source.sourceId) !== socket.streamId &&
            !await this.#activateKsportSocket(key, socket, true)) {
            this.#wsAttachDiagnostic(source).framesNotActiveStream += 1;
            return;
          }
          if (!ownsSocket()) { this.#wsAttachDiagnostic(source).framesNotActiveStream += 1; return; }
          if (ksportRecovery.currentBaselineState.complete) {
            this.#retireKsportHttpFallbackIfRecovered(socket.source.sourceId);
          }
          await this.#sabaDocumentMarker(socket.source, socket.sessionId, socket.sourceGeneration);
          if (!ownsSocket()) return;
          for (const frame of attributed) {
            if (!ownsSocket()) return;
            this.#rememberCatalogWsFrame(socket.source, socket.url, frame.payload,
              socket.streamId, clocks, frame.recoveryGeneration);
            await this.#emit(socket.source, socket.url, "WebSocket", "WS_FRAME", {
              encoding: "UTF8", body: frame.payload
            }, { request: { streamId: socket.streamId,
              recoveryGeneration: frame.recoveryGeneration }, ...clocks,
              sourceGeneration: socket.sourceGeneration });
          }
        });
        socket.ksportFrameTail = operation;
        await operation;
        return;
      }
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
      }, { request: { streamId: socket.streamId,
        ...(socket.recoveryGeneration === undefined ? {} :
          { recoveryGeneration: socket.recoveryGeneration }) }, ...clocks,
        sourceGeneration: socket.sourceGeneration });
      return;
    }
    if (method === "Network.responseReceived" && key) {
      const response = isRecord(params.response) ? params.response : null;
      const resourceType = typeof params.type === "string" ? params.type : "";
      if (!response || !/^(?:XHR|Fetch)$/u.test(resourceType) || typeof response.url !== "string") return;
      const providerPartition = this.#requestPartitions.get(key);
      const streamId = this.#requestStreamIds.get(key);
      const providerFunctionCode = this.#requestFunctionCodes.get(key);
      const requestIdentity = this.#requestIdentities.get(key);
      if (requestIdentity === undefined) return;
      if (!isProviderCatalogHttpResponse(source, response.url, streamId, providerFunctionCode)) {
        this.#cmdRecoveryRequests.delete(key);
        this.#pending.delete(key);
        this.#requestPartitions.delete(key);
        this.#requestStreamIds.delete(key);
        this.#requestFunctionCodes.delete(key);
        this.#requestGenerations.delete(key);
        this.#requestIdentities.delete(key);
        return;
      }
      this.#pending.set(key, { source,
        sourceGeneration: this.#requestGenerations.get(key) ?? this.#sourceGenerations.get(source.sourceId) ?? 0,
        url: response.url, resourceType, ...requestIdentity,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(providerPartition === undefined ? {} : { providerPartition }),
        ...(streamId === undefined ? {} : { streamId }),
        ...(providerFunctionCode === undefined ? {} : { providerFunctionCode }) });
      return;
    }
    if (method === "Network.loadingFailed" && key) {
      this.#cmdRecoveryRequests.delete(key);
      this.#pending.delete(key);
      this.#requestPartitions.delete(key);
      this.#requestStreamIds.delete(key);
      this.#requestFunctionCodes.delete(key);
      this.#requestGenerations.delete(key);
      this.#requestIdentities.delete(key);
      return;
    }
    if (method === "Network.loadingFinished" && key) {
      const cmdRecoveryToken = this.#cmdRecoveryRequests.get(key);
      this.#cmdRecoveryRequests.delete(key);
      let pending = this.#pending.get(key);
      this.#pending.delete(key);
      this.#requestPartitions.delete(key);
      this.#requestStreamIds.delete(key);
      this.#requestFunctionCodes.delete(key);
      this.#requestGenerations.delete(key);
      this.#requestIdentities.delete(key);
      if (!pending || requestId === null) return;
      if (!this.#isPendingCurrent(pending)) return;
      let responseBodyRead = false;
      try {
        if (pending.providerPartition === undefined && isImGetSeUrl(pending.source, pending.url)) {
          const requestPostData = await (pending.sessionId === undefined
            ? this.#sendCommand(source.tabId, "Network.getRequestPostData", { requestId })
            : this.#sendCommand(source.tabId, "Network.getRequestPostData", { requestId }, pending.sessionId))
            .catch(() => ({}));
          if (!this.#isPendingCurrent(pending)) return;
          const postData = isRecord(requestPostData) && typeof requestPostData.postData === "string"
            ? requestPostData.postData : null;
          const providerPartition = postData === null ? null : imPartitionFromRequest(pending.source, {
            url: pending.url, postData
          });
          if (providerPartition !== null) pending = { ...pending, providerPartition };
        }
        const response = await this.#readResponseBody(source.tabId, requestId,
          isImGetSeUrl(pending.source, pending.url), pending.sessionId);
        if (!this.#isPendingCurrent(pending)) return;
        if (!isRecord(response) || typeof response.body !== "string") return;
        if (pending.requestDocumentKey !== undefined && !await this.#requestDocumentIsCurrent(pending)) return;
        if (!this.#isPendingCurrent(pending)) return;
        responseBodyRead = true;
        if (response.base64Encoded === true) {
          await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "BASE64", body: response.body
          }, { request: pendingRequestMetadata(pending),
            sourceGeneration: pending.sourceGeneration, tabGeneration: pending.tabGeneration });
          return;
        }
        const safeBody = redactNetworkBody(response.body);
        await this.#recoverMissingImBaseline(pending);
        if (!this.#isPendingCurrent(pending)) return;
        if (pending.requestDocumentKey !== undefined && !await this.#requestDocumentIsCurrent(pending)) return;
        if (!this.#isPendingCurrent(pending)) return;
        const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
        this.#rememberHttpSnapshot(pending, safeBody, clocks);
        const fragments = splitUtf8Text(safeBody, NETWORK_CHUNK_BODY_BYTES);
        if (fragments.length === 1) {
          await this.#emit(pending.source, pending.url, pending.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: safeBody
          }, { request: pendingRequestMetadata(pending), ...clocks,
            sourceGeneration: pending.sourceGeneration, tabGeneration: pending.tabGeneration });
          this.#completeCmdRecoveryRequest(cmdRecoveryToken, pending, safeBody);
          return;
        }
        if (pending.requestFrameKey === undefined || pending.requestDocumentKey === undefined) return;
        const snapshotId = networkSnapshotId(pending.source.tabId, pending.observerRequestOrdinal);
        const emissionPending = pending;
        const emissions = fragments.map((bodyFragment, chunkIndex) =>
          this.#emit(emissionPending.source, emissionPending.url, emissionPending.resourceType, "HTTP_RESPONSE", {
            encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex,
              chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment })
          }, { request: pendingRequestMetadata(emissionPending), ...clocks,
            sourceGeneration: emissionPending.sourceGeneration, tabGeneration: emissionPending.tabGeneration,
            beforeForward: () => this.#requestDocumentIsCurrent(emissionPending) }));
        await Promise.all(emissions);
        this.#completeCmdRecoveryRequest(cmdRecoveryToken, pending, safeBody);
      } catch {
        if (!responseBodyRead && isImGetSeUrl(pending.source, pending.url) &&
          this.#isPendingCurrent(pending)) {
          const encodedDataLength = typeof params.encodedDataLength === "number" &&
            Number.isSafeInteger(params.encodedDataLength) && params.encodedDataLength >= 0
            ? params.encodedDataLength : 0;
          await this.#emit(pending.source,
            "https://imsports.directsb.net/__fieldline_http_body_unavailable__", "Diagnostic", "TAB_STATE", {
              encoding: "UTF8",
              body: JSON.stringify({ path: "/api/EventV6/GetSE",
                ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }),
                encodedDataLength })
            }, { sourceGeneration: pending.sourceGeneration,
              tabGeneration: pending.tabGeneration }).catch(() => undefined);
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
    const recoveryGeneration = source.lobby === "KSPORT" ? 1 : undefined;
    const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
    if (opcode !== 2) {
      this.#rememberTsportWsEvent(source, url, payloadData, streamId, clocks);
      this.#rememberCatalogWsFrame(source, url, payloadData, streamId, clocks, recoveryGeneration);
    }
    await this.#emit(source, url, "WebSocket", "WS_FRAME", {
      encoding: opcode === 2 ? "BASE64" : "UTF8",
      body: payloadData
    }, { request: { streamId,
      ...(recoveryGeneration === undefined ? {} : { recoveryGeneration }) }, ...clocks, sourceGeneration });
  }

  async ingestHttpResponse(source: ObservedSource, url: string, resourceType: "XHR" | "Fetch",
    body: string, requestMetadata: DirectHttpRequestMetadata): Promise<void> {
    const requestIdentity = this.#allocateObserverRequestIdentity();
    if (!/^https?:\/\//iu.test(url)) return;
    const method = sanitizeHttpMethod(requestMetadata.method);
    if (method === null) return;
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    const tabGeneration = this.#captureTabGeneration(source.tabId);
    const verifiedDocument = requestMetadata.verifiedDocument;
    const requestDocument = verifiedDocument === undefined ? null : requestDocumentBinding(
      this.#observerSessionId, source.tabId, sourceGeneration, verifiedDocument.sessionId,
      verifiedDocument.frameId, verifiedDocument.loaderId);
    const pending: PendingRequest = { source, sourceGeneration, tabGeneration, url, resourceType, method,
      ...requestIdentity,
      ...(verifiedDocument?.sessionId === undefined ? {} : { sessionId: verifiedDocument.sessionId }),
      ...(requestDocument === null ? {} : requestDocument),
      ...(requestMetadata.providerPartition === undefined ? {} : { providerPartition: requestMetadata.providerPartition }),
      ...(requestMetadata.providerContentIntent === undefined ? {} :
        { providerContentIntent: requestMetadata.providerContentIntent }),
      ...(requestMetadata.requestStartSequence === undefined ? {} :
        { requestStartSequence: requestMetadata.requestStartSequence }),
      ...(requestMetadata.streamId === undefined ? {} : { streamId: requestMetadata.streamId }),
      ...(requestMetadata.providerFunctionCode === undefined ? {} :
        { providerFunctionCode: requestMetadata.providerFunctionCode }),
      ...(requestMetadata.reconcileCutoffSequence === undefined ? {} :
        { reconcileCutoffSequence: requestMetadata.reconcileCutoffSequence }) };
    const safeBody = redactNetworkBody(body);
    await this.#recoverMissingImBaseline(pending);
    if (!this.#isPendingCurrent(pending)) return;
    if (pending.requestDocumentKey !== undefined && !await this.#requestDocumentIsCurrent(pending)) return;
    if (!this.#isPendingCurrent(pending)) return;
    const clocks = { observedAtMs: this.#now(), receivedMonotonicMs: this.#monotonicNow() };
    this.#rememberHttpSnapshot(pending, safeBody, clocks);
    const fragments = splitUtf8Text(safeBody, NETWORK_CHUNK_BODY_BYTES);
    const sanitizedRequestMetadata = pendingRequestMetadata(pending);
    const request = Object.keys(sanitizedRequestMetadata).length === 0 ? {} : { request: sanitizedRequestMetadata };
    if (fragments.length === 1) {
      await this.#emit(source, url, resourceType, "HTTP_RESPONSE", { encoding: "UTF8", body: safeBody },
        { ...request, ...clocks, sourceGeneration, tabGeneration });
      return;
    }
    if (pending.requestFrameKey === undefined || pending.requestDocumentKey === undefined) return;
    const snapshotId = networkSnapshotId(source.tabId, pending.observerRequestOrdinal);
    const emissions = fragments.map((bodyFragment, chunkIndex) => this.#emit(source, url, resourceType, "HTTP_RESPONSE", {
        encoding: "UTF8",
        body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex, chunkCount: fragments.length,
          bodyEncoding: "UTF8", bodyFragment })
      }, { ...request, ...clocks, sourceGeneration, tabGeneration,
        beforeForward: () => this.#requestDocumentIsCurrent(pending) }));
    await Promise.all(emissions);
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
        const readFrameTree = () => this.#withFrameCommandTimeout(
          this.#sendCommand(source.tabId, "Page.getFrameTree")
        ).catch(() => ({}));
        const frameTree = await readFrameTree();
        const frames = collectFrameDescriptors(frameTree);
        const values: Array<{ readonly frameKey: string; readonly frameId: string | null;
          readonly loaderId: string | null; readonly documentKey: string | null;
          readonly value: unknown }> = [];
        if (frames.length === 0) {
          values.push({ frameKey: "top", frameId: null, loaderId: null, documentKey: null,
            value: await this.#withFrameCommandTimeout(
            this.#sendCommand(source.tabId, "Runtime.evaluate", {
              expression, returnByValue: true, awaitPromise: false
            })).catch(() => ({})) });
        } else {
          const frameValues = await Promise.all(frames.map(async (frame, frameIndex) => {
            const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
              "Page.createIsolatedWorld", {
              frameId: frame.id, worldName: "fieldline-read-only", grantUniveralAccess: false
            })).catch(() => ({}));
            const contextId = nestedNumber(world, "executionContextId");
            if (contextId === null) return null;
            if (frame.loaderId !== null &&
              currentFrameLoader(await readFrameTree(), frame.id) !== frame.loaderId) return null;
            const value = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
              expression, contextId, returnByValue: true, awaitPromise: false
            })).catch(() => ({}));
            if (frame.loaderId !== null &&
              currentFrameLoader(await readFrameTree(), frame.id) !== frame.loaderId) return null;
            const frameKey = safeFrameKey(frame.id, frameIndex);
            return { frameKey, frameId: frame.id, loaderId: frame.loaderId,
              documentKey: frame.loaderId === null ? null : sweepDocumentKey(this.#observerSessionId,
                source.tabId, sourceGeneration, frame.id, frame.loaderId), value };
          }));
          values.push(...frameValues.filter((value) => value !== null));
        }
        if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
        const frameCaptures = values.map(({ frameKey, frameId, loaderId, documentKey, value }) => {
          const evaluated = readEvaluationRecords(value);
          const sweepMarker = evaluated.find((item) => isRecord(item) && "__fieldlineSweep" in item);
          const sweepValue = isRecord(sweepMarker) && isRecord(sweepMarker.__fieldlineSweep)
            ? sweepMarker.__fieldlineSweep : null;
          const withoutSweep = evaluated.filter((item) => !isRecord(item) || !("__fieldlineSweep" in item));
          const catalogRecords = withoutSweep.filter((item) =>
            !isRecord(item) || !("__fieldlineDiagnostic" in item));
          const hasCatalog = catalogRecords.length > 0;
          const sweep = sweepValue !== null && typeof sweepValue.sweepId === "string" &&
            /^[a-z0-9._:-]{1,128}$/iu.test(sweepValue.sweepId) && typeof sweepValue.complete === "boolean" &&
            documentKey !== null
            ? { sweepId: sweepValue.sweepId, sweepComplete: sweepValue.complete,
              sweepFrameKey: frameKey, sweepDocumentKey: documentKey }
            : undefined;
          const records = hasCatalog ? catalogRecords : sweep?.sweepComplete === true ? [] : withoutSweep;
          return { frameKey, frameId, loaderId, records, hasCatalog, sweep };
        }).filter((capture) => capture.records.length > 0 || capture.sweep?.sweepComplete === true);
        const hasCatalog = frameCaptures.some((capture) => capture.hasCatalog);
        const eligibleFrames = hasCatalog ? frameCaptures.filter((capture) =>
          capture.hasCatalog || (source.lobby === "CMD" && capture.sweep?.sweepComplete === true)) : frameCaptures;
        if (eligibleFrames.length === 0) return;
        const tsportFrames = source.lobby === "TSPORT"
          ? eligibleFrames.filter((capture) => capture.sweep?.sweepComplete === true)
          : [];
        // TSPORT expected ids must describe one exact current document. Never
        // merge multiple frames or erase its frame/loader-bound sweep metadata.
        // An ambiguous multi-frame result fails closed until a later scan finds
        // the single football document.
        if (source.lobby === "TSPORT" && tsportFrames.length !== 1) return;
        const emissionCandidates = source.lobby === "CMD" ? eligibleFrames
          : source.lobby === "TSPORT" ? tsportFrames
          : [{ frameKey: "aggregate", frameId: null, loaderId: null,
              records: eligibleFrames.flatMap((capture) => capture.records), hasCatalog,
              sweep: undefined }];
        const emissionGroups = (await Promise.all(emissionCandidates.map(async (group) =>
          group.frameId !== null && group.loaderId !== null &&
            currentFrameLoader(await readFrameTree(), group.frameId) !== group.loaderId ? null : group)))
          .flatMap((group) => group === null ? [] : [group]);
        if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration) || emissionGroups.length === 0) return;
        const records = emissionGroups.flatMap((capture) => capture.records);
        const catalogBody = JSON.stringify(records);
        const semanticBody = JSON.stringify(emissionGroups.map((group) => ({
          frameKey: group.frameKey, records: group.records, sweep: group.sweep
        })));
        const nowMs = this.#now();
        const receivedMonotonicMs = this.#monotonicNow();
        const previous = this.#cmdLastBodies.get(source.sourceId);
        // Transport heartbeats only prove that the tab is attached. Renew the
        // unchanged catalog before the API freshness TTL expires so a quiet
        // market cannot be misclassified as a dead data source.
        if (!forceGeneration && previous === semanticBody && nowMs - (this.#cmdLastSentAtMs.get(source.sourceId) ?? 0)
          < CATALOG_REFRESH_INTERVAL_MS) {
          // An explicit TSPORT refresh still observed a current-document,
          // completed proof even when its catalog was semantically unchanged.
          // Record that observation so the caller can request a fresh exact
          // event socket without emitting duplicate DOM catalog bytes.
          if (source.lobby === "TSPORT") {
            this.#tsportCompletedSweepOrdinals.set(source.sourceId,
              (this.#tsportCompletedSweepOrdinals.get(source.sourceId) ?? 0) + 1);
          }
          return;
        }
        for (const group of emissionGroups) {
          const ordinal = (this.#domSnapshotOrdinals.get(source.sourceId) ?? 0) + 1;
          this.#domSnapshotOrdinals.set(source.sourceId, ordinal);
          const snapshotId = `cmd:${source.tabId}:${nowMs}:${ordinal}`;
          const chunks = chunkCmdSnapshot(group.records, snapshotId, undefined, group.sweep);
          for (const chunk of chunks) {
            if (group.frameId !== null && group.loaderId !== null &&
              currentFrameLoader(await readFrameTree(), group.frameId) !== group.loaderId) return;
            if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
            await this.#emit(source, `https://${hostname}/__fieldline_dom_snapshot__`, "DOM", "DOM_SNAPSHOT", {
              encoding: "UTF8", body: JSON.stringify(chunk)
            }, { observedAtMs: nowMs, receivedMonotonicMs, sourceGeneration });
          }
        }
        if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
        if (source.lobby === "TSPORT") {
          this.#tsportCompletedSweepOrdinals.set(source.sourceId,
            (this.#tsportCompletedSweepOrdinals.get(source.sourceId) ?? 0) + 1);
        }
        this.#cmdLastBodies.set(source.sourceId, semanticBody);
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

  async #evaluateCmdFullBaselineMainWorlds(source: ObservedSource): Promise<string[]> {
    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Page.getFrameTree")
    ).catch(() => ({}));
    const frameIds = collectFrameIds(frameTree);
    const contexts = this.#mainWorldContexts.get(source.tabId);
    const evaluate = async (label: string, binding?: MainWorldContextBinding): Promise<string> => {
      const params = { expression: CMD_FULL_BASELINE_EXPRESSION,
        ...(binding === undefined ? {} : { contextId: binding.contextId }),
        returnByValue: true, awaitPromise: false };
      const response = await this.#withFrameCommandTimeout(binding?.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId)).catch(() => null);
      const value = nestedValue(response, "result", "value");
      return typeof value === "string" && /^(?:baseline-requested|busy|frame-unavailable|function-unavailable)$/u
        .test(value) ? `${label}:${value}` : `${label}:unavailable`;
    };
    const evaluations: Array<Promise<string>> = [evaluate("top")];
    for (const frameId of frameIds.slice(1)) {
      const binding = contexts?.get(frameId);
      if (binding !== undefined) evaluations.push(evaluate(frameId.slice(0, 64), binding));
    }
    return Promise.all(evaluations);
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
          const binding = contexts?.get(frameId);
          if (binding === undefined) continue;
          const params = { expression, contextId: binding.contextId, returnByValue: true, awaitPromise: false };
          const result = await this.#withFrameCommandTimeout(binding.sessionId === undefined
            ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
            : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId),
          5_000).catch(() => ({}));
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
          const binding = contexts?.get(frameId);
          if (binding === undefined) return [];
          const params = { expression, contextId: binding.contextId, returnByValue: true, awaitPromise: true };
          return [this.#withFrameCommandTimeout(binding.sessionId === undefined
            ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
            : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId),
          20_000).catch(() => ({}))];
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
          const binding = contexts?.get(frameId);
          if (binding === undefined) continue;
          const params = { expression, contextId: binding.contextId, returnByValue: true, awaitPromise: true };
          const result = await this.#withFrameCommandTimeout(binding.sessionId === undefined
            ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
            : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId),
          8_000).catch(() => ({ result: { value: { ok: false, reason: "BTI_DETAIL_REQUEST_FAILED" } } }));
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
          }, { request: replayRequestMetadata(snapshot),
            observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
        } else {
          const snapshotId = `network-replay:${snapshot.source.tabId}:${snapshot.observerRequestOrdinal}`;
          for (const [chunkIndex, bodyFragment] of fragments.entries()) {
            await this.#emit(snapshot.source, snapshot.url, snapshot.resourceType, "HTTP_RESPONSE", {
              encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, snapshotId, chunkIndex,
                chunkCount: fragments.length, bodyEncoding: "UTF8", bodyFragment })
            }, { request: replayRequestMetadata(snapshot),
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
        let replayableSnapshots = snapshots;
        if (snapshots[0]?.source.lobby === "KSPORT") {
          const tracker = this.#ksportRecoveryForStream(sourceId, partition);
          if (tracker !== undefined) {
            const state = tracker.currentBaselineState;
            if (!state.complete) continue;
            replayableSnapshots = snapshots.filter((snapshot) =>
              snapshot.recoveryGeneration === tracker.currentGeneration);
          }
          // Tracker readiness describes the live socket, not the bounded replay
          // cache. Eviction may have removed one full partition, so validate the
          // retained current-generation evidence again before replaying it.
          if (!ksportFramesContainCompleteBaseline(replayableSnapshots)) continue;
        }
        for (const snapshot of replayableSnapshots) {
          await this.#emit(snapshot.source, snapshot.url, "WebSocket", "WS_FRAME", {
            encoding: "UTF8", body: snapshot.body
          }, { request: { streamId: snapshot.streamId, replayed: true,
            ...(snapshot.recoveryGeneration === undefined ? {} :
              { recoveryGeneration: snapshot.recoveryGeneration }) },
            observedAtMs: snapshot.observedAtMs, receivedMonotonicMs: snapshot.receivedMonotonicMs });
          replayed = true;
        }
      }
    }
    return replayed;
  }

  #clearCatalogWsSnapshots(sourceId: string): void {
    this.#catalogWsSnapshots.delete(sourceId);
    this.#catalogWsSnapshotUsage.delete(sourceId);
  }

  #replaceCatalogWsSnapshots(sourceId: string,
    partitions: Map<string, ReplayableWsEvent[]>): void {
    this.#catalogWsSnapshots.set(sourceId, partitions);
    this.#catalogWsSnapshotUsage.set(sourceId, this.#measureCatalogWsSnapshotUsage(partitions));
  }

  #measureCatalogWsSnapshotUsage(partitions: Map<string, ReplayableWsEvent[]>): RetainedWsUsage {
    const usage: RetainedWsUsage = { frames: 0, bytes: 0 };
    for (const frames of partitions.values()) {
      usage.frames += frames.length;
      for (const frame of frames) usage.bytes += frame.body.length;
    }
    return usage;
  }

  #catalogWsUsage(sourceId: string,
    partitions: Map<string, ReplayableWsEvent[]>): RetainedWsUsage {
    const retained = this.#catalogWsSnapshotUsage.get(sourceId);
    if (retained !== undefined) return retained;
    const measured = this.#measureCatalogWsSnapshotUsage(partitions);
    this.#catalogWsSnapshotUsage.set(sourceId, measured);
    return measured;
  }

  #subtractCatalogWsFrames(usage: RetainedWsUsage, frames: readonly ReplayableWsEvent[]): void {
    usage.frames -= frames.length;
    for (const frame of frames) usage.bytes -= frame.body.length;
  }

  #rememberCatalogWsFrame(source: ObservedSource, url: string, body: string, streamId: string,
    clocks: { readonly observedAtMs: number; readonly receivedMonotonicMs: number },
    recoveryGeneration?: number): void {
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
      this.#clearPreexistingSocketReconnect(source.sourceId);
    }
    const existingPartitions = this.#catalogWsSnapshots.get(source.sourceId);
    const partitions = existingPartitions ?? new Map<string, ReplayableWsEvent[]>();
    const usage = existingPartitions === undefined
      ? { frames: 0, bytes: 0 }
      : this.#catalogWsUsage(source.sourceId, partitions);
    if (existingPartitions === undefined) this.#catalogWsSnapshotUsage.set(source.sourceId, usage);
    const readyKey = `${source.sourceId}|${partition}`;
    if (startsBaseline && source.lobby === "SABA") {
      const retired = partitions.get(partition);
      if (retired !== undefined) this.#subtractCatalogWsFrames(usage, retired);
      partitions.set(partition, []);
      this.#sabaReadySnapshotPartitions.delete(readyKey);
    }
    const retained = partitions.get(partition);
    if (retained === undefined && source.lobby === "SABA") {
      if (existingPartitions === undefined) this.#catalogWsSnapshotUsage.delete(source.sourceId);
      return;
    }
    const frames = retained ?? [];
    frames.push({ source, url, body, streamId,
      ...(recoveryGeneration === undefined ? {} : { recoveryGeneration }), ...clocks });
    usage.frames += 1;
    usage.bytes += body.length;
    partitions.set(partition, frames);
    if (source.lobby === "SABA" && completesBaseline && sabaFramesContainCompleteBaseline(frames)) {
      this.#sabaReadySnapshotPartitions.add(readyKey);
    }
    // Appends update source usage in O(1). Frames are ordered within each
    // partition, so capacity eviction only compares partition heads.
    while (usage.frames > 2_048 || usage.bytes > 24_000_000) {
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
        this.#subtractCatalogWsFrames(usage, removed);
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
      usage.frames -= 1;
      usage.bytes -= evicted.body.length;
      if (bucket.length === 0) partitions.delete(oldestKey);
    }
    this.#catalogWsSnapshots.set(source.sourceId, partitions);
    if (source.lobby === "SABA" && this.#sabaReadySnapshotPartitions.has(readyKey)) {
      this.#scheduleSabaWsSnapshotSave(source.sourceId, completesBaseline);
    }
  }

  async #restoreSabaWsSnapshots(source: ObservedSource): Promise<void> {
    if (source.lobby !== "SABA") return;
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
        const recoveryGeneration = typeof frame.recoveryGeneration === "number" &&
          Number.isSafeInteger(frame.recoveryGeneration) && frame.recoveryGeneration > 0
          ? frame.recoveryGeneration : undefined;
        frames.push({ source, url: frame.url, body: frame.body, streamId: frame.streamId,
          ...(recoveryGeneration === undefined ? {} : { recoveryGeneration }),
          observedAtMs: frame.observedAtMs, receivedMonotonicMs: frame.receivedMonotonicMs });
      }
      if (frames.length === 0 || !sabaFramesContainCompleteBaseline(frames)) continue;
      if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return;
      restored.set(candidate.partition, frames);
      this.#sabaReadySnapshotPartitions.add(`${source.sourceId}|${candidate.partition}`);
    }
    if (restored.size > 0) this.#replaceCatalogWsSnapshots(source.sourceId, restored);
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
      if (frames[0]?.source.lobby !== "SABA" ||
        !this.#sabaReadySnapshotPartitions.has(`${sourceId}|${partition}`)) return [];
      return [{ partition, frames: frames.map(({ source: _source, ...frame }) => frame) }];
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
    this.#clearCatalogWsSnapshots(sourceId);
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
    if (!isTsportEventSocket(parsedUrl)) return;
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
    if (pending.requestFrameKey === undefined || pending.requestDocumentKey === undefined ||
      pending.source.lobby !== "IM" || url.hostname !== "imsports.directsb.net" ||
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
      method: pending.method, observerRequestId: pending.observerRequestId,
      observerRequestOrdinal: pending.observerRequestOrdinal,
      requestFrameKey: pending.requestFrameKey, requestDocumentKey: pending.requestDocumentKey,
      ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }),
      ...(pending.streamId === undefined ? {} : { streamId: pending.streamId }),
      ...(pending.providerFunctionCode === undefined ? {} : { providerFunctionCode: pending.providerFunctionCode }),
      ...(pending.reconcileCutoffSequence === undefined ? {} :
        { reconcileCutoffSequence: pending.reconcileCutoffSequence }), ...clocks });
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
      readonly request?: EmissionRequestMetadata;
      readonly observedAtMs?: number;
      readonly receivedMonotonicMs?: number;
      readonly sourceGeneration?: number;
      readonly tabGeneration?: number;
      readonly beforeForward?: () => Promise<boolean>;
    } = {}
  ): Promise<void> {
    const sourceGeneration = metadata.sourceGeneration ?? this.#captureSourceGeneration(source.sourceId);
    const tabGeneration = metadata.tabGeneration ?? this.#captureTabGeneration(source.tabId);
    const previous = this.#emissionTails.get(source.sourceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if ((this.#sourceGenerations.get(source.sourceId) ?? 0) !== sourceGeneration ||
        this.#captureTabGeneration(source.tabId) !== tabGeneration) return;
      if (metadata.beforeForward !== undefined && !await metadata.beforeForward()) return;
      if ((this.#sourceGenerations.get(source.sourceId) ?? 0) !== sourceGeneration ||
        this.#captureTabGeneration(source.tabId) !== tabGeneration) return;
      const sequence = this.#sequences.get(source.sourceId) ?? 0;
      try {
        const redacted = redactNetworkEnvelope({
          version: 1,
          kind: "NETWORK",
          ...source,
          sourceEpoch: `${this.#observerSessionId}:${this.#publicSourceEpochOrdinal(source.sourceId, sourceGeneration)}`,
          sequence,
          observedAtMs: metadata.observedAtMs ?? this.#now(),
          receivedMonotonicMs: metadata.receivedMonotonicMs ?? this.#monotonicNow(),
          transport,
          request: { url, resourceType, ...metadata.request },
          payload
        }) as ChromeBridgeEnvelope;
        await this.#forward(redacted);
        if (transport === "WS_FRAME") {
          this.#wsAttachDiagnostic(source).framesForwarded += 1;
          this.#clearPreexistingSocketReconnect(source.sourceId);
        }
        if ((this.#sourceGenerations.get(source.sourceId) ?? 0) === sourceGeneration &&
          this.#captureTabGeneration(source.tabId) === tabGeneration) {
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

  #allocateObserverRequestIdentity(): { readonly observerRequestId: string;
    readonly observerRequestOrdinal: number } {
    if (this.#nextObserverRequestOrdinal >= Number.MAX_SAFE_INTEGER) {
      throw new Error("OBSERVER_REQUEST_ORDINAL_EXHAUSTED");
    }
    const observerRequestOrdinal = this.#nextObserverRequestOrdinal;
    this.#nextObserverRequestOrdinal += 1;
    return { observerRequestId: `${this.#observerSessionId}:request:${observerRequestOrdinal}`,
      observerRequestOrdinal };
  }

  #publicSourceEpochOrdinal(sourceId: string, sourceGeneration: number): number {
    const current = this.#publicSourceEpochs.get(sourceId);
    if (current?.sourceGeneration === sourceGeneration) return current.ordinal;
    const ordinal = this.#nextPublicEpochOrdinal;
    this.#nextPublicEpochOrdinal += 1;
    this.#publicSourceEpochs.set(sourceId, { sourceGeneration, ordinal });
    return ordinal;
  }

  #isSourceGenerationCurrent(sourceId: string, generation: number): boolean {
    return (this.#sourceGenerations.get(sourceId) ?? 0) === generation;
  }

  #captureTabGeneration(tabId: number): number {
    return this.#tabGenerations.get(tabId) ?? 0;
  }

  #isPendingCurrent(pending: PendingRequest): boolean {
    return this.#isSourceGenerationCurrent(pending.source.sourceId, pending.sourceGeneration) &&
      this.#captureTabGeneration(pending.source.tabId) === pending.tabGeneration;
  }

  async #requestDocumentIsCurrent(pending: PendingRequest): Promise<boolean> {
    if (pending.frameId === undefined || pending.loaderId === undefined ||
      pending.requestFrameKey === undefined || pending.requestDocumentKey === undefined) return false;
    const frameTree = await (pending.sessionId === undefined
      ? this.#sendCommand(pending.source.tabId, "Page.getFrameTree")
      : this.#sendCommand(pending.source.tabId, "Page.getFrameTree", {}, pending.sessionId))
      .catch(() => null);
    return this.#isPendingCurrent(pending) && frameTree !== null &&
      currentFrameLoader(frameTree, pending.frameId) === pending.loaderId;
  }
}

interface MainWorldContextBinding {
  readonly contextId: number;
  readonly sessionId?: string;
}

interface CmdRecoveryTarget {
  readonly document: CmdRecoveryDocument;
  readonly sourceGeneration: number;
  readonly tabGeneration: number;
  readonly contextId: number;
  readonly sessionId?: string;
}

interface ActiveCmdRecovery {
  readonly token: symbol;
  readonly source: ObservedSource;
  readonly sourceGeneration: number;
  readonly tabGeneration: number;
  readonly deadlineAtMs: number;
  readonly done: Promise<void>;
  readonly resolveDone: () => void;
  target: CmdRecoveryTarget | null;
  session: CmdRecoverySession | null;
  attemptWindow: boolean;
  baselineRequested: boolean;
  finished: boolean;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
}

type CmdRecoveryAwait<T> = { readonly kind: "VALUE"; readonly value: T } |
  { readonly kind: "FINISHED" };

function sanitizeHttpMethod(value: unknown): ChromeBridgeHttpMethod | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/u.test(value)
    ? value as ChromeBridgeHttpMethod : null;
}

function networkSnapshotId(tabId: number, observerRequestOrdinal: number): string {
  return `network:${tabId}:request:${observerRequestOrdinal}`;
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

function pendingRequestMetadata(pending: PendingRequest): EmissionRequestMetadata {
  return {
    method: pending.method,
    observerRequestId: pending.observerRequestId,
    ...(pending.requestFrameKey === undefined ? {} : { requestFrameKey: pending.requestFrameKey }),
    ...(pending.requestDocumentKey === undefined ? {} : { requestDocumentKey: pending.requestDocumentKey }),
    ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }),
    ...(pending.providerContentIntent === undefined ? {} :
      { providerContentIntent: pending.providerContentIntent }),
    ...(pending.requestStartSequence === undefined ? {} :
      { requestStartSequence: pending.requestStartSequence }),
    ...(pending.streamId === undefined ? {} : { streamId: pending.streamId }),
    ...(pending.providerFunctionCode === undefined ? {} : { providerFunctionCode: pending.providerFunctionCode }),
    ...(pending.reconcileCutoffSequence === undefined ? {} :
      { reconcileCutoffSequence: pending.reconcileCutoffSequence })
  };
}

function replayRequestMetadata(snapshot: ReplayableHttpSnapshot): EmissionRequestMetadata {
  return { ...pendingRequestMetadata({ ...snapshot, sourceGeneration: 0, tabGeneration: 0 }), replayed: true };
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

function cmdProviderFunctionCode(request: Record<string, unknown>): number | null {
  if (typeof request.url !== "string") return null;
  try {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.hostname !== "cgnew.fts368.com" ||
      url.pathname !== "/Member/BetsView/BetLight/DataOdds.ashx") return null;

    const candidates = url.searchParams.getAll("fc");
    if (typeof request.postData === "string") {
      // Provider sends fc in a small application/x-www-form-urlencoded POST.
      // Reject oversized or ambiguous input instead of inspecting/storing it.
      if (request.postData.length > 4_096) return null;
      candidates.push(...new URLSearchParams(request.postData).getAll("fc"));
    }
    if (candidates.length !== 1 || !/^[1-7]$/u.test(candidates[0] ?? "")) return null;
    return Number(candidates[0]);
  } catch {
    return null;
  }
}

interface KsportHttpFallbackMode {
  readonly streamId: string | null;
  readonly recoveryGeneration: number | null;
}

function isProviderCatalogWebSocket(source: ObservedSource, _value: string): boolean {
  if (source.lobby === "KSPORT") {
    try { return isKsportCatalogSocket(new URL(_value)); } catch { return false; }
  }
  return source.lobby === "SABA" || source.lobby === "TSPORT" || source.lobby === "SBO";
}

function isProviderCatalogHttpResponse(source: ObservedSource, value: string,
  streamId: string | undefined, providerFunctionCode: number | undefined): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  if (source.lobby === "CMD") {
    return url.hostname === "cgnew.fts368.com" &&
      url.pathname === "/Member/BetsView/BetLight/DataOdds.ashx" &&
      providerFunctionCode !== undefined;
  }
  if (source.lobby === "IM") {
    return url.hostname === "imsports.directsb.net" &&
      (url.pathname === "/api/EventV6/GetSE" || url.pathname === "/api/EventV6/GetSEDelta");
  }
  if (source.lobby === "KSPORT") {
    // Page-native getEvent traffic is retained only as an in-memory request
    // template. It has no atomic generation/cutoff pair and must never cross
    // the bridge as authority. Direct paired recovery uses ingestHttpResponse.
    return false;
  }
  if (source.lobby === "BTI") {
    const detailId = url.pathname.slice("/api/eventpage/events/".length);
    return url.pathname.startsWith("/api/eventpage/events/") && detailId.length > 0 &&
      !detailId.includes("/") && streamId !== undefined && /^bti:\d+:\d+$/u.test(streamId);
  }
  return false;
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
  const recoveryGeneration = frames[0]?.recoveryGeneration;
  if (typeof recoveryGeneration !== "number" || !Number.isSafeInteger(recoveryGeneration) ||
    recoveryGeneration <= 0) return { live: false, today: false };
  const tracker = new KsportRecoveryGenerationTracker();
  for (const frame of frames) {
    if (frame.recoveryGeneration !== recoveryGeneration) return { live: false, today: false };
    tracker.push(frame.body);
  }
  return tracker.currentBaselineState;
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

function collectFrameDescriptors(value: unknown): Array<{
  readonly id: string; readonly loaderId: string | null
}> {
  if (!isRecord(value) || !isRecord(value.frameTree)) return [];
  const output: Array<{ readonly id: string; readonly loaderId: string | null }> = [];
  const visit = (tree: unknown): void => {
    if (!isRecord(tree)) return;
    if (isRecord(tree.frame) && typeof tree.frame.id === "string") {
      output.push({ id: tree.frame.id,
        loaderId: typeof tree.frame.loaderId === "string" && tree.frame.loaderId !== ""
          ? tree.frame.loaderId : null });
    }
    if (Array.isArray(tree.childFrames)) tree.childFrames.forEach(visit);
  };
  visit(value.frameTree);
  return output;
}

function collectCmdRecoveryFrameDescriptors(value: unknown): Array<{
  readonly id: string; readonly loaderId: string
}> {
  if (!isRecord(value) || !isRecord(value.frameTree)) return [];
  const output: Array<{ readonly id: string; readonly loaderId: string }> = [];
  const visit = (tree: unknown): void => {
    if (!isRecord(tree)) return;
    const frame = isRecord(tree.frame) ? tree.frame : null;
    if (frame !== null && typeof frame.id === "string" && typeof frame.loaderId === "string" &&
      frame.id.length > 0 && frame.loaderId.length > 0 && typeof frame.url === "string") {
      try {
        const url = new URL(frame.url);
        if (url.protocol === "https:" && url.hostname === "cgnew.fts368.com" &&
          url.pathname === "/Member/BetOdds/HdpDouble.aspx") {
          output.push({ id: frame.id, loaderId: frame.loaderId });
        }
      } catch { /* Ignore malformed frame URLs. */ }
    }
    if (Array.isArray(tree.childFrames)) tree.childFrames.forEach(visit);
  };
  visit(value.frameTree);
  return output;
}

function currentFrameLoader(value: unknown, frameId: string): string | null {
  return collectFrameDescriptors(value).find((frame) => frame.id === frameId)?.loaderId ?? null;
}

function isCompleteCmdFullResponse(body: string): boolean {
  try {
    const value: unknown = JSON.parse(body);
    if (!isRecord(value) || value.a !== true || cmdProviderCursor(value.t) === null || !Array.isArray(value.data) ||
      !value.data.every(Array.isArray) || !Array.isArray(value.today) || !value.today.every(Array.isArray) ||
      !Object.prototype.hasOwnProperty.call(value, "f")) return false;
    const allowed = new Set(["t", "a", "data", "today", "f"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) return false;
    const rows = [...value.data, ...value.today] as unknown[][];
    return rows.some(isCmdFullRow) && rows.every((row) => isCmdFullRow(row) || isCmdMetadataRow(row));
  } catch {
    return false;
  }
}

function isCmdFullRow(row: readonly unknown[]): boolean {
  if (row.length !== 91 || cmdProviderId(row[0]) === null || cmdProviderId(row[3]) === null) return false;
  return cmdPublicText(row[37], 160) !== null && cmdPublicText(row[38], 160) !== null &&
    cmdPublicText(row[39], 160) !== null && cmdPublicText(row[53], 32) !== null &&
    cmdPublicText(row[56], 16) !== null;
}

function cmdProviderId(value: unknown): string | null {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^\d+$/u.test(value)) ? String(value) : null;
}

function cmdPublicText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 0 && text.length <= maxLength ? text : null;
}

function cmdProviderCursor(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && String(cursor) === value ? cursor : null;
}

function isCmdMetadataRow(row: readonly unknown[]): boolean {
  if (row.length < 128 || row.length > 4_096 || row.length % 2 !== 0) return false;
  for (let index = 0; index < row.length; index += 2) {
    if (typeof row[index] !== "number" || !Number.isSafeInteger(row[index]) || (row[index] as number) <= 0 ||
      typeof row[index + 1] !== "string" || (row[index + 1] as string).trim().length === 0 ||
      (row[index + 1] as string).length > 256) return false;
  }
  return true;
}

function verifiedDocumentForDescriptor(descriptor: { readonly id: string;
  readonly loaderId: string | null } | undefined, sessionId?: string):
  NonNullable<DirectHttpRequestMetadata["verifiedDocument"]> | undefined {
  if (descriptor?.loaderId === null || descriptor === undefined) return undefined;
  return { frameId: descriptor.id, loaderId: descriptor.loaderId,
    ...(sessionId === undefined ? {} : { sessionId }) };
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

function safeFrameKey(frameId: string, frameIndex: number): string {
  const key = frameId.slice(0, 96);
  return /^[a-z0-9._:-]+$/iu.test(key) ? key : `frame-${frameIndex}`;
}

function sweepDocumentKey(observerSessionId: string, tabId: number, sourceGeneration: number,
  frameId: string, loaderId: string): string {
  const value = `${observerSessionId}\u0000${tabId}\u0000${sourceGeneration}\u0000${frameId}\u0000${loaderId}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `cmd-document:${(left >>> 0).toString(36)}:${(right >>> 0).toString(36)}`;
}

function requestDocumentBinding(observerSessionId: string, tabId: number, sourceGeneration: number,
  sessionId: string | undefined, rawFrameId: unknown, rawLoaderId: unknown): {
    readonly frameId: string;
    readonly loaderId: string;
    readonly requestFrameKey: string;
    readonly requestDocumentKey: string;
  } | null {
  if (typeof rawFrameId !== "string" || rawFrameId.length === 0 || rawFrameId.length > 256 ||
    typeof rawLoaderId !== "string" || rawLoaderId.length === 0 || rawLoaderId.length > 256 ||
    (sessionId !== undefined && (sessionId.length === 0 || sessionId.length > 256))) return null;
  const session = sessionId ?? "root";
  return {
    frameId: rawFrameId,
    loaderId: rawLoaderId,
    requestFrameKey: opaqueRequestKey("http-frame", [observerSessionId, tabId, session, rawFrameId]),
    requestDocumentKey: opaqueRequestKey("http-document",
      [observerSessionId, tabId, sourceGeneration, session, rawFrameId, rawLoaderId])
  };
}

function opaqueRequestKey(prefix: "http-frame" | "http-document",
  parts: readonly (string | number)[]): string {
  const value = parts.join("\u0000");
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${prefix}:${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}
