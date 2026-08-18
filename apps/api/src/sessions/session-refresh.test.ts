import { describe, expect, it } from "vitest";
import { verifyRefreshedCatalogSources } from "./session-refresh.js";

const sources = [
  { id: "catalog-source:SABA:FOOTBALL", provider: "SABA", sessionState: "ACTIVE" },
  { id: "catalog-source:BTI:FOOTBALL", provider: "BTI", sessionState: "ACTION_REQUIRED" }
] as const;

describe("verifyRefreshedCatalogSources", () => {
  it("rejects maintenance when a provider session remains inactive", async () => {
    await expect(verifyRefreshedCatalogSources({
      listSources: async () => sources,
      readCatalog: async () => undefined
    })).rejects.toThrow("SESSION_REFRESH_INCOMPLETE:BTI:ACTION_REQUIRED");
  });

  it("rejects maintenance when an active session still cannot return a catalog", async () => {
    await expect(verifyRefreshedCatalogSources({
      listSources: async () => sources.map((source) => ({ ...source, sessionState: "ACTIVE" as const })),
      readCatalog: async (id) => {
        if (id.includes(":BTI:")) throw new Error("CATALOG_UNAVAILABLE");
      }
    })).rejects.toThrow("SESSION_READER_UNAVAILABLE:BTI");
  });
});
