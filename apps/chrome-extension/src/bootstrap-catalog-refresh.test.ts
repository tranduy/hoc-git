import { describe, expect, it } from "vitest";
import { bootstrapCatalogSources } from "./bootstrap-catalog-refresh.js";

describe("bootstrapCatalogSources", () => {
  it("asks only the books whose full list arrives once, at page bootstrap", () => {
    expect(bootstrapCatalogSources([
      { lobby: "SABA", tabId: 4 }, { lobby: "CMD", tabId: 5 },
      { lobby: "IM", tabId: 6 }, { lobby: "BTI", tabId: 7 }, { lobby: "TSPORT", tabId: 8 }
    ])).toEqual([
      { lobby: "SABA", tabId: 4, sourceId: "chrome:SABA:4" },
      { lobby: "IM", tabId: 6, sourceId: "chrome:IM:6" }
    ]);
  });

  it("asks a tab once however many times it is listed", () => {
    expect(bootstrapCatalogSources([{ lobby: "SABA", tabId: 4 }, { lobby: "SABA", tabId: 4 }]))
      .toEqual([{ lobby: "SABA", tabId: 4, sourceId: "chrome:SABA:4" }]);
  });

  it("asks nothing when no such book is attached", () => {
    expect(bootstrapCatalogSources([{ lobby: "CMD", tabId: 1 }])).toEqual([]);
    expect(bootstrapCatalogSources([])).toEqual([]);
  });
});
