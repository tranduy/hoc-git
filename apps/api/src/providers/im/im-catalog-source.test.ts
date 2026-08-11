import { describe, expect, it } from "vitest";
import { extractImCatalogRecords } from "./im-catalog-source.js";

describe("extractImCatalogRecords", () => {
  it("extracts only typed market and selection evidence", () => {
    const body = { StatusCode: 0, Sport: [{ SportId: 45, SportName: "LOL", LG: [{ LGId: 7, LGName: "LPL",
      ParentMatch: [{ PMatchNo: 10, PHTId: 1, PHTName: "A", PATId: 2, PATName: "B", PMCDate: "date",
        Match: [{ MatchNo: 11, GTCode: "MW", GTName: "Winner", GTMarketGroup: "Series", GameOrder: 0,
          Status: 1, IsLive: false, MCDate: "date", Odds: [{ SEL: [
            { SCode: 1, SName: "A", Odds: 1.8, HDP: 0, IsLock: false },
            { SCode: 2, SName: "B", Odds: 2.1, HDP: 0, IsLock: false }
          ] }] }] }] }] }] };
    expect(extractImCatalogRecords(body)).toEqual([expect.objectContaining({
      sportId: 45, leagueName: "LPL", parentHomeName: "A", parentAwayName: "B",
      gameTypeName: "Winner", selections: [
        { code: 1, name: "A", odds: 1.8, handicap: 0, locked: false },
        { code: 2, name: "B", odds: 2.1, handicap: 0, locked: false }
      ]
    })]);
  });

  it("fails closed for an error response or malformed records", () => {
    expect(extractImCatalogRecords({ StatusCode: 1, Sport: [] })).toEqual([]);
    expect(extractImCatalogRecords({ StatusCode: 0, Sport: [{ SportId: "45", LG: [] }] })).toEqual([]);
  });
});
