import { describe, expect, it } from "vitest";
import { CatalogCoverageGuard } from "./catalog-coverage-guard.js";

describe("CatalogCoverageGuard", () => {
  it("rejects oscillating partial snapshots but accepts a stable smaller catalog", () => {
    const guard = new CatalogCoverageGuard();
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);

    expect(guard.accept("SABA|FOOTBALL", ids(293))).toBe(true);
    expect(guard.accept("SABA|FOOTBALL", ids(100))).toBe(false);
    expect(guard.accept("SABA|FOOTBALL", ids(70))).toBe(false);
    expect(guard.accept("SABA|FOOTBALL", ids(100))).toBe(false);
    expect(guard.accept("SABA|FOOTBALL", ids(293))).toBe(true);

    expect(guard.accept("SABA|FOOTBALL", ids(70))).toBe(false);
    expect(guard.accept("SABA|FOOTBALL", ids(70))).toBe(false);
    expect(guard.accept("SABA|FOOTBALL", ids(70))).toBe(true);
  });
});
