import { describe, expect, it } from "vitest";
import { isValidProviderPlayerIdentity, playerComparisonKey, sameNativePlayer } from "./football-player-identity.js";

const player = { providerPlayerId: "295238", name: "Brian Aguirre", teamSide: "HOME" } as const;
describe("player identities used for football comparisons", () => {
  it("binds a native quote to the exact provider player ID, name and side", () => {
    expect(isValidProviderPlayerIdentity(player)).toBe(true);
    expect(sameNativePlayer(player, { ...player })).toBe(true);
    expect(sameNativePlayer(player, { ...player, providerPlayerId: "1658226316" })).toBe(false);
    expect(sameNativePlayer(player, { ...player, name: "Brian Aguirre Jr" })).toBe(false);
    expect(sameNativePlayer(player, { ...player, teamSide: "AWAY" })).toBe(false);
    expect(sameNativePlayer({ ...player, teamSide: null }, { ...player, teamSide: null })).toBe(true);
  });

  it.each([null, undefined, {}, { ...player, providerPlayerId: "" }, { ...player, name: "" },
    { ...player, providerPlayerId: " 295238" }, { ...player, teamSide: "TEAM_1" },
    { ...player, name: "Brian\u0000Aguirre" }, { ...player, name: "No Score" }])(
    "never binds a missing or invalid player identity %j", value => {
      expect(isValidProviderPlayerIdentity(value)).toBe(false);
      expect(sameNativePlayer(value, value)).toBe(false);
      expect(playerComparisonKey(value)).toBeNull();
    });

  it("compares full names and an oriented team side without treating provider IDs as shared IDs", () => {
    const key = playerComparisonKey({ ...player, name: "  João   Félix  " });
    expect(key).not.toBeNull();
    expect(key).toBe(playerComparisonKey({ ...player, providerPlayerId: "other-provider-456", name: "Joao Felix" }));
    expect(key).not.toBe(playerComparisonKey({ ...player, name: "Joao Felix", teamSide: "AWAY" }));
    expect(key).not.toBe(playerComparisonKey({ ...player, name: "Joao Pedro" }));
    expect(playerComparisonKey({ ...player, name: "Jean-Matteo Bahoya" }))
      .toBe(playerComparisonKey({ ...player, name: "Jean Matteo Bahoya" }));
  });

  it("preserves an age or country qualifier and name order instead of guessing an alias", () => {
    const qualified = playerComparisonKey({ ...player, name: "Josh King (U21 Anh)" });
    expect(qualified).not.toBeNull();
    expect(qualified).not.toBe(playerComparisonKey({ ...player, name: "Josh King" }));
    expect(playerComparisonKey({ ...player, name: "Philippe, Rayan" }))
      .not.toBe(playerComparisonKey({ ...player, name: "Rayan Philippe" }));
  });

  it.each(["J. Smith", "J Smith", "J. P. Smith", "Neymar", "No Goalscorer", "Own Goal", "Any Other Player",
    "Unknown Player", "Player One", "Home Player", "To Score Last Goal Tiago Morais", "Lucas Gonzalez/Francisco Gonzalez",
    "Lucas Gonzalez or Francisco Gonzalez", "Brian Aguirre Over 0.5"])(
    "does not form a cross-book identity from an abbreviated or non-player label %s", name => {
      expect(playerComparisonKey({ ...player, name })).toBeNull();
    });

  it("keeps a valid native identity without a known team while withholding a cross-book key", () => {
    expect(isValidProviderPlayerIdentity({ ...player, teamSide: null })).toBe(true);
    expect(playerComparisonKey({ ...player, teamSide: null })).toBeNull();
  });

  it("preserves Or as a leading given name while rejecting a disjunction between subjects", () => {
    expect(isValidProviderPlayerIdentity({ ...player, name: "Or Blorian" })).toBe(true);
    expect(playerComparisonKey({ ...player, name: "Or Blorian" })).toBe("HOME|or blorian");
    expect(isValidProviderPlayerIdentity({ ...player, name: "Or Blorian or Josh King" })).toBe(false);
    expect(isValidProviderPlayerIdentity({ ...player, name: "Lucas Gonzalez or Francisco Gonzalez" })).toBe(false);
  });

  it.each(["Cengiz Under", "Cengiz Ünder", "Over Mandanda"])("retains real player name %s without treating a name token as an outcome", name => {
    expect(isValidProviderPlayerIdentity({ ...player, name })).toBe(true);
    expect(playerComparisonKey({ ...player, name })).not.toBeNull();
  });

  it.each(["Over", "Under", "Over 1.5", "Cengiz Under Over 1.5", "Cengiz Under Under 1.5", "Brian Aguirre Over 0.5"])(
    "still rejects standalone outcomes or numeric total phrases %s", name => {
      expect(isValidProviderPlayerIdentity({ ...player, name })).toBe(false);
    });
});
