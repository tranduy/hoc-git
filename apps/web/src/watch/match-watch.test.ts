import type { ProviderEvent, ProviderMarket, ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { LiveCatalogResponse } from "../api/catalog.js";
import { boundWatchEntries, diffMatchSamples, sampleMatch } from "./match-watch.js";

const event: ProviderEvent = {
  provider: "CMD", category: "FOOTBALL", providerEventId: "event-1", competition: "Premier Test",
  seasonStage: null, startAtUtcMs: 1_800_000_000_000, participantA: "Alpha", participantB: "Beta",
  eventScope: "REGULATION", bestOf: null, isLive: true, rematchCandidate: false,
  fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL",
  liveState: { period: "1H", scoreHome: 0, scoreAway: 0, clockMs: 120_000 }
};
const market: ProviderMarket = {
  provider: "CMD", category: "FOOTBALL", providerEventId: event.providerEventId,
  providerMarketId: "market-1", marketType: "FT_1X2", scope: "FULL_TIME", line: null,
  settlementProfile: "football-regulation-including-added-time", status: "OPEN"
};
const quote = (selection: string, rawOdds: string, status: "OPEN" | "SUSPENDED" = "OPEN"): ProviderQuote => ({
  provider: "CMD", category: "FOOTBALL", providerEventId: event.providerEventId,
  providerMarketId: market.providerMarketId, providerSelectionId: `selection-${selection.toLowerCase()}`,
  marketType: "FT_1X2", scope: "FULL_TIME", selection, line: null, rawOdds, rawFormat: "DECIMAL",
  status, isLive: true, sourceTimestampMs: null, receivedMonotonicMs: 100, sequence: 1
});

function catalog(input: {
  readonly observedAtMs: number;
  readonly events?: readonly ProviderEvent[];
  readonly markets?: readonly ProviderMarket[];
  readonly quotes?: readonly ProviderQuote[];
}): LiveCatalogResponse {
  return {
    dataMode: "LIVE", accountId: "private-account-id", provider: "CMD", category: "FOOTBALL",
    comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: input.observedAtMs,
    rejectedMarketCount: 0, events: input.events ?? [event], markets: input.markets ?? [market],
    quotes: input.quotes ?? [quote("HOME", "2.1"), quote("DRAW", "3.2"), quote("AWAY", "3.4")]
  };
}

describe("single-match sample diff", () => {
  it("logs exact odds movement with safe public evidence and ignores unchanged selections", () => {
    const previous = sampleMatch(catalog({ observedAtMs: 1_000 }), event.providerEventId);
    const current = sampleMatch(catalog({
      observedAtMs: 2_250,
      quotes: [quote("HOME", "2.05"), quote("DRAW", "3.2"), quote("AWAY", "3.4")]
    }), event.providerEventId);

    expect(diffMatchSamples(previous, current, 2_300)).toEqual([expect.objectContaining({
      kind: "ODDS_CHANGED", provider: "CMD", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-home", competition: "Premier Test", matchLabel: "Alpha vs Beta",
      marketType: "FT_1X2", scope: "FULL_TIME", line: null, selection: "HOME",
      previousValue: "2.1 DECIMAL", currentValue: "2.05 DECIMAL", detectedAtMs: 2_300,
      providerObservedAtMs: 2_250, sampleIntervalMs: 1_250
    })]);
    expect(JSON.stringify(diffMatchSamples(previous, current, 2_300))).not.toContain("private-account-id");
  });

  it("logs market and quote suspension and reopening", () => {
    const open = sampleMatch(catalog({ observedAtMs: 1_000 }), event.providerEventId);
    const suspended = sampleMatch(catalog({
      observedAtMs: 2_000,
      markets: [{ ...market, status: "SUSPENDED" }],
      quotes: [quote("HOME", "2.1", "SUSPENDED"), quote("DRAW", "3.2"), quote("AWAY", "3.4")]
    }), event.providerEventId);
    const reopened = sampleMatch(catalog({ observedAtMs: 3_000 }), event.providerEventId);

    expect(diffMatchSamples(open, suspended, 2_010).map((entry) => entry.kind)).toEqual([
      "MARKET_SUSPENDED", "QUOTE_SUSPENDED"
    ]);
    expect(diffMatchSamples(suspended, reopened, 3_010).map((entry) => entry.kind)).toEqual([
      "MARKET_REOPENED", "QUOTE_REOPENED"
    ]);
  });

  it("logs a missing selected event but ignores unrelated event movement", () => {
    const previous = sampleMatch(catalog({ observedAtMs: 1_000 }), event.providerEventId);
    const missing = sampleMatch(catalog({ observedAtMs: 2_000, events: [], markets: [], quotes: [] }), event.providerEventId);

    expect(diffMatchSamples(previous, missing, 2_010)).toEqual([expect.objectContaining({
      kind: "EVENT_MISSING", matchLabel: "Alpha vs Beta"
    })]);
    expect(sampleMatch(catalog({ observedAtMs: 2_000 }), "unrelated-event").event).toBeNull();
  });

  it("keeps only the newest bounded entries", () => {
    const entries = Array.from({ length: 205 }, (_, index) => ({
      ...diffMatchSamples(
        sampleMatch(catalog({ observedAtMs: index }), event.providerEventId),
        sampleMatch(catalog({ observedAtMs: index + 1, quotes: [quote("HOME", `${2 + index / 100}`)] }), event.providerEventId),
        index + 1
      )[0]!,
      id: `entry-${index}`,
      detectedAtMs: index
    }));
    expect(boundWatchEntries(entries).map((entry) => entry.id)).toEqual(
      Array.from({ length: 200 }, (_, index) => `entry-${index + 5}`)
    );
  });
});
