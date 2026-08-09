import { readFileSync } from "node:fs";
import {
  FixtureAdapter,
  type FixtureSnapshot,
  type ProviderAdapter,
  type ProviderQuoteUpdate,
  type ProviderSink,
  type ReplayScheduler
} from "@tool-chenh/adapters";
import {
  AppSnapshotSchema,
  type Category,
  type ProviderConnectionStatus,
  type ProviderEvent,
  type ProviderMarket,
  type ProviderQuote
} from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { Runtime, type RuntimeClock } from "./runtime.js";

const immediateScheduler: ReplayScheduler = {
  async wait(): Promise<void> {}
};

const clock: RuntimeClock = {
  now: () => ({ monotonicNowMs: 100, wallClockNowMs: 1_800_000_000_100 })
};

const fixturePaths = [
  ["football/saba-snapshot.json", "SABA", "FOOTBALL"],
  ["football/im-snapshot.json", "IM", "FOOTBALL"],
  ["lol/saba-snapshot.json", "SABA", "LOL"],
  ["lol/im-snapshot.json", "IM", "LOL"]
] as const;

function loadFixture(path: string): FixtureSnapshot {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8")
  ) as FixtureSnapshot;
}

function mappingPolicy() {
  return {
    prematchToleranceMs: 120_000,
    liveClockToleranceMs: 20_000,
    aliasRegistry: {
      version: "fixture-v1",
      aliases: {
        FOOTBALL: {
          northbridge_fc: "northbridge_fc",
          riverside_united: "riverside_united",
          city_academy: "city_academy",
          united_academy: "united_academy"
        },
        LOL: {
          blue_comets: "blue_comets",
          red_phoenix: "red_phoenix",
          alpha_academy: "alpha_academy",
          beta_academy: "beta_academy",
          gamma_academy: "gamma_academy"
        }
      }
    }
  } as const;
}

function opportunityPolicy(nowMs = 1_800_000_000_100) {
  const provider = {
    fee: { type: "PROFIT" as const, rate: "0.01" },
    constraint: { minStake: "1", maxStake: "1000", stakeStep: "1", balance: "1000" },
    fx: {
      sourceCurrency: "USD",
      baseCurrency: "USD",
      rate: "1",
      spreadRate: "0",
      asOfMs: nowMs,
      maxAgeMs: 10_000
    }
  };
  return {
    baseCurrency: "USD",
    bankroll: "1000",
    minimumNetMargin: "0",
    minimumWorstCaseProfit: "0",
    minimumRoi: "0",
    minimumRemainingTtlMs: 0,
    providers: { SABA: provider, IM: provider }
  };
}

function adapters(secret?: string) {
  return fixturePaths.map(([path, provider, category]) => {
    const original = loadFixture(path);
    const records = original.records.filter((record) => record.offsetMs <= 90);
    const snapshot: FixtureSnapshot = secret !== undefined && path === "football/saba-snapshot.json"
      ? {
          ...original,
          records: [...records, {
            offsetMs: 75,
            kind: "EVENT",
            payload: { authorization: secret }
          }]
        }
      : { ...original, records };
    return new FixtureAdapter(snapshot, {
      id: snapshot.adapterId,
      provider,
      category: category as Category,
      scheduler: immediateScheduler
    });
  });
}

function emitRecord(
  sink: ProviderSink,
  record: FixtureSnapshot["records"][number],
  quoteIdPrefix = ""
): void {
  switch (record.kind) {
    case "STATUS":
      sink.onStatus(record.payload as ProviderConnectionStatus);
      return;
    case "EVENT":
      sink.onEvent(record.payload as ProviderEvent);
      return;
    case "MARKET":
      sink.onMarket(record.payload as ProviderMarket);
      return;
    case "QUOTE": {
      const update = record.payload as ProviderQuoteUpdate;
      sink.onQuoteUpdate({
        ...update,
        quotes: update.quotes.map((quote) => ({
          ...quote,
          providerSelectionId: `${quoteIdPrefix}${quote.providerSelectionId}`
        }))
      });
    }
  }
}

function fixtureQuotes(snapshot: FixtureSnapshot): ProviderQuote[] {
  return snapshot.records.flatMap((record) =>
    record.kind === "QUOTE"
      ? [...(record.payload as ProviderQuoteUpdate).quotes]
      : []
  );
}

function emitQuoteUpdate(
  sink: ProviderSink,
  quote: ProviderQuote,
  kind: "FULL_SNAPSHOT" | "DELTA" = "DELTA"
): void {
  sink.onQuoteUpdate({
    source: { provider: quote.provider, category: quote.category },
    kind,
    transport: "WEBSOCKET",
    sequence: quote.sequence,
    clock: {
      monotonicNowMs: quote.receivedMonotonicMs,
      wallClockNowMs: quote.sourceTimestampMs ?? 0
    },
    quotes: [quote]
  });
}

describe("Runtime", () => {
  it("does not let a duplicate lower sequence replace accepted quote state", async () => {
    const base = adapters();
    const sabaFootball = base.find((adapter) => adapter.id === "saba-football")!;
    const guarded: ProviderAdapter = {
      id: sabaFootball.id,
      categories: sabaFootball.categories,
      async start(sink, signal): Promise<void> {
        await sabaFootball.start(sink, signal);
        const source = loadFixture("football/saba-snapshot.json");
        const accepted = fixtureQuotes(source)
          .find((quote) => quote.providerSelectionId === "saba-fb-over-25" && quote.sequence === 2)!;
        emitQuoteUpdate(sink, { ...accepted, rawOdds: "1.01", sequence: 2 });
        emitQuoteUpdate(sink, { ...accepted, rawOdds: "1.01", sequence: 1 });
      }
    };
    const runtime = new Runtime({
      adapters: [guarded, ...base.filter((adapter) => adapter.id !== "saba-football")],
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });

    await runtime.start(new AbortController().signal);

    const football = runtime.getSnapshot().opportunities.find((item) => item.category === "FOOTBALL");
    expect(football?.legs.find((leg) => leg.provider === "SABA")?.rawOdds).toBe("2.10");
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "OUT_OF_ORDER" })
    ]));
    expect(runtime.getDiagnostics().filter((item) => item.code === "OUT_OF_ORDER")).toHaveLength(2);
  });

  it("removes a HIGH opportunity while a sequence gap awaits a complete snapshot", async () => {
    const base = adapters();
    const sabaFootball = base.find((adapter) => adapter.id === "saba-football")!;
    let liveSink: ProviderSink | undefined;
    const controlled: ProviderAdapter = {
      id: sabaFootball.id,
      categories: sabaFootball.categories,
      async start(sink, signal): Promise<void> {
        liveSink = sink;
        await sabaFootball.start(sink, signal);
      }
    };
    const runtime = new Runtime({
      adapters: [controlled, ...base.filter((adapter) => adapter.id !== "saba-football")],
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });

    await runtime.start(new AbortController().signal);

    const source = loadFixture("football/saba-snapshot.json");
    const quotes = fixtureQuotes(source)
      .filter((quote) => quote.providerMarketId === "saba-fb-total-25");
    const over = quotes.find((quote) => quote.providerSelectionId === "saba-fb-over-25" && quote.sequence === 2)!;
    const under = quotes.find((quote) => quote.providerSelectionId === "saba-fb-under-25")!;
    expect(runtime.getSnapshot().opportunities.some((item) => item.category === "FOOTBALL")).toBe(true);

    emitQuoteUpdate(liveSink!, { ...over, rawOdds: "1.01", sequence: 5 });

    const quarantined = runtime.getSnapshot();
    expect(quarantined.opportunities.some((item) => item.category === "FOOTBALL")).toBe(false);
    expect(quarantined.blockedDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "FOOTBALL", code: "QUOTE_NEEDS_SNAPSHOT" })
    ]));
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SEQUENCE_GAP" })
    ]));

    liveSink!.onQuoteUpdate({
      source: { provider: over.provider, category: over.category },
      kind: "FULL_SNAPSHOT",
      transport: "WEBSOCKET",
      sequence: 10,
      clock: { monotonicNowMs: 100, wallClockNowMs: 0 },
      quotes: [
        { ...over, rawOdds: "2.20", sequence: 10 },
        { ...under, sequence: 10 }
      ]
    });

    const recovered = runtime.getSnapshot().opportunities.find((item) => item.category === "FOOTBALL");
    expect(recovered?.legs.find((leg) => leg.provider === "SABA")?.rawOdds).toBe("2.20");
  });

  it("quarantines a sequence gap until an explicit full snapshot recovers the market", async () => {
    const base = adapters();
    const sabaFootball = base.find((adapter) => adapter.id === "saba-football")!;
    const recovering: ProviderAdapter = {
      id: sabaFootball.id,
      categories: sabaFootball.categories,
      async start(sink, signal): Promise<void> {
        await sabaFootball.start(sink, signal);
        const source = loadFixture("football/saba-snapshot.json");
        const accepted = fixtureQuotes(source)
          .find((quote) => quote.providerSelectionId === "saba-fb-over-25" && quote.sequence === 2)!;
        const under = fixtureQuotes(source)
          .find((quote) => quote.providerSelectionId === "saba-fb-under-25")!;
        emitQuoteUpdate(sink, { ...accepted, rawOdds: "1.01", sequence: 5 });
        emitQuoteUpdate(sink, { ...accepted, rawOdds: "1.01", sequence: 4 });
        sink.onQuoteUpdate({
          source: { provider: accepted.provider, category: accepted.category },
          kind: "FULL_SNAPSHOT",
          transport: "WEBSOCKET",
          sequence: 10,
          clock: { monotonicNowMs: 100, wallClockNowMs: 0 },
          quotes: [
            { ...accepted, rawOdds: "2.20", sequence: 10 },
            { ...under, sequence: 10 }
          ]
        });
      }
    };
    const runtime = new Runtime({
      adapters: [recovering, ...base.filter((adapter) => adapter.id !== "saba-football")],
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });

    await runtime.start(new AbortController().signal);

    const football = runtime.getSnapshot().opportunities.find((item) => item.category === "FOOTBALL");
    expect(football?.legs.find((leg) => leg.provider === "SABA")?.rawOdds).toBe("2.20");
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SEQUENCE_GAP" }),
      expect.objectContaining({ code: "NEEDS_SNAPSHOT" })
    ]));
  });

  it("preserves contradictory rematch evidence and fails the event mapping closed", async () => {
    const rematchAdapters = fixturePaths.map(([path, provider, category]) => {
      const original = loadFixture(path);
      const snapshot: FixtureSnapshot = {
        ...original,
        records: original.records.filter((record) => record.offsetMs <= 90).map((record) => {
          if (
            category !== "FOOTBALL" || record.kind !== "EVENT" ||
            !(record.payload as ProviderEvent).providerEventId.endsWith("-verified")
          ) return record;
          return {
            ...record,
            payload: {
              ...(record.payload as ProviderEvent),
              rematchCandidate: true,
              fixtureDiscriminator: provider === "SABA" ? "round-2-leg-1" : "round-2-leg-2"
            }
          };
        })
      };
      return new FixtureAdapter(snapshot, {
        id: snapshot.adapterId,
        provider,
        category,
        scheduler: immediateScheduler
      });
    });
    const runtime = new Runtime({
      adapters: rematchAdapters,
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });

    await runtime.start(new AbortController().signal);

    const snapshot = runtime.getSnapshot();
    const football = snapshot.events.find((event) =>
      event.providerEventIds.some((id) => id.endsWith("-verified")) && event.category === "FOOTBALL"
    );
    expect(football).toMatchObject({ mappingStatus: "REJECTED", isLive: false });
    expect(football?.mappingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ gate: "compatibleRematchEvidence", passed: false })
    ]));
    expect(snapshot.opportunities.some((item) => item.category === "FOOTBALL")).toBe(false);
  });



  it("isolates subscriber failures without leaking or misclassifying them", async () => {
    const secret = "subscriber-secret-must-not-escape";
    const runtime = new Runtime({ adapters: adapters(), clock, mappingPolicy: mappingPolicy(), opportunityPolicy: opportunityPolicy() });
    const received: number[] = [];
    runtime.subscribe(() => {
      throw new Error(secret);
    });
    runtime.subscribe((snapshot) => received.push(snapshot.revision));

    await expect(runtime.start(new AbortController().signal)).resolves.toBeUndefined();

    expect(received.length).toBeGreaterThan(1);
    expect(received.every((revision, index) => index === 0 || revision > received[index - 1]!)).toBe(true);
    expect(runtime.getSnapshot().opportunities).toHaveLength(2);
    const diagnostics = runtime.getDiagnostics();
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SUBSCRIBER_FAILURE", reason: "snapshot subscriber failed" })
    ]));
    expect(diagnostics.some((item) => item.code === "ADAPTER_FAILURE")).toBe(false);
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
  });

  it("quarantines one adapter without suppressing a healthy sibling source", async () => {
    const saba = loadFixture("football/saba-snapshot.json");
    const poison = "failed-owner-poison";
    const hiddenEvent = {
      ...(saba.records.find((record) => record.kind === "EVENT")!.payload as ProviderEvent),
      providerEventId: "must-stay-quarantined"
    };
    const failing: ProviderAdapter = {
      id: "failing-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) => item.offsetMs <= 70)) {
          if (record.kind === "EVENT" &&
            (record.payload as ProviderEvent).providerEventId === "saba-fb-verified") {
            const event = record.payload as ProviderEvent;
            sink.onEvent({
              ...event,
              competition: `${poison}-competition`,
              seasonStage: `${poison}-stage`,
              participantA: `${poison}-a`,
              participantB: `${poison}-b`,
              startAtUtcMs: event.startAtUtcMs + 86_400_000,
              isLive: true
            });
          } else if (record.kind === "MARKET") {
            sink.onMarket({ ...(record.payload as ProviderMarket), status: "SUSPENDED" });
          } else {
            emitRecord(sink, record, "failing-");
          }
        }
        sink.onSchemaError({
          code: "SCHEMA_ERROR",
          adapterId: this.id,
          provider: "SABA",
          category: "FOOTBALL",
          recordKind: "EVENT",
          offsetMs: 1,
          issues: [{ code: "unrecognized_keys", path: ["authorization"] }]
        });
        sink.onEvent(hiddenEvent);
      }
    };
    const healthySibling: ProviderAdapter = {
      id: "healthy-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) => item.offsetMs <= 90)) {
          emitRecord(sink, record);
        }
      }
    };
    const partialSibling: ProviderAdapter = {
      id: "a-partial-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) => item.offsetMs <= 70)) {
          if (record.kind === "QUOTE") {
            const update = record.payload as ProviderQuoteUpdate;
            sink.onQuoteUpdate({
              ...update,
              quotes: update.quotes.map((quote) => ({
                ...quote,
                selection: quote.marketType === "FT_TOTAL" ? "UNKNOWN_OUTCOME" : "HOME"
              }))
            });
          } else {
            emitRecord(sink, record);
          }
        }
      }
    };
    const im = loadFixture("football/im-snapshot.json");
    const healthyIm: ProviderAdapter = {
      id: "im-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of im.records.filter((item) => item.offsetMs <= 90)) {
          emitRecord(sink, record);
        }
      }
    };
    const observableSnapshots: string[] = [];
    for (const siblings of [
      [failing, partialSibling, healthySibling],
      [healthySibling, partialSibling, failing]
    ]) {
      const runtime = new Runtime({
        adapters: [healthyIm, ...siblings],
        clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
      });

      await runtime.start(new AbortController().signal);

      const snapshot = runtime.getSnapshot();
      expect(snapshot.counts.FOOTBALL).toEqual({ events: 2, markets: 2 });
      expect(snapshot.opportunities.map((opportunity) => opportunity.category)).toEqual(["FOOTBALL"]);
      expect(snapshot.events.flatMap((event) => event.providerEventIds)).not.toContain("must-stay-quarantined");
      expect(snapshot.providerStatuses.filter((status) =>
        status.provider === "SABA" && status.category === "FOOTBALL"
      ).map((status) => ({ adapterId: status.adapterId, status: status.status }))).toEqual([
        { adapterId: "a-partial-saba-football", status: "LIVE" },
        { adapterId: "failing-saba-football", status: "SCHEMA_ERROR" },
        { adapterId: "healthy-saba-football", status: "LIVE" }
      ]);
      expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "SCHEMA_ERROR", adapterId: "failing-saba-football" })
      ]));
      expect(JSON.stringify(snapshot)).not.toContain(poison);
      observableSnapshots.push(JSON.stringify({
        counts: snapshot.counts,
        providerStatuses: snapshot.providerStatuses,
        events: snapshot.events,
        markets: snapshot.markets,
        opportunities: snapshot.opportunities,
        blockedDiagnostics: snapshot.blockedDiagnostics
      }));
    }
    expect(new Set(observableSnapshots).size).toBe(1);
  });

  it("isolates reused provider identities inside one multi-category adapter", async () => {
    const merged = ([provider, footballPath, lolPath]: readonly [string, string, string]): ProviderAdapter => ({
      id: `${provider.toLowerCase()}-multi`,
      categories: ["FOOTBALL", "LOL"],
      async start(sink): Promise<void> {
        const football = loadFixture(footballPath);
        const lol = loadFixture(lolPath);
        const footballMarketId = provider === "SABA" ? "saba-fb-total-25" : "im-fb-total-25";
        const footballSelectionIds = provider === "SABA"
          ? ["saba-fb-over-25", "saba-fb-under-25"]
          : ["im-fb-over-25", "im-fb-under-25"];
        for (const record of football.records.filter((item) => {
          const payload = item.kind === "QUOTE"
            ? (item.payload as ProviderQuoteUpdate).quotes[0]!
            : item.payload as { providerEventId?: string; providerMarketId?: string };
          return item.offsetMs <= 70 && (item.kind === "STATUS" ||
            (payload.providerEventId?.endsWith("-fb-verified") === true &&
              (payload.providerMarketId === undefined || payload.providerMarketId === footballMarketId)));
        })) emitRecord(sink, record);
        let selectionIndex = 0;
        for (const record of lol.records.filter((item) => {
          const payload = item.kind === "QUOTE"
            ? (item.payload as ProviderQuoteUpdate).quotes[0]!
            : item.payload as { providerEventId?: string; marketType?: string };
          return item.offsetMs <= 70 && (item.kind === "STATUS" ||
            (payload.providerEventId?.endsWith("-lol-verified") === true &&
              (item.kind === "EVENT" || payload.marketType === "SERIES_WINNER")));
        })) {
          if (record.kind === "QUOTE") {
            const update = record.payload as ProviderQuoteUpdate;
            emitRecord(sink, {
              ...record,
              payload: {
                ...update,
                quotes: update.quotes.map((quote) => ({
                  ...quote,
                  providerEventId: quote.providerEventId.replace("-lol-", "-fb-"),
                  providerMarketId: footballMarketId,
                  providerSelectionId: footballSelectionIds[selectionIndex++]!
                }))
              }
            });
            continue;
          }
          const payload = record.payload as Record<string, unknown>;
          const transformed = {
            ...record,
            payload: {
              ...payload,
              ...(typeof payload.providerEventId === "string"
                ? { providerEventId: payload.providerEventId.replace("-lol-", "-fb-") }
                : {}),
              ...(typeof payload.providerMarketId === "string"
                ? { providerMarketId: footballMarketId }
                : {})
            }
          } as FixtureSnapshot["records"][number];
          emitRecord(sink, transformed);
        }
      }
    });
    const runtime = new Runtime({
      adapters: [
        merged(["SABA", "football/saba-snapshot.json", "lol/saba-snapshot.json"]),
        merged(["IM", "football/im-snapshot.json", "lol/im-snapshot.json"])
      ],
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });

    await runtime.start(new AbortController().signal);

    expect(runtime.getSnapshot().opportunities.map((item) => item.category).sort()).toEqual([
      "FOOTBALL",
      "LOL"
    ]);
  });

  it("prefers a complete participant-domain handicap owner over a lexical partial sibling", async () => {
    const eventFrom = (path: string): ProviderEvent => {
      const snapshot = loadFixture(path);
      return snapshot.records.find((record) =>
        record.kind === "EVENT" &&
        (record.payload as ProviderEvent).providerEventId.endsWith("-verified")
      )!.payload as ProviderEvent;
    };
    const sabaEvent = eventFrom("football/saba-snapshot.json");
    const imEvent = eventFrom("football/im-snapshot.json");
    const marketFor = (event: ProviderEvent, providerMarketId: string): ProviderMarket => ({
      provider: event.provider,
      category: event.category,
      providerEventId: event.providerEventId,
      providerMarketId,
      marketType: "FT_AH",
      scope: "FULL_TIME",
      line: "0",
      settlementProfile: "football-regulation-including-added-time",
      status: "OPEN"
    });
    const quoteFor = (
      market: ProviderMarket,
      selection: "TEAM_A" | "TEAM_B",
      rawOdds: string
    ): ProviderQuote => ({
      provider: market.provider,
      category: market.category,
      providerEventId: market.providerEventId,
      providerMarketId: market.providerMarketId,
      marketType: market.marketType,
      scope: market.scope,
      line: market.line,
      providerSelectionId: `${market.providerMarketId}-${selection.toLowerCase()}`,
      selection,
      rawOdds,
      rawFormat: "DECIMAL",
      status: market.status,
      isLive: false,
      sourceTimestampMs: null,
      receivedMonotonicMs: 50,
      sequence: 1
    });
    const sabaMarket = marketFor(sabaEvent, "saba-fb-ah-0");
    const imMarket = marketFor(imEvent, "im-fb-ah-0");
    const adapter = (
      id: string,
      event: ProviderEvent,
      market: ProviderMarket,
      quotes: readonly ProviderQuote[]
    ): ProviderAdapter => ({
      id,
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        sink.onEvent(event);
        sink.onMarket(market);
        const first = quotes[0];
        if (first !== undefined) {
          sink.onQuoteUpdate({
            source: { provider: first.provider, category: first.category },
            kind: "FULL_SNAPSHOT",
            transport: "WEBSOCKET",
            sequence: first.sequence,
            clock: {
              monotonicNowMs: first.receivedMonotonicMs,
              wallClockNowMs: first.sourceTimestampMs ?? 0
            },
            quotes
          });
        }
      }
    });
    const runtime = new Runtime({
      adapters: [
        adapter("a-partial-saba-football", sabaEvent, sabaMarket, [
          quoteFor(sabaMarket, "TEAM_A", "2.20")
        ]),
        adapter("z-complete-saba-football", sabaEvent, sabaMarket, [
          quoteFor(sabaMarket, "TEAM_A", "2.20"),
          quoteFor(sabaMarket, "TEAM_B", "1.80")
        ]),
        adapter("im-football", imEvent, imMarket, [
          quoteFor(imMarket, "TEAM_A", "1.80"),
          quoteFor(imMarket, "TEAM_B", "2.20")
        ])
      ],
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });

    await runtime.start(new AbortController().signal);

    const snapshot = runtime.getSnapshot();
    const handicap = snapshot.markets.find((market) => market.marketType === "FT_AH");
    expect(handicap?.mappingStatus).toBe("VERIFIED");
  });

  it("fails closed when the only non-quarantined sibling has partial event ownership", async () => {
    const saba = loadFixture("football/saba-snapshot.json");
    const im = loadFixture("football/im-snapshot.json");
    const poison = "partial-failed-owner-poison";
    const fullFailing: ProviderAdapter = {
      id: "a-failing-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) => item.offsetMs <= 70)) {
          if (record.kind === "EVENT" &&
            (record.payload as ProviderEvent).providerEventId === "saba-fb-verified") {
            sink.onEvent({
              ...(record.payload as ProviderEvent),
              competition: poison,
              participantA: `${poison}-a`
            });
          } else {
            emitRecord(sink, record, "failed-");
          }
        }
        await Promise.resolve();
        sink.onSchemaError({
          code: "SCHEMA_ERROR",
          adapterId: this.id,
          provider: "SABA",
          category: "FOOTBALL",
          recordKind: "EVENT",
          offsetMs: 1,
          issues: [{ code: "unrecognized_keys", path: ["authorization"] }]
        });
      }
    };
    const partialSibling: ProviderAdapter = {
      id: "z-partial-saba-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of saba.records.filter((item) =>
          item.offsetMs <= 40 && item.kind !== "QUOTE")) {
          emitRecord(sink, record);
        }
      }
    };
    const healthyIm: ProviderAdapter = {
      id: "im-football",
      categories: ["FOOTBALL"],
      async start(sink): Promise<void> {
        for (const record of im.records.filter((item) => item.offsetMs <= 70)) emitRecord(sink, record);
      }
    };
    const runtime = new Runtime({
      adapters: [healthyIm, fullFailing, partialSibling],
      clock,
      mappingPolicy: mappingPolicy(),
      opportunityPolicy: opportunityPolicy()
    });
    const opportunityCounts: number[] = [];
    runtime.subscribe((snapshot) => opportunityCounts.push(snapshot.opportunities.length));

    await runtime.start(new AbortController().signal);

    const snapshot = runtime.getSnapshot();
    expect(snapshot.counts.FOOTBALL).toEqual({ events: 2, markets: 2 });
    expect(snapshot.opportunities).toHaveLength(0);
    expect(opportunityCounts.every((count) => count === 0)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(poison);
    expect(snapshot.providerStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapterId: "a-failing-saba-football", status: "SCHEMA_ERROR" }),
      expect.objectContaining({ adapterId: "z-partial-saba-football", status: "LIVE" })
    ]));
  });

  it("maximizes verified event pairs instead of consuming the shortest edge greedily", async () => {
    const baseMs = 1_786_305_600_000;
    const times: Readonly<Record<string, number>> = {
      "saba-fb-verified": baseMs,
      "saba-fb-rejected": baseMs + 100_000,
      "im-fb-verified": baseMs + 40_000,
      "im-fb-rejected": baseMs - 100_000
    };
    const repeated = fixturePaths.slice(0, 2).map(([path, provider, category]) => {
      const original = loadFixture(path);
      const records = original.records
        .filter((record) => record.kind === "STATUS" || record.kind === "EVENT")
        .map((record) => record.kind !== "EVENT" ? record : {
          ...record,
          payload: {
            ...(record.payload as object),
            startAtUtcMs: times[(record.payload as { providerEventId: string }).providerEventId],
            participantA: "Northbridge FC",
            participantB: "Riverside United"
          }
        });
      const snapshot = { ...original, records };
      return new FixtureAdapter(snapshot, {
        id: snapshot.adapterId,
        provider,
        category,
        scheduler: immediateScheduler
      });
    });
    const runtime = new Runtime({ adapters: repeated, clock, mappingPolicy: mappingPolicy(), opportunityPolicy: opportunityPolicy() });

    await runtime.start(new AbortController().signal);

    expect(runtime.getSnapshot().events.filter((event) => event.mappingStatus === "VERIFIED")).toHaveLength(2);
  });

  it("quarantines only the adapter category that emits a schema error", async () => {
    const secret = "Bearer never-expose-runtime-secret";
    const runtime = new Runtime({ adapters: adapters(secret), clock, mappingPolicy: mappingPolicy(), opportunityPolicy: opportunityPolicy() });

    await runtime.start(new AbortController().signal);

    const snapshot = runtime.getSnapshot();
    expect(AppSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.opportunities.map((opportunity) => opportunity.category)).toEqual(["LOL"]);
    expect(snapshot.providerStatuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "SABA", category: "FOOTBALL", status: "SCHEMA_ERROR" }),
      expect.objectContaining({ provider: "SABA", category: "LOL", status: "LIVE" })
    ]));
    expect(snapshot.blockedDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "FOOTBALL", code: "QUOTE_SCHEMA_ERROR" })
    ]));
    expect(snapshot.counts.LOL).toEqual({ events: 2, markets: 2 });

    const observable = JSON.stringify({ snapshot, diagnostics: runtime.getDiagnostics() });
    expect(observable).not.toContain(secret);
    expect(runtime.getDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SCHEMA_ERROR", provider: "SABA", category: "FOOTBALL" })
    ]));
  });

  it("orders Football and LoL source diagnostics independently of callback order", async () => {
    const sourceError = (
      id: string,
      provider: string,
      category: Category,
      recordKind: "EVENT" | "QUOTE"
    ): ProviderAdapter => ({
      id,
      categories: [category],
      async start(sink): Promise<void> {
        sink.onSchemaError({
          code: "SCHEMA_ERROR",
          adapterId: "untrusted-payload-id",
          provider,
          category,
          recordKind,
          offsetMs: 1,
          issues: [{ code: "unrecognized_keys", path: ["authorization"] }]
        });
      }
    });
    const sources = [
      sourceError("z-football", "SABA", "FOOTBALL", "EVENT"),
      sourceError("a-lol", "IM", "LOL", "QUOTE")
    ];
    const diagnosticsByOrder: string[] = [];
    for (const ordered of [sources, [...sources].reverse()]) {
      const runtime = new Runtime({ adapters: ordered, clock, mappingPolicy: mappingPolicy(), opportunityPolicy: opportunityPolicy() });

      await runtime.start(new AbortController().signal);

      diagnosticsByOrder.push(JSON.stringify(runtime.getSnapshot().blockedDiagnostics));
    }

    expect(new Set(diagnosticsByOrder).size).toBe(1);
    expect(JSON.parse(diagnosticsByOrder[0]!) as unknown).toEqual([
      expect.objectContaining({
        category: "FOOTBALL",
        code: "QUOTE_SCHEMA_ERROR",
        reason: "adapter/category quarantined after schema validation failure"
      }),
      expect.objectContaining({
        category: "LOL",
        code: "QUOTE_SCHEMA_ERROR",
        reason: "adapter/category quarantined after schema validation failure"
      })
    ]);
  });

  it("publishes frozen snapshots with strictly increasing revisions", async () => {
    const runtime = new Runtime({ adapters: adapters(), clock, mappingPolicy: mappingPolicy(), opportunityPolicy: opportunityPolicy() });
    const revisions: number[] = [];
    const unsubscribe = runtime.subscribe((snapshot) => revisions.push(snapshot.revision));

    await runtime.start(new AbortController().signal);
    unsubscribe();

    const snapshot = runtime.getSnapshot();
    expect(AppSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
    expect(revisions.length).toBeGreaterThan(1);
    expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]!)).toBe(true);
  });
});
