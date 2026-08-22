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
  it("aborts a hung control-plane request so source discovery can retry", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }));
      const request = new CatalogSourceApi(fetcher as typeof fetch, 1_000).list();
      const outcome = expect(request).rejects.toThrow("Catalog source request timed out");
      await vi.advanceTimersByTimeAsync(1_000);
      await outcome;
      expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads a strict redacted source list without browser cache", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sources: [valid] }), {
      status: 200, headers: { "content-type": "application/json" }
    }));
    const sources = await new CatalogSourceApi(fetcher as typeof fetch).list();
    expect(sources).toEqual([expect.objectContaining({ id: valid.id, sessionState: "ACTIVE" })]);
    expect(fetcher).toHaveBeenCalledWith("/api/catalog/sources", expect.objectContaining({
      method: "GET", cache: "no-store", signal: expect.any(AbortSignal)
    }));
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
