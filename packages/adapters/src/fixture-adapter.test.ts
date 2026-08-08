import { readFileSync } from "node:fs";
import type {
  ProviderConnectionStatus,
  ProviderEvent,
  ProviderMarket,
  ProviderQuote
} from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import {
  FixtureAdapter,
  type AdapterSchemaError,
  type FixtureSnapshot,
  type ReplayScheduler
} from "./fixture-adapter.js";
import type { ProviderSink } from "./provider-adapter.js";

class RecordingSink implements ProviderSink {
  readonly emissions: string[] = [];
  readonly events: ProviderEvent[] = [];
  readonly markets: ProviderMarket[] = [];
  readonly quotes: ProviderQuote[] = [];
  readonly statuses: ProviderConnectionStatus[] = [];
  readonly schemaErrors: AdapterSchemaError[] = [];

  onEvent(event: ProviderEvent): void {
    this.events.push(event);
    this.emissions.push(`EVENT:${event.providerEventId}`);
  }

  onMarket(market: ProviderMarket): void {
    this.markets.push(market);
    this.emissions.push(`MARKET:${market.providerMarketId}`);
  }

  onQuote(quote: ProviderQuote): void {
    this.quotes.push(quote);
    this.emissions.push(`QUOTE:${quote.providerSelectionId}`);
  }

  onStatus(status: ProviderConnectionStatus): void {
    this.statuses.push(status);
    this.emissions.push(`STATUS:${status.status}`);
  }

  onSchemaError(error: AdapterSchemaError): void {
    this.schemaErrors.push(error);
    this.emissions.push(`ERROR:${error.recordKind}`);
  }
}

class ImmediateScheduler implements ReplayScheduler {
  readonly waits: number[] = [];

  async wait(delayMs: number, _signal: AbortSignal): Promise<void> {
    this.waits.push(delayMs);
  }
}

const status = {
  provider: "SABA",
  category: "FOOTBALL",
  status: "LIVE",
  detail: "Synthetic fixture connected",
  updatedAtMs: 0
} as const;

const event = (providerEventId: string) => ({
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId,
  competition: "Premier League",
  seasonStage: "2026/27",
  startAtUtcMs: 1_786_305_600_000,
  participantA: "Northbridge FC",
  participantB: "Riverside United",
  eventScope: "REGULATION",
  bestOf: null,
  isLive: false
} as const);

const market = {
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "event-a",
  providerMarketId: "market-total",
  marketType: "FT_TOTAL",
  scope: "FULL_TIME",
  line: "2.5",
  settlementProfile: "football-regulation-including-added-time",
  status: "OPEN"
} as const;

const fixture = (records: FixtureSnapshot["records"]): FixtureSnapshot => ({
  version: 1,
  adapterId: "saba-football",
  provider: "SABA",
  category: "FOOTBALL",
  records
});

describe("FixtureAdapter", () => {
  it("replays records by stable offset order and applies replay speed", async () => {
    const scheduler = new ImmediateScheduler();
    const adapter = new FixtureAdapter(fixture([
      { offsetMs: 20, kind: "EVENT", payload: event("event-a") },
      { offsetMs: 0, kind: "STATUS", payload: status },
      { offsetMs: 20, kind: "EVENT", payload: event("event-b") },
      { offsetMs: 40, kind: "MARKET", payload: market }
    ]), { scheduler, speed: 2 });
    const sink = new RecordingSink();

    await adapter.start(sink, new AbortController().signal);

    expect(adapter.id).toBe("saba-football");
    expect(adapter.categories).toEqual(["FOOTBALL"]);
    expect(scheduler.waits).toEqual([10, 10]);
    expect(sink.emissions).toEqual([
      "STATUS:LIVE",
      "EVENT:event-a",
      "EVENT:event-b",
      "MARKET:market-total"
    ]);
    expect(sink.schemaErrors).toEqual([]);
  });

  it("strict-validates payloads before emission and reports only safe schema metadata", async () => {
    const secret = "never-expose-this-token-value";
    const malformed = { ...event("bad-event"), authorization: secret };
    const sink = new RecordingSink();
    const adapter = new FixtureAdapter(fixture([
      { offsetMs: 0, kind: "EVENT", payload: malformed },
      { offsetMs: 1, kind: "EVENT", payload: event("good-event") }
    ]), { scheduler: new ImmediateScheduler() });

    await adapter.start(sink, new AbortController().signal);

    expect(sink.events.map((item) => item.providerEventId)).toEqual(["good-event"]);
    expect(sink.schemaErrors).toHaveLength(1);
    expect(sink.schemaErrors[0]).toMatchObject({
      code: "SCHEMA_ERROR",
      adapterId: "saba-football",
      provider: "SABA",
      category: "FOOTBALL",
      recordKind: "EVENT",
      offsetMs: 0
    });
    expect(JSON.stringify(sink.schemaErrors)).not.toContain(secret);
    expect(sink.emissions[0]).toBe("ERROR:EVENT");
  });

  it("stops replay cleanly when its AbortSignal is aborted during a wait", async () => {
    const scheduler: ReplayScheduler = {
      wait(_delayMs, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true
          });
        });
      }
    };
    const sink = new RecordingSink();
    const controller = new AbortController();
    const adapter = new FixtureAdapter(fixture([
      { offsetMs: 0, kind: "STATUS", payload: status },
      { offsetMs: 10, kind: "EVENT", payload: event("not-emitted") }
    ]), { scheduler });

    const replay = adapter.start(sink, controller.signal);
    await Promise.resolve();
    controller.abort();
    await replay;

    expect(sink.emissions).toEqual(["STATUS:LIVE"]);
  });

  it("rejects invalid replay speed without exposing fixture contents", () => {
    expect(() => new FixtureAdapter(fixture([]), { speed: 0 })).toThrow(
      "Fixture replay speed must be a positive finite number"
    );
  });
});

const fixturePaths = [
  "../../../fixtures/football/saba-snapshot.json",
  "../../../fixtures/football/im-snapshot.json",
  "../../../fixtures/lol/saba-snapshot.json",
  "../../../fixtures/lol/im-snapshot.json"
] as const;

function loadFixture(path: string): FixtureSnapshot {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as FixtureSnapshot;
}

describe("redacted fixture snapshots", () => {
  it.each(fixturePaths)("replays every strict payload in %s", async (path) => {
    const snapshot = loadFixture(path);
    const sink = new RecordingSink();

    await new FixtureAdapter(snapshot, { scheduler: new ImmediateScheduler() })
      .start(sink, new AbortController().signal);

    expect(sink.schemaErrors).toEqual([]);
    expect(sink.statuses.map((item) => item.status)).toContain("LIVE");
    expect(sink.events.length).toBeGreaterThanOrEqual(2);
    expect(sink.markets.length).toBeGreaterThanOrEqual(2);
    expect(sink.quotes.map((item) => item.status)).toContain("OPEN");
    expect(sink.quotes.map((item) => item.status)).toContain("SUSPENDED");

    const offsets = snapshot.records.map((record) => record.offsetMs);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
    const quoteHistory = new Map<string, Set<string>>();
    for (const quote of sink.quotes) {
      const odds = quoteHistory.get(quote.providerSelectionId) ?? new Set<string>();
      odds.add(quote.rawOdds);
      quoteHistory.set(quote.providerSelectionId, odds);
    }
    expect([...quoteHistory.values()].some((odds) => odds.size > 1)).toBe(true);
  });

  it("contains a cross-provider arbitrage market and a non-arbitrage market per category", () => {
    const football = fixturePaths.slice(0, 2).map(loadFixture);
    const lol = fixturePaths.slice(2).map(loadFixture);

    const inverseSum = (
      snapshots: readonly FixtureSnapshot[],
      marketType: string,
      selections: readonly string[]
    ): number => selections.reduce((sum, selection) => {
      const best = Math.max(...snapshots.flatMap((snapshot) => snapshot.records
        .filter((record) => record.kind === "QUOTE")
        .map((record) => record.payload as ProviderQuote)
        .filter((quote) => quote.marketType === marketType && quote.status === "OPEN" && quote.selection === selection)
        .map((quote) => Number(quote.rawOdds))));
      return sum + 1 / best;
    }, 0);

    expect(inverseSum(football, "FT_TOTAL", ["OVER", "UNDER"])).toBeLessThan(0.98);
    expect(inverseSum(football, "FT_1X2", ["HOME", "DRAW", "AWAY"])).toBeGreaterThan(1);
    expect(inverseSum(lol, "SERIES_WINNER", ["TEAM_A", "TEAM_B"])).toBeLessThan(0.98);
    expect(inverseSum(lol, "MAP_WINNER", ["TEAM_A", "TEAM_B"])).toBeGreaterThan(1);
  });
});
