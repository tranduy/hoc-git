import { describe, expect, it } from "vitest";
import type { ProviderId, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { ComparisonCell, ComparisonEvent, ComparisonRow } from "./comparison.js";
import { selectComparisonProviders, summarizeComparisonCounts } from "./comparison-counts.js";

const providers: readonly ProviderId[] = ["BTI", "CMD", "IM", "SABA", "SBOBET", "APSPORT"];

function cell(provider: ProviderId, eventId = "fixture", line = "2.5"): ComparisonCell {
  const market: ProviderMarket = {
    provider, category: "FOOTBALL", providerEventId: eventId,
    providerMarketId: `${eventId}-total-${line}`, marketType: "FT_TOTAL", scope: "FULL_TIME",
    line, settlementProfile: "football-regulation-including-added-time", status: "OPEN"
  };
  const quotes: ProviderQuote[] = (["OVER", "UNDER"] as const).map((selection) => ({
    provider, category: "FOOTBALL", providerEventId: eventId,
    providerMarketId: market.providerMarketId, providerSelectionId: `${market.providerMarketId}-${selection}`,
    marketType: "FT_TOTAL", scope: "FULL_TIME", selection, line, rawOdds: "1.95", rawFormat: "DECIMAL",
    status: "OPEN", isLive: false, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { provider, market, quotes };
}

function row(cells: readonly ComparisonCell[], line = "2.5"): ComparisonRow {
  return {
    key: `FT_TOTAL|FULL_TIME|${line}`, marketType: "FT_TOTAL", scope: "FULL_TIME", line, cells,
    bestBySelection: { OVER: "BTI", UNDER: "BTI" }, margin: -0.025, crossBook: false
  };
}

function event(key: string, rows: readonly ComparisonRow[]): Pick<ComparisonEvent, "key" | "rows"> {
  return { key, rows };
}

describe("summarizeComparisonCounts", () => {
  it("counts and retains only actual opposing routes among the checked providers", () => {
    const cells = providers.map(provider => cell(provider));
    const comparison = { ...event("fixture", [row(cells)]), providers,
      catalogs: [], providerEventIds: Object.fromEntries(providers.map(provider => [provider, "fixture"])),
      observedRows: [], event: {}, bestMargin: 0 } as unknown as ComparisonEvent;
    const selected = selectComparisonProviders(comparison, new Set(["CMD", "APSPORT", "BTI"]));
    expect(selected.providers).toEqual(["BTI", "CMD", "APSPORT"]);
    expect(selected.rows[0]!.cells.map(value => value.provider)).toEqual(["BTI", "CMD", "APSPORT"]);
    expect(summarizeComparisonCounts([selected])).toEqual({ matchedContractCount: 1,
      crossBookPairCount: 3, matchedSourceMarketCount: 3 });
    expect(summarizeComparisonCounts([comparison]).crossBookPairCount).toBe(15);
    expect(selectComparisonProviders(comparison, new Set(["CMD"])).rows).toEqual([]);
  });

  it("does not retain two selected providers that only offer the same outcome", () => {
    const over = (provider: ProviderId) => ({ ...cell(provider), quotes: cell(provider).quotes.slice(0, 1) });
    const comparison = { ...event("fixture", [row([over("CMD"), over("BTI"), cell("SABA")])]),
      providers: ["CMD", "BTI", "SABA"], catalogs: [], providerEventIds: {}, observedRows: [],
      event: {}, bestMargin: null } as unknown as ComparisonEvent;
    expect(selectComparisonProviders(comparison, new Set(["CMD", "BTI"])).rows).toEqual([]);
  });

  it("counts all fifteen bookmaker pairs for one six-book contract without requiring profit or split best prices", () => {
    const comparison = event("fixture", [row(providers.map((provider) => cell(provider)))]);

    expect(summarizeComparisonCounts([comparison])).toEqual({
      matchedContractCount: 1, matchedSourceMarketCount: 6, crossBookPairCount: 15
    });
  });

  it("adds pairs across contracts and distinguishes the same contract key on different fixtures", () => {
    const first = event("first", [
      row([cell("BTI", "first"), cell("CMD", "first")]),
      row([cell("BTI", "first", "3.5"), cell("CMD", "first", "3.5"), cell("SABA", "first", "3.5")], "3.5")
    ]);
    const second = event("second", [row([cell("IM", "second"), cell("SBOBET", "second")])]);

    expect(summarizeComparisonCounts([first, second])).toEqual({
      matchedContractCount: 3, matchedSourceMarketCount: 7, crossBookPairCount: 5
    });
  });

  it("does not inflate counts for duplicate events, rows, or provider cells", () => {
    const bti = cell("BTI");
    const cmd = cell("CMD");
    const comparison = event("fixture", [row([bti, bti, cmd, cmd]), row([bti, cmd])]);

    expect(summarizeComparisonCounts([comparison, comparison])).toEqual({
      matchedContractCount: 1, matchedSourceMarketCount: 2, crossBookPairCount: 1
    });
  });

  it("keeps independently matched source groups separate when their display and contract keys collide", () => {
    const first = event("shared-display-key", [row([cell("BTI", "league-fixture"), cell("CMD", "league-fixture")])]);
    const second = event("shared-display-key", [row([cell("IM", "cup-fixture"), cell("SABA", "cup-fixture")])]);

    expect(summarizeComparisonCounts([first, second])).toEqual({
      matchedContractCount: 2, matchedSourceMarketCount: 4, crossBookPairCount: 2
    });
    const repeated = event("shared-display-key", [row([...second.rows[0]!.cells].reverse())]);
    expect(summarizeComparisonCounts([first, second, repeated])).toEqual({
      matchedContractCount: 2, matchedSourceMarketCount: 4, crossBookPairCount: 2
    });
  });

  it("ignores empty, one-provider, and observed-only rows", () => {
    const bti = cell("BTI");
    const comparison = {
      ...event("fixture", [row([]), row([bti, bti], "3.5")]),
      observedRows: [{ ...row(providers.map((provider) => cell(provider))),
        settlementProfile: "football-regulation-including-added-time", outcomeDomain: ["OVER", "UNDER"] }]
    };

    expect(summarizeComparisonCounts([comparison])).toEqual({
      matchedContractCount: 0, matchedSourceMarketCount: 0, crossBookPairCount: 0
    });
    expect(summarizeComparisonCounts([])).toEqual({
      matchedContractCount: 0, matchedSourceMarketCount: 0, crossBookPairCount: 0
    });
  });

  it("keeps native source identities consistent when comparison orientation changes", () => {
    const native = cell("BTI", "native-bti");
    const oriented: ComparisonCell = {
      ...native,
      market: { ...native.market, providerEventId: "canonical-fixture", providerMarketId: "oriented-market" },
      sourceMarket: native.market,
      sourceQuotes: native.quotes
    };
    const cmd = cell("CMD", "native-cmd");
    const first = event("fixture", [row([oriented, cmd])]);
    const duplicate = event("fixture", [row([native, cmd])]);

    expect(summarizeComparisonCounts([first, duplicate])).toEqual({
      matchedContractCount: 1, matchedSourceMarketCount: 2, crossBookPairCount: 1
    });
    // A source repeated in another comparison is still one native source market.
    const another = event("other-comparison", [row([native, cell("SABA", "native-saba")])]);
    expect(summarizeComparisonCounts([first, another])).toEqual({
      matchedContractCount: 2, matchedSourceMarketCount: 3, crossBookPairCount: 2
    });
  });

  it("qualifies reused native market IDs by provider and native event", () => {
    const first = event("first", [row([cell("BTI", "first"), cell("CMD", "first")]
      .map((value) => ({ ...value, market: { ...value.market, providerMarketId: "same-id" } })))]);
    const second = event("second", [row([cell("BTI", "second"), cell("CMD", "second")]
      .map((value) => ({ ...value, market: { ...value.market, providerMarketId: "same-id" } })))]);

    expect(summarizeComparisonCounts([first, second])).toEqual({
      matchedContractCount: 2, matchedSourceMarketCount: 4, crossBookPairCount: 2
    });
  });
});
