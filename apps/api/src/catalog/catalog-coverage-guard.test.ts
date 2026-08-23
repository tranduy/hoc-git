import { describe, expect, it } from "vitest";
import { CatalogCoverageGuard } from "./catalog-coverage-guard.js";

describe("CatalogCoverageGuard", () => {
  it("rejects a smaller non-authoritative candidate", () => {
    const guard = new CatalogCoverageGuard();
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);

    expect(guard.accept("SABA|FOOTBALL", { generation: "reset-1", authoritativeBaseline: true,
      providerEventIds: ids(293) })).toBe(true);
    expect(guard.accept("SABA|FOOTBALL", { generation: "reset-1", authoritativeBaseline: false,
      providerEventIds: ids(100) })).toBe(false);
  });

  it("lets a new authoritative generation remove old events exactly once", () => {
    const guard = new CatalogCoverageGuard();
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `event-${index}`);

    expect(guard.accept("catalog-source:SABA:FOOTBALL", { generation: "reset-1", authoritativeBaseline: true,
      providerEventIds: ids(10) })).toBe(true);
    expect(guard.accept("catalog-source:SABA:FOOTBALL", { generation: "reset-2", authoritativeBaseline: true,
      providerEventIds: ids(1) })).toBe(true);
    expect(guard.accept("catalog-source:SABA:FOOTBALL", { generation: "reset-2", authoritativeBaseline: true,
      providerEventIds: [] })).toBe(false);
  });

  it("forgets prior coverage on an explicit reset", () => {
    const guard = new CatalogCoverageGuard();
    const candidate = { generation: "reset-1", authoritativeBaseline: false,
      providerEventIds: ["event-1", "event-2"] } as const;
    expect(guard.accept("catalog-source:SABA:FOOTBALL", candidate)).toBe(true);
    guard.reset("catalog-source:SABA:FOOTBALL");
    expect(guard.accept("catalog-source:SABA:FOOTBALL", { ...candidate,
      providerEventIds: ["event-1"] })).toBe(true);
  });
});
