import { normalizeSbobetCatalog, type SbobetCatalogInputRecord,
  type SbobetCatalogMarket } from "@tool-chenh/adapters";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts } from "./catalog-part-merge.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";
const ignoredEvent = /\((?:PG|V|PEN)\)|\bvirtual\b|corner|booking|phạt góc|thẻ|\bcyber\b/iu;
const supportedBetTypes = new Map<number, SbobetCatalogMarket["marketType"]>([
  [1, "FT_AH"], [3, "FT_TOTAL"], [7, "FH_AH"], [8, "FH_TOTAL"]
]);

type RawRow = Record<string, unknown>;

interface SourceState {
  readonly streamId: string;
  readonly channelTypes: Map<string, string>;
  readonly schemas: Map<string, Map<number, string>>;
  readonly revisions: Map<string, number>;
  readonly events: Map<string, RawRow>;
  readonly odds: Map<string, RawRow>;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signed(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function socketEvent(body: string): readonly unknown[] | null {
  if (!body.startsWith("42")) return null;
  try {
    const parsed = JSON.parse(body.slice(2)) as unknown;
    return Array.isArray(parsed) && parsed[0] === "m" ? parsed : null;
  } catch { return null; }
}

function rowObject(row: readonly unknown[], schema: ReadonlyMap<number, string>): RawRow {
  const output: RawRow = {};
  for (let index = 2; index + 1 < row.length; index += 2) {
    const field = schema.get(Number(row[index]));
    if (field !== undefined) output[field] = row[index + 1];
  }
  return output;
}

function eventRecord(event: RawRow, markets: readonly SbobetCatalogMarket[], observedAtMs: number): SbobetCatalogInputRecord | null {
  const eventId = text(event.matchid);
  const home = text(event.hteamnamevn) || text(event.hteamnameen);
  const away = text(event.ateamnamevn) || text(event.ateamnameen);
  if (!eventId || !home || !away || home === away || ignoredEvent.test(`${home} ${away}`) ||
    (event.sporttype !== undefined && Number(event.sporttype) !== 1) ||
    (event.parentid !== undefined && Number(event.parentid) > 0) ||
    (event.subtype !== undefined && Number(event.subtype) > 0) ||
    (event.childmatchtype !== undefined && Number(event.childmatchtype) > 0)) return null;
  const livePeriod = finite(event.liveperiod) ?? 0;
  const kickoff = finite(event.kickofftime);
  const startAtUtcMs = kickoff === null ? null : kickoff > 10_000_000_000 ? kickoff : kickoff * 1_000;
  const homeScore = finite(event.livehomescore);
  const awayScore = finite(event.liveawayscore);
  return {
    eventId,
    leagueName: text(event.leaguenamevn) || text(event.leaguenameen) || text(event.leagueid) || "SBOBET Football",
    timeText: livePeriod > 0 ? "LIVE" : "PREMATCH",
    scoreText: homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : null,
    startAtUtcMs: startAtUtcMs ?? (livePeriod > 0 ? observedAtMs : null),
    teamNames: [home, away], markets
  };
}

function marketRecord(odd: RawRow): SbobetCatalogMarket | null {
  const oddsId = text(odd.oddsid);
  const eventId = text(odd.matchid);
  const betType = finite(odd.bettype);
  const marketType = betType === null ? undefined : supportedBetTypes.get(betType);
  if (!oddsId || !eventId || marketType === undefined) return null;
  const hdp1 = finite(odd.hdp1) ?? 0;
  const hdp2 = finite(odd.hdp2) ?? 0;
  const isHandicap = marketType.endsWith("_AH");
  const providerLine = isHandicap ? hdp1 - hdp2 : hdp1 || hdp2;
  if (!Number.isFinite(providerLine)) return null;
  const homePrice = text(odd.odds1a);
  const awayPrice = text(odd.odds2a);
  if (!homePrice || !awayPrice) return null;
  const locked = text(odd.oddsstatus).toLocaleLowerCase("en") !== "running";
  const firstSelection = isHandicap ? "HOME" as const : "OVER" as const;
  const secondSelection = isHandicap ? "AWAY" as const : "UNDER" as const;
  const homeLine = isHandicap ? -providerLine : providerLine;
  return {
    marketId: oddsId, marketType,
    lineText: String(isHandicap ? Math.abs(providerLine) : providerLine),
    selections: [
      { selectionId: `${oddsId}:${firstSelection}`, selection: firstSelection, priceText: homePrice,
        locked, lineText: isHandicap ? signed(homeLine) : String(providerLine) },
      { selectionId: `${oddsId}:${secondSelection}`, selection: secondSelection, priceText: awayPrice,
        locked, lineText: isHandicap ? signed(-homeLine) : String(providerLine) }
    ]
  };
}

export class SbobetSocketIoCatalogAdapter implements ChromeTrafficAdapter {
  readonly id: string;
  readonly providerFamily = "SBOBET";
  readonly #states = new Map<string, SourceState>();

  constructor(readonly lobby: "KSPORT" | "SBO") {
    this.id = `sbobet-socketio-catalog-v1:${lobby}`;
  }

  resetSource(sourceId: string): void { this.#states.delete(sourceId); }

  fingerprint(envelope: ChromeBridgeEnvelope): boolean {
    return envelope.lobby === this.lobby && envelope.transport === "WS_FRAME" &&
      envelope.payload.encoding === "UTF8" && envelope.request.pathnameClass === "/socket.io/" &&
      socketEvent(envelope.payload.body) !== null;
  }

  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[] {
    if (!this.fingerprint(envelope)) return [];
    const message = socketEvent(envelope.payload.body);
    if (message === null || typeof message[1] !== "string" || !Array.isArray(message[2])) return [];
    const streamId = envelope.request.streamId ?? "legacy";
    let state = this.#states.get(envelope.sourceId);
    if (state === undefined || state.streamId !== streamId) {
      state = { streamId, channelTypes: new Map(), schemas: new Map(), revisions: new Map(),
        events: new Map(), odds: new Map() };
      this.#states.set(envelope.sourceId, state);
    }
    const runtimeChannel = message[1];
    const revision = finite(message[3]);
    const priorRevision = state.revisions.get(runtimeChannel);
    if (revision !== null && priorRevision !== undefined && revision <= priorRevision) return [];
    if (revision !== null) state.revisions.set(runtimeChannel, revision);
    let changed = false;
    for (const candidate of message[2]) {
      if (!Array.isArray(candidate)) continue;
      if (candidate[0] === "c" && typeof candidate[1] === "string") {
        state.channelTypes.set(runtimeChannel, candidate[1]);
        continue;
      }
      const schemaChannel = state.channelTypes.get(runtimeChannel) ?? runtimeChannel;
      if (candidate[0] === "f" && Number.isSafeInteger(candidate[1]) && Array.isArray(candidate[2])) {
        const schema = state.schemas.get(schemaChannel) ?? new Map<number, string>();
        candidate[2].forEach((name, index) => { if (typeof name === "string") schema.set(Number(candidate[1]) + index, name); });
        state.schemas.set(schemaChannel, schema);
        continue;
      }
      if (candidate[0] !== 0 || typeof candidate[1] !== "string") continue;
      const schema = state.schemas.get(schemaChannel);
      if (schema === undefined) continue;
      const incoming = rowObject(candidate, schema);
      if (candidate[1] === "m") {
        const id = text(incoming.matchid);
        if (id) { state.events.set(id, { ...state.events.get(id), ...incoming }); changed = true; }
      } else if (candidate[1] === "o") {
        const id = text(incoming.oddsid);
        if (id) { state.odds.set(id, { ...state.odds.get(id), ...incoming }); changed = true; }
      } else if (candidate[1] === "-m") {
        const id = text(incoming.matchid);
        if (id) { state.events.delete(id); changed = true; }
      } else if (candidate[1] === "-o") {
        const id = text(incoming.oddsid);
        if (id) { state.odds.delete(id); changed = true; }
      }
    }
    if (!changed) return [];
    const marketsByEvent = new Map<string, SbobetCatalogMarket[]>();
    for (const odd of state.odds.values()) {
      const market = marketRecord(odd);
      const eventId = text(odd.matchid);
      if (market === null || !eventId) continue;
      const markets = marketsByEvent.get(eventId) ?? [];
      markets.push(market);
      marketsByEvent.set(eventId, markets);
    }
    const records: SbobetCatalogInputRecord[] = [];
    for (const [eventId, event] of state.events) {
      const record = eventRecord(event, marketsByEvent.get(eventId) ?? [], envelope.observedAtMs);
      if (record !== null && record.markets.length > 0) records.push(record);
    }
    const part = normalizeSbobetCatalog(records, { observedAtMs: envelope.observedAtMs,
      receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence, provider: "SBOBET",
      settlementProfile: "football-regulation-including-added-time" });
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET",
      observedAtMs: envelope.observedAtMs, parts: [part] });
    if (catalog.events.length === 0 || catalog.markets.length === 0 || catalog.quotes.length === 0) return [];
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
      value: catalog, authoritativeBaseline: true }];
  }
}
