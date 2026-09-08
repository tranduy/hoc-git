import { normalizeSbobetCatalog, type SbobetCatalogInputRecord,
  type SbobetCatalogMarket } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, type ChromeBridgeEnvelope,
  type NativeMarketObservation } from "@tool-chenh/contracts";
import type { ChromeTrafficAdapter, DecodedCatalogUpdate } from "./adapter.js";
import { mergeObservedCatalogParts } from "./catalog-part-merge.js";

const ACCOUNT_ID = "catalog-source:SBOBET:FOOTBALL";
const supportedBetTypes = new Map<number, SbobetCatalogMarket["marketType"]>([
  [1, "FT_AH"], [3, "FT_TOTAL"], [7, "FH_AH"], [8, "FH_TOTAL"]
]);

type RawRow = Record<string, unknown>;
type SbobetFootballFamily = "GOALS" | "CORNERS" | "CARDS";

interface ClassifiedEvent {
  readonly home: string;
  readonly away: string;
  readonly league: string;
  readonly family: SbobetFootballFamily;
}

interface SourceState {
  readonly sourceEpoch: string;
  readonly streamId: string;
  readonly retiredEpochs: Set<string>;
  readonly retiredStreams: Set<string>;
  readonly channelTypes: Map<string, string>;
  readonly schemas: Map<string, Map<number, string>>;
  readonly revisions: Map<string, number>;
  readonly events: Map<string, RawRow>;
  readonly odds: Map<string, RawRow>;
  readonly oddsReceipts: Map<string, Pick<ChromeBridgeEnvelope,
    "observedAtMs" | "receivedMonotonicMs" | "sequence">>;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function finite(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function signed(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function streamOrdinal(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function olderSourceEpoch(candidate: string, current: string): boolean {
  const candidateParts = /^(.+):(0|[1-9]\d*)$/u.exec(candidate);
  const currentParts = /^(.+):(0|[1-9]\d*)$/u.exec(current);
  return candidateParts !== null && currentParts !== null && candidateParts[1] === currentParts[1] &&
    Number(candidateParts[2]) <= Number(currentParts[2]);
}

function changedRow(previous: RawRow | undefined, incoming: RawRow): boolean {
  return previous === undefined || Object.entries(incoming).some(([key, value]) => !Object.is(previous[key], value));
}

function validMalay(value: string): boolean {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0 && Math.abs(numeric) <= 1;
}

function classifyEvent(event: RawRow): ClassifiedEvent | null {
  const eventId = text(event.matchid);
  // Native semantic suffixes are stable in the provider's English fields,
  // while translated display fields can turn "Total Bookings" into text that
  // no longer identifies the card pseudo-event. Prefer the English identity;
  // it also keeps participant and competition matching locale-independent.
  const home = text(event.hteamnameen) || text(event.hteamnamevn);
  const away = text(event.ateamnameen) || text(event.ateamnamevn);
  const league = text(event.leaguenameen) || text(event.leaguenamevn) || text(event.leagueid) || "SBOBET Football";
  if (!eventId || !home || !away || home === away ||
    /\((?:PG|V|PEN)\)|\bvirtual\b|\bcyber\b/iu.test(`${league} ${home} ${away}`) ||
    (event.sporttype !== undefined && Number(event.sporttype) !== 1) ||
    /\((?:ET|PEN)\)\s*$/iu.test(home) || /\((?:ET|PEN)\)\s*$/iu.test(away)) return null;
  const cornerSuffix = /\s*(?:\(\s*)?(?:No\.?\s*of\s+|Total\s+)?Corners?(?:\s*\))?\s*$/iu;
  const cardSuffix = /\s*(?:\(\s*)?(?:No\.?\s*of\s+|Total\s+)?(?:Bookings?|Cards?)(?:\s*\))?\s*$/iu;
  const cornerEvidence = /(?:^|\s*-\s*)CORNERS?\s*$/iu.test(league) ||
    cornerSuffix.test(home) && cornerSuffix.test(away);
  const cardEvidence = /(?:^|\s*-\s*)(?:BOOKINGS?|CARDS?)\s*$/iu.test(league) ||
    cardSuffix.test(home) && cardSuffix.test(away);
  if (cornerEvidence && cardEvidence) return null;
  const family: SbobetFootballFamily = cornerEvidence ? "CORNERS" : cardEvidence ? "CARDS" : "GOALS";
  if (family === "GOALS" && (cornerSuffix.test(home) || cornerSuffix.test(away) ||
    cardSuffix.test(home) || cardSuffix.test(away))) return null;
  const strip = family === "CORNERS" ? cornerSuffix : family === "CARDS" ? cardSuffix : null;
  const normalizedHome = strip === null ? home : home.replace(strip, "").trim();
  const normalizedAway = strip === null ? away : away.replace(strip, "").trim();
  if (!normalizedHome || !normalizedAway || normalizedHome === normalizedAway) return null;
  const derivative = (event.parentid !== undefined && Number(event.parentid) > 0) ||
    (event.subtype !== undefined && Number(event.subtype) > 0) ||
    (event.childmatchtype !== undefined && Number(event.childmatchtype) > 0);
  if (derivative && family === "GOALS") return null;
  return { home: normalizedHome, away: normalizedAway, league, family };
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

function marketRecord(odd: RawRow): SbobetCatalogMarket | null {
  const oddsId = text(odd.oddsid);
  const eventId = text(odd.matchid);
  const betType = finite(odd.bettype);
  const marketType = betType === null ? undefined : supportedBetTypes.get(betType);
  if (!oddsId || !eventId || marketType === undefined) return null;
  const firstLine = finite(odd.hdp1);
  const secondLine = finite(odd.hdp2);
  if (firstLine === null && secondLine === null ||
    odd.hdp1 !== undefined && firstLine === null || odd.hdp2 !== undefined && secondLine === null) return null;
  const hdp1 = firstLine ?? 0;
  const hdp2 = secondLine ?? 0;
  const isHandicap = marketType.endsWith("_AH");
  const providerLine = isHandicap ? hdp1 - hdp2 : hdp1 || hdp2;
  if (!Number.isFinite(providerLine)) return null;
  const homePrice = text(odd.odds1a);
  const awayPrice = text(odd.odds2a);
  if (!validMalay(homePrice) || !validMalay(awayPrice)) return null;
  const locked = text(odd.oddsstatus).toLocaleLowerCase("en") !== "running";
  const firstSelection = isHandicap ? "HOME" as const : "OVER" as const;
  const secondSelection = isHandicap ? "AWAY" as const : "UNDER" as const;
  const homeLine = isHandicap ? -providerLine : providerLine;
  return {
    marketId: oddsId, marketType,
    ...(isHandicap ? { handicapLineFormat: "SIGNED" as const } : {}),
    lineText: String(isHandicap ? Math.abs(providerLine) : providerLine),
    selections: [
      { selectionId: `${oddsId}:${firstSelection}`, selection: firstSelection, priceText: homePrice,
        locked, lineText: isHandicap ? signed(homeLine) : String(providerLine) },
      { selectionId: `${oddsId}:${secondSelection}`, selection: secondSelection, priceText: awayPrice,
        locked, lineText: isHandicap ? signed(-homeLine) : String(providerLine) }
    ]
  };
}

function classifiedEventRecord(event: RawRow, markets: readonly SbobetCatalogMarket[],
  observedAtMs: number): SbobetCatalogInputRecord | null {
  const classified = classifyEvent(event);
  if (classified === null) return null;
  const eventId = text(event.matchid);
  const livePeriod = finite(event.liveperiod) ?? 0;
  const kickoff = finite(event.kickofftime);
  const startAtUtcMs = kickoff === null ? null : kickoff > 10_000_000_000 ? kickoff : kickoff * 1_000;
  const homeScore = finite(event.livehomescore);
  const awayScore = finite(event.liveawayscore);
  return {
    eventId, leagueName: classified.league, timeText: livePeriod > 0 ? "LIVE" : "PREMATCH",
    scoreText: homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : null,
    startAtUtcMs: startAtUtcMs ?? (livePeriod > 0 ? observedAtMs : null),
    teamNames: [classified.home, classified.away], markets
  };
}

function familyMarketType(family: SbobetFootballFamily,
  betType: number): SbobetCatalogMarket["marketType"] | null {
  const base = supportedBetTypes.get(betType);
  if (base === undefined) return null;
  if (family === "GOALS") return base;
  return `${family === "CORNERS" ? "CORNER" : "CARD"}_${base}` as SbobetCatalogMarket["marketType"];
}

function familyMarketRecord(odd: RawRow, family: SbobetFootballFamily): SbobetCatalogMarket | null {
  const base = marketRecord(odd);
  const betType = finite(odd.bettype);
  const marketType = betType === null ? null : familyMarketType(family, betType);
  return base === null || marketType === null ? null : { ...base, marketType };
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
    const revision = finite(message[3]);
    if (revision === null) return [];
    const streamId = envelope.request.streamId ?? "legacy";
    const sourceEpoch = envelope.sourceEpoch ?? "legacy";
    let state = this.#states.get(envelope.sourceId);
    if (state !== undefined && state.sourceEpoch !== sourceEpoch &&
      (state.retiredEpochs.has(sourceEpoch) || olderSourceEpoch(sourceEpoch, state.sourceEpoch))) return [];
    if (state !== undefined && state.sourceEpoch === sourceEpoch && state.streamId !== streamId) {
      const incomingOrdinal = streamOrdinal(streamId);
      const currentOrdinal = streamOrdinal(state.streamId);
      if (state.retiredStreams.has(streamId) || incomingOrdinal !== null && currentOrdinal !== null &&
        incomingOrdinal <= currentOrdinal) return [];
    }
    if (state === undefined || state.sourceEpoch !== sourceEpoch || state.streamId !== streamId) {
      const retiredEpochs = state?.retiredEpochs ?? new Set<string>();
      const retiredStreams = state?.sourceEpoch === sourceEpoch ? state.retiredStreams : new Set<string>();
      if (state !== undefined) {
        if (state.sourceEpoch !== sourceEpoch) retiredEpochs.add(state.sourceEpoch);
        else retiredStreams.add(state.streamId);
      }
      state = { sourceEpoch, streamId, retiredEpochs, retiredStreams,
        channelTypes: new Map(), schemas: new Map(), revisions: new Map(),
        events: new Map(), odds: new Map(), oddsReceipts: new Map() };
      this.#states.set(envelope.sourceId, state);
    }
    const runtimeChannel = message[1];
    const priorRevision = state.revisions.get(runtimeChannel);
    if (priorRevision !== undefined && revision <= priorRevision) return [];
    state.revisions.set(runtimeChannel, revision);
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
        if (id && changedRow(state.events.get(id), incoming)) {
          state.events.set(id, { ...state.events.get(id), ...incoming }); changed = true;
        }
      } else if (candidate[1] === "o") {
        const id = text(incoming.oddsid);
        if (id && changedRow(state.odds.get(id), incoming)) {
          state.odds.set(id, { ...state.odds.get(id), ...incoming });
          state.oddsReceipts.set(id, { observedAtMs: envelope.observedAtMs,
            receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence });
          changed = true;
        }
      } else if (candidate[1] === "-m") {
        const id = text(incoming.matchid);
        if (id) {
          let deleted = state.events.delete(id);
          for (const [oddsId, odd] of state.odds) {
            if (text(odd.matchid) === id && state.odds.delete(oddsId)) {
              state.oddsReceipts.delete(oddsId); deleted = true;
            }
          }
          if (deleted) changed = true;
        }
      } else if (candidate[1] === "-o") {
        const id = text(incoming.oddsid);
        if (id && state.odds.delete(id)) { state.oddsReceipts.delete(id); changed = true; }
      }
    }
    if (!changed) return [];
    const marketsByEvent = new Map<string, SbobetCatalogMarket[]>();
    const nativeMarketObservations: NativeMarketObservation[] = [];
    for (const odd of state.odds.values()) {
      const eventId = text(odd.matchid);
      const event = state.events.get(eventId);
      const classified = event === undefined ? null : classifyEvent(event);
      const market = classified === null ? null : familyMarketRecord(odd, classified.family);
      const oddsId = text(odd.oddsid) || `${eventId || "UNKNOWN_EVENT"}:native:${text(odd.bettype) || "UNKNOWN"}`;
      const betType = finite(odd.bettype);
      const mappedType = classified === null || betType === null ? null : familyMarketType(classified.family, betType);
      const spec = mappedType === null ? null : footballBinaryMarketSpec(mappedType);
      nativeMarketObservations.push({ provider: "SBOBET", category: "FOOTBALL",
        providerEventId: eventId || "UNKNOWN_EVENT", providerMarketId: oddsId,
        nativeType: text(odd.bettype) || "UNKNOWN", nativeLabel: null, nativeScope: spec?.scope ?? null,
        outcomeLabels: spec === null ? ["OUTCOME_1", "OUTCOME_2"] : [...spec.outcomes],
        observedAtMs: state.oddsReceipts.get(oddsId)!.observedAtMs,
        disposition: classified === null || mappedType !== null && market === null ? "EXCLUDED"
          : mappedType === null ? "UNMAPPED" : "NORMALIZED",
        reason: classified === null ? "EVENT_NOT_COMPARABLE"
          : mappedType === null ? "NATIVE_TYPE_UNMAPPED"
          : market === null ? "INVALID_TWO_WAY_SHAPE" : "CANONICAL_MARKET_MAPPED" });
      if (market === null || !eventId) continue;
      const markets = marketsByEvent.get(eventId) ?? [];
      markets.push(market);
      marketsByEvent.set(eventId, markets);
    }
    const records: SbobetCatalogInputRecord[] = [];
    for (const [eventId, event] of state.events) {
      const record = classifiedEventRecord(event, marketsByEvent.get(eventId) ?? [], envelope.observedAtMs);
      if (record !== null) records.push(record);
    }
    const part = normalizeSbobetCatalog(records, { observedAtMs: envelope.observedAtMs,
      receivedMonotonicMs: envelope.receivedMonotonicMs, sequence: envelope.sequence, provider: "SBOBET",
      settlementProfile: "football-regulation-including-added-time" });
    const quotes = part.quotes.map((quote) => {
      const receipt = state.oddsReceipts.get(quote.providerMarketId)!;
      return { ...quote, receivedMonotonicMs: receipt.receivedMonotonicMs, sequence: receipt.sequence };
    });
    const normalizedEvents = new Set(part.events.map((event) => event.providerEventId));
    const normalizedMarkets = new Set(part.markets.map((market) =>
      `${market.providerEventId}|${market.providerMarketId}`));
    const accountedObservations = nativeMarketObservations.map((observation): NativeMarketObservation => {
      if (observation.disposition !== "NORMALIZED" || normalizedMarkets.has(
        `${observation.providerEventId}|${observation.providerMarketId}`)) return observation;
      return { ...observation, disposition: "EXCLUDED",
        reason: normalizedEvents.has(observation.providerEventId)
          ? "CANONICAL_MARKET_REJECTED" : "EVENT_NOT_COMPARABLE" };
    });
    const catalog = mergeObservedCatalogParts({ accountId: ACCOUNT_ID, provider: "SBOBET",
      observedAtMs: envelope.observedAtMs, parts: [{ ...part, quotes, nativeMarketObservations: accountedObservations }] });
    return [{ sourceId: envelope.sourceId, sequence: envelope.sequence, observedAtMs: envelope.observedAtMs,
      value: catalog, authoritativeBaseline: true }];
  }
}
