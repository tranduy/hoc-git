import { describe, expect, it, vi } from "vitest";
import { retrySbobetCatalogAfterReload } from "./sbobet-browser-manager.js";

describe("retrySbobetCatalogAfterReload", () => {
  it("reloads the authenticated provider page instead of reopening a one-time launch URL", async () => {
    const reload = vi.fn(async () => null);
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("SBOBET_DIRECT_CATALOG_UNAVAILABLE"))
      .mockResolvedValueOnce("fresh-catalog");

    await expect(retrySbobetCatalogAfterReload({ reload }, read)).resolves.toBe("fresh-catalog");
    expect(reload).toHaveBeenCalledWith({ waitUntil: "domcontentloaded", timeout: 30_000 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not reload when the captured direct catalog is already available", async () => {
    const reload = vi.fn(async () => null);
    const read = vi.fn(async () => "catalog");

    await expect(retrySbobetCatalogAfterReload({ reload }, read)).resolves.toBe("catalog");
    expect(reload).not.toHaveBeenCalled();
  });
});
