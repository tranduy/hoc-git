import { describe, expect, it } from "vitest";
import { ProviderMarketSchema, ProviderPlayerIdentitySchema, ProviderQuoteSchema } from "./schemas.js";
import { playerComparisonKey } from "./football-player-identity.js";

const player = { providerPlayerId: "BTI:344085", name: "Kanya Fujimoto", teamSide: "AWAY" } as const;
const market = { provider: "BTI", category: "FOOTBALL", providerEventId: "event", providerMarketId: "market",
  marketType: "PLAYER_FT_FIRST_SCORER", scope: "FULL_TIME", line: null, player,
  settlementProfile: "player-first-scorer", status: "OPEN" } as const;
const quote = { provider: "BTI", category: "FOOTBALL", providerEventId: "event", providerMarketId: "market",
  providerSelectionId: "selection", marketType: "PLAYER_FT_FIRST_SCORER", scope: "FULL_TIME", line: null,
  player, selection: "YES", rawOdds: "3", rawFormat: "DECIMAL", status: "OPEN", isLive: false,
  sourceTimestampMs: null, receivedMonotonicMs: 1, sequence: 1 } as const;

describe("native player identity schemas", () => {
  it("preserves native identity exactly and allows a retained unknown team", () => {
    expect(ProviderPlayerIdentitySchema.parse(player)).toEqual(player);
    const unknown = { ...player, teamSide: null };
    expect(ProviderMarketSchema.parse({ ...market, player: unknown }).player).toEqual(unknown);
    expect(ProviderQuoteSchema.parse({ ...quote, player: unknown }).player).toEqual(unknown);
    expect(playerComparisonKey(unknown)).toBeNull();
  });

  it.each(["No Score", "Unknown", "Player", "Kanya Fujimoto or Josh King", "To Score Last Goal Tiago Morais",
    "Lucas Gonzalez/francisco Gonzalez", "Josh\nKing"])("rejects non-player subject %s", name => {
    const invalid = { ...player, name };
    expect(ProviderPlayerIdentitySchema.safeParse(invalid).success).toBe(false);
    expect(ProviderMarketSchema.safeParse({ ...market, player: invalid }).success).toBe(false);
    expect(ProviderQuoteSchema.safeParse({ ...quote, player: invalid }).success).toBe(false);
  });

  it.each([" id ", "player/id", "player\nid", "", "id|HOME"])("rejects malformed native ID %j without trimming it", providerPlayerId => {
    expect(ProviderPlayerIdentitySchema.safeParse({ ...player, providerPlayerId }).success).toBe(false);
  });

  it("permits native initials without treating them as a resolved cross-book identity", () => {
    const initial = { ...player, name: "K. Fujimoto" };
    expect(ProviderPlayerIdentitySchema.parse(initial)).toEqual(initial);
    expect(playerComparisonKey(initial)).toBeNull();
  });

  it("requires player metadata exclusively on PLAYER contracts and enforces their period", () => {
    const { player: _marketPlayer, ...missingMarket } = market;
    const { player: _quotePlayer, ...missingQuote } = quote;
    expect(ProviderMarketSchema.safeParse(missingMarket).success).toBe(false);
    expect(ProviderQuoteSchema.safeParse(missingQuote).success).toBe(false);
    expect(ProviderMarketSchema.safeParse({ ...market, marketType: "FT_BTTS" }).success).toBe(false);
    expect(ProviderQuoteSchema.safeParse({ ...quote, marketType: "FT_BTTS" }).success).toBe(false);
    expect(ProviderMarketSchema.safeParse({ ...market, scope: "FIRST_HALF" }).success).toBe(false);
    expect(ProviderQuoteSchema.safeParse({ ...quote, scope: "FIRST_HALF" }).success).toBe(false);
    expect(ProviderPlayerIdentitySchema.safeParse({ ...player, canonicalPlayerId: "invented" }).success).toBe(false);
  });
});
