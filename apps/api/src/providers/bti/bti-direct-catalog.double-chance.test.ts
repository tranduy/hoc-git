import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractBtiCatalogRecords, extractBtiNativeMarketObservations } from "./bti-direct-catalog.js";

// Exact safe native fields from the archived 2026-09-08 BTI detail response.
const fixture = (): { data: unknown[][] } => JSON.parse(readFileSync(new URL(
  "./fixtures/bti-native-double-chance-2026-09-08.json", import.meta.url), "utf8"));
const markets = (input: ReturnType<typeof fixture>) => input.data[0]![20] as unknown[][];
const native = (input: ReturnType<typeof fixture>, code: string) =>
  markets(input).find(value => (value[5] as unknown[])[0] === code)!;
const selections = (market: unknown[]) => market[13] as unknown[][];

describe("BTI proven result selections", () => {
  it.each([
    ["QA61", "FT_DOUBLE_CHANCE", "FULL_TIME"],
    ["QA145", "FH_DOUBLE_CHANCE", "FIRST_HALF"],
    ["QA4261", "SH_DOUBLE_CHANCE", "SECOND_HALF"]
  ])("maps %s by native outcome identity regardless of array order", (code, type, scope) => {
    const input = fixture();
    const source = native(input, code);
    source[13] = [...selections(source)].reverse();
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
    expect(result).toMatchObject({ marketType: type, lineText: null });
    expect(result?.selections.map(value => [value.selectionId, value.selection, value.priceText])).toEqual([
      [`${source[0]}Q6Q0`, "HOME_DRAW", (selections(source).find(value => value[9] === 1)![8] as string[])[5]],
      [`${source[0]}Q8Q0`, "HOME_AWAY", (selections(source).find(value => value[9] === 2)![8] as string[])[5]],
      [`${source[0]}Q7Q0`, "DRAW_AWAY", (selections(source).find(value => value[9] === 3)![8] as string[])[5]]
    ]);
    expect(extractBtiNativeMarketObservations(input, 123)).toContainEqual(expect.objectContaining({
      providerMarketId: source[0], disposition: "NORMALIZED", nativeScope: scope,
      nativeSelections: expect.arrayContaining([expect.objectContaining({ rawFormat: "MALAY" })])
    }));
  });

  it("retains a proven DC leg when the other quotes are absent or unusable", () => {
    const input = fixture();
    const source = native(input, "QA61");
    source[13] = selections(source).filter(value => value[9] !== 2);
    const home = selections(source).find(value => value[9] === 1)!;
    (home[8] as string[])[5] = "0.00";
    const away = selections(source).find(value => value[9] === 3)!;
    away[5] = true;
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
    expect(result?.selections).toEqual([{ selectionId: away[0], selection: "DRAW_AWAY",
      priceText: "0.96", locked: true }]);
    const inventory = extractBtiNativeMarketObservations(input, 123).filter(value => value.nativeType === "QA61");
    expect(inventory).toHaveLength(2);
    expect(inventory.find(value => value.disposition === "EXCLUDED")?.nativeSelections)
      .toEqual([expect.objectContaining({ selectionId: home[0], price: "0.00" })]);
  });

  it.each(["native suffix", "outcome code", "team label"])("retains contradictory %s as raw evidence", failure => {
    const input = fixture();
    const source = native(input, "QA61");
    const item = selections(source).find(value => value[9] === 1)!;
    if (failure === "native suffix") item[0] = `${source[0]}Q99Q0`;
    if (failure === "outcome code") item[9] = 99;
    if (failure === "team label") item[2] = { EN: "Another team or Tie" };
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
    expect(result?.selections.some(value => value.selection === "HOME_DRAW")).toBe(false);
    expect(result?.selections).toHaveLength(2);
    expect(extractBtiNativeMarketObservations(input, 123)).toContainEqual(expect.objectContaining({
      nativeType: "QA61", disposition: "EXCLUDED", nativeSelections: [expect.objectContaining({ selectionId: item[0] })]
    }));
  });

  it("rejects duplicate native DC identities without inventing missing outcomes", () => {
    const input = fixture();
    const source = native(input, "QA61");
    source[13] = [selections(source)[0], selections(source)[0]];
    expect(extractBtiCatalogRecords(input)[0]!.markets.some(value => value.marketId === source[0])).toBe(false);
    expect(extractBtiNativeMarketObservations(input, 123)).toContainEqual(expect.objectContaining({
      nativeType: "QA61", disposition: "EXCLUDED", reason: "INVALID_RESULT_SHAPE", nativeSelections: expect.any(Array)
    }));
  });

  it("keeps second-half 1X2 and independently proven partial result prices", () => {
    const input = fixture();
    const source = native(input, "ML2");
    source[13] = selections(source).filter(value => value[9] !== 2);
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
    expect(result).toMatchObject({ marketType: "SH_1X2", lineText: null });
    expect(result?.selections.map(value => value.selection)).toEqual(["HOME", "AWAY"]);
  });

  it("maps named first-half clean sheets to the opponent's zero-goal total", () => {
    const input = fixture();
    const found = markets(input).filter(value => (value[5] as string[])[0] === "QA4273");
    expect(found).toHaveLength(2);
    for (const source of found) {
      const awayCleanSheet = String(source[1]).startsWith("RB Leipzig:");
      const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
      expect(result).toMatchObject({ marketType: awayCleanSheet ? "HOME_FH_TOTAL" : "AWAY_FH_TOTAL", lineText: "0.5" });
      expect(result?.selections.map(value => value.selection)).toEqual(["UNDER", "OVER"]);
      expect(result?.selections.map(value => value.selectionId)).toEqual(selections(source).map(value => value[0]));
    }
  });

  it("preserves both teams scoring in both halves as its own YES/NO contract", () => {
    const input = fixture();
    const source = native(input, "QA1334");
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
    expect(result).toMatchObject({ marketType: "FT_BOTH_TEAMS_SCORE_BOTH_HALVES", lineText: null });
    expect(result?.selections.map(value => value.selection)).toEqual(["YES", "NO"]);
  });

  it("keeps a proven binary YES selection without inventing a missing NO", () => {
    const input = fixture();
    const source = native(input, "QA1334");
    source[13] = selections(source).slice(0, 1);
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === source[0]);
    expect(result?.selections).toEqual([{ selectionId: selections(source)[0]![0], selection: "YES",
      priceText: "-0.132", locked: false }]);
    expect(extractBtiNativeMarketObservations(input, 123).filter(value => value.nativeType === "QA1334"))
      .toEqual([expect.objectContaining({ disposition: "NORMALIZED", nativeSelections: [expect.any(Object)] })]);
  });

  it("keeps a proven total selection without requiring the provider to publish the opposite price", () => {
    const input = fixture();
    const source = native(input, "OU0");
    source[13] = [selections(source).find(value => value[13] !== true && Number((value[8] as string[])[5]) !== 0)!];
    const item = selections(source)[0]!;
    const result = extractBtiCatalogRecords(input)[0]!.markets.find(value => value.marketId === `${source[0]}:${item[16]}`);
    expect(result?.selections).toHaveLength(1);
    expect(result?.selections[0]?.selectionId).toBe(item[0]);
    expect(extractBtiNativeMarketObservations(input, 123).filter(value => value.nativeType === "OU0"))
      .toEqual([expect.objectContaining({ disposition: "NORMALIZED", nativeSelections: [expect.any(Object)] })]);
  });

  it("retains observed native statuses so future replay never invents OPEN", () => {
    const input = fixture();
    const source = native(input, "QA61");
    selections(source)[0]![5] = true;
    selections(source)[1]![13] = true;
    const observations = extractBtiNativeMarketObservations(input, 123).filter(value => value.nativeType === "QA61");
    expect(observations.every(value => value.status === "OPEN")).toBe(true);
    const retained = observations.flatMap(value => value.nativeSelections ?? []);
    expect(retained.find(value => value.selectionId === selections(source)[0]![0])?.status).toBe("SUSPENDED");
    expect(retained.find(value => value.selectionId === selections(source)[1]![0])?.status).toBe("CLOSED");
    expect(retained.find(value => value.selectionId === selections(source)[2]![0])?.status).toBe("OPEN");
  });
});
