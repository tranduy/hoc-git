import { describe, expect, it } from "vitest";
import {
  mapEvents,
  type MappingPolicy,
  type NormalizedFootballEvent,
  type NormalizedLolEvent,
  type VersionedAliasRegistry
} from "../index.js";

const aliasRegistry: VersionedAliasRegistry = {
  version: "2026-08-09.mapping-1",
  aliases: {
    FOOTBALL: {
      arsenal: "arsenal",
      chelsea: "chelsea"
    },
    LOL: {
      geng: "gen_g",
      gen_g: "gen_g",
      t1: "t1",
      t_one: "t1"
    }
  }
};

const policy: MappingPolicy = {
  prematchToleranceMs: 120_000,
  liveClockToleranceMs: 20_000,
  aliasRegistry
};

const footballStartAtMs = Date.parse("2026-08-09T12:00:00.000Z");
const lolStartAtMs = Date.parse("2026-08-09T12:00:00.000Z");

const sabaFootball: NormalizedFootballEvent = {
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "saba-epl-1",
  competition: "epl",
  seasonStage: "2026-27",
  startAtUtcMs: footballStartAtMs,
  participantA: "Arsenal",
  participantB: "Chelsea",
  canonicalParticipantA: "arsenal",
  canonicalParticipantB: "chelsea",
  eventScope: "REGULAR_TIME",
  bestOf: null,
  isLive: true,
  isVirtual: false,
  sportVariant: "FOOTBALL",
  rematchCandidate: false,
  fixtureDiscriminator: null,
  liveState: {
    period: "SECOND_HALF",
    scoreHome: 1,
    scoreAway: 0,
    clockMs: 4_200_000
  }
};

const imFootball: NormalizedFootballEvent = {
  ...sabaFootball,
  provider: "IM",
  providerEventId: "im-epl-9",
  startAtUtcMs: footballStartAtMs + 90_000,
  liveState: { ...sabaFootball.liveState!, clockMs: 4_215_000 }
};

const sabaLol: NormalizedLolEvent = {
  provider: "SABA",
  category: "LOL",
  providerEventId: "saba-lol-1",
  competition: "lck",
  seasonStage: "summer-2026",
  startAtUtcMs: lolStartAtMs,
  participantA: "Gen.G",
  participantB: "T1",
  canonicalParticipantA: "gen_g",
  canonicalParticipantB: "t1",
  eventScope: "SERIES",
  bestOf: 3,
  isLive: true,
  gameVariant: "LOL_PC",
  rematchCandidate: false,
  fixtureDiscriminator: null,
  liveState: {
    seriesScoreA: 1,
    seriesScoreB: 0,
    currentMap: 2,
    mapState: "IN_PROGRESS"
  }
};

const imLol: NormalizedLolEvent = {
  ...sabaLol,
  provider: "IM",
  providerEventId: "im-lol-9",
  participantA: "T One",
  participantB: "Gen G",
  canonicalParticipantA: "t1",
  canonicalParticipantB: "gen_g",
  startAtUtcMs: lolStartAtMs + 60_000,
  liveState: {
    seriesScoreA: 0,
    seriesScoreB: 1,
    currentMap: 2,
    mapState: "IN_PROGRESS"
  }
};

describe("mapEvents Football hard gates", () => {
  it("verifies the same EPL fixture when every hard gate passes", () => {
    const result = mapEvents(sabaFootball, imFootball, policy);

    expect(result.status).toBe("VERIFIED");
    expect(result.canonicalEventId).not.toBeNull();
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) => item.passed)).toBe(true);
  });

  it.each([
    ["virtual sport", { isVirtual: true }, "sameNonVirtualSport"],
    [
      "reversed home and away",
      {
        participantA: "Chelsea",
        participantB: "Arsenal",
        canonicalParticipantA: "chelsea",
        canonicalParticipantB: "arsenal"
      },
      "sameHomeAway"
    ],
    ["kickoff outside tolerance", { startAtUtcMs: footballStartAtMs + 600_000 }, "compatibleKickoff"],
    ["different period", { liveState: { ...imFootball.liveState!, period: "FIRST_HALF" } }, "compatibleLiveState"],
    ["different score", { liveState: { ...imFootball.liveState!, scoreAway: 1 } }, "compatibleLiveState"],
    ["clock outside tolerance", { liveState: { ...imFootball.liveState!, clockMs: 4_250_000 } }, "compatibleLiveState"],
    ["different child scope", { eventScope: "FIRST_HALF" }, "compatibleEventScope"]
  ] as const)("rejects %s", (_description, change, failedGate) => {
    const result = mapEvents(sabaFootball, { ...imFootball, ...change }, policy);

    expect(result.status).toBe("REJECTED");
    expect(result.canonicalEventId).toBeNull();
    expect(result.evidence.find((item) => item.gate === failedGate)?.passed).toBe(false);
  });

  it("requires review rather than rejecting when live state evidence is missing", () => {
    const result = mapEvents(sabaFootball, { ...imFootball, liveState: null }, policy);

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "compatibleLiveState")?.passed).toBe(false);
  });

  it("treats a whitespace-only stage as missing mandatory evidence", () => {
    const result = mapEvents(sabaFootball, { ...imFootball, seasonStage: "   " }, policy);

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "sameCompetitionAndStage")?.passed).toBe(false);
  });

  it("verifies an ambiguous rematch candidate with matching fixture evidence", () => {
    const left = {
      ...sabaFootball,
      rematchCandidate: true,
      fixtureDiscriminator: "round-12-leg-2"
    };
    const right = {
      ...imFootball,
      rematchCandidate: true,
      fixtureDiscriminator: "round-12-leg-2"
    };

    const result = mapEvents(left, right, policy);

    expect(result.status).toBe("VERIFIED");
    expect(result.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(true);
  });

  it("requires review when an ambiguous rematch discriminator is missing", () => {
    const result = mapEvents(
      { ...sabaFootball, rematchCandidate: true, fixtureDiscriminator: null },
      { ...imFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-2" },
      policy
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(false);
  });

  it("rejects conflicting rematch discriminators", () => {
    const result = mapEvents(
      { ...sabaFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-1" },
      { ...imFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-2" },
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(false);
  });

  it("rejects contradictory rematch-candidate flags", () => {
    const result = mapEvents(
      { ...sabaFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-2" },
      imFootball,
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(false);
  });

  it("uses the rematch discriminator in canonical event identity", () => {
    const first = mapEvents(
      { ...sabaFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-1" },
      { ...imFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-1" },
      policy
    );
    const second = mapEvents(
      { ...sabaFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-2" },
      { ...imFootball, rematchCandidate: true, fixtureDiscriminator: "round-12-leg-2" },
      policy
    );

    expect(first.status).toBe("VERIFIED");
    expect(second.status).toBe("VERIFIED");
    expect(first.canonicalEventId).not.toBe(second.canonicalEventId);
  });
});

describe("mapEvents LoL hard gates", () => {
  it("verifies reversed provider team order when canonical teams and oriented live score agree", () => {
    const result = mapEvents(sabaLol, imLol, policy);

    expect(result.status).toBe("VERIFIED");
    expect(result.participantOrientation).toBe("REVERSED");
    expect(result.evidence.every((item) => item.passed)).toBe(true);
  });

  it.each([
    ["a non-PC game", { gameVariant: "WILD_RIFT" }, "sameLolPcGame"],
    ["a different tournament", { competition: "lpl" }, "sameTournamentAndStage"],
    ["different canonical teams", { canonicalParticipantA: "weibo" }, "sameLolTeams"],
    ["a different best-of", { bestOf: 5 }, "sameBestOf"],
    ["a different current map", { liveState: { ...imLol.liveState!, currentMap: 3 } }, "compatibleLolLiveState"],
    ["a different map state", { liveState: { ...imLol.liveState!, mapState: "FINISHED" } }, "compatibleLolLiveState"],
    [
      "a different oriented series score",
      { liveState: { ...imLol.liveState!, seriesScoreA: 1, seriesScoreB: 0 } },
      "compatibleLolLiveState"
    ]
  ] as const)("rejects %s", (_description, change, failedGate) => {
    const result = mapEvents(sabaLol, { ...imLol, ...change }, policy);

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === failedGate)?.passed).toBe(false);
  });

  it("requires review when best-of evidence is missing", () => {
    const result = mapEvents(sabaLol, { ...imLol, bestOf: null }, policy);

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "sameBestOf")?.passed).toBe(false);
  });

  it("rejects an invalid best-of without throwing during canonical identity construction", () => {
    const result = mapEvents(
      { ...sabaLol, bestOf: 0 },
      { ...imLol, bestOf: 0 },
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.canonicalEventId).toBeNull();
    expect(result.evidence.find((item) => item.gate === "validEventSemantics")?.passed).toBe(false);
  });

  it("verifies a repeated-series candidate with matching fixture evidence and distinct identity", () => {
    const first = mapEvents(
      { ...sabaLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-1" },
      { ...imLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-1" },
      policy
    );
    const second = mapEvents(
      { ...sabaLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-2" },
      { ...imLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-2" },
      policy
    );

    expect(first.status).toBe("VERIFIED");
    expect(second.status).toBe("VERIFIED");
    expect(first.canonicalEventId).not.toBe(second.canonicalEventId);
    expect(first.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(true);
  });

  it("requires review when repeated-series fixture evidence is missing", () => {
    const result = mapEvents(
      { ...sabaLol, rematchCandidate: true, fixtureDiscriminator: null },
      { ...imLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-1" },
      policy
    );

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(false);
  });

  it("rejects conflicting repeated-series fixture evidence", () => {
    const result = mapEvents(
      { ...sabaLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-1" },
      { ...imLol, rematchCandidate: true, fixtureDiscriminator: "series-slot-2" },
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "compatibleRematchEvidence")?.passed).toBe(false);
  });
});

describe("mapEvents category-specific event scopes", () => {
  it("rejects equal LoL scopes on Football events", () => {
    const left = { ...sabaFootball, eventScope: "SERIES" } as unknown as NormalizedFootballEvent;
    const right = { ...imFootball, eventScope: "SERIES" } as unknown as NormalizedFootballEvent;
    const result = mapEvents(left, right, policy);

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validCategoryEventScope")?.passed).toBe(false);
  });

  it("rejects equal Football scopes on LoL events", () => {
    const left = { ...sabaLol, eventScope: "REGULAR_TIME" } as unknown as NormalizedLolEvent;
    const right = { ...imLol, eventScope: "REGULAR_TIME" } as unknown as NormalizedLolEvent;
    const result = mapEvents(left, right, policy);

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validCategoryEventScope")?.passed).toBe(false);
  });
});

describe("mapEvents alias evidence", () => {
  it("records explicit alias source, canonical value and registry version", () => {
    const result = mapEvents(sabaLol, imLol, policy);
    const evidence = result.evidence.find((item) => item.gate === "sameLolTeams");

    expect(result.status).toBe("VERIFIED");
    expect(evidence?.passed).toBe(true);
    expect(evidence?.actual).toContain("EXPLICIT_ALIAS");
    expect(evidence?.actual).toContain("2026-08-09.mapping-1");
    expect(evidence?.actual).toContain("gen_g");
  });

  it("requires review for a normalized name without explicit registry proof", () => {
    const left = {
      ...sabaLol,
      participantA: "Mystery Team",
      participantB: "T1",
      canonicalParticipantA: "mystery_team",
      canonicalParticipantB: "t1"
    };
    const right = {
      ...imLol,
      participantA: "Mystery Team",
      participantB: "T1",
      canonicalParticipantA: "mystery_team",
      canonicalParticipantB: "t1",
      liveState: { ...sabaLol.liveState! }
    };
    const result = mapEvents(left, right, policy);
    const evidence = result.evidence.find((item) => item.gate === "sameLolTeams");

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(evidence?.passed).toBe(false);
    expect(evidence?.reason).toContain("MISSING_MANDATORY_EVIDENCE");
  });

  it("rejects cross-provider canonical conflict even when both names lack explicit proof", () => {
    const left = {
      ...sabaLol,
      participantA: "Mystery Team",
      participantB: "T1",
      canonicalParticipantA: "mystery_team",
      canonicalParticipantB: "t1"
    };
    const right = {
      ...imLol,
      participantA: "Other Team",
      participantB: "T1",
      canonicalParticipantA: "other_team",
      canonicalParticipantB: "t1",
      liveState: { ...sabaLol.liveState! }
    };
    const result = mapEvents(left, right, policy);
    const evidence = result.evidence.find((item) => item.gate === "sameLolTeams");

    expect(result.status).toBe("REJECTED");
    expect(evidence?.passed).toBe(false);
    expect(evidence?.reason).toContain("CONTRADICTION");
  });

  it("rejects a caller canonical ID that conflicts with explicit alias evidence", () => {
    const result = mapEvents(
      sabaLol,
      { ...imLol, canonicalParticipantA: "weibo" },
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "sameLolTeams")?.passed).toBe(false);
  });
});

describe("mapEvents source and semantic validity", () => {
  it("rejects two events from the same provider", () => {
    const result = mapEvents(
      sabaFootball,
      { ...imFootball, provider: "SABA" },
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "distinctEventSources")?.passed).toBe(false);
  });

  it("requires review for a blank provider event ID", () => {
    const result = mapEvents(sabaFootball, { ...imFootball, providerEventId: "   " }, policy);

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.evidence.find((item) => item.gate === "distinctEventSources")?.passed).toBe(false);
  });

  it.each([
    ["identical Football participants", { canonicalParticipantB: "arsenal" }],
    ["an invalid timestamp", { startAtUtcMs: Number.POSITIVE_INFINITY }],
    ["a negative score", { liveState: { ...imFootball.liveState!, scoreHome: -1 } }],
    ["a negative clock", { liveState: { ...imFootball.liveState!, clockMs: -1 } }]
  ] as const)("rejects %s", (_description, change) => {
    const left = _description === "identical Football participants"
      ? { ...sabaFootball, canonicalParticipantB: "arsenal" }
      : sabaFootball;
    const result = mapEvents(left, { ...imFootball, ...change }, policy);

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validEventSemantics")?.passed).toBe(false);
  });

  it("rejects current map zero", () => {
    const result = mapEvents(
      sabaLol,
      { ...imLol, liveState: { ...imLol.liveState!, currentMap: 0 } },
      policy
    );

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validEventSemantics")?.passed).toBe(false);
  });

  it("rejects impossible LoL series scores for the best-of and current map", () => {
    const impossibleLeft = {
      ...sabaLol,
      liveState: { ...sabaLol.liveState!, seriesScoreA: 2, seriesScoreB: 2 }
    };
    const impossibleRight = {
      ...imLol,
      liveState: { ...imLol.liveState!, seriesScoreA: 2, seriesScoreB: 2 }
    };
    const result = mapEvents(impossibleLeft, impossibleRight, policy);

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validEventSemantics")?.passed).toBe(false);
  });

  it("rejects a non-finite mapping tolerance through inspectable evidence", () => {
    const result = mapEvents(sabaFootball, imFootball, {
      ...policy,
      prematchToleranceMs: Number.POSITIVE_INFINITY
    });

    expect(result.status).toBe("REJECTED");
    expect(result.evidence.find((item) => item.gate === "validMappingPolicy")?.passed).toBe(false);
  });
});
