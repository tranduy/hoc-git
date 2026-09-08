import { normalizeObservedFootballCatalog, observeNativeCmdMarkets,
  type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";
import { normalizeCmdNativeMore, parseCmdNativeMore, type CmdNativeMore } from "./cmd-more-native.js";

const ACCOUNT_ID = "catalog-source:CMD:FOOTBALL";
const HOST = "cgnew.fts368.com";
const PATH = "/Member/BetsView/BetLight/DataOdds.ashx";
const MORE_PATH = "/Member/BetsView/BetLight/DataOdds.asmx/GetAllOdds";
const FULL_ROW_LENGTH = 91;
const MIN_METADATA_ROW_LENGTH = 128;
const MAX_METADATA_ROW_LENGTH = 4_096;
const MAX_PRE_BASELINE_RESPONSES = 32;
const MAX_PRE_BASELINE_OPERATIONS = 256;
const MORE_PUBLICATION_INTERVAL_MS = 1_000;

interface CmdRoot {
  readonly t: number;
  readonly a: boolean;
  readonly data: readonly unknown[][];
  readonly dataPresent: boolean;
  readonly today?: readonly unknown[][];
  readonly f?: unknown;
}

interface RetainedRow {
  readonly row: unknown[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

interface DeltaObservation {
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

interface PendingDelta {
  readonly providerVersion: number;
  readonly data: readonly unknown[][];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

interface BaselineObservation {
  readonly providerVersion: number;
  readonly requestFrameKey: string | undefined;
  readonly requestDocumentKey: string;
  readonly observerSessionId: string;
  readonly observerRequestOrdinal: number;
}

interface SourceState {
  rows: Map<string, RetainedRow> | null;
  generation: string | null;
  providerVersion: number | null;
  gap: boolean;
  pendingDeltas: PendingDelta[];
  pendingOperationCount: number;
  preBaselineIncomplete: boolean;
  baselineObservation: BaselineObservation | null;
  sourceEpoch?: string | undefined;
}

interface EarlyState {
  readonly rows: Map<string, RetainedRow>;
  readonly providerVersion: number;
  readonly observation: BaselineObservation;
  readonly sourceEpoch: string | undefined;
}

interface MoreState {
  readonly native: CmdNativeMore;
  readonly ownerIdentity: string;
  readonly observation: BaselineObservation;
  readonly sourceEpoch: string | undefined;
  readonly receipt: DeltaObservation;
  readonly normalized: NormalizedCatalogPart;
}

const marketPositions = {
  1: { line: 10, home: 40, away: 41 },
  3: { line: 12, home: 42, away: 43 },
  7: { line: 14, home: 44, away: 45 },
  8: { line: 16, home: 46, away: 47 }
} as const;

const deltaCommands = new Map<number, { readonly betType: keyof typeof marketPositions;
  readonly kind: "LINE" | "ODDS" }>([
  [28, { betType: 1, kind: "LINE" }], [30, { betType: 1, kind: "ODDS" }],
  [33, { betType: 3, kind: "LINE" }], [35, { betType: 3, kind: "ODDS" }],
  [38, { betType: 7, kind: "LINE" }], [40, { betType: 7, kind: "ODDS" }],
  [43, { betType: 8, kind: "LINE" }], [45, { betType: 8, kind: "ODDS" }]
]);

export class CmdHttpCatalogAdapter implements ChromeTrafficAdapter {
  // CMD DOM and HTTP are complementary evidence for one source identity.
  readonly id = "cmd-public-dom-v1";
  readonly lobby = "CMD" as const;
  readonly providerFamily = "CMD";
  readonly #states = new Map<string, SourceState>();
  readonly #earlyStates = new Map<string, EarlyState>();
  readonly #moreStates = new Map<string, Map<string, MoreState>>();
  readonly #ownerAdmissions = new Map<string, Map<string, { identity: string; sequence: number }>>();
  readonly #normalizedRows = new WeakMap<RetainedRow, NormalizedCatalogPart>();
  readonly #morePublicationAtMs = new Map<string, number>();
  readonly #parsedBodies = new WeakMap<ChromeBridgeEnvelope, CmdRoot | null>();

  resetSource(sourceId: string): void {
    this.#states.delete(sourceId); this.#earlyStates.delete(sourceId);
    this.#moreStates.delete(sourceId); this.#ownerAdmissions.delete(sourceId);
    this.#morePublicationAtMs.delete(sourceId);
  }

  // Every exit below returned a bare empty array, so an adapter dropping 147
  // odds frames in a row said nothing at all about which gate it left by. The
  // data plane reads this once per decode and reports it where the endpoint
  // would go.
  #ignoreReason: string | null = null;

  takeIgnoreReason(): string | null {
    const reason = this.#ignoreReason;
    this.#ignoreReason = null;
    return reason;
  }

  #ignore(reason: string): readonly DecodedCatalogUpdate[] {
    this.#ignoreReason = reason;
    return [];
  }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby === "CMD" && envelope.transport === "HTTP_RESPONSE" &&
      envelope.request.hostname === HOST && envelope.request.pathnameClass === MORE_PATH &&
      envelope.request.method === "POST" && envelope.request.providerGroupId !== undefined &&
      envelope.payload.encoding === "UTF8") return parseCmdNativeMore(envelope.payload.body) !== null;
    if (envelope.lobby !== "CMD" || envelope.transport !== "HTTP_RESPONSE" ||
      envelope.request.hostname !== HOST || envelope.request.pathnameClass !== PATH ||
      envelope.payload.encoding !== "UTF8" || envelope.request.providerFunctionCode === undefined) return false;
    const root = parseRoot(envelope.payload.body);
    this.#parsedBodies.set(envelope, root);
    return root !== null;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return this.#ignore("fingerprint-refused");
    if (envelope.request.pathnameClass === MORE_PATH) return this.#decodeMore(envelope);
    const root = this.#parsedBodies.get(envelope) ?? parseRoot(envelope.payload.body);
    if (root === null) return this.#ignore("body-unparsable");
    if (envelope.request.providerFunctionCode === 6) return this.#decodeEarly(envelope, root);
    const state = this.#states.get(envelope.sourceId) ?? { rows: null, generation: null,
      providerVersion: null, gap: false, pendingDeltas: [], pendingOperationCount: 0,
      preBaselineIncomplete: false, baselineObservation: null };
    const providerFunctionCode = envelope.request.providerFunctionCode;
    const isFullFamily = providerFunctionCode === 1 || providerFunctionCode === 2 ||
      providerFunctionCode === 4 || providerFunctionCode === 6;
    const isDeltaFamily = providerFunctionCode === 3 || providerFunctionCode === 5 ||
      providerFunctionCode === 7;
    const isAtomicFull = providerFunctionCode === 1 && root.dataPresent && root.today !== undefined && root.f !== undefined;
    const observation = isAtomicFull ? boundBaselineObservation(envelope) : null;
    const sameProviderVersion = state.providerVersion !== null && root.t === state.providerVersion;
    const renewsSameProviderVersion = root.a && sameProviderVersion && !state.gap && state.rows !== null &&
      state.generation !== null && observation !== null &&
      state.baselineObservation?.providerVersion === root.t &&
      state.baselineObservation.requestDocumentKey === observation.requestDocumentKey &&
      state.baselineObservation.observerSessionId === observation.observerSessionId &&
      observation.observerRequestOrdinal > state.baselineObservation.observerRequestOrdinal;
    if (state.providerVersion !== null && (root.t < state.providerVersion ||
      (sameProviderVersion && !renewsSameProviderVersion))) {
      return this.#ignore(root.t < state.providerVersion ? "cursor-older" : "cursor-same-not-renewed");
    }
    if (!root.a) {
      state.rows = null;
      state.generation = null;
      state.providerVersion = root.t;
      state.gap = true;
      state.pendingDeltas = [];
      state.pendingOperationCount = 0;
      state.preBaselineIncomplete = false;
      state.baselineObservation = null;
      this.#moreStates.delete(envelope.sourceId);
      this.#earlyStates.delete(envelope.sourceId);
      this.#ownerAdmissions.delete(envelope.sourceId);
      this.#morePublicationAtMs.delete(envelope.sourceId);
      this.#states.set(envelope.sourceId, state);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
        reason: "PROVIDER_STREAM_GAP" }];
    }

    let evidenceMode: "BASELINE" | "DELTA";
    if (isAtomicFull) {
      if (observation === null) return this.#ignore("baseline-not-bound-to-a-request");
      const candidates = [...root.data, ...root.today!];
      // A row nobody can read is one fixture nobody can price, and the whole
      // baseline used to go with it. CMD discarded fourteen baselines of about
      // 1,690 rows each on 2026-08-29, one unreadable row at a time, and stayed
      // a CANDIDATE with an 84-minute-old catalog - because a baseline is what
      // promotes it, and it never finished one.
      //
      // A changed schema still has to be refused, and the count is what tells
      // them apart: a renamed field makes every row unreadable at once, while
      // ordinary provider noise is one row in a thousand. Above a twentieth,
      // refuse and say so; below it, leave those fixtures out. A fixture missing
      // from the catalog is one nobody prices, which is the safe direction - the
      // unsafe one is keeping its old price and calling it current.
      const unusable = new Set(candidates.filter((candidate) => !isKnownMetadataRow(candidate) &&
        (!isFullRow(candidate) || decodeRecord(candidate) === null)));
      if (unusable.size * 20 > candidates.length) {
        return this.#ignore(`baseline-${unusable.size}-rows-unusable-of-${candidates.length}`);
      }
      const fullRows = candidates.filter((candidate) => !unusable.has(candidate) && isFullRow(candidate));
      if (fullRows.length === 0) return this.#ignore("baseline-no-full-rows");
      const rows = new Map<string, RetainedRow>();
      const priorRows = state.sourceEpoch === envelope.sourceEpoch &&
        state.baselineObservation?.requestDocumentKey === observation.requestDocumentKey &&
        state.baselineObservation.observerSessionId === observation.observerSessionId
        ? this.#combinedRows(envelope.sourceId, state) : new Map<string, RetainedRow>();
      for (const candidate of fullRows) {
        const eventId = providerId(candidate[0]);
        if (eventId === null) return this.#ignore("baseline-row-without-event-id");
        rows.set(eventId, retainAfterCutoff(candidate, priorRows.get(eventId), envelope));
      }
      if (rows.size === 0) return this.#ignore("baseline-rows-empty");
      const pendingDeltas = state.pendingDeltas.filter((pending) => pending.providerVersion > root.t)
        .sort((first, second) => first.providerVersion - second.providerVersion || first.sequence - second.sequence);
      for (const pending of pendingDeltas) {
        if (pending.data.some((delta) => applyDelta(rows, delta, pending) !== "APPLIED")) {
          state.pendingDeltas = [];
          state.pendingOperationCount = 0;
          state.preBaselineIncomplete = true;
          this.#states.set(envelope.sourceId, state);
          return [reconciliationRequired(envelope)];
        }
      }
      state.rows = rows;
      state.sourceEpoch = envelope.sourceEpoch;
      if (renewsSameProviderVersion) {
        state.baselineObservation = { providerVersion: root.t,
          requestFrameKey: observation.requestFrameKey,
          requestDocumentKey: observation.requestDocumentKey,
          observerSessionId: observation.observerSessionId,
          observerRequestOrdinal: observation.observerRequestOrdinal };
        state.generation = `cmd:${root.t}:observation:${observation.observerRequestOrdinal}`;
      } else {
        state.baselineObservation = { providerVersion: root.t,
          requestFrameKey: observation.requestFrameKey,
          requestDocumentKey: observation.requestDocumentKey,
          observerSessionId: observation.observerSessionId,
          observerRequestOrdinal: observation.observerRequestOrdinal };
        state.generation = `cmd:${root.t}`;
      }
      state.providerVersion = pendingDeltas.at(-1)?.providerVersion ?? root.t;
      state.gap = false;
      state.pendingDeltas = [];
      state.pendingOperationCount = 0;
      state.preBaselineIncomplete = false;
      evidenceMode = "BASELINE";
    } else {
      // Only fc=1 has an observed atomic running+today completion rule. Other
      // full-family partitions remain fail-closed until their provider contract
      // is characterized; a full-shaped body on a delta fc is never promoted.
      if (isDeltaFamily && root.today === undefined && root.f === undefined && !state.gap &&
        state.rows === null && state.generation === null) {
        const data = retainPendingDeltaData(root.data);
        const duplicateCursor = state.pendingDeltas.some((pending) => pending.providerVersion === root.t);
        if (state.preBaselineIncomplete || data === null || duplicateCursor ||
          state.pendingDeltas.length >= MAX_PRE_BASELINE_RESPONSES ||
          state.pendingOperationCount + data.length > MAX_PRE_BASELINE_OPERATIONS) {
          const newlyIncomplete = !state.preBaselineIncomplete;
          state.pendingDeltas = [];
          state.pendingOperationCount = 0;
          state.preBaselineIncomplete = true;
          this.#states.set(envelope.sourceId, state);
          return newlyIncomplete ? [reconciliationRequired(envelope)] : this.#ignore("pre-baseline-still-incomplete");
        }
        state.pendingDeltas.push({ providerVersion: root.t, data,
          observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
          sequence: envelope.sequence });
        state.pendingOperationCount += data.length;
        this.#states.set(envelope.sourceId, state);
        return this.#ignore("delta-held-until-baseline");
      }
      if (isFullFamily || !isDeltaFamily || root.today !== undefined || root.f !== undefined || state.gap) {
        this.#states.set(envelope.sourceId, state);
        return this.#ignore("delta-family-mismatch");
      }
      if (state.rows === null || state.generation === null) return this.#ignore("no-baseline-retained");
      const nextRows = new Map(state.rows);
      let changed = false;
      for (const delta of root.data) {
        const outcome = applyDelta(nextRows, delta, envelope);
        if (outcome === "INVALID") return this.#ignore(`delta-invalid-of-${root.data.length}`);
        changed = outcome === "APPLIED" || changed;
      }
      state.rows = nextRows;
      state.providerVersion = root.t;
      this.#states.set(envelope.sourceId, state);
      // Unknown provider commands are deliberately not decoded, but their
      // verified cursor still closes the ordering window against late frames.
      if (!changed) return this.#ignore("delta-changed-nothing");
      evidenceMode = "DELTA";
    }
    this.#states.set(envelope.sourceId, state);
    const catalog = this.#materialize(envelope.sourceId, state, envelope.observedAtMs);
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
      value: catalog, ...(evidenceMode === "BASELINE" ? { authoritativeBaseline: true } : {}),
      evidenceMode, generation: state.generation!, provenance: "AUTHENTICATED_HTTP",
      // `t` is CMD's ordering cursor/version, not a Unix timestamp.
      providerTimestampMs: null }];
  }

  #decodeEarly(envelope: ChromeBridgeEnvelope, root: CmdRoot): readonly DecodedCatalogUpdate[] {
    const main = this.#states.get(envelope.sourceId);
    const observation = boundBaselineObservation(envelope);
    const cutoff = envelope.request.reconcileCutoffSequence;
    if (envelope.request.cmdFullScope !== true || envelope.request.requestFrameKey === undefined ||
      observation === null || cutoff === undefined || cutoff >= envelope.sequence || !root.a ||
      root.dataPresent || root.today === undefined || root.f === undefined) return this.#ignore("early-scope-unproven");
    if (main?.baselineObservation !== null && main?.baselineObservation !== undefined &&
      (main.sourceEpoch !== envelope.sourceEpoch ||
        main.baselineObservation.requestFrameKey !== observation.requestFrameKey ||
        main.baselineObservation.requestDocumentKey !== observation.requestDocumentKey ||
        main.baselineObservation.observerSessionId !== observation.observerSessionId)) return this.#ignore("early-document-retired");
    const previous = this.#earlyStates.get(envelope.sourceId);
    if (previous !== undefined && (previous.sourceEpoch !== envelope.sourceEpoch ||
      previous.observation.requestFrameKey !== observation.requestFrameKey ||
      previous.observation.requestDocumentKey !== observation.requestDocumentKey ||
      previous.observation.observerSessionId !== observation.observerSessionId ||
      root.t < previous.providerVersion || observation.observerRequestOrdinal <= previous.observation.observerRequestOrdinal)) {
      return this.#ignore("early-response-older");
    }
    const rows = new Map<string, RetainedRow>();
    const priorRows = main?.rows === null || main?.rows === undefined ? previous?.rows ?? new Map()
      : this.#combinedRows(envelope.sourceId, main);
    for (const candidate of root.today) {
      if (isKnownMetadataRow(candidate)) continue;
      if (!isFullRow(candidate) || decodeRecord(candidate) === null) return this.#ignore("early-row-invalid");
      const eventId = providerId(candidate[0])!;
      if (rows.has(eventId) && JSON.stringify(rows.get(eventId)!.row) !== JSON.stringify(candidate)) {
        return this.#ignore("early-owner-conflict");
      }
      rows.set(eventId, retainAfterCutoff(candidate, priorRows.get(eventId), envelope));
    }
    this.#earlyStates.set(envelope.sourceId, { rows, providerVersion: root.t,
      sourceEpoch: envelope.sourceEpoch, observation: { ...observation, providerVersion: root.t } });
    if (main?.rows === null || main?.rows === undefined || main.generation === null || main.gap) {
      return this.#ignore("early-held-until-main-baseline");
    }
    const removed = [...previous?.rows.keys() ?? []].filter(id => !rows.has(id) && !main.rows!.has(id));
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
      value: this.#materialize(envelope.sourceId, main, envelope.observedAtMs), evidenceMode: "DELTA",
      generation: main.generation, provenance: "AUTHENTICATED_HTTP", providerTimestampMs: null,
      ...(removed.length === 0 ? {} : { authoritativeRemovedEventIds: removed }) }];
  }

  #materialize(sourceId: string, main: SourceState, observedAtMs: number): ObservedProviderCatalog {
    const rows = this.#combinedRows(sourceId, main);
    const admissions = this.#ownerAdmissions.get(sourceId) ?? new Map();
    for (const id of admissions.keys()) if (!rows.has(id)) admissions.delete(id);
    for (const [id, retained] of rows) {
      const identity = ownerIdentity(retained.row);
      if (admissions.get(id)?.identity !== identity) admissions.set(id, { identity, sequence: retained.sequence });
    }
    this.#ownerAdmissions.set(sourceId, admissions);
    const parts: NormalizedCatalogPart[] = [];
    for (const [groupId, more] of this.#moreStates.get(sourceId) ?? []) {
      const retained = rows.get(more.native.eventId);
      if (retained === undefined ||
        ownerIdentity(retained.row) !== more.ownerIdentity || more.sourceEpoch !== main.sourceEpoch ||
        more.observation.requestFrameKey !== main.baselineObservation?.requestFrameKey ||
        more.observation.requestDocumentKey !== main.baselineObservation?.requestDocumentKey ||
        more.observation.observerSessionId !== main.baselineObservation?.observerSessionId) {
        this.#moreStates.get(sourceId)!.delete(groupId); continue;
      }
      parts.push(more.normalized);
    }
    return materialize(rows, observedAtMs, parts, this.#normalizedRows);
  }

  #decodeMore(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    const main = this.#states.get(envelope.sourceId);
    const observation = boundBaselineObservation(envelope);
    const cutoff = envelope.request.reconcileCutoffSequence;
    const native = parseCmdNativeMore(envelope.payload.body);
    if (main?.rows === undefined || main.rows === null || main.generation === null || main.gap ||
      observation === null || native === null || envelope.request.requestFrameKey === undefined ||
      cutoff === undefined || cutoff >= envelope.sequence || native.groupId !== envelope.request.providerGroupId?.toLowerCase() ||
      main.baselineObservation?.requestFrameKey !== observation.requestFrameKey ||
      main.sourceEpoch !== envelope.sourceEpoch || main.baselineObservation?.requestDocumentKey !== observation.requestDocumentKey ||
      main.baselineObservation?.observerSessionId !== observation.observerSessionId) return this.#ignore("more-scope-unproven");
    const retained = this.#combinedRows(envelope.sourceId, main).get(native.eventId);
    const owner = retained === undefined ? null : decodeRecord(retained.row);
    const admission = this.#ownerAdmissions.get(envelope.sourceId)?.get(native.eventId);
    if (retained === undefined || owner === null || owner.timeText === "LIVE" ||
      typeof retained.row[34] !== "string" || retained.row[34].toLowerCase() !== native.groupId ||
      admission === undefined || cutoff < admission.sequence || admission.identity !== ownerIdentity(retained.row)) {
      return this.#ignore("more-owner-not-current");
    }
    const groups = this.#moreStates.get(envelope.sourceId) ?? new Map<string, MoreState>();
    const previous = groups.get(native.groupId);
    if (previous !== undefined && (observation.observerRequestOrdinal <= previous.observation.observerRequestOrdinal ||
      envelope.sequence <= previous.receipt.sequence)) return this.#ignore("more-response-older");
    const receipt = { observedAtMs: envelope.observedAtMs, receivedMonotonicMs: envelope.receivedMonotonicMs,
      sequence: envelope.sequence };
    groups.set(native.groupId, { native, ownerIdentity: ownerIdentity(retained.row),
      observation: { ...observation, providerVersion: 0 }, sourceEpoch: envelope.sourceEpoch,
      receipt, normalized: normalizeCmdNativeMore(native, owner, receipt) });
    this.#moreStates.set(envelope.sourceId, groups);
    // Retain every native receipt immediately, but avoid serializing the entire
    // catalog for every small More response. An incoming receipt at the next
    // boundary or an ordinary main/Early update flushes all retained groups.
    const publishedAt = this.#morePublicationAtMs.get(envelope.sourceId);
    if (publishedAt !== undefined && envelope.observedAtMs < publishedAt + MORE_PUBLICATION_INTERVAL_MS) {
      return this.#ignore("more-retained-for-next-publication");
    }
    this.#morePublicationAtMs.set(envelope.sourceId, envelope.observedAtMs);
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
      value: this.#materialize(envelope.sourceId, main, envelope.observedAtMs), evidenceMode: "DELTA",
      generation: main.generation, provenance: "AUTHENTICATED_HTTP", providerTimestampMs: null }];
  }

  #combinedRows(sourceId: string, main: SourceState): Map<string, RetainedRow> {
    const rows = new Map(main.rows!);
    const early = this.#earlyStates.get(sourceId);
    if (early !== undefined && early.sourceEpoch === main.sourceEpoch &&
      early.observation.requestFrameKey === main.baselineObservation?.requestFrameKey &&
      early.observation.requestDocumentKey === main.baselineObservation?.requestDocumentKey &&
      early.observation.observerSessionId === main.baselineObservation?.observerSessionId) {
      for (const [id, incoming] of early.rows) {
        const current = rows.get(id);
        if (current === undefined) { rows.set(id, incoming); continue; }
        // A native live row wins membership; incompatible same-ID identities
        // cannot be combined. Separate scopes keep each original receipt.
        if (decodeRecord(current.row)?.timeText === "LIVE" ||
          [3, 37, 38, 39, 53, 56].some(index => current.row[index] !== incoming.row[index])) continue;
        if (incoming.observedAtMs > current.observedAtMs) rows.set(id, incoming);
      }
    } else if (early !== undefined) this.#earlyStates.delete(sourceId);
    return rows;
  }
}

function ownerIdentity(row: readonly unknown[]): string {
  return JSON.stringify([0, 3, 25, 34, 37, 38, 39, 53, 56].map(index => row[index]));
}

function retainAfterCutoff(row: readonly unknown[], prior: RetainedRow | undefined,
  envelope: ChromeBridgeEnvelope): RetainedRow {
  const cutoff = envelope.request.reconcileCutoffSequence;
  if (prior !== undefined && cutoff !== undefined && prior.sequence > cutoff &&
    ownerIdentity(prior.row) === ownerIdentity(row)) return prior;
  return { row: [...row], observedAtMs: envelope.observedAtMs,
    receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence };
}

function boundBaselineObservation(envelope: ChromeBridgeEnvelope): {
  readonly requestFrameKey: string | undefined;
  readonly requestDocumentKey: string;
  readonly observerSessionId: string;
  readonly observerRequestOrdinal: number;
} | null {
  const { observerRequestId, requestDocumentKey } = envelope.request;
  if (observerRequestId === undefined || requestDocumentKey === undefined) return null;
  const identity = /^([a-z0-9._:-]+):request:(0|[1-9]\d*)$/iu.exec(observerRequestId);
  if (identity === null) return null;
  const observerSessionId = identity[1];
  const ordinalText = identity[2];
  if (observerSessionId === undefined || ordinalText === undefined) return null;
  const observerRequestOrdinal = Number(ordinalText);
  return Number.isSafeInteger(observerRequestOrdinal)
    ? { requestFrameKey: envelope.request.requestFrameKey, requestDocumentKey, observerSessionId, observerRequestOrdinal }
    : null;
}

function parseRoot(body: string): CmdRoot | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!isRecord(value)) return null;
    const cursor = providerCursor(value.t);
    if (cursor === null ||
      typeof value.a !== "boolean" ||
      (value.data !== undefined && (!Array.isArray(value.data) || !value.data.every(Array.isArray)))) return null;
    const keys = Object.keys(value);
    const allowed = new Set(["t", "a", "data", "today", "f"]);
    if (keys.some((key) => !allowed.has(key)) ||
      ((value.today === undefined) !== (value.f === undefined))) return null;
    if (value.today !== undefined && (!Array.isArray(value.today) || !value.today.every(Array.isArray))) return null;
    if (value.data === undefined && value.today === undefined) return null;
    return { t: cursor, a: value.a, data: (value.data ?? []) as unknown[][], dataPresent: value.data !== undefined,
      ...(value.today === undefined ? {} : { today: value.today as unknown[][], f: value.f }) };
  } catch { return null; }
}

function providerCursor(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 && String(cursor) === value ? cursor : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFullRow(value: readonly unknown[]): value is unknown[] { return value.length === FULL_ROW_LENGTH; }

function isKnownMetadataRow(value: readonly unknown[]): boolean {
  if (value.length < MIN_METADATA_ROW_LENGTH || value.length > MAX_METADATA_ROW_LENGTH ||
    value.length % 2 !== 0) return false;
  for (let index = 0; index < value.length; index += 2) {
    if (typeof value[index] !== "number" || !Number.isSafeInteger(value[index]) ||
      (value[index] as number) <= 0 || publicText(value[index + 1], 256) === null) return false;
  }
  return true;
}

function retainPendingDeltaData(data: readonly unknown[][]): readonly unknown[][] | null {
  if (data.length > MAX_PRE_BASELINE_OPERATIONS) return null;
  const retained: unknown[][] = [];
  for (const delta of data) {
    if (delta.length < 4 || delta[1] !== 1 || typeof delta[2] !== "number") return null;
    const eventId = providerId(delta[0]);
    const command = deltaCommands.get(delta[2]);
    if (eventId === null) return null;
    // An operation this source cannot characterize is held back on its own;
    // dropping the batch around it loses the ones it can.
    if (command === undefined) continue;
    if (command.kind === "LINE") {
      if (finiteLine(delta[3]) === null && !closedMarketValue(delta[3])) return null;
      retained.push([eventId, 1, delta[2], delta[3]]);
    } else {
      const usable = (value: unknown): boolean => finiteOdd(value) !== null || closedMarketValue(value);
      if (delta.length < 5 || !usable(delta[3]) || !usable(delta[4])) return null;
      retained.push([eventId, 1, delta[2], delta[3], delta[4]]);
    }
  }
  return retained;
}

function reconciliationRequired(envelope: ChromeBridgeEnvelope): DecodedCatalogUpdate {
  return { sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
    invalidateAccountId: ACCOUNT_ID, reason: "PROVIDER_STREAM_GAP" };
}

function providerId(value: unknown): string | null {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^\d+$/u.test(value)) ? String(value) : null;
}

function publicText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 0 && text.length <= max ? text : null;
}

/**
 * The value a row carries where a market is not on offer.
 *
 * A book closes a market the moment it repositions - every goal, every card -
 * and says so with this. finiteOdd refuses it, being a reader of prices, and
 * the delta carrying it was read as a schema fault: the whole response was
 * discarded, so every other fixture's price in it stayed at what it had been.
 *
 * Measured 2026-08-29 through the ticket's own recheck: CMD showed 0.84 where
 * its page had moved to 0.78, and SABA a price stamped at sequence 9 against a
 * catalog then past 700. A price that a book has left behind, shown as current,
 * is what an impossible edge is made of.
 *
 * Written through rather than skipped, because a market being gone is the fact
 * of the moment: decodeRecord drops a market whose odds read this way, so the
 * fixture loses that line instead of keeping the price it last had.
 */
function closedMarketValue(value: unknown): boolean {
  return value === -999 || value === "-999";
}

function finiteOdd(value: unknown): string | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 && Math.abs(number) <= 1 ? String(number) : null;
}

function finiteLine(value: unknown): string | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const parts = String(value).split("/").map(Number);
  if (parts.length > 2 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 100)) return null;
  return String(parts.reduce((sum, part) => sum + part, 0) / parts.length);
}

function decodeRecord(row: readonly unknown[]): CmdCatalogInputRecord | null {
  const eventId = providerId(row[0]);
  const leagueId = providerId(row[3]);
  const leagueName = publicText(row[37], 160);
  const home = publicText(row[38], 160);
  const away = publicText(row[39], 160);
  const clock = publicText(row[53], 32);
  const date = publicText(row[56], 16);
  if (eventId === null || leagueId === null || leagueName === null || home === null || away === null ||
    clock === null || date === null) return null;
  const suspended = row[79] === 1 || row[79] === true;
  const groups: CmdCatalogInputRecord["groups"][number][] = [];
  for (const betType of [1, 3, 7, 8] as const) {
    const positions = marketPositions[betType];
    const line = finiteLine(row[positions.line]);
    const first = finiteOdd(row[positions.home]);
    const second = finiteOdd(row[positions.away]);
    if (line === null || first === null || second === null) continue;
    const marketId = `${eventId}:${betType}`;
    const handicap = betType === 1 || betType === 7;
    // Each half names its own team. Reading row 24 for both published the
    // first-half line as the mirror of the one the book was offering wherever
    // the halves disagreed, which is 4 of the 732 rows captured on 2026-08-28 -
    // and each mirrored side, priced against another book, reads as a large
    // edge with both legs backing the same outcome. Row 64 called the
    // first-half side correctly in all 44 rows where a fixture's own ladder
    // could settle it, row 24 in 40; for the full-time market row 24 leads,
    // 87 against 74.
    const owner = betType === 7 ? row[64] : row[24];
    const lineOwner = owner === 1 || owner === true ? 0 : 1;
    groups.push({ betTypeIds: [String(betType)], labels: [line], odds: [first, second].map((price, index) => ({
      marketOddsId: marketId, priceText: price, status: null, greyedOut: suspended ? "true" : null,
      ...(handicap && index === lineOwner ? { lineText: String(row[positions.line]) } : {})
    })) });
  }
  const live = row[25] === 1 || row[25] === true || /(?:^|\s)\dH(?:\s|\d|$)|LIVE/iu.test(clock);
  return { sportId: "1", leagueId, leagueName, matchId: eventId,
    timeText: live ? "LIVE" : `${date} ${clock}`, teamNames: [home, away], groups };
}

function applyDelta(rows: Map<string, RetainedRow>, delta: readonly unknown[],
  envelope: DeltaObservation): "APPLIED" | "IGNORED" | "INVALID" {
  if (delta.length < 4 || delta[1] !== 1 || typeof delta[2] !== "number") return "INVALID";
  const eventId = providerId(delta[0]);
  const command = deltaCommands.get(delta[2]);
  if (eventId === null) return "INVALID";
  // Unknown commands are ordered authenticated evidence, but they are not a
  // schema error and must not prevent characterized siblings from applying.
  if (command === undefined) return "IGNORED";
  // A response carries the whole page, and the page holds fixtures this source
  // never retained. One of those is not a schema error either, and treating it
  // as one discarded every price beside it in the same response.
  const retained = rows.get(eventId);
  if (retained === undefined) return "IGNORED";
  const next = [...retained.row];
  const positions = marketPositions[command.betType];
  if (command.kind === "LINE") {
    if (finiteLine(delta[3]) === null && !closedMarketValue(delta[3])) return "INVALID";
    next[positions.line] = delta[3];
  } else {
    if (delta.length < 5) return "INVALID";
    const [home, away] = [delta[3], delta[4]];
    const usable = (value: unknown): boolean => finiteOdd(value) !== null || closedMarketValue(value);
    if (!usable(home) || !usable(away)) return "INVALID";
    next[positions.home] = home;
    next[positions.away] = away;
  }
  rows.set(eventId, { row: next, observedAtMs: envelope.observedAtMs,
    receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
  return "APPLIED";
}

/**
 * Handicaps whose side the feed cannot justify.
 *
 * A row carries the handicap as a magnitude - 0.25, never -0.25 - and row 24 is
 * the only thing that says which team lays it, shared by the full-time market
 * and the first-half one alike. Where a fixture's halves sit on opposite sides
 * that single flag cannot be right for both, and the half it gets wrong is
 * published as the mirror of the line the book is really offering.
 *
 * Measured 2026-08-28: CMD priced Atlante v Club Leon's first half at 1.54/2.52
 * while SBOBET and IM both had 2.54/1.51 and 2.47/1.56 at that line, and CMD's
 * own full-time market agreed with them. Paired against another book the
 * mirrored side reads as a 16.46% edge - both legs backing the same outcome -
 * and a mistake shaped like that goes straight to the top of a table ranked by
 * return.
 *
 * A book never offers one line twice at two prices, so a fixture holding two
 * markets of one kind at one line is proof that a side was assigned wrongly. It
 * does not say which, so neither is published. This does not catch a fixture
 * whose only market of its kind is the mirrored one; that needs evidence from
 * the row itself, which the live payloads observed so far do not distinguish.
 */
function withJustifiedHandicaps(catalog: ObservedProviderCatalog): ObservedProviderCatalog {
  const pricesByMarket = new Map<string, string[]>();
  for (const quote of catalog.quotes) {
    (pricesByMarket.get(quote.providerMarketId) ??
      pricesByMarket.set(quote.providerMarketId, []).get(quote.providerMarketId)!)
      .push(`${quote.selection}=${quote.rawOdds}`);
  }
  const byLine = new Map<string, { id: string; prices: string }[]>();
  for (const market of catalog.markets) {
    if (!market.marketType.endsWith("_AH")) continue;
    const key = `${market.providerEventId}\u0000${market.marketType}\u0000${market.line ?? ""}`;
    (byLine.get(key) ?? byLine.set(key, []).get(key)!).push({ id: market.providerMarketId,
      prices: [...(pricesByMarket.get(market.providerMarketId) ?? [])].sort().join(" ") });
  }
  const contradicted = new Set<string>();
  for (const entries of byLine.values()) {
    // A fixture listing one line twice at the same prices is repeating itself,
    // which says nothing about which team lays it; two prices for one line do.
    if (new Set(entries.map((entry) => entry.prices)).size < 2) continue;
    for (const entry of entries) contradicted.add(entry.id);
  }
  if (contradicted.size === 0) return catalog;
  return { ...catalog,
    markets: catalog.markets.filter((market) => !contradicted.has(market.providerMarketId)),
    quotes: catalog.quotes.filter((quote) => !contradicted.has(quote.providerMarketId)) };
}

function materialize(rows: Map<string, RetainedRow>, observedAtMs: number, moreParts: readonly NormalizedCatalogPart[],
  cache: WeakMap<RetainedRow, NormalizedCatalogPart>) {
  const parts: NormalizedCatalogPart[] = [];
  for (const retained of rows.values()) {
    const cached = cache.get(retained);
    if (cached !== undefined) { parts.push(cached); continue; }
    const record = decodeRecord(retained.row);
    if (record === null) continue;
    const options = {
      observedAtMs: retained.observedAtMs, receivedMonotonicMs: retained.receivedMonotonicMs,
      timezoneOffsetMinutes: 480, sequence: retained.sequence
    };
    const part = { ...normalizeObservedFootballCatalog("CMD", [record], options),
      nativeMarketObservations: observeNativeCmdMarkets("CMD", [{ ...record,
        groups: nativeMainGroups(retained.row, record) }], options) };
    cache.set(retained, part);
    parts.push(part);
  }
  return withJustifiedHandicaps(mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "CMD",
    observedAtMs, parts: [...parts, ...moreParts], collapseDuplicateEvents: true }));
}

/** Public DataFormat positions name these markets even when their prices are
 * closed or their outcome domain has no mapping. Do not silently omit them
 * merely because decodeRecord can produce only the four line markets. */
function nativeMainGroups(row: readonly unknown[], record: CmdCatalogInputRecord): CmdCatalogInputRecord["groups"] {
  const groups: CmdCatalogInputRecord["groups"][number][] = [];
  const text = (value: unknown): string => typeof value === "number" || typeof value === "string" ? String(value) : "";
  for (const betType of [1, 3, 7, 8] as const) {
    const position = marketPositions[betType];
    if ([position.line, position.home, position.away].every(index => row[index] === null || row[index] === undefined)) continue;
    const decoded = record.groups.find(group => group.betTypeIds[0] === String(betType));
    groups.push(decoded ?? { betTypeIds: [String(betType)], labels: [text(row[position.line])],
      odds: [position.home, position.away].map(index => ({ marketOddsId: `${record.matchId}:${betType}`,
        priceText: text(row[index]), status: null, greyedOut: null })) });
  }
  for (const [nativeType, positions, labels] of [
    ["5", [17, 19, 18], ["HOME", "DRAW", "AWAY"]],
    ["FH:5", [20, 22, 21], ["HOME", "DRAW", "AWAY"]],
    ["MAIN:2", [48, 49], ["ODD", "EVEN"]],
    ["FH:2", [65, 66], ["ODD", "EVEN"]],
    ["DOUBLE_CHANCE", [84, 85, 86], ["1X", "12", "X2"]]
  ] as const) {
    if (positions.every(index => row[index] === null || row[index] === undefined)) continue;
    groups.push({ betTypeIds: [nativeType], labels, odds: positions.map(index => ({
      marketOddsId: `${record.matchId}:native:${nativeType}`, priceText: text(row[index]), status: null, greyedOut: null })) });
  }
  return groups;
}
