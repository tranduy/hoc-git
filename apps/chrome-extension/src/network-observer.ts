import type { ChromeBridgeEnvelope, ChromeBridgeHttpMethod, ChromeLobbyId } from "@tool-chenh/contracts";
import { splitUtf8Text } from "./utf8-length.js";
import { CMD_PUBLIC_CATALOG_EXPRESSION } from "./cmd-dom-snapshot.js";
import { chunkCmdSnapshot } from "./cmd-snapshot-chunker.js";
import { TSPORT_PUBLIC_CATALOG_EXPRESSION } from "./tsport-dom-snapshot.js";
import { TSPORT_CATALOG_SHAPE_EXPRESSION } from "./tsport-catalog-shape.js";
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
import { isFullKsportPartitionSnapshot,
  KsportRecoveryGenerationTracker } from "./ksport-recovery-generation.js";
import { apsportPageResponseFromEvaluation, apsportSelectionPriceFromEvent, buildApsportPageRequestExpression,
  collectApsportCatalog, collectApsportEventDetail, type ApsportCatalogBatch,
  type ApsportCatalogPageRequest, type ApsportRequestTemplate, type CollectApsportCatalogOptions,
  type CollectApsportEventDetailOptions } from "./apsport-catalog-refresh.js";
import type { ApsportPageHealth } from "./apsport-page-recovery.js";
import { BTI_PAGE_HEALTH_EXPRESSION, parseBtiPageHealthProbe,
  type BtiPageHealth } from "./bti-page-health.js";

const NETWORK_CHUNK_BODY_BYTES = 110_000;
const CATALOG_REFRESH_INTERVAL_MS = 4_000;
const KSPORT_BASELINE_FALLBACK_DELAY_MS = 2_000;
const PREEXISTING_SOCKET_GRACE_MS = 8_000;
const PREEXISTING_SOCKET_MAX_ATTEMPTS = 5;
const KSPORT_HTTP_RECONCILE_INTERVAL_MS = 4_000;
const KSPORT_NATIVE_HTTP_CAPTURE_WINDOW_MS = 60_000;
const KSPORT_IGNORED_SOCKETS_PER_SOURCE = 64;
// Long enough that a failed reconnect cannot become a per-frame storm, short
// enough that a provider is never dark for more than a minute.
const KSPORT_ORPHAN_FRAME_RETRY_MS = 30_000;
// APSPORT cannot expose a pre-existing native socket to a restarted MV3
// worker. One exact-tab renewal recreates every sport socket under CDP; pace a
// failed renewal so high-frequency orphan frames cannot cause reload churn.
const APSPORT_ORPHAN_FRAME_RETRY_MS = 30_000;
// Socket.IO keeps emitting orphan frames after an MV3 worker restart. Repeated
// reconnects visibly cycle the legacy SBO sportsbook, so a failed recovery is
// retried at most once per minute for the current source epoch.
const SBO_ORPHAN_FRAME_RETRY_MS = 60_000;
// Long enough that a click cannot become a storm, short enough that a missing
// partition is retried well inside the feed's baseline lease.
const KSPORT_BASELINE_REQUEST_RETRY_MS = 45_000;
const KSPORT_NATIVE_HTTP_RECOVERY_RETRY_MS = 8_000;
const KSPORT_BASELINE_LEASE_RENEW_MS = 75_000;
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
const APSPORT_PAGE_REQUEST_TIMEOUT_MS = 30_000;
const APSPORT_DETAIL_DELAY_MS = 500;
const APSPORT_CATALOG_REFRESH_INTERVAL_MS = 60_000;
const APSPORT_EVENT_DETAIL_DEBOUNCE_MS = 400;
const APSPORT_EVENT_DETAIL_MIN_INTERVAL_MS = 2_000;
const APSPORT_BOOTSTRAP_EXPRESSION = `(() => {
  try {
    const fieldlineApsportBootstrap = true;
    const page = new URL(location.href);
    if (!fieldlineApsportBootstrap || page.protocol !== 'https:' ||
      !(page.hostname === 'agenate.com' || page.hostname.endsWith('.agenate.com'))) return null;
    const language = page.searchParams.get('lng') || '';
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const resources = performance.getEntriesByType('resource')
      .map((entry) => typeof entry.name === 'string' ? entry.name : '');
    const hints = [...document.querySelectorAll('link[rel="dns-prefetch"],link[rel="preconnect"]')]
      .map((link) => typeof link.href === 'string' ? link.href : '');
    let origin = '';
    for (const raw of [...resources, ...hints]) {
      try {
        const candidate = new URL(raw, page.origin);
        if (candidate.protocol !== 'https:' ||
          !/^(?:spbui|spbtui)\.agenate\.com$/u.test(candidate.hostname)) continue;
        if (resources.includes(raw) && !candidate.pathname.startsWith('/be-ui/pac/api/v3/')) continue;
        origin = candidate.origin;
        break;
      } catch { /* Ignore malformed resource timing and link values. */ }
    }
    return origin === '' ? null : { origin, language, timeZone };
  } catch { return null; }
})()`;
// Long enough that two captures never overlap, short enough that one which will
// never settle cannot silence the sweep for the rest of the worker's life.
const CAPTURE_IN_FLIGHT_LIMIT_MS = 60_000;
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

function isKsportEventApiHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return isKsportProviderHost(normalized) || normalized === "zenandfe.com" ||
    normalized === "prod20091.fxf774.com";
}

function isKsportChildTargetUrl(rawUrl: string, targetType: string): boolean {
  if (targetType !== "iframe" && targetType !== "worker") return false;
  try {
    let url = new URL(rawUrl);
    if (targetType === "worker" && url.protocol === "blob:") url = new URL(url.pathname);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      (isKsportProviderHost(url.hostname) || url.hostname.toLowerCase() === "zenandfe.com");
  } catch { return false; }
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
  // The provider's live football view streams on p/2 with market group mg/1;
  // only the sport segment (s/1 = football) is identity. Locking p/1 + mg/0
  // silently discarded every frame from a tab opened on the live view.
  return url.protocol === "wss:" && /^spws\.(?:agenate|racern)\.com$/iu.test(url.hostname) &&
    /^\/ln\/[^/]+\/(?:p\/\d+\/u\/[^/]+(?:\/[^/]+)?\/)?s\/1\/mg\/\d+\/tr\/0$/u.test(url.pathname);
}

export interface ObservedSource {
  readonly lobby: ChromeLobbyId;
  readonly sourceId: string;
  readonly tabId: number;
}

export interface CatalogRefreshOptions {
  readonly prematchWindowHours?: number;
  readonly rosterOnly?: boolean;
}

function isSabaChildTargetUrl(rawUrl: string, targetType: string): boolean {
  if (targetType !== "iframe" && targetType !== "worker" && targetType !== "shared_worker") return false;
  try {
    let url = new URL(rawUrl);
    if ((targetType === "worker" || targetType === "shared_worker") && url.protocol === "blob:") {
      url = new URL(url.pathname);
    }
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      /^c0z0o[a-z0-9]+\.bp[a-z0-9]+\.com$/u.test(hostname) &&
      !/^c0z0o[a-z0-9]+\.(?:bpb7jrm5|bpf7t7s9)\.com$/u.test(hostname);
  } catch { return false; }
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
  readonly collectApsportCatalog?: (options: CollectApsportCatalogOptions) => Promise<void>;
  readonly collectApsportEventDetail?: (options: CollectApsportEventDetailOptions) => Promise<Record<string, unknown> | null>;
  readonly onApsportPageHealth?: (health: ApsportPageHealth) => void;
  readonly onApsportOrphanSocket?: (source: ObservedSource) => void | Promise<void>;
  readonly onBtiPageHealth?: (health: BtiPageHealth) => void;
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
  readonly targetId?: string;
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
  sabaLifecycleAnnounced?: boolean;
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
  /** Structure of destinations that matched no known partition. */
  destinationShapes: string;
  stompPendingChars: number;
  stompCommandFragments: number;
  stompFragments: number;
  destLiveLike: number;
  destTodayLike: number;
  destSportsLike: number;
  subSportLike: number;
  // Socket-reconnect probe results per attempt, labelled by target kind, so a
  // reconnect that silently finds no prototype/instances in the session that
  // actually owns the socket is visible without a service-worker console.
  reconnectAttempts: number;
  reconnectOutcomes: string;
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
  /** What the APSPORT capture sees at each gate, so an empty catalog names its
   *  reason instead of being silent. Counts and class names only. */
  catalogShape: string;
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
  readonly verifiedTarget?: {
    readonly targetId: string;
    readonly sessionId: string;
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

const SABA_TODAY_BASELINE_EXPRESSION = `(() => {
  // fieldline-saba-time-baseline
  // fieldline-saba-sports-scope
  const normalize = (value) => String(value || '').normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D')
    .trim().toLowerCase().replace(/\\s+/g, ' ');
  // SABA currently serves two shells from the same one-time launcher. The
  // legacy shell repeats the same period controls for Asian Games, US Open,
  // and general Sports. Only the general Sports group owns the full football
  // catalog, so never take the first global "Today" match.
  const legacySections = [...document.querySelectorAll('.c-side-nav.c-side-nav--event')];
  const sportsSection = legacySections.find((section) => {
    const header = section.querySelector(':scope > .c-side-nav__header');
    const label = header?.querySelector('.c-text, .c-side-nav__title') || header;
    return /^(?:the thao|sports)$/u.test(normalize(label?.textContent));
  });
  const legacyTabs = sportsSection ? [...sportsSection.querySelectorAll('.c-side-nav__tab')] : [];
  const compactTabs = sportsSection ? [] : [...document.querySelectorAll('.menu-item')];
  const tabs = legacyTabs.length > 0 ? legacyTabs : compactTabs;
  const matching = tabs.filter((tab) => /^(?:hom nay|today)$/u.test(normalize(tab.textContent)));
  const today = matching.find((tab) => tab.getClientRects().length > 0) || matching[0];
  if (!today) return { status: 'today-tab-unavailable', tabs: tabs.length };
  const active = today.getAttribute('aria-selected') === 'true' ||
    [...today.classList].some((name) => /^(?:active|current|selected)$/iu.test(name));
  const hidden = today.getClientRects().length === 0;
  if (hidden && sportsSection) {
    const header = sportsSection.querySelector(':scope > .c-side-nav__header');
    header?.click();
    setTimeout(() => today.click(), 180);
    return { status: 'today-tab-selected', scope: 'sports-opened', tabs: tabs.length };
  }
  today.click();
  return { status: active ? 'today-tab-reselected' : 'today-tab-selected',
    scope: sportsSection ? 'sports' : 'compact', tabs: tabs.length };
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
const KSPORT_TODAY_NATIVE_HTTP_EXPRESSION = ksportTimeTabExpression(["hom nay", "today"], true);
const KSPORT_LIVE_NATIVE_HTTP_EXPRESSION = ksportTimeTabExpression(["truc tiep", "live"], true);

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
      if (!${JSON.stringify(force)}) return { status: 'time-tab-active', step: 'tab', ...shape };
      // An already-selected tab produces no click, so the page never re-emits
      // its table and the feed never gets a complete baseline. Move to a
      // sibling period and come back, letting the page's own SPA rebuild the
      // subscription. Only period tabs are touched; no odds cell is involved.
      const sibling = [...scope.querySelectorAll('.sport-menu-tab .period-item')]
        .find((candidate) => candidate !== tab);
      if (!sibling) return { status: 'time-tab-active', step: 'tab', ...shape };
      sibling.click();
      setTimeout(() => { try { tab.click(); } catch (error) { void error; } }, 400);
      return { status: 'time-tab-reselected', step: 'tab', ...shape };
    }
    tab.click();
    return { status: 'time-tab-selected', step: 'tab', ...shape };
  })()`;
}

interface KsportNativeHttpPart {
  readonly url: string;
  readonly body: string;
}

interface KsportNativeHttpCapture {
  readonly sourceGeneration: number;
  readonly tabGeneration: number;
  expiresAtMs: number;
  readonly parts: Map<"live" | "today", KsportNativeHttpPart>;
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
      ['O' + 'ddsType']: 2, DateFrom: dateFrom, CompetitionIds: [],
      SortType: 2, ProgrammeIds: []
    };
    const path = '/api/EventV6/GetSE';
    // A fresh operator URL must override same-origin sessionStorage. Navigating
    // an existing IM tab preserves sessionStorage, so a failed prior recovery
    // can otherwise keep signing every GetSE with the old token even after the
    // operator pastes a valid replacement into the address bar.
    const token = new URLSearchParams(location.search).get('to' + 'ken') ||
      sessionStorage.getItem('to' + 'ken');
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
  const rosterWorkerKey = '__fieldlineBtiRosterWorkerV9';
  const detailBodiesKey = '__fieldlineBtiDetailBodiesV8';
  const existingRosterWorker = root[rosterWorkerKey];
  if (existingRosterWorker && existingRosterWorker.result &&
    now - Number(existingRosterWorker.completedAt || 0) <= 12000) {
    return existingRosterWorker.result;
  }
  if (existingRosterWorker && existingRosterWorker.promise && !existingRosterWorker.result) {
    return await existingRosterWorker.promise;
  }
  const generation = 'bti:' + now + ':' + Math.floor(Math.random() * 1000000000);
  const rosterWorker = { generation, completedAt: 0, result: null, promise: null,
    coverage: { phase: 'INITIAL', liveLeagues: 0, prematchLeagues: 0,
      liveBatches: 0, prematchBatches: 0, liveDone: 0, prematchDone: 0, failed: 0,
      events: 0, namedEvents: 0, timedEvents: 0, marketEvents: 0, validEvents: 0,
      detailCachedEvents: 0, detailCachedBytes: 0, detailPendingEvents: 0 } };
  const publishCoverage = () => {
    root.dataset.fieldlineBtiRosterCoverage = JSON.stringify(rosterWorker.coverage);
  };
  publishCoverage();
  root[rosterWorkerKey] = rosterWorker;
  rosterWorker.promise = (async () => {
  const authName = ['author', 'ization'].join('');
  const contextName = ['service', '-', 'context'].join('');
  const authValue = localStorage.getItem(['CT_APP_', 'AUTH', 'ORIZATION'].join(''));
  const contextValue = localStorage.getItem(['CT_APP_', 'SERVICE', '_CONTEXT'].join(''));
  const listHeaders = { Accept: 'application/json', 'X-Fieldline-Generation': generation };
  if (authValue) listHeaders[authName] = authValue;
  if (contextValue) listHeaders[contextName] = contextValue;
  const listBase = '/api/eventlist/asia/leagues/v2/1/';
  const fetchList = async (path) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      let timeoutId;
      const request = (async () => {
        const response = await fetch(path, { method: 'GET', credentials: 'include', cache: 'no-store',
          headers: listHeaders, signal: controller.signal });
        if (!response || !response.ok) return null;
        const body = typeof response.text === 'function'
          ? await response.text()
          : JSON.stringify(await response.json());
        return { path, body, payload: JSON.parse(body) };
      })().catch(() => null);
      const timeout = new Promise((resolve) => { timeoutId = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, 5000); });
      const result = await Promise.race([request, timeout]);
      clearTimeout(timeoutId);
      if (result) return result;
    }
    return null;
  };
  const regionCandidate = globalThis.APP_USER_DATA?.countryCode ||
    globalThis.APP_USER_DATA?.userSettings?.countryCode;
  const regionCode = typeof regionCandidate === 'string' && /^[A-Za-z]{2}$/u.test(regionCandidate)
    ? regionCandidate.toUpperCase() : 'VN';
  const initialPlans = ['live', 'prematch'].map((partition) => ({
    partition,
    canonicalPath: listBase + partition,
    initialCanonicalPath: listBase + partition + '/initial',
    requestPath: listBase + partition + '/initial?regionCode=' +
      encodeURIComponent(regionCode) + '&leagueIds=01'
  }));
  const hydratePartition = async (plan) => {
    const initial = await fetchList(plan.requestPath);
    if (!initial || !Array.isArray(initial.payload?.serializedData)) {
      rosterWorker.coverage.failed += 1;
      rosterWorker.coverage.phase = 'FAILED';
      publishCoverage();
      return null;
    }
    const leagueIds = [];
    const seenLeagueIds = new Set();
    for (const league of initial.payload.serializedData) {
      const candidate = Array.isArray(league) ? league[0] : null;
      const leagueId = typeof candidate === 'string' || typeof candidate === 'number'
        ? String(candidate) : '';
      if (!leagueId || !/^[A-Za-z0-9_-]+$/u.test(leagueId) || seenLeagueIds.has(leagueId)) continue;
      seenLeagueIds.add(leagueId);
      leagueIds.push(leagueId);
    }
    const batches = [];
    for (let index = 0; index < leagueIds.length; index += 10) {
      batches.push(leagueIds.slice(index, index + 10));
    }
    rosterWorker.coverage[plan.partition + 'Leagues'] = leagueIds.length;
    rosterWorker.coverage[plan.partition + 'Batches'] = batches.length;
    rosterWorker.coverage.phase = 'HYDRATING';
    publishCoverage();
    const pages = new Array(batches.length);
    let nextBatch = 0;
    let failed = false;
    const worker = async () => {
      while (!failed) {
        const index = nextBatch;
        nextBatch += 1;
        if (index >= batches.length) return;
        const page = await fetchList(plan.canonicalPath + '?leagueIds=' + batches[index].join(','));
        if (!page || !Array.isArray(page.payload?.serializedData)) {
          failed = true;
          rosterWorker.coverage.failed += 1;
          rosterWorker.coverage.phase = 'FAILED';
          publishCoverage();
          return;
        }
        pages[index] = page;
        rosterWorker.coverage[plan.partition + 'Done'] += 1;
        publishCoverage();
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, batches.length) }, () => worker()));
    if (failed || pages.some((page) => !page)) return null;
    const merged = new Map();
    const anonymous = [];
    const rowRichness = (value) => {
      try { return JSON.stringify(value).length; } catch { return Array.isArray(value) ? value.length : 0; }
    };
    const addLeagues = (payload) => {
      for (const league of payload.serializedData) {
        if (!Array.isArray(league)) continue;
        const candidate = league[0];
        const leagueId = typeof candidate === 'string' || typeof candidate === 'number'
          ? String(candidate) : '';
        if (!leagueId) {
          anonymous.push(league);
          continue;
        }
        const existing = merged.get(leagueId);
        if (!Array.isArray(existing)) {
          merged.set(leagueId, league);
          continue;
        }
        const events = new Map();
        const eventRows = [];
        const addEvents = (source) => {
          for (const event of Array.isArray(source?.[12]) ? source[12] : []) {
            if (!Array.isArray(event)) continue;
            const rawId = event[0];
            const eventId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
            if (!eventId) {
              eventRows.push(event);
              continue;
            }
            const retained = events.get(eventId);
            if (!retained || rowRichness(event) > rowRichness(retained)) events.set(eventId, event);
          }
        };
        addEvents(existing);
        addEvents(league);
        const richerLeague = rowRichness(league) > rowRichness(existing) ? league : existing;
        const combined = [...richerLeague];
        combined[12] = [...events.values(), ...eventRows];
        merged.set(leagueId, combined);
      }
    };
    addLeagues(initial.payload);
    for (const page of pages) addLeagues(page.payload);
    // The initial roster advertises hundreds of empty league shells. Returning
    // those shells (and the provider's unrelated top-level metadata) through
    // Runtime.evaluate can exceed CDP's by-value result limit, even though the
    // actual event catalog is much smaller. The adapter only consumes league
    // rows that own events, so keep every event-bearing row and discard only
    // provably empty shells from the direct recovery envelope.
    const populatedLeagues = [...merged.values(), ...anonymous].filter((league) =>
      Array.isArray(league?.[12]) && league[12].length > 0);
    const payload = { serializedData: populatedLeagues };
    const body = JSON.stringify(payload);
    return {
      payload,
      responses: plan.partition === 'live'
        ? [{ path: plan.canonicalPath, body },
          { path: plan.initialCanonicalPath, body: '{"serializedData":[]}' }]
        : [{ path: plan.initialCanonicalPath, body }]
    };
  };
  const partitions = await Promise.all(initialPlans.map(hydratePartition));
  const listResponses = partitions.filter(Boolean).flatMap((partition) => partition.responses);
  const eventIds = [];
  const seen = new Set();
  for (const entry of partitions) {
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
        const participants = Array.isArray(event?.[1]) ? event[1] : [];
        const names = participants.slice(0, 2).map((participant) => {
          const localized = Array.isArray(participant) && participant[1] &&
            typeof participant[1] === 'object' ? participant[1] : {};
          const fallback = Object.values(localized).find((value) =>
            typeof value === 'string' && value.trim().length > 0);
          return String(localized.VI || localized.EN || localized.VN || fallback ||
            (Array.isArray(participant) ? participant[2] : '') || '').trim();
        });
        const splitNames = String(event?.[2] || '').split(/\s+(?:v(?:s\.?)?|[-\u2013\u2014])\s+/iu)
          .map((name) => name.trim());
        const named = (names.length === 2 && names.every(Boolean)) ||
          (splitNames.length === 2 && splitNames.every(Boolean));
        const timed = event?.[5] === true || (event?.[5] === false &&
          Number.isFinite(Date.parse(String(event?.[3] || ''))));
        const hasMarkets = Array.isArray(event?.[8]) && event[8].length > 0;
        if (named) rosterWorker.coverage.namedEvents += 1;
        if (timed) rosterWorker.coverage.timedEvents += 1;
        if (hasMarkets) rosterWorker.coverage.marketEvents += 1;
        if (named && timed) rosterWorker.coverage.validEvents += 1;
      }
    }
  }
  rosterWorker.coverage.phase = partitions.length === initialPlans.length && partitions.every(Boolean)
    ? 'COMPLETE' : 'FAILED';
  rosterWorker.coverage.events = eventIds.length;
  publishCoverage();
  let priorVisits = {};
  try {
    const parsed = JSON.parse(root.dataset.fieldlineBtiDetailVisits || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) priorVisits = parsed;
  } catch { /* A malformed page-owned dataset must not stop catalog refresh. */ }
  const detailWorkerKey = '__fieldlineBtiDetailWorkerV9';
  if (partitions.length === initialPlans.length && partitions.every(Boolean)) {
    const ranked = eventIds.map((eventId, index) => {
      const visitedAt = Number(priorVisits[eventId]);
      return { eventId, index, visitedAt: Number.isFinite(visitedAt) && visitedAt > 0 ? visitedAt : 0 };
    }).sort((left, right) => left.visitedAt - right.visitedAt || left.index - right.index);
    const selected = ranked.map(({ eventId }) => eventId);
    const nextVisits = {};
    for (const [eventId, value] of Object.entries(priorVisits)) {
      const visitedAt = Number(value);
      if (Number.isFinite(visitedAt) && visitedAt > 0 && now - visitedAt <= 10 * 60 * 1000) {
        nextVisits[eventId] = visitedAt;
      }
    }
    root.dataset.fieldlineBtiDetailVisits = JSON.stringify(nextVisits);
    const nextJob = { generation, headers: { ...listHeaders }, eventIds: selected };
    const currentWorker = root[detailWorkerKey];
    if (currentWorker && typeof currentWorker.update === 'function') {
      currentWorker.update(nextJob);
    } else {
      // A worker from an older extension build cannot be trusted to own the
      // complete queue. Retire only that incompatible object; current workers
      // keep their in-flight request and adopt new generation headers.
      if (currentWorker) delete root[detailWorkerKey];
      const detailWorker = {
        generation: '',
        headers: nextJob.headers,
        desired: new Set(),
        queue: [],
        activeEventIds: new Set(),
        controllers: new Map(),
        update(job) {
          if (this.generation === job.generation) return;
          this.generation = job.generation;
          this.headers = job.headers;
          const desired = new Set(job.eventIds);
          this.queue = this.queue.filter((eventId) => desired.has(eventId));
          const queued = new Set(this.queue);
          for (const eventId of job.eventIds) {
            if (this.activeEventIds.has(eventId) || queued.has(eventId)) continue;
            queued.add(eventId);
            this.queue.push(eventId);
          }
          this.desired = desired;
        },
        markVisited(eventId) {
          let visits = {};
          try {
            const parsed = JSON.parse(root.dataset.fieldlineBtiDetailVisits || '{}');
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) visits = parsed;
          } catch { /* Rebuild malformed page-owned scheduling state. */ }
          visits[eventId] = Date.now();
          root.dataset.fieldlineBtiDetailVisits = JSON.stringify(visits);
        }
      };
      detailWorker.update(nextJob);
      root[detailWorkerKey] = detailWorker;
      const runDetailLane = async () => {
        while (root[detailWorkerKey] === detailWorker && detailWorker.queue.length > 0) {
          const eventId = detailWorker.queue.shift();
          if (!eventId || !detailWorker.desired.has(eventId)) continue;
          detailWorker.activeEventIds.add(eventId);
          const headers = { ...detailWorker.headers };
          const controller = new AbortController();
          detailWorker.controllers.set(eventId, controller);
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          try {
            const response = await fetch('/api/eventpage/events/' + encodeURIComponent(eventId) +
              '?hideX25X75Selections=false',
            { method: 'GET', credentials: 'include', cache: 'no-store', headers,
              signal: controller.signal });
            let body = '';
            if (typeof response?.text === 'function') body = await response.text();
            else if (typeof response?.json === 'function') body = JSON.stringify(await response.json());
            else if (typeof response?.arrayBuffer === 'function') {
              body = new TextDecoder().decode(await response.arrayBuffer());
            }
            let compactBody = '';
            try {
              const payload = JSON.parse(body);
              if (payload && Array.isArray(payload.data) && payload.data.length > 0) {
                const compactLocalized = (value) => {
                  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
                  const compact = {};
                  for (const key of ['VI', 'EN', 'VN']) {
                    if (typeof value[key] === 'string' && value[key].trim()) compact[key] = value[key];
                  }
                  if (Object.keys(compact).length === 0) {
                    const fallback = Object.values(value).find((item) => typeof item === 'string' && item.trim());
                    if (fallback) compact._ = fallback;
                  }
                  return compact;
                };
                const compactName = (value) => {
                  if (typeof value === 'string') return value.trim();
                  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
                  for (const key of ['VI', 'EN', 'VN', '_']) {
                    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
                  }
                  return '';
                };
                const participantName = (value) => Array.isArray(value)
                  ? compactName(value[1]) || compactName(value[2]) : '';
                const placeholderPair = (participants) => {
                  if (!Array.isArray(participants) || participants.length < 2) return true;
                  const normalized = participants.slice(0, 2).map((participant) => participantName(participant)
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                    .replace(/[^a-z0-9]+/g, ' ').trim());
                  const pair = normalized.join('|');
                  return pair === 'home|away' || pair === 'team a|team b' ||
                    pair === 'doi nha|doi khach' || pair === 'chu nha|doi khach';
                };
                const compactParticipant = (value) => {
                  if (!Array.isArray(value)) return null;
                  const compact = Array(3).fill(null);
                  if (typeof value[0] === 'string' || typeof value[0] === 'number') compact[0] = value[0];
                  const candidates = [value[1], value[2]].map((candidate) => {
                    if (typeof candidate === 'string' && candidate.trim()) {
                      return { name: candidate.trim(), localized: { _: candidate.trim() }, raw: candidate.trim() };
                    }
                    const localized = compactLocalized(candidate);
                    return localized ? { name: compactName(localized), localized, raw: null } : null;
                  }).filter((candidate) => candidate && candidate.name);
                  const generic = (name) => /^(?:home|away|team [ab12]|doi nha|doi khach|chu nha)$/u.test(
                    name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                      .replace(/[^a-z0-9]+/g, ' ').trim());
                  const selected = candidates.find((candidate) => !generic(candidate.name)) || candidates[0];
                  if (selected) {
                    compact[1] = selected.localized;
                    if (selected.raw) compact[2] = selected.raw;
                  }
                  return compact;
                };
                const compactSelection = (value) => {
                  if (!Array.isArray(value)) return null;
                  const id = typeof value[0] === 'string' ? value[0].trim() : '';
                  const side = value[9];
                  const line = value[16];
                  const malay = Array.isArray(value[8]) && typeof value[8][5] === 'string'
                    ? value[8][5].trim() : '';
                  const quarterUnits = typeof line === 'number' && Number.isFinite(line) ? Math.abs(line) * 4 : NaN;
                  if (!id || (side !== 1 && side !== 3) || !Number.isInteger(quarterUnits) ||
                    quarterUnits % 4 === 0 || Math.abs(line) > 100 ||
                    !/^-?(?:0|1)(?:[.][0-9]+)?$/u.test(malay) || Number(malay) === 0 || value[13] === true) return null;
                  const compact = Array(17).fill(null);
                  for (const index of [0, 5, 9, 13, 16]) compact[index] = value[index] ?? null;
                  compact[2] = typeof value[2] === 'string' ? value[2] : compactLocalized(value[2]);
                  const formats = Array.isArray(value[8]) ? Array(6).fill(null) : null;
                  if (formats) formats[5] = value[8][5] ?? null;
                  compact[8] = formats;
                  return compact;
                };
                const compactMarket = (value) => {
                  if (!Array.isArray(value)) return null;
                  const marketType = Array.isArray(value[5]) ? value[5] : [];
                  const code = String(marketType[0] || marketType[1] || value[1] || '').trim();
                  const label = String(value[1] || '') + ' ' + String(marketType[1] || '');
                  const evidence = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                  const handicap = /^HC(?:39|0|1)$/u.test(code) || /\b(?:asian handicap|handicap|ah)\b/u.test(evidence);
                  const total = /^OU(?:39|0|1|201|249)$/u.test(code) || /\b(?:total|over under|ou)\b/u.test(evidence);
                  if (value[15] === true || value[23] === true || handicap === total ||
                    !Array.isArray(value[13])) return null;
                  const selections = value[13].map(compactSelection).filter(Boolean);
                  if (selections.length < 2) return null;
                  const compact = Array(24).fill(null);
                  for (const index of [0, 1, 15, 23]) compact[index] = value[index] ?? null;
                  if (Array.isArray(value[5])) compact[5] = [value[5][0] ?? null, value[5][1] ?? null];
                  compact[13] = selections;
                  return compact;
                };
                const compactEvent = (value) => {
                  if (!Array.isArray(value)) return null;
                  const compact = Array(34).fill(null);
                  for (const index of [0, 2, 11, 13, 32]) compact[index] = value[index] ?? null;
                  let participants = Array.isArray(value[8])
                    ? value[8].slice(0, 2).map(compactParticipant).filter(Boolean) : [];
                  for (const index of [20, 33]) {
                    compact[index] = Array.isArray(value[index])
                      ? value[index].map(compactMarket).filter(Boolean) : [];
                  }
                  if (placeholderPair(participants)) {
                    const markets = [...compact[20], ...compact[33]];
                    for (const market of markets) {
                      const type = Array.isArray(market?.[5]) ? market[5] : [];
                      const code = String(type[0] || type[1] || market?.[1] || '').trim();
                      const label = (String(market?.[1] || '') + ' ' + String(type[1] || ''))
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
                        .replace(/[^a-z0-9]+/g, ' ').trim();
                      if (!(/^HC(?:39|0|1)$/u.test(code) || /\b(?:asian handicap|handicap|ah)\b/u.test(label))) continue;
                      const selections = Array.isArray(market?.[13]) ? market[13] : [];
                      const home = selections.find((selection) => Array.isArray(selection) && selection[9] === 1);
                      const away = selections.find((selection) => Array.isArray(selection) && selection[9] === 3);
                      if (!home || !away) continue;
                      const candidate = [home, away].map((selection, index) => {
                        const participant = Array.isArray(participants[index]) ? participants[index] : [];
                        const hydrated = Array(3).fill(null);
                        hydrated[0] = participant[0] ?? selection[0] ?? null;
                        if (selection[2] && typeof selection[2] === 'object') hydrated[1] = selection[2];
                        else if (typeof selection[2] === 'string') hydrated[2] = selection[2];
                        return hydrated;
                      });
                      if (!placeholderPair(candidate) && candidate.every((participant) => participantName(participant))) {
                        participants = candidate;
                        break;
                      }
                    }
                  }
                  compact[8] = participants;
                  return compact;
                };
                const compactEvents = payload.data.map(compactEvent).filter(Boolean);
                if (compactEvents.length > 0) compactBody = JSON.stringify({ data: compactEvents });
              }
            } catch { /* Invalid or empty detail is not useful catalog evidence. */ }
            if (response?.ok && compactBody.length > 0 && compactBody.length <= 2 * 1024 * 1024) {
              const cached = Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
              const path = '/api/eventpage/events/' + encodeURIComponent(eventId);
              const existingIndex = cached.findIndex((item) => item && item.path === path);
              if (existingIndex >= 0) cached.splice(existingIndex, 1);
              cached.push({ path, body: compactBody });
              let cachedBytes = cached.reduce((sum, item) => sum +
                (item && typeof item.body === 'string' ? item.body.length : 0), 0);
              while (cached.length > 512 || cachedBytes > 24 * 1024 * 1024) {
                const removed = cached.shift();
                if (removed && typeof removed.body === 'string') cachedBytes -= removed.body.length;
              }
              root[detailBodiesKey] = cached;
            }
          } catch { /* Detail enrichment must not invalidate the complete list generation. */ }
          finally {
            clearTimeout(timeoutId);
            detailWorker.markVisited(eventId);
            if (detailWorker.controllers.get(eventId) === controller) detailWorker.controllers.delete(eventId);
            detailWorker.activeEventIds.delete(eventId);
          }
        }
      };
      detailWorker.promise = Promise.all(Array.from({ length: 3 }, () => runDetailLane())).finally(() => {
        if (root[detailWorkerKey] === detailWorker) delete root[detailWorkerKey];
      });
    }
  }
  const detailCache = partitions.length === initialPlans.length && partitions.every(Boolean) &&
    Array.isArray(root[detailBodiesKey]) ? root[detailBodiesKey] : [];
  rosterWorker.coverage.detailCachedBytes = detailCache.reduce((sum, item) => sum +
    (item && typeof item.body === 'string' ? item.body.length : 0), 0);
  const cachedEventIds = new Set(detailCache.flatMap((item) => {
    if (!item || typeof item.path !== 'string') return [];
    const prefix = '/api/eventpage/events/';
    if (!item.path.startsWith(prefix)) return [];
    try { return [decodeURIComponent(item.path.slice(prefix.length))]; } catch { return []; }
  }));
  rosterWorker.coverage.detailCachedEvents = eventIds.filter((eventId) => cachedEventIds.has(eventId)).length;
  rosterWorker.coverage.detailPendingEvents = eventIds.filter((eventId) => !cachedEventIds.has(eventId)).length;
  publishCoverage();
  const cachedDetails = [];
  if (detailCache.length > 0) {
    let batch = [];
    let batchBytes = 0;
    let batchIndex = 0;
    const flushBatch = () => {
      if (batch.length === 0) return;
      cachedDetails.push({ path: '/api/eventpage/events/__fieldline_batch_' + batchIndex + '__',
        body: JSON.stringify({ data: batch }) });
      batchIndex += 1;
      batch = [];
      batchBytes = 0;
    };
    for (const item of detailCache) {
      if (!item || typeof item.body !== 'string') continue;
      try {
        const payload = JSON.parse(item.body);
        for (const event of Array.isArray(payload?.data) ? payload.data : []) {
          const eventBytes = JSON.stringify(event).length;
          if (batch.length > 0 && batchBytes + eventBytes > 1536 * 1024) flushBatch();
          batch.push(event);
          batchBytes += eventBytes;
        }
      } catch { /* Ignore a stale malformed page-cache entry. */ }
    }
    flushBatch();
  }
  const responses = new Map();
  // A bridge reconnect creates a fresh API decode pipeline. Prime that pipeline
  // with every cached event detail before the three list partitions commit the
  // authoritative baseline, so a healthy reconnect never publishes the small
  // roster shell and then spends a minute rebuilding visible coverage.
  for (const item of [...cachedDetails, ...listResponses]) {
    if (item && typeof item.path === 'string' && typeof item.body === 'string') {
      responses.set(item.path, { url: item.path, body: item.body });
    }
  }
  return {
    status: 'catalog-requested',
    generation,
    origin: location.origin || ('https://' + location.hostname),
    responses: [...responses.values()]
  };
  })().then((result) => {
    rosterWorker.result = result;
    rosterWorker.completedAt = Date.now();
    return result;
  }).catch(() => {
    rosterWorker.coverage.phase = 'FAILED';
    rosterWorker.coverage.failed += 1;
    publishCoverage();
    if (root[rosterWorkerKey] === rosterWorker) delete root[rosterWorkerKey];
    return {
      status: 'catalog-failed', generation,
      origin: location.origin || ('https://' + location.hostname), responses: []
    };
  });
  return await rosterWorker.promise;
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
  readonly #collectApsportCatalog: NonNullable<NetworkObserverDependencies["collectApsportCatalog"]>;
  readonly #collectApsportEventDetail: NonNullable<NetworkObserverDependencies["collectApsportEventDetail"]>;
  readonly #onApsportPageHealth: NetworkObserverDependencies["onApsportPageHealth"];
  readonly #onApsportOrphanSocket: NetworkObserverDependencies["onApsportOrphanSocket"];
  readonly #onBtiPageHealth: NetworkObserverDependencies["onBtiPageHealth"];
  readonly #sequences = new Map<string, number>();
  readonly #sourceGenerations = new Map<string, number>();
  readonly #tabGenerations = new Map<number, number>();
  readonly #bridgeEpochGenerations = new Map<string, number>();
  readonly #publicSourceEpochs = new Map<string, { readonly sourceGeneration: number;
    readonly bridgeGeneration: number; readonly ordinal: number }>();
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
  readonly #sabaTodayBootstrapSelected = new Set<string>();
  readonly #sabaCatalogFrameAtMs = new Map<string, number>();
  readonly #sabaSilentSocketRecoveryAtMs = new Map<string, number>();
  // The attach diagnostic is rebuilt whenever a source generation rolls, which
  // erased what the tab selector had just seen before it could be read. The
  // labels are the whole point of the report, so keep the last ones per source.
  readonly #lastTabLabels = new Map<string, string>();
  readonly #lastCatalogShape = new Map<string, string>();
  readonly #lastCaptureExit = new Map<string, string>();
  // Only a target reported as an iframe is observed, while the attach counter
  // counts them all: two events with none observed says the type is not what is
  // expected, and nothing said what it was.
  readonly #targetTypesSeen = new Map<string, Map<string, number>>();
  readonly #socketPathsSeen = new Map<string, Map<string, number>>();
  readonly #requestPartitions = new Map<string, ProviderPartition>();
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
  readonly #cmdFullBaselineAtMs = new Map<string, number>();
  readonly #cmdSnapshotHosts = new Map<string, string>();
  readonly #domSnapshotOrdinals = new Map<string, number>();
  readonly #httpSnapshots = new Map<string, ReplayableHttpSnapshot[]>();
  readonly #tsportSnapshots = new Map<string, Map<string, ReplayableWsEvent>>();
  readonly #tsportRequestUrls = new Map<string, string[]>();
  readonly #apsportRequestTemplates = new Map<string, BoundApsportRequestTemplate>();
  readonly #apsportRefreshOrdinals = new Map<string, number>();
  readonly #apsportLastRefreshStartedAtMs = new Map<string, number>();
  readonly #apsportRefreshesInFlight = new Set<string>();
  readonly #apsportActiveCatalogs = new Map<string, { readonly generation: string;
    readonly prematchWindowHours: number; readonly rosterCount: number;
    readonly rosterEventIds: ReadonlySet<string>;
    readonly rosterLeagueIds: ReadonlyMap<string, string> }>();
  readonly #apsportEventDetailTimers = new Map<string, { readonly sourceId: string;
    readonly timer: ReturnType<typeof setTimeout> }>();
  readonly #apsportEventDetailJobs = new Map<string, symbol>();
  readonly #apsportEventDetailLastAtMs = new Map<string, number>();
  readonly #apsportEventDetailTails = new Map<string, Promise<void>>();
  readonly #apsportPageRequestTails = new Map<string, Promise<void>>();
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
  readonly #cmdCapturesInFlight = new Map<string, { readonly token: symbol;
    readonly operation: Promise<void>; readonly startedAtMs: number }>();
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
  readonly #sabaAttachedTargetSessions = new Map<string, Map<string, {
    readonly sessionId: string; readonly targetType: "iframe" | "worker" }>>();
  readonly #wsAttachDiagnostics = new Map<string, WsAttachDiagnosticState>();
  readonly #preexistingSocketReconnects = new Map<string, PreexistingSocketReconnectState>();
  readonly #preexistingSocketReconnectSources = new Map<string, ObservedSource>();
  readonly #ksportDiagnosticAtMs = new Map<string, number>();
  readonly #ksportRefreshesInFlight = new Set<string>();
  readonly #ksportBaselineRequests = new Map<string, { readonly streamId: string;
    readonly recoveryGeneration: number; readonly requested: Map<"live" | "today", number>;
    attempts: number }>();
  // Periodic KSPORT maintenance must stay non-destructive while the sportsbook
  // STOMP socket is alive. These clocks gate the heavier recovery paths.
  readonly #ksportCatalogFrameAtMs = new Map<string, number>();
  readonly #ksportHeartbeatForwardAtMs = new Map<string, number>();
  readonly #ksportBaselineAttemptAtMs = new Map<string, number>();
  readonly #ksportPeriodSelectionAtMs = new Map<string, number>();
  readonly #ksportMaintenanceRecoveryAtMs = new Map<string, number>();
  readonly #ksportHttpFallbackModes = new Map<string, KsportHttpFallbackMode>();
  readonly #ksportOrphanFrameRecoveryAtMs = new Map<string, number>();
  readonly #ksportNativeHttpCaptures = new Map<string, KsportNativeHttpCapture>();
  readonly #ksportNativeHttpRecoveryAtMs = new Map<string, number>();
  readonly #ksportBaselineLeaseAtMs = new Map<string, number>();
  readonly #sabaOrphanFrameRecoveryAtMs = new Map<string, number>();
  readonly #sboOrphanFrameRecoveryAtMs = new Map<string, number>();
  readonly #apsportOrphanFrameRecoveryAtMs = new Map<string, number>();
  readonly #sbobetEventRequests = new Map<string, { readonly url: string;
    readonly headers: Readonly<Record<string, string>>; readonly method: "GET" | "POST";
    readonly hasPostData: boolean }>();
  readonly #activeCmdHiddenProbes = new Map<string, ActiveCmdHiddenProbe>();

  constructor(dependencies: NetworkObserverDependencies) {
    this.#sendCommand = dependencies.sendCommand;
    this.#forward = dependencies.forward;
    this.#now = dependencies.now ?? Date.now;
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.#recoverImBaseline = dependencies.recoverImBaseline ?? null;
    this.#frameCommandTimeoutMs = dependencies.frameCommandTimeoutMs ?? 2_500;
    this.#btiCatalogRefreshTimeoutMs = dependencies.btiCatalogRefreshTimeoutMs ?? 60_000;
    this.#cmdRecoveryMaxAttempts = dependencies.cmdRecoveryMaxAttempts ?? CMD_RECOVERY_MAX_ATTEMPTS;
    this.#cmdRecoveryDeadlineMs = dependencies.cmdRecoveryDeadlineMs ?? CMD_RECOVERY_DEADLINE_MS;
    this.#cmdRecoveryRetryMs = dependencies.cmdRecoveryRetryMs ?? CMD_RECOVERY_RETRY_MS;
    this.#observerSessionId = dependencies.observerSessionId ?? crypto.randomUUID();
    this.#loadSabaWsSnapshots = dependencies.loadSabaWsSnapshots ?? (async () => null);
    this.#saveSabaWsSnapshots = dependencies.saveSabaWsSnapshots;
    this.#clearSabaWsSnapshots = dependencies.clearSabaWsSnapshots ?? (async () => undefined);
    // One lane per provider keeps DOM work serialised on its debugger session,
    // but the default three shared slots and single queue slot let a periodic
    // SABA DOM poll evict a recovery refresh with a silent QUEUE_FULL
    // (measured 2026-09-01: zero reconnect attempts across four API recovery
    // rounds). A refresh must be able to queue behind the one poll in flight.
    this.#workScheduler = dependencies.workScheduler ??
      new ProviderWorkScheduler({ maxConcurrent: 8, maxQueuedPerSource: 2 });
    this.#collectApsportCatalog = dependencies.collectApsportCatalog ?? collectApsportCatalog;
    this.#collectApsportEventDetail = dependencies.collectApsportEventDetail ?? collectApsportEventDetail;
    this.#onApsportPageHealth = dependencies.onApsportPageHealth;
    this.#onApsportOrphanSocket = dependencies.onApsportOrphanSocket;
    this.#onBtiPageHealth = dependencies.onBtiPageHealth;
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
    const frames = this.#catalogWsSnapshots.get(sourceId)?.get(activeStream);
    if (tracker !== undefined) {
      if (!tracker.currentBaselineState.complete || frames === undefined) return false;
      return ksportFramesContainCompleteBaseline(frames.filter((frame) =>
        frame.recoveryGeneration === tracker.currentGeneration));
    }
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
    const retainedFrames = tracker === undefined ? frames ?? [] : (frames ?? []).filter((frame) =>
      frame.recoveryGeneration === tracker.currentGeneration);
    const state = activeStream === undefined ? { live: false, today: false }
      : ksportBaselineState(retainedFrames);
    if (state.live && state.today) {
      this.#ksportBaselineRequests.delete(source.sourceId);
      this.#ksportBaselineAttemptAtMs.delete(source.sourceId);
      // The provider starts a new subscription generation whenever a period
      // tab is selected. Moving the UI back to Live after both partitions had
      // completed therefore erased the just-proven baseline. Leave the page on
      // the period that completed the pair; realtime updates do not depend on
      // which period is visually selected.
      return true;
    }
    if (activeStream === undefined) return false;
    const nowMs = this.#now();
    const lastPeriodSelectionAtMs = this.#ksportPeriodSelectionAtMs.get(source.sourceId);
    if (lastPeriodSelectionAtMs !== undefined &&
      nowMs - lastPeriodSelectionAtMs < KSPORT_BASELINE_REQUEST_RETRY_MS) return false;
    const recoveryGeneration = tracker?.currentGeneration ?? frames?.[0]?.recoveryGeneration ?? 0;
    let requests = this.#ksportBaselineRequests.get(source.sourceId);
    if (requests === undefined || requests.streamId !== activeStream ||
      requests.recoveryGeneration !== recoveryGeneration) {
      requests = { streamId: activeStream, recoveryGeneration, requested: new Map(), attempts: 0 };
      this.#ksportBaselineRequests.set(source.sourceId, requests);
    }
    const noPartitionBaseline = !state.live && !state.today;
    // When the worker attaches after the provider socket, the currently active
    // period has already sent its initial table. Move to the opposite period
    // first and let that one finish before returning. The old force expression
    // clicked a sibling and clicked back 400 ms later, creating overlapping
    // SUBSCRIBEs; the provider answered those overlaps with error receipts and
    // no catalog. Alternate one ordinary provider tab selection per bounded
    // attempt until the first partition proves which side is current.
    const missing = noPartitionBaseline
      ? requests.attempts % 2 === 0 ? "today" : "live"
      : !state.live ? "live" : "today";
    // Asking exactly once per generation left the partition permanently missing
    // whenever that single click did not produce a snapshot, and without both
    // partitions the feed can never be promoted. Retry on a bounded interval.
    if (noPartitionBaseline && requests.attempts > 0) {
      const lastRequestAtMs = Math.max(...requests.requested.values());
      if (nowMs - lastRequestAtMs < KSPORT_BASELINE_REQUEST_RETRY_MS) return false;
    }
    const requestedAtMs = requests.requested.get(missing);
    if (requestedAtMs !== undefined && nowMs - requestedAtMs < KSPORT_BASELINE_REQUEST_RETRY_MS) return false;
    if (requests.attempts >= KSPORT_BASELINE_REQUESTS_PER_GENERATION) return false;
    requests.attempts += 1;
    requests.requested.set(missing, nowMs);
    let selected = await this.#selectTimeTab(source,
      missing === "live" ? KSPORT_LIVE_BASELINE_EXPRESSION : KSPORT_TODAY_BASELINE_EXPRESSION);
    if (selected && noPartitionBaseline &&
      this.#wsAttachDiagnostic(source).baselineTabStatus === "time-tab-active" &&
      requests.attempts < KSPORT_BASELINE_REQUESTS_PER_GENERATION) {
      // `active` means the selector made no click. If the observer attached
      // after that period's initial snapshot, waiting cannot create a baseline.
      // Select the opposite period once: this still produces only one real DOM
      // click and avoids the provider's overlapping-subscription failure mode.
      const opposite = missing === "live" ? "today" : "live";
      requests.attempts += 1;
      requests.requested.set(opposite, this.#now());
      selected = await this.#selectTimeTab(source,
        opposite === "live" ? KSPORT_LIVE_BASELINE_EXPRESSION : KSPORT_TODAY_BASELINE_EXPRESSION);
    }
    if (!selected) this.#ksportBaselineAttemptAtMs.set(source.sourceId, this.#now());
    return false;
  }

  /** Names the gate a capture left through. Every one of them returns the same
   *  silence, which is why three fixes to how often the sweep runs changed
   *  nothing that could be seen from outside. */
  #noteCaptureExit(source: ObservedSource, reason: string): void {
    this.#lastCaptureExit.set(source.sourceId, reason);
  }

  /** Reads what the APSPORT capture sees at each gate. Its expression returns
   *  an empty catalog on every failure alike, so without this a missing root,
   *  a duplicated one and a root with no rows under it are indistinguishable. */
  async #recordTsportCatalogShape(source: ObservedSource): Promise<void> {
    const evaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
      "Runtime.evaluate", { expression: TSPORT_CATALOG_SHAPE_EXPRESSION, returnByValue: true }))
      .catch(() => null);
    const value = nestedValue(evaluation, "result", "value");
    if (typeof value !== "string" || value.length === 0 || value.length > 900) return;
    this.#lastCatalogShape.set(source.sourceId, value.replace(/[^ -~]/gu, ""));
    const active = this.#apsportActiveCatalogs.get(source.sourceId);
    if (active === undefined || this.#onApsportPageHealth === undefined) return;
    try {
      const shape: unknown = JSON.parse(value);
      if (!isRecord(shape) || !Number.isSafeInteger(shape.matchRows) || Number(shape.matchRows) < 0) return;
      this.#onApsportPageHealth({ sourceId: source.sourceId, tabId: source.tabId,
        rosterCount: active.rosterCount, matchRows: Number(shape.matchRows) });
    } catch { /* A malformed shape is diagnostic-only and cannot trigger recovery. */ }
  }

  async #selectTimeTab(source: ObservedSource, expression: string): Promise<boolean> {
    this.#armKsportNativeHttpCapture(source);
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
        const seen = labels
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/[^a-z0-9 ]+/gu, "").slice(0, 24))
          .filter((value) => value.length > 0)
          .slice(0, 18)
          .join("|");
        if (seen.length > 0) this.#lastTabLabels.set(source.sourceId, seen);
        diagnostic.baselineTabLabels = seen;
      }
      if (typeof status === "string") diagnostic.baselineTabStatus = status;
      else if (evaluation === null) diagnostic.baselineTabStatus = "EVALUATE_FAILED";
      if (status === "time-tab-selected" || status === "time-tab-reselected") {
        // A period click commonly replaces the provider socket and resets its
        // stream-scoped request tracker. Keep this source-level clock across
        // those replacements so maintenance cannot alternate the UI every few
        // seconds while each new subscription is still starting.
        this.#ksportPeriodSelectionAtMs.set(source.sourceId, this.#now());
        return true;
      }
      if (status === "time-tab-active") return true;
    }
    return false;
  }

  #armKsportNativeHttpCapture(source: ObservedSource): void {
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    const tabGeneration = this.#captureTabGeneration(source.tabId);
    const existing = this.#ksportNativeHttpCaptures.get(source.sourceId);
    if (existing !== undefined && existing.sourceGeneration === sourceGeneration &&
      existing.tabGeneration === tabGeneration) {
      existing.expiresAtMs = this.#now() + KSPORT_NATIVE_HTTP_CAPTURE_WINDOW_MS;
      return;
    }
    this.#ksportNativeHttpCaptures.set(source.sourceId, { sourceGeneration, tabGeneration,
      expiresAtMs: this.#now() + KSPORT_NATIVE_HTTP_CAPTURE_WINDOW_MS,
      parts: new Map<"live" | "today", KsportNativeHttpPart>() });
  }

  #currentKsportNativeHttpCapture(source: ObservedSource): KsportNativeHttpCapture | null {
    const capture = this.#ksportNativeHttpCaptures.get(source.sourceId);
    if (capture === undefined) return null;
    if (capture.expiresAtMs < this.#now() ||
      !this.#isSourceGenerationCurrent(source.sourceId, capture.sourceGeneration) ||
      this.#captureTabGeneration(source.tabId) !== capture.tabGeneration) {
      this.#ksportNativeHttpCaptures.delete(source.sourceId);
      return null;
    }
    return capture;
  }

  async start(source: ObservedSource): Promise<void> {
    if (this.#startedTabs.has(source.tabId)) return;
    if (source.lobby === "KSPORT" || source.lobby === "TSPORT" ||
      source.lobby === "SABA") this.#wsAttachDiagnostic(source);
    if (source.lobby === "SABA" || source.lobby === "CMD" || source.lobby === "KSPORT" ||
      source.lobby === "TSPORT") {
      // Runtime is sticky across MV3 workers. Reset the root domain before
      // reattaching child targets. SABA needs its OOPIF context replayed, while
      // CMD, KSPORT and TSPORT can keep their provider frames in the root
      // target and need those existing same-process main-world contexts
      // replayed as well. TSPORT needs that context to bootstrap its safe,
      // cookie-bound API template without reloading the provider page.
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
      waitForDebuggerOnStart: source.lobby === "SABA",
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
    if (source.lobby === "SABA") {
      await this.#discoverExistingSabaChildTargets(source);
    }
    if (source.lobby !== "SABA" && source.lobby !== "CMD" && source.lobby !== "KSPORT" &&
      source.lobby !== "TSPORT") {
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

  #sabaSocketAcrossSession(source: ObservedSource,
    requestId: string): [string, ObservedWebSocketState] | undefined {
    if (source.lobby !== "SABA") return undefined;
    const prefix = `${source.tabId}:`;
    const suffix = `:${requestId}`;
    const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
    let match: [string, ObservedWebSocketState] | undefined;
    for (const [candidateKey, socket] of this.#webSockets) {
      if (!candidateKey.startsWith(prefix) || !candidateKey.endsWith(suffix) ||
        socket.source.sourceId !== source.sourceId || socket.sourceGeneration !== sourceGeneration ||
        socket.closing === true) continue;
      // CDP can report webSocketCreated on the root target and later frames on
      // a SABA worker target with the same requestId. Only correlate when that
      // requestId identifies exactly one live socket in this source epoch.
      if (match !== undefined) return undefined;
      match = [candidateKey, socket];
    }
    return match;
  }

  async resetSabaSocketWorker(source: ObservedSource): Promise<number> {
    if (source.lobby !== "SABA") return 0;
    await this.#discoverExistingSabaChildTargets(source).catch(() => undefined);
    const targets = this.#sabaAttachedTargetSessions.get(source.sourceId);
    if (targets === undefined) return 0;
    let terminated = 0;
    for (const [targetId, target] of [...targets]) {
      if (target.targetType !== "worker") continue;
      try {
        await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: "(() => { if (typeof self.close !== 'function') return false; self.close(); return true; })()",
          returnByValue: true,
          awaitPromise: false
        }, target.sessionId));
        terminated += 1;
      } catch { /* Page.reload remains the bounded fallback when the worker already exited. */ }
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Target.closeTarget", {
        targetId
      })).catch(() => undefined);
      targets.delete(targetId);
      this.#observedChildSessions.get(source.sourceId)?.delete(target.sessionId);
    }
    if (targets.size === 0) this.#sabaAttachedTargetSessions.delete(source.sourceId);
    return terminated;
  }

  resetApsportRefreshCooldown(sourceId: string): void {
    this.#apsportLastRefreshStartedAtMs.delete(sourceId);
  }

  hasCompleteCmdBaselineSince(sourceId: string, startedAtMs: number): boolean {
    return (this.#cmdFullBaselineAtMs.get(sourceId) ?? Number.NEGATIVE_INFINITY) >= startedAtMs;
  }

  #clearApsportEventDetails(sourceId: string): void {
    this.#apsportActiveCatalogs.delete(sourceId);
    for (const [key, pending] of this.#apsportEventDetailTimers) {
      if (pending.sourceId !== sourceId) continue;
      clearTimeout(pending.timer);
      this.#apsportEventDetailTimers.delete(key);
    }
    for (const key of this.#apsportEventDetailLastAtMs.keys()) {
      if (key.startsWith(`${sourceId}\u0000`)) this.#apsportEventDetailLastAtMs.delete(key);
    }
    for (const key of this.#apsportEventDetailJobs.keys()) {
      if (key.startsWith(`${sourceId}\u0000`)) this.#apsportEventDetailJobs.delete(key);
    }
    this.#apsportEventDetailTails.delete(sourceId);
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
    this.#cmdFullBaselineAtMs.delete(sourceId);
    this.#cmdSnapshotHosts.delete(sourceId);
    this.#domSnapshotOrdinals.delete(sourceId);
    this.#httpSnapshots.delete(sourceId);
    this.#imSnapshotOrdinals.delete(sourceId);
    this.#ksportSnapshotOrdinals.delete(sourceId);
    this.#tsportSnapshots.delete(sourceId);
    this.#tsportRequestUrls.delete(sourceId);
    this.#apsportRequestTemplates.delete(sourceId);
    this.#apsportRefreshOrdinals.delete(sourceId);
    this.#apsportLastRefreshStartedAtMs.delete(sourceId);
    this.#clearApsportEventDetails(sourceId);
    this.#clearCatalogWsSnapshots(sourceId);
    this.#activeKsportStreams.delete(sourceId);
    this.#ksportAuthorityTransitions.delete(sourceId);
    this.#socketBaselineRecoveryAtMs.delete(sourceId);
    this.#socketBaselineRecoveries.delete(sourceId);
    this.#sabaDomBootstrapAtMs.delete(sourceId);
    this.#sabaTodayBootstrapSelected.delete(sourceId);
    this.#sabaCatalogFrameAtMs.delete(sourceId);
    this.#sabaSilentSocketRecoveryAtMs.delete(sourceId);
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
    this.#sabaAttachedTargetSessions.delete(sourceId);
    this.#wsAttachDiagnostics.delete(sourceId);
    this.#clearPreexistingSocketReconnect(sourceId);
    this.#ksportDiagnosticAtMs.delete(sourceId);
    this.#ksportRefreshesInFlight.delete(sourceId);
    this.#ksportBaselineRequests.delete(sourceId);
    this.#ksportCatalogFrameAtMs.delete(sourceId);
    this.#ksportHeartbeatForwardAtMs.delete(sourceId);
    this.#ksportBaselineAttemptAtMs.delete(sourceId);
    this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
    this.#ksportHttpFallbackModes.delete(sourceId);
    this.#ksportOrphanFrameRecoveryAtMs.delete(sourceId);
    this.#ksportNativeHttpCaptures.delete(sourceId);
    this.#ksportNativeHttpRecoveryAtMs.delete(sourceId);
    this.#sabaOrphanFrameRecoveryAtMs.delete(sourceId);
    this.#sboOrphanFrameRecoveryAtMs.delete(sourceId);
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

  beginBridgeSourceEpoch(sourceId: string): string {
    const sourceGeneration = this.#sourceGenerations.get(sourceId) ?? 0;
    // Reserve the current public identity before advancing it, including when
    // resync is the first operation observed for this source in a new worker.
    this.#publicSourceEpochOrdinal(sourceId, sourceGeneration);
    this.#bridgeEpochGenerations.set(sourceId, this.#captureBridgeGeneration(sourceId) + 1);
    this.#sequences.delete(sourceId);
    this.#emissionTails.delete(sourceId);
    return `${this.#observerSessionId}:${this.#publicSourceEpochOrdinal(sourceId, sourceGeneration)}`;
  }

  prepareDebuggerReattach(tabId: number): void {
    // Chrome can detach the extension debugger only after a reloaded page has
    // already opened its replacement socket. A full release here discards the
    // webSocketCreated event forever and every later frame becomes orphaned.
    // Fence document-bound HTTP work and child-session handles, but preserve
    // socket/request attribution until the same owned tab is reattached.
    this.#tabGenerations.set(tabId, this.#captureTabGeneration(tabId) + 1);
    this.#startedTabs.delete(tabId);
    this.#mainWorldContexts.delete(tabId);
    const sourceIds = new Set<string>();
    for (const sourceId of this.#sourceGenerations.keys()) {
      if (sourceId.endsWith(`:${tabId}`)) sourceIds.add(sourceId);
    }
    for (const socket of this.#webSockets.values()) {
      if (socket.source.tabId === tabId) sourceIds.add(socket.source.sourceId);
    }
    for (const sourceId of sourceIds) {
      this.#retireCmdRecovery(sourceId, "DOCUMENT_CHANGED");
      this.#observedChildSessions.delete(sourceId);
      this.#ksportAttachedTargetSessions.delete(sourceId);
      this.#sabaAttachedTargetSessions.delete(sourceId);
      const diagnostic = this.#wsAttachDiagnostics.get(sourceId);
      if (diagnostic !== undefined) diagnostic.attachedTargets = 0;
    }
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
    for (const sourceId of this.#apsportRequestTemplates.keys()) remember(sourceId);
    for (const sourceId of this.#catalogWsSnapshots.keys()) remember(sourceId);
    for (const sourceId of this.#sbobetEventRequests.keys()) remember(sourceId);
    for (const sourceId of this.#ksportNativeHttpCaptures.keys()) remember(sourceId);
    for (const sourceId of this.#bridgeEpochGenerations.keys()) remember(sourceId);
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
      this.#bridgeEpochGenerations.delete(sourceId);
      this.#publicSourceEpochs.delete(sourceId);
      this.#cmdSnapshots.delete(sourceId);
      this.#cmdLastBodies.delete(sourceId);
      this.#cmdLastSentAtMs.delete(sourceId);
      this.#cmdFullBaselineAtMs.delete(sourceId);
      this.#cmdSnapshotHosts.delete(sourceId);
      this.#domSnapshotOrdinals.delete(sourceId);
      this.#httpSnapshots.delete(sourceId);
      this.#imSnapshotOrdinals.delete(sourceId);
      this.#ksportSnapshotOrdinals.delete(sourceId);
      this.#tsportSnapshots.delete(sourceId);
      this.#tsportRequestUrls.delete(sourceId);
      this.#apsportRequestTemplates.delete(sourceId);
      this.#apsportRefreshOrdinals.delete(sourceId);
      this.#apsportLastRefreshStartedAtMs.delete(sourceId);
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
      this.#sabaCatalogFrameAtMs.delete(sourceId);
      this.#sabaSilentSocketRecoveryAtMs.delete(sourceId);
      this.#sbobetEventRequests.delete(sourceId);
      this.#observedChildSessions.delete(sourceId);
      this.#ksportAttachedTargetSessions.delete(sourceId);
      this.#sabaAttachedTargetSessions.delete(sourceId);
      this.#wsAttachDiagnostics.delete(sourceId);
      this.#clearPreexistingSocketReconnect(sourceId);
      this.#preexistingSocketReconnectSources.delete(sourceId);
      this.#ksportDiagnosticAtMs.delete(sourceId);
      this.#ksportRefreshesInFlight.delete(sourceId);
      this.#ksportBaselineRequests.delete(sourceId);
      this.#ksportNativeHttpCaptures.delete(sourceId);
      this.#ksportNativeHttpRecoveryAtMs.delete(sourceId);
      this.#ksportCatalogFrameAtMs.delete(sourceId);
      this.#ksportBaselineAttemptAtMs.delete(sourceId);
      this.#ksportPeriodSelectionAtMs.delete(sourceId);
      this.#ksportMaintenanceRecoveryAtMs.delete(sourceId);
      this.#ksportOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#sabaOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#sboOrphanFrameRecoveryAtMs.delete(sourceId);
      this.#apsportOrphanFrameRecoveryAtMs.delete(sourceId);
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
    const pulsePage = async (): Promise<void> => {
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Emulation.setFocusEmulationEnabled", { enabled: true })).catch(() => ({}));
      await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Page.setWebLifecycleState", { state: "active" })).catch(() => ({}));
    };
    // APSPORT's 60-second roster/detail request intentionally owns the provider
    // lane for tens of seconds. Its keep-alive pulse must not queue behind that
    // work and inherit the poller's shorter maintenance timeout.
    if (source.lobby === "TSPORT") {
      await pulsePage();
      return;
    }
    await this.#runPeriodicDomWork(source.sourceId, async () => {
      await pulsePage();
      const expression = source.lobby === "CMD" ? CMD_CATALOG_DISCOVERY_EXPRESSION :
        source.lobby === "KSPORT" ? KSPORT_FOOTBALL_DISCOVERY_EXPRESSION : KEEP_ACTIVE_EXPRESSION;
      if (source.lobby === "IM" || source.lobby === "SABA") {
        // IM's baseline is large and two-part. Request it only from the explicit
        // recovery path below; running the same fetch here can consume the
        // recovery window and leave Market 1 unavailable when Chrome evicts its
        // debugger body. SABA is WebSocket-authoritative; walking every DOM node
        // and clicking expansion controls only burns renderer CPU and cannot
        // replace its reset/done baseline. Focus/lifecycle commands above are
        // enough to keep these providers active.
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
    // SABA's Socket.IO connection can die without a close event; the DOM
    // fallback then only covers the visible viewport. Once the socket has
    // been silent for a full minute, ask the page to reconnect it (bounded to
    // once per minute). The silence clock is seeded on the first poll so a
    // worker restart landing on an already-dead socket still recovers.
    const silenceNowMs = this.#now();
    const lastSabaFrameAtMs = this.#sabaCatalogFrameAtMs.get(source.sourceId) ??
      (this.#sabaCatalogFrameAtMs.set(source.sourceId, silenceNowMs), silenceNowMs);
    if (silenceNowMs - lastSabaFrameAtMs > 60_000 &&
      silenceNowMs - (this.#sabaSilentSocketRecoveryAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) > 60_000) {
      this.#sabaSilentSocketRecoveryAtMs.set(source.sourceId, silenceNowMs);
      await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
    }
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
      await this.#renewKsportBaselineLease(source, nowMs);
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
      const refreshed = await this.#refreshKsportHttpFallback(source, nowMs);
      // A captured getEvent URL is tied to transient page state and can stop
      // producing a usable paired baseline. Once the provider-tab retry clock
      // permits it, ask the page to issue fresh native Live/Today requests so
      // their successful response bodies can replace the stale template.
      if (!refreshed) await this.#ensureCompleteKsportBaseline(source);
      return;
    }
    const refreshed = await this.#refreshKsportHttpFallback(source, nowMs);
    if (!refreshed) await this.#requestFreshKsportNativeHttpBaseline(source);
    await this.#requestFreshSocketBaseline(source, isKsportCatalogSocket);
  }

  async #refreshKsportHttpFallback(source: ObservedSource, nowMs: number,
    mode?: KsportHttpFallbackMode): Promise<boolean> {
    const lastRecoveryAtMs = this.#ksportMaintenanceRecoveryAtMs.get(source.sourceId);
    if (lastRecoveryAtMs !== undefined &&
      nowMs - lastRecoveryAtMs < KSPORT_HTTP_RECONCILE_INTERVAL_MS) return false;
    this.#ksportMaintenanceRecoveryAtMs.set(source.sourceId, nowMs);
    this.#ksportRefreshesInFlight.add(source.sourceId);
    try {
      const refreshed = await this.#requestFreshKsportHttpBaseline(source);
      if (!refreshed) return false;
      if (mode === undefined) {
        const active = this.#activeKsportSocket(source.sourceId)?.[1];
        this.#ksportHttpFallbackModes.set(source.sourceId, {
          streamId: active?.streamId ?? null,
          recoveryGeneration: active?.ksportRecovery?.currentGeneration ?? null
        });
      }
      return true;
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
    if (resolution?.outcome === "SUCCESS") {
      this.#cmdFullBaselineAtMs.set(pending.source.sourceId, this.#now());
      this.#finishCmdRecovery(active);
    }
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

  async refreshCatalog(source: ObservedSource, options: CatalogRefreshOptions = {}): Promise<void> {
    if (source.lobby === "CMD") return this.recoverCmdCatalog(source);
    // Where a recovery request dies is otherwise invisible from the API side;
    // these labels ride the wsAttach diagnostic so the next silent stall names
    // its own step (measured 2026-09-01: SABA reconnectAttempts stayed 0 with
    // no visible reason across two extension builds).
    if (source.lobby === "SABA") this.#noteWsRecoveryOutcome(source, "refresh:enter");
    const prioritizeApsportRoster = source.lobby === "TSPORT" && options.rosterOnly === true;
    if (prioritizeApsportRoster) {
      // A current roster after bridge/API restart outranks per-event detail
      // enrichment. Re-arm the catalog cooldown so this recovery cannot be
      // coalesced away, but keep the independent deduplicated detail queue: it
      // yields after each request and the roster reserves the next page turn.
      this.#apsportLastRefreshStartedAtMs.delete(source.sourceId);
    }
    const existing = this.#catalogRefreshes.get(source.sourceId);
    if (existing !== undefined) {
      if (prioritizeApsportRoster) {
        // A bridge resync cannot wait behind the rate-limited all-event detail
        // walk: while it waits, the disconnected loopback bridge accumulates
        // live socket frames and can overflow into another resync. Advancing
        // the catalog ordinal makes the running collector's isCurrent() false;
        // the provider lane then starts this short roster generation next.
        this.#apsportRefreshOrdinals.set(source.sourceId,
          (this.#apsportRefreshOrdinals.get(source.sourceId) ?? 0) + 1);
        this.#catalogRefreshes.delete(source.sourceId);
      } else {
        if (source.lobby === "SABA") this.#noteWsRecoveryOutcome(source, "refresh:dedupe");
        return existing;
      }
    }
    const operation = this.#runPeriodicDomWork(source.sourceId, () => this.#refreshCatalog(source, options))
      .catch((error: unknown) => {
        if (source.lobby === "SABA") this.#noteWsRecoveryOutcome(source, `refresh:fail-${failureLabel(error)}`);
        throw error;
      })
      .finally(() => {
      if (this.#catalogRefreshes.get(source.sourceId) === operation) this.#catalogRefreshes.delete(source.sourceId);
    });
    this.#catalogRefreshes.set(source.sourceId, operation);
    return operation;
  }

  async #refreshCatalog(source: ObservedSource, _options: CatalogRefreshOptions): Promise<void> {
    if (source.lobby === "IM") {
      const results = await this.#evaluateImCatalogMainWorlds(source, true);
      await this.#emit(source, "https://imsports.directsb.net/__fieldline_im_catalog_refresh__",
        "Diagnostic", "TAB_STATE", {
          encoding: "UTF8", body: JSON.stringify({ results })
      });
      return;
    }
    if (source.lobby === "SABA") {
      // A C-SPORTS schedule launch lands on one live event. Its authenticated
      // `Hôm Nay` tab issues the provider's complete football reset/done
      // baseline (measured live: 5 -> 360 events) without navigating or
      // replaying the one-time launch URL. Attach first, then make this one
      // ordinary page selection so every baseline frame is observed.
      this.#noteWsRecoveryOutcome(source, "refresh:run");
      if (await this.#selectSabaTodayTab(source) === "selected") return;
      // Measured 2026-09-01: with the socket streaming deltas and never
      // resending reset, every API recovery request reached this branch and
      // reconnectAttempts stayed at 0 for twenty minutes. The steps before the
      // reconnect are evidence priming only; none of them may stop the one
      // action that actually reseeds the lane, and each failure is named in the
      // wsAttach diagnostic so the next stall is not silent.
      try {
        const replayed = await this.#replayCatalogWsSnapshots(source.sourceId);
        if (!replayed) {
          await this.#restoreSabaWsSnapshots(source);
          await this.#replayCatalogWsSnapshots(source.sourceId);
        }
      } catch (error) {
        this.#noteWsRecoveryOutcome(source, `refresh:replay-${failureLabel(error)}`);
      }
      const nowMs = this.#now();
      if (nowMs - (this.#sabaDomBootstrapAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) >= 4_000) {
        this.#sabaDomBootstrapAtMs.set(source.sourceId, nowMs);
        // Durable frames prime decoder state only. Always follow them with two
        // bounded current-document DOM generations; neither path is allowed to
        // establish or renew network authority. A fresh Socket.IO OPEN plus
        // reset/done remains the only SABA LIVE proof.
        try {
          await this.#capturePublicCatalogSnapshot(source, "saba.invalid", CMD_PUBLIC_CATALOG_EXPRESSION, true, true);
        } catch (error) {
          this.#noteWsRecoveryOutcome(source, `refresh:dom-${failureLabel(error)}`);
        }
      }
      await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
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
      const footballStatus = nestedValue(footballSelection, "result", "value", "status");
      // Every outcome of this click looks the same from outside, and the page
      // has been seen publishing nothing but its jackpot topic - which is what
      // the promotional football group opens. Whether the real group was found,
      // was already active, or is not on the page decides the next fix.
      this.#lastCaptureExit.set(source.sourceId,
        `FOOTBALL_${typeof footballStatus === "string" ? footballStatus : "NO_ANSWER"}`);
      if (footballStatus === "football-selected") return;
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
      // A KSPORT socket becomes canonical only after the page itself sends a
      // football live/today SUBSCRIBE. Closing that socket here used to race
      // the provider's first full receipts: the explicit same-tab recovery
      // selected Football, then immediately heap-closed the newly subscribed
      // socket and only the unrelated jackpot stream came back. Keep the
      // provider-owned socket open and ask its structural period control for
      // the missing partition instead. The periodic quiet-socket path remains
      // independently bounded for genuinely dead transports.
      if (this.#activeKsportSocket(source.sourceId) !== undefined) {
        await this.#ensureCompleteKsportBaseline(source);
        return;
      }
      if (await this.#requestFreshKsportNativeHttpBaseline(source)) return;
      await this.#requestFreshSocketBaseline(source, isKsportCatalogSocket);
      return;
    }
    if (source.lobby === "SBO") {
      if (await this.#replayCatalogWsSnapshots(source.sourceId)) return;
      await this.#requestFreshSocketBaseline(source, (url) => /\/socket\.io\/?$/u.test(url.pathname));
      return;
    }
    if (source.lobby === "TSPORT") {
      return this.#refreshApsportCatalog(source, _options);
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

  async #selectSabaTodayTab(source: ObservedSource): Promise<"selected" | "active" | null> {
    if (this.#sabaTodayBootstrapSelected.has(source.sourceId)) return "active";
    const diagnostic = this.#wsAttachDiagnostic(source);
    diagnostic.baselineTabSelections += 1;
    const targets: Array<{ readonly contextId?: number; readonly sessionId?: string }> = [
      ...[...(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])].map((binding) => ({
        contextId: binding.contextId,
        ...(binding.sessionId === undefined ? {} : { sessionId: binding.sessionId })
      })),
      {}
    ];
    const evaluate = async (target: { readonly contextId?: number; readonly sessionId?: string }) => {
      const params = { expression: SABA_TODAY_BASELINE_EXPRESSION,
        ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
        returnByValue: true, awaitPromise: false };
      const evaluation = await this.#withFrameCommandTimeout(target.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, target.sessionId)).catch(() => null);
      const status = nestedValue(evaluation, "result", "value", "status");
      if (typeof status === "string") diagnostic.baselineTabStatus = status;
      return status;
    };
    const accept = (status: unknown): "selected" | "active" | null => {
      if (status === "today-tab-selected") {
        this.#sabaTodayBootstrapSelected.add(source.sourceId);
        return "selected";
      }
      // Clicking a period tab that is already active is not a page selection
      // the provider answers with reset/done - it is a no-op the caller must
      // not mistake for a baseline in flight. Remember that the control was
      // reached so it is not clicked again, and let the caller fall through to
      // the socket reconnect that actually reseeds the lane.
      if (status === "today-tab-reselected") {
        this.#sabaTodayBootstrapSelected.add(source.sourceId);
        return "active";
      }
      return status === "today-tab-active" ? "active" : null;
    };
    diagnostic.baselineTabTargets = targets.length;
    for (const target of targets) {
      const accepted = accept(await evaluate(target));
      if (accepted !== null) return accepted;
    }
    // Runtime.enable normally replays every current main-world context, but a
    // worker reload can attach after SABA's cross-origin sportsFrame is already
    // running without receiving that event. Discover the live frame tree and
    // create a bounded isolated world in each child so the authenticated period
    // control remains reachable without navigating the one-time launch URL.
    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Page.getFrameTree")
    ).catch(() => null);
    const childFrameIds = collectFrameIds(frameTree).slice(1);
    diagnostic.baselineTabTargets += childFrameIds.length;
    for (const frameId of childFrameIds) {
      const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Page.createIsolatedWorld", {
          frameId, worldName: "fieldline-saba-time-baseline", grantUniveralAccess: false
        })).catch(() => null);
      const contextId = nestedNumber(world, "executionContextId");
      if (contextId === null) continue;
      const accepted = accept(await evaluate({ contextId }));
      if (accepted !== null) return accepted;
    }
    return null;
  }

  async #bootstrapApsportRequestTemplate(source: ObservedSource, sourceGeneration: number,
    tabGeneration: number): Promise<BoundApsportRequestTemplate | null> {
    const contexts = [...(this.#mainWorldContexts.get(source.tabId)?.entries() ?? [])];
    for (const [frameId, binding] of contexts) {
      const params = { expression: APSPORT_BOOTSTRAP_EXPRESSION, contextId: binding.contextId,
        returnByValue: true, awaitPromise: false };
      const evaluation = await this.#withFrameCommandTimeout(binding.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId)).catch(() => null);
      const value = nestedValue(evaluation, "result", "value");
      if (!isRecord(value) || typeof value.origin !== "string" || typeof value.language !== "string" ||
        typeof value.timeZone !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/u.test(value.language) ||
        value.timeZone.length > 128 ||
        !/^[A-Za-z0-9_+.-]{1,64}(?:\/[A-Za-z0-9_+.-]{1,64})*$/u.test(value.timeZone)) continue;
      let origin: URL;
      try { origin = new URL(value.origin); } catch { continue; }
      if (value.origin !== origin.origin || origin.protocol !== "https:" || origin.username !== "" ||
        origin.password !== "" || origin.search !== "" || origin.hash !== "" ||
        !/^(?:spbui|spbtui)\.agenate\.com$/u.test(origin.hostname)) continue;
      const frameTree = await this.#withFrameCommandTimeout(binding.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Page.getFrameTree")
        : this.#sendCommand(source.tabId, "Page.getFrameTree", {}, binding.sessionId)).catch(() => null);
      const loaderId = currentFrameLoader(frameTree, frameId);
      if (loaderId === null || !this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration) ||
        this.#captureTabGeneration(source.tabId) !== tabGeneration ||
        this.#mainWorldContexts.get(source.tabId)?.get(frameId) !== binding) continue;
      const template: BoundApsportRequestTemplate = {
        origin: origin.origin,
        headers: { "content-type": "application/json", lng: value.language, tz: value.timeZone },
        body: { mno: 2, si: 1, mg: 1 },
        frameId, loaderId,
        ...(binding.sessionId === undefined ? {} : { sessionId: binding.sessionId }),
        sourceGeneration, tabGeneration
      };
      this.#apsportRequestTemplates.set(source.sourceId, template);
      return template;
    }
    return null;
  }

  #apsportTemplateIsCurrent(source: ObservedSource, template: BoundApsportRequestTemplate): boolean {
    return this.#apsportRequestTemplates.get(source.sourceId) === template &&
      this.#isSourceGenerationCurrent(source.sourceId, template.sourceGeneration) &&
      this.#captureTabGeneration(source.tabId) === template.tabGeneration;
  }

  async #requestApsportPage(source: ObservedSource, template: BoundApsportRequestTemplate,
    input: ApsportCatalogPageRequest) {
    if (!this.#apsportTemplateIsCurrent(source, template)) return { status: 0, data: null };
    const prior = this.#apsportPageRequestTails.get(source.sourceId) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.catch(() => undefined).then(() => turn);
    this.#apsportPageRequestTails.set(source.sourceId, tail);
    await prior.catch(() => undefined);
    try {
      if (!this.#apsportTemplateIsCurrent(source, template)) return { status: 0, data: null };
      this.#lastCaptureExit.set(source.sourceId, `APSPORT_${input.kind}_START`);
      const binding = this.#mainWorldContexts.get(source.tabId)?.get(template.frameId);
      if (binding === undefined || binding.sessionId !== template.sessionId) return { status: 0, data: null };
      let expression: string;
      try { expression = buildApsportPageRequestExpression(template, input); }
      catch { return { status: 0, data: null }; }
      const params = { expression, contextId: binding.contextId, returnByValue: true, awaitPromise: true };
      const evaluation = await this.#withFrameCommandTimeout(binding.sessionId === undefined
        ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
        : this.#sendCommand(source.tabId, "Runtime.evaluate", params, binding.sessionId),
      APSPORT_PAGE_REQUEST_TIMEOUT_MS).catch(() => null);
      const response = apsportPageResponseFromEvaluation(evaluation);
      this.#lastCaptureExit.set(source.sourceId, `APSPORT_${input.kind}_${response.status}`);
      return response;
    } finally {
      release();
      if (this.#apsportPageRequestTails.get(source.sourceId) === tail) {
        this.#apsportPageRequestTails.delete(source.sourceId);
      }
    }
  }

  #scheduleApsportEventDetail(source: ObservedSource, eventId: string, leagueId?: string): void {
    const active = this.#apsportActiveCatalogs.get(source.sourceId);
    if (source.lobby !== "TSPORT" || eventId.trim() === "" || eventId.length > 128 ||
      active === undefined || !active.rosterEventIds.has(eventId) ||
      !this.#apsportRequestTemplates.has(source.sourceId)) return;
    const key = `${source.sourceId}\u0000${eventId}`;
    if (this.#apsportEventDetailJobs.has(key)) return;
    const token = Symbol(eventId);
    this.#apsportEventDetailJobs.set(key, token);
    const nowMs = this.#now();
    const previousAtMs = this.#apsportEventDetailLastAtMs.get(key);
    const delayMs = previousAtMs === undefined ? APSPORT_EVENT_DETAIL_DEBOUNCE_MS : Math.max(
      APSPORT_EVENT_DETAIL_DEBOUNCE_MS,
      previousAtMs + APSPORT_EVENT_DETAIL_MIN_INTERVAL_MS - nowMs
    );
    const timer = setTimeout(() => {
      if (this.#apsportEventDetailJobs.get(key) !== token) return;
      this.#apsportEventDetailTimers.delete(key);
      this.#apsportEventDetailLastAtMs.set(key, this.#now());
      const prior = this.#apsportEventDetailTails.get(source.sourceId) ?? Promise.resolve();
      const operation = prior.catch(() => undefined).then(async () => {
        await this.#refreshApsportEventDetail(source, eventId, leagueId);
        // Preserve the provider-safe cadence used by full sweeps while the
        // independent queue works through every roster event.
        await new Promise<void>((resolve) => setTimeout(resolve, APSPORT_DETAIL_DELAY_MS));
      });
      this.#apsportEventDetailTails.set(source.sourceId, operation);
      void operation.finally(() => {
        if (this.#apsportEventDetailJobs.get(key) === token) this.#apsportEventDetailJobs.delete(key);
        if (this.#apsportEventDetailTails.get(source.sourceId) === operation) {
          this.#apsportEventDetailTails.delete(source.sourceId);
        }
      });
    }, delayMs);
    this.#apsportEventDetailTimers.set(key, { sourceId: source.sourceId, timer });
  }

  async #refreshApsportEventDetail(source: ObservedSource, eventId: string, leagueId?: string): Promise<void> {
    const template = this.#apsportRequestTemplates.get(source.sourceId);
    const rosterLeagueId = leagueId ??
      this.#apsportActiveCatalogs.get(source.sourceId)?.rosterLeagueIds.get(eventId);
    const currentRosterContainsEvent = (): boolean =>
      this.#apsportActiveCatalogs.get(source.sourceId)?.rosterEventIds.has(eventId) === true;
    if (!currentRosterContainsEvent() || template === undefined) return;
    // A large all-future roster can take several minutes to hydrate. Its
    // periodic one-minute roster renewal must not discard the one detail
    // response already in flight when the event still belongs to the newer
    // roster and the authenticated page/template identity has not changed.
    const isCurrent = (): boolean => currentRosterContainsEvent() &&
      this.#apsportTemplateIsCurrent(source, template);
    const detailed = await this.#collectApsportEventDetail({ eventId,
      ...(rosterLeagueId === undefined ? {} : { leagueId: rosterLeagueId }),
      template: { origin: template.origin, headers: template.headers, body: template.body },
      request: (input) => this.#requestApsportPage(source, template, input),
      sleep: (delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)), isCurrent });
    const active = this.#apsportActiveCatalogs.get(source.sourceId);
    if (detailed === null || !isCurrent() || active === undefined) return;
    const batch: ApsportCatalogBatch = { schemaVersion: 1, generation: active.generation,
      phase: "DETAIL", complete: false, trigger: "EVENT_CHANGE",
      prematchWindowHours: active.prematchWindowHours, records: [detailed] };
    await this.ingestHttpResponse(source,
      `${template.origin}/__fieldline_apsport_catalog_refresh__`, "Fetch", JSON.stringify(batch), {
        method: "POST", verifiedDocument: { frameId: template.frameId, loaderId: template.loaderId,
          ...(template.sessionId === undefined ? {} : { sessionId: template.sessionId }) }
      });
  }

  async #probeApsportEventDetail(source: ObservedSource,
    request: SelectionPriceProbeIdentity): Promise<Record<string, unknown> | null> {
    const template = this.#apsportRequestTemplates.get(source.sourceId);
    if (template === undefined) return null;
    const leagueId = this.#apsportActiveCatalogs.get(source.sourceId)
      ?.rosterLeagueIds.get(request.providerEventId);
    const isCurrent = (): boolean => this.#apsportTemplateIsCurrent(source, template);
    const detailed = await this.#collectApsportEventDetail({ eventId: request.providerEventId,
      ...(leagueId === undefined ? {} : { leagueId }),
      template: { origin: template.origin, headers: template.headers, body: template.body },
      request: (input) => this.#requestApsportPage(source, template, input),
      sleep: (delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)), isCurrent });
    if (detailed === null || !isCurrent()) return null;
    const observedAtMs = this.#now();
    const active = this.#apsportActiveCatalogs.get(source.sourceId);
    if (active !== undefined) {
      const batch: ApsportCatalogBatch = { schemaVersion: 1, generation: active.generation,
        phase: "DETAIL", complete: false, trigger: "EVENT_CHANGE",
        prematchWindowHours: active.prematchWindowHours, records: [detailed] };
      await this.ingestHttpResponse(source,
        `${template.origin}/__fieldline_apsport_catalog_refresh__`, "Fetch", JSON.stringify(batch), {
          method: "POST", verifiedDocument: { frameId: template.frameId, loaderId: template.loaderId,
            ...(template.sessionId === undefined ? {} : { sessionId: template.sessionId }) }
        });
    }
    const result = apsportSelectionPriceFromEvent(detailed, request);
    return result.status === "FOUND"
      ? { ok: true, rawOdds: result.rawOdds, observedAtMs, method: "IN_PAGE_FETCH" }
      : { ok: false, observedAtMs, method: "IN_PAGE_FETCH",
        reason: result.status === "AMBIGUOUS" ? "TSPORT_SELECTION_AMBIGUOUS" : "TSPORT_SELECTION_NOT_FOUND" };
  }

  async #refreshApsportCatalog(source: ObservedSource, options: CatalogRefreshOptions): Promise<void> {
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    const tabGeneration = this.#captureTabGeneration(source.tabId);
    // A template belongs to the source and tab generation it was captured in,
    // and both move on every reconnect. Reusing whatever was cached and then
    // refusing to act on it left the book with one roster for its whole life:
    // measured 2026-08-29, APSPORT's source had reached generation 20 while its
    // catalog still carried generation 1, so no baseline had arrived in four
    // and a half minutes against a two-minute limit and the feed sat in hard
    // recovery while its socket delivered evidence every 200ms.
    const cached = this.#apsportRequestTemplates.get(source.sourceId);
    const template = cached !== undefined && cached.sourceGeneration === sourceGeneration &&
      cached.tabGeneration === tabGeneration
      ? cached
      : await this.#bootstrapApsportRequestTemplate(source, sourceGeneration, tabGeneration);
    if (template === undefined || template === null) {
      this.#lastCaptureExit.set(source.sourceId, "APSPORT_REQUEST_TEMPLATE_MISSING");
      return;
    }
    const prematchWindowHours = options.prematchWindowHours ?? 24;
    if (!Number.isSafeInteger(prematchWindowHours) || prematchWindowHours < 1 || prematchWindowHours > 48) {
      this.#lastCaptureExit.set(source.sourceId, "APSPORT_PREMATCH_WINDOW_INVALID");
      return;
    }
    // Only reachable when a generation moved during the bootstrap above; the
    // next refresh rebuilds against the newer one. Named because a refresh that
    // stops here stops the book's whole catalog.
    if (template.sourceGeneration !== sourceGeneration || template.tabGeneration !== tabGeneration) {
      this.#lastCaptureExit.set(source.sourceId, "APSPORT_TEMPLATE_GENERATION_STALE");
      return;
    }
    const refreshStartedAtMs = this.#now();
    const previousRefreshAtMs = this.#apsportLastRefreshStartedAtMs.get(source.sourceId);
    if (previousRefreshAtMs !== undefined &&
      refreshStartedAtMs - previousRefreshAtMs < APSPORT_CATALOG_REFRESH_INTERVAL_MS) {
      this.#lastCaptureExit.set(source.sourceId, "APSPORT_REFRESH_COALESCED");
      return;
    }
    this.#apsportLastRefreshStartedAtMs.set(source.sourceId, refreshStartedAtMs);
    const ordinal = (this.#apsportRefreshOrdinals.get(source.sourceId) ?? 0) + 1;
    this.#apsportRefreshOrdinals.set(source.sourceId, ordinal);
    const generation = `apsport:${source.tabId}:${ordinal}`;
    const templateIsCurrent = (): boolean => this.#apsportTemplateIsCurrent(source, template) &&
      this.#apsportRefreshOrdinals.get(source.sourceId) === ordinal;
    let rosterOnlyComplete = false;
    const refreshIsCurrent = (): boolean => templateIsCurrent() && !rosterOnlyComplete;
    const request = (input: ApsportCatalogPageRequest) => this.#requestApsportPage(source, template, input);
    const emitBatch = async (batch: ApsportCatalogBatch): Promise<void> => {
      if (!templateIsCurrent()) return;
      await this.ingestHttpResponse(source,
        `${template.origin}/__fieldline_apsport_catalog_refresh__`, "Fetch", JSON.stringify(batch), {
          method: "POST",
          verifiedDocument: { frameId: template.frameId, loaderId: template.loaderId,
            ...(template.sessionId === undefined ? {} : { sessionId: template.sessionId }) }
        });
    };
    this.#lastCaptureExit.set(source.sourceId, "APSPORT_REFRESH_START");
    this.#apsportRefreshesInFlight.add(source.sourceId);
    try {
      await this.#collectApsportCatalog({ generation, nowMs: refreshStartedAtMs, prematchWindowHours,
        template: { origin: template.origin, headers: template.headers, body: template.body }, request,
        sleep: (delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
        isCurrent: refreshIsCurrent, onRoster: async (batch) => {
          await emitBatch(batch);
          if (templateIsCurrent() && batch.complete) {
            const roster = batch.records.flatMap((record) => {
              const rawEventId = record["2"];
              const eventId = typeof rawEventId === "string" || typeof rawEventId === "number"
                ? String(rawEventId) : "";
              const rawLeagueId = record["1"];
              const leagueId = typeof rawLeagueId === "string" || typeof rawLeagueId === "number"
                ? String(rawLeagueId) : undefined;
              return eventId.trim() === "" || eventId.length > 128 ? [] : [{ eventId, leagueId }];
            });
            const rosterLeagueIds = new Map(roster.flatMap(({ eventId, leagueId }) =>
              leagueId === undefined ? [] : [[eventId, leagueId] as const]));
            this.#apsportActiveCatalogs.set(source.sourceId,
              { generation: batch.generation, prematchWindowHours: batch.prematchWindowHours,
                rosterCount: batch.records.length, rosterLeagueIds,
                rosterEventIds: new Set(roster.map(({ eventId }) => eventId)) });
            if (options.rosterOnly === true) {
              for (const item of roster) this.#scheduleApsportEventDetail(source, item.eventId, item.leagueId);
            }
          }
          if (options.rosterOnly === true && batch.complete) rosterOnlyComplete = true;
        }, onDetail: emitBatch,
        detailBatchSize: 5, detailDelayMs: APSPORT_DETAIL_DELAY_MS });
      if (templateIsCurrent()) this.#lastCaptureExit.set(source.sourceId, "APSPORT_REFRESH_DONE");
    } finally {
      this.#apsportRefreshesInFlight.delete(source.sourceId);
    }
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
        expression: "globalThis.WebSocket && globalThis.WebSocket.prototype",
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

  async #requestFreshSocketBaseline(source: ObservedSource, matches: (url: URL) => boolean,
    preferredSessionId?: string): Promise<void> {
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
        : [{ ...(preferredSessionId !== undefined ? { sessionId: preferredSessionId }
            : active?.sessionId === undefined ? {} : { sessionId: active.sessionId }) }];
    if (preferredSessionId !== undefined) {
      const preferredIndex = targets.findIndex((target) => target.sessionId === preferredSessionId);
      if (preferredIndex < 0) targets.unshift({ sessionId: preferredSessionId });
      else if (preferredIndex > 0) targets.unshift(...targets.splice(preferredIndex, 1));
    }
    if (active !== undefined && !targets.some((target) => target.contextId === undefined &&
      target.sessionId === active.sessionId)) {
      targets.push({ ...(active.sessionId === undefined ? {} : { sessionId: active.sessionId }) });
    }
    if (source.lobby === "KSPORT") {
      // KSPORT currently owns its catalog socket in a dedicated worker. Heap
      // discovery in a page context can be slow enough to consume the entire
      // bounded recovery window, so address attached socket targets before any
      // root/iframe main worlds. Keep those worlds as fallbacks for older UI
      // versions where the socket was page-owned.
      const attachedSocketTargets = [...(this.#ksportAttachedTargetSessions.get(source.sourceId)?.values() ?? [])]
        .filter((sessionId) => !targets.some((target) =>
          target.contextId === undefined && target.sessionId === sessionId))
        .map((sessionId) => ({ sessionId }));
      targets.unshift(...attachedSocketTargets);
    }
    const sabaAttachedTargets = source.lobby === "SABA"
      ? [...(this.#sabaAttachedTargetSessions.get(source.sourceId)?.values() ?? [])]
      : [];
    const sabaWorkerSessions = source.lobby === "SABA"
      ? new Set(sabaAttachedTargets.filter((target) => target.targetType === "worker")
        .map((target) => target.sessionId))
      : new Set<string>();
    if (source.lobby === "SABA") {
      // SABA can keep Engine.IO in a dedicated worker while CDP attributes the
      // surviving socket frames to the root tab after an MV3 restart. Probe
      // attached workers before page heaps so the replacement OPEN is observed
      // without navigating or focusing the provider tab.
      const attachedSocketTargets = sabaAttachedTargets.map((target) => target.sessionId)
        .filter((sessionId) => !targets.some((target) =>
          target.contextId === undefined && target.sessionId === sessionId))
        .map((sessionId) => ({ sessionId }));
      targets.unshift(...attachedSocketTargets);
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
      prototypeExpression: "globalThis.WebSocket && globalThis.WebSocket.prototype",
      reconnect: `function() { let count = 0; for (const socket of this) { try {
        if (!socket || socket.readyState !== 1) continue;
        const url = new URL(socket.url, globalThis.location?.href || socket.url);
        if (!/\\/sport\\//u.test(url.pathname)) continue;
        socket.close(4000, "fieldline-baseline-recovery"); count += 1;
      } catch {} } return count; }`
    }];
    const reconnectDiagnostic = this.#wsAttachDiagnostic(source);
    reconnectDiagnostic.reconnectAttempts += 1;
    const noteOutcome = (target: { readonly contextId?: number; readonly sessionId?: string },
      outcome: string): void => {
      const label = `${target.sessionId !== undefined ? "session" : target.contextId !== undefined
        ? "context" : "root"}:${outcome}`;
      const entries = reconnectDiagnostic.reconnectOutcomes.length === 0 ? []
        : reconnectDiagnostic.reconnectOutcomes.split(" ");
      entries.push(label);
      reconnectDiagnostic.reconnectOutcomes = entries.slice(-12).join(" ");
    };
    for (const target of targets) {
      const sendToSocketTarget = (method: string, params: Record<string, unknown>): Promise<unknown> =>
        target.sessionId === undefined
          ? this.#sendCommand(source.tabId, method, params)
          : this.#sendCommand(source.tabId, method, params, target.sessionId);
      const group = `fieldline-baseline-recovery-${source.tabId}`;
      try {
        const targetStrategies = source.lobby === "SABA" && target.sessionId !== undefined &&
          sabaWorkerSessions.has(target.sessionId) ? [{
            prototypeExpression: "globalThis.io && globalThis.io.Socket && globalThis.io.Socket.prototype",
            reconnect: `function() { let count = 0; for (const socket of this) { try {
              if (!socket || !socket.connected || !socket.io) continue;
              socket.disconnect(); socket.connect(); count += 1;
            } catch {} } return count; }`
          }, {
            prototypeExpression: "globalThis.WebSocket && globalThis.WebSocket.prototype",
            reconnect: `function() { let count = 0; for (const socket of this) { try {
              if (!socket || socket.readyState !== 1) continue;
              const url = new URL(socket.url, globalThis.location?.href || socket.url);
              if (!/\\/socket\\.io\\/?$/u.test(url.pathname)) continue;
              socket.close(4000, "fieldline-baseline-recovery"); count += 1;
            } catch {} } return count; }`
          }] : strategies;
        for (const strategy of targetStrategies) {
          if (!isCurrent()) return;
          const prototype = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.evaluate", {
            expression: strategy.prototypeExpression,
            ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
            objectGroup: group, returnByValue: false
          }), this.#frameCommandTimeoutMs).catch(() => null);
          if (!isCurrent()) return;
          const prototypeId = nestedValue(prototype, "result", "objectId");
          if (typeof prototypeId !== "string") { noteOutcome(target, "no-prototype"); continue; }
          if (!isCurrent()) return;
          const queried = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.queryObjects", {
            prototypeObjectId: prototypeId, objectGroup: group
          }), source.lobby === "SABA" ? SABA_SOCKET_RECOVERY_QUERY_TIMEOUT_MS :
              this.#frameCommandTimeoutMs)
            .catch(() => null);
          if (!isCurrent()) return;
          const instancesId = nestedValue(queried, "objects", "objectId");
          if (typeof instancesId !== "string") { noteOutcome(target, "no-instances"); continue; }
          if (!isCurrent()) return;
          const result = await this.#withFrameCommandTimeout(sendToSocketTarget("Runtime.callFunctionOn", {
            objectId: instancesId, functionDeclaration: strategy.reconnect, returnByValue: true
          })).catch(() => null);
          if (!isCurrent()) return;
          const count = nestedValue(result, "result", "value");
          noteOutcome(target, `closed-${typeof count === "number" ? count : "err"}`);
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
    watchPreexistingSocket = false, targetType: "iframe" | "worker" = "iframe"): Promise<void> {
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
      // Dedicated workers cannot own nested targets. Some Chromium builds
      // reject Target.setAutoAttach in that session before Network/Runtime is
      // committed, which used to discard the real KSPORT socket worker.
      if (targetType !== "worker") {
        await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Target.setAutoAttach", {
          autoAttach: true, waitForDebuggerOnStart: true, flatten: true
        }, sessionId));
      }
      if (targetType !== "worker" || source.lobby === "SABA") {
        await this.#withFrameCommandTimeout(
          this.#sendCommand(source.tabId, "Runtime.runIfWaitingForDebugger", {}, sessionId)
        );
      }
    } catch (error) {
      observedSessions.delete(sessionId);
      if (observedSessions.size === 0) this.#observedChildSessions.delete(source.sourceId);
      throw error;
    }
    if (source.lobby === "SABA" && targetId !== undefined) {
      const attachedTargets = this.#sabaAttachedTargetSessions.get(source.sourceId) ??
        new Map<string, { readonly sessionId: string; readonly targetType: "iframe" | "worker" }>();
      attachedTargets.set(targetId, { sessionId, targetType });
      this.#sabaAttachedTargetSessions.set(source.sourceId, attachedTargets);
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
    const matchingTargets = infos.slice(0, 32).filter((info) => isRecord(info) &&
      typeof info.type === "string" && typeof info.targetId === "string" &&
      typeof info.url === "string" && isKsportChildTargetUrl(info.url, info.type));
    const diagnostic = this.#wsAttachDiagnostic(source);
    diagnostic.ksportTargets = matchingTargets.length;
    diagnostic.targetsTotal = infos.length;
    diagnostic.targetsIframe = infos.filter((info) => isRecord(info) && info.type === "iframe").length;
    for (const info of infos.slice(0, 32)) {
      if (!isRecord(info) || typeof info.type !== "string" || typeof info.targetId !== "string" ||
        typeof info.url !== "string" || !isKsportChildTargetUrl(info.url, info.type) ||
        this.#ksportAttachedTargetSessions.get(source.sourceId)?.has(info.targetId) === true) continue;
      const attached = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Target.attachToTarget", { targetId: info.targetId, flatten: true })).catch(() => ({}));
      const childSessionId = nestedValue(attached, "sessionId");
      if (typeof childSessionId !== "string") continue;
      await this.#observeChildTarget(source, childSessionId, info.targetId, true,
        info.type === "worker" ? "worker" : "iframe").catch(() => undefined);
    }
    diagnostic.attachedTargets = this.#ksportAttachedTargetSessions.get(source.sourceId)?.size ?? 0;
  }

  async #discoverExistingSabaChildTargets(source: ObservedSource): Promise<void> {
    const discovered = await this.#withFrameCommandTimeout(
      this.#sendCommand(source.tabId, "Target.getTargets")
    ).catch(() => ({}));
    const infos = isRecord(discovered) && Array.isArray(discovered.targetInfos)
      ? discovered.targetInfos : [];
    const diagnostic = this.#wsAttachDiagnostic(source);
    diagnostic.targetsTotal = infos.length;
    diagnostic.targetsIframe = infos.filter((info) => isRecord(info) && info.type === "iframe").length;
    for (const info of infos.slice(0, 32)) {
      if (!isRecord(info) || typeof info.type !== "string" || typeof info.targetId !== "string" ||
        typeof info.url !== "string" || !isSabaChildTargetUrl(info.url, info.type) ||
        this.#sabaAttachedTargetSessions.get(source.sourceId)?.has(info.targetId) === true) continue;
      const attached = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
        "Target.attachToTarget", { targetId: info.targetId, flatten: true })).catch(() => ({}));
      const childSessionId = nestedValue(attached, "sessionId");
      if (typeof childSessionId !== "string") continue;
      await this.#observeChildTarget(source, childSessionId, info.targetId, true,
        info.type === "iframe" ? "iframe" : "worker").catch(() => undefined);
    }
    diagnostic.attachedTargets = this.#sabaAttachedTargetSessions.get(source.sourceId)?.size ?? 0;
  }

  #noteWsRecoveryOutcome(source: ObservedSource, label: string): void {
    const diagnostic = this.#wsAttachDiagnostic(source);
    const entries = diagnostic.reconnectOutcomes.length === 0 ? [] : diagnostic.reconnectOutcomes.split(" ");
    entries.push(label);
    diagnostic.reconnectOutcomes = entries.slice(-12).join(" ");
  }

  #wsAttachDiagnostic(source: ObservedSource): WsAttachDiagnosticState {
    const sourceGeneration = this.#sourceGenerations.get(source.sourceId) ?? 0;
    const existing = this.#wsAttachDiagnostics.get(source.sourceId);
    if (existing !== undefined && existing.sourceGeneration === sourceGeneration) return existing;
    const created: WsAttachDiagnosticState = {
      sourceGeneration, webSocketCreated: 0, ksportTargets: 0, attachedTargets: 0,
      reconnectAttempts: 0, reconnectOutcomes: "",
      framesReceived: 0, framesOrphan: 0, framesForwarded: 0, ignoredSockets: 0,
      framesBinary: 0, framesNotOwner: 0, framesUnattributed: 0, framesNotActiveStream: 0,
      framesDecoderFailed: 0, sockjsOpen: 0, sockjsHeartbeat: 0, sockjsArray: 0,
      sockjsClose: 0, sockjsOther: 0, decoderFailCode: "NONE",
      stompFrames: 0, stompMessages: 0, stompPartitionRejected: 0, snapshotRejections: "", destinationShapes: "",
      stompPendingChars: 0, stompCommandFragments: 0, stompFragments: 0,
      destLiveLike: 0, destTodayLike: 0, destSportsLike: 0, subSportLike: 0,
      targetsTotal: 0, targetsIframe: 0, autoAttachEvents: 0,
      baselineLive: 0, baselineToday: 0, baselineTabSelections: 0,
      baselineTabStatus: "NONE", baselineTabTargets: 0, baselineTabStep: "NONE",
      baselineTabGroups: 0, baselineTabScopes: 0, baselineTabPeriods: 0, baselineTabLabels: "",
      catalogShape: ""
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

  #scheduleFreshSocketBaseline(source: ObservedSource, matches: (url: URL) => boolean,
    preferredSessionId?: string): Promise<void> {
    const existing = this.#socketBaselineRecoveries.get(source.sourceId);
    if (existing !== undefined) return existing.operation;
    const token = Symbol(source.sourceId);
    const operation = this.#runPeriodicDomWork(source.sourceId,
      () => this.#requestFreshSocketBaseline(source, matches, preferredSessionId)).finally(() => {
        if (this.#socketBaselineRecoveries.get(source.sourceId)?.token === token) {
          this.#socketBaselineRecoveries.delete(source.sourceId);
        }
      });
    this.#socketBaselineRecoveries.set(source.sourceId, { token, operation });
    return operation;
  }

  /**
   * The API-side KSPORT catalog lease expires 120s after each paired getEvent
   * baseline, and stall-driven recovery was its only refresher - recovery
   * backoff then let every cycle freeze the catalog for 30-60s while socket
   * deltas kept flowing. While the sportsbook socket is healthy, renew the
   * pair proactively well inside the lease: the captured-template fetch
   * first, the page's own native period requests when the template fails.
   */
  async #renewKsportBaselineLease(source: ObservedSource, nowMs: number): Promise<void> {
    const lastAtMs = this.#ksportBaselineLeaseAtMs.get(source.sourceId);
    if (lastAtMs === undefined) {
      // The attach/recovery path has just produced a baseline; only renew
      // after a full lease interval of healthy ticks.
      this.#ksportBaselineLeaseAtMs.set(source.sourceId, nowMs);
      return;
    }
    if (nowMs - lastAtMs < KSPORT_BASELINE_LEASE_RENEW_MS) return;
    this.#ksportBaselineLeaseAtMs.set(source.sourceId, nowMs);
    if (await this.#requestFreshKsportHttpBaseline(source)) return;
    await this.#requestFreshKsportNativeHttpBaseline(source);
  }

  async #requestFreshKsportHttpBaseline(source: ObservedSource): Promise<boolean> {
    const activeEntry = this.#activeKsportSocket(source.sourceId);
    let refreshed = false;
    if (activeEntry === undefined) {
      refreshed = await this.#requestFreshKsportHttpBaselineAfterDrain(source);
    } else {
      const [key, socket] = activeEntry;
      const prior = socket.ksportFrameTail ?? Promise.resolve();
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
    }
    return refreshed;
  }

  async #requestFreshKsportNativeHttpBaseline(source: ObservedSource): Promise<boolean> {
    // After an MV3 worker reload, Resource Timing still exposes the list URL
    // but not the authenticated headers used by the provider SPA. Re-fetching
    // that URL directly returns 500. Only when there is no catalog socket or
    // retained baseline, let the page issue its own two period requests and
    // capture those responses instead; this changes no tab, URL or lifecycle
    // state and is rate-limited independently of maintenance.
    const nowMs = this.#now();
    const lastAttemptAtMs = this.#ksportNativeHttpRecoveryAtMs.get(source.sourceId);
    if (lastAttemptAtMs !== undefined &&
      nowMs - lastAttemptAtMs < KSPORT_NATIVE_HTTP_RECOVERY_RETRY_MS) return false;
    this.#ksportNativeHttpRecoveryAtMs.set(source.sourceId, nowMs);
    const sourceGeneration = this.#captureSourceGeneration(source.sourceId);
    const ordinalBefore = this.#ksportSnapshotOrdinals.get(source.sourceId) ?? 0;
    this.#armKsportNativeHttpCapture(source);
    const todaySelected = await this.#selectTimeTab(source, KSPORT_TODAY_NATIVE_HTTP_EXPRESSION);
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return false;
    const liveSelected = await this.#selectTimeTab(source, KSPORT_LIVE_NATIVE_HTTP_EXPRESSION);
    if (!todaySelected && !liveSelected) return false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) return false;
      if ((this.#ksportSnapshotOrdinals.get(source.sourceId) ?? 0) > ordinalBefore) {
        this.#lastCatalogShape.set(source.sourceId, "http[NATIVE:catalog-requested]");
        return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    return (this.#ksportSnapshotOrdinals.get(source.sourceId) ?? 0) > ordinalBefore;
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
        !isKsportEventApiHost(templateUrl.hostname)) return false;
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
      readonly frameId?: string; readonly targetId?: string }> = knownContexts.map(
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
        if (!isRecord(info) || typeof info.type !== "string" || typeof info.targetId !== "string" ||
          typeof info.url !== "string" || !isKsportChildTargetUrl(info.url, info.type)) continue;
        const attached = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
          "Target.attachToTarget", { targetId: info.targetId, flatten: true })).catch(() => ({}));
        const sessionId = nestedValue(attached, "sessionId");
        if (typeof sessionId !== "string") continue;
        attachedTargets.set(info.targetId, sessionId);
        await this.#observeChildTarget(source, sessionId, info.targetId, true,
          info.type === "worker" ? "worker" : "iframe").catch(() => undefined);
      }
    }
    const attachedSocketTargets = [...attachedTargets.entries()].map(([targetId, sessionId]) =>
      ({ targetId, sessionId }));
    targets.unshift(...attachedSocketTargets);
    const expression = `(async () => {
      const marker = "fieldline-ksport-catalog-refresh";
      const executionSurface = typeof document === "undefined" ? "WORKER" : "DOCUMENT";
      const executionOrigin = new URL(location.href).origin;
      const isProviderHost = (hostname) => hostname === "sb21.net" || hostname.endsWith(".sb21.net") ||
        hostname === "zenandfe.com" || hostname === "prod20091.fxf774.com";
      const isProviderUrl = (url) => isProviderHost(url.hostname) || url.origin === executionOrigin;
      const capturedUrl = ${JSON.stringify(templateUrl?.href ?? null)};
      const performanceUrls = [...performance.getEntriesByType("resource")].map((entry) => entry.name)
        .filter((value) => { try { const url = new URL(value); return url.protocol === "https:" &&
          url.username === "" && url.password === "" && isProviderUrl(url) &&
          url.pathname === "/api/v2/getEvent" && !url.searchParams.has("eventId"); } catch { return false; } });
      const sameOriginFallback = executionSurface === "WORKER" && (() => {
        try {
          const origin = new URL(executionOrigin);
          return origin.protocol === "https:" && origin.username === "" && origin.password === "" &&
            isProviderHost(origin.hostname) ? new URL("/api/v2/getEvent", executionOrigin).href : null;
        } catch { return null; }
      })();
      const templateUrl = capturedUrl || performanceUrls.at(-1) || sameOriginFallback;
      if (!templateUrl) return { status: marker + "-template-missing", page: location.origin + location.pathname };
      const base = new URL(templateUrl);
      if (base.protocol !== "https:" || base.username !== "" || base.password !== "" ||
        !isProviderUrl(base) || base.pathname !== "/api/v2/getEvent") {
        return { status: marker + "-url-invalid" };
      }
      const headers = ${JSON.stringify(template?.headers ?? {})};
      const method = ${JSON.stringify(template?.method ?? "GET")};
      const hasPostData = ${JSON.stringify(template?.hasPostData ?? false)};
      const rangeCarrier = base.searchParams.has("timeRange") ? "URL" : hasPostData ? "BODY" : "NONE";
      const responses = [];
      const exactUrls = new Map();
      for (const value of [capturedUrl, ...performanceUrls]) {
        if (!value) continue;
        const candidate = new URL(value);
        if (candidate.protocol !== "https:" || candidate.username !== "" || candidate.password !== "" ||
          !isProviderUrl(candidate) || candidate.pathname !== "/api/v2/getEvent" ||
          candidate.searchParams.has("eventId")) continue;
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
        url.searchParams.delete("eventId");
        if (!exactUrls.has(timeRange)) url.searchParams.set("timeRange", providerRangeStyle(timeRange));
        const response = await fetch(url.href, { method: "GET", headers, credentials: "include", cache: "no-store" });
        if (!response.ok) {
          const controls = typeof document === "undefined" ? [] :
            [...document.querySelectorAll('.sport-menu-container *, button, a, [role="button"], [data-sport]')]
            .map((node) => ({ tag: node.tagName,
              text: String(node.textContent || '').trim().replace(/\\s+/gu, ' ').slice(0, 80),
              className: String(node.className || '').slice(0, 120), id: String(node.id || '').slice(0, 80),
              role: node.getAttribute('role') || '',
              sport: node.getAttribute('data-sport') || node.getAttribute('data-sport-id') || '' }))
            .filter((item) => item.className || item.id || item.role || item.sport)
            .slice(0, 120);
          return { status: marker + "-failed", timeRange, code: response.status,
            page: location.origin + location.pathname, controls, method, rangeCarrier, hasPostData };
        }
        responses.push({ timeRange, url: url.href, body: await response.text() });
      }
      return { status: "catalog-requested", marker, executionSurface, executionOrigin,
        origin: base.origin, responses };
    })()`;
    const attempts: Array<{ readonly target: "CONTEXT" | "SESSION" | "ROOT";
      readonly status: string; readonly page?: string; readonly controls?: unknown;
      readonly timeRange?: "live" | "today"; readonly code?: number;
      readonly method?: "GET" | "POST"; readonly rangeCarrier?: "URL" | "BODY" | "NONE";
      readonly hasPostData?: boolean }> = [];
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
        ...(isRecord(value) && Array.isArray(value.controls) ? { controls: value.controls.slice(0, 12) } : {}),
        ...(isRecord(value) && (value.timeRange === "live" || value.timeRange === "today")
          ? { timeRange: value.timeRange } : {}),
        ...(isRecord(value) && typeof value.code === "number" && Number.isInteger(value.code) &&
          value.code >= 100 && value.code <= 599 ? { code: value.code } : {}),
        ...(isRecord(value) && (value.method === "GET" || value.method === "POST")
          ? { method: value.method } : {}),
        ...(isRecord(value) && (value.rangeCarrier === "URL" || value.rangeCarrier === "BODY" ||
          value.rangeCarrier === "NONE") ? { rangeCarrier: value.rangeCarrier } : {}),
        ...(isRecord(value) && typeof value.hasPostData === "boolean"
          ? { hasPostData: value.hasPostData } : {}) });
      if (!isRecord(value) || value.status !== "catalog-requested" || !Array.isArray(value.responses) ||
        value.responses.length !== 2 || typeof value.origin !== "string") continue;
      const workerOwnsOrigin = value.executionSurface === "WORKER" && target.targetId !== undefined &&
        target.sessionId !== undefined && typeof value.executionOrigin === "string";
      let responseOrigin: string;
      try {
        const origin = new URL(value.origin);
        if (origin.protocol !== "https:" || origin.username !== "" || origin.password !== "" ||
          (!isKsportEventApiHost(origin.hostname) && (!workerOwnsOrigin ||
            new URL(value.executionOrigin as string).origin !== origin.origin))) continue;
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
      const verifiedTarget = value.executionSurface === "WORKER" && target.targetId !== undefined &&
        target.sessionId !== undefined ? { targetId: target.targetId, sessionId: target.sessionId } : undefined;
      if (accepted.size !== 2 || (verifiedDocument === undefined && verifiedTarget === undefined)) continue;
      if (verifiedTarget !== undefined &&
        this.#ksportAttachedTargetSessions.get(source.sourceId)?.get(verifiedTarget.targetId) !==
          verifiedTarget.sessionId) continue;
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
            ...(verifiedDocument === undefined ? { verifiedTarget: verifiedTarget! } : { verifiedDocument }) });
      }
      return true;
    }
    const nowMs = this.#now();
    this.#lastCatalogShape.set(source.sourceId, `http[${attempts.map((attempt) =>
      `${attempt.target}:${attempt.status}${attempt.code === undefined ? "" : `:${attempt.code}`}`)
      .join(",").slice(0, 360)}]`);
    if (nowMs - (this.#ksportDiagnosticAtMs.get(source.sourceId) ?? Number.NEGATIVE_INFINITY) >= 10_000) {
      this.#ksportDiagnosticAtMs.set(source.sourceId, nowMs);
      await this.#emit(source, "https://sb21.net/__fieldline_ksport_refresh__", "Diagnostic", "TAB_STATE", {
        encoding: "UTF8", body: JSON.stringify({ kind: "KSPORT_REFRESH_FAILED", attempts })
      });
    }
    return false;
  }

  async #acceptKsportNativeHttpPart(pending: PendingRequest, body: string): Promise<void> {
    const partition = pending.providerPartition === "KSPORT_LIVE" ? "live" :
      pending.providerPartition === "KSPORT_TODAY" ? "today" : null;
    if (partition === null || body.length > 12 * 1024 * 1024) return;
    let snapshot: unknown;
    try { snapshot = JSON.parse(body) as unknown; } catch { return; }
    if (!isFullKsportPartitionSnapshot(snapshot)) return;
    const capture = this.#currentKsportNativeHttpCapture(pending.source);
    if (capture === null || capture.sourceGeneration !== pending.sourceGeneration ||
      capture.tabGeneration !== pending.tabGeneration) return;
    capture.parts.set(partition, { url: pending.url, body });
    if (!capture.parts.has("live") || !capture.parts.has("today")) return;
    this.#ksportNativeHttpCaptures.delete(pending.source.sourceId);
    if (!this.#isPendingCurrent(pending)) return;

    const frameTree = await this.#withFrameCommandTimeout(
      this.#sendCommand(pending.source.tabId, "Page.getFrameTree")
    ).catch(() => ({}));
    const verifiedDocument = verifiedDocumentForDescriptor(collectFrameDescriptors(frameTree)[0]);
    if (verifiedDocument === undefined || !this.#isPendingCurrent(pending)) return;
    const sequenceBeforeBoundary = this.#sequences.get(pending.source.sourceId) ?? 0;
    await this.#emit(pending.source, "https://sb21.net/__fieldline_ksport_http_recovery_start__",
      "Diagnostic", "TAB_STATE", { encoding: "UTF8",
        body: '{"kind":"KSPORT_HTTP_NATIVE_RECOVERY_START"}' });
    if ((this.#sequences.get(pending.source.sourceId) ?? 0) !== sequenceBeforeBoundary + 1 ||
      !this.#isPendingCurrent(pending)) return;
    const ordinal = (this.#ksportSnapshotOrdinals.get(pending.source.sourceId) ?? 0) + 1;
    this.#ksportSnapshotOrdinals.set(pending.source.sourceId, ordinal);
    const generation = `ksport-http:${pending.source.tabId}:${ordinal}`;
    for (const nativePartition of ["live", "today"] as const) {
      if (!this.#isPendingCurrent(pending)) return;
      const part = capture.parts.get(nativePartition)!;
      await this.ingestHttpResponse(pending.source, part.url, "Fetch", part.body, {
        method: "GET", streamId: generation,
        providerPartition: nativePartition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
        providerContentIntent: "FOOTBALL_FULL_CATALOG",
        requestStartSequence: sequenceBeforeBoundary,
        verifiedDocument
      });
    }
    this.#ksportMaintenanceRecoveryAtMs.set(pending.source.sourceId, this.#now());
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
    const requiredPaths = new Set([
      "/api/eventlist/asia/leagues/v2/1/live",
      "/api/eventlist/asia/leagues/v2/1/live/initial",
      "/api/eventlist/asia/leagues/v2/1/prematch/initial"
    ]);
    const optionalPath = "/api/eventlist/asia/leagues/v2/1/prematch";
    const allowedPaths = new Set([...requiredPaths, optionalPath]);
    const unique = new Map<string, string>();
    for (const response of value.responses.slice(0, 64)) {
      const allowedDetail = isRecord(response) && typeof response.url === "string" &&
        /^\/api\/eventpage\/events\/[^/?]{1,1024}$/u.test(response.url);
      if (!isRecord(response) || typeof response.url !== "string" || typeof response.body !== "string" ||
        (!allowedPaths.has(response.url) && !allowedDetail) || response.body.length > 12 * 1024 * 1024) continue;
      unique.set(response.url, response.body);
    }
    if ([...requiredPaths].some((path) => !unique.has(path))) return false;
    const detailPaths = [...unique.keys()].filter((path) =>
      /^\/api\/eventpage\/events\/[^/?]{1,1024}$/u.test(path)).slice(0, 48);
    const ingestPaths = [detailPaths,
      [optionalPath, ...requiredPaths].filter((path) => unique.has(path))].flat();
    for (const path of ingestPaths) {
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
    const btiPageHealth = source.lobby === "BTI" ? await this.probeBtiPageHealth(source) : null;
    const webSockets = diagnostic === null ? 0 : [...this.#webSockets.values()].filter((socket) =>
      socket.source.sourceId === source.sourceId && socket.sourceGeneration === diagnostic.sourceGeneration).length;
    await this.#emit(source, `https://${hostname}/__fieldline_heartbeat__`, "Tab", "TAB_STATE", {
      encoding: "UTF8",
      body: btiPageHealth !== null ? JSON.stringify({ kind: "PAGE_HEALTH", ...btiPageHealth }) :
        diagnostic === null ? "{}" : JSON.stringify({ kind: "WS_ATTACH",
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
        destinationShapes: diagnostic.destinationShapes,
        stompPendingChars: diagnostic.stompPendingChars,
        stompCommandFragments: diagnostic.stompCommandFragments,
        stompFragments: diagnostic.stompFragments, destLiveLike: diagnostic.destLiveLike,
        destTodayLike: diagnostic.destTodayLike, destSportsLike: diagnostic.destSportsLike,
        subSportLike: diagnostic.subSportLike, targetsTotal: diagnostic.targetsTotal,
        targetsIframe: diagnostic.targetsIframe, autoAttachEvents: diagnostic.autoAttachEvents,
        baselineLive: diagnostic.baselineLive, baselineToday: diagnostic.baselineToday,
        baselineTabSelections: diagnostic.baselineTabSelections,
        baselineTabStatus: diagnostic.baselineTabStatus,
        // These two were tracked and accepted by the API but never sent, so
        // every recovery looked like it had never tried to reconnect
        // (measured 2026-09-01: 0 attempts through a five-minute SABA stall).
        reconnectAttempts: diagnostic.reconnectAttempts,
        reconnectOutcomes: diagnostic.reconnectOutcomes,
        baselineTabTargets: diagnostic.baselineTabTargets, baselineTabStep: diagnostic.baselineTabStep,
        baselineTabGroups: diagnostic.baselineTabGroups, baselineTabScopes: diagnostic.baselineTabScopes,
        baselineTabPeriods: diagnostic.baselineTabPeriods,
        baselineTabLabels: diagnostic.baselineTabLabels.length > 0
          ? diagnostic.baselineTabLabels : this.#lastTabLabels.get(source.sourceId) ?? "",
        catalogShape: `${this.#lastCaptureExit.get(source.sourceId) ?? "NONE"} ` +
          `targets[${[...(this.#targetTypesSeen.get(source.sourceId) ?? new Map())]
            .map(([type, count]) => `${type}:${count}`).join(",")}] ` +
          `sockets[${[...(this.#socketPathsSeen.get(source.sourceId) ?? new Map())]
            .map(([path, count]) => `${path}:${count}`).join(",")}] ` +
          (this.#lastCatalogShape.get(source.sourceId) ?? "") })
    });
    if (btiPageHealth !== null) {
      this.#onBtiPageHealth?.({ sourceId: source.sourceId, tabId: source.tabId, ...btiPageHealth });
    }
    // Keep only a small read-only shape diagnostic for APSPORT. Its periodic
    // authenticated API roster/detail collector owns the catalog generation;
    // a heartbeat must not start the old virtualized-DOM sweep or reconnect a
    // working provider socket.
    if (source.lobby === "TSPORT") {
      await this.#recordTsportCatalogShape(source).catch(() => undefined);
    }
  }

  async probeBtiPageHealth(source: ObservedSource): Promise<ReturnType<typeof parseBtiPageHealthProbe>> {
    if (source.lobby !== "BTI") return null;
    const evaluation = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId,
      "Runtime.evaluate", { expression: BTI_PAGE_HEALTH_EXPRESSION, returnByValue: true }))
      .catch(() => null);
    return parseBtiPageHealthProbe(nestedValue(evaluation, "result", "value")) ??
      { status: "UNKNOWN", code: null };
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
      // APSPORT forwards every frame it receives and all of them are heartbeats,
      // so either the football socket was never opened or it was opened and
      // stays silent. Those need opposite fixes and the frame counts cannot
      // tell them apart. Path shape only - the query string, which carries the
      // session, is never read.
      if (typeof params.url === "string") {
        try {
          const path = new URL(params.url).pathname
            .replace(/[0-9]{4,}/gu, "#").slice(0, 40);
          const seen = this.#socketPathsSeen.get(source.sourceId) ?? new Map<string, number>();
          if (seen.size < 8 || seen.has(path)) seen.set(path, (seen.get(path) ?? 0) + 1);
          this.#socketPathsSeen.set(source.sourceId, seen);
        } catch { /* a url we cannot parse tells us nothing */ }
      }
    }
    if (method === "Target.attachedToTarget") {
      const childSessionId = typeof params.sessionId === "string" ? params.sessionId : null;
      const targetInfo = isRecord(params.targetInfo) ? params.targetInfo : null;
      if (source.lobby === "KSPORT" || source.lobby === "SABA") {
        this.#wsAttachDiagnostic(source).autoAttachEvents += 1;
        const type = typeof targetInfo?.type === "string" ? targetInfo.type.slice(0, 24) : "none";
        const seen = this.#targetTypesSeen.get(source.sourceId) ?? new Map<string, number>();
        seen.set(type, (seen.get(type) ?? 0) + 1);
        this.#targetTypesSeen.set(source.sourceId, seen);
      }
      const observeChild = targetInfo?.type === "iframe" ||
        ((source.lobby === "KSPORT" || source.lobby === "SABA") && targetInfo?.type === "worker") ||
        (source.lobby === "SABA" && targetInfo?.type === "shared_worker");
      if (childSessionId !== null && observeChild) {
        const targetId = typeof targetInfo.targetId === "string" ? targetInfo.targetId : undefined;
        await this.#observeChildTarget(source, childSessionId, targetId, true,
          targetInfo.type === "iframe" ? "iframe" : "worker");
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
        const sabaTargets = this.#sabaAttachedTargetSessions.get(source.sourceId);
        if (sabaTargets !== undefined) {
          for (const [targetId, attachedTarget] of sabaTargets) {
            if (attachedTarget.sessionId === childSessionId) sabaTargets.delete(targetId);
          }
          if (sabaTargets.size === 0) this.#sabaAttachedTargetSessions.delete(source.sourceId);
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
      // Runtime.enable emits this event when an MV3 worker reattaches even if
      // the provider document did not navigate. It is also emitted separately
      // by child/OOPIF targets. Context loss therefore clears only bindings;
      // actual tab mutation boundaries call beginSourceEpoch explicitly before
      // navigation/reload and releaseTab retires a detached document.
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
      const partition = request === null ? null : imPartitionFromRequest(source, request) ??
        (this.#currentKsportNativeHttpCapture(source) === null
          ? null : ksportPartitionFromRequest(source, request));
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
      if (source.lobby === "KSPORT" && (!this.#ksportRefreshesInFlight.has(source.sourceId) ||
        this.#currentKsportNativeHttpCapture(source) !== null) &&
        request !== null && typeof request.url === "string") {
        try {
          const url = new URL(request.url);
          if (url.protocol === "https:" && url.username === "" && url.password === "" &&
            isKsportEventApiHost(url.hostname) && url.pathname === "/api/v2/getEvent" &&
            !url.searchParams.has("eventId")) {
            const rawHeaders = isRecord(request.headers) ? request.headers : {};
            const headers = Object.fromEntries(Object.entries(rawHeaders).flatMap(([name, value]) =>
              /^(?:cookie|host|content-length|accept-encoding|connection|origin|referer|user-agent|sec-|:)/iu.test(name) ||
                (typeof value !== "string" && typeof value !== "number") ? [] : [[name, String(value)]]));
            const method: "GET" | "POST" = requestMethod === "POST" ? "POST" : "GET";
            const template = { url: request.url, headers, method,
              hasPostData: typeof request.postData === "string" && request.postData.length > 0 };
            this.#sbobetEventRequests.set(source.sourceId, template);
          }
        } catch { /* Ignore malformed provider URLs. */ }
      }
      if (source.lobby === "TSPORT" && request !== null &&
        !this.#apsportRefreshesInFlight.has(source.sourceId)) {
        const template = apsportRequestTemplateFromObserved(request, String(params.type ?? ""),
          params.frameId, params.loaderId, sessionId,
          this.#sourceGenerations.get(source.sourceId) ?? 0,
          this.#captureTabGeneration(source.tabId));
        if (template !== null) this.#apsportRequestTemplates.set(source.sourceId, template);
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
      if (source.lobby === "SABA") {
        const existing = this.#webSockets.get(key) ?? this.#sabaSocketAcrossSession(source, requestId)?.[1];
        // Flattened CDP can repeat one physical SABA socket creation on both
        // the root target and its worker target. Treat that as one lifecycle:
        // emitting another OPEN gives the API a newer stream ordinal, retires
        // the already-authoritative stream and leaves fresh frames split across
        // two logical owners. Only collapse an exact URL match where at least
        // one observation is root-attributed; two child workers may genuinely
        // own different sockets despite target-local request-id reuse.
        if (existing !== undefined && existing.sourceGeneration === sourceGeneration &&
          existing.url === params.url && (existing.sessionId === undefined || sessionId === undefined ||
            existing.sessionId === sessionId)) return;
      }
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
        ...(source.lobby === "SABA" ? { sabaLifecycleAnnounced: false } : {}),
        ...(sessionId === undefined ? {} : { sessionId }) });
      if (source.lobby === "SBO") {
        try {
          if (/\/socket\.io\/?$/u.test(new URL(params.url).pathname)) {
            this.#replaceCatalogWsSnapshots(source.sourceId, new Map());
          }
        } catch { /* malformed socket URL cannot be a catalog authority */ }
      }
      // KSPORT and SABA can open auxiliary sockets in the same document. An
      // OPEN alone is not catalog ownership evidence: defer the public OPEN
      // until this exact socket sends a recognized catalog frame. Otherwise an
      // auxiliary SABA socket retires the healthy baseline-owning stream.
      if (ksportRecovery !== undefined || source.lobby === "SABA") return;
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
          this.#ksportBaselineAttemptAtMs.delete(socket.source.sourceId);
          if (this.#activeKsportStreams.get(socket.source.sourceId) === socket.streamId) {
            await this.#scheduleSabaWsSnapshotClear(socket.source.sourceId);
          }
        }
      }
      return;
    }
    if (method === "Network.webSocketClosed" && key) {
      const directSocket = this.#webSockets.get(key);
      const crossSessionSocket = directSocket === undefined && requestId !== null
        ? this.#sabaSocketAcrossSession(source, requestId) : undefined;
      const socketKey = crossSessionSocket?.[0] ?? key;
      const socket = directSocket ?? crossSessionSocket?.[1];
      if (socket !== undefined) {
        if (socket.closing === true) return;
        socket.closing = true;
        await socket.ksportFrameTail?.catch(() => undefined);
        if (!this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration) ||
          this.#webSockets.get(socketKey) !== socket) return;
        if (socket.source.lobby === "KSPORT" &&
          this.#activeKsportStreams.get(socket.source.sourceId) !== socket.streamId) {
          this.#webSockets.delete(socketKey);
          return;
        }
        if (socket.source.lobby === "SABA" && socket.sabaLifecycleAnnounced !== true) {
          this.#webSockets.delete(socketKey);
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
          this.#webSockets.get(socketKey) === socket;
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
      if (this.#webSockets.get(socketKey) === socket && (socket === undefined ||
        this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration))) {
        this.#webSockets.delete(socketKey);
      }
      return;
    }
    if (method === "Network.webSocketFrameReceived" && key) {
      const socket = this.#webSockets.get(key) ??
        (requestId === null ? undefined : this.#sabaSocketAcrossSession(source, requestId)?.[1]);
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
            await this.#discoverExistingSabaChildTargets(source).catch(() => undefined);
            await this.#scheduleFreshSocketBaseline(source,
              (url) => /\/socket\.io\/?$/u.test(url.pathname), sessionId);
          }
        } else if (source.lobby === "SBO") {
          const nowMs = this.#now();
          const lastAttemptAtMs = this.#sboOrphanFrameRecoveryAtMs.get(source.sourceId);
          if (lastAttemptAtMs === undefined || nowMs - lastAttemptAtMs >= SBO_ORPHAN_FRAME_RETRY_MS) {
            this.#sboOrphanFrameRecoveryAtMs.set(source.sourceId, nowMs);
            await this.#scheduleFreshSocketBaseline(source,
              (url) => /\/socket\.io\/?$/u.test(url.pathname));
          }
        } else if (source.lobby === "TSPORT" && this.#onApsportOrphanSocket !== undefined &&
          ![...this.#webSockets.values()].some((candidate) => candidate.source.sourceId === source.sourceId &&
            candidate.closing !== true &&
            this.#isSourceGenerationCurrent(source.sourceId, candidate.sourceGeneration))) {
          const nowMs = this.#now();
          const lastAttemptAtMs = this.#apsportOrphanFrameRecoveryAtMs.get(source.sourceId);
          if (lastAttemptAtMs === undefined ||
            nowMs - lastAttemptAtMs >= APSPORT_ORPHAN_FRAME_RETRY_MS) {
            this.#apsportOrphanFrameRecoveryAtMs.set(source.sourceId, nowMs);
            try {
              void Promise.resolve(this.#onApsportOrphanSocket(source)).catch(() => undefined);
            } catch { /* A failed exact-tab renewal is retried after the bounded cooldown. */ }
          }
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
            // Child-target discovery only ran once inside start(). A sportsbook
            // OOPIF created after that moment (every tab reload does this) was
            // never attached, so its socket stayed orphan forever and the
            // reconnect below could not observe the replacement either.
            // Re-discover before asking the page to reconnect.
            await this.#discoverExistingKsportChildTargets(source).catch(() => undefined);
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
      if (socket.source.lobby === "SABA" && socket.sabaLifecycleAnnounced !== true) {
        if (opcode === 2 || !isPotentialSabaCatalogPayload(response.payloadData)) return;
        // The document marker lookup is asynchronous. Fence the deferred OPEN
        // behind it as well as the frame; otherwise a navigation can retire
        // the source while the lookup is pending and still receive a ghost
        // OPEN from the old SABA document.
        await this.#sabaDocumentMarker(socket.source, socket.sessionId, socket.sourceGeneration);
        if (socketIsClosing(socket) ||
          !this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) return;
        socket.sabaLifecycleAnnounced = true;
        await this.#emit(socket.source, socket.url, "WebSocket", "WS_STATE", {
          encoding: "UTF8", body: '{"state":"OPEN"}'
        }, { request: { streamId: socket.streamId }, ...clocks,
          sourceGeneration: socket.sourceGeneration });
        if (socketIsClosing(socket) ||
          !this.#isSourceGenerationCurrent(socket.source.sourceId, socket.sourceGeneration)) return;
      }
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
        if (shape.destinationShapes.length > 0) frameDiagnostic.destinationShapes = shape.destinationShapes;
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
      if (!isProviderCatalogHttpResponse(source, response.url, providerFunctionCode,
        providerPartition)) {
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
        if (pending.source.lobby === "KSPORT" &&
          (pending.providerPartition === "KSPORT_LIVE" || pending.providerPartition === "KSPORT_TODAY")) {
          await this.#acceptKsportNativeHttpPart(pending, safeBody);
          return;
        }
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
    const verifiedTarget = requestMetadata.verifiedTarget;
    const requestDocument = verifiedDocument !== undefined ? requestDocumentBinding(
      this.#observerSessionId, source.tabId, sourceGeneration, verifiedDocument.sessionId,
      verifiedDocument.frameId, verifiedDocument.loaderId) : verifiedTarget !== undefined
      ? requestTargetBinding(this.#observerSessionId, source.tabId, sourceGeneration,
          verifiedTarget.sessionId, verifiedTarget.targetId)
      : null;
    const pending: PendingRequest = { source, sourceGeneration, tabGeneration, url, resourceType, method,
      ...requestIdentity,
      ...(verifiedDocument?.sessionId !== undefined ? { sessionId: verifiedDocument.sessionId }
        : verifiedTarget !== undefined ? { sessionId: verifiedTarget.sessionId, targetId: verifiedTarget.targetId } : {}),
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
    // A capture that never settles holds this entry forever, and every later
    // sweep is handed that dead promise instead of running: measured
    // 2026-08-27, APSPORT's DOM_SNAPSHOT count sat at zero for as long as it
    // was watched while its sweep was called every thirty seconds. The in-flight
    // guard exists to stop two captures overlapping, which is a matter of
    // seconds; past that, whatever it is holding is not going to finish.
    if (existing !== undefined &&
      this.#now() - existing.startedAtMs < CAPTURE_IN_FLIGHT_LIMIT_MS) return existing.operation;
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
        if (!this.#isSourceGenerationCurrent(source.sourceId, sourceGeneration)) { this.#noteCaptureExit(source, "GENERATION_STALE"); return; }
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
        if (eligibleFrames.length === 0) { this.#noteCaptureExit(source, "NO_ELIGIBLE_FRAME"); return; }
        const tsportFrames = source.lobby === "TSPORT"
          ? eligibleFrames.filter((capture) => capture.sweep?.sweepComplete === true)
          : [];
        // TSPORT expected ids must describe one exact current document. Never
        // merge multiple frames or erase its frame/loader-bound sweep metadata.
        // An ambiguous multi-frame result fails closed until a later scan finds
        // the single football document.
        if (source.lobby === "TSPORT" && tsportFrames.length !== 1) { this.#noteCaptureExit(source,
            `TSPORT_FRAME_COUNT=${tsportFrames.length}/${eligibleFrames.length}`); return; }
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
    this.#cmdCapturesInFlight.set(source.sourceId, { token, operation, startedAtMs: this.#now() });
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

  /**
   * A probe that throws answers nothing, and the operator is shown TIMEOUT.
   *
   * TIMEOUT is the one verdict that says nothing about the ticket - not that it
   * is gone, not that it stands - so it hides both. Every failure here becomes
   * a named refusal instead: the expression builders throw on an identity they
   * cannot address, and the whole path can fail on a tab that went away
   * mid-probe. Measured 2026-09-01: SABA and SBOBET between them answered
   * TIMEOUT on three of seventeen checks and never once said why.
   */
  async probeSelectionPrice(source: ObservedSource, request: SelectionPriceProbeIdentity & {
    readonly requestId: string }): Promise<void> {
    try {
      await this.#probeSelectionPriceOrThrow(source, request);
    } catch (error) {
      const name = error instanceof Error ? error.message : "PROBE_FAILED";
      const observedAtMs = this.#now();
      await this.#emit(source,
        `https://${source.lobby.toLocaleLowerCase("en")}.invalid/__fieldline_selection_price_probe__`,
        "DOM", "DOM_SNAPSHOT", { encoding: "UTF8", body: JSON.stringify({ requestId: request.requestId,
          providerEventId: request.providerEventId, providerMarketId: request.providerMarketId,
          providerSelectionId: request.providerSelectionId, status: "NOT_FOUND", rawOdds: null,
          observedAtMs, method: "DOM",
          // Shape only: the failure's own name, bounded, never its message body.
          reason: /^[A-Z][A-Z0-9_]{0,63}$/u.test(name) ? name : "PROBE_FAILED"
        }) }, { observedAtMs }).catch(() => undefined);
    }
  }

  async #probeSelectionPriceOrThrow(source: ObservedSource, request: SelectionPriceProbeIdentity & {
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
      // Only KSPORT read the candidate expression, so a caller handing this any
      // other expression got the original one evaluated instead - silently, and
      // with its promise never awaited.
      const awaitPromise = source.lobby === "TSPORT" || candidateExpression !== expression;
      return frameIds.length === 0
        ? [await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
          expression: candidateExpression, returnByValue: true, awaitPromise })).catch(() => ({}))]
        : Promise.all(frameIds.map(async (frameId) => {
          const world = await this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Page.createIsolatedWorld", {
            frameId, worldName: "fieldline-selection-price", grantUniveralAccess: false })).catch(() => ({}));
          const contextId = nestedNumber(world, "executionContextId");
          if (contextId === null) return {};
          return this.#withFrameCommandTimeout(this.#sendCommand(source.tabId, "Runtime.evaluate", {
            expression: candidateExpression, contextId, returnByValue: true, awaitPromise })).catch(() => ({}));
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
    } else if (source.lobby === "CMD") {
      // The DOM holds only what the page drew, so a fixture the operator has not
      // scrolled to came back VISIBLE_PRICE_NOT_FOUND - which reads as a ticket
      // that is gone while the book is still offering it. The book's own catalog
      // request answers for every fixture, so it goes first: running it after a
      // full frame sweep left the two together over the probe's 10 s budget, and
      // the result was the same silence reported as a timeout.
      //
      // Frames, not just the top one, because the book may be framed and only
      // its own origin can make this request. Main-world contexts already exist,
      // so this costs no isolated world per frame, and it stops at the first
      // frame that answers.
      const fetchExpression = buildCmdSelectionPriceExpression(request, "FETCH_ONLY");
      const conclusive = (value: unknown): boolean => isRecord(value) &&
        (value.ok === true || value.reason === "CMD_EVENT_AMBIGUOUS" ||
          value.reason === "CMD_SELECTION_NOT_ON_OFFER");
      const fetchEvaluations: unknown[] = [];
      const targets: Array<{ contextId?: number; sessionId?: string | undefined }> = [{},
        ...[...(this.#mainWorldContexts.get(source.tabId)?.values() ?? [])]
          .map((binding) => ({ contextId: binding.contextId, sessionId: binding.sessionId }))];
      for (const target of targets) {
        const params = { expression: fetchExpression, returnByValue: true, awaitPromise: true,
          ...(target.contextId === undefined ? {} : { contextId: target.contextId }) };
        const result = await this.#withFrameCommandTimeout(target.sessionId === undefined
          ? this.#sendCommand(source.tabId, "Runtime.evaluate", params)
          : this.#sendCommand(source.tabId, "Runtime.evaluate", params, target.sessionId),
        3_000).catch(() => ({ result: { value: { ok: false, method: "IN_PAGE_FETCH",
          reason: "CMD_FETCH_TIMED_OUT" } } }));
        fetchEvaluations.push(result);
        if (conclusive(nestedValue(result, "result", "value"))) break;
      }
      evaluations = fetchEvaluations.some((evaluation) =>
        conclusive(nestedValue(evaluation, "result", "value")))
        ? fetchEvaluations
        : [...fetchEvaluations, ...await evaluateFrames()];
    } else if (source.lobby === "TSPORT") {
      const direct = await this.#probeApsportEventDetail(source, request);
      evaluations = direct === null ? await evaluateFrames() : [{ result: { value: direct } }];
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
        value.reason === "TSPORT_SELECTION_AMBIGUOUS" ||
        value.reason === "BTI_EVENT_AMBIGUOUS" || value.reason === "BTI_MARKET_AMBIGUOUS" ||
        value.reason === "BTI_SELECTION_AMBIGUOUS");
    const diagnosticReason = foundCandidates.length > 1 ? "VISIBLE_PRICE_AMBIGUOUS" :
      candidates.find((value) => typeof value.reason === "string")?.reason;
    const observedAtMs = typeof found?.observedAtMs === "number" ? found.observedAtMs : this.#now();
    const reportedMethod = found?.method ?? candidates.find((candidate) => candidate.method === "IN_PAGE_FETCH" ||
      candidate.method === "DOM")?.method;
    const method = reportedMethod === "IN_PAGE_FETCH" || reportedMethod === "DOM" ? reportedMethod
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
          this.#sabaCatalogFrameAtMs.set(source.sourceId, clocks.observedAtMs);
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
      const eventId = String(event["2"]);
      const retained = this.#tsportSnapshots.get(source.sourceId) ?? new Map<string, ReplayableWsEvent>();
      retained.set(eventId, { source, url, body, streamId, ...clocks });
      while (retained.size > 1_000) retained.delete(retained.keys().next().value as string);
      this.#tsportSnapshots.set(source.sourceId, retained);
      this.#scheduleApsportEventDetail(source, eventId);
    } catch { /* Non-event frames are not replayable catalog state. */ }
  }

  #rememberHttpSnapshot(pending: PendingRequest, body: string,
    clocks: { readonly observedAtMs: number; readonly receivedMonotonicMs: number }): void {
    let url: URL;
    try { url = new URL(pending.url); } catch { return; }
    if (pending.requestFrameKey === undefined || pending.requestDocumentKey === undefined) return;
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return; }

    // Keep only APSPORT's completed roster boundary. Detail batches are
    // deltas, so retaining them would not give a restarted API a complete
    // catalog. Replaying this roster with its original observation time lets a
    // replacement local API recover immediately from a transient provider
    // request failure without presenting old data as newly fetched data.
    if (pending.source.lobby === "TSPORT" &&
      url.pathname === "/__fieldline_apsport_catalog_refresh__") {
      if (!isRecord(parsed) || parsed.schemaVersion !== 1 || parsed.phase !== "ROSTER" ||
        parsed.complete !== true || !Array.isArray(parsed.records)) return;
      this.#httpSnapshots.set(pending.source.sourceId, [{
        source: pending.source, url: pending.url, resourceType: pending.resourceType, body,
        method: pending.method, observerRequestId: pending.observerRequestId,
        observerRequestOrdinal: pending.observerRequestOrdinal,
        requestFrameKey: pending.requestFrameKey, requestDocumentKey: pending.requestDocumentKey,
        ...(pending.providerPartition === undefined ? {} : { providerPartition: pending.providerPartition }),
        ...(pending.streamId === undefined ? {} : { streamId: pending.streamId }),
        ...(pending.providerFunctionCode === undefined ? {} :
          { providerFunctionCode: pending.providerFunctionCode }),
        ...(pending.reconcileCutoffSequence === undefined ? {} :
          { reconcileCutoffSequence: pending.reconcileCutoffSequence }), ...clocks
      }]);
      return;
    }

    if (pending.source.lobby !== "IM" || url.hostname !== "imsports.directsb.net" ||
      url.pathname !== "/api/EventV6/GetSE") return;
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
    const bridgeGeneration = this.#captureBridgeGeneration(source.sourceId);
    const tabGeneration = metadata.tabGeneration ?? this.#captureTabGeneration(source.tabId);
    const previous = this.#emissionTails.get(source.sourceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if ((this.#sourceGenerations.get(source.sourceId) ?? 0) !== sourceGeneration ||
        this.#captureBridgeGeneration(source.sourceId) !== bridgeGeneration ||
        this.#captureTabGeneration(source.tabId) !== tabGeneration) return;
      if (metadata.beforeForward !== undefined && !await metadata.beforeForward()) return;
      if ((this.#sourceGenerations.get(source.sourceId) ?? 0) !== sourceGeneration ||
        this.#captureBridgeGeneration(source.sourceId) !== bridgeGeneration ||
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
          this.#captureBridgeGeneration(source.sourceId) === bridgeGeneration &&
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

  #captureBridgeGeneration(sourceId: string): number {
    return this.#bridgeEpochGenerations.get(sourceId) ?? 0;
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
    const bridgeGeneration = this.#captureBridgeGeneration(sourceId);
    const current = this.#publicSourceEpochs.get(sourceId);
    if (current?.sourceGeneration === sourceGeneration && current.bridgeGeneration === bridgeGeneration) {
      return current.ordinal;
    }
    const ordinal = this.#nextPublicEpochOrdinal;
    this.#nextPublicEpochOrdinal += 1;
    this.#publicSourceEpochs.set(sourceId, { sourceGeneration, bridgeGeneration, ordinal });
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
    if (pending.targetId !== undefined) {
      return pending.source.lobby === "KSPORT" && pending.sessionId !== undefined &&
        pending.requestFrameKey !== undefined && pending.requestDocumentKey !== undefined &&
        this.#isPendingCurrent(pending) &&
        this.#ksportAttachedTargetSessions.get(pending.source.sourceId)?.get(pending.targetId) === pending.sessionId;
    }
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

interface BoundApsportRequestTemplate extends ApsportRequestTemplate {
  readonly frameId: string;
  readonly loaderId: string;
  readonly sessionId?: string;
  readonly sourceGeneration: number;
  readonly tabGeneration: number;
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

function ksportPartitionFromRequest(source: ObservedSource,
  request: Record<string, unknown>): KsportProviderPartition | null {
  if (source.lobby !== "KSPORT" || request.method !== "GET" || typeof request.url !== "string") return null;
  try {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      !isKsportEventApiHost(url.hostname) || url.pathname !== "/api/v2/getEvent") return null;
    const timeRange = url.searchParams.get("timeRange")?.toLowerCase();
    return timeRange === "live" ? "KSPORT_LIVE" : timeRange === "today" ? "KSPORT_TODAY" : null;
  } catch { return null; }
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

function apsportRequestTemplateFromObserved(
  request: Record<string, unknown>,
  resourceType: string,
  frameIdValue: unknown,
  loaderIdValue: unknown,
  sessionId: string | undefined,
  sourceGeneration: number,
  tabGeneration: number
): BoundApsportRequestTemplate | null {
  if (!/^(?:XHR|Fetch)$/u.test(resourceType) || request.method !== "POST" ||
    typeof request.url !== "string" || typeof request.postData !== "string" ||
    request.postData.length > 16_384 || typeof frameIdValue !== "string" ||
    typeof loaderIdValue !== "string") return null;
  let url: URL;
  let body: unknown;
  try {
    url = new URL(request.url);
    body = JSON.parse(request.postData);
  } catch { return null; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.pathname !== "/be-ui/pac/api/v3/events" ||
    !(url.hostname === "agenate.com" || url.hostname.endsWith(".agenate.com")) ||
    !isRecord(body)) return null;
  const rawHeaders = isRecord(request.headers) ? request.headers : {};
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(rawHeaders)) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/u.test(name) ||
      /^(?:cookie|host|content-length|accept-encoding|connection|origin|referer|user-agent|sec-|:)/u.test(name) ||
      (typeof rawValue !== "string" && typeof rawValue !== "number")) continue;
    const value = String(rawValue);
    if (value.length > 4_096) continue;
    headers[name] = value;
  }
  return { origin: url.origin, headers, body,
    frameId: frameIdValue, loaderId: loaderIdValue,
    ...(sessionId === undefined ? {} : { sessionId }), sourceGeneration, tabGeneration };
}

function isProviderCatalogWebSocket(source: ObservedSource, _value: string): boolean {
  if (source.lobby === "KSPORT") {
    try { return isKsportCatalogSocket(new URL(_value)); } catch { return false; }
  }
  return source.lobby === "SABA" || source.lobby === "TSPORT" || source.lobby === "SBO";
}

function isPotentialSabaCatalogPayload(value: string): boolean {
  if (!value.startsWith("42")) return false;
  try {
    const payload: unknown = JSON.parse(value.slice(2));
    return Array.isArray(payload) && payload[0] === "m" &&
      typeof payload[1] === "string" && /^b\d+$/u.test(payload[1]) &&
      Array.isArray(payload[2]) && payload.length >= 3 && payload.length <= 4;
  } catch {
    return false;
  }
}

function isProviderCatalogHttpResponse(source: ObservedSource, value: string,
  providerFunctionCode: number | undefined,
  providerPartition?: ProviderPartition): boolean {
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
    // Only a request that was admitted during the bounded recovery-tab window
    // reaches this branch. The response body is held locally until both native
    // partitions exist, then re-emitted as one atomic generation.
    return isKsportEventApiHost(url.hostname) && url.pathname === "/api/v2/getEvent" &&
      (providerPartition === "KSPORT_LIVE" || providerPartition === "KSPORT_TODAY");
  }
  if (source.lobby === "BTI") {
    // BTI refresh requests are fetched by the page worker and copied from its
    // bounded detail cache by refreshCatalog(). Reading those same responses
    // again through CDP duplicates every hidden-market body and can starve the
    // complete direct generation behind hundreds of passive envelopes.
    return false;
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

function socketIsClosing(socket: ObservedWebSocketState): boolean {
  return socket.closing === true;
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

function failureLabel(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
  return message.replace(/[^A-Za-z0-9_-]+/gu, "-").slice(0, 40) || "unknown";
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

function requestTargetBinding(observerSessionId: string, tabId: number, sourceGeneration: number,
  sessionId: string, targetId: string): {
    readonly requestFrameKey: string;
    readonly requestDocumentKey: string;
  } | null {
  if (sessionId.length === 0 || sessionId.length > 256 || targetId.length === 0 || targetId.length > 256) return null;
  return {
    requestFrameKey: opaqueRequestKey("http-frame", [observerSessionId, tabId, sessionId, targetId]),
    requestDocumentKey: opaqueRequestKey("http-document",
      [observerSessionId, tabId, sourceGeneration, sessionId, targetId])
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
