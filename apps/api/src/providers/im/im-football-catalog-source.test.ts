import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { extractImFootballCatalog, mergeImFootballDelta,
  mergeImFootballSnapshots, observeNativeImFootballMarkets } from "./im-football-catalog-source.js";

const event = {
  eid: 112516390, htn: "Monterrey Rayados", atn: "Nashville SC",
  cn: "Leagues Cup", edt: "2026-08-12T20:00:00-04:00", isrbt: false, iscyb: false,
  mls: [
    { mi: 10, bti: 1, gp: 1, il: false, ws: [
      { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67, ot: 1 },
      { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79, ot: 1 }
    ] },
    { mi: 11, bti: 1, gp: 1, il: false, ws: [
      { wsi: 111, si: 1, hdp: -0.25, dih: "+0/0.5", o: 0.87, ot: 1 },
      { wsi: 112, si: 2, hdp: -0.25, dih: "-0/0.5", o: -0.99, ot: 1 }
    ] },
    { mi: 12, bti: 2, gp: 1, il: false, ws: [
      { wsi: 121, si: 3, hdp: 2.5, dih: "2.5", o: 0.7, ot: 1 },
      { wsi: 122, si: 4, hdp: 2.5, dih: "2.5", o: -0.84, ot: 1 }
    ] }
  ]
};

describe("extractImFootballCatalog", () => {
  it("retains two-sided zero handicaps using native signed-line semantics through the adapter", () => {
    const source = { StatusCode: 100, sel: [{ ...event, mls: [
      { mi: 1010, bti: 1, gp: 2, il: false, ws: [
        { wsi: 10101, si: 1, hdp: 0, dih: "0", o: 0.58, ot: 2 },
        { wsi: 10102, si: 2, hdp: 0, dih: "0", o: 1.38, ot: 2 }] }
    ] }] };
    const records = extractImFootballCatalog(source);
    const canonical = normalizeSbobetCatalog(records, { provider: "IM", observedAtMs: 100,
      receivedMonotonicMs: 0, sequence: 0 });
    expect(canonical.markets).toEqual([expect.objectContaining({ marketType: "FH_AH", line: "0" })]);
    expect(canonical.quotes).toHaveLength(2);
  });
  it.each([[1, "FT_GOAL_RANGE"], [2, "FH_GOAL_RANGE"], [3, "SH_GOAL_RANGE"]] as const)(
    "maps native total-goal buckets for gp=%s without converting buckets to over/under", (gp, marketType) => {
      const source = { StatusCode: 100, sel: [{ ...event, mls: [{ mi: 700, bti: 7, gp, il: false,
        ws: [42, 39, 41, 40].map((si) => ({ wsi: 7000 + si, si, o: 2.2, ot: 3 })) }] }] };
      const records = extractImFootballCatalog(source);
      const normalized = normalizeSbobetCatalog(records, { provider: "IM", observedAtMs: 100,
        receivedMonotonicMs: 0, sequence: 0 });
      expect(normalized.markets[0]?.marketType).toBe(marketType);
      expect(normalized.quotes.map((quote) => quote.selection)).toEqual(gp === 1
        ? ["RANGE_7_PLUS", "RANGE_0_1", "RANGE_4_6", "RANGE_2_3"]
        : ["RANGE_3_PLUS", "RANGE_0_0", "RANGE_2_2", "RANGE_1_1"]);
      expect(normalized.quotes[0]).toMatchObject({ providerSelectionId: "7042", rawOdds: "2.2",
        rawFormat: "DECIMAL", status: "OPEN", receivedMonotonicMs: 0, sequence: 0 });
      expect(observeNativeImFootballMarkets(source, 100)[0]?.disposition).toBe("NORMALIZED");
    });

  it("maps half/full and corner results by native code while preserving scope and suspension", () => {
    const source = { StatusCode: 100, sel: [{ ...event, mls: [
      { mi: 900, bti: 9, gp: 1, il: true, ws: [{ wsi: 9001, si: 49, o: 4.65, ot: 3 }] },
      { mi: 3130, bti: 313, gp: 2, il: false, ws: [{ wsi: 31301, si: 7, o: 9.3, ot: 3 }] }
    ] }] };
    expect(extractImFootballCatalog(source)[0]?.markets).toEqual([
      expect.objectContaining({ marketType: "FT_HALF_FULL_RESULT", selections: [
        expect.objectContaining({ selection: "DRAW_HOME", locked: true })] }),
      expect.objectContaining({ marketType: "CORNER_FH_1X2", selections: [
        expect.objectContaining({ selection: "DRAW", locked: false })] })]);
    expect(extractImFootballCatalog({ ...source, sel: [{ ...event, mls: [
      { ...source.sel[0]!.mls[0]!, gp: 2 }, { ...source.sel[0]!.mls[1]!, gp: 3 }
    ] }] })).toEqual([]);
  });

  it("retains exact scores separately from unsupported other-score outcomes and rejects foreign codes", () => {
    const native = { mi: 600, bti: 6, gp: 3, il: false,
      ws: [{ wsi: 601, si: 23, o: 9.63, ot: 3 }, { wsi: 602, si: 439, o: 5.95, ot: 3 }] };
    const source = (market: unknown) => ({ StatusCode: 100, sel: [{ ...event, mls: [market] }] });
    expect(extractImFootballCatalog(source(native))[0]?.markets[0]).toMatchObject({ marketType: "SH_CORRECT_SCORE",
      selections: [{ selectionId: "601", selection: "SCORE_2_1", priceText: "9.63", priceFormat: "DECIMAL" }] });
    expect(observeNativeImFootballMarkets(source(native), 100)[0]).toMatchObject({ disposition: "NORMALIZED",
      reason: "PARTIAL_CANONICAL_OUTCOMES", outcomeLabels: ["SCORE_2_1", "439"], nativeSelections: [
        { selectionId: "601", outcomeId: "23" }, { selectionId: "602", outcomeId: "439" }] });
    expect(extractImFootballCatalog(source({ ...native, ws: [native.ws[1]] }))).toEqual([]);
    expect(extractImFootballCatalog(source({ ...native, ws: [native.ws[0], { ...native.ws[1], si: 99999 }] }))).toEqual([]);
    expect(extractImFootballCatalog(source({ ...native, ws: [native.ws[0], { ...native.ws[0], wsi: 603 }] }))).toEqual([]);
    expect(extractImFootballCatalog(source({ ...native, ws: [native.ws[0], { ...native.ws[1], wsi: 601 }] }))).toEqual([]);
  });

  it.each([{ ws: [] }, { ws: [{ wsi: 7001, si: 39, o: 0, ot: 3 }] },
    { ws: [{ wsi: 7001, si: 39, o: null, ot: 3 }] }])(
    "withdraws unavailable categorical quotes on a native market replacement", ({ ws }) => {
      const native = { mi: 700, bti: 7, gp: 1, il: false, ws: [{ wsi: 7001, si: 39, o: 5.87, ot: 3 }] };
      const initial = extractImFootballCatalog({ StatusCode: 100, sel: [{ ...event, mls: [...event.mls, native] }] });
      expect(initial[0]?.markets.some(market => market.marketId === "700")).toBe(true);
      const changed = mergeImFootballDelta(initial, { StatusCode: 100,
        dc: [{ eid: event.eid, a: 3, v: [{ ...native, ws }] }] });
      expect(changed[0]?.markets.map(market => market.marketId)).toEqual(["10", "11", "12"]);
    });
  it.each([0, null, undefined])("withdraws only an unavailable exact-score price %s and retains its priced sibling", (price) => {
    const native = { mi: 600, bti: 6, gp: 1, il: false, ws: [
      { wsi: 601, si: 23, o: 9.63, ot: 3 }, { wsi: 602, si: 24, o: 20, ot: 3 }] };
    const source = (market: unknown) => ({ StatusCode: 100, sel: [{ ...event, mls: [market] }] });
    const initial = extractImFootballCatalog(source(native));
    expect(initial[0]?.markets[0]?.selections).toHaveLength(2);
    const replacement = { ...native, ws: [native.ws[0], { ...native.ws[1], o: price }] };
    const changed = mergeImFootballDelta(initial, { StatusCode: 100,
      dc: [{ eid: event.eid, a: 3, v: [replacement] }] });
    expect(changed[0]?.markets[0]?.selections).toEqual([
      expect.objectContaining({ selectionId: "601", selection: "SCORE_2_1", priceText: "9.63" })]);
    expect(extractImFootballCatalog(source(replacement))).toEqual(changed);
    expect(observeNativeImFootballMarkets(source(replacement), 100)[0]).toMatchObject({
      disposition: "NORMALIZED", reason: "PARTIAL_CANONICAL_OUTCOMES", nativeSelections: [
        { selectionId: "601", price: "9.63" }, { selectionId: "602", price: price === 0 ? "0" : null }] });
    expect(extractImFootballCatalog(source({ ...replacement, ws: [native.ws[0], { ...native.ws[1], o: "bad" }] }))).toEqual([]);
    expect(extractImFootballCatalog(source({ ...replacement, ws: [native.ws[0], { ...native.ws[1], si: 999, o: price }] }))).toEqual([]);
  });
  it.each([true, false, undefined, "false", null])("preserves native market il=%s and never opens an unknown lock state", (il) => {
    const source = { StatusCode: 100, sel: [{ ...event, mls: [{ mi: 888, bti: 8, gp: 1, il,
      ws: [{ wsi: 8881, si: 43, o: 1.5, ot: 3 }] }] }] };
    expect(extractImFootballCatalog(source)[0]?.markets[0]?.selections[0]?.locked).toBe(il !== false);
    expect(observeNativeImFootballMarkets(source, 1)[0]?.status).toBe(typeof il === "boolean" ? il ? "SUSPENDED" : "OPEN" : undefined);
  });
  it("retains a lone proven binary leg with exact signed handicap and applies its lock in a delta", () => {
    const source = { StatusCode: 100, sel: [{ ...event, mls: [{ mi: 991, bti: 1, gp: 1, il: true,
      ws: [{ wsi: 9911, si: 2, hdp: -0.5, dih: "-0.5", o: 0.9, ot: 1 }] }] }] };
    const initial = extractImFootballCatalog(source);
    expect(initial[0]?.markets).toEqual([expect.objectContaining({ handicapLineFormat: "SIGNED", selections: [
      expect.objectContaining({ selection: "AWAY", lineText: "-0.5", locked: true })] })]);
    const delta = { StatusCode: 100, dc: [{ eid: event.eid, a: 3, v: [{ ...source.sel[0]!.mls[0]!, il: false }] }] };
    expect(mergeImFootballDelta(initial, delta)[0]?.markets[0]?.selections[0]?.locked).toBe(false);
    const ambiguous = { ...source, sel: [{ ...source.sel[0]!, mls: [{ ...source.sel[0]!.mls[0]!,
      ws: [{ ...source.sel[0]!.mls[0]!.ws[0]!, dih: "0.5" }] }] }] };
    expect(extractImFootballCatalog(ambiguous)).toEqual([]);
  });
  it.each([[1, "FT_DOUBLE_CHANCE"], [2, "FH_DOUBLE_CHANCE"], [3, "SH_DOUBLE_CHANCE"]] as const)(
    "maps IM double chance gp=%s from native selection codes, independent of row order", (gp, marketType) => {
      const input = { StatusCode: 100, sel: [{ ...event, mls: [{ mi: "2515639254", bti: 8, gp,
        ws: [{ wsi: "32522021117", si: 45, o: 1.07, ot: 3 }, { wsi: "32522021115", si: 43, o: 1.01, ot: 3 },
          { wsi: "32522021116", si: 44, o: 3.5, ot: 3 }] }] }] };
      expect(extractImFootballCatalog(input)[0]?.markets).toEqual([expect.objectContaining({ marketId: "2515639254", marketType,
        lineText: null, selections: [
          expect.objectContaining({ selectionId: "32522021117", selection: "HOME_AWAY", priceText: "1.07", priceFormat: "DECIMAL" }),
          expect.objectContaining({ selectionId: "32522021115", selection: "HOME_DRAW", priceText: "1.01", priceFormat: "DECIMAL" }),
          expect.objectContaining({ selectionId: "32522021116", selection: "DRAW_AWAY", priceText: "3.5", priceFormat: "DECIMAL" })] })]);
      expect(observeNativeImFootballMarkets(input, 1234)[0]).toMatchObject({ disposition: "NORMALIZED",
        outcomeLabels: ["HOME_AWAY", "HOME_DRAW", "DRAW_AWAY"] });
    });
  it("retains a partial second-half result without inventing a draw and rejects foreign or duplicate native outcomes", () => {
    const source = (ws: readonly unknown[], gp = 3) => ({ StatusCode: 100, sel: [{ ...event,
      mls: [{ mi: 701, bti: 3, gp, ws }] }] });
    const home = { wsi: 7011, si: 5, o: 2.4, ot: 3 };
    expect(extractImFootballCatalog(source([home]))[0]?.markets).toEqual([
      expect.objectContaining({ marketType: "SH_1X2", selections: [expect.objectContaining({ selection: "HOME" })] })]);
    expect(extractImFootballCatalog(source([home, { ...home, wsi: 7012 }]))).toEqual([]);
    expect(extractImFootballCatalog(source([home, { ...home, wsi: 7012, si: 43 }]))).toEqual([]);
    expect(extractImFootballCatalog(source([home], 4))).toEqual([]);
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const changed = mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: event.eid, a: 3,
      v: [{ mi: 701, bti: 3, gp: 3, ws: [home] }] }] });
    expect(changed[0]?.markets.find((market) => market.marketId === "701")?.selections)
      .toEqual([expect.objectContaining({ selection: "HOME", priceText: "2.4", priceFormat: "DECIMAL" })]);
  });
  it.each([[2, "HK"], [3, "DECIMAL"]] as const)("preserves native IM odds format %s without adding one to Euro odds", (ot, priceFormat) => {
    const input = { StatusCode: 100, sel: [{ ...event, mls: [{ mi: 180, bti: 18, gp: 1,
      ws: [{ wsi: 1801, si: 87, o: 2.15, ot }, { wsi: 1802, si: 88, o: 1.8, ot }] }] }] };
    expect(extractImFootballCatalog(input)[0]?.markets[0]?.selections).toEqual([
      expect.objectContaining({ selectionId: "1801", selection: "YES", priceText: "2.15", priceFormat }),
      expect.objectContaining({ selectionId: "1802", selection: "NO", priceText: "1.8", priceFormat })
    ]);
    expect(observeNativeImFootballMarkets(input, 1234)[0]?.nativeSelections?.[0])
      .toMatchObject({ price: "2.15", rawFormat: priceFormat });
  });

  it("rejects non-opposing total lines but accepts equivalent decimal and split notation", () => {
    const input = (under: string, hdp: number) => ({ StatusCode: 100, sel: [{ ...event, mls: [{
      mi: 1602, bti: 160, gp: 2, ws: [
        { wsi: 16021, si: 638, hdp: 0.75, dih: "0.5/1", o: 0.9 },
        { wsi: 16022, si: 639, hdp, dih: under, o: -0.95 }
      ] }] }] });
    expect(extractImFootballCatalog(input("1.5", 1.5))).toEqual([]);
    expect(extractImFootballCatalog(input("0.75", 0.75))[0]?.markets[0]?.marketType).toBe("HOME_FH_TOTAL");
  });
  it("reads both-halves thresholds from IM's native total specifier instead of dropping priced yes/no markets", () => {
    const input = { StatusCode: 100, sel: [{ ...event, mls: [
      { mi: 240, bti: 24, gp: 1, ws: [
        { wsi: 2401, si: 101, s: "total=1.5", o: 0.9 }, { wsi: 2402, si: 102, s: "total=1.5", o: -0.95 }
      ] },
      { mi: 250, bti: 25, gp: 1, ws: [
        { wsi: 2501, si: 103, s: "total=1.5", o: 0.85 }, { wsi: 2502, si: 104, s: "total=1.5", o: -0.9 }
      ] }
    ] }] };
    expect(extractImFootballCatalog(input)[0]?.markets).toEqual([
      expect.objectContaining({ marketType: "FT_BOTH_HALVES_OVER_TOTAL", lineText: "1.5" }),
      expect.objectContaining({ marketType: "FT_BOTH_HALVES_UNDER_TOTAL", lineText: "1.5" })
    ]);
    const wrong = { ...input, sel: [{ ...input.sel[0]!, mls: [{ ...input.sel[0]!.mls[0]!,
      ws: [input.sel[0]!.mls[0]!.ws[0]!, { ...input.sel[0]!.mls[0]!.ws[1]!, s: "total=2.5" }] }] }] };
    expect(extractImFootballCatalog(wrong)).toEqual([]);
  });
  it("normalizes complete native 1X2 markets with three selections and preserves half scope", () => {
    const selections = [{ wsi: 701, si: 5, o: 1.1 }, { wsi: 702, si: 6, o: 2.4 },
      { wsi: 703, si: 7, o: 2.2 }];
    const input = { StatusCode: 100, sel: [{ ...event, mls: [
      { mi: 70, bti: 3, gp: 1, ws: selections }, { mi: 71, bti: 3, gp: 2, ws: selections }
    ] }] };
    expect(extractImFootballCatalog(input)[0]?.markets).toEqual([
      expect.objectContaining({ marketType: "FT_1X2", selections: [
        expect.objectContaining({ selectionId: "701", selection: "HOME" }),
        expect.objectContaining({ selectionId: "702", selection: "AWAY" }),
        expect.objectContaining({ selectionId: "703", selection: "DRAW" })] }),
      expect.objectContaining({ marketType: "FH_1X2" })
    ]);
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [{ ...event,
      mls: [{ mi: 72, bti: 3, gp: 1, ws: selections.slice(0, 2) }] }] })[0]?.markets[0]?.selections).toHaveLength(2);
  });
  it("preserves first-half home/away team totals as distinct contracts with native selection identities", () => {
    const candidate = { ...event, mls: [
      { mi: 1602, bti: 160, gp: 2, ws: [
        { wsi: 16021, si: 638, hdp: 0.75, dih: "0.5/1", o: 0.88 },
        { wsi: 16022, si: 639, hdp: 0.75, dih: "0.5/1", o: -0.96 }
      ] },
      { mi: 1612, bti: 161, gp: 2, ws: [
        { wsi: 16121, si: 640, hdp: 0.5, dih: "0.5", o: 0.83 },
        { wsi: 16122, si: 641, hdp: 0.5, dih: "0.5", o: -0.91 }
      ] }
    ] };
    const input = { StatusCode: 100, sel: [candidate] };
    expect(extractImFootballCatalog(input)[0]?.markets).toEqual([
      expect.objectContaining({ marketId: "1602", marketType: "HOME_FH_TOTAL", lineText: "0.5/1",
        selections: [expect.objectContaining({ selectionId: "16021", selection: "OVER", priceText: "0.88" }),
          expect.objectContaining({ selectionId: "16022", selection: "UNDER", priceText: "-0.96" })] }),
      expect.objectContaining({ marketId: "1612", marketType: "AWAY_FH_TOTAL", lineText: "0.5" })
    ]);
    expect(observeNativeImFootballMarkets(input, 1234).map(({ disposition }) => disposition))
      .toEqual(["NORMALIZED", "NORMALIZED"]);
    expect(observeNativeImFootballMarkets(input, 1234)[0]?.nativeSelections).toEqual([
      expect.objectContaining({ price: "0.88", rawFormat: "HK" }),
      expect.objectContaining({ price: "-0.96", rawFormat: "MALAY" })
    ]);
    expect(extractImFootballCatalog({ StatusCode: 100,
      sel: [{ ...candidate, mls: candidate.mls.map(m => ({ ...m, gp: 19 })) }] })).toEqual([]);
  });
  it("accounts for every native IM market without treating an unknown type as a comparable ticket", () => {
    const candidate = { ...event, mls: [
      event.mls[0],
      { mi: 40, bti: 3, gp: 1, ws: [
        { wsi: 401, si: 5, o: 2.1 }, { wsi: 402, si: 7, o: 3.2 }, { wsi: 403, si: 6, o: 3.4 }
      ] },
      { mi: 41, bti: 777, gp: 19, ws: [
        { wsi: 411, si: 801, o: 0.9 }, { wsi: 412, si: 802, o: -0.95 }
      ] }
    ] };

    expect(observeNativeImFootballMarkets({ StatusCode: 100, sel: [candidate] }, 1234)).toEqual([
      expect.objectContaining({ providerMarketId: "10", nativeType: "bti=1", nativeScope: "gp=1",
        outcomeLabels: ["HOME", "AWAY"], disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" }),
      expect.objectContaining({ providerMarketId: "40", nativeType: "bti=3", nativeScope: "gp=1",
        outcomeLabels: ["HOME", "DRAW", "AWAY"], disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" }),
      expect.objectContaining({ providerMarketId: "41", nativeType: "bti=777", nativeScope: "gp=19",
        outcomeLabels: ["801", "802"], disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" })
    ]);
  });

  it("keeps live events and every future prematch event without a time horizon", () => {
    const nowMs = Date.parse("2026-08-19T00:00:00.000Z");
    const candidate = (eid: number, edt: string, isrbt = false) => ({ ...event, eid, edt, isrbt });

    const records = extractImFootballCatalog({ StatusCode: 100, sel: [
      candidate(1, "2026-08-01T00:00:00.000Z", true),
      candidate(2, "2026-08-18T23:59:59.999Z"),
      candidate(3, "2026-08-19T00:00:00.000Z"),
      candidate(4, "2026-08-21T00:00:00.000Z"),
      candidate(5, "2026-08-21T00:00:00.001Z")
    ] }, { nowMs });

    expect(records.map(({ eventId }) => eventId)).toEqual(["1", "3", "4", "5"]);
  });

  it("extracts exact full-time fractional handicap and total tickets", () => {
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [event] })).toEqual([{
      eventId: "112516390", leagueName: "Leagues Cup", timeText: "PREMATCH", scoreText: null,
      startAtUtcMs: Date.parse("2026-08-12T20:00:00-04:00"),
      teamNames: ["Monterrey Rayados", "Nashville SC"],
      markets: [{ marketId: "10", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "101", selection: "HOME", priceText: "0.67", locked: false, lineText: "+0.5" },
        { selectionId: "102", selection: "AWAY", priceText: "-0.79", locked: false, lineText: "-0.5" }
      ] }, { marketId: "11", marketType: "FT_AH", lineText: null, selections: [
        { selectionId: "111", selection: "HOME", priceText: "0.87", locked: false, lineText: "+0/0.5" },
        { selectionId: "112", selection: "AWAY", priceText: "-0.99", locked: false, lineText: "-0/0.5" }
      ] }, { marketId: "12", marketType: "FT_TOTAL", lineText: "2.5", selections: [
        { selectionId: "121", selection: "OVER", priceText: "0.7", locked: false, lineText: "2.5" },
        { selectionId: "122", selection: "UNDER", priceText: "-0.84", locked: false, lineText: "2.5" }
      ] }]
    }]);
  });

  it("normalizes proved line-free, team and corner two-way IM markets", () => {
    const candidate = { ...event, mls: [
      { mi: 50, bti: 5, gp: 1, ws: [
        { wsi: 501, si: 10, o: 0.88 }, { wsi: 502, si: 11, o: -0.96 }
      ] },
      { mi: 51, bti: 18, gp: 1, ws: [
        { wsi: 511, si: 87, o: 0.83 }, { wsi: 512, si: 88, o: -0.91 }
      ] },
      { mi: 55, bti: 18, gp: 3, ws: [
        { wsi: 551, si: 87, o: 0.81 }, { wsi: 552, si: 88, o: -0.89 }
      ] },
      { mi: 52, bti: 31, gp: 1, ws: [
        { wsi: 521, si: 118, hdp: 1.5, dih: "1.5", o: -0.9 },
        { wsi: 522, si: 119, hdp: 1.5, dih: "1.5", o: 0.82 }
      ] },
      { mi: 53, bti: 299, gp: 2, ws: [
        { wsi: 531, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 532, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ] },
      { mi: 54, bti: 306, gp: 1, ws: [
        { wsi: 541, si: 3, hdp: 9.5, dih: "9.5", o: 0.86 },
        { wsi: 542, si: 4, hdp: 9.5, dih: "9.5", o: -0.94 }
      ] }
    ] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [candidate] })[0]?.markets).toEqual([
      expect.objectContaining({ marketId: "50", marketType: "FT_ODD_EVEN", lineText: null,
        selections: [expect.objectContaining({ selection: "ODD" }), expect.objectContaining({ selection: "EVEN" })] }),
      expect.objectContaining({ marketId: "51", marketType: "FT_BTTS", lineText: null,
        selections: [expect.objectContaining({ selection: "YES" }), expect.objectContaining({ selection: "NO" })] }),
      expect.objectContaining({ marketId: "55", marketType: "SH_BTTS", lineText: null,
        selections: [expect.objectContaining({ selection: "YES" }), expect.objectContaining({ selection: "NO" })] }),
      expect.objectContaining({ marketId: "52", marketType: "HOME_FT_TOTAL", lineText: "1.5",
        selections: [expect.objectContaining({ selection: "UNDER" }), expect.objectContaining({ selection: "OVER" })] }),
      expect.objectContaining({ marketId: "53", marketType: "CORNER_FH_AH" }),
      expect.objectContaining({ marketId: "54", marketType: "CORNER_FT_TOTAL", lineText: "9.5" })
    ]);
  });

  it("preserves Malay and Hong Kong odds using the native format without rounding", () => {
    const decoded = [0.67, -0.79, 1.25, 3].map((odds) => {
      const candidate = { ...event, mls: [{ ...event.mls[0], ws: event.mls[0]!.ws
        .map((item, index) => index === 0 ? { ...item, o: odds, ot: odds > 1 ? 2 : 1 } : item) }] };
      return extractImFootballCatalog({ StatusCode: 100, sel: [candidate] })[0]
        ?.markets[0]?.selections[0]?.priceText;
    });

    expect(decoded).toEqual(["0.67", "-0.79", "1.25", "3"]);
  });

  it.each([
    ["zero", 0],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["a malformed string", "1.25"],
    ["unsupported nested odds", { value: 1.25 }],
    ["an out-of-contract negative value", -1.01],
    ["a Hong Kong value whose exact Malay form is scientific notation", 1e7]
  ])("rejects %s at the IM catalog boundary", (_label, odds) => {
    const candidate = { ...event, mls: [{ ...event.mls[0], ws: event.mls[0]!.ws
      .map((item, index) => index === 0 ? { ...item, o: odds } : item) }] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [candidate] })).toEqual([]);
  });

  it("does not turn a malformed price delta into a provider removal", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const malformed = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{
      ...event.mls[0], ws: event.mls[0]!.ws.map((item, index) => index === 0
        ? { ...item, o: 0 } : item)
    }] }] };

    expect(mergeImFootballDelta(initial, malformed)).toBe(initial);
    expect(initial[0]?.markets[0]?.selections.map((item) => item.priceText)).toEqual(["0.67", "-0.79"]);
  });

  it("applies a delta whose changed market has no published line yet by withdrawing only that market", () => {
    // Measured 2026-09-01: IM emits in-domain markets whose selections lack
    // `hdp` entirely. Refusing the whole delta for one of them left every
    // other price in that delta standing as current.
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { ...event.mls[0], ws: event.mls[0]!.ws.map(({ hdp: _line, ...item }) => item) },
      { ...event.mls[2], ws: event.mls[2]!.ws.map((item) => ({ ...item, o: 0.75 })) }
    ] }] };

    const merged = mergeImFootballDelta(initial, delta);
    expect(merged).not.toBe(initial);
    expect(merged[0]?.markets.map((item) => item.marketId)).toEqual(["11", "12"]);
    expect(merged[0]?.markets[1]?.selections[0]?.priceText).toBe("0.75");
  });

  it("excludes a market with no published line from a snapshot without dropping the event", () => {
    const withLineless = { ...event, mls: [...event.mls,
      { mi: 13, bti: 2, gp: 1, il: false, ws: [
        { wsi: 131, si: 3, dih: "3", o: 0.95, ot: 1 },
        { wsi: 132, si: 4, dih: "3", o: -1.05, ot: 1 }
      ] }] };
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [withLineless] })[0]?.markets.map((item) => item.marketId))
      .toEqual(["10", "11", "12"]);
  });

  it("keeps first-half handicap and total identities separate from full-time", () => {
    const firstHalf = { ...event, mls: [
      { mi: 20, bti: 1, gp: 2, il: false, ws: [
        { wsi: 201, si: 1, hdp: -0.75, dih: "+0.5/1", o: 0.78, ot: 1 },
        { wsi: 202, si: 2, hdp: -0.75, dih: "-0.5/1", o: -0.9, ot: 1 }
      ] },
      { mi: 21, bti: 2, gp: 2, il: false, ws: [
        { wsi: 211, si: 3, hdp: 1.25, dih: "1/1.5", o: 0.81, ot: 1 },
        { wsi: 212, si: 4, hdp: 1.25, dih: "1/1.5", o: -0.93, ot: 1 }
      ] }
    ] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [firstHalf] })[0]?.markets).toEqual([
      { marketId: "20", marketType: "FH_AH", lineText: null, selections: [
        { selectionId: "201", selection: "HOME", priceText: "0.78", locked: false, lineText: "+0.5/1" },
        { selectionId: "202", selection: "AWAY", priceText: "-0.9", locked: false, lineText: "-0.5/1" }
      ] },
      { marketId: "21", marketType: "FH_TOTAL", lineText: "1/1.5", selections: [
        { selectionId: "211", selection: "OVER", priceText: "0.81", locked: false, lineText: "1/1.5" },
        { selectionId: "212", selection: "UNDER", priceText: "-0.93", locked: false, lineText: "1/1.5" }
      ] }
    ]);
  });

  it("maps provider game period 3 to exact second-half handicap and total tickets", () => {
    const secondHalf = { ...event, mls: [
      { mi: 30, bti: 1, gp: 3, il: false, ws: [
        { wsi: 301, si: 1, hdp: -0.75, dih: "+0.5/1", o: 0.78, ot: 1 },
        { wsi: 302, si: 2, hdp: -0.75, dih: "-0.5/1", o: -0.9, ot: 1 }
      ] },
      { mi: 31, bti: 2, gp: 3, il: false, ws: [
        { wsi: 311, si: 3, hdp: 1.25, dih: "1/1.5", o: 0.81, ot: 1 },
        { wsi: 312, si: 4, hdp: 1.25, dih: "1/1.5", o: -0.93, ot: 1 }
      ] }
    ] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [secondHalf] })[0]?.markets
      .map(({ marketId, marketType }) => ({ marketId, marketType }))).toEqual([
        { marketId: "30", marketType: "SH_AH" },
        { marketId: "31", marketType: "SH_TOTAL" }
      ]);
  });

  it("fails closed for an unproved game period or non-opposing first-half domain", () => {
    const wrongPeriod = { ...event, mls: [{
      mi: 30, bti: 1, gp: 4, ws: [
        { wsi: 301, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 302, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ]
    }] };
    const duplicateOutcome = { ...event, mls: [{
      mi: 31, bti: 1, gp: 2, ws: [
        { wsi: 311, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8 },
        { wsi: 312, si: 1, hdp: -0.5, dih: "-0.5", o: -0.9 }
      ]
    }] };

    expect(extractImFootballCatalog({ StatusCode: 100, sel: [wrongPeriod] })).toEqual([]);
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [duplicateOutcome] })).toEqual([]);
  });

  it("extracts live score and clock but rejects virtual, malformed and non-success envelopes", () => {
    const live = { ...event, eid: 20, isrbt: true, rbt: "2H 72:44", hs: 2, as: 1 };
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [live] })[0]).toMatchObject({
      eventId: "20", timeText: "2H 72'", scoreText: "2-1"
    });
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [{ ...event, iscyb: true }] })).toEqual([]);
    expect(extractImFootballCatalog({ StatusCode: 500, sel: [event] })).toEqual([]);
    expect(extractImFootballCatalog({ StatusCode: 100, sel: [{ ...event, htn: "" }] })).toEqual([]);
  });

  it("applies exact delta prices and retains an integer-line market for inventory", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    const updated = mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(updated[0]?.markets.find((item) => item.marketId === "10")?.selections
      .map((item) => item.priceText)).toEqual(["0.8", "-0.9"]);

    const withInteger = mergeImFootballDelta(updated, { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [
      { mi: 10, bti: 1, gp: 1, ws: [
        { wsi: 101, si: 1, hdp: -1, dih: "+1", o: 0.8, ot: 1 },
        { wsi: 102, si: 2, hdp: -1, dih: "-1", o: -0.9, ot: 1 }
      ] }
    ] }] });
    expect(withInteger).toHaveLength(1);
    expect(withInteger[0]?.markets.find((item) => item.marketId === "10"))
      .toEqual(expect.objectContaining({ marketType: "FT_AH" }));
  });

  it("keeps an existing event on metadata action 2 and deletes it only on action 1", () => {
    const initial = extractImFootballCatalog({ StatusCode: 100, sel: [event] });
    expect(mergeImFootballDelta(initial, { StatusCode: 100, dc: [{
      eid: 112516390, a: 2, v: { htn: "Monterrey Rayados", atn: "Nashville SC" }
    }] })).toEqual(initial);
    expect(mergeImFootballDelta(initial, { StatusCode: 100, dc: [{ eid: 112516390, a: 1, v: null }] }))
      .toEqual([]);
  });

  it("deduplicates an event crossing live and prematch snapshot groups", () => {
    const first = extractImFootballCatalog({ StatusCode: 100, sel: [event] })[0]!;
    const replacement = { ...first, markets: [{ ...first.markets[0]!, marketId: "another-market" }] };
    expect(mergeImFootballSnapshots([[first], [replacement]])).toEqual([{
      ...replacement,
      markets: [...first.markets, replacement.markets[0]]
    }]);
  });
});
