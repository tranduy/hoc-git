import { describe, expect, it, vi } from "vitest";
import { MultiProviderCatalogReader } from "./multi-provider-catalog.js";

describe("MultiProviderCatalogReader", () => {
  it("routes an account to the reader matching its verified provider", async () => {
    const cmdRead = vi.fn(async () => { throw new Error("WRONG_READER"); });
    const sabaCatalog = { provider: "SABA", category: "FOOTBALL", accountId: "saba-1" };
    const sabaRead = vi.fn(async () => sabaCatalog);
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => ({ provider: "SABA", category: "FOOTBALL",
        sessionId: "session-saba", key: "SABA|FOOTBALL|session-saba" }) },
      readers: [
        { provider: "CMD", category: "FOOTBALL", reader: { provider: "CMD", read: cmdRead } },
        { provider: "SABA", category: "FOOTBALL", reader: { provider: "SABA", read: sabaRead } }
      ]
    } as never);

    await expect(reader.read("saba-1")).resolves.toBe(sabaCatalog);
    expect(cmdRead).not.toHaveBeenCalled();
    expect(sabaRead).toHaveBeenCalledWith("saba-1");
  });

  it("fails closed when no verified reader owns the account", async () => {
    const reader = new MultiProviderCatalogReader({
      sources: { resolveCatalogSource: async () => ({ provider: "SABA", category: "LOL",
        sessionId: "session-saba", key: "SABA|LOL|session-saba" }) },
      readers: [{ provider: "SABA", category: "FOOTBALL",
        reader: { provider: "SABA", read: async () => { throw new Error("WRONG_READER"); } } }]
    } as never);
    await expect(reader.read("unknown")).rejects.toThrow("CATALOG_UNAVAILABLE");
  });
});
