import { describe, expect, it } from "vitest";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { reuseUnchangedRecords } from "./reuse-unchanged-records.js";

const quote = (selection: string, rawOdds: string) => ({ provider: "APSPORT", category: "FOOTBALL",
  providerEventId: "e1", providerMarketId: "m1", providerSelectionId: `s-${selection}`,
  marketType: "FT_TOTAL", scope: "FULL_TIME", selection, line: "2.5", rawOdds,
  rawFormat: "MALAY", status: "OPEN" });

const catalogOf = (quotes: readonly unknown[], observedAtMs = 100) => ({
  provider: "APSPORT", category: "FOOTBALL", accountId: "catalog-source:APSPORT:FOOTBALL",
  dataMode: "LIVE", comparisonState: "COMPARABLE", observedAtMs, rejectedMarketCount: 0,
  events: [{ provider: "APSPORT", providerEventId: "e1" }], markets: [], quotes
} as unknown as ObservedProviderCatalog);

describe("reuseUnchangedRecords", () => {
  it("puts the previous row object back when the new one says the same thing", () => {
    // Measured 2026-09-17: IM, SABA and APSPORT missed every record and every
    // block in the revision hasher, because their adapters rebuild each row
    // object per round and the caches are keyed by the object.
    const before = catalogOf([quote("OVER", "0.95"), quote("UNDER", "-0.98")]);
    const rebuilt = catalogOf([quote("OVER", "0.95"), quote("UNDER", "-0.98")], 101);

    const merged = reuseUnchangedRecords(before, rebuilt);

    expect(merged.quotes[0]).toBe(before.quotes[0]);
    expect(merged.quotes[1]).toBe(before.quotes[1]);
    expect(merged.observedAtMs).toBe(101);
  });

  it("keeps the new row whenever anything about it moved", () => {
    const before = catalogOf([quote("OVER", "0.95"), quote("UNDER", "-0.98")]);
    const moved = catalogOf([quote("OVER", "0.88"), quote("UNDER", "-0.98")], 101);

    const merged = reuseUnchangedRecords(before, moved);

    expect(merged.quotes[0]).toBe(moved.quotes[0]);
    expect(merged.quotes[0]).not.toBe(before.quotes[0]);
    expect(merged.quotes[1]).toBe(before.quotes[1]);
  });

  it("refuses a row carrying anything but primitives", () => {
    // A nested value cannot be compared with === , and calling it unchanged
    // would hold a revision still while the prices under it moved. That is the
    // one failure this must never cause, so it keeps the new row instead.
    const nested = (rawOdds: string) => ({ ...quote("OVER", rawOdds), player: { id: "p1" } });
    const before = catalogOf([nested("0.95")]);
    const rebuilt = catalogOf([nested("0.95")], 101);

    expect(reuseUnchangedRecords(before, rebuilt).quotes[0]).toBe(rebuilt.quotes[0]);
  });

  it("refuses a row that gained or lost a field", () => {
    const before = catalogOf([quote("OVER", "0.95")]);
    const { line: _line, ...withoutLine } = quote("OVER", "0.95");
    const rebuilt = catalogOf([withoutLine], 101);

    expect(reuseUnchangedRecords(before, rebuilt).quotes[0]).toBe(rebuilt.quotes[0]);
  });

  it("compares by position, so a reordered or resized list keeps its new rows", () => {
    const before = catalogOf([quote("OVER", "0.95"), quote("UNDER", "-0.98")]);
    const shifted = catalogOf([quote("UNDER", "-0.98"), quote("OVER", "0.95")], 101);

    const merged = reuseUnchangedRecords(before, shifted);

    expect(merged.quotes[0]).toBe(shifted.quotes[0]);
    expect(merged.quotes[1]).toBe(shifted.quotes[1]);
  });

  it("returns the catalog untouched when there is nothing to reuse", () => {
    const rebuilt = catalogOf([quote("OVER", "0.95")]);
    expect(reuseUnchangedRecords(undefined, rebuilt)).toBe(rebuilt);
    // Every row differs, the event row included, so nothing is swapped and the
    // caller keeps the exact object it passed in.
    const different = { ...catalogOf([quote("OVER", "0.10")]),
      events: [{ provider: "APSPORT", providerEventId: "e2" }] } as unknown as ObservedProviderCatalog;
    expect(reuseUnchangedRecords(different, rebuilt)).toBe(rebuilt);
  });

  it("never crosses accounts or providers", () => {
    const before = catalogOf([quote("OVER", "0.95")]);
    const other = { ...catalogOf([quote("OVER", "0.95")], 101),
      accountId: "catalog-source:SABA:FOOTBALL" } as ObservedProviderCatalog;

    expect(reuseUnchangedRecords(before, other)).toBe(other);
  });
});
