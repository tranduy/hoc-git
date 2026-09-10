import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, footballCategoricalMarketSpec, type NativeMarketObservation, type ProviderMarket } from "@tool-chenh/contracts";
import type { NormalizedCatalogPart } from "./catalog-part-merge.js";
import { cmdMoreTerms, type CmdMoreTerms } from "./cmd-more-terms.js";

export interface CmdNativeMore {
  readonly groupId: string;
  readonly eventId: string;
  readonly ft: readonly unknown[][];
  readonly fh: readonly unknown[][];
}

/** DataOdds.asmx/GetAllOdds's observed football tuple; never a roster. */
export function parseCmdNativeMore(body: string): CmdNativeMore | null {
  try {
    const root: unknown = JSON.parse(body);
    if (typeof root !== "object" || root === null || Array.isArray(root) || Object.keys(root).join() !== "d") return null;
    const d: unknown = (root as { d: unknown }).d;
    if (!Array.isArray(d) || d.length !== 4 || typeof d[0] !== "string" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(d[0]) ||
      !(typeof d[1] === "number" && Number.isSafeInteger(d[1]) && d[1] > 0 ||
        typeof d[1] === "string" && /^[1-9]\d{0,14}$/u.test(d[1]))) return null;
    let values = 0;
    const valid = (value: unknown, depth: number): boolean => {
      if (++values > 4096) return false;
      if (Array.isArray(value)) return depth < 3 && value.length <= 128 && value.every(item => valid(item, depth + 1));
      return value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
    };
    if (![d[2], d[3]].every(value => Array.isArray(value) && value.length <= 64 && value.every(Array.isArray) && valid(value, 0)) ||
      d[2].length < 9 || d[3].length < 6) return null;
    return { groupId: d[0].toLowerCase(), eventId: String(d[1]), ft: d[2], fh: d[3] };
  } catch { return null; }
}

export function normalizeCmdNativeMore(native: CmdNativeMore, owner: CmdCatalogInputRecord,
  receipt: { readonly observedAtMs: number; readonly receivedMonotonicMs: number; readonly sequence: number }): NormalizedCatalogPart {
  const options = { ...receipt, timezoneOffsetMinutes: 480 };
  const identity = normalizeObservedFootballCatalog("CMD", [{ ...owner, groups: [] }], options);
  const unsupportedPeriod = identity.events.length === 1 && identity.events[0]!.eventScope !== "REGULATION";
  const markets: NormalizedCatalogPart["markets"][number][] = [];
  const quotes: NormalizedCatalogPart["quotes"][number][] = [];
  const observations: NativeMarketObservation[] = [];
  for (const [period, groups] of [["FT", native.ft], ["FH", native.fh]] as const) {
    const visit = (row: readonly unknown[], path: string): void => {
      if (row.some(Array.isArray)) {
        for (const [index, child] of row.entries()) {
          if (Array.isArray(child)) visit(child, `${path}.${index}`);
          else observe([child], `${path}.${index}`, "UNMAPPED", "NATIVE_TYPE_UNMAPPED");
        }
        return;
      }
      if (path === "1" || period === "FT" && path === "2") {
        // Saved More renderer: FT/FH[1] uses HOME/DRAW/AWAY via One/Home,
        // X/Home, Two/Away; FT[2] uses OneX/Home, OneTwo/Home, XTwo/Away.
        // Both call GetX12OddsFormat (decimal) and GetExtraParams's individual
        // valid-price click gate. The HTTP main DC mapping separately verifies
        // the same named native fields against archived main/More tuples.
        const doubleChance = path === "2";
        const outcomes = doubleChance ? dcOutcomes : resultOutcomes;
        const marketId = `${native.eventId}:more:${period}:${doubleChance ? "DoubleChance" : "1X2"}`;
        const valid = row.length === 3 && !(doubleChance && nativeDcRowClosed(row)) ? row.flatMap((price, index) => typeof price === "number" && Number.isFinite(price) && price > 1
          ? [{ price, index }] : []) : [];
        const part = normalizeObservedFootballCatalog("CMD", [{ ...owner, groups: [{ betTypeIds: [doubleChance ? "DOUBLE_CHANCE" : period === "FT" ? "5" : "FH:5"],
          labels: valid.map(({ index }) => outcomes[index]!), odds: valid.map(({ price, index }) => ({
            marketOddsId: marketId, selectionId: resultSelectionId(native.eventId, period, doubleChance, index),
            priceText: String(price), priceFormat: "DECIMAL", status: "OPEN", greyedOut: "false"
          })) }] }], options);
        markets.push(...part.markets); quotes.push(...part.quotes);
        observe(row, path, part.markets.length > 0 ? "NORMALIZED" : "EXCLUDED",
          part.markets.length > 0 ? "CANONICAL_MARKET_MAPPED" : row.length !== 3 ? "INVALID_RESULT_SHAPE"
            : valid.length === 0 ? "NATIVE_MARKET_CLOSED" : "EVENT_NOT_COMPARABLE", marketId);
        return;
      }
      const terms = cmdMoreTerms(native.eventId, period, path, row);
      if (terms !== null) {
        // An already classified corners/bookings event must not acquire goal terms.
        const event = identity.events[0];
        const goalEvent = event !== undefined && !unsupportedPeriod &&
          !/\s*-\s*(?:CORNERS|BOOKINGS)\s*(?:\(\s*loading\s*\))?\s*$/iu.test(owner.leagueName);
        const added = new Set<string>();
        if (goalEvent) for (const leg of terms.legs) {
          const spec = footballCategoricalMarketSpec(leg.marketType);
          if (spec === null) continue;
          const providerMarketId = `${native.eventId}:more:${period}:${path}:${leg.marketType}`;
          if (!added.has(providerMarketId)) {
            added.add(providerMarketId);
            markets.push({ provider: "CMD", category: "FOOTBALL", providerEventId: native.eventId, providerMarketId,
              marketType: leg.marketType, scope: spec.scope, line: leg.line, settlementProfile: spec.settlementProfile, status: "OPEN" });
          }
          quotes.push({ provider: "CMD", category: "FOOTBALL", providerEventId: native.eventId, providerMarketId,
            providerSelectionId: leg.selectionId, marketType: leg.marketType, scope: spec.scope, selection: leg.selection,
            line: leg.line, rawOdds: String(row[leg.index]), rawFormat: "DECIMAL", status: "OPEN", isLive: event.isLive,
            sourceTimestampMs: null, receivedMonotonicMs: receipt.receivedMonotonicMs, sequence: receipt.sequence });
        }
        observe(row, path, added.size > 0 ? "NORMALIZED" : "EXCLUDED", !goalEvent ? "EVENT_NOT_COMPARABLE"
          : terms.reason ?? (added.size > 0 ? "CANONICAL_MARKET_MAPPED" : "NATIVE_MARKET_CLOSED"), undefined, terms);
        return;
      }
      if (path !== "0") {
        observe(row, path, "UNMAPPED", "NATIVE_TYPE_UNMAPPED");
        return;
      }
      // Actual MY/A account conversion and the public Odd/Even renderer are
      // documented in the source fixture. Native -999 closes both selections.
      const prices = row.map(cmdNativeMalayPrice);
      if (row.length !== 2 || prices.some(value => value === null)) {
        observe(row, path, "EXCLUDED", row.includes(-999) ? "NATIVE_MARKET_CLOSED" : "INVALID_TWO_WAY_SHAPE");
        return;
      }
      const marketId = `${native.eventId}:more:${period}:OddEven`;
      const part = normalizeObservedFootballCatalog("CMD", [{ ...owner, groups: [{ betTypeIds: ["2"],
        labels: ["Odd", "Even"], odds: prices.map(value => ({ marketOddsId: marketId,
          priceText: value!, status: null, greyedOut: null })) }] }], options);
      const base = part.markets[0];
      if (base === undefined || identity.events.length !== 1) {
        observe(row, path, "EXCLUDED", "EVENT_NOT_COMPARABLE");
        return;
      }
      const marketType = (period === "FT" ? base.marketType : base.marketType === "FT_ODD_EVEN"
        ? "FH_ODD_EVEN" : base.marketType === "CARD_FT_ODD_EVEN" ? "CARD_FH_ODD_EVEN" : "CORNER_FH_ODD_EVEN");
      const spec = footballBinaryMarketSpec(marketType)!;
      const market: ProviderMarket = { ...base, marketType, scope: spec.scope, settlementProfile: spec.settlementProfile };
      markets.push(market);
      const nativeEventId = period === "FT" ? native.eventId : `1${native.eventId.padStart(11, "0")}`;
      quotes.push(...part.quotes.map(quote => ({ ...quote, marketType, scope: spec.scope,
        providerSelectionId: `${nativeEventId}:${quote.selection === "ODD" ? "Odd:Home" : "Even:Away"}:0:${period === "FT" ? 0 : 1}` })));
      observe(row, path, "NORMALIZED", "CANONICAL_MARKET_MAPPED", marketId);
    };
    const observe = (row: readonly unknown[], path: string, disposition: NativeMarketObservation["disposition"],
      reason: string, marketId = `${native.eventId}:more:${period}:${path}`, terms?: CmdMoreTerms): void => {
      const result = path === "1" || period === "FT" && path === "2";
      const outcomes = path === "2" ? dcOutcomes : resultOutcomes;
      const wholeRowClosed = period === "FT" && path === "2" && nativeDcRowClosed(row);
      observations.push({ provider: "CMD", category: "FOOTBALL", providerEventId: native.eventId,
        ...(wholeRowClosed ? { status: "CLOSED" as const } : {}),
        providerMarketId: marketId, nativeType: `MORE:${period}:${path}`, nativeScope: period === "FT" ? "FULL_TIME" : "FIRST_HALF",
        nativeLabel: JSON.stringify(row).slice(0, 512), outcomeLabels: row.map((_, i) =>
          path === "0" ? ["ODD", "EVEN"][i] ?? `OUTCOME_${i + 1}`
            : result && row.length === 3 ? outcomes[i]! : `OUTCOME_${i + 1}`),
        ...(result ? { nativeSelections: row.map((price, index) => ({
          selectionId: row.length === 3 ? resultSelectionId(native.eventId, period, path === "2", index) : null,
          outcomeId: null, line: null, price: typeof price === "number" ? String(price) : null, rawFormat: "DECIMAL" as const,
          ...(row.length !== 3 ? {} : wholeRowClosed ? { status: "CLOSED" as const }
            : typeof price === "number" && price > 1 ? { status: "OPEN" as const }
            : price === -999 || price === 0 || typeof price === "number" && price > 0 && price < 1 ? { status: "CLOSED" as const } : {})
        })) } : {}),
        ...(terms === undefined ? {} : { outcomeLabels: terms.outcomeLabels, nativeSelections: terms.nativeSelections }),
        observedAtMs: receipt.observedAtMs, disposition: identity.events.length === 0 || unsupportedPeriod ? "EXCLUDED" : disposition,
        reason: identity.events.length === 0 ? "EVENT_NOT_COMPARABLE"
          : unsupportedPeriod ? "EVENT_PERIOD_SETTLEMENT_UNSUPPORTED" : reason });
    };
    for (const [index, row] of groups.entries()) visit(row, String(index));
  }
  return { ...identity, markets, quotes, nativeMarketObservations: observations };
}

const dcOutcomes = ["HOME_DRAW", "HOME_AWAY", "DRAW_AWAY"] as const;
const resultOutcomes = ["HOME", "DRAW", "AWAY"] as const;
function nativeDcRowClosed(row: readonly unknown[]): boolean {
  // onExtraBetTableLoaded's non-parlay Bi2(..., 0) clears the whole DC row.
  return row.some(price => typeof price === "number" && price > 0 && price < 1);
}
function resultSelectionId(eventId: string, period: "FT" | "FH", doubleChance: boolean, index: number): string {
  const nativeEventId = period === "FT" ? eventId : `1${eventId.padStart(11, "0")}`;
  const selection = (doubleChance ? ["OneX:Home", "OneTwo:Home", "XTwo:Away"] : ["One:Home", "X:Home", "Two:Away"])[index];
  return `${nativeEventId}:${selection}:0:${period === "FT" ? 0 : 1}`;
}

/** Public OddsUtil's MY/A, non-parlay path: commission A adds zero for
 * either side. MY+MR crosses +/-1 by adding/subtracting two, not inversion.
 * GetOEOddsFormat then renders two decimals. No other account format is used. */
export function cmdNativeMalayPrice(raw: unknown): string | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw === -999 || raw === 0) return null;
  let value = Math.round(raw * 1000) / 1000;
  if (value > 1) value -= 2;
  else if (value < -1) value += 2;
  if (value === -1) value = 1;
  if (value <= -1) value = (value * 1000 + 2000) / 1000;
  if (value === -1) value = 1;
  value = Number((Math.round(value * 1000) / 1000).toFixed(2));
  return value !== 0 && Math.abs(value) <= 1 ? String(value) : null;
}
