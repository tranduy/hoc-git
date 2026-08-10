import { describe, expect, it, vi } from "vitest";
import { MultiProviderCatalogReader } from "./multi-provider-catalog.js";

describe("MultiProviderCatalogReader", () => {
  it("routes an account to the reader matching its verified provider", async () => {
    const cmdRead = vi.fn(async () => { throw new Error("ACCOUNT_PROVIDER_MISMATCH"); });
    const sabaCatalog = { provider: "SABA", accountId: "saba-1" };
    const sabaRead = vi.fn(async () => sabaCatalog);
    const reader = new MultiProviderCatalogReader([
      { provider: "CMD", read: cmdRead },
      { provider: "SABA", read: sabaRead }
    ] as never);

    await expect(reader.read("saba-1")).resolves.toBe(sabaCatalog);
    expect(cmdRead).toHaveBeenCalledWith("saba-1");
    expect(sabaRead).toHaveBeenCalledWith("saba-1");
  });

  it("fails closed when no verified reader owns the account", async () => {
    const reader = new MultiProviderCatalogReader([
      { provider: "SABA", read: async () => { throw new Error("ACCOUNT_PROVIDER_MISMATCH"); } }
    ] as never);
    await expect(reader.read("unknown")).rejects.toThrow("CATALOG_UNAVAILABLE");
  });
});
