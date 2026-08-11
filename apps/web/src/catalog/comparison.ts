import type { ProviderEvent, ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";

export interface ComparisonCell {
  readonly provider: ProviderId;
  readonly market: ProviderMarket;
  readonly quotes: readonly ProviderQuote[];
}

export interface ComparisonRow {
  readonly key: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly cells: readonly ComparisonCell[];
  readonly bestBySelection: Readonly<Record<string, ProviderId>>;
  readonly margin: number | null;
  readonly crossBook: boolean;
}

export interface ObservedTicketRow {
  readonly key: string;
  readonly marketType: string;
  readonly scope: string;
  readonly line: string | null;
  readonly settlementProfile: string;
  readonly outcomeDomain: readonly string[];
  readonly cells: readonly ComparisonCell[];
}

export interface ComparisonEvent {
  readonly key: string;
  readonly event: ProviderEvent;
  readonly providers: readonly ProviderId[];
  readonly catalogs: readonly LiveCatalogResponse[];
  readonly providerEventIds: Readonly<Partial<Record<ProviderId, string>>>;
  readonly observedRows: readonly ObservedTicketRow[];
  readonly rows: readonly ComparisonRow[];
  readonly bestMargin: number | null;
}

type EventOrientation = "SAME" | "SWAPPED";

const footballTeamAliases = new Map<string, string>([
  ["st gilloise", "union saint gilloise"],
  ["union st gilloise", "union saint gilloise"],
  ["sabah", "sabah baku"],
  ["al hussein jor", "al hussein irbid"],
  ["maccabi kiryat gat", "kiryat gat"]
]);

function identityText(value: string): string {
  const normalized = value.normalize("NFKD").replace(/\p{M}+/gu, "").toLocaleLowerCase("en")
    .replace(/đ/gu, "d").replace(/\s*\((?:n|neutral)\)\s*$/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/^(?:(?:clb|fc|sc|scu|afc|cf|jk|fa)\s+)+/u, "")
    .replace(/\s+(?:fc|sc|scu|afc|cf)$/u, "")
    .replace(/\butd\b/gu, "united").replace(/\bii\b/gu, "2").replace(/\s+/gu, " ");
  return footballTeamAliases.get(normalized) ?? normalized;
}

function unorderedParticipantKey(event: ProviderEvent): string {
  return [identityText(event.participantA), identityText(event.participantB)].sort().join("|");
}

function eventKey(event: ProviderEvent): string {
  const liveEvidence = event.category === "FOOTBALL" && event.liveState !== null
    ? `${event.liveState.period}|${event.liveState.scoreHome}|${event.liveState.scoreAway}` : "LIVE";
  const variantEvidence = event.category === "FOOTBALL"
    ? [event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN", event.sportVariant ?? "UNKNOWN"]
    : [event.gameVariant ?? "UNKNOWN"];
  return [event.category, event.eventScope, ...variantEvidence, identityText(event.participantA), identityText(event.participantB),
    event.isLive ? liveEvidence : String(event.startAtUtcMs)].join("|");
}

function eventSemanticKey(event: ProviderEvent): string {
  const liveEvidence = event.category === "FOOTBALL" && event.liveState !== null
    ? `${event.liveState.period}|${event.liveState.scoreHome}|${event.liveState.scoreAway}` : "LIVE";
  const variantEvidence = event.category === "FOOTBALL"
    ? [event.isVirtual === true ? "VIRTUAL" : event.isVirtual === false ? "REAL" : "UNKNOWN", event.sportVariant ?? "UNKNOWN"]
    : [event.gameVariant ?? "UNKNOWN"];
  return [event.category, event.eventScope, ...variantEvidence, identityText(event.participantA), identityText(event.participantB),
    event.rematchCandidate ? event.fixtureDiscriminator ?? "AMBIGUOUS_REMATCH" : "ORDINARY",
    event.isLive ? liveEvidence : "PREMATCH"].join("|");
}

function swapLolEvent(event: ProviderEvent): ProviderEvent {
  if (event.category !== "LOL") return event;
  return { ...event, participantA: event.participantB, participantB: event.participantA,
    liveState: event.liveState === null ? null : { ...event.liveState,
      seriesScoreA: event.liveState.seriesScoreB, seriesScoreB: event.liveState.seriesScoreA } };
}

function sameEventVariant(left: ProviderEvent, right: ProviderEvent): boolean {
  if (left.category !== right.category || left.eventScope !== right.eventScope) return false;
  if (left.category === "FOOTBALL" && right.category === "FOOTBALL") {
    return left.isVirtual === right.isVirtual && left.sportVariant === right.sportVariant;
  }
  return left.category === "LOL" && right.category === "LOL" && left.gameVariant === right.gameVariant;
}

function footballLiveEvidenceCompatible(left: ProviderEvent, right: ProviderEvent,
  orientation: EventOrientation): boolean {
  if (left.category !== "FOOTBALL" || right.category !== "FOOTBALL") return true;
  const leftState = left.liveState; const rightState = right.liveState;
  if (leftState === null || rightState === null) return true;
  if (leftState.period !== null && rightState.period !== null && leftState.period !== rightState.period) return false;
  const leftScoreKnown = leftState.scoreHome !== null && leftState.scoreAway !== null;
  const rightScoreKnown = rightState.scoreHome !== null && rightState.scoreAway !== null;
  if (!leftScoreKnown || !rightScoreKnown) return true;
  return orientation === "SAME"
    ? leftState.scoreHome === rightState.scoreHome && leftState.scoreAway === rightState.scoreAway
    : leftState.scoreHome === rightState.scoreAway && leftState.scoreAway === rightState.scoreHome;
}

function participantOrientation(left: ProviderEvent, right: ProviderEvent): EventOrientation | null {
  const same = identityText(left.participantA) === identityText(right.participantA) &&
    identityText(left.participantB) === identityText(right.participantB);
  if (same) return "SAME";
  const swapped = identityText(left.participantA) === identityText(right.participantB) &&
    identityText(left.participantB) === identityText(right.participantA);
  return swapped && (left.category === "FOOTBALL" || left.category === "LOL") ? "SWAPPED" : null;
}

function compatibleEventOrientation(left: ProviderEvent, right: ProviderEvent): EventOrientation | null {
  if (left.category !== right.category || left.isLive !== right.isLive) return null;
  if (!sameEventVariant(left, right)) return null;
  const withinKickoffTolerance = left.isLive || Math.abs(left.startAtUtcMs - right.startAtUtcMs) <= 120_000;
  if (!withinKickoffTolerance) return null;
  if (left.fixtureDiscriminator !== null && right.fixtureDiscriminator !== null &&
    left.fixtureDiscriminator !== right.fixtureDiscriminator) return null;
  const orientation = participantOrientation(left, right);
  if (orientation === null || !footballLiveEvidenceCompatible(left, right, orientation)) return null;
  if (left.category === "LOL" && eventSemanticKey(left) !==
    eventSemanticKey(orientation === "SWAPPED" ? swapLolEvent(right) : right)) return null;
  return orientation;
}

function invertLine(line: string | null): string | null {
  if (line === null) return null;
  const value = Number(line);
  if (!Number.isFinite(value)) return line;
  return String(Object.is(-value, -0) ? 0 : -value);
}

function orientMarket(market: ProviderMarket, orientation: EventOrientation): ProviderMarket {
  if (orientation !== "SWAPPED" || market.category !== "FOOTBALL" ||
    (market.marketType !== "FT_AH" && market.marketType !== "FH_AH")) return market;
  return { ...market, line: invertLine(market.line) };
}

function orientQuotes(quotes: readonly ProviderQuote[], orientation: EventOrientation): readonly ProviderQuote[] {
  if (orientation !== "SWAPPED") return quotes;
  return quotes.map((quote) => {
    if (quote.category === "LOL") {
      if (quote.selection === "TEAM_A") return { ...quote, selection: "TEAM_B" };
      if (quote.selection === "TEAM_B") return { ...quote, selection: "TEAM_A" };
      return quote;
    }
    if (quote.category === "FOOTBALL") {
      const selection = quote.selection === "HOME" ? "AWAY" : quote.selection === "AWAY" ? "HOME" : quote.selection;
      const line = quote.marketType === "FT_AH" || quote.marketType === "FH_AH" ? invertLine(quote.line) : quote.line;
      return { ...quote, selection, line };
    }
    return quote;
  }).sort((left, right) => left.selection.localeCompare(right.selection));
}

function marketKey(market: ProviderMarket): string {
  return [market.marketType, market.scope, market.line ?? ""].join("|");
}

function eligibleTwoWayCells(cells: readonly ComparisonCell[], requireSameSettlement = true): readonly ComparisonCell[] {
  const marketType = cells[0]?.market.marketType;
  if (marketType === undefined || marketType === "FT_1X2" || marketType === "FH_1X2") return [];
  const domains = new Map<string, ComparisonCell[]>();
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of cells) byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  for (const candidates of byProvider.values()) {
    if (candidates.length !== 1) continue;
    const cell = candidates[0]!;
    const selections = [...new Set(cell.quotes.map((quote) => quote.selection))].sort();
    if (selections.length !== 2) continue;
    const signature = [selections.join("|"), requireSameSettlement ? cell.market.settlementProfile : "DISPLAY_ONLY"].join("|");
    const matching = domains.get(signature) ?? [];
    matching.push(cell);
    domains.set(signature, matching);
  }
  return [...domains.values()].filter((matching) => new Set(matching.map((cell) => cell.provider)).size >= 2)
    .sort((left, right) => right.length - left.length)[0] ?? [];
}

function displayTwoWayCells(cells: readonly ComparisonCell[]): readonly ComparisonCell[] {
  const accepted: ComparisonCell[] = [];
  let outcomeDomain: string | null = null;
  const byProvider = new Map<ProviderId, ComparisonCell[]>();
  for (const cell of cells.filter(isFocusedTwoWayTicket)) {
    byProvider.set(cell.provider, [...(byProvider.get(cell.provider) ?? []), cell]);
  }
  for (const candidates of byProvider.values()) {
    if (candidates.length !== 1) continue;
    const cell = candidates[0]!;
    const selections = [...new Set(cell.quotes.map((quote) => quote.selection))].sort().join("|");
    if (outcomeDomain !== null && selections !== outcomeDomain) continue;
    outcomeDomain ??= selections;
    accepted.push(cell);
  }
  return accepted;
}

function isHalfGoalLine(line: string | null): boolean {
  if (line === null) return false;
  const value = Math.abs(Number(line));
  return Number.isFinite(value) && Math.abs(value % 1 - 0.5) < 1e-9;
}

export function isFocusedTwoWayTicket(cell: ComparisonCell): boolean {
  const domain = [...new Set(cell.quotes.map((quote) => quote.selection))].sort();
  if (cell.market.status !== "OPEN" || cell.quotes.some((quote) => quote.status !== "OPEN")) return false;
  if (cell.market.category === "FOOTBALL") {
    return cell.market.marketType === "FT_AH" && cell.market.scope === "FULL_TIME" &&
      isHalfGoalLine(cell.market.line) && domain.join("|") === "AWAY|HOME";
  }
  return cell.market.category === "LOL" && cell.market.marketType === "SERIES_WINNER" &&
    cell.market.scope === "SERIES" && cell.market.line === null && domain.length === 2;
}

export function isVisibleEvent(event: ProviderEvent, nowMs: number, horizonMs = 86_400_000): boolean {
  return event.isLive || (event.startAtUtcMs >= nowMs && event.startAtUtcMs <= nowMs + horizonMs);
}

export function decimalOdds(quote: ProviderQuote): number | null {
  const value = Number(quote.rawOdds);
  if (!Number.isFinite(value)) return null;
  if (quote.rawFormat === "DECIMAL") return value > 1 ? value : null;
  if (quote.rawFormat === "MALAY") {
    if (value === 0 || Math.abs(value) > 1) return null;
    return value > 0 ? 1 + value : 1 + 1 / Math.abs(value);
  }
  return null;
}

export function selectionLabel(event: ProviderEvent, selection: string): string {
  if (selection === "TEAM_A" || selection === "HOME") return event.participantA;
  if (selection === "TEAM_B" || selection === "AWAY") return event.participantB;
  if (selection === "OVER") return "Tài";
  if (selection === "UNDER") return "Xỉu";
  return selection;
}

export function observedTicketAsComparisonRow(ticket: ObservedTicketRow): ComparisonRow {
  const bestBySelection: Record<string, ProviderId> = {};
  for (const selection of ticket.outcomeDomain) {
    const best = ticket.cells.flatMap((cell) => cell.quotes.filter((quote) => quote.selection === selection &&
      quote.status === "OPEN" && cell.market.status === "OPEN").flatMap((quote) => {
      const odds = decimalOdds(quote);
      return odds === null ? [] : [{ provider: cell.provider, odds }];
    })).sort((left, right) => right.odds - left.odds || left.provider.localeCompare(right.provider))[0];
    if (best !== undefined) bestBySelection[selection] = best.provider;
  }
  const bestOdds = ticket.outcomeDomain.map((selection) => {
    const provider = bestBySelection[selection];
    const quote = ticket.cells.find((cell) => cell.provider === provider)?.quotes.find((item) => item.selection === selection);
    return quote === undefined ? null : decimalOdds(quote);
  });
  const inverseSum = bestOdds.length === 2 && bestOdds.every((value): value is number => value !== null)
    ? bestOdds.reduce((sum, value) => sum + 1 / value, 0) : null;
  const crossBook = new Set(Object.values(bestBySelection)).size >= 2;
  return { key: ticket.key, marketType: ticket.marketType, scope: ticket.scope, line: ticket.line,
    cells: ticket.cells, bestBySelection, crossBook,
    margin: crossBook && inverseSum !== null ? (1 / inverseSum) - 1 : null };
}

export function buildComparisonEvents(catalogs: readonly LiveCatalogResponse[]): readonly ComparisonEvent[] {
  const identityCounts = new Map<string, number>();
  for (const catalog of catalogs) for (const event of catalog.events) {
    const key = [catalog.provider, event.category, event.isLive ? "LIVE" : String(event.startAtUtcMs),
      unorderedParticipantKey(event)].join("|");
    identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const ambiguous = (catalog: LiveCatalogResponse, event: ProviderEvent): boolean => {
    const key = [catalog.provider, event.category, event.isLive ? "LIVE" : String(event.startAtUtcMs),
      unorderedParticipantKey(event)].join("|");
    return (identityCounts.get(key) ?? 0) > 1;
  };
  const groups: Array<{ key: string; event: ProviderEvent; catalogs: LiveCatalogResponse[];
    ids: Partial<Record<ProviderId, string>>; orientations: Partial<Record<ProviderId, EventOrientation>> }> = [];
  for (const catalog of catalogs) {
    for (const event of catalog.events) {
      let orientation: EventOrientation | null = null;
      let group = groups.find((candidate) => {
        if (candidate.ids[catalog.provider] !== undefined || ambiguous(catalog, event) ||
          candidate.catalogs.some((source) => ambiguous(source, candidate.event))) return false;
        orientation = compatibleEventOrientation(candidate.event, event);
        return orientation !== null;
      });
      if (group === undefined) {
        orientation = "SAME";
        group = { key: eventKey(event), event, catalogs: [], ids: {}, orientations: {} };
        groups.push(group);
      }
      if (!group.catalogs.some((candidate) => candidate.provider === catalog.provider)) group.catalogs.push(catalog);
      group.ids[catalog.provider] = event.providerEventId;
      group.orientations[catalog.provider] = orientation ?? "SAME";
    }
  }
  return groups.map((group) => {
    const key = group.key;
    const rowGroups = new Map<string, ComparisonCell[]>();
    for (const catalog of group.catalogs) {
      const providerEventId = group.ids[catalog.provider];
      for (const market of catalog.markets.filter((candidate) => candidate.providerEventId === providerEventId)) {
        const orientation = group.orientations[catalog.provider] ?? "SAME";
        const orientedMarket = orientMarket(market, orientation);
        const rowKey = marketKey(orientedMarket);
        const cells = rowGroups.get(rowKey) ?? [];
        cells.push({ provider: catalog.provider, market: orientedMarket,
          quotes: orientQuotes(catalog.quotes.filter((quote) => quote.providerMarketId === market.providerMarketId),
            orientation) });
        rowGroups.set(rowKey, cells);
      }
    }
    const observedRows = [...rowGroups.entries()].flatMap(([rowKey, rawCells]) => {
      const cells = displayTwoWayCells(rawCells);
      if (cells.length === 0) return [];
      const outcomeDomain = [...new Set(cells[0]!.quotes.map((quote) => quote.selection))].sort();
      return [{ key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, settlementProfile: cells[0]!.market.settlementProfile,
        outcomeDomain, cells } satisfies ObservedTicketRow];
    }).sort((left, right) => left.key.localeCompare(right.key));
    const rows = [...rowGroups.entries()].map(([rowKey, rawCells]) => [rowKey, eligibleTwoWayCells(rawCells)] as const)
      .filter(([, cells]) => cells.length >= 2).map(([rowKey, cells]): ComparisonRow => observedTicketAsComparisonRow({
        key: rowKey, marketType: cells[0]!.market.marketType, scope: cells[0]!.market.scope,
        line: cells[0]!.market.line, settlementProfile: cells[0]!.market.settlementProfile,
        outcomeDomain: [...new Set(cells[0]!.quotes.map((quote) => quote.selection))].sort(), cells
      })).sort((left, right) => (right.margin ?? Number.NEGATIVE_INFINITY) - (left.margin ?? Number.NEGATIVE_INFINITY) || left.key.localeCompare(right.key));
    const bestMargin = rows.reduce<number | null>((best, row) => row.margin === null ? best : Math.max(best ?? row.margin, row.margin), null);
    return { key, event: group.event, providers: group.catalogs.map((catalog) => catalog.provider),
      catalogs: group.catalogs, providerEventIds: group.ids, observedRows, rows, bestMargin };
  }).sort((left, right) => (right.bestMargin ?? Number.NEGATIVE_INFINITY) - (left.bestMargin ?? Number.NEGATIVE_INFINITY) ||
    left.event.startAtUtcMs - right.event.startAtUtcMs);
}

export function formatCountdown(startAtUtcMs: number, nowMs: number): string {
  const remainingSeconds = Math.max(0, Math.floor((startAtUtcMs - nowMs) / 1_000));
  if (remainingSeconds === 0) return "Starting / refresh pending";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  return `Starts in ${two(days)}:${two(hours)}:${two(minutes)}:${two(seconds)}`;
}

type DisplayLiveState = ProviderEvent["liveState"];

export function formatMatchClock(liveState: DisplayLiveState | null): string {
  if (liveState === null || !("clockMs" in liveState) || liveState.clockMs === null ||
    !Number.isFinite(liveState.clockMs) || liveState.clockMs < 0) {
    return "LIVE · clock unavailable";
  }
  const totalSeconds = Math.floor(liveState.clockMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `LIVE${liveState.period === null ? "" : ` · ${liveState.period}`} · ${clock} elapsed`;
}

export function estimatedLiveStartAtMs(observedAtMs: number, liveState: DisplayLiveState | null): number | null {
  if (!Number.isFinite(observedAtMs) || liveState === null || !("clockMs" in liveState) || liveState.clockMs === null ||
    !Number.isFinite(liveState.clockMs) || liveState.clockMs < 0) return null;
  const estimated = observedAtMs - liveState.clockMs;
  return Number.isFinite(estimated) && estimated >= 0 ? estimated : null;
}
