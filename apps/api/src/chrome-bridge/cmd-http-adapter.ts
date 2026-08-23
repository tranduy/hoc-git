import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts, type NormalizedCatalogPart } from "./catalog-part-merge.js";

const ACCOUNT_ID = "catalog-source:CMD:FOOTBALL";
const HOST = "cgnew.fts368.com";
const PATH = "/Member/BetsView/BetLight/DataOdds.ashx";
const FULL_ROW_LENGTH = 91;

interface CmdRoot {
  readonly t: number;
  readonly a: boolean;
  readonly data: readonly unknown[][];
  readonly today?: readonly unknown[][];
  readonly f?: unknown;
}

interface RetainedRow {
  readonly row: unknown[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
  readonly sequence: number;
}

interface SourceState {
  rows: Map<string, RetainedRow> | null;
  generation: string | null;
  providerVersion: number | null;
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
  readonly #parsedBodies = new WeakMap<ChromeBridgeEnvelope, CmdRoot | null>();

  resetSource(sourceId: string): void { this.#states.delete(sourceId); }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    if (envelope.lobby !== "CMD" || envelope.transport !== "HTTP_RESPONSE" ||
      envelope.request.hostname !== HOST || envelope.request.pathnameClass !== PATH ||
      envelope.payload.encoding !== "UTF8") return false;
    const root = parseRoot(envelope.payload.body);
    this.#parsedBodies.set(envelope, root);
    return root !== null;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const root = this.#parsedBodies.get(envelope) ?? parseRoot(envelope.payload.body);
    if (root === null) return [];
    const state = this.#states.get(envelope.sourceId) ?? { rows: null, generation: null,
      providerVersion: null };
    if (!root.a) {
      state.rows = null;
      state.generation = null;
      state.providerVersion = null;
      this.#states.set(envelope.sourceId, state);
      return [{ sourceId: envelope.sourceId, sequence: envelope.sequence,
        observedAtMs: envelope.observedAtMs, invalidateAccountId: ACCOUNT_ID,
        reason: "PROVIDER_STREAM_GAP" }];
    }
    if (state.providerVersion !== null && root.t < state.providerVersion) return [];

    const isAtomicFull = root.today !== undefined && root.f !== undefined;
    let evidenceMode: "BASELINE" | "DELTA";
    if (isAtomicFull) {
      const fullRows = [...root.data, ...root.today!].filter(isFullRow);
      if (fullRows.length === 0) return [];
      const rows = new Map<string, RetainedRow>();
      for (const candidate of fullRows) {
        const eventId = providerId(candidate[0]);
        if (eventId === null || decodeRecord(candidate) === null) continue;
        rows.set(eventId, { row: [...candidate], observedAtMs: envelope.observedAtMs,
          receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
      }
      if (rows.size === 0) return [];
      state.rows = rows;
      state.generation = `cmd:${root.t}`;
      state.providerVersion = root.t;
      evidenceMode = "BASELINE";
    } else {
      if (root.today !== undefined || root.f !== undefined || state.rows === null || state.generation === null) return [];
      let changed = false;
      for (const delta of root.data) changed = applyDelta(state.rows, delta, envelope) || changed;
      state.providerVersion = root.t;
      this.#states.set(envelope.sourceId, state);
      // Unknown provider commands are deliberately not decoded, but their
      // verified cursor still closes the ordering window against late frames.
      if (!changed) return [];
      evidenceMode = "DELTA";
    }
    this.#states.set(envelope.sourceId, state);
    const catalog = materialize(state.rows!, envelope.observedAtMs);
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
      value: catalog, ...(evidenceMode === "BASELINE" ? { authoritativeBaseline: true } : {}),
      evidenceMode, generation: state.generation!, provenance: "AUTHENTICATED_HTTP",
      // `t` is CMD's ordering cursor/version, not a Unix timestamp.
      providerTimestampMs: null }];
  }
}

function parseRoot(body: string): CmdRoot | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!isRecord(value) || typeof value.t !== "number" || !Number.isSafeInteger(value.t) || value.t < 0 ||
      typeof value.a !== "boolean" ||
      !Array.isArray(value.data) || !value.data.every(Array.isArray)) return null;
    const keys = Object.keys(value);
    const allowed = new Set(["t", "a", "data", "today", "f"]);
    if (keys.some((key) => !allowed.has(key)) ||
      ((value.today === undefined) !== (value.f === undefined))) return null;
    if (value.today !== undefined && (!Array.isArray(value.today) || !value.today.every(Array.isArray))) return null;
    return value as unknown as CmdRoot;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFullRow(value: readonly unknown[]): value is unknown[] { return value.length === FULL_ROW_LENGTH; }

function providerId(value: unknown): string | null {
  return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === "string" && /^\d+$/u.test(value)) ? String(value) : null;
}

function publicText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 0 && text.length <= max ? text : null;
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
    const lineOwner = row[24] === 1 || row[24] === true ? 0 : 1;
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
  envelope: ChromeBridgeEnvelope): boolean {
  if (delta.length < 4 || delta[1] !== 1 || typeof delta[2] !== "number") return false;
  const eventId = providerId(delta[0]);
  const command = deltaCommands.get(delta[2]);
  if (eventId === null || command === undefined) return false;
  const retained = rows.get(eventId);
  if (retained === undefined) return false;
  const next = [...retained.row];
  const positions = marketPositions[command.betType];
  if (command.kind === "LINE") {
    if (finiteLine(delta[3]) === null) return false;
    next[positions.line] = delta[3];
  } else {
    if (delta.length < 5 || finiteOdd(delta[3]) === null || finiteOdd(delta[4]) === null) return false;
    next[positions.home] = delta[3];
    next[positions.away] = delta[4];
  }
  rows.set(eventId, { row: next, observedAtMs: envelope.observedAtMs,
    receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
  return true;
}

function materialize(rows: Map<string, RetainedRow>, observedAtMs: number) {
  const parts: NormalizedCatalogPart[] = [];
  for (const retained of rows.values()) {
    const record = decodeRecord(retained.row);
    if (record === null) continue;
    parts.push(normalizeObservedFootballCatalog("CMD", [record], {
      observedAtMs: retained.observedAtMs, receivedMonotonicMs: retained.receivedMonotonicMs,
      timezoneOffsetMinutes: 480, sequence: retained.sequence
    }));
  }
  return mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "CMD", observedAtMs, parts });
}
