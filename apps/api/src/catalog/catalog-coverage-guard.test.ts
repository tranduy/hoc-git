import { describe, expect, it } from "vitest";
import { CatalogCoverageGuard } from "./catalog-coverage-guard.js";

describe("CatalogCoverageGuard", () => {
  const candidate = (generation: string, authoritativeBaseline: boolean, providerEventIds: readonly string[]) =>
    ({ generation, authoritativeBaseline, providerEventIds });

  it("rejects a ten-to-nine identity shrink", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"]))).toBe(false);
  });

  it("rejects equal-count identity replacement", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["1", "2", "3"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false, ["4", "5", "6"]))).toBe(false);
  });

  it("does not permit incremental shrink across accepted candidates", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false,
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"]))).toBe(false);
    expect(guard.accept("source", candidate("A", false,
      ["1", "2", "3", "4", "5", "6", "7", "8"]))).toBe(false);
  });

  it("does not let a repeated authoritative generation shrink twice", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["1", "2", "3"]))).toBe(true);
    expect(guard.accept("source", candidate("A", true, ["1", "2"]))).toBe(false);
  });

  it("rejects replay of authoritative generation A after A to B", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["a1", "a2"]))).toBe(true);
    expect(guard.accept("source", candidate("B", true, ["b1"]))).toBe(true);
    expect(guard.accept("source", candidate("A", true, ["a1", "a2"]))).toBe(false);
  });

  it("rejects an old authoritative generation replay that is a superset of current coverage", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["a", "b"]))).toBe(true);
    expect(guard.accept("source", candidate("B", true, ["b"]))).toBe(true);
    expect(guard.accept("source", candidate("A", true, ["a", "b"]))).toBe(false);
  });

  it("accepts an incremental DELTA that preserves current coverage", () => {
    const guard = new CatalogCoverageGuard();
    expect(guard.accept("source", candidate("A", true, ["a"]))).toBe(true);
    expect(guard.accept("source", candidate("A", false, ["a", "b"]))).toBe(true);
  });

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
