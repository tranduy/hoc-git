import type { CatalogSourceStatus, ChromeBridgeEnvelope, ProviderQuote } from "@tool-chenh/contracts";
import type { StoredCatalogRevision } from "../catalog/catalog-revision-store.js";
import { imContentRefusals } from "../chrome-bridge/im-http-adapter.js";
import { tsportContentRefusals } from "../chrome-bridge/tsport-ws-adapter.js";
import {
  CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS,
  chromeBridgeProviderAccountIdForLobby,
  type ChromeBridgeProviderAccountId
} from "../chrome-bridge/chrome-bridge-account.js";
import type { ChromeBridgeSourceSnapshot } from "../chrome-bridge/chrome-bridge-registry.js";
import type { AuthoritySlotSnapshot } from "../chrome-bridge/provider-authority-types.js";
import { providerFeedPolicies } from "../chrome-bridge/provider-feed-policies.js";
import type { ProviderFeedSnapshot } from "../chrome-bridge/provider-feed-types.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

export const PIPELINE_TELEMETRY_LIMITS = Object.freeze({
  windowMs: 300_000,
  bucketMs: 10_000,
  maxBucketsPerAccount: 30,
  maxEvidenceSamplesPerBucket: 256,
  maxSelectionsPerAccount: 50_000
});

const transportKeys = ["HTTP_RESPONSE", "WS_FRAME", "DOM_SNAPSHOT", "TAB_STATE"] as const;
const envelopeRejectKeys = ["SEQUENCE_GAP", "RETIRED_EPOCH", "TOO_OLD"] as const;
const adapterRejectKeys = ["PROVIDER_STREAM_GAP", "SCHEMA_CHANGED", "PRE_BASELINE"] as const;

type TransportKey = typeof transportKeys[number];
export type EnvelopeRejectReason = typeof envelopeRejectKeys[number];
export type AdapterRejectReason = typeof adapterRejectKeys[number];
export type PipelineHopName = "HOP1_TAB" | "HOP2_ATTACH" | "HOP3_ENVELOPE" | "HOP4_ADAPTER" |
  "HOP5_AUTHORITY" | "HOP6_FEED" | "HOP7_CATALOG" | "HOP8_SEMANTIC";

export interface PipelineHop {
  readonly hop: PipelineHopName;
  readonly ok: boolean;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface PipelineDiagnostic {
  readonly accountId: ChromeBridgeProviderAccountId;
  readonly lobby: string;
  readonly nowMs: number;
  readonly firstFailingHop: PipelineHopName | null;
  readonly hops: readonly PipelineHop[];
}

export interface PipelineTelemetryReaders {
  readonly listSources: () => readonly ChromeBridgeSourceSnapshot[];
  readonly listAuthorities: () => readonly AuthoritySlotSnapshot[];
  readonly listFeeds: () => readonly ProviderFeedSnapshot[];
  readonly listCatalogStatuses: () => Promise<readonly CatalogSourceStatus[]>;
  readonly catalogRevision: (accountId: string) => StoredCatalogRevision | undefined;
}

interface SemanticChange {
  readonly selectionKey: string;
  readonly before: string;
  readonly after: string;
  readonly atMs: number;
}

interface Bucket {
  readonly startedAtMs: number;
  readonly byTransport: Record<TransportKey, number>;
  readonly rejected: Record<EnvelopeRejectReason, number>;
  readonly adapterRejectReasons: Record<AdapterRejectReason, number>;
  readonly evidenceAtMs: number[];
  decoded: number;
  ignored: number;
  quoteChanges: number;
  sampleChange: SemanticChange | null;
}

interface AccountState {
  readonly buckets: Bucket[];
  readonly selections: Map<string, Pick<ProviderQuote, "rawOdds" | "status">>;
  sourceId: string | null;
  sourceEpoch: string | null;
  tabId: number | null;
  attachedAtMs: number | null;
  lastEnvelopeAtMs: number | null;
  lastSequence: number | null;
  lastDecodedAtMs: number | null;
  lastEvidenceAtMs: number | null;
  lastSemanticChangeAtMs: number | null;
  forcedUnlocks: number;
  /** Endpoints an adapter refused, so a renamed provider path is visible. */
  readonly ignoredEndpoints: Map<string, number>;
  /** Decoded updates the data plane then refused, by reason. The data plane
   *  has thirty-one refusal sites and until 2026-09-01 none of them was
   *  reported anywhere; SABA sat frozen for five minutes with the adapter
   *  decoding every DOM snapshot and nothing to say why the feed never moved. */
  readonly ingestRejections: Map<string, number>;
  /** Outcomes an extension-driven catalog refresh reported, already allowlisted
   *  at the source. A provider that lives on those refreshes is otherwise silent
   *  about why one produced nothing. */
  readonly refreshOutcomes: Map<string, number>;
  wsAttach: {
    readonly sourceGeneration: number;
    readonly webSocketCreated: number;
    readonly webSockets: number;
    readonly ksportTargets: number;
    readonly attachedTargets: number;
    readonly framesReceived: number;
    readonly framesOrphan: number;
    readonly framesForwarded: number;
    readonly ignoredSockets: number;
    readonly framesBinary: number;
    readonly framesNotOwner: number;
    readonly framesUnattributed: number;
    readonly framesNotActiveStream: number;
    readonly framesDecoderFailed: number;
    readonly sockjsOpen: number;
    readonly sockjsHeartbeat: number;
    readonly sockjsArray: number;
    readonly sockjsClose: number;
    readonly sockjsOther: number;
    readonly decoderFailCode: string;
    readonly stompFrames: number;
    readonly stompMessages: number;
    readonly stompPartitionRejected: number;
    readonly snapshotRejections: string;
    readonly destinationShapes: string;
    readonly stompPendingChars: number;
    readonly stompCommandFragments: number;
    readonly stompFragments: number;
    readonly destLiveLike: number;
    readonly destTodayLike: number;
    readonly destSportsLike: number;
    readonly subSportLike: number;
    readonly targetsTotal: number;
    readonly targetsIframe: number;
    readonly autoAttachEvents: number;
    readonly baselineLive: number;
    readonly baselineToday: number;
    readonly baselineTabSelections: number;
    readonly baselineTabStatus: string;
    readonly baselineTabTargets: number;
    readonly baselineTabStep: string;
    readonly baselineTabGroups: number;
    readonly baselineTabScopes: number;
    readonly baselineTabPeriods: number;
    readonly baselineTabLabels: string;
    readonly catalogShape: string;
    readonly reconnectAttempts: number;
    readonly reconnectOutcomes: string;
  } | null;
  recovery: {
    consecutiveFailures: number;
    nextAttemptAtMs: number | null;
    lastFailureCode: string | null;
  };
}

const refreshOutcomes = new Set(["catalog-requested", "rate-limited", "token-unavailable",
  "navigation-not-found", "unavailable"]);

const decoderFailCodes = new Set(["NONE", "PAYLOAD_TOO_LONG", "ENVELOPE_INVALID",
  "PENDING_OVERFLOW", "SENT_PENDING_OVERFLOW", "SUBSCRIBE_STRADDLE", "ATTEMPT_UNAVAILABLE",
  "DELTA_BUFFER_FULL", "EVIDENCE_VERSION_EXHAUSTED", "OTHER"]);

function failCode(value: unknown): string {
  return typeof value === "string" && decoderFailCodes.has(value) ? value : "NONE";
}

const tabStatuses = new Set(["NONE", "EVALUATE_FAILED", "time-tab-not-found",
  "time-tab-active", "time-tab-selected", "time-tab-reselected"]);

const tabSteps = new Set(["NONE", "group", "scope", "tab"]);

/** UI period-tab labels only: lowercase letters, digits, spaces and separators,
 *  bounded in length. Anything else is discarded rather than reported. */
/** Reason names with counts, e.g. "EVENT_TEAMS:12|LEAGUE_SHAPE:3". Shape only. */
function snapshotRejections(value: unknown): string {
  return typeof value === "string" && /^[A-Z_:0-9|]{0,208}$/u.test(value) ? value : "";
}

/** Counts and class names the capture reported. Printable ASCII only. */
function catalogShape(value: unknown): string {
  return typeof value === "string" && /^[ -~]{0,900}$/u.test(value) ? value : "";
}

function tabLabels(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9 |]{0,420}$/u.test(value) ? value : "";
}

function tabStep(value: unknown): string {
  return typeof value === "string" && tabSteps.has(value) ? value : "NONE";
}

function tabStatus(value: unknown): string {
  return typeof value === "string" && tabStatuses.has(value) ? value : "NONE";
}

function boundedCounter(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000
    ? Number(value)
    : 0;
}

function zeroes<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

function createBucket(startedAtMs: number): Bucket {
  return {
    startedAtMs,
    byTransport: zeroes(transportKeys),
    rejected: zeroes(envelopeRejectKeys),
    adapterRejectReasons: zeroes(adapterRejectKeys),
    evidenceAtMs: [], decoded: 0, ignored: 0, quoteChanges: 0, sampleChange: null
  };
}

function createState(): AccountState {
  return {
    buckets: [], selections: new Map(), sourceId: null, sourceEpoch: null, tabId: null,
    attachedAtMs: null, lastEnvelopeAtMs: null, lastSequence: null, lastDecodedAtMs: null,
    lastEvidenceAtMs: null, lastSemanticChangeAtMs: null, forcedUnlocks: 0,
    ignoredEndpoints: new Map(), refreshOutcomes: new Map(), ingestRejections: new Map(),
    wsAttach: null,
    recovery: { consecutiveFailures: 0, nextAttemptAtMs: null, lastFailureCode: null }
  };
}

export class PipelineTelemetry {
  readonly #now: () => number;
  readonly #states = new Map<ChromeBridgeProviderAccountId, AccountState>();

  constructor(options: { readonly now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
    for (const accountId of CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS) this.#states.set(accountId, createState());
  }

  recordEnvelope(envelope: ChromeBridgeEnvelope, sourceEpoch: string): void {
    const accountId = chromeBridgeProviderAccountIdForLobby(envelope.lobby);
    const state = this.#state(accountId);
    const atMs = envelope.observedAtMs;
    const bucket = this.#bucket(state, atMs);
    if (transportKeys.includes(envelope.transport as TransportKey)) {
      bucket.byTransport[envelope.transport as TransportKey] += 1;
    }
    if (state.sourceId !== envelope.sourceId || state.sourceEpoch !== sourceEpoch) {
      state.sourceId = envelope.sourceId;
      state.sourceEpoch = sourceEpoch;
      state.tabId = envelope.tabId;
      state.attachedAtMs = atMs;
      state.wsAttach = null;
    }
    state.lastEnvelopeAtMs = atMs;
    state.lastSequence = envelope.sequence;
    if (envelope.transport === "TAB_STATE") this.#recordWorkHealth(state, envelope.payload.body);
  }

  recordEnvelopeRejected(accountId: ChromeBridgeProviderAccountId, reason: EnvelopeRejectReason,
    atMs = this.#now()): void {
    this.#bucket(this.#state(accountId), atMs).rejected[reason] += 1;
  }

  recordAdapterDecoded(accountId: ChromeBridgeProviderAccountId, atMs = this.#now()): void {
    const state = this.#state(accountId);
    this.#bucket(state, atMs).decoded += 1;
    state.lastDecodedAtMs = atMs;
  }

  recordAdapterIgnored(accountId: ChromeBridgeProviderAccountId, atMs = this.#now(),
    pathnameClass?: string): void {
    const state = this.#state(accountId);
    this.#bucket(state, atMs).ignored += 1;
    // Path shape only, bounded in length and in how many distinct endpoints are
    // remembered. An adapter that matches exact provider paths goes silent when
    // the provider renames one, and nothing else in the pipeline can show that.
    if (pathnameClass === undefined || !/^\/[\w./-]{0,63}$/u.test(pathnameClass)) return;
    const seen = state.ignoredEndpoints.get(pathnameClass) ?? 0;
    if (seen === 0 && state.ignoredEndpoints.size >= 8) return;
    state.ignoredEndpoints.set(pathnameClass, seen + 1);
  }

  recordIngestRejected(accountId: ChromeBridgeProviderAccountId, reason: string): void {
    const state = this.#state(accountId);
    // Reason shape only: the data plane's own `CODE:adapter-id` label.
    if (!/^[A-Z_]{3,48}(?::[\w.-]{0,48})?$/u.test(reason)) return;
    const seen = state.ingestRejections.get(reason) ?? 0;
    if (seen === 0 && state.ingestRejections.size >= 8) return;
    state.ingestRejections.set(reason, seen + 1);
  }

  recordAdapterRejected(accountId: ChromeBridgeProviderAccountId, reason: AdapterRejectReason,
    atMs = this.#now()): void {
    this.#bucket(this.#state(accountId), atMs).adapterRejectReasons[reason] += 1;
  }

  recordFeed(snapshot: ProviderFeedSnapshot): void {
    const accountId = snapshot.accountId as ChromeBridgeProviderAccountId;
    if (!this.#states.has(accountId)) return;
    const evidenceAtMs = snapshot.lastAuthoritativeEvidenceAtMs;
    const state = this.#state(accountId);
    if (evidenceAtMs === null || evidenceAtMs === state.lastEvidenceAtMs) return;
    state.lastEvidenceAtMs = evidenceAtMs;
    const samples = this.#bucket(state, evidenceAtMs).evidenceAtMs;
    if (samples.length < PIPELINE_TELEMETRY_LIMITS.maxEvidenceSamplesPerBucket) samples.push(evidenceAtMs);
  }

  recordCatalog(catalog: ObservedProviderCatalog): void {
    const accountId = catalog.accountId as ChromeBridgeProviderAccountId;
    if (!this.#states.has(accountId)) return;
    const state = this.#state(accountId);
    const next = new Map<string, Pick<ProviderQuote, "rawOdds" | "status">>();
    let changes = 0;
    let sample: SemanticChange | null = null;
    for (const quote of catalog.quotes) {
      if (next.size >= PIPELINE_TELEMETRY_LIMITS.maxSelectionsPerAccount) break;
      const key = selectionKey(quote);
      const current = { rawOdds: quote.rawOdds, status: quote.status };
      next.set(key, current);
      const previous = state.selections.get(key);
      if (previous === undefined || (previous.rawOdds === current.rawOdds && previous.status === current.status)) continue;
      changes += 1;
      sample ??= {
        selectionKey: key,
        before: previous.rawOdds !== current.rawOdds ? previous.rawOdds : previous.status,
        after: previous.rawOdds !== current.rawOdds ? current.rawOdds : current.status,
        atMs: catalog.observedAtMs
      };
    }
    state.selections.clear();
    for (const [key, value] of next) state.selections.set(key, value);
    if (changes === 0) return;
    const bucket = this.#bucket(state, catalog.observedAtMs);
    bucket.quoteChanges += changes;
    bucket.sampleChange ??= sample;
    state.lastSemanticChangeAtMs = catalog.observedAtMs;
  }

  recordRecovery(accountId: string, status: {
    readonly consecutiveFailures: number;
    readonly nextAttemptAtMs: number | null;
    readonly lastFailureCode: string | null;
  }): void {
    const state = this.#states.get(accountId as ChromeBridgeProviderAccountId);
    if (state !== undefined) state.recovery = { ...status };
  }

  async diagnostics(readers: PipelineTelemetryReaders): Promise<readonly PipelineDiagnostic[]> {
    const [statuses] = await Promise.all([readers.listCatalogStatuses()]);
    const sources = readers.listSources();
    const authorities = readers.listAuthorities();
    const feeds = readers.listFeeds();
    return CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS.map((accountId) => this.#diagnostic(accountId, {
      sources, authorities, feeds, statuses, revision: readers.catalogRevision(accountId)
    }));
  }

  async diagnostic(readers: PipelineTelemetryReaders, accountId: string): Promise<PipelineDiagnostic | null> {
    if (!CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS.includes(accountId as ChromeBridgeProviderAccountId)) return null;
    const all = await this.diagnostics(readers);
    return all.find((item) => item.accountId === accountId) ?? null;
  }

  storageStats(): { readonly buckets: number; readonly selections: number } {
    this.#pruneAll();
    return {
      buckets: [...this.#states.values()].reduce((sum, state) => sum + state.buckets.length, 0),
      selections: [...this.#states.values()].reduce((sum, state) => sum + state.selections.size, 0)
    };
  }

  #diagnostic(accountId: ChromeBridgeProviderAccountId, current: {
    readonly sources: readonly ChromeBridgeSourceSnapshot[];
    readonly authorities: readonly AuthoritySlotSnapshot[];
    readonly feeds: readonly ProviderFeedSnapshot[];
    readonly statuses: readonly CatalogSourceStatus[];
    readonly revision: StoredCatalogRevision | undefined;
  }): PipelineDiagnostic {
    const nowMs = this.#now();
    const state = this.#state(accountId);
    this.#prune(state, nowMs);
    const lobby = accountId.split(":")[1]!;
    const matchingSources = current.sources.filter((item) =>
      chromeBridgeProviderAccountIdForLobby(item.lobby) === accountId);
    const source = matchingSources.find((item) => item.authorityDisposition === "ACTIVE") ??
      matchingSources[0] ?? null;
    const authority = current.authorities.find((item) => item.accountId === accountId) ?? null;
    const feed = current.feeds.find((item) => item.accountId === accountId) ?? null;
    const status = current.statuses.find((item) => item.id === accountId) ?? null;
    const policy = providerFeedPolicies.get(accountId)!;
    const sums = sumBuckets(state.buckets);
    const requiredEnvelopeTransport = accountId === "catalog-source:SABA:FOOTBALL" ||
      accountId === "catalog-source:SBOBET:FOOTBALL" ||
      accountId === "catalog-source:APSPORT:FOOTBALL" ? "WS_FRAME" : "HTTP_RESPONSE";
    const evidence = state.buckets.flatMap((bucket) => bucket.evidenceAtMs).sort((left, right) => left - right);
    const cadence = percentileCadence(evidence);
    const quoteChanges60s = state.buckets.filter((bucket) => bucket.startedAtMs >= nowMs - 60_000)
      .reduce((sum, bucket) => sum + bucket.quoteChanges, 0);
    const sampleChange = [...state.buckets].reverse().find((bucket) => bucket.sampleChange !== null)?.sampleChange ?? null;
    const catalog = current.revision?.catalog;
    const hops: PipelineHop[] = [
      { hop: "HOP1_TAB", ok: source?.state === "LIVE", detail: {
        sourceId: source?.sourceId ?? null, tabId: source?.tabId ?? null,
        authorityDisposition: source?.authorityDisposition ?? null
      } },
      { hop: "HOP2_ATTACH", ok: state.sourceEpoch !== null && state.sourceId === source?.sourceId, detail: {
        sourceEpoch: state.sourceEpoch,
        attachedForMs: state.attachedAtMs === null ? null : Math.max(0, nowMs - state.attachedAtMs)
      } },
      { hop: "HOP3_ENVELOPE", ok: state.lastEnvelopeAtMs !== null &&
        nowMs - state.lastEnvelopeAtMs <= PIPELINE_TELEMETRY_LIMITS.windowMs &&
        sums.byTransport[requiredEnvelopeTransport] > 0, detail: {
        lastEnvelopeAgeMs: age(nowMs, state.lastEnvelopeAtMs), lastSequence: state.lastSequence,
        requiredTransport: requiredEnvelopeTransport, byTransport: sums.byTransport,
        rejected: sums.rejected, wsAttach: state.wsAttach
      } },
      { hop: "HOP4_ADAPTER", ok: state.lastDecodedAtMs !== null &&
        nowMs - state.lastDecodedAtMs <= PIPELINE_TELEMETRY_LIMITS.windowMs, detail: {
        decoded: sums.decoded, ignored: sums.ignored, rejectReasons: sums.adapterRejectReasons,
        // Why frames that reached an adapter were not recognised as its
        // provider's records. Shape names only; no frame value is kept.
        // Each map is provider-owned; APSPORT's is the fallback for the
        // providers that have no counter of their own yet, so this cell is
        // only trustworthy for IM and APSPORT.
        contentRefusals: [...(accountId === "catalog-source:IM:FOOTBALL" ? imContentRefusals
          : tsportContentRefusals).entries()]
          .map(([reason, count]) => `${reason}:${count}`).join(" "),
        lastDecodedAgeMs: age(nowMs, state.lastDecodedAtMs), forcedUnlocks: state.forcedUnlocks,
        ingestRejections: [...state.ingestRejections.entries()]
          .sort((left, right) => right[1] - left[1]).slice(0, 8)
          .map(([reason, count]) => `${reason}:${count}`).join(" "),
        ignoredEndpoints: [...state.ignoredEndpoints.entries()]
          .sort((left, right) => right[1] - left[1]).slice(0, 6)
          .map(([pathnameClass, count]) => ({ pathnameClass, count })),
        refreshOutcomes: [...state.refreshOutcomes.entries()]
          .sort((left, right) => right[1] - left[1]).slice(0, 6)
          .map(([status, count]) => ({ status, count }))
      } },
      { hop: "HOP5_AUTHORITY", ok: authority?.active !== null && authority?.active !== undefined, detail: {
        authorityDisposition: authority?.active !== null && authority?.active !== undefined ? "ACTIVE" : "NONE"
      } },
      { hop: "HOP6_FEED", ok: feed?.state === "LIVE", detail: {
        state: feed?.state ?? "STARTING", reason: feed?.reason ?? "NO_FEED",
        activeGeneration: feed?.activeGeneration ?? null,
        baselineAgeMs: age(nowMs, feed?.lastCompleteBaselineAtMs ?? null),
        maxBaselineAgeMs: policy.maxBaselineAgeMs,
        evidenceAgeMs: age(nowMs, feed?.lastAuthoritativeEvidenceAtMs ?? null),
        expectedEvidenceCadenceMs: policy.expectedEvidenceCadenceMs,
        observedEvidenceCadenceMs: cadence,
        recoveryStage: feed?.recoveryStage ?? "NONE", recoveryAttempt: feed?.recoveryAttempt ?? 0,
        consecutiveFailures: state.recovery.consecutiveFailures,
        nextAttemptInMs: state.recovery.nextAttemptAtMs === null ? null : Math.max(0, state.recovery.nextAttemptAtMs - nowMs),
        lastFailureCode: state.recovery.lastFailureCode
      } },
      { hop: "HOP7_CATALOG", ok: status?.sessionState === "ACTIVE" &&
        current.revision?.snapshotState === "FRESH" && (catalog?.quotes.length ?? 0) > 0, detail: {
        sessionState: status?.sessionState ?? "UNCONFIGURED", reason: status?.reason ?? null,
        snapshotState: current.revision?.snapshotState ?? "STALE", revision: current.revision?.revision ?? null,
        catalogAgeMs: age(nowMs, current.revision?.observedAtMs ?? null),
        events: catalog?.events.length ?? 0, markets: catalog?.markets.length ?? 0, quotes: catalog?.quotes.length ?? 0
      } },
      { hop: "HOP8_SEMANTIC", ok: sums.quoteChanges > 0, detail: {
        quoteChanges60s, quoteChanges300s: sums.quoteChanges,
        lastSemanticChangeAgeMs: age(nowMs, state.lastSemanticChangeAtMs), sampleChange
      } }
    ];
    return { accountId, lobby, nowMs,
      firstFailingHop: hops.find((hop) => !hop.ok)?.hop ?? null, hops };
  }

  #recordWorkHealth(state: AccountState, body: string): void {
    try {
      const value = JSON.parse(body) as { kind?: unknown; results?: unknown;
        counters?: { forcedUnlocks?: unknown };
        sourceGeneration?: unknown; webSocketCreated?: unknown; webSockets?: unknown;
        ksportTargets?: unknown; attachedTargets?: unknown; framesReceived?: unknown;
        framesOrphan?: unknown; framesForwarded?: unknown; ignoredSockets?: unknown;
        framesBinary?: unknown; framesNotOwner?: unknown; framesUnattributed?: unknown;
        framesNotActiveStream?: unknown; framesDecoderFailed?: unknown;
        sockjsOpen?: unknown; sockjsHeartbeat?: unknown; sockjsArray?: unknown;
        sockjsClose?: unknown; sockjsOther?: unknown; decoderFailCode?: unknown;
        stompFrames?: unknown; stompMessages?: unknown; stompPartitionRejected?: unknown;
        snapshotRejections?: unknown; destinationShapes?: unknown;
        stompPendingChars?: unknown; stompCommandFragments?: unknown; stompFragments?: unknown;
        destLiveLike?: unknown; destTodayLike?: unknown; destSportsLike?: unknown;
        subSportLike?: unknown; targetsTotal?: unknown; targetsIframe?: unknown;
        autoAttachEvents?: unknown; baselineLive?: unknown; baselineToday?: unknown;
        baselineTabSelections?: unknown; baselineTabStatus?: unknown;
        baselineTabTargets?: unknown; baselineTabStep?: unknown; baselineTabGroups?: unknown;
        baselineTabScopes?: unknown; baselineTabPeriods?: unknown; baselineTabLabels?: unknown;
        catalogShape?: unknown; reconnectAttempts?: unknown; reconnectOutcomes?: unknown };
      if (Array.isArray((value as { results?: unknown }).results)) {
        for (const entry of (value as { results: readonly unknown[] }).results) {
          if (typeof entry !== "string" || !refreshOutcomes.has(entry)) continue;
          const seen = state.refreshOutcomes.get(entry) ?? 0;
          if (seen === 0 && state.refreshOutcomes.size >= 8) continue;
          state.refreshOutcomes.set(entry, seen + 1);
        }
      }
      if (value.kind === "WORK_HEALTH" && Number.isSafeInteger(value.counters?.forcedUnlocks) &&
        Number(value.counters?.forcedUnlocks) >= 0) state.forcedUnlocks = Number(value.counters?.forcedUnlocks);
      const counters = [value.sourceGeneration, value.webSocketCreated, value.webSockets,
        value.ksportTargets, value.attachedTargets];
      if (value.kind === "WS_ATTACH" && counters.every((counter) => Number.isSafeInteger(counter) &&
        Number(counter) >= 0 && Number(counter) <= 1_000_000)) {
        // Frame counters ship with a newer extension than the running API may
        // be paired with; absent ones read as zero rather than dropping the
        // whole diagnostic.
        state.wsAttach = {
          sourceGeneration: Number(value.sourceGeneration), webSocketCreated: Number(value.webSocketCreated),
          webSockets: Number(value.webSockets), ksportTargets: Number(value.ksportTargets),
          attachedTargets: Number(value.attachedTargets),
          framesReceived: boundedCounter(value.framesReceived),
          framesOrphan: boundedCounter(value.framesOrphan),
          framesForwarded: boundedCounter(value.framesForwarded),
          ignoredSockets: boundedCounter(value.ignoredSockets),
          framesBinary: boundedCounter(value.framesBinary),
          framesNotOwner: boundedCounter(value.framesNotOwner),
          framesUnattributed: boundedCounter(value.framesUnattributed),
          framesNotActiveStream: boundedCounter(value.framesNotActiveStream),
          framesDecoderFailed: boundedCounter(value.framesDecoderFailed),
          sockjsOpen: boundedCounter(value.sockjsOpen),
          sockjsHeartbeat: boundedCounter(value.sockjsHeartbeat),
          sockjsArray: boundedCounter(value.sockjsArray),
          sockjsClose: boundedCounter(value.sockjsClose),
          sockjsOther: boundedCounter(value.sockjsOther),
          decoderFailCode: failCode(value.decoderFailCode),
          stompFrames: boundedCounter(value.stompFrames),
          stompMessages: boundedCounter(value.stompMessages),
          stompPartitionRejected: boundedCounter(value.stompPartitionRejected),
          snapshotRejections: snapshotRejections(value.snapshotRejections),
          destinationShapes: catalogShape(value.destinationShapes),
          reconnectAttempts: boundedCounter(value.reconnectAttempts),
          reconnectOutcomes: catalogShape(value.reconnectOutcomes),
          stompPendingChars: boundedCounter(value.stompPendingChars),
          stompCommandFragments: boundedCounter(value.stompCommandFragments),
          stompFragments: boundedCounter(value.stompFragments),
          destLiveLike: boundedCounter(value.destLiveLike),
          destTodayLike: boundedCounter(value.destTodayLike),
          destSportsLike: boundedCounter(value.destSportsLike),
          subSportLike: boundedCounter(value.subSportLike),
          targetsTotal: boundedCounter(value.targetsTotal),
          targetsIframe: boundedCounter(value.targetsIframe),
          autoAttachEvents: boundedCounter(value.autoAttachEvents),
          baselineLive: boundedCounter(value.baselineLive),
          baselineToday: boundedCounter(value.baselineToday),
          baselineTabSelections: boundedCounter(value.baselineTabSelections),
          baselineTabStatus: tabStatus(value.baselineTabStatus),
          baselineTabTargets: boundedCounter(value.baselineTabTargets),
          baselineTabStep: tabStep(value.baselineTabStep),
          baselineTabGroups: boundedCounter(value.baselineTabGroups),
          baselineTabScopes: boundedCounter(value.baselineTabScopes),
          baselineTabPeriods: boundedCounter(value.baselineTabPeriods),
          baselineTabLabels: tabLabels(value.baselineTabLabels),
          catalogShape: catalogShape(value.catalogShape)
        };
      }
    } catch { /* malformed diagnostic envelopes are ignored without retaining the body */ }
  }

  #state(accountId: ChromeBridgeProviderAccountId): AccountState {
    return this.#states.get(accountId)!;
  }

  #bucket(state: AccountState, atMs: number): Bucket {
    this.#prune(state, this.#now());
    const startedAtMs = Math.floor(atMs / PIPELINE_TELEMETRY_LIMITS.bucketMs) * PIPELINE_TELEMETRY_LIMITS.bucketMs;
    let bucket = state.buckets.find((item) => item.startedAtMs === startedAtMs);
    if (bucket === undefined) {
      bucket = createBucket(startedAtMs);
      state.buckets.push(bucket);
      state.buckets.sort((left, right) => left.startedAtMs - right.startedAtMs);
      while (state.buckets.length > PIPELINE_TELEMETRY_LIMITS.maxBucketsPerAccount) state.buckets.shift();
    }
    return bucket;
  }

  #pruneAll(): void {
    const nowMs = this.#now();
    for (const state of this.#states.values()) this.#prune(state, nowMs);
  }

  #prune(state: AccountState, nowMs: number): void {
    const cutoff = nowMs - PIPELINE_TELEMETRY_LIMITS.windowMs;
    while (state.buckets[0] !== undefined && state.buckets[0].startedAtMs < cutoff) state.buckets.shift();
  }
}

function age(nowMs: number, atMs: number | null): number | null {
  return atMs === null ? null : Math.max(0, nowMs - atMs);
}

function selectionKey(quote: ProviderQuote): string {
  return [quote.provider, quote.providerEventId, quote.providerMarketId, quote.providerSelectionId].join(":");
}

function percentileCadence(evidenceAtMs: readonly number[]): { readonly p50: number | null;
  readonly p95: number | null; readonly samples: number } {
  const gaps = evidenceAtMs.slice(1).map((value, index) => value - evidenceAtMs[index]!)
    .filter((value) => value >= 0).sort((left, right) => left - right);
  const pick = (ratio: number): number | null => gaps.length === 0 ? null
    : gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * ratio) - 1)]!;
  return { p50: pick(0.5), p95: pick(0.95), samples: gaps.length };
}

function sumBuckets(buckets: readonly Bucket[]): {
  readonly byTransport: Record<TransportKey, number>;
  readonly rejected: Record<EnvelopeRejectReason, number>;
  readonly adapterRejectReasons: Record<AdapterRejectReason, number>;
  readonly decoded: number;
  readonly ignored: number;
  readonly quoteChanges: number;
} {
  const result = { byTransport: zeroes(transportKeys), rejected: zeroes(envelopeRejectKeys),
    adapterRejectReasons: zeroes(adapterRejectKeys), decoded: 0, ignored: 0, quoteChanges: 0 };
  for (const bucket of buckets) {
    for (const key of transportKeys) result.byTransport[key] += bucket.byTransport[key];
    for (const key of envelopeRejectKeys) result.rejected[key] += bucket.rejected[key];
    for (const key of adapterRejectKeys) result.adapterRejectReasons[key] += bucket.adapterRejectReasons[key];
    result.decoded += bucket.decoded;
    result.ignored += bucket.ignored;
    result.quoteChanges += bucket.quoteChanges;
  }
  return result;
}
