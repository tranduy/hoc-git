import { describe, expect, it } from "vitest";
import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { buildComparisonEvents } from "./comparison.js";

const event = (provider: "CMD" | "BTI", id: string): ProviderEvent => ({
  provider, category: "FOOTBALL", providerEventId: id, competition: "La Liga",
  seasonStage: null, startAtUtcMs: Date.UTC(2026, 8, 16), participantA: "Deportivo Alaves",
  participantB: "Valencia CF", eventScope: "REGULATION", bestOf: null, isLive: false,
  rematchCandidate: false, fixtureDiscriminator: null, isVirtual: false,
  sportVariant: "FOOTBALL", liveState: null
});

/** One book, one fixture, several total markets, each at its own sequence. */
const catalog = (provider: "CMD" | "BTI", id: string,
  markets: readonly { suffix: string; over: string; under?: string; sequence: number }[]): LiveCatalogResponse => {
  const providerMarkets: ProviderMarket[] = [];
  const quotes: ProviderQuote[] = [];
  for (const entry of markets) {
    const providerMarketId = `${id}-${entry.suffix}`;
    providerMarkets.push({ provider, category: "FOOTBALL", providerEventId: id, providerMarketId,
      marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5",
      settlementProfile: "football-regulation-including-added-time", status: "OPEN" });
    const base = { provider, category: "FOOTBALL" as const, providerEventId: id, providerMarketId,
      marketType: "FT_TOTAL" as const, scope: "FULL_TIME" as const, line: "2.5",
      rawFormat: "DECIMAL" as const, status: "OPEN" as const, isLive: false,
      sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: entry.sequence };
    quotes.push({ ...base, providerSelectionId: `${providerMarketId}-OVER`, selection: "OVER", rawOdds: entry.over });
    if (entry.under !== undefined) {
      quotes.push({ ...base, providerSelectionId: `${providerMarketId}-UNDER`, selection: "UNDER", rawOdds: entry.under });
    }
  }
  return { dataMode: "LIVE", accountId: `${provider}-account`, provider, category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: 1, rejectedMarketCount: 0,
    events: [event(provider, id)], markets: providerMarkets, quotes };
};

const totalRow = (catalogs: readonly LiveCatalogResponse[]) =>
  buildComparisonEvents(catalogs)[0]?.rows.find((row) => row.marketType === "FT_TOTAL");

describe("a market the book stopped republishing", () => {
  it("does not price a row from a sequence its own book has left behind", () => {
    // Measured on the live board: BTI carried two FT_TOTAL 2.5 markets on one
    // fixture, one at sequence 308051 and one frozen at 83797. The frozen one
    // priced OVER at 2.2903 against the live 2.1628, and against CMD's UNDER
    // that showed +0.16% for forty minutes without moving. A real edge is taken
    // in seconds; this one was an old price wearing a current one's clothes.
    const live = catalog("BTI", "bti-1", [{ suffix: "live", over: "2.1628", under: "1.72", sequence: 308051 }]);
    const withStale: LiveCatalogResponse = {
      ...live,
      markets: [...live.markets, ...catalog("BTI", "bti-1",
        [{ suffix: "stale", over: "2.2903", sequence: 83797 }]).markets.slice(-1)],
      quotes: [...live.quotes, ...catalog("BTI", "bti-1",
        [{ suffix: "stale", over: "2.2903", sequence: 83797 }]).quotes.slice(-1)]
    };
    const cmd = catalog("CMD", "cmd-1", [{ suffix: "live", over: "2.1364", under: "1.78", sequence: 19964 }]);

    // Against the live BTI price alone the row is a loser, as it should be.
    const honest = totalRow([cmd, live]);
    expect(honest?.margin).not.toBeNull();
    expect(honest!.margin!).toBeLessThan(0);

    // Adding the abandoned market must not turn it into an edge.
    const withAbandoned = totalRow([cmd, withStale]);
    expect(withAbandoned?.margin).not.toBeNull();
    expect(withAbandoned!.margin!).toBeCloseTo(honest!.margin!, 12);
    expect(withAbandoned!.margin!).toBeLessThan(0);
  });

  it("keeps every market a book is still republishing at the same sequence", () => {
    // Several live markets on one fixture are ordinary: alternative lines all
    // arrive in the same snapshot. Only a market left behind is dropped.
    const bti = catalog("BTI", "bti-1", [
      { suffix: "a", over: "2.1628", under: "1.72", sequence: 308051 },
      { suffix: "b", over: "2.0000", under: "1.80", sequence: 308051 }
    ]);
    const cmd = catalog("CMD", "cmd-1", [{ suffix: "live", over: "2.1364", under: "1.78", sequence: 19964 }]);
    const row = totalRow([cmd, bti]);
    expect(row).toBeDefined();
    expect(new Set(row!.cells.map((cell) => cell.market.providerMarketId)).size).toBeGreaterThan(2);
  });
});
