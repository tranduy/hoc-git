import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { NativeMarketObservationSchema } from "@tool-chenh/contracts";
import { extractBtiCatalogRecords, extractBtiNativeMarketObservations } from "./bti-direct-catalog.js";

const fixtureUrl = new URL("./fixtures/bti-native-binary-markets-2026-09-08.json", import.meta.url);
const payload = (): { data: unknown[][] } => JSON.parse(readFileSync(fixtureUrl, "utf8"));
const nativeMarkets = (input: ReturnType<typeof payload>): unknown[][] => input.data[0]![20] as unknown[][];
const nativeMarket = (input: ReturnType<typeof payload>, code: string): unknown[] =>
  nativeMarkets(input).find((market) => (market[5] as unknown[])[0] === code)!;
const values = (market: unknown[]): unknown[][] => market[13] as unknown[][];

describe("BTI captured native markets", () => {
  it("preserves the full H/D/A domain for captured full-time and first-half 1X2 prices", () => {
    const normalized = normalizeSbobetCatalog(extractBtiCatalogRecords(payload()), {
      observedAtMs: 1_788_860_177_471, receivedMonotonicMs: 100, sequence: 1, provider: "BTI"
    });
    expect(normalized.markets.filter(({ marketType }) => marketType.endsWith("_1X2")))
      .toEqual([
        expect.objectContaining({ providerMarketId: "0ML881536431317872640", marketType: "FT_1X2",
          scope: "FULL_TIME", line: null, settlementProfile: "football-regulation-including-added-time" }),
        expect.objectContaining({ providerMarketId: "0ML881536431317872643", marketType: "FH_1X2",
          scope: "FIRST_HALF", line: null, settlementProfile: "football-first-half-including-added-time" })
      ]);
    expect(normalized.quotes.filter(({ marketType }) => marketType.endsWith("_1X2"))
      .map(({ providerSelectionId, selection, rawOdds }) => [providerSelectionId, selection, rawOdds]))
      .toEqual([
        ["0ML881536431317872640H", "HOME", "0.84"],
        ["0ML881536431317872640D", "DRAW", "-0.337"],
        ["0ML881536431317872640A", "AWAY", "-0.344"],
        ["0ML881536431317872643H", "HOME", "-0.709"],
        ["0ML881536431317872643D", "DRAW", "-0.73"],
        ["0ML881536431317872643A", "AWAY", "-0.332"]
      ]);
    expect(extractBtiNativeMarketObservations(payload(), 100).filter(({ nativeType }) => /^ML[01]$/u.test(nativeType)))
      .toEqual([
        expect.objectContaining({ disposition: "NORMALIZED", nativeScope: "FULL_TIME", outcomeLabels: ["Como", "Hoà", "RB Leipzig"] }),
        expect.objectContaining({ disposition: "NORMALIZED", nativeScope: "FIRST_HALF", outcomeLabels: ["Como", "Hoà", "RB Leipzig"] })
      ]);
  });

  it.each(["missing draw", "duplicate side", "wrong home name", "wrong draw label"])(
    "preserves only individually proven result selections with %s", (failure) => {
      const input = payload();
      const target = nativeMarket(input, "ML0");
      const selections = values(target);
      if (failure === "missing draw") selections.shift();
      if (failure === "duplicate side") selections[0]![9] = 1;
      if (failure === "wrong home name") selections[1]![2] = "Unrelated team";
      if (failure === "wrong draw label") selections[0]![2] = "No goal";
      const result = extractBtiCatalogRecords(input)[0]!.markets.find(({ marketId }) => marketId === target[0]);
      if (failure === "duplicate side") {
        expect(result).toBeUndefined();
        expect(extractBtiNativeMarketObservations(input, 100).find(({ nativeType }) => nativeType === "ML0"))
          .toMatchObject({ disposition: "EXCLUDED", reason: "INVALID_RESULT_SHAPE" });
      } else {
        expect(result?.marketType).toBe("FT_1X2");
        expect(result?.selections.map(item => item.selection)).toEqual(
          failure === "wrong home name" ? ["DRAW", "AWAY"] : ["HOME", "AWAY"]);
      }
    }
  );

  it("normalizes captured both-halves predicates using their exact code thresholds and real selection prices", () => {
    const normalized = normalizeSbobetCatalog(extractBtiCatalogRecords(payload()), {
      observedAtMs: 1_788_860_177_471, receivedMonotonicMs: 100, sequence: 1, provider: "BTI"
    });
    expect(normalized.diagnostics).toEqual([]);
    expect(normalized.markets.filter((market) => market.marketType.startsWith("FT_BOTH_HALVES")))
      .toEqual([
        expect.objectContaining({ providerMarketId: "0QA881536431674462209", marketType: "FT_BOTH_HALVES_UNDER_TOTAL",
          scope: "FULL_TIME", line: "1.5", settlementProfile: "football-both-halves-under-total", status: "OPEN" }),
        expect.objectContaining({ providerMarketId: "0QA881536431674462292", marketType: "FT_BOTH_HALVES_OVER_TOTAL",
          scope: "FULL_TIME", line: "0.5", settlementProfile: "football-both-halves-over-total", status: "OPEN" }),
        expect.objectContaining({ providerMarketId: "0QA881536431674462293", marketType: "FT_BOTH_HALVES_OVER_TOTAL",
          scope: "FULL_TIME", line: "1.5", settlementProfile: "football-both-halves-over-total", status: "OPEN" })
      ]);
    expect(normalized.quotes.filter((quote) => quote.marketType.startsWith("FT_BOTH_HALVES"))
      .map(({ providerSelectionId, selection, rawOdds, rawFormat }) => [providerSelectionId, selection, rawOdds, rawFormat]))
      .toEqual([
        ["0QA881536431674462209Q0Q1", "YES", "-0.543", "MALAY"],
        ["0QA881536431674462209Q0Q0", "NO", "0.30", "MALAY"],
        ["0QA881536431674462292Q0Q1", "YES", "0.50", "MALAY"],
        ["0QA881536431674462292Q0Q0", "NO", "-0.758", "MALAY"],
        ["0QA881536431674462293Q0Q1", "YES", "-0.314", "MALAY"],
        ["0QA881536431674462293Q0Q0", "NO", "0.16", "MALAY"]
      ]);
    const observations = extractBtiNativeMarketObservations(payload(), 100)
      .filter((item) => ["QA5373", "QA5374", "QA6024"].includes(item.nativeType));
    expect(observations.map(({ disposition, outcomeLabels }) => [disposition, outcomeLabels]))
      .toEqual([["NORMALIZED", ["Có", "Không"]], ["NORMALIZED", ["Có", "Không"]], ["NORMALIZED", ["Có", "Không"]]]);
    expect(observations[0]!.nativeSelections).toEqual([
      expect.objectContaining({ selectionId: "0QA881536431674462209Q0Q1", outcomeId: "1", line: null, price: "-0.543", rawFormat: "MALAY" }),
      expect.objectContaining({ selectionId: "0QA881536431674462209Q0Q0", outcomeId: "3", line: null, price: "0.30", rawFormat: "MALAY" })
    ]);
  });

  it("maps Asian and first-half team totals by the named native participant and retains their actual lines", () => {
    const normalized = normalizeSbobetCatalog(extractBtiCatalogRecords(payload()), {
      observedAtMs: 1_788_860_177_471, receivedMonotonicMs: 100, sequence: 1, provider: "BTI"
    });
    expect(normalized.markets.filter(({ marketType }) => /^(?:HOME|AWAY)_(?:FT|FH)_TOTAL$/u.test(marketType))
      .map(({ providerMarketId, marketType, scope, line }) => [providerMarketId, marketType, scope, line]))
      .toEqual([
        ["0OU881536431317872683:0.5", "HOME_FH_TOTAL", "FIRST_HALF", "0.5"],
        ["0OU881536431317872683:1.5", "HOME_FH_TOTAL", "FIRST_HALF", "1.5"],
        ["0OU881536431317872684:0.5", "AWAY_FH_TOTAL", "FIRST_HALF", "0.5"],
        ["0OU881536431317872684:1.5", "AWAY_FH_TOTAL", "FIRST_HALF", "1.5"],
        ["0OU881536431556947979:1", "AWAY_FT_TOTAL", "FULL_TIME", "1"],
        ["0OU881536431556947978:1.5", "HOME_FT_TOTAL", "FULL_TIME", "1.5"]
      ]);
    expect(normalized.quotes.filter(({ providerMarketId }) => providerMarketId === "0OU881536431317872683:0.5")
      .map(({ providerSelectionId, selection, rawOdds }) => [providerSelectionId, selection, rawOdds]))
      .toEqual([["0OU881536431317872683OMM", "OVER", "0.75"], ["0OU881536431317872683UMM", "UNDER", "1.00"]]);
  });

  it("retains every captured unknown selection and original closed price without manufacturing executable quotes", () => {
    const input = payload();
    const observations = extractBtiNativeMarketObservations(input, 100);
    const correctScore = observations.find(({ nativeType }) => nativeType === "QA60")!;
    expect(correctScore).toMatchObject({ disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" });
    expect(correctScore.outcomeLabels).toHaveLength(121);
    expect(correctScore.outcomeLabels.at(-1)).toBe("10:10");
    expect(correctScore.nativeSelections).toHaveLength(121);
    expect(correctScore.nativeSelections?.[0]).toMatchObject({ selectionId: "0QA881536431317872662Q0Q0",
      outcomeId: "2", line: null, price: "-0.067", rawFormat: "MALAY" });
    expect(correctScore.nativeSelections?.at(-1)).toMatchObject({ selectionId: "0QA881536431317872662Q10Q10",
      outcomeId: "2", line: null, price: "0.00", rawFormat: "MALAY" });
    expect(extractBtiCatalogRecords(input)[0]!.markets.some(({ marketId }) => marketId.startsWith("0QA881536431317872662")))
      .toBe(false);
    expect(observations.every((item) => NativeMarketObservationSchema.safeParse(item).success)).toBe(true);
  });

  it.each(["third outcome", "duplicate yes", "missing selection id", "zero price", "contradictory line"])(
    "preserves valid fixed-line selections and raw rejected evidence with %s", (failure) => {
      const input = payload();
      const target = nativeMarket(input, "QA5373");
      const selections = values(target);
      if (failure === "third outcome") selections.push(structuredClone(selections[0]!));
      if (failure === "duplicate yes") selections[1]![2] = "Có";
      if (failure === "missing selection id") selections[1]![0] = null;
      if (failure === "zero price") (selections[1]![8] as unknown[])[5] = "0.00";
      if (failure === "contradictory line") selections[0]![16] = 1.5;
      const result = extractBtiCatalogRecords(input)[0]!.markets.find(({ marketId }) => marketId === target[0]);
      if (failure === "third outcome" || failure === "duplicate yes") {
        expect(result).toBeUndefined();
        expect(extractBtiNativeMarketObservations(input, 100).find(({ nativeType }) => nativeType === "QA5373"))
          .toMatchObject({ disposition: "EXCLUDED", reason: "INVALID_TWO_WAY_SHAPE" });
      } else {
        expect(result?.selections.map(item => item.selection)).toEqual([failure === "contradictory line" ? "NO" : "YES"]);
        expect(extractBtiNativeMarketObservations(input, 100).filter(({ nativeType }) => nativeType === "QA5373")
          .map(value => value.disposition)).toEqual(["NORMALIZED", "EXCLUDED"]);
      }
    }
  );

  it("does not guess the participant of a team-total label that names neither roster team", () => {
    const input = payload();
    const target = nativeMarket(input, "OU6305");
    target[1] = "Unknown club: Asian team total goals";
    target[5] = ["OU6305", target[1]];
    expect(extractBtiCatalogRecords(input)[0]!.markets.some(({ marketId }) => marketId.startsWith(String(target[0])))).toBe(false);
    expect(extractBtiNativeMarketObservations(input, 100).find(({ nativeType }) => nativeType === "OU6305"))
      .toMatchObject({ disposition: "UNMAPPED" });
  });
});
