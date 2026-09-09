import { describe, expect, it } from "vitest";
import {
  mapMarkets,
  mapEvents,
  type MappingPolicy,
  type NormalizedMarket,
  type NormalizedFootballEvent,
  type NormalizedLolEvent,
  type VersionedAliasRegistry
} from "../index.js";

const aliasRegistry: VersionedAliasRegistry = {
  version: "2026-08-09.mapping-1",
  aliases: {
    FOOTBALL: { arsenal: "arsenal", chelsea: "chelsea" },
    LOL: { geng: "gen_g", gen_g: "gen_g", t1: "t1" }
  }
};

const policy: MappingPolicy = {
  prematchToleranceMs: 120_000,
  liveClockToleranceMs: 20_000,
  aliasRegistry
};

const footballEvent = (provider: string, providerEventId: string): NormalizedFootballEvent => ({
  provider,
  category: "FOOTBALL",
  providerEventId,
  competition: "epl",
  seasonStage: "2026-27",
  startAtUtcMs: Date.parse("2026-08-09T12:00:00.000Z"),
  participantA: "Arsenal",
  participantB: "Chelsea",
  canonicalParticipantA: "arsenal",
  canonicalParticipantB: "chelsea",
  eventScope: "REGULAR_TIME",
  bestOf: null,
  isLive: false,
  isVirtual: false,
  sportVariant: "FOOTBALL",
  rematchCandidate: false,
  fixtureDiscriminator: null,
  liveState: null
});

const lolEvent = (
  provider: string,
  providerEventId: string,
  reversed = false
): NormalizedLolEvent => ({
  provider,
  category: "LOL",
  providerEventId,
  competition: "lck",
  seasonStage: "summer-2026",
  startAtUtcMs: Date.parse("2026-08-09T12:00:00.000Z"),
  participantA: reversed ? "T1" : "Gen.G",
  participantB: reversed ? "Gen.G" : "T1",
  canonicalParticipantA: reversed ? "t1" : "gen_g",
  canonicalParticipantB: reversed ? "gen_g" : "t1",
  eventScope: "SERIES",
  bestOf: 3,
  isLive: false,
  gameVariant: "LOL_PC",
  rematchCandidate: false,
  fixtureDiscriminator: null,
  liveState: null
});

const footballMapping = mapEvents(
  footballEvent("SABA", "saba-football"),
  footballEvent("IM", "im-football"),
  policy
);

const lolMapping = mapEvents(
  lolEvent("SABA", "saba-lol"),
  lolEvent("IM", "im-lol", true),
  policy
);

const footballMarket = (overrides: Partial<NormalizedMarket> = {}): NormalizedMarket => ({
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "saba-football",
  providerMarketId: "saba-market",
  marketType: "FT_TOTAL",
  scope: "FULL_TIME",
  line: "2.50",
  settlementProfile: "sha256:football-regular-time-v1",
  status: "OPEN",
  selections: [
    { providerSelectionId: "saba-over", canonicalOutcomeId: "OVER" },
    { providerSelectionId: "saba-under", canonicalOutcomeId: "UNDER" }
  ],
  ...overrides
});

const imFootballMarket = (overrides: Partial<NormalizedMarket> = {}): NormalizedMarket =>
  footballMarket({
    provider: "IM",
    providerEventId: "im-football",
    providerMarketId: "im-market",
    selections: [
      { providerSelectionId: "im-under", canonicalOutcomeId: "UNDER" },
      { providerSelectionId: "im-over", canonicalOutcomeId: "OVER" }
    ],
    ...overrides
  });

const lolMarket = (overrides: Partial<NormalizedMarket> = {}): NormalizedMarket => ({
  provider: "SABA",
  category: "LOL",
  providerEventId: "saba-lol",
  providerMarketId: "saba-lol-market",
  marketType: "MAP_WINNER",
  scope: "MAP_2",
  line: null,
  settlementProfile: "sha256:lol-map-standard-v1",
  status: "OPEN",
  selections: [
    { providerSelectionId: "saba-gen-g", canonicalOutcomeId: "gen_g" },
    { providerSelectionId: "saba-t1", canonicalOutcomeId: "t1" }
  ],
  ...overrides
});

const imLolMarket = (overrides: Partial<NormalizedMarket> = {}): NormalizedMarket =>
  lolMarket({
    provider: "IM",
    providerEventId: "im-lol",
    providerMarketId: "im-lol-market",
    selections: [
      { providerSelectionId: "im-t1", canonicalOutcomeId: "t1" },
      { providerSelectionId: "im-gen-g", canonicalOutcomeId: "gen_g" }
    ],
    ...overrides
  });

describe("mapMarkets hard gates", () => {
  const namedPlayerMarket = (right = false, overrides: Partial<NormalizedMarket> = {}): NormalizedMarket =>
    (right ? imFootballMarket : footballMarket)({ marketType: "PLAYER_FT_SHOTS_TOTAL", line: "1.5",
      settlementProfile: "football-player-shots-regulation", player: { providerPlayerId: right ? "native-right" : "native-left",
        name: "Brian Aguirre", teamSide: "HOME" }, ...overrides });

  it("withholds execution and canonical identity until a same-name player has explicit identity evidence", () => {
    const result = mapMarkets(footballMapping, namedPlayerMarket(), namedPlayerMarket(true));
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.executionConfidence).toBe("BLOCKED");
    expect(result.canonicalMarketId).toBeNull();
    expect(result.selectionMappings).toEqual([]);
    expect(result.evidence.find(item => item.gate === "resolvedPlayerIdentity")?.reason)
      .toContain("MISSING_MANDATORY_EVIDENCE");
  });

  it.each([
    { providerPlayerId: "native-right", name: "Lucas Alario", teamSide: "HOME" },
    { providerPlayerId: "native-left", name: "Brian Aguirre", teamSide: "AWAY" }
  ] as const)("rejects a different player or team even if all market terms match: %j", player => {
    const result = mapMarkets(footballMapping, namedPlayerMarket(), namedPlayerMarket(true, { player }));
    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find(item => item.gate === "resolvedPlayerIdentity")?.reason).toContain("CONTRADICTION");
    expect(result.executionConfidence).toBe("BLOCKED");
  });

  it.each([undefined, { providerPlayerId: "native-right", name: "Brian Aguirre", teamSide: null },
    { providerPlayerId: "native-right", name: "B. Aguirre", teamSide: "HOME" }] as const)(
    "requires review instead of joining a player with missing team or full name evidence %j", player => {
      const right = namedPlayerMarket(true);
      const { player: _knownPlayer, ...withoutPlayer } = right;
      const result = mapMarkets(footballMapping, namedPlayerMarket(), player === undefined ? withoutPlayer : { ...right, player });
      expect(result.status).toBe("REVIEW_REQUIRED");
      expect(result.canonicalMarketId).toBeNull();
      expect(result.executionConfidence).toBe("BLOCKED");
    });

  it("uses verified event reversal for the player team but still requires explicit player resolution", () => {
    const reversed = { ...footballMapping, participantOrientation: "REVERSED" as const };
    const right = namedPlayerMarket(true, { player: { providerPlayerId: "native-right", name: "Brian Aguirre", teamSide: "AWAY" } });
    expect(mapMarkets(reversed, namedPlayerMarket(), right).status).toBe("REVIEW_REQUIRED");
    expect(mapMarkets(reversed, namedPlayerMarket(), namedPlayerMarket(true)).status).toBe("REJECTED");
  });

  it.each(["600", "600.0"])("accepts integer time predicate %s as YES/NO without an Asian push", line => {
    const props: Partial<NormalizedMarket> = { marketType: "FT_FIRST_GOAL_BEFORE", line,
      settlementProfile: "football-first-goal-before-seconds", selections: [
        { providerSelectionId: "yes", canonicalOutcomeId: "YES" }, { providerSelectionId: "no", canonicalOutcomeId: "NO" }
      ] };
    const result = mapMarkets(footballMapping, footballMarket(props), imFootballMarket(props));
    expect(result.status).toBe("VERIFIED");
    expect(result.normalizedLine).toBe("600");
    expect(result.evidence.find(item => item.gate === "noPushFootballLine")?.passed).toBe(true);
  });

  it.each(["600.5", "600.25", "600.0000000000000001", "0", "-600", "9007199254740992"])("rejects invalid integer time predicate %s", line => {
    const props: Partial<NormalizedMarket> = { marketType: "FT_FIRST_GOAL_BEFORE", line,
      settlementProfile: "football-first-goal-before-seconds", selections: [
        { providerSelectionId: "yes", canonicalOutcomeId: "YES" }, { providerSelectionId: "no", canonicalOutcomeId: "NO" }
      ] };
    const result = mapMarkets(footballMapping, footballMarket(props), imFootballMarket(props));
    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find(item => item.gate === "noPushFootballLine")?.passed).toBe(false);
  });

  it("normalizes equivalent decimal lines in a verified canonical market ID", () => {
    const result = mapMarkets(
      footballMapping,
      footballMarket({ line: "1.50" }),
      imFootballMarket({ line: "1.5" })
    );

    expect(result.status).toBe("VERIFIED");
    expect(result.normalizedLine).toBe("1.5");
    expect(result.canonicalMarketId).toContain("|1.5|");
    expect(result.executionConfidence).toBe("HIGH");
    expect(result.evidence.every((item) => item.passed)).toBe(true);
  });

  it("verifies the exact OVER/UNDER domain for corner totals without crossing into goal totals", () => {
    const left = footballMarket({ marketType: "CORNER_FT_TOTAL",
      settlementProfile: "football-corners-regulation" });
    const right = imFootballMarket({ marketType: "CORNER_FT_TOTAL",
      settlementProfile: "football-corners-regulation" });
    expect(mapMarkets(footballMapping, left, right).status).toBe("VERIFIED");
    const crossed = mapMarkets(footballMapping, left,
      imFootballMarket({ marketType: "FT_TOTAL", settlementProfile: "football-regulation-including-added-time" }));
    expect(crossed.status).toBe("REJECTED");
    expect(crossed.evidence.find((item) => item.gate === "sameMarketType")?.passed).toBe(false);
  });

  it.each(["2", "2.25", "2.75"])("rejects push-capable football line %s", (line) => {
    const result = mapMarkets(
      footballMapping,
      footballMarket({ line }),
      imFootballMarket({ line })
    );

    expect(result.status).toBe("REJECTED");
    expect(result.canonicalMarketId).toBeNull();
    expect(result.executionConfidence).toBe("BLOCKED");
    expect(result.evidence.find((item) => item.gate === "noPushFootballLine")?.passed).toBe(false);
  });

  it("verifies an exact line-free football odd/even market", () => {
    const left = footballMarket({ marketType: "FT_ODD_EVEN", line: null,
      settlementProfile: "football-goals-odd-even-regulation", selections: [
        { providerSelectionId: "saba-odd", canonicalOutcomeId: "ODD" },
        { providerSelectionId: "saba-even", canonicalOutcomeId: "EVEN" }
      ] });
    const right = imFootballMarket({ marketType: "FT_ODD_EVEN", line: null,
      settlementProfile: "football-goals-odd-even-regulation", selections: [
        { providerSelectionId: "im-even", canonicalOutcomeId: "EVEN" },
        { providerSelectionId: "im-odd", canonicalOutcomeId: "ODD" }
      ] });

    expect(mapMarkets(footballMapping, left, right)).toMatchObject({ status: "VERIFIED", normalizedLine: null });
  });

  it("rejects a line-free binary market carrying an unexpected line", () => {
    const market = (provider: "SABA" | "IM", line: string | null): NormalizedMarket => footballMarket({
      provider, providerEventId: provider === "SABA" ? "saba-football" : "im-football",
      providerMarketId: `${provider}-odd-even`, marketType: "FT_ODD_EVEN", line,
      settlementProfile: "football-goals-odd-even-regulation", selections: [
        { providerSelectionId: `${provider}-odd`, canonicalOutcomeId: "ODD" },
        { providerSelectionId: `${provider}-even`, canonicalOutcomeId: "EVEN" }
      ]
    });

    const result = mapMarkets(footballMapping, market("SABA", "0"), market("IM", "0"));
    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "sameLine")?.passed).toBe(false);
  });

  it.each([
    [
      "full-time versus first-half",
      footballMarket({ marketType: "FT_TOTAL", scope: "FULL_TIME" }),
      imFootballMarket({ marketType: "FH_TOTAL", scope: "FIRST_HALF" }),
      "sameScope"
    ],
    [
      "second-half versus first-half",
      footballMarket({ marketType: "SH_TOTAL", scope: "SECOND_HALF",
        settlementProfile: "football-second-half-including-added-time" }),
      imFootballMarket({ marketType: "FH_TOTAL", scope: "FIRST_HALF",
        settlementProfile: "football-first-half-including-added-time" }),
      "sameScope"
    ],
    [
      "series winner versus map winner",
      lolMarket({ marketType: "SERIES_WINNER", scope: "SERIES" }),
      imLolMarket({ marketType: "MAP_WINNER", scope: "MAP_2" }),
      "sameMarketType"
    ],
    ["map 2 versus map 3", lolMarket(), imLolMarket({ scope: "MAP_3" }), "sameScope"],
    [
      "total 28.5 versus 29.5",
      lolMarket({ marketType: "MAP_TOTAL_KILLS", line: "28.5" }),
      imLolMarket({ marketType: "MAP_TOTAL_KILLS", line: "29.5" }),
      "sameLine"
    ],
    [
      "Asian Handicap -1.5 versus -2.5",
      footballMarket({ marketType: "FT_AH", line: "-1.5" }),
      imFootballMarket({ marketType: "FT_AH", line: "-2.5" }),
      "sameLine"
    ],
    [
      "different settlement profile hashes",
      footballMarket(),
      imFootballMarket({ settlementProfile: "sha256:football-extra-time-v1" }),
      "sameSettlementProfile"
    ],
    [
      "open versus suspended",
      footballMarket({ status: "OPEN" }),
      imFootballMarket({ status: "SUSPENDED" }),
      "sameQuoteStatus"
    ]
  ] as const)("rejects %s", (_description, left, right, failedGate) => {
    const eventMapping = left.category === "LOL" ? lolMapping : footballMapping;
    const result = mapMarkets(eventMapping, left, right);

    expect(result.status).toBe("REJECTED");
    expect(result.canonicalMarketId).toBeNull();
    expect(result.executionConfidence).toBe("BLOCKED");
    expect(result.evidence.find((item) => item.gate === failedGate)?.passed).toBe(false);
  });

  it("maps reversed provider selection order to the same canonical participant outcomes", () => {
    const result = mapMarkets(lolMapping, lolMarket(), imLolMarket());

    expect(result.status).toBe("VERIFIED");
    expect(result.selectionMappings).toEqual([
      {
        canonicalOutcomeId: "gen_g",
        leftProviderSelectionId: "saba-gen-g",
        rightProviderSelectionId: "im-gen-g"
      },
      {
        canonicalOutcomeId: "t1",
        leftProviderSelectionId: "saba-t1",
        rightProviderSelectionId: "im-t1"
      }
    ]);
  });

  it("requires review when a mandatory settlement profile is absent", () => {
    const result = mapMarkets(
      footballMapping,
      footballMarket(),
      imFootballMarket({ settlementProfile: null })
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "sameSettlementProfile")?.passed).toBe(false);
  });

  it("treats a whitespace-only settlement profile as missing mandatory evidence", () => {
    const result = mapMarkets(
      footballMapping,
      footballMarket(),
      imFootballMarket({ settlementProfile: "   " })
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "sameSettlementProfile")?.passed).toBe(false);
  });

  it("rejects duplicate provider selection IDs even when canonical outcomes differ", () => {
    const result = mapMarkets(
      lolMapping,
      lolMarket({
        selections: [
          { providerSelectionId: "duplicate", canonicalOutcomeId: "gen_g" },
          { providerSelectionId: "duplicate", canonicalOutcomeId: "t1" }
        ]
      }),
      imLolMarket()
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "sameSelections")?.passed).toBe(false);
  });

  it("blocks execution confidence for observe-only markets even when mapping is verified", () => {
    const selections = [
      { providerSelectionId: "coverage-a", canonicalOutcomeId: "COVERAGE" }
    ];
    const result = mapMarkets(
      footballMapping,
      footballMarket({ marketType: "OBSERVE_ONLY", line: null, selections }),
      imFootballMarket({
        marketType: "OBSERVE_ONLY",
        line: null,
        selections: [{ providerSelectionId: "coverage-b", canonicalOutcomeId: "COVERAGE" }]
      })
    );

    expect(result.status).toBe("VERIFIED");
    expect(result.executionConfidence).toBe("BLOCKED");
  });

  it("cannot verify a market whose event mapping needs review", () => {
    const reviewEvent = mapEvents(
      footballEvent("SABA", "saba-football"),
      { ...footballEvent("IM", "im-football"), seasonStage: null },
      policy
    );
    const result = mapMarkets(reviewEvent, footballMarket(), imFootballMarket());

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "verifiedEventMapping")?.passed).toBe(false);
  });

  it.each([
    ["an unrelated provider event ID", imFootballMarket({ providerEventId: "other-event" })],
    ["the wrong provider", imFootballMarket({ provider: "OTHER" })],
    ["both markets from the left provider", imFootballMarket({ provider: "SABA", providerEventId: "saba-football" })]
  ] as const)("rejects %s", (_description, right) => {
    const result = mapMarkets(footballMapping, footballMarket(), right);

    expect(result.status).toBe("REJECTED");
    expect(result.executionConfidence).toBe("BLOCKED");
    expect(result.evidence.find((item) => item.gate === "marketEventProvenance")?.passed).toBe(false);
  });

  it("rejects an incomplete 1X2 outcome domain", () => {
    const result = mapMarkets(
      footballMapping,
      footballMarket({
        marketType: "FT_1X2",
        line: null,
        selections: [{ providerSelectionId: "saba-home", canonicalOutcomeId: "HOME" }]
      }),
      imFootballMarket({
        marketType: "FT_1X2",
        line: null,
        selections: [{ providerSelectionId: "im-home", canonicalOutcomeId: "HOME" }]
      })
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validSelectionDomain")?.passed).toBe(false);
  });

  it("rejects winner outcomes unrelated to the mapped participants", () => {
    const result = mapMarkets(
      lolMapping,
      lolMarket({
        selections: [
          { providerSelectionId: "saba-a", canonicalOutcomeId: "foo" },
          { providerSelectionId: "saba-b", canonicalOutcomeId: "bar" }
        ]
      }),
      imLolMarket({
        selections: [
          { providerSelectionId: "im-a", canonicalOutcomeId: "bar" },
          { providerSelectionId: "im-b", canonicalOutcomeId: "foo" }
        ]
      })
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validSelectionDomain")?.passed).toBe(false);
  });

  it.each([
    ["0.0000001", "0.0000001"],
    ["1000000000000000000000", "1000000000000000000000"]
  ] as const)("keeps canonical line %s in plain-decimal notation", (line, expected) => {
    const selections = [
      { providerSelectionId: "over", canonicalOutcomeId: "OVER" },
      { providerSelectionId: "under", canonicalOutcomeId: "UNDER" }
    ];
    const result = mapMarkets(
      lolMapping,
      lolMarket({ marketType: "MAP_TOTAL_KILLS", line, selections }),
      imLolMarket({ marketType: "MAP_TOTAL_KILLS", line, selections: [
        { providerSelectionId: "im-under", canonicalOutcomeId: "UNDER" },
        { providerSelectionId: "im-over", canonicalOutcomeId: "OVER" }
      ] })
    );

    expect(result.status).toBe("VERIFIED");
    expect(result.normalizedLine).toBe(expected);
    expect(result.normalizedLine).toMatch(/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/);
    expect(result.canonicalMarketId).toContain(`|${expected}|`);
  });

  it("retains all underlying event hard-gate evidence", () => {
    const result = mapMarkets(footballMapping, footballMarket(), imFootballMarket());

    expect(result.evidence.filter((item) => item.gate.startsWith("event."))).toHaveLength(
      footballMapping.evidence.length
    );
    expect(result.evidence.find((item) => item.gate === "event.sameCategory")?.passed).toBe(true);
  });

  it("requires review for a blank provider market ID", () => {
    const result = mapMarkets(
      footballMapping,
      footballMarket(),
      imFootballMarket({ providerMarketId: "   " })
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.executionConfidence).toBe("BLOCKED");
    expect(result.evidence.find((item) => item.gate === "distinctMarketSources")?.passed).toBe(false);
  });
});
