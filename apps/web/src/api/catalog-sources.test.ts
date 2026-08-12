import { describe, expect, it, vi } from "vitest";
import { CatalogSourceApi } from "./catalog-sources.js";

const valid = {
  id: "catalog-source:SABA:FOOTBALL",
  alias: "C-Sports · SABA",
  provider: "SABA",
  category: "FOOTBALL",
  sessionState: "ACTIVE",
  sessionSource: "FABET_LOGIN",
  acquiredAtMs: 200,
  reason: null
};

describe("CatalogSourceApi", () => {
  it("loads a strict redacted source list without browser cache", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sources: [valid] }), {
      status: 200, headers: { "content-type": "application/json" }
    }));
    const sources = await new CatalogSourceApi(fetcher as typeof fetch).list();
    expect(sources).toEqual([expect.objectContaining({ id: valid.id, sessionState: "ACTIVE" })]);
    expect(fetcher).toHaveBeenCalledWith("/api/catalog/sources", { method: "GET", cache: "no-store" });
  });

  it.each([
    { sources: [{ ...valid, category: "LOL" }] },
    { sources: [{ ...valid, token: "secret" }] },
    { sources: [{ ...valid, id: "catalog-source:BTI:LOL" }] },
    { wrong: [] }
  ])("rejects malformed source payload %#", async (body) => {
    const api = new CatalogSourceApi(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(api.list()).rejects.toThrow("Invalid catalog source response");
  });

  it("rejects non-success and non-JSON responses", async () => {
    await expect(new CatalogSourceApi(async () => new Response("no", { status: 503 })).list())
      .rejects.toThrow("Catalog source request failed (503)");
    await expect(new CatalogSourceApi(async () => new Response("not-json", { status: 200 })).list())
      .rejects.toThrow("Invalid catalog source response");
  });
});
