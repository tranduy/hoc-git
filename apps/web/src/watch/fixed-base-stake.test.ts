import type { MarketType, ProviderId, ProviderMarket, ProviderQuote, Scope } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { ComparisonCell, ComparisonRow } from "../catalog/comparison.js";
import { buildFixedBaseStakePlan, buildObservedAnchoredStakeEstimate, buildObservedFixedBaseStakeEstimate,
  enumerateOpposingLegPairs, type FixedBaseStakePolicy } from "./fixed-base-stake.js";

const selected = new Set<ProviderId>(["SABA", "SBOBET"]);
const policy: FixedBaseStakePolicy = {
  currency: "VND", baseStake: "100000", minStake: "30000",
  maxStake: "100000", stakeStep: "1000", balance: "100000"
};

function cell(provider: "SABA" | "SBOBET" | "IM", marketType: "FT_TOTAL" | "FT_AH" | "FT_1X2",
  prices: Readonly<Record<string, string>>, status: "OPEN" | "SUSPENDED" = "OPEN",
  handicapLine = "-0.5"): ComparisonCell {
  const providerEventId = `${provider}-event`;
  const providerMarketId = `${provider}-${marketType}`;
  const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId, providerMarketId,
    marketType, scope: "FULL_TIME", line: marketType === "FT_TOTAL" ? "2.5" : marketType === "FT_AH" ? handicapLine : null,
    settlementProfile: "football-regulation-including-added-time", status };
  const quotes: ProviderQuote[] = Object.entries(prices).map(([selection, rawOdds]) => ({
    provider, category: "FOOTBALL", providerEventId, providerMarketId,
    providerSelectionId: `${provider}-${selection}`, marketType, scope: "FULL_TIME", selection,
    line: market.line, rawOdds, rawFormat: "DECIMAL", status, isLive: true,
    sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1
  }));
  return { provider, market, quotes };
}

function row(marketType: "FT_TOTAL" | "FT_AH" | "FT_1X2", cells: readonly ComparisonCell[], line?: string): ComparisonRow {
  return { key: `${marketType}|FULL_TIME|2.5|settlement`, marketType, scope: "FULL_TIME",
    line: line ?? (marketType === "FT_TOTAL" ? "2.5" : marketType === "FT_AH" ? "-0.5" : null),
    cells, bestBySelection: {}, margin: null, crossBook: true };
}

describe("fixed-base two-way stake planning", () => {
  it.each([
    ["SH_TOTAL", "SECOND_HALF", "football-second-half-including-added-time", "2.25", "OVER", "UNDER"],
    ["CORNER_FT_TOTAL", "FULL_TIME", "football-corners-regulation", "2.75", "OVER", "UNDER"],
    ["CORNER_FH_AH", "FIRST_HALF", "football-corners-first-half", "-0.25", "HOME", "AWAY"],
    ["CARD_FT_AH", "FULL_TIME", "football-cards-regulation", "-0.75", "HOME", "AWAY"],
    ["CARD_FH_TOTAL", "FIRST_HALF", "football-cards-first-half", "3.25", "OVER", "UNDER"]
  ] as const)("balances exact %s quarter-line settlement without a both-loss state",
    (marketType, scope, settlementProfile, line, firstSelection, secondSelection) => {
      const expandedCell = (provider: "SABA" | "SBOBET", selection: string): ComparisonCell => {
        const providerEventId = `${provider}-event`;
        const providerMarketId = `${provider}-${marketType}`;
        const market: ProviderMarket = { provider, category: "FOOTBALL", providerEventId, providerMarketId,
          marketType: marketType as MarketType, scope: scope as Scope, line, settlementProfile, status: "OPEN" };
        const quote: ProviderQuote = { provider, category: "FOOTBALL", providerEventId, providerMarketId,
          providerSelectionId: `${provider}-${selection}`, marketType: marketType as MarketType,
          scope: scope as Scope, selection, line, rawOdds: "2.2", rawFormat: "DECIMAL", status: "OPEN",
          isLive: true, sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 };
        return { provider, market, quotes: [quote] };
      };
      const expandedRow: ComparisonRow = { key: `${marketType}|${scope}|${line}|${settlementProfile}`,
        marketType: marketType as MarketType, scope: scope as Scope, line,
        cells: [expandedCell("SABA", firstSelection), expandedCell("SBOBET", secondSelection)],
        bestBySelection: {}, margin: null, crossBook: true };
      const plan = buildObservedFixedBaseStakeEstimate(expandedRow, selected, policy);
      expect(plan).not.toBeNull();
      expect(Number(plan?.profitsBySelection[firstSelection])).toBeGreaterThan(0);
      expect(Number(plan?.profitsBySelection[secondSelection])).toBeGreaterThan(0);
      expect(Number(plan?.worstCaseProfit)).toBeGreaterThanOrEqual(10000);
    });

  it("rejects selections that are not the exact opposing domain for the market", () => {
    const malformed = row("FT_AH", [
      cell("SABA", "FT_AH", { OVER: "2.5" }),
      cell("SBOBET", "FT_AH", { UNDER: "2.5" })
    ]);

    expect(enumerateOpposingLegPairs(malformed, selected)).toEqual([]);
    expect(buildObservedFixedBaseStakeEstimate(malformed, selected, policy)).toBeNull();
  });

  it("rejects pairs whose providers use different settlement profiles", () => {
    const saba = cell("SABA", "FT_AH", { HOME: "2.5" });
    const sbobet = cell("SBOBET", "FT_AH", { AWAY: "2.5" });
    const malformed = row("FT_AH", [saba, {
      ...sbobet,
      market: { ...sbobet.market, settlementProfile: "football-including-extra-time" }
    }]);

    expect(enumerateOpposingLegPairs(malformed, selected)).toEqual([]);
    expect(buildObservedFixedBaseStakeEstimate(malformed, selected, policy)).toBeNull();
  });

  it("rejects a quote whose provider market provenance contradicts its cell", () => {
    const saba = cell("SABA", "FT_AH", { HOME: "2.5" });
    const malformedSaba = {
      ...saba,
      quotes: saba.quotes.map((quote) => ({ ...quote, providerMarketId: "another-market" }))
    };
    const malformed = row("FT_AH", [malformedSaba, cell("SBOBET", "FT_AH", { AWAY: "2.5" })]);

    expect(enumerateOpposingLegPairs(malformed, selected)).toEqual([]);
    expect(buildObservedFixedBaseStakeEstimate(malformed, selected, policy)).toBeNull();
  });

  it("rejects an ambiguous provider cell with duplicate selections", () => {
    const saba = cell("SABA", "FT_AH", { HOME: "2.5" });
    const duplicateHome = {
      ...saba.quotes[0]!,
      providerSelectionId: "SABA-HOME-duplicate",
      rawOdds: "2.6"
    };
    const malformed = row("FT_AH", [
      { ...saba, quotes: [...saba.quotes, duplicateHome] },
      cell("SBOBET", "FT_AH", { AWAY: "2.5" })
    ]);

    expect(enumerateOpposingLegPairs(malformed, selected)).toEqual([]);
    expect(buildObservedFixedBaseStakeEstimate(malformed, selected, policy)).toBeNull();
  });

  it("rejects the same handicap side quoted by two different providers", () => {
    const sameSide = row("FT_AH", [
      cell("SABA", "FT_AH", { HOME: "2.5" }),
      cell("SBOBET", "FT_AH", { HOME: "2.6" })
    ]);

    expect(enumerateOpposingLegPairs(sameSide, selected)).toEqual([]);
    expect(buildObservedFixedBaseStakeEstimate(sameSide, selected, policy)).toBeNull();
  });

  it("accepts HOME -0.5 against AWAY +0.5 even when both displayed Malay prices are negative", () => {
    const withMalayPrice = (value: ComparisonCell): ComparisonCell => ({
      ...value,
      quotes: value.quotes.map((quote) => ({ ...quote, rawFormat: "MALAY" as const }))
    });
    const exactOpposites = row("FT_AH", [
      withMalayPrice(cell("SABA", "FT_AH", { HOME: "-0.65" })),
      withMalayPrice(cell("SBOBET", "FT_AH", { AWAY: "-0.65" }))
    ]);

    const plan = buildFixedBaseStakePlan(exactOpposites, selected, policy);

    expect(plan?.legs.map(({ provider, selection }) => ({ provider, selection }))
      .sort((left, right) => left.provider.localeCompare(right.provider))).toEqual([
      { provider: "SABA", selection: "HOME" },
      { provider: "SBOBET", selection: "AWAY" }
    ]);
    expect(Number(plan?.worstCaseProfit)).toBeGreaterThan(0);
  });

  it.each([
    ["FT_TOTAL" as const, "2.25", "OVER", "UNDER"],
    ["FT_TOTAL" as const, "2.75", "OVER", "UNDER"],
    ["FT_AH" as const, "-0.25", "HOME", "AWAY"],
    ["FT_AH" as const, "-0.75", "HOME", "AWAY"]
  ])("prices %s line %s against every full and half settlement state", (marketType, line, first, second) => {
    const left = cell("SABA", marketType, { [first]: "2.2" }, "OPEN", line);
    const right = cell("SBOBET", marketType, { [second]: "2.2" }, "OPEN", line);
    const withLine = (value: ComparisonCell): ComparisonCell => ({
      ...value, market: { ...value.market, line }, quotes: value.quotes.map((quote) => ({ ...quote, line }))
    });

    const plan = buildObservedFixedBaseStakeEstimate(row(marketType, [withLine(left), withLine(right)], line), selected, policy);

    expect(plan).not.toBeNull();
    expect(Number(plan?.worstCaseProfit)).toBeGreaterThanOrEqual(10000);
    expect(Number(plan?.roi)).toBeGreaterThanOrEqual(0.05);
  });

  it("assigns the half-loss and half-win sides correctly for a negative quarter handicap", () => {
    const candidate = row("FT_AH", [
      cell("SABA", "FT_AH", { HOME: "3" }, "OPEN", "-0.25"),
      cell("SBOBET", "FT_AH", { AWAY: "2" }, "OPEN", "-0.25")
    ], "-0.25");
    const pair = enumerateOpposingLegPairs(candidate, selected)[0]!;
    const exactVndPolicy: FixedBaseStakePolicy = {
      ...policy, maxStake: "120000", stakeStep: "1", balance: "120000"
    };

    const plan = buildObservedAnchoredStakeEstimate(candidate, pair, exactVndPolicy, {
      provider: "SABA", selection: "HOME", stake: "100000"
    });

    expect(plan?.legs.find((leg) => leg.provider === "SBOBET")?.stake).toBe("120000");
    expect(plan?.worstCaseProfit).toBe("10000");
  });

  it("maximizes the worst-case return for the observed BTI -0.25 versus CMD +0.25 prices", () => {
    const withMalayPrice = (value: ComparisonCell): ComparisonCell => ({
      ...value,
      quotes: value.quotes.map((quote) => ({ ...quote, rawFormat: "MALAY" as const }))
    });
    const candidate = row("FT_AH", [
      withMalayPrice(cell("SABA", "FT_AH", { HOME: "-0.70" }, "OPEN", "-0.25")),
      withMalayPrice(cell("SBOBET", "FT_AH", { AWAY: "-0.78" }, "OPEN", "-0.25"))
    ], "-0.25");
    const pair = enumerateOpposingLegPairs(candidate, selected)[0]!;
    const exactVndPolicy: FixedBaseStakePolicy = {
      ...policy, baseStake: "500000", maxStake: "1000000", stakeStep: "1", balance: "1000000"
    };

    const plan = buildObservedAnchoredStakeEstimate(candidate, pair, exactVndPolicy, {
      provider: "SBOBET", selection: "AWAY", stake: "500000"
    });

    expect(plan?.legs.find((leg) => leg.provider === "SABA")?.stake).toBe("425451");
    expect(Number(plan?.worstCaseProfit)).toBeCloseTo(107787.142857, 5);
    expect(Number(plan?.roi)).toBeCloseTo(0.11647, 5);
  });

  it("rejects an Asian handicap pair when provider canonical lines disagree", () => {
    const malformed = row("FT_AH", [
      cell("SABA", "FT_AH", { HOME: "2.5", AWAY: "1.5" }, "OPEN", "-0.5"),
      cell("IM", "FT_AH", { HOME: "1.5", AWAY: "2.5" }, "OPEN", "0.5")
    ]);

    expect(enumerateOpposingLegPairs(malformed, new Set<ProviderId>(["SABA", "IM"]))).toEqual([]);
    expect(buildObservedFixedBaseStakeEstimate(malformed, new Set<ProviderId>(["SABA", "IM"]), policy)).toBeNull();
  });

  it("enumerates every opposing selection pair across distinct selected providers", () => {
    const candidate = row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "2.1", UNDER: "2.05" }),
      cell("SBOBET", "FT_TOTAL", { OVER: "2.2", UNDER: "2.15" }),
      cell("IM", "FT_TOTAL", { OVER: "2.3", UNDER: "2.25" })
    ]);

    const pairs = enumerateOpposingLegPairs(candidate, new Set<ProviderId>(["SABA", "SBOBET", "IM"]));

    expect(pairs).toHaveLength(6);
    expect(pairs.map((pair) => `${pair.first.provider}:${pair.first.quote.selection}|${pair.second.provider}:${pair.second.quote.selection}`))
      .toEqual([
        "IM:OVER|SABA:UNDER", "IM:OVER|SBOBET:UNDER", "SABA:OVER|IM:UNDER",
        "SABA:OVER|SBOBET:UNDER", "SBOBET:OVER|IM:UNDER", "SBOBET:OVER|SABA:UNDER"
      ]);
  });

  it("falls back from the highest raw quote when that provider cannot fund the leg", () => {
    const constraint = { currency: "VND", minStake: "30000", maxStake: "500000", stakeStep: "1000",
      balance: "500000", feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: 900, expiresAtMs: 1100 };
    const candidate = row("FT_TOTAL", [
      cell("IM", "FT_TOTAL", { OVER: "2.4" }),
      cell("SABA", "FT_TOTAL", { OVER: "2.2" }),
      cell("SBOBET", "FT_TOTAL", { UNDER: "2.3" })
    ]);

    const plan = buildFixedBaseStakePlan(candidate, new Set<ProviderId>(["IM", "SABA", "SBOBET"]), {
      ...policy, requireProviderConstraints: true, providerConstraints: {
        IM: { ...constraint, balance: "50000" }, SABA: constraint, SBOBET: constraint
      }
    }, 1000);

    expect(plan?.legs.map(({ provider, selection }) => ({ provider, selection }))).toEqual([
      { provider: "SABA", selection: "OVER" }, { provider: "SBOBET", selection: "UNDER" }
    ]);
    expect(Number(plan?.worstCaseProfit)).toBeGreaterThan(0);
  });

  it("fixes 100000 on odds 1.8 and balances odds 2.5 with 72000", () => {
    const plan = buildFixedBaseStakePlan(row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8", UNDER: "1.5" }),
      cell("SBOBET", "FT_TOTAL", { OVER: "1.7", UNDER: "2.5" })
    ]), selected, policy);

    expect(plan).toMatchObject({
      legs: [
        { provider: "SABA", selection: "OVER", decimalOdds: "1.8", stake: "100000", role: "BASE", profit: "8000" },
        { provider: "SBOBET", selection: "UNDER", decimalOdds: "2.5", stake: "72000", role: "HEDGE", profit: "8000" }
      ],
      totalStake: "172000", profitsBySelection: { OVER: "8000", UNDER: "8000" },
      worstCaseProfit: "8000", roi: "0.04651162790697674418604651162790697674419"
    });
  });

  it("anchors either ticket leg independently and rounds only the calculated leg to 1000 VND", () => {
    const candidate = row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8" }),
      cell("SBOBET", "FT_TOTAL", { UNDER: "2.5" })
    ]);
    const [pair] = enumerateOpposingLegPairs(candidate, selected);
    expect(pair).toBeDefined();

    const anchoredLow = buildObservedAnchoredStakeEstimate(candidate, pair!, policy,
      { provider: "SABA", selection: "OVER", stake: "100000" });
    const anchoredHigh = buildObservedAnchoredStakeEstimate(candidate, pair!, policy,
      { provider: "SBOBET", selection: "UNDER", stake: "50000" });

    expect(anchoredLow).toMatchObject({
      legs: [
        { provider: "SABA", selection: "OVER", stake: "100000", role: "BASE" },
        { provider: "SBOBET", selection: "UNDER", stake: "72000", role: "HEDGE" }
      ],
      profitsBySelection: { OVER: "8000", UNDER: "8000" }
    });
    expect(anchoredHigh).toMatchObject({
      legs: [
        { provider: "SBOBET", selection: "UNDER", stake: "50000", role: "BASE" },
        { provider: "SABA", selection: "OVER", stake: "69000", role: "HEDGE" }
      ],
      totalStake: "119000", profitsBySelection: { UNDER: "6000", OVER: "5200" },
      worstCaseProfit: "5200"
    });
  });

  it("fails closed when an anchored stake is invalid or outside provider constraints", () => {
    const candidate = row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8" }),
      cell("SBOBET", "FT_TOTAL", { UNDER: "2.5" })
    ]);
    const [pair] = enumerateOpposingLegPairs(candidate, selected);
    expect(buildObservedAnchoredStakeEstimate(candidate, pair!, policy,
      { provider: "SABA", selection: "OVER", stake: "99999" })).toBeNull();
    expect(buildObservedAnchoredStakeEstimate(candidate, pair!, policy,
      { provider: "SABA", selection: "OVER", stake: "not-a-number" })).toBeNull();
    expect(buildObservedAnchoredStakeEstimate(candidate, pair!, policy,
      { provider: "IM", selection: "OVER", stake: "100000" })).toBeNull();
  });

  it("rejects three outcomes even when their inverse sum is profitable", () => {
    expect(buildFixedBaseStakePlan(row("FT_1X2", [
      cell("SABA", "FT_1X2", { HOME: "4", DRAW: "4", AWAY: "2" }),
      cell("SBOBET", "FT_1X2", { HOME: "3", DRAW: "3", AWAY: "4" })
    ]), selected, policy)).toBeNull();
  });

  it("shows a balanced observational estimate even when the current cross-book prices lose money", () => {
    const candidate = row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8", UNDER: "1.7" }),
      cell("SBOBET", "FT_TOTAL", { OVER: "1.75", UNDER: "1.982" })
    ]);

    expect(buildFixedBaseStakePlan(candidate, selected, policy)).toBeNull();
    expect(buildObservedFixedBaseStakeEstimate(candidate, selected, policy)).toMatchObject({
      legs: [
        { provider: "SABA", selection: "OVER", stake: "100000" },
        { provider: "SBOBET", selection: "UNDER", stake: "91000" }
      ],
      totalStake: "191000", worstCaseProfit: "-11000"
    });
  });

  it.each([
    ["same provider", [cell("SABA", "FT_TOTAL", { OVER: "2.2", UNDER: "2.2" })]],
    ["not profitable after rounding", [cell("SABA", "FT_TOTAL", { OVER: "1.95" }), cell("SBOBET", "FT_TOTAL", { UNDER: "1.95" })]],
    ["suspended quote", [cell("SABA", "FT_TOTAL", { OVER: "2.2" }, "SUSPENDED"), cell("SBOBET", "FT_TOTAL", { UNDER: "2.2" })]]
  ])("rejects %s", (_name, cells) => {
    expect(buildFixedBaseStakePlan(row("FT_TOTAL", cells as readonly ComparisonCell[]), selected, policy)).toBeNull();
  });

  it("uses separate provider limits, balance and stake steps", () => {
    const strictPolicy: FixedBaseStakePolicy = { ...policy, requireProviderConstraints: true,
      providerConstraints: {
        SABA: { currency: "VND", minStake: "50000", maxStake: "200000", stakeStep: "5000",
          balance: "200000", feeType: "NONE", feeRate: null, verifiedAsOfMs: 900, expiresAtMs: 1100 },
        SBOBET: { currency: "VND", minStake: "25000", maxStake: "100000", stakeStep: "500",
          balance: "80000", feeType: "NONE", feeRate: null, verifiedAsOfMs: 900, expiresAtMs: 1100 }
      } };
    const plan = buildFixedBaseStakePlan(row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8" }), cell("SBOBET", "FT_TOTAL", { UNDER: "2.5" })
    ]), selected, strictPolicy, 1000);
    expect(plan?.legs).toMatchObject([{ provider: "SABA", stake: "100000" }, { provider: "SBOBET", stake: "72000" }]);
  });

  it("fails closed when either provider constraint is missing, expired, or cannot fund its leg", () => {
    const candidate = row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "1.8" }), cell("SBOBET", "FT_TOTAL", { UNDER: "2.5" })
    ]);
    const saba = { currency: "VND", minStake: "50000", maxStake: "200000", stakeStep: "1000",
      balance: "200000", feeType: "NONE" as const, feeRate: null, verifiedAsOfMs: 900, expiresAtMs: 1100 };
    expect(buildFixedBaseStakePlan(candidate, selected,
      { ...policy, requireProviderConstraints: true, providerConstraints: { SABA: saba } }, 1000)).toBeNull();
    expect(buildFixedBaseStakePlan(candidate, selected, { ...policy, requireProviderConstraints: true,
      providerConstraints: { SABA: saba, SBOBET: { ...saba, balance: "50000" } } }, 1000)).toBeNull();
    expect(buildFixedBaseStakePlan(candidate, selected, { ...policy, requireProviderConstraints: true,
      providerConstraints: { SABA: { ...saba, expiresAtMs: 999 }, SBOBET: saba } }, 1000)).toBeNull();
  });

  it("calculates profit after provider fees and rejects a gross-only edge", () => {
    const constraint = { currency: "VND", minStake: "1000", maxStake: "200000", stakeStep: "1000",
      balance: "200000", feeType: "PROFIT" as const, feeRate: "0.2", verifiedAsOfMs: 900, expiresAtMs: 1100 };
    const candidate = row("FT_TOTAL", [
      cell("SABA", "FT_TOTAL", { OVER: "2.02" }), cell("SBOBET", "FT_TOTAL", { UNDER: "2.02" })
    ]);
    expect(buildFixedBaseStakePlan(candidate, selected, { ...policy, requireProviderConstraints: true,
      providerConstraints: { SABA: constraint, SBOBET: constraint } }, 1000)).toBeNull();
  });
});
