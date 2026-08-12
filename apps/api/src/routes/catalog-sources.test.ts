import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import { registerCatalogSourceRoutes } from "./catalog-sources.js";

describe("catalog source routes", () => {
  it("returns only strict redacted logical source statuses", async () => {
    const app = Fastify();
    registerCatalogSourceRoutes(app, { listStatuses: async () => [{
      id: "catalog-source:SABA:FOOTBALL",
      alias: "C-Sports · SABA",
      provider: "SABA",
      category: "FOOTBALL",
      sessionState: "ACTIVE",
      sessionSource: "FABET_LOGIN",
      acquiredAtMs: 200,
      reason: null
    }] });

    const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sources: [expect.objectContaining({
      id: "catalog-source:SABA:FOOTBALL", provider: "SABA", category: "FOOTBALL"
    })] });
    expect(JSON.stringify(response.json())).not.toMatch(/token|cookie|launchUrl|trustedHostname|sessionId/iu);
    await app.close();
  });

  it("fails closed on malformed output or resolver failure", async () => {
    for (const listStatuses of [
      async () => [{ id: "catalog-source:SABA:FOOTBALL", token: "secret" }] as unknown as CatalogSourceStatus[],
      async () => { throw new Error("secret-bearing-internal-error"); }
    ]) {
      const app = Fastify();
      registerCatalogSourceRoutes(app, { listStatuses });
      const response = await app.inject({ method: "GET", url: "/api/catalog/sources" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "CATALOG_SOURCES_UNAVAILABLE" });
      expect(response.body).not.toContain("secret");
      await app.close();
    }
  });
});
