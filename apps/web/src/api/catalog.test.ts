import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogApi, CatalogReadError, catalogRetryDelayMs } from "./catalog.js";

const response = {
  dataMode: "LIVE",
  accountId: "account-1",
  provider: "CMD",
  category: "FOOTBALL",
  comparisonState: "AWAITING_SECOND_PROVIDER",
  snapshotState: "FRESH",
  observedAtMs: 100,
  rejectedMarketCount: 0,
  events: [], markets: [], quotes: []
};

afterEach(() => vi.useRealTimers());

describe("CatalogApi", () => {
  it("loads a live account catalog through a path parameter", async () => {
    const calls: string[] = [];
    const api = new CatalogApi(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    });

    await expect(api.read("account-1")).resolves.toEqual(response);
    expect(calls).toEqual(["/api/catalog/accounts/account-1"]);
  });

  it("reuses the validated catalog when the server reports an unchanged ETag", async () => {
    const requestHeaders: Array<HeadersInit | undefined> = [];
    let calls = 0;
    const api = new CatalogApi(async (_input, init) => {
      requestHeaders.push(init?.headers);
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify(response), { status: 200, headers: { etag: '"catalog-100"' } })
        : new Response(null, { status: 304 });
    });

    await expect(api.read("account-1")).resolves.toEqual(response);
    await expect(api.read("account-1")).resolves.toEqual(response);
    expect(new Headers(requestHeaders[1]).get("if-none-match")).toBe('"catalog-100"');
  });

  it("returns and reuses the server catalog revision across a 304", async () => {
    let calls = 0;
    const api = new CatalogApi(async () => ++calls === 1
      ? new Response(JSON.stringify(response), { status: 200,
          headers: { etag: '"catalog-100"', "x-catalog-revision": "catalog-100" } })
      : new Response(null, { status: 304 }));

    await expect(api.readRevision("account-1")).resolves.toEqual({
      catalog: response, revision: "catalog-100"
    });
    await expect(api.readRevision("account-1")).resolves.toEqual({
      catalog: response, revision: "catalog-100"
    });
  });

  it("does not replace a newer cached catalog with an older concurrent response", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const api = new CatalogApi(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const older = api.readRevision("account-1");
    const newer = api.readRevision("account-1");
    resolvers[1]!(new Response(JSON.stringify({ ...response, observedAtMs: 200 }), {
      status: 200, headers: { etag: '"catalog-200"', "x-catalog-revision": "catalog-200" }
    }));
    await expect(newer).resolves.toMatchObject({ revision: "catalog-200",
      catalog: { observedAtMs: 200 } });
    resolvers[0]!(new Response(JSON.stringify(response), {
      status: 200, headers: { etag: '"catalog-100"', "x-catalog-revision": "catalog-100" }
    }));

    await expect(older).resolves.toMatchObject({ revision: "catalog-200",
      catalog: { observedAtMs: 200 } });
  });

  it("rejects a fixture or malformed response at the UI boundary", async () => {
    const api = new CatalogApi(async () => new Response(JSON.stringify({ ...response, dataMode: "FIXTURE" }), { status: 200 }));
    await expect(api.read("account-1")).rejects.toThrow("Invalid live catalog response");
  });

  it("accepts a verified supported provider instead of hard-coding CMD", async () => {
    const saba = { ...response, provider: "SABA" };
    const api = new CatalogApi(async () => new Response(JSON.stringify(saba), { status: 200 }));
    await expect(api.read("account-1")).resolves.toEqual(saba);
  });

  it("aborts a provider request that would otherwise block the whole comparison screen", async () => {
    vi.useFakeTimers();
    const api = new CatalogApi((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }), 10);

    const result = expect(api.read("account-1")).rejects.toThrow("Live catalog request timed out");
    await vi.advanceTimersByTimeAsync(10);
    await result;
  });

  it("keeps the deadline active while the response body is still being read", async () => {
    vi.useFakeTimers();
    const api = new CatalogApi(async (_input, init) => ({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    } as Response), 10);

    const result = expect(api.read("account-1")).rejects.toThrow("Live catalog request timed out");
    await vi.advanceTimersByTimeAsync(10);
    await result;
  });

  it("preserves the server catalog failure code for stale-source diagnostics", async () => {
    const api = new CatalogApi(async () => new Response(JSON.stringify({ error: "CATALOG_TIMEOUT" }), {
      status: 503, headers: { "content-type": "application/json" }
    }));

    await expect(api.read("account-1")).rejects.toMatchObject({
      name: "CatalogReadError", code: "CATALOG_TIMEOUT", status: 503
    });
  });

  it("retries a bounded server timeout quickly without hammering other failures", () => {
    expect(catalogRetryDelayMs(new CatalogReadError("CATALOG_TIMEOUT", 503))).toBe(500);
    expect(catalogRetryDelayMs(new CatalogReadError("CATALOG_SCHEMA_ERROR", 503))).toBe(30_000);
    expect(catalogRetryDelayMs(new Error("network unavailable"))).toBe(30_000);
  });
});
