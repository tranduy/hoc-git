import { describe, expect, it } from "vitest";
import {
  CanonicalIdentityError,
  buildFootballEventKey,
  buildLolEventKey
} from "./canonical-key.js";
import {
  AliasRegistryError,
  normalizeName,
  resolveAlias,
  resolveAliasForCategory,
  type VersionedAliasRegistry
} from "./normalize-name.js";

describe("normalizeName", () => {
  it("removes accents and punctuation while collapsing whitespace and underscores", () => {
    expect(normalizeName("  Natus__  Vincere™ & CÓ. ")).toBe("natus_vincere_and_co");
  });
});

describe("resolveAlias", () => {
  it("resolves an explicit LoL alias after normalization", () => {
    const aliases = { LOL: { navi: "natus_vincere" }, FOOTBALL: {} };

    expect(resolveAlias("NAVI", aliases)).toEqual({
      normalized: "navi",
      canonical: "natus_vincere",
      source: "EXPLICIT_ALIAS"
    });
  });

  it("does not auto-confirm a fuzzy alias", () => {
    const aliases = { LOL: { navi: "natus_vincere" }, FOOTBALL: {} };

    expect(resolveAlias("Na Vi", aliases)).toEqual({
      normalized: "na_vi",
      canonical: "na_vi",
      source: "NORMALIZED_NAME"
    });
  });

  it("resolves the same spelling independently within each category and records its version", () => {
    const registry: VersionedAliasRegistry = {
      version: "2026-08-09.1",
      aliases: {
        FOOTBALL: { navi: "navy_fc" },
        LOL: { navi: "natus_vincere" }
      }
    };

    expect(resolveAliasForCategory("NAVI", "LOL", registry)).toEqual({
      category: "LOL",
      normalized: "navi",
      canonical: "natus_vincere",
      source: "EXPLICIT_ALIAS",
      registryVersion: "2026-08-09.1"
    });
    expect(resolveAliasForCategory("NAVI", "FOOTBALL", registry).canonical).toBe("navy_fc");
    expect(() => resolveAlias("NAVI", registry.aliases)).toThrow("ambiguous explicit alias");
  });

  it("rejects a versioned alias registry without a real version", () => {
    const registry: VersionedAliasRegistry = {
      version: " ",
      aliases: { FOOTBALL: {}, LOL: {} }
    };

    expect(() => resolveAliasForCategory("NAVI", "LOL", registry)).toThrow(AliasRegistryError);
  });

  it.each(["   ", "!!!"])("rejects an alias target that normalizes to an empty ID: %s", (target) => {
    const aliases = { FOOTBALL: {}, LOL: { navi: target } };

    expect(() => resolveAlias("NAVI", aliases)).toThrow(AliasRegistryError);
  });
});

describe("canonical event keys", () => {
  const football = {
    competition: "epl",
    seasonStage: "2026_regular",
    kickoffUtc: "2026-08-09T12:00:00.000Z",
    home: "arsenal",
    away: "chelsea",
    eventScope: "REGULAR"
  };

  const lol = {
    tournament: "lck",
    seasonStage: "summer_2026",
    startAtUtc: "2026-08-09T12:00:00.000Z",
    teamA: "gen_g",
    teamB: "t1",
    bestOf: 3
  };

  it("retains home-away order for Football", () => {
    expect(buildFootballEventKey(football)).not.toBe(
      buildFootballEventKey({ ...football, home: "chelsea", away: "arsenal" })
    );
  });

  it("separates Football rematches by kickoff time", () => {
    expect(buildFootballEventKey(football)).not.toBe(
      buildFootballEventKey({ ...football, kickoffUtc: "2026-10-09T12:00:00.000Z" })
    );
  });

  it("rejects timestamps without an explicit UTC offset", () => {
    expect(() =>
      buildFootballEventKey({ ...football, kickoffUtc: "2026-08-09T12:00:00" })
    ).toThrow(CanonicalIdentityError);
  });

  it("sorts LoL teams for candidate identity lookup", () => {
    expect(buildLolEventKey(lol)).toBe(
      buildLolEventKey({ ...lol, teamA: "t1", teamB: "gen_g" })
    );
  });

  it("uses code-unit ordering for normalized LoL participant IDs", () => {
    expect(buildLolEventKey({ ...lol, teamA: "a_1", teamB: "a1" })).toBe(
      "lol|lck|summer_2026|2026-08-09T12:00:00.000Z|a1|a_1|3"
    );
  });

  it("resolves LoL aliases with a supplied versioned registry", () => {
    const aliasRegistry: VersionedAliasRegistry = {
      version: "2026-08-09.1",
      aliases: {
        FOOTBALL: {},
        LOL: { navi: "natus_vincere" }
      }
    };

    expect(buildLolEventKey({ ...lol, teamA: "NAVI", aliasRegistry })).toBe(
      buildLolEventKey({ ...lol, teamA: "natus_vincere", aliasRegistry })
    );
  });

  it.each(["   ", "!!!"])(
    "rejects an empty canonical participant resolved from an alias target: %s",
    (target) => {
      const aliasRegistry: VersionedAliasRegistry = {
        version: "2026-08-09.1",
        aliases: { FOOTBALL: {}, LOL: { navi: target } }
      };

      expect(() => buildLolEventKey({ ...lol, teamA: "NAVI", aliasRegistry })).toThrow(
        AliasRegistryError
      );
    }
  );

  it("treats participant values as already-canonical IDs when no registry is supplied", () => {
    expect(buildLolEventKey({ ...lol, teamA: "NAVI" })).not.toBe(
      buildLolEventKey({ ...lol, teamA: "natus_vincere" })
    );
  });

  it("separates LoL best-of formats", () => {
    expect(buildLolEventKey(lol)).not.toBe(buildLolEventKey({ ...lol, bestOf: 5 }));
  });

  it.each([
    ["Football competition", () => buildFootballEventKey({ ...football, competition: "" })],
    ["Football stage", () => buildFootballEventKey({ ...football, seasonStage: "" })],
    ["Football kickoff", () => buildFootballEventKey({ ...football, kickoffUtc: "" })],
    ["Football home", () => buildFootballEventKey({ ...football, home: "" })],
    ["Football away", () => buildFootballEventKey({ ...football, away: "" })],
    ["LoL tournament", () => buildLolEventKey({ ...lol, tournament: "" })],
    ["LoL stage", () => buildLolEventKey({ ...lol, seasonStage: "" })],
    ["LoL kickoff", () => buildLolEventKey({ ...lol, startAtUtc: "" })],
    ["LoL team A", () => buildLolEventKey({ ...lol, teamA: "" })],
    ["LoL team B", () => buildLolEventKey({ ...lol, teamB: "" })],
    ["LoL best-of", () => buildLolEventKey({ ...lol, bestOf: 0 })]
  ])("rejects a missing %s", (_description, buildKey) => {
    expect(buildKey).toThrow(CanonicalIdentityError);
  });
});
