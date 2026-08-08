import { readFileSync } from "node:fs";
import type {
  ProviderConnectionStatus,
  ProviderEvent,
  ProviderMarket,
  ProviderQuote
} from "@tool-chenh/contracts";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  FixtureAdapter,
  type AdapterSchemaError,
  type FixtureAdapterConfig,
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

const trustedConfig = (overrides: Partial<FixtureAdapterConfig> = {}): FixtureAdapterConfig => ({
  id: "saba-football",
  provider: "SABA",
  category: "FOOTBALL",
  scheduler: new ImmediateScheduler(),
  ...overrides
});

describe("FixtureAdapter", () => {
  it("replays records by stable offset order and applies replay speed", async () => {
    const scheduler = new ImmediateScheduler();
    const adapter = new FixtureAdapter(fixture([
      { offsetMs: 20, kind: "EVENT", payload: event("event-a") },
      { offsetMs: 0, kind: "STATUS", payload: status },
      { offsetMs: 20, kind: "EVENT", payload: event("event-b") },
      { offsetMs: 40, kind: "MARKET", payload: market }
    ]), trustedConfig({ scheduler, speed: 2 }));
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
    ]), trustedConfig());

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

  it("uses only trusted configured identity when malformed envelope values contain secrets", async () => {
    const secrets = [
      "secret-adapter-token",
      "secret-provider-cookie",
      "secret-category-session"
    ] as const;
    const untrustedSnapshot = {
      ...fixture([]),
      adapterId: secrets[0],
      provider: secrets[1],
      category: secrets[2]
    };
    const sink = new RecordingSink();
    const adapter = new FixtureAdapter(untrustedSnapshot, trustedConfig({
      id: "trusted-saba-football"
    }));

    await adapter.start(sink, new AbortController().signal);

    expect(sink.schemaErrors).toHaveLength(1);
    expect(sink.schemaErrors[0]).toMatchObject({
      code: "SCHEMA_ERROR",
      adapterId: "trusted-saba-football",
      provider: "SABA",
      category: "FOOTBALL",
      recordKind: "UNKNOWN"
    });
    const serialized = JSON.stringify(sink.schemaErrors);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  });

  it("rejects a structurally valid envelope that mismatches trusted configured identity", async () => {
    const secrets = ["untrusted-adapter-token", "untrusted-provider-cookie"] as const;
    const untrustedSnapshot = {
      ...fixture([]),
      adapterId: secrets[0],
      provider: secrets[1],
      category: "LOL"
    };
    const sink = new RecordingSink();
    const adapter = new FixtureAdapter(untrustedSnapshot, trustedConfig());

    await adapter.start(sink, new AbortController().signal);

    expect(sink.schemaErrors).toHaveLength(1);
    expect(sink.schemaErrors[0]?.issues.map((issue) => issue.path)).toEqual([
      ["adapterId"],
      ["provider"],
      ["category"]
    ]);
    const serialized = JSON.stringify(sink.schemaErrors);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  });

  it("reports malformed record envelopes without silently dropping them", async () => {
    const sink = new RecordingSink();
    const snapshot = fixture([
      { offsetMs: 0, kind: "NOT_A_KIND", payload: event("hidden-event") },
      { offsetMs: -1, kind: "EVENT", payload: event("negative-offset") }
    ] as unknown as FixtureSnapshot["records"]);

    await new FixtureAdapter(snapshot, trustedConfig())
      .start(sink, new AbortController().signal);

    expect(sink.events).toEqual([]);
    expect(sink.schemaErrors).toHaveLength(2);
    expect(sink.schemaErrors.map((error) => error.recordKind)).toEqual(["UNKNOWN", "EVENT"]);
    expect(sink.schemaErrors.every((error) => error.code === "SCHEMA_ERROR")).toBe(true);
  });

  it("rejects payload provenance that conflicts with trusted adapter configuration", async () => {
    const sink = new RecordingSink();
    const conflicting = {
      ...event("wrong-source"),
      provider: "IM",
      category: "LOL",
      eventScope: "SERIES",
      bestOf: 3
    } as const;
    const adapter = new FixtureAdapter(fixture([
      { offsetMs: 0, kind: "EVENT", payload: conflicting }
    ]), trustedConfig());

    await adapter.start(sink, new AbortController().signal);

    expect(sink.events).toEqual([]);
    expect(sink.schemaErrors).toHaveLength(1);
    expect(sink.schemaErrors[0]).toMatchObject({
      code: "SCHEMA_ERROR",
      provider: "SABA",
      category: "FOOTBALL",
      recordKind: "EVENT"
    });
    expect(sink.schemaErrors[0]?.issues.map((issue) => issue.path)).toEqual([
      ["provider"],
      ["category"]
    ]);
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
    ]), trustedConfig({ scheduler }));

    const replay = adapter.start(sink, controller.signal);
    await Promise.resolve();
    controller.abort();
    await replay;

    expect(sink.emissions).toEqual(["STATUS:LIVE"]);
  });

  it("rejects invalid replay speed without exposing fixture contents", () => {
    expect(() => new FixtureAdapter(fixture([]), trustedConfig({ speed: 0 }))).toThrow(
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

    await new FixtureAdapter(snapshot, trustedConfig({
      id: snapshot.adapterId,
      provider: snapshot.provider,
      category: snapshot.category
    }))
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

  it("encodes compatible and rejected event pairs with identity-compatible markets", () => {
    const football = fixturePaths.slice(0, 2).map(loadFixture);
    const lol = fixturePaths.slice(2).map(loadFixture);

    const events = (snapshot: FixtureSnapshot): ProviderEvent[] => snapshot.records
      .filter((record) => record.kind === "EVENT")
      .map((record) => record.payload as ProviderEvent);
    const identity = (item: ProviderEvent) => ({
      category: item.category,
      competition: item.competition,
      seasonStage: item.seasonStage,
      startAtUtcMs: item.startAtUtcMs,
      participantA: item.participantA,
      participantB: item.participantB,
      eventScope: item.eventScope,
      bestOf: item.bestOf,
      isLive: item.isLive
    });

    expect(identity(events(football[0]!)[0]!)).toEqual(identity(events(football[1]!)[0]!));
    expect(identity(events(lol[0]!)[0]!)).toEqual(identity(events(lol[1]!)[0]!));
    const [sabaFootballRejected, imFootballRejected] = [events(football[0]!)[1]!, events(football[1]!)[1]!];
    expect(imFootballRejected.startAtUtcMs - sabaFootballRejected.startAtUtcMs).toBe(600_000);
    expect([imFootballRejected.participantA, imFootballRejected.participantB]).toEqual([
      sabaFootballRejected.participantB,
      sabaFootballRejected.participantA
    ]);
    const [sabaLolRejected, imLolRejected] = [events(lol[0]!)[1]!, events(lol[1]!)[1]!];
    expect(imLolRejected.participantA).toBe(sabaLolRejected.participantA);
    expect(sabaLolRejected.participantB).toBe("Beta Academy");
    expect(imLolRejected.participantB).toBe("Gamma Academy");

    for (const snapshots of [football, lol]) {
      const markets = snapshots.map((snapshot) => snapshot.records
        .filter((record) => record.kind === "MARKET")
        .map((record) => record.payload as ProviderMarket));
      snapshots.forEach((snapshot, providerIndex) => {
        const acceptedEventId = events(snapshot)[0]!.providerEventId;
        expect(markets[providerIndex]?.every((item) => item.providerEventId === acceptedEventId)).toBe(true);
      });
      expect(markets[0]?.map(({ category, marketType, scope, line, settlementProfile }) => ({
        category,
        marketType,
        scope,
        line,
        settlementProfile
      }))).toEqual(markets[1]?.map(({ category, marketType, scope, line, settlementProfile }) => ({
        category,
        marketType,
        scope,
        line,
        settlementProfile
      })));
    }
  });

  it("contains fee-adjusted arbitrage and non-arbitrage markets at a fixed replay offset", () => {
    const football = fixturePaths.slice(0, 2).map(loadFixture);
    const lol = fixturePaths.slice(2).map(loadFixture);
    const feeRate = new Decimal("0.01");
    const cutoffMs = 99;

    const inverseSum = (
      snapshots: readonly FixtureSnapshot[],
      marketType: string,
      selections: readonly string[]
    ): { readonly inverseSum: Decimal; readonly selected: readonly ProviderQuote[] } => {
      const marketIds = new Set(snapshots.flatMap((snapshot) => snapshot.records
        .filter((record) => record.kind === "MARKET")
        .map((record) => record.payload as ProviderMarket)
        .filter((item) => item.marketType === marketType)
        .map((item) => item.providerMarketId)));
      const latestBySelectionId = new Map<string, ProviderQuote>();
      for (const snapshot of snapshots) {
        for (const record of snapshot.records) {
          if (record.offsetMs > cutoffMs || record.kind !== "QUOTE") continue;
          const quote = record.payload as ProviderQuote;
          if (marketIds.has(quote.providerMarketId)) {
            latestBySelectionId.set(quote.providerSelectionId, quote);
          }
        }
      }

      const effective = (quote: ProviderQuote): Decimal => new Decimal(quote.rawOdds)
        .minus(1)
        .times(new Decimal(1).minus(feeRate))
        .plus(1);
      const selected = selections.map((selection) => {
        const candidates = [...latestBySelectionId.values()]
          .filter((quote) => quote.selection === selection && quote.status === "OPEN");
        return candidates.reduce((best, candidate) => effective(candidate).gt(effective(best))
          ? candidate
          : best);
      });
      return {
        inverseSum: selected.reduce(
          (sum, quote) => sum.plus(new Decimal(1).div(effective(quote))),
          new Decimal(0)
        ),
        selected
      };
    };

    const footballArbitrage = inverseSum(football, "FT_TOTAL", ["OVER", "UNDER"]);
    expect(footballArbitrage.inverseSum.lt(1)).toBe(true);
    expect(footballArbitrage.selected.map((quote) => [
      quote.provider,
      quote.providerMarketId,
      quote.selection
    ])).toEqual([
      ["SABA", "saba-fb-total-25", "OVER"],
      ["IM", "im-fb-total-25", "UNDER"]
    ]);
    expect(inverseSum(football, "FT_1X2", ["HOME", "DRAW", "AWAY"]).inverseSum.gt(1)).toBe(true);

    const lolArbitrage = inverseSum(lol, "SERIES_WINNER", ["TEAM_A", "TEAM_B"]);
    expect(lolArbitrage.inverseSum.lt(1)).toBe(true);
    expect(lolArbitrage.selected.map((quote) => [
      quote.provider,
      quote.providerMarketId,
      quote.selection
    ])).toEqual([
      ["SABA", "saba-lol-series-winner", "TEAM_A"],
      ["IM", "im-lol-series-winner", "TEAM_B"]
    ]);
    expect(inverseSum(lol, "MAP_WINNER", ["TEAM_A", "TEAM_B"]).inverseSum.gt(1)).toBe(true);
  });
});
