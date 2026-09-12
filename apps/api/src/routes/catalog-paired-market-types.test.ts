import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { registerCatalogRoutes } from "./catalog.js";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";

const player = { providerPlayerId: "p1", displayName: "Alpha Nine", teamSide: "HOME" } as const;
const isProp = (marketType: string) => marketType.startsWith("PLAYER_");

const market = (provider: string, marketType: string, providerMarketId: string) => ({
  provider, category: "FOOTBALL", providerEventId: "e1", providerMarketId, marketType,
  scope: "FULL_TIME", line: "0", settlementProfile: "p", status: "OPEN",
  ...(isProp(marketType) ? { player } : {})
});

const quote = (provider: string, marketType: string, providerMarketId: string) => ({
  provider, category: "FOOTBALL", providerEventId: "e1", providerMarketId,
  providerSelectionId: `${providerMarketId}:HOME`, selection: "HOME", marketType, scope: "FULL_TIME",
  line: "0", rawOdds: "0.9", rawFormat: "MALAY", status: "OPEN", isLive: false, sequence: 1,
  sourceTimestampMs: Date.now(), receivedMonotonicMs: 1,
  ...(isProp(marketType) ? { player } : {})
});

const book = (provider: "BTI" | "CMD" | "SBOBET", marketTypes: readonly string[]): ObservedProviderCatalog => ({
  dataMode: "LIVE", accountId: `catalog-source:${provider}:FOOTBALL`, provider, category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER", observedAtMs: Date.now(), rejectedMarketCount: 0,
  events: [{ provider, category: "FOOTBALL", providerEventId: "e1", competition: "epl",
    seasonStage: null, startAtUtcMs: Date.now() + 3_600_000, participantA: "Alpha", participantB: "Beta",
    eventScope: "REGULATION", bestOf: null, isLive: false, rematchCandidate: false,
    fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", liveState: null }],
  markets: marketTypes.map((type, index) => market(provider, type, `m${index}`)),
  quotes: marketTypes.map((type, index) => quote(provider, type, `m${index}`))
}) as unknown as ObservedProviderCatalog;

const serve = async () => {
  const app = Fastify();
  registerCatalogRoutes(app, {
    read: async (accountId: string) => accountId.includes("CMD")
      ? book("CMD", ["FT_AH", "FT_TOTAL"])
      : accountId.includes("SBOBET") ? book("SBOBET", ["FT_AH"])
      : book("BTI", ["FT_AH", "FT_CORRECT_SCORE", "PLAYER_FT_SHOTS_TOTAL", "PLAYER_FT_ANYTIME_SCORER"]),
    snapshotFreshnessMaxAgeMs: 600_000
  });
  await app.ready();
  return app;
};

const get = (app: Awaited<ReturnType<typeof serve>>, url: string) => app.inject({ method: "GET", url });
const types = (response: { json: () => unknown }) =>
  (response.json() as { markets: { marketType: string }[] }).markets.map((row) => row.marketType);

describe("catalog marketTypes=paired", () => {
  it("drops the market types no other book prices and keeps every type that can pair", async () => {
    const app = await serve();
    try {
      // The other books have to have been read before their types are known.
      await get(app, "/api/catalog/accounts/catalog-source:CMD:FOOTBALL");
      await get(app, "/api/catalog/accounts/catalog-source:SBOBET:FOOTBALL");
      const narrowed = await get(app,
        "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?marketTypes=paired&events=e1");
      expect(narrowed.statusCode).toBe(200);
      // FT_AH exists at CMD, so it survives; the player props exist nowhere else
      // and could never have formed an exact two-book pair. FT_CORRECT_SCORE is
      // carried by no other book either, but the comparison projects it onto
      // FT_TOTAL, so cutting it here would silently cost the pairs it forms.
      expect(types(narrowed)).toEqual(["FT_AH", "FT_CORRECT_SCORE"]);
      const body = narrowed.json() as { quotes: { marketType: string }[]; events: unknown[] };
      expect(body.quotes.map((row) => row.marketType)).toEqual(["FT_AH", "FT_CORRECT_SCORE"]);
      // Narrowing prices never hides a fixture.
      expect(body.events).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("sends the whole book when the caller did not ask for the narrowing", async () => {
    const app = await serve();
    try {
      await get(app, "/api/catalog/accounts/catalog-source:CMD:FOOTBALL");
      const full = await get(app, "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e1");
      expect(types(full)).toEqual(["FT_AH", "FT_CORRECT_SCORE",
        "PLAYER_FT_SHOTS_TOTAL", "PLAYER_FT_ANYTIME_SCORER"]);
    } finally { await app.close(); }
  });

  it("filters nothing while no other book has been read, rather than emptying the book", async () => {
    const app = await serve();
    try {
      // Failing closed here would blank the first book loaded after a restart,
      // which is exactly when nothing else has been read yet.
      const narrowed = await get(app,
        "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?marketTypes=paired&events=e1");
      expect(types(narrowed)).toEqual(["FT_AH", "FT_CORRECT_SCORE",
        "PLAYER_FT_SHOTS_TOTAL", "PLAYER_FT_ANYTIME_SCORER"]);
    } finally { await app.close(); }
  });

  it("never lets a narrowed body answer a request for the whole book", async () => {
    const app = await serve();
    try {
      await get(app, "/api/catalog/accounts/catalog-source:CMD:FOOTBALL");
      await get(app, "/api/catalog/accounts/catalog-source:SBOBET:FOOTBALL");
      const narrowed = await get(app,
        "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?marketTypes=paired&events=e1");
      const full = await get(app, "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e1");
      expect(narrowed.headers.etag).toBeDefined();
      expect(narrowed.headers.etag).not.toBe(full.headers.etag);
      const reused = await app.inject({ method: "GET",
        url: "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?events=e1",
        headers: { "if-none-match": String(narrowed.headers.etag) } });
      expect(reused.statusCode).toBe(200);
      expect(types(reused)).toHaveLength(4);
    } finally { await app.close(); }
  });

  it("waits for a second other book before it trusts the shared type list", async () => {
    const app = Fastify();
    const read = async (accountId: string) => accountId.includes("CMD")
      ? book("CMD", ["FT_AH"])
      : book("BTI", ["FT_AH", "PLAYER_FT_SHOTS_TOTAL"]);
    registerCatalogRoutes(app, { read, snapshotFreshnessMaxAgeMs: 600_000 });
    await app.ready();
    try {
      await get(app, "/api/catalog/accounts/catalog-source:CMD:FOOTBALL");
      // One other book is not a shared type list, it is one book's list. Cutting
      // against it would drop whatever the books still loading happen to carry.
      const narrowed = await get(app,
        "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?marketTypes=paired&events=e1");
      expect(types(narrowed)).toEqual(["FT_AH", "PLAYER_FT_SHOTS_TOTAL"]);
    } finally { await app.close(); }
  });

  it("refuses a marketTypes value it does not define", async () => {
    const app = await serve();
    try {
      const response = await get(app,
        "/api/catalog/accounts/catalog-source:BTI:FOOTBALL?marketTypes=all");
      expect(response.statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
