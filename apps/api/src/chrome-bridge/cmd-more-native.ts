import { normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "@tool-chenh/adapters";
import { footballBinaryMarketSpec, type NativeMarketObservation, type ProviderMarket } from "@tool-chenh/contracts";
import type { NormalizedCatalogPart } from "./catalog-part-merge.js";

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
      if (path !== "0") {
        observe(row, path, path === "1" ? "EXCLUDED" : "UNMAPPED",
          path === "1" ? "THREE_WAY_OUTCOME_DOMAIN" : "NATIVE_TYPE_UNMAPPED");
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
        ? "FH_ODD_EVEN" : "CORNER_FH_ODD_EVEN");
      const spec = footballBinaryMarketSpec(marketType)!;
      const market: ProviderMarket = { ...base, marketType, scope: spec.scope, settlementProfile: spec.settlementProfile };
      markets.push(market);
      const nativeEventId = period === "FT" ? native.eventId : `1${native.eventId.padStart(11, "0")}`;
      quotes.push(...part.quotes.map(quote => ({ ...quote, marketType, scope: spec.scope,
        providerSelectionId: `${nativeEventId}:${quote.selection === "ODD" ? "Odd:Home" : "Even:Away"}:0:${period === "FT" ? 0 : 1}` })));
      observe(row, path, "NORMALIZED", "CANONICAL_MARKET_MAPPED", marketId);
    };
    const observe = (row: readonly unknown[], path: string, disposition: NativeMarketObservation["disposition"],
      reason: string, marketId = `${native.eventId}:more:${period}:${path}`): void => {
      observations.push({ provider: "CMD", category: "FOOTBALL", providerEventId: native.eventId,
        providerMarketId: marketId, nativeType: `MORE:${period}:${path}`, nativeScope: period === "FT" ? "FULL_TIME" : "FIRST_HALF",
        nativeLabel: JSON.stringify(row).slice(0, 512), outcomeLabels: row.map((_, i) =>
          path === "0" ? ["ODD", "EVEN"][i] ?? `OUTCOME_${i + 1}` : `OUTCOME_${i + 1}`),
        observedAtMs: receipt.observedAtMs, disposition: identity.events.length === 0 ? "EXCLUDED" : disposition,
        reason: identity.events.length === 0 ? "EVENT_NOT_COMPARABLE" : reason });
    };
    for (const [index, row] of groups.entries()) visit(row, String(index));
  }
  return { ...identity, markets, quotes, nativeMarketObservations: observations };
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
