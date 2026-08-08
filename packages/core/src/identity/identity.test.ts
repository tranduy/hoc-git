import { describe, expect, it } from "vitest";
import {
  CanonicalIdentityError,
  buildFootballEventKey,
  buildLolEventKey
} from "./canonical-key.js";
import { normalizeName, resolveAlias } from "./normalize-name.js";

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
