import { describe, expect, it } from "vitest";
import { normalizeSbobetCatalog } from "@tool-chenh/adapters";
import { extractTsportFootballRecord, observeTsportNativeMarkets } from "./tsport-ws-adapter.js";

const event = (groups: readonly unknown[]) => ({ "2": 5691699, "5": "Home", "22": "Away", "53": "League",
  "6": false, "10": "Active", "11": "2026-09-11T18:00:00Z", "50": groups });
const normalize = (raw: ReturnType<typeof event>) => normalizeSbobetCatalog([extractTsportFootballRecord(raw)!],
  { provider: "APSPORT", observedAtMs: 1, receivedMonotonicMs: 1, sequence: 1 });

describe("APSPORT native contract identity and outcome retention", () => {
  // The saved 2026-09-09 catalog contains these exact native IDs, prices and lines.
  // Reconstruct only the adapter fields needed to reproduce the cross-group collision.
  const collisionGroups = [
    { "3": 6, "10": "Active", "9": [{ "6": "184675829611075", "7": "-0.75",
      "0": "56916990060009975h", "2": "56916990060009975a", "8": { "2": "0.46" }, "9": { "2": "-0.53" } }] },
    { "3": 61, "10": "Active", "9": [{ "6": "184675829611075", "7": "7.5",
      "0": "56916990610007005h", "2": "56916990610007005a",
      "8": { "0": "1.8866596296296294" }, "9": { "0": "1.818154814814815" } }] }
  ];

  it("keeps colliding native offer IDs as two independent contracts and stable inventory identities", () => {
    const raw = event(collisionGroups);
    const result = normalize(raw);
    const ids = result.markets.map((market) => market.providerMarketId);
    expect(new Set(ids).size).toBe(2);
    expect(result.markets.map((market) => [market.marketType, market.line])).toEqual([
      ["FH_AH", "-0.75"], ["HOME_CORNER_FT_TOTAL", "7.5"]
    ]);
    for (const id of ids) expect(result.quotes.filter((quote) => quote.providerMarketId === id)).toHaveLength(2);
    expect(normalize(event([...collisionGroups].reverse())).markets.map((market) => market.providerMarketId).sort()).toEqual([...ids].sort());
    expect(observeTsportNativeMarkets(raw, 1).map((market) => market.providerMarketId)).toEqual(ids);
  });

  // Exact native three-way row from apsport-live-evidence-frames.json.
  const winner = { "0": "56823680010000000h", "2": "56823680010000000a", "3": "56823680010000000d",
    "6": "19851504411000", "7": "0.0", "8": { "0": "4.4195932203389825" },
    "9": { "0": "5.801891525423729" }, "10": { "0": "1.2798013559322032" } };
  it.each([1, 2])("normalizes native group %s as a complete three-way winner market", (group) => {
    const raw = event([{ "3": group, "10": "Active", "9": [winner] }]);
    const result = normalize(raw);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: group === 1 ? "FT_1X2" : "FH_1X2",
      scope: group === 1 ? "FULL_TIME" : "FIRST_HALF", line: null })]);
    expect(result.quotes.map((quote) => [quote.selection, quote.rawOdds, quote.rawFormat])).toEqual([
      ["HOME", "4.4195932203389825", "DECIMAL"], ["AWAY", "5.801891525423729", "DECIMAL"],
      ["DRAW", "1.2798013559322032", "DECIMAL"]
    ]);
    expect(observeTsportNativeMarkets(raw, 1)[0]).toMatchObject({ disposition: "NORMALIZED",
      outcomeLabels: ["HOME", "AWAY", "DRAW"], nativeScope: group === 1 ? "FULL_TIME" : "FIRST_HALF" });
    expect(normalize({ ...raw, "10": "Suspended" }).quotes.every((quote) => quote.status === "SUSPENDED")).toBe(true);
  });

  it("retains proven winner legs without manufacturing the missing draw", () => {
    const result = normalize(event([{ "3": 1, "10": "Active", "9": [{ ...winner, "3": undefined }] }]));
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_1X2",
      providerMarketId: "tsport:1:19851504411000", line: null })]);
    expect(result.quotes.map(({ providerSelectionId, selection, rawOdds, rawFormat }) =>
      [providerSelectionId, selection, rawOdds, rawFormat])).toEqual([
      [winner["0"], "HOME", winner["8"]["0"], "DECIMAL"],
      [winner["2"], "AWAY", winner["9"]["0"], "DECIMAL"]
    ]);
  });

  it("rejects duplicate native winner selection IDs", () => {
    const result = normalize(event([{ "3": 1, "10": "Active", "9": [{ ...winner, "3": winner["0"] }] }]));
    expect(result.markets).toEqual([]);
    expect(result.quotes).toEqual([]);
  });

  it("maps a native nil-nil score to under 0.5 while retaining its exact original quote", () => {
    const raw = event([{ "3": 10, "10": "Active", "9": [{ "0": "56484400100000000h", "6": "733990848451000",
      "7": "0:0", "8": { "0": "3.760810751951861" } }] }]);
    expect(normalize(raw).markets).toEqual([expect.objectContaining({ marketType: "FT_TOTAL", line: "0.5" })]);
    expect(observeTsportNativeMarkets(raw, 1)[0]).toMatchObject({ disposition: "NORMALIZED",
      reason: "FT_TOTAL",
      nativeLabel: "CORRECT_SCORE", nativeScope: "FULL_TIME", nativeSelections: [{ selectionId: "56484400100000000h",
        outcomeId: "0", line: "0:0", price: "3.760810751951861", rawFormat: "DECIMAL" }] });
  });
});
