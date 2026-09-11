import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogApi, CatalogReadError, catalogRetryDelayMs, parseLiveCatalogResponse } from "./catalog.js";

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
  it("reads renewed event receipt bodies even when semantic prices have the same ETag", async () => {
    let reads=0;
    const api=new CatalogApi(async (_input,init) => {
      reads++;
      if (new Headers(init?.headers).has("if-none-match")) return new Response(null,{status:304});
      return new Response(JSON.stringify({...response,observedAtMs:reads*100,observedMonotonicMs:reads*100}),
        {headers:{etag:'"same-prices"',"x-catalog-revision":"same-prices"}});
    });
    const first=await api.readEventsRevision("account-1",["event-a"]);
    const refreshed=await api.readEventsRevision("account-1",["event-a"]);
    expect(first.catalog.observedAtMs).toBe(100);
    expect(refreshed.catalog.observedAtMs).toBe(200);
    expect(refreshed.catalog.observedMonotonicMs).toBe(200);
  });
  it("starts queued detail deadlines after admission and releases slots on timeout", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const starts: number[] = [];
    const api = new CatalogApi((_input, init) => {
      starts.push(Date.now());
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))));
    }, 10);
    const results = Promise.allSettled([api.readEventsRevision("account-1", ["a"]),
      api.readEventsRevision("account-1", ["b"]), api.readRevision("account-2"),
      api.readEventsRevision("account-3", ["c"])]);
    await vi.advanceTimersByTimeAsync(10);
    expect(starts).toEqual([0, 0, 10, 10]);
    await vi.advanceTimersByTimeAsync(10);
    expect((await results).every(result => result.status === "rejected" &&
      result.reason.code === "CATALOG_TIMEOUT")).toBe(true);
  });

  it("limits large transfers across views while roster reads remain available", async () => {
    const started: string[] = [];
    const bodies = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      const key = `${id}:${url.searchParams.get("events") ?? "roster"}`;
      started.push(key);
      if (url.searchParams.has("markets")) return new Response(JSON.stringify({ ...response, accountId: id }));
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { bodies.set(key, controller); } }));
    });
    const api = new CatalogApi(fetcher);
    const first = api.readEventsRevision("account-1", ["a"]);
    const changedView = api.readEventsRevision("account-1", ["b"]);
    const second = api.readEventsRevision("account-2", ["c"]);
    const third = api.readEventsRevision("account-3", ["d"]);
    await vi.waitFor(() => expect(started).toEqual(["account-1:a", "account-2:c"]));
    await api.readRosterRevision("account-3");
    expect(started).toContain("account-3:roster");
    const finish = (key: string, id: string) => {
      bodies.get(key)!.enqueue(new TextEncoder().encode(JSON.stringify({ ...response, accountId: id })));
      bodies.get(key)!.close();
    };
    finish("account-1:a", "account-1");
    await first;
    await vi.waitFor(() => expect(started).toContain("account-1:b"));
    expect(started).not.toContain("account-3:d");
    finish("account-2:c", "account-2");
    await second;
    await vi.waitFor(() => expect(started).toContain("account-3:d"));
    finish("account-1:b", "account-1"); finish("account-3:d", "account-3");
    expect((await changedView).revision).toContain("events:b");
    await third;
  });

  it.each([0, 21_000, 21_000.5])("preserves the optional paired catalog receipt anchor %s", observedMonotonicMs => {
    expect(parseLiveCatalogResponse({ ...response, observedMonotonicMs }, "account-1"))
      .toHaveProperty("observedMonotonicMs", observedMonotonicMs);
    expect(parseLiveCatalogResponse(response, "account-1")).not.toHaveProperty("observedMonotonicMs");
  });

  it.each([null, "21000", -1, Number.NaN, Infinity, -Infinity, {}, true])
  ("rejects a malformed paired catalog receipt anchor (%#)", observedMonotonicMs => {
    expect(() => parseLiveCatalogResponse({ ...response, observedMonotonicMs }, "account-1"))
      .toThrow("Invalid live catalog response");
  });

  it("distinguishes anchor-only changes in fallback revisions without server headers", async () => {
    let observedMonotonicMs = 1_000;
    const api = new CatalogApi(async () => new Response(JSON.stringify({ ...response, observedMonotonicMs })));
    const before = await api.readRevision("account-1");
    observedMonotonicMs = 2_000;
    const after = await api.readRevision("account-1");
    expect(after.revision).not.toBe(before.revision);
    expect(after.catalog).toHaveProperty("observedMonotonicMs", 2_000);
  });

  it("requests per-event native counts and reuses their validated body on 304", async () => {
    const nativeCoverageByEvent = [{ providerEventId: "event-1", normalized: 2, excluded: 3, unmapped: 4 }];
    let calls = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ++calls === 1
      ? new Response(JSON.stringify({ ...response, nativeCoverageByEvent }), { headers: {
        etag: '"revision-100-native-counts"', "x-catalog-revision": "revision-100"
      } }) : new Response(null, { status: 304 }));
    const api = new CatalogApi(fetcher, 10_000, 30_000, "counts");
    const first = await api.readRevision("account-1");
    expect(first).toEqual({ catalog: { ...response, nativeCoverageByEvent }, revision: "revision-100" });
    expect(first.catalog).not.toHaveProperty("nativeMarketObservations");
    expect((await api.readRevision("account-1")).catalog).toBe(first.catalog);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/catalog/accounts/account-1?nativeDetail=counts");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("if-none-match"))
      .toBe('"revision-100-native-counts"');
  });

  it("distinguishes unavailable native accounting from an observed empty inventory", () => {
    expect(parseLiveCatalogResponse(response, "account-1")).not.toHaveProperty("nativeCoverageByEvent");
    expect(parseLiveCatalogResponse({ ...response, nativeCoverageByEvent: [] }, "account-1"))
      .toHaveProperty("nativeCoverageByEvent", []);
  });

  it.each([
    null, {}, [null], [{ providerEventId: "", normalized: 0, excluded: 0, unmapped: 0 }],
    [{ providerEventId: "event", normalized: -1, excluded: 0, unmapped: 0 }],
    [{ providerEventId: "event", normalized: 0, excluded: 0.5, unmapped: 0 }],
    [{ providerEventId: "event", normalized: 0, excluded: 0, unmapped: Number.MAX_SAFE_INTEGER + 1 }],
    [{ providerEventId: "event", normalized: 0, excluded: 0 }],
    [{ providerEventId: "event", normalized: 0, excluded: 0, unmapped: 0 },
      { providerEventId: "event", normalized: 1, excluded: 0, unmapped: 0 }]
  ].map((nativeCoverageByEvent) => ({ nativeCoverageByEvent })))
  ("rejects malformed or duplicate native event counts (%#)", ({ nativeCoverageByEvent }) => {
    expect(() => parseLiveCatalogResponse({ ...response, nativeCoverageByEvent }, "account-1"))
      .toThrow("Invalid live catalog response");
  });

  it("requests the compact native inventory only when the dashboard opts in", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(response), { status: 200 }));
    await new CatalogApi(fetcher, 10_000, 30_000, "summary").read("account-1");
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/catalog/accounts/account-1?nativeDetail=summary");
  });

  it("loads a fixture roster first and then only the requested events", async () => {
    const calls: string[] = [];
    const api = new CatalogApi(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify(response), { status: 200,
        headers: { etag: '"catalog-100"', "x-catalog-revision": "catalog-100" } });
    }, 10_000, 30_000, "counts");

    const roster = await api.readRosterRevision("account-1");
    const selected = await api.readEventsRevision("account-1", ["event-b", "event-a", "event-a"]);

    expect(calls).toEqual([
      "/api/catalog/accounts/account-1?nativeDetail=counts&markets=none",
      "/api/catalog/accounts/account-1?nativeDetail=counts&events=event-a%2Cevent-b"
    ]);
    expect(roster.revision).toBe("catalog-100|roster");
    expect(roster.sourceRevision).toBe("catalog-100");
    expect(selected.sourceRevision).toBe("catalog-100");
    expect(selected.revision).toBe("catalog-100|events:event-a,event-b");
  });
  it("loads large event selections in a bounded request without losing any IDs", async () => {
    const ids = Array.from({ length: 900 }, (_, index) => String(884467107155537920n + BigInt(index)));
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const api = new CatalogApi(async (input, init) => {
      calls.push({ url: String(input), init });
      if (String(input).length > 16_384) return new Response(null, { status: 431 });
      return new Response(JSON.stringify(response), { status: 200 });
    }, 10_000, 30_000, "counts");
    const result = await api.readEventsRevision("account-1", ids);
    expect(result.catalog).toEqual(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/catalog/accounts/account-1");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ nativeDetail: "counts", events: ids.join(",") });
  });

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

  it("shares one transfer through body parsing when initial and realtime reads overlap", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { body = controller; }
    }), { status: 200, headers: { etag: '"catalog-100"' } }));
    const api = new CatalogApi(fetcher);
    const initial = api.readRevision("account-1");
    // Headers have arrived, but the large body has not finished transferring.
    await Promise.resolve();
    const realtime = api.readRevision("account-1");
    const legacy = api.read("account-1");

    expect(fetcher).toHaveBeenCalledTimes(1);
    body.enqueue(new TextEncoder().encode(JSON.stringify(response)));
    body.close();
    await expect(initial).resolves.toEqual({ catalog: response, revision: "catalog-100" });
    await expect(realtime).resolves.toEqual({ catalog: response, revision: "catalog-100" });
    await expect(legacy).resolves.toEqual(response);
  });

  it("lets a different account finish while another account is still transferring", async () => {
    let releaseFirst!: (value: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => String(input).endsWith("account-1")
      ? new Promise<Response>((resolve) => { releaseFirst = resolve; })
      : Promise.resolve(new Response(JSON.stringify({ ...response, accountId: "account-2", provider: "SABA" }))));
    const api = new CatalogApi(fetcher);
    const first = api.read("account-1");
    await expect(api.read("account-2")).resolves.toMatchObject({ accountId: "account-2", provider: "SABA" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    releaseFirst(new Response(JSON.stringify(response)));
    await expect(first).resolves.toEqual(response);
  });

  it("releases a shared failed request so a later read can retry", async () => {
    let calls = 0;
    const api = new CatalogApi(async () => ++calls === 1
      ? new Response(JSON.stringify({ error: "CATALOG_UNAVAILABLE" }), { status: 503 })
      : new Response(JSON.stringify(response), { status: 200 }));
    const results = await Promise.allSettled([api.readRevision("account-1"), api.readRevision("account-1")]);

    expect(calls).toBe(1);
    expect(results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ code: "CATALOG_UNAVAILABLE", status: 503 }) },
      { status: "rejected", reason: expect.objectContaining({ code: "CATALOG_UNAVAILABLE", status: 503 }) }
    ]);
    await expect(api.read("account-1")).resolves.toEqual(response);
    expect(calls).toBe(2);
  });

  it("does not replace a newer cached catalog when a later request returns older data", async () => {
    const requestHeaders: Array<HeadersInit | undefined> = [];
    let calls = 0;
    const api = new CatalogApi(async (_input, init) => {
      requestHeaders.push(init?.headers);
      calls += 1;
      if (calls === 3) return new Response(null, { status: 304 });
      const observedAtMs = calls === 1 ? 200 : 100;
      return new Response(JSON.stringify({ ...response, observedAtMs }), {
        status: 200, headers: { etag: `"catalog-${observedAtMs}"`, "x-catalog-revision": `catalog-${observedAtMs}` }
      });
    });
    await expect(api.readRevision("account-1")).resolves.toMatchObject({ revision: "catalog-200",
      catalog: { observedAtMs: 200 } });
    await expect(api.readRevision("account-1")).resolves.toMatchObject({ revision: "catalog-200",
      catalog: { observedAtMs: 200 } });
    await expect(api.readRevision("account-1")).resolves.toMatchObject({ revision: "catalog-200",
      catalog: { observedAtMs: 200 } });
    expect(new Headers(requestHeaders[2]).get("if-none-match")).toBe('"catalog-200"');
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

  it("preserves validated native market accounting from the provider boundary", async () => {
    const nativeMarketObservations = [{
      provider: "CMD", category: "FOOTBALL", providerEventId: "event-1",
      providerMarketId: "event-1:native:999", nativeType: "999", nativeLabel: "Unknown prop",
      nativeScope: "FULL_TIME", outcomeLabels: ["Yes", "No"], observedAtMs: 100,
      disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED"
    }];
    const api = new CatalogApi(async () => new Response(JSON.stringify({
      ...response, nativeMarketObservations
    }), { status: 200 }));

    await expect(api.read("account-1")).resolves.toMatchObject({ nativeMarketObservations });
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

  it("keeps the original deadline for a late joining reader and allows retry after their shared timeout", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const api = new CatalogApi((_input, init) => {
      calls += 1;
      if (calls > 1) return Promise.resolve(new Response(JSON.stringify(response)));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }, 10);
    const first = api.readRevision("account-1");
    await vi.advanceTimersByTimeAsync(9);
    const results = Promise.allSettled([first, api.readRevision("account-1")]);
    await vi.advanceTimersByTimeAsync(1);

    expect(await results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ code: "CATALOG_TIMEOUT", status: 0 }) },
      { status: "rejected", reason: expect.objectContaining({ code: "CATALOG_TIMEOUT", status: 0 }) }
    ]);
    expect(calls).toBe(1);
    await expect(api.read("account-1")).resolves.toEqual(response);
    expect(calls).toBe(2);
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

  it("still aborts missing response headers at ten seconds when a separate body budget is configured", async () => {
    vi.useFakeTimers();
    const api = new CatalogApi((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }), 10_000, 30_000);

    const result = expect(api.read("account-1")).rejects.toMatchObject({ code: "CATALOG_TIMEOUT", status: 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
  });

  it("accepts a complete body within its explicit budget after the header deadline has passed", async () => {
    vi.useFakeTimers();
    const api = new CatalogApi((_input, init) => new Promise((resolve) => {
      window.setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>({
        start(body) {
          init?.signal?.addEventListener("abort", () => body.error(new DOMException("aborted", "AbortError")));
          window.setTimeout(() => {
            if (init?.signal?.aborted) return;
            body.enqueue(new TextEncoder().encode(JSON.stringify(response)));
            body.close();
          }, 26_000);
        }
      }), { status: 200 })), 8_000);
    }), 10_000, 30_000);
    const result = Promise.allSettled([api.read("account-1")]);

    // Eight seconds to headers, then twenty-six seconds for the complete body.
    await vi.advanceTimersByTimeAsync(34_000);
    expect(await result).toEqual([{ status: "fulfilled", value: response }]);
  });

  it("aborts a hung body thirty seconds after headers without extending the deadline for another reader", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      signal = init?.signal;
      window.setTimeout(() => resolve(new Response(new ReadableStream<Uint8Array>({
        start(body) {
          signal?.addEventListener("abort", () => body.error(new DOMException("aborted", "AbortError")));
        }
      }), { status: 200 })), 8_000);
    }));
    const api = new CatalogApi(fetcher, 10_000, 30_000);
    const first = api.readRevision("account-1");
    await vi.advanceTimersByTimeAsync(9_000);
    const results = Promise.allSettled([first, api.readRevision("account-1")]);
    await vi.advanceTimersByTimeAsync(28_999);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ code: "CATALOG_TIMEOUT", status: 0 }) },
      { status: "rejected", reason: expect.objectContaining({ code: "CATALOG_TIMEOUT", status: 0 }) }
    ]);
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

  it("replaces the event-detail cache slot when the pairable event set changes", async () => {
    const requests: Array<{ url: string; etag: string | null }> = [];
    const api = new CatalogApi(async (input, init) => {
      const url = String(input);
      requests.push({ url, etag: new Headers(init?.headers).get("if-none-match") });
      return new Response(JSON.stringify(response), {
        headers: { etag: `"${url.includes("event-b") ? "b" : "a"}"`, "x-catalog-revision": "source" }
      });
    }, 10_000, 30_000, "counts");

    await api.readEventsRevision("account-1", ["event-a"]);
    await api.readEventsRevision("account-1", ["event-b"]);
    await api.readEventsRevision("account-1", ["event-a"]);

    expect(requests.map((request) => request.etag)).toEqual([null, null, null]);
    expect(requests.map((request) => request.url)).toEqual([
      "/api/catalog/accounts/account-1?nativeDetail=counts&events=event-a",
      "/api/catalog/accounts/account-1?nativeDetail=counts&events=event-b",
      "/api/catalog/accounts/account-1?nativeDetail=counts&events=event-a"
    ]);
  });
});
