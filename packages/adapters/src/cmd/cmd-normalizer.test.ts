import { ProviderEventSchema, ProviderMarketSchema, ProviderQuoteSchema } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { normalizeCmdCatalog, normalizeObservedFootballCatalog, type CmdCatalogInputRecord } from "./cmd-normalizer.js";

describe("normalizeCmdCatalog", () => {
  it("accepts correctly decoded live labels from provider DOM snapshots", () => {
    for (const timeText of ["TRỰC TIẾP", "LIVE"]) {
      const result = normalizeCmdCatalog([{ ...record, timeText }], {
        observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 1, timezoneOffsetMinutes: 480, sequence: 1
      });
      expect(result.events[0]).toMatchObject({ isLive: true });
    }
  });
  const record = {
    sportId: "1" as const,
    leagueId: "league-1",
    leagueName: "Premier Test",
    matchId: "event-1",
    timeText: "08/17 02:30AM",
    teamNames: ["Alpha FC", "Beta FC"],
    groups: [
      {
        betTypeIds: ["1"], labels: ["0/0.5"],
        odds: [
          { marketOddsId: "ah-1", priceText: "0.90", status: null, greyedOut: "false" },
          { marketOddsId: "ah-1", priceText: "0.92", status: null, greyedOut: "false" }
        ]
      },
      {
        betTypeIds: ["3"], labels: ["2.5", "u"],
        odds: [
          { marketOddsId: "total-1", priceText: "0.84", status: "change-up", greyedOut: "false" },
          { marketOddsId: "total-1", priceText: "-0.92", status: "change-down", greyedOut: "false" }
        ]
      },
      {
        betTypeIds: ["5"], labels: [],
        odds: [
          { marketOddsId: "1x2-1", priceText: "2.10", status: null, greyedOut: "false" },
          { marketOddsId: "1x2-1", priceText: "3.20", status: null, greyedOut: "false" },
          { marketOddsId: "1x2-1", priceText: "3.40", status: null, greyedOut: "false" }
        ]
      }
    ]
  };

  it("normalizes only exact full-time two-way markets and excludes 1X2", () => {
    const result = normalizeCmdCatalog([record], {
      observedAtMs: Date.UTC(2026, 7, 9),
      receivedMonotonicMs: 500,
      timezoneOffsetMinutes: 420,
      sequence: 7
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(expect.objectContaining({
      provider: "CMD", category: "FOOTBALL", providerEventId: "event-1",
      participantA: "Alpha FC", participantB: "Beta FC", isLive: false,
      startAtUtcMs: Date.UTC(2026, 7, 16, 19, 30)
    }));
    expect(result.markets.map((market) => [market.marketType, market.line])).toEqual([
      ["FT_TOTAL", "2.5"]
    ]);
    expect(result.quotes.map((quote) => [quote.marketType, quote.selection, quote.rawOdds, quote.rawFormat])).toEqual([
      ["FT_TOTAL", "OVER", "0.84", "MALAY"],
      ["FT_TOTAL", "UNDER", "-0.92", "MALAY"]
    ]);
    expect(result.events.every((event) => ProviderEventSchema.safeParse(event).success)).toBe(true);
    expect(result.markets.every((market) => ProviderMarketSchema.safeParse(market).success)).toBe(true);
    expect(result.quotes.every((quote) => ProviderQuoteSchema.safeParse(quote).success)).toBe(true);
  });

  it("binds every normalized identity to the verified provider", () => {
    const result = normalizeObservedFootballCatalog("SABA", [record], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 500,
      timezoneOffsetMinutes: 420, sequence: 7
    });
    expect(new Set(result.events.map((event) => event.provider))).toEqual(new Set(["SABA"]));
    expect(new Set(result.markets.map((market) => market.provider))).toEqual(new Set(["SABA"]));
    expect(new Set(result.quotes.map((quote) => quote.provider))).toEqual(new Set(["SABA"]));
  });

  it("excludes obvious Soccer Marble/PG feeds", () => {
    const result = normalizeCmdCatalog([{ ...record, leagueName: "SABA INTERNATIONAL FRIENDLY Virtual PES 23 - PENALTY SHOOTOUTS",
      teamNames: ["Hy Lạp (V) (Luân Lưu)", "Trung Quốc (V) (Luân Lưu)"] }], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 500, timezoneOffsetMinutes: 420, sequence: 7
    });
    expect(result).toEqual({ events: [], markets: [], quotes: [], diagnostics: ["CMD_CATALOG_EVENT_UNSUPPORTED"] });
  });

  it("converts split totals to a canonical quarter line and suspends greyed markets", () => {
    const changed = structuredClone(record);
    changed.groups = [structuredClone(record.groups[1]!)];
    changed.groups[0]!.labels = ["3.5/4", "u"];
    changed.groups[0]!.odds[0]!.greyedOut = "true";
    const result = normalizeCmdCatalog([changed], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
    });
    expect(result.markets[0]).toEqual(expect.objectContaining({ line: "3.75", status: "SUSPENDED" }));
    expect(result.quotes.every((quote) => quote.status === "SUSPENDED")).toBe(true);
  });

  it("normalizes a full-time half-goal handicap from the team row that displays the line", () => {
    const handicap: CmdCatalogInputRecord = { ...structuredClone(record), groups: [{
      betTypeIds: ["1"], labels: ["0.5"], odds: [
        { marketOddsId: "ah-half", priceText: "0.79", status: null, greyedOut: "false", lineText: "0.5" },
        { marketOddsId: "ah-half", priceText: "-0.87", status: null, greyedOut: "false", lineText: null }
      ]
    }] };

    const homeGives = normalizeObservedFootballCatalog("SABA", [handicap], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
    });
    expect(homeGives.markets).toEqual([expect.objectContaining({ marketType: "FT_AH", line: "-0.5" })]);
    expect(homeGives.quotes.map((quote) => [quote.selection, quote.line, quote.rawFormat])).toEqual([
      ["HOME", "-0.5", "MALAY"], ["AWAY", "-0.5", "MALAY"]
    ]);

    const awayHandicap: CmdCatalogInputRecord = { ...handicap, groups: [{ ...handicap.groups[0]!, odds: [
      { ...handicap.groups[0]!.odds[0]!, lineText: null }, { ...handicap.groups[0]!.odds[1]!, lineText: "0.5" }
    ] }] };
    const awayGives = normalizeObservedFootballCatalog("SABA", [awayHandicap], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 2
    });
    expect(awayGives.markets[0]?.line).toBe("0.5");
  });

  it("removes the neutral-ground marker and duplicate team node emitted by the current CMD DOM", () => {
    const currentDom = { ...structuredClone(record), teamNames: ["Lions FC (N)", "Melbourne City FC", "Lions FC"] };
    const result = normalizeCmdCatalog([currentDom], {
      observedAtMs: Date.UTC(2026, 7, 11), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
    });

    expect(result.events).toEqual([expect.objectContaining({
      participantA: "Lions FC", participantB: "Melbourne City FC"
    })]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts the observed live clock format with stoppage time", () => {
    const live = { ...record, timeText: "2H48'+6", groups: [record.groups[2]!] };
    const result = normalizeCmdCatalog([live], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
    });
    expect(result.events[0]).toEqual(expect.objectContaining({
      isLive: true,
      liveState: expect.objectContaining({ period: "2H", clockMs: 2_880_000 })
    }));
  });

  it("accepts the current CMD today-list 24-hour time with its Live badge text", () => {
    const today = { ...record, timeText: "22:00Live", groups: [record.groups[1]!] };
    const result = normalizeCmdCatalog([today], {
      observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 1
    });
    expect(result.events[0]).toEqual(expect.objectContaining({
      isLive: false,
      startAtUtcMs: Date.UTC(2026, 7, 15, 14)
    }));
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps valid markets when another market in the same event is invalid", () => {
    const mixed: CmdCatalogInputRecord = { ...structuredClone(record), groups: [
      {
        betTypeIds: ["1"], labels: ["0"], odds: [
          { marketOddsId: "invalid-ah", priceText: "0.80", status: null, greyedOut: "false", lineText: "0" },
          { marketOddsId: "invalid-ah", priceText: "-0.90", status: null, greyedOut: "false", lineText: null }
        ]
      },
      structuredClone(record.groups[1]!)
    ] };
    const result = normalizeCmdCatalog([mixed], {
      observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 1
    });
    expect(result.events).toHaveLength(1);
    expect(result.markets).toEqual([expect.objectContaining({ marketType: "FT_TOTAL", line: "2.5" })]);
    expect(result.diagnostics).toContain("CMD_CATALOG_MARKET_REJECTED");
  });

  it("fails closed on missing participants, invalid times, mismatched IDs, or malformed odds", () => {
    const cases = [
      { ...record, teamNames: ["Alpha FC"] },
      { ...record, timeText: "unknown" },
      { ...record, groups: [{ ...record.groups[1]!, odds: [
        record.groups[1]!.odds[0]!, { ...record.groups[1]!.odds[1]!, marketOddsId: "different" }
      ] }] },
      { ...record, groups: [{ ...record.groups[1]!, odds: [
        { ...record.groups[1]!.odds[0]!, priceText: "1e3" }, record.groups[1]!.odds[1]!
      ] }] }
    ];
    for (const malformed of cases) {
      expect(normalizeCmdCatalog([malformed], {
        observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
      })).toEqual({ events: [], markets: [], quotes: [], diagnostics: [expect.any(String)] });
    }
  });

  it("publishes only non-virtual full-time two-way quarter, half, or three-quarter lines", () => {
    const filtered = structuredClone(record);
    filtered.groups.push({
      betTypeIds: ["3"], labels: ["3"], odds: [
        { marketOddsId: "integer", priceText: "0.8", status: null, greyedOut: "false" },
        { marketOddsId: "integer", priceText: "-0.9", status: null, greyedOut: "false" }
      ]
    });
    const result = normalizeCmdCatalog([filtered], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
    });
    expect(result.markets.map(({ marketType, line }) => [marketType, line])).toEqual([["FT_TOTAL", "2.5"]]);

    const virtual = normalizeCmdCatalog([{ ...filtered, leagueName: "Virtual Football", teamNames: ["A (V)", "B (V)"] }], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 2
    });
    expect(virtual).toEqual({ events: [], markets: [], quotes: [], diagnostics: ["CMD_CATALOG_EVENT_UNSUPPORTED"] });
  });
});
