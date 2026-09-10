import { ProviderEventSchema, ProviderMarketSchema, ProviderQuoteSchema } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { normalizeCmdCatalog, normalizeObservedFootballCatalog, observeNativeCmdMarkets,
  type CmdCatalogInputRecord } from "./cmd-normalizer.js";

describe("normalizeCmdCatalog", () => {
  it("maps SABA type 12 only when its ordered labels prove first-half Odd/Even", () => {
    const options = { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 123,
      timezoneOffsetMinutes: 480, sequence: 7 };
    const group = { betTypeIds: ["12"], labels: ["Even", "Odd"], odds: ["0.93", "0.95"].map((priceText) =>
      ({ marketOddsId: "saba-first-half-oe", priceText, status: null, greyedOut: null })) };
    const input = { ...record, groups: [group] };
    const value = normalizeObservedFootballCatalog("SABA", [input], options);
    expect(value.markets).toEqual([expect.objectContaining({ marketType: "FH_ODD_EVEN", scope: "FIRST_HALF",
      settlementProfile: "football-goals-odd-even-first-half", line: null })]);
    expect(value.quotes.map((quote) => [quote.selection, quote.rawOdds])).toEqual([["EVEN", "0.93"], ["ODD", "0.95"]]);
    for (const invalid of [{ ...group, betTypeIds: ["24"] }, { ...group, labels: [] },
      { ...group, labels: ["Odd", "Odd"] }]) {
      expect(normalizeObservedFootballCatalog("SABA", [{ ...record, groups: [invalid] }], options).markets).toEqual([]);
    }
    expect(normalizeObservedFootballCatalog("CMD", [input], options).markets).toEqual([]);
  });

  it.each([["5", "FULL_TIME"], ["15", "FIRST_HALF"]] as const)(
    "preserves SABA %s decimal prices and the public renderer's unlabeled outcome order", (nativeType, nativeScope) => {
      const input = { ...record, groups: [{ betTypeIds: [nativeType], labels: [],
        odds: ["2.39", "2.54", "3.25"].map((priceText) => ({ marketOddsId: "134039544__1062462885",
          priceText, priceFormat: "DECIMAL" as const, status: null, greyedOut: "false" })) }] };
      const options = { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 123,
        timezoneOffsetMinutes: 480, sequence: 7 };
      const normalized = normalizeObservedFootballCatalog("SABA", [input], options);
      expect(normalized.markets).toHaveLength(1);
      expect(normalized.quotes.map(q => q.selection)).toEqual(["HOME", "AWAY", "DRAW"]);
      expect(observeNativeCmdMarkets("SABA", [input], options)).toEqual([
        expect.objectContaining({ providerMarketId: "134039544__1062462885", nativeType, nativeScope,
          disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED",
          outcomeLabels: ["HOME", "AWAY", "DRAW"],
          nativeSelections: ["2.39", "2.54", "3.25"].map((price) => ({ selectionId: null,
            outcomeId: null, line: null, price, rawFormat: "DECIMAL", status: "OPEN" })) })
      ]);
    });

  it.each([
    ["MAIN:2", "FT_ODD_EVEN", "FULL_TIME", "football-goals-odd-even-regulation"],
    ["FH:2", "FH_ODD_EVEN", "FIRST_HALF", "football-goals-odd-even-first-half"]
  ] as const)("normalizes the proven native %s Odd/Even group with its original market identity", (
    nativeType, marketType, scope, settlementProfile) => {
    const input = { ...record, groups: [{ betTypeIds: [nativeType], labels: ["ODD", "EVEN"],
      odds: ["0.97", "0.91"].map((priceText) => ({ marketOddsId: `native:${nativeType}`, priceText,
        status: null, greyedOut: null })) }] };
    const options = { observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 123,
      timezoneOffsetMinutes: 480, sequence: 7 };
    const normalized = normalizeCmdCatalog([input], options);
    expect(normalized.markets).toEqual([expect.objectContaining({ providerMarketId: `native:${nativeType}`,
      marketType, scope, settlementProfile, line: null })]);
    expect(normalized.quotes.map((quote) => [quote.providerMarketId, quote.selection, quote.rawOdds,
      quote.rawFormat, quote.scope, quote.sequence])).toEqual([
      [`native:${nativeType}`, "ODD", "0.97", "MALAY", scope, 7],
      [`native:${nativeType}`, "EVEN", "0.91", "MALAY", scope, 7]
    ]);
    expect(observeNativeCmdMarkets("CMD", [input], options)).toEqual([
      expect.objectContaining({ nativeType, providerMarketId: `native:${nativeType}`,
        disposition: "NORMALIZED", nativeScope: scope, outcomeLabels: ["ODD", "EVEN"] })
    ]);
  });

  it.each(["TRỰC TIẾP 01:45AM", "01:45AM", "01:45"])(
    "uses only the explicit collector date for undated SABA kickoff %s", (timeText) => {
      const input = { ...record, timeText, groups: [record.groups[1]!] };
      const options = { observedAtMs: Date.UTC(2026, 8, 7, 12), receivedMonotonicMs: 123,
        timezoneOffsetMinutes: 480, sequence: 7, requireExplicitDateForUndatedKickoff: true,
        explicitProviderDate: "2026-09-08" };
      const result = normalizeObservedFootballCatalog("SABA", [input], options);
      expect(result.events[0]?.startAtUtcMs).toBe(Date.UTC(2026, 8, 7, 17, 45));
      expect(result.quotes).toHaveLength(2);
      expect(result.quotes.every((quote) => quote.receivedMonotonicMs === 123 && quote.sequence === 7))
        .toBe(true);
    });

  it.each([undefined, "2026-02-30", "09/08"])(
    "retains an excluded native SABA record when the collector owning date is %s", (explicitProviderDate) => {
      const input = { ...record, timeText: "TRỰC TIẾP 01:45AM", groups: [record.groups[1]!, {
        ...record.groups[1]!, betTypeIds: ["999"], odds: record.groups[1]!.odds.map((odd) =>
          ({ ...odd, marketOddsId: "unknown-native" }))
      }] };
      const options = { observedAtMs: Date.UTC(2026, 8, 7, 12), receivedMonotonicMs: 123,
        timezoneOffsetMinutes: 480, sequence: 7, requireExplicitDateForUndatedKickoff: true,
        ...(explicitProviderDate === undefined ? {} : { explicitProviderDate }) };
      expect(normalizeObservedFootballCatalog("SABA", [input], options).events).toEqual([]);
      expect(observeNativeCmdMarkets("SABA", [input], options)).toEqual([
        expect.objectContaining({ providerMarketId: "total-1", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" }),
        expect.objectContaining({ providerMarketId: "unknown-native", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" })
      ]);
    });

  it("keeps explicitly dated SABA rows and unknown market signatures when collector date is unknown", () => {
    const input = { ...record, timeText: "09/08 05:30PM", groups: [{ ...record.groups[1]!, betTypeIds: ["999"] }] };
    const options = { observedAtMs: Date.UTC(2026, 8, 7, 12), receivedMonotonicMs: 123,
      timezoneOffsetMinutes: 480, sequence: 7, requireExplicitDateForUndatedKickoff: true };
    expect(normalizeObservedFootballCatalog("SABA", [input], options).events[0]?.startAtUtcMs)
      .toBe(Date.UTC(2026, 8, 8, 9, 30));
    expect(observeNativeCmdMarkets("SABA", [input], options)[0])
      .toMatchObject({ disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" });
  });

  it("accepts correctly decoded live labels from provider DOM snapshots", () => {
    for (const timeText of ["TRỰC TIẾP", "LIVE", "1H26'"]) {
      const result = normalizeCmdCatalog([{ ...record, timeText }], {
        observedAtMs: 1_788_000_000_000, receivedMonotonicMs: 1, timezoneOffsetMinutes: 480, sequence: 1
      });
      expect(result.events[0]).toMatchObject({ isLive: true });
    }
  });

  it("reads a stream badge beside a kick-off time as the fixture it precedes", () => {
    // Read on the SABA lobby 2026-09-01 at 23:26 provider time: of 236 rows, 73
    // carried "TRỰC TIẾP" next to a kick-off time - seventy of them an AM time,
    // hours away - and only 17 carried a real clock. "TRỰC TIẾP" there is the
    // book advertising a stream, and the time is when the match will start.
    // Published as in-play they became live tickets whose prices never moved,
    // because the matches had not kicked off.
    const observedAtMs = 1_788_000_000_000;
    const options = { observedAtMs, receivedMonotonicMs: 1, timezoneOffsetMinutes: 480, sequence: 1 };
    const streamed = normalizeCmdCatalog([{ ...record, timeText: "TRỰC TIẾP 01:45AM" }], options);

    expect(streamed.events[0]).toMatchObject({ isLive: false, liveState: null });
    // The advertised time is the kick-off, read in the provider's own timezone.
    const providerNow = new Date(observedAtMs + 480 * 60_000);
    expect(streamed.events[0]?.startAtUtcMs).toBe(Date.UTC(providerNow.getUTCFullYear(),
      providerNow.getUTCMonth(), providerNow.getUTCDate(), 1, 45) - 480 * 60_000);
    expect(streamed.quotes.every((quote) => quote.isLive === false)).toBe(true);
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

  it.each([420, 480])("normalizes explicit SABA public GMT offset %i across UTC date boundaries", (offset) => {
    const result = normalizeObservedFootballCatalog("SABA", [{ ...record, timeText: "09/09 12:30AM",
      providerTimezoneOffsetMinutes: offset }], { observedAtMs: Date.UTC(2026, 8, 8, 20),
      receivedMonotonicMs: 1, timezoneOffsetMinutes: 480, sequence: 1 });
    expect(result.events[0]?.startAtUtcMs).toBe(Date.UTC(2026, 8, 9, 0, 30) - offset * 60_000);
  });

  it("refuses new SABA records with unknown timezone while retaining legacy default behavior", () => {
    const options = { observedAtMs: Date.UTC(2026, 8, 8, 20), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 1 };
    expect(normalizeObservedFootballCatalog("SABA", [{ ...record, providerTimezoneOffsetMinutes: null }], options).events)
      .toEqual([]);
    expect(normalizeObservedFootballCatalog("SABA", [record], options).events).toHaveLength(1);
  });

  it("maps a structurally proven DOM odd/even group without requiring a numeric line", () => {
    const oddEven: CmdCatalogInputRecord = { ...record, groups: [{
      betTypeIds: ["2"], labels: ["o", "e"], odds: [
        { marketOddsId: "odd-even-1", priceText: "0.82", status: null, greyedOut: "false" },
        { marketOddsId: "odd-even-1", priceText: "-0.94", status: null, greyedOut: "false" }
      ]
    }] };
    const options = { observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 1 };

    expect(normalizeObservedFootballCatalog("SABA", [oddEven], options).markets).toEqual([
      expect.objectContaining({ providerMarketId: "odd-even-1", marketType: "FT_ODD_EVEN", line: null })
    ]);
    expect(observeNativeCmdMarkets("SABA", [oddEven], options)).toEqual([
      expect.objectContaining({ nativeType: "2", disposition: "NORMALIZED", outcomeLabels: ["ODD", "EVEN"] })
    ]);
  });

  it("normalizes exact SABA full-time and first-half zero handicaps with stable identities", () => {
    const zeroHandicaps: CmdCatalogInputRecord = { ...structuredClone(record), groups: [
      {
        betTypeIds: ["1"], labels: ["0"], odds: [
          { marketOddsId: "saba-zero-ft", priceText: "0.82", status: null,
            greyedOut: "false", lineText: "0" },
          { marketOddsId: "saba-zero-ft", priceText: "-0.94", status: null,
            greyedOut: "false", lineText: null }
        ]
      },
      {
        betTypeIds: ["7"], labels: ["0"], odds: [
          { marketOddsId: "saba-zero-fh", priceText: "0.84", status: null,
            greyedOut: "false", lineText: "0" },
          { marketOddsId: "saba-zero-fh", priceText: "-0.96", status: null,
            greyedOut: "false", lineText: null }
        ]
      }
    ] };
    const options = { observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 7 };

    const normalized = normalizeObservedFootballCatalog("SABA", [zeroHandicaps], options);
    expect(normalized.markets.map(({ providerMarketId, marketType, scope, line }) =>
      [providerMarketId, marketType, scope, line])).toEqual([
      ["saba-zero-ft", "FT_AH", "FULL_TIME", "0"],
      ["saba-zero-fh", "FH_AH", "FIRST_HALF", "0"]
    ]);
    expect(normalized.quotes.map(({ providerMarketId, providerSelectionId, selection, line }) =>
      [providerMarketId, providerSelectionId, selection, line])).toEqual([
      ["saba-zero-ft", "saba-zero-ft:home", "HOME", "0"],
      ["saba-zero-ft", "saba-zero-ft:away", "AWAY", "0"],
      ["saba-zero-fh", "saba-zero-fh:home", "HOME", "0"],
      ["saba-zero-fh", "saba-zero-fh:away", "AWAY", "0"]
    ]);
    expect(observeNativeCmdMarkets("SABA", [zeroHandicaps], options).map((observation) =>
      [observation.providerMarketId, observation.nativeType, observation.disposition, observation.reason]))
      .toEqual([
        ["saba-zero-ft", "1", "NORMALIZED", "CANONICAL_MARKET_MAPPED"],
        ["saba-zero-fh", "7", "NORMALIZED", "CANONICAL_MARKET_MAPPED"]
      ]);
  });

  it("keeps SABA zero-handicap tolerance out of the CMD normalization path", () => {
    const zero = { ...structuredClone(record), groups: [{ betTypeIds: ["1"], labels: ["0"], odds: [
      { marketOddsId: "cmd-zero", priceText: "0.82", status: null,
        greyedOut: "false", lineText: "0" },
      { marketOddsId: "cmd-zero", priceText: "-0.94", status: null,
        greyedOut: "false", lineText: null }
    ] }] };
    const options = { observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 8 };

    expect(normalizeObservedFootballCatalog("CMD", [zero], options).markets).toEqual([]);
    expect(observeNativeCmdMarkets("CMD", [zero], options)).toEqual([
      expect.objectContaining({ providerMarketId: "cmd-zero", disposition: "EXCLUDED",
        reason: "INVALID_TWO_WAY_SHAPE" })
    ]);
  });

  it.each([
    ["missing line", [
      { marketOddsId: "saba-invalid", priceText: "0.82", status: null, greyedOut: "false" },
      { marketOddsId: "saba-invalid", priceText: "-0.94", status: null, greyedOut: "false" }
    ]],
    ["mismatched IDs", [
      { marketOddsId: "saba-invalid-a", priceText: "0.82", status: null,
        greyedOut: "false", lineText: "0" },
      { marketOddsId: "saba-invalid-b", priceText: "-0.94", status: null,
        greyedOut: "false", lineText: null }
    ]],
    ["inconsistent nonzero signs", [
      { marketOddsId: "saba-invalid", priceText: "0.82", status: null,
        greyedOut: "false", lineText: "+0.5" },
      { marketOddsId: "saba-invalid", priceText: "-0.94", status: null,
        greyedOut: "false", lineText: "+0.5" }
    ]]
  ] as const)("rejects SABA handicap evidence with %s", (_label, odds) => {
    const malformed: CmdCatalogInputRecord = { ...structuredClone(record), groups: [{
      betTypeIds: ["1"], labels: ["0"], odds
    }] };
    const options = { observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 9 };

    const normalized = normalizeObservedFootballCatalog("SABA", [malformed], options);
    expect(normalized.markets).toEqual([]);
    expect(normalized.quotes).toEqual([]);
    expect(observeNativeCmdMarkets("SABA", [malformed], options)).toEqual([
      expect.objectContaining({ disposition: "EXCLUDED", reason: "INVALID_TWO_WAY_SHAPE" })
    ]);
  });

  it("preserves every blank-time SABA native group as non-comparable inventory", () => {
    const market = (betType: string, marketOddsId: string, oddsCount = 2) => ({
      betTypeIds: [betType], labels: betType === "3" ? ["2.5", "u"] : ["0"],
      odds: Array.from({ length: oddsCount }, (_, index) => ({
        marketOddsId, priceText: index % 2 === 0 ? "0.82" : "-0.94",
        status: null, greyedOut: "false",
        ...(betType === "1" && index === 0 ? { lineText: "0" } : {})
      }))
    });
    const blankTime: CmdCatalogInputRecord = { ...structuredClone(record), matchId: "133603577",
      timeText: "", groups: [
        market("1", "1058624279"), market("3", "1058624277"),
        market("5", "1058624275", 3), market("1", "1062389532"),
        market("3", "1062389533")
      ] };
    const options = { observedAtMs: Date.UTC(2026, 7, 15, 8), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 10 };

    const normalized = normalizeObservedFootballCatalog("SABA", [blankTime], options);
    expect(normalized.events).toEqual([]);
    expect(normalized.markets).toEqual([]);
    expect(normalized.quotes).toEqual([]);
    expect(observeNativeCmdMarkets("SABA", [blankTime], options).map((observation) => ({
      providerMarketId: observation.providerMarketId,
      disposition: observation.disposition,
      reason: observation.reason
    }))).toEqual([
      { providerMarketId: "1058624279", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" },
      { providerMarketId: "1058624277", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" },
      { providerMarketId: "1058624275", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" },
      { providerMarketId: "1062389532", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" },
      { providerMarketId: "1062389533", disposition: "EXCLUDED", reason: "EVENT_NOT_COMPARABLE" }
    ]);
  });

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

  it("accounts for every CMD market group without promoting unknown types", () => {
    const result = observeNativeCmdMarkets("CMD", [{ ...record, groups: [
      record.groups[1]!, record.groups[2]!,
      { betTypeIds: ["777"], labels: ["Mystery"], odds: [
        { marketOddsId: "unknown", priceText: "0.8", status: null, greyedOut: "false" },
        { marketOddsId: "unknown", priceText: "-0.9", status: null, greyedOut: "false" }
      ] }
    ] }], { observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 500,
      timezoneOffsetMinutes: 420, sequence: 7 });

    expect(result).toEqual([
      expect.objectContaining({ providerMarketId: "total-1", nativeType: "3", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "1x2-1", nativeType: "5", disposition: "EXCLUDED",
        reason: "NATIVE_RESULT_OUTCOME_UNPROVEN" }),
      expect.objectContaining({ providerMarketId: "unknown", nativeType: "777", disposition: "UNMAPPED",
        reason: "NATIVE_TYPE_UNMAPPED" })
    ]);
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

  it.each(["CMD", "SABA"] as const)(
    "does not invent equivalent half-unit lines from ambiguous %s split totals or handicaps", (provider) => {
      const input: CmdCatalogInputRecord = { ...record, groups: [record.groups[1]!, {
        ...record.groups[1]!, labels: ["2/3", "u"], odds: record.groups[1]!.odds.map((odd) => ({
          ...odd, marketOddsId: "wide-split-total"
        }))
      }, {
        betTypeIds: ["1"], labels: ["0/1"], odds: [
          { marketOddsId: "wide-split-handicap", priceText: "0.80", status: null, greyedOut: "false", lineText: "0/1" },
          { marketOddsId: "wide-split-handicap", priceText: "-0.90", status: null, greyedOut: "false", lineText: null }
        ]
      }] };

      const result = normalizeObservedFootballCatalog(provider, [input], {
        observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
      });

      expect(result.markets.map((market) => [market.marketType, market.line])).toEqual([["FT_TOTAL", "2.5"]]);
      expect(result.events).toHaveLength(1);
      expect(result.quotes).toHaveLength(2);
    });

  it("normalizes explicit first-half handicap and total groups without relabelling their period", () => {
    const periodMarkets: CmdCatalogInputRecord = { ...structuredClone(record), groups: [
      {
        betTypeIds: ["7"], labels: ["0.5/1"], odds: [
          { marketOddsId: "fh-ah", priceText: "0.81", status: null, greyedOut: "false", lineText: "0.5/1" },
          { marketOddsId: "fh-ah", priceText: "-0.91", status: null, greyedOut: "false", lineText: null }
        ]
      },
      {
        betTypeIds: ["8"], labels: ["1/1.5"], odds: [
          { marketOddsId: "fh-total", priceText: "0.82", status: null, greyedOut: "false" },
          { marketOddsId: "fh-total", priceText: "-0.92", status: null, greyedOut: "false" }
        ]
      }
    ] };

    const result = normalizeCmdCatalog([periodMarkets], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 420, sequence: 1
    });

    expect(result.markets).toEqual([
      expect.objectContaining({ marketType: "FH_AH", scope: "FIRST_HALF", line: "-0.75",
        settlementProfile: "football-first-half-including-added-time" }),
      expect.objectContaining({ marketType: "FH_TOTAL", scope: "FIRST_HALF", line: "1.25",
        settlementProfile: "football-first-half-including-added-time" })
    ]);
    expect(result.quotes.map((quote) => [quote.marketType, quote.scope, quote.selection])).toEqual([
      ["FH_AH", "FIRST_HALF", "HOME"], ["FH_AH", "FIRST_HALF", "AWAY"],
      ["FH_TOTAL", "FIRST_HALF", "OVER"], ["FH_TOTAL", "FIRST_HALF", "UNDER"]
    ]);
  });

  it("normalizes CMD corner and booking pseudo-events onto the underlying football fixture", () => {
    const specialGroupRecords: CmdCatalogInputRecord[] = [
      {
        ...structuredClone(record),
        leagueName: "COPA LIBERTADORES - CORNERS",
        teamNames: ["Independiente Rivadavia (No.of Corners)", "Fluminense RJ (No.of Corners)"],
        groups: [
          {
            betTypeIds: ["1"], labels: ["0.5"], odds: [
              { marketOddsId: "corner-ah", priceText: "0.81", status: null, greyedOut: "false", lineText: "0.5" },
              { marketOddsId: "corner-ah", priceText: "-0.91", status: null, greyedOut: "false", lineText: null }
            ]
          },
          {
            betTypeIds: ["3"], labels: ["9.5"], odds: [
              { marketOddsId: "corner-total", priceText: "0.82", status: null, greyedOut: "false" },
              { marketOddsId: "corner-total", priceText: "-0.92", status: null, greyedOut: "false" }
            ]
          },
          {
            betTypeIds: ["7"], labels: ["0.5"], odds: [
              { marketOddsId: "corner-fh-ah", priceText: "0.83", status: null, greyedOut: "false", lineText: "0.5" },
              { marketOddsId: "corner-fh-ah", priceText: "-0.93", status: null, greyedOut: "false", lineText: null }
            ]
          }
        ]
      },
      {
        ...structuredClone(record), matchId: "booking-event",
        leagueName: "CHINA FOOTBALL SUPER LEAGUE - BOOKINGS Ä‘ang táº£i...",
        teamNames: ["Shanghai Shenhua (Total Bookings)", "Beijing Guoan (Total Bookings)"],
        groups: [{
          betTypeIds: ["3"], labels: ["4.5"], odds: [
            { marketOddsId: "card-total", priceText: "0.85", status: null, greyedOut: "false" },
            { marketOddsId: "card-total", priceText: "-0.95", status: null, greyedOut: "false" }
          ]
        }, {
          betTypeIds: ["8"], labels: ["2.5"], odds: [
            { marketOddsId: "card-fh-total", priceText: "0.84", status: null, greyedOut: "false" },
            { marketOddsId: "card-fh-total", priceText: "-0.94", status: null, greyedOut: "false" }
          ]
        }]
      }
    ];

    const result = normalizeCmdCatalog(specialGroupRecords, {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 420, sequence: 1
    });

    expect(result.events).toEqual([
      expect.objectContaining({ competition: "COPA LIBERTADORES", participantA: "Independiente Rivadavia",
        participantB: "Fluminense RJ" }),
      expect.objectContaining({ competition: "CHINA FOOTBALL SUPER LEAGUE", participantA: "Shanghai Shenhua",
        participantB: "Beijing Guoan" })
    ]);
    expect(result.markets.map(({ marketType, scope, line, settlementProfile }) =>
      [marketType, scope, line, settlementProfile])).toEqual([
      ["CORNER_FT_AH", "FULL_TIME", "-0.5", "football-corners-regulation"],
      ["CORNER_FT_TOTAL", "FULL_TIME", "9.5", "football-corners-regulation"],
      ["CORNER_FH_AH", "FIRST_HALF", "-0.5", "football-corners-first-half"],
      ["CARD_FT_TOTAL", "FULL_TIME", "4.5", "football-cards-regulation"],
      ["CARD_FH_TOTAL", "FIRST_HALF", "2.5", "football-cards-first-half"]
    ]);
  });

  it("fails closed on unsupported CMD pseudo-events instead of relabelling them as goal markets", () => {
    const unsupported = [
      { leagueName: "CHINA FOOTBALL SUPER LEAGUE - CORNERS",
        teamNames: ["Shanghai Shenhua (11th Corner)", "Beijing Guoan (11th Corner)"] },
      { leagueName: "CHINA FOOTBALL SUPER LEAGUE - BOOKINGS",
        teamNames: ["Shanghai Shenhua (4th Booking)", "Beijing Guoan (4th Booking)"] },
      { leagueName: "SPECIFIC 15 MINS", teamNames: ["Alpha FC (00:00-15:00)", "Beta FC (00:00-15:00)"] },
      { leagueName: "WHICH TEAM WILL ADVANCE", teamNames: ["Alpha FC", "Beta FC"] },
      { leagueName: "SINGLE TEAM OVER/UNDER", teamNames: ["Alpha FC", "Beta FC"] },
      { leagueName: "FANTASY MATCHES", teamNames: ["Alpha FC", "Beta FC"] }
    ];

    for (const candidate of unsupported) {
      const result = normalizeCmdCatalog([{ ...structuredClone(record), ...candidate }], {
        observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1,
        timezoneOffsetMinutes: 420, sequence: 1
      });
      expect(result).toEqual({ events: [], markets: [], quotes: [],
        diagnostics: ["CMD_CATALOG_EVENT_UNSUPPORTED"] });
    }
  });

  it("treats an unsigned CMD handicap as laid by the team row that displays the line", () => {
    const handicap: CmdCatalogInputRecord = { ...structuredClone(record), groups: [{
      betTypeIds: ["1"], labels: ["0.5"], odds: [
        { marketOddsId: "ah-half", priceText: "0.79", status: null, greyedOut: "false", lineText: "0.5" },
        { marketOddsId: "ah-half", priceText: "-0.87", status: null, greyedOut: "false", lineText: null }
      ]
    }] };

    const homeLays = normalizeObservedFootballCatalog("SABA", [handicap], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 1
    });
    expect(homeLays.markets).toEqual([expect.objectContaining({ marketType: "FT_AH", line: "-0.5" })]);
    expect(homeLays.quotes.map((quote) => [quote.selection, quote.line, quote.rawFormat])).toEqual([
      ["HOME", "-0.5", "MALAY"], ["AWAY", "-0.5", "MALAY"]
    ]);

    const awayHandicap: CmdCatalogInputRecord = { ...handicap, groups: [{ ...handicap.groups[0]!, odds: [
      { ...handicap.groups[0]!.odds[0]!, lineText: null }, { ...handicap.groups[0]!.odds[1]!, lineText: "0.5" }
    ] }] };
    const awayLays = normalizeObservedFootballCatalog("SABA", [awayHandicap], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 2
    });
    expect(awayLays.markets[0]?.line).toBe("0.5");
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

  it("accepts the current CMD dated prematch row when DOM text joins date and 24-hour clock", () => {
    const prematch = { ...record, timeText: "08/2007:30", groups: [record.groups[1]!] };
    const result = normalizeCmdCatalog([prematch], {
      observedAtMs: Date.UTC(2026, 7, 19, 2), receivedMonotonicMs: 1,
      timezoneOffsetMinutes: 480, sequence: 1
    });

    expect(result.events[0]).toEqual(expect.objectContaining({
      isLive: false,
      startAtUtcMs: Date.UTC(2026, 7, 19, 23, 30)
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

  it("retains non-virtual quarter and integer lines for catalog accounting", () => {
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
    expect(result.markets.map(({ marketType, line }) => [marketType, line])).toEqual([
      ["FT_TOTAL", "2.5"], ["FT_TOTAL", "3"]
    ]);

    const virtual = normalizeCmdCatalog([{ ...filtered, leagueName: "Virtual Football", teamNames: ["A (V)", "B (V)"] }], {
      observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: 1, timezoneOffsetMinutes: 420, sequence: 2
    });
    expect(virtual).toEqual({ events: [], markets: [], quotes: [], diagnostics: ["CMD_CATALOG_EVENT_UNSUPPORTED"] });
  });
});

describe("SABA multi-match aggregate accounting", () => {
  const options = { observedAtMs: Date.UTC(2026, 8, 7, 14), receivedMonotonicMs: 1,
    timezoneOffsetMinutes: 480, sequence: 91 };
  const groups = (stem: string): CmdCatalogInputRecord["groups"] => [
    { betTypeIds: ["1"], labels: ["0.5"], odds: [
      { marketOddsId: `${stem}-1`, priceText: "0.90", status: null, greyedOut: "false", lineText: "0.5" },
      { marketOddsId: `${stem}-1`, priceText: "-0.95", status: null, greyedOut: "false" }
    ] },
    { betTypeIds: ["3"], labels: ["2.5"], odds: [
      { marketOddsId: `${stem}-3`, priceText: "0.88", status: null, greyedOut: "false" },
      { marketOddsId: `${stem}-3`, priceText: "-0.92", status: null, greyedOut: "false" }
    ] },
    { betTypeIds: ["7"], labels: ["0.5"], odds: [
      { marketOddsId: `${stem}-7`, priceText: "0.86", status: null, greyedOut: "false", lineText: "0.5" },
      { marketOddsId: `${stem}-7`, priceText: "-0.90", status: null, greyedOut: "false" }
    ] },
    { betTypeIds: ["8"], labels: ["1.5"], odds: [
      { marketOddsId: `${stem}-8`, priceText: "0.84", status: null, greyedOut: "false" },
      { marketOddsId: `${stem}-8`, priceText: "-0.88", status: null, greyedOut: "false" }
    ] },
    { betTypeIds: ["2"], labels: ["o", "e"], odds: [
      { marketOddsId: `${stem}-2`, priceText: "0.82", status: null, greyedOut: "false" },
      { marketOddsId: `${stem}-2`, priceText: "-0.86", status: null, greyedOut: "false" }
    ] }
  ];
  const fixture = (matchId: string, leagueName: string, teamNames: string[]): CmdCatalogInputRecord => ({
    sportId: "1", leagueId: `league-${matchId}`, leagueName, matchId,
    timeText: "09/08 12:00AM", teamNames, groups: groups(matchId)
  });
  const actual = [
    fixture("134003685", "*GIẢI SERIE A Ý - ĐỘI NHÀ/ĐỘI KHÁCH",
      ["Đội Nhà - Thứ Hai - 2 Trận Đấu", "Đội Khách - Thứ Hai - 2 Trận Đấu"]),
    fixture("134003749", "*GIẢI LALIGA TÂY BAN NHA - ĐỘI NHÀ/ĐỘI KHÁCH",
      ["Đội Nhà - Thứ Hai - 2 Trận Đấu", "Đội Khách - Thứ Hai - 2 Trận Đấu"]),
    fixture("134019593", "GIẢI ALLSVENSKAN THỤY ĐIỂN - ĐỘI NHÀ/ĐỘI KHÁCH",
      ["Đội Nhà - Thứ Hai - 3 Trận Đấu", "Đội Khách - Thứ Hai - 3 Trận Đấu"])
  ];

  it("excludes all three observed SABA aggregates while retaining every native group", () => {
    expect(normalizeObservedFootballCatalog("SABA", actual, options)).toMatchObject({
      events: [], markets: [], quotes: []
    });
    const inventory = observeNativeCmdMarkets("SABA", actual, options);
    expect(inventory).toHaveLength(15);
    expect(inventory.every(({ disposition, reason }) => disposition === "EXCLUDED" &&
      reason === "EVENT_NOT_COMPARABLE")).toBe(true);
    expect(new Set(inventory.map(({ providerMarketId }) => providerMarketId))).toEqual(new Set(
      actual.flatMap(({ groups: nativeGroups }) => nativeGroups.map((group) => group.odds[0]!.marketOddsId))));

    expect(normalizeObservedFootballCatalog("CMD", [actual[2]!], options).markets).toHaveLength(5);
    expect(observeNativeCmdMarkets("CMD", [actual[2]!], options)
      .every(({ disposition }) => disposition === "NORMALIZED")).toBe(true);
  });

  it.each([
    ["ordinary competition", "League One", ["Đội Nhà - Thứ Hai - 2 Trận Đấu", "Đội Khách - Thứ Hai - 2 Trận Đấu"]],
    ["only one role", "League One - ĐỘI NHÀ/ĐỘI KHÁCH", ["Đội Nhà - Thứ Hai - 2 Trận Đấu", "Real Away"]],
    ["mismatched bucket", "League One - ĐỘI NHÀ/ĐỘI KHÁCH", ["Đội Nhà - Thứ Hai - 2 Trận Đấu", "Đội Khách - Thứ Ba - 2 Trận Đấu"]],
    ["mismatched count", "League One - ĐỘI NHÀ/ĐỘI KHÁCH", ["Đội Nhà - Thứ Hai - 2 Trận Đấu", "Đội Khách - Thứ Hai - 3 Trận Đấu"]],
    ["single match", "League One - ĐỘI NHÀ/ĐỘI KHÁCH", ["Đội Nhà - Thứ Hai - 1 Trận Đấu", "Đội Khách - Thứ Hai - 1 Trận Đấu"]]
  ])("keeps the %s near miss eligible", (_label, leagueName, teamNames) => {
    const result = normalizeObservedFootballCatalog("SABA", [fixture("near", leagueName, teamNames)], options);
    expect(result.events).toHaveLength(1);
    expect(result.markets).toHaveLength(5);
  });
});
