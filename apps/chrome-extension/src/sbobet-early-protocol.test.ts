import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractSbobetMoreRoster } from "./sbobet-more-roster.js";
import { buildSbobetEarlyFetchExpression, sbobetEarlyBatchFromResponse,
  sbobetEarlyRequestFromMain, sbobetEarlyRequestFromObserved } from "./sbobet-early-protocol.js";

const url = "https://be.sb21.net/api/v2/getEvent?timeRange=early&sportId=1&sportType=1_1&oddsStyle=ma";
const receipt = { generation: "source:7", requestStartSequence: 42, observedAtMs: 1788850195360 };
const fixture = JSON.parse(readFileSync(new URL("../../api/src/chrome-bridge/sbobet-early-source.fixture.json",
  import.meta.url), "utf8")) as { body: unknown[] };
const event = (id = "5729104") => ({ "0": "2026-09-10T12:00:00Z", "2": "Home", "3": "Away", "8": id,
  "7": { "8": [`1.92*${id}8h 1.92*${id}8a offer 0 1 0 0 0`], "999": ["opaque-native-row"] } });
const roster = (events: unknown[] = [event()]) => [{ "0": 481, "1": "League", "2": events }];

describe("SBOBET All Early request scope", () => {
  it("retains the exact unfiltered observed URL and derives Early by changing only main timeRange", () => {
    const observed = url + "&agentId=private-test-value&pinLeague=false&sortByTime=true";
    expect(sbobetEarlyRequestFromObserved(observed, "GET")).toEqual({ url: observed });
    for (const phase of ["live", "today"]) {
      expect(sbobetEarlyRequestFromMain(observed.replace("timeRange=early", `timeRange=${phase}`)))
        .toEqual({ url: observed });
    }
  });

  it.each([
    [url, "POST"], [url, undefined], [url.replace("https:", "http:"), "GET"],
    [url.replace("be.sb21.net", "other.example"), "GET"],
    [url.replace("getEvent?", "getEventByDate?"), "GET"],
    [url.replace("https://", "https://user:secret@"), "GET"], [url + "#fragment", "GET"],
    [url.replace("timeRange=early", "timeRange=today"), "GET"],
    [url.replace("sportId=1", "sportId=2"), "GET"], [url.replace("sportType=1_1", "sportType=1_2"), "GET"],
    [url.replace("oddsStyle=ma", "oddsStyle=de"), "GET"], [url.replace("&sportType=1_1", ""), "GET"],
    [url + "&timeRange=early", "GET"], [url + "&sport%49d=1", "GET"],
    [url + "&agentId=a&agentId=b", "GET"], [url + "&agentId=", "GET"],
    [url + "&date=2026-9-09", "GET"], [url + "&eventId=5729104", "GET"],
    [url + "&leagueId=481", "GET"], [url + "&gamePart=0", "GET"],
    [url + "&pinLeague=true", "GET"], [url + "&sortByTime=other", "GET"],
    [url + "&priceBoost=true", "GET"], [url + "&page=1", "GET"]
  ])("rejects filtered or ambiguous observed scope %s %s", (value, method) => {
    expect(sbobetEarlyRequestFromObserved(value, method)).toBeNull();
  });

  it("does not derive authority from Early, filtered main or missing football parameters", () => {
    expect(sbobetEarlyRequestFromMain(url)).toBeNull();
    expect(sbobetEarlyRequestFromMain(url.replace("early", "today") + "&pinLeague=true")).toBeNull();
    expect(sbobetEarlyRequestFromMain(url.replace("early", "live").replace("&sportType=1_1", ""))).toBeNull();
  });
});

describe("SBOBET All Early response authority", () => {
  it("preserves the actual 377-owner receipt, duplicate containers and raw rows", () => {
    const batch = sbobetEarlyBatchFromResponse({ url }, JSON.stringify(fixture.body), receipt);
    expect(batch).toEqual({ kind: "SBOBET_EARLY_CATALOG", ...receipt, rosterComplete: true, body: fixture.body });
    expect(extractSbobetMoreRoster(batch!.body, "PREMATCH")).toHaveLength(377);
    expect(Object.keys(batch!)).toEqual(["kind", "generation", "requestStartSequence", "observedAtMs", "rosterComplete", "body"]);
  });

  it.each([[], [[]], roster(), [roster()]].map(body => ({ body })))("accepts valid direct/date wrappers including authoritative empty %j", ({ body }) => {
    expect(sbobetEarlyBatchFromResponse({ url }, JSON.stringify(body), receipt)?.body).toEqual(body);
  });

  it("retains unknown native string groups without confusing them with owner identity", () => {
    const batch = sbobetEarlyBatchFromResponse({ url }, JSON.stringify(roster()), receipt);
    expect(batch?.body).toEqual(roster());
  });

  it.each([
    {}, { error: "upstream" }, [roster(), { malformed: true }], [[roster()]],
    roster([{ ...event(), "8": 0 }]), roster([{ ...event(), "0": "not-a-date" }]),
    roster([event(), { ...event(), "2": "Different owner" }]),
    roster([{ ...event(), "7": { "8": "not-an-array" } }]),
    roster([{ ...event(), "7": { "8": [null] } }]),
    roster([{ ...event(), "7": { "8": ["1.9*9999998h"] } }]),
    roster([{ ...event(), "7": { "8": ["prefix1.9*57291048h"] } }]),
    roster([{ ...event(), "7": { "8": ["x".repeat(1501)] } }])
  ].map(body => ({ body })))("rejects malformed siblings and foreign ownership without granting partial authority %j", ({ body }) => {
    expect(sbobetEarlyBatchFromResponse({ url }, JSON.stringify(body), receipt)).toBeNull();
  });

  it("rejects invalid JSON, oversized UTF-8 bodies and more than 2048 distinct owners", () => {
    expect(sbobetEarlyBatchFromResponse({ url }, "[", receipt)).toBeNull();
    expect(sbobetEarlyBatchFromResponse({ url }, JSON.stringify("é".repeat(6_000_000)), receipt)).toBeNull();
    expect(sbobetEarlyBatchFromResponse({ url }, JSON.stringify(roster(
      Array.from({ length: 2049 }, (_, i) => event(String(1000000 + i))))), receipt)).toBeNull();
  });

  it.each([
    { generation: "" }, { generation: "\nsource" }, { requestStartSequence: -1 },
    { requestStartSequence: 1.5 }, { requestStartSequence: Number.MAX_SAFE_INTEGER + 1 },
    { observedAtMs: 0 }, { observedAtMs: Infinity }, { observedAtMs: true }
  ])("rejects invalid receipt clocks %j", invalid => {
    expect(sbobetEarlyBatchFromResponse({ url }, "[]", { ...receipt, ...invalid } as typeof receipt)).toBeNull();
  });

  it("revalidates the request and does not copy unrecognized receipt metadata into publication", () => {
    expect(sbobetEarlyBatchFromResponse({ url: url + "&leagueId=481" }, "[]", receipt)).toBeNull();
    expect(sbobetEarlyBatchFromResponse({ url }, "[]", { ...receipt, secret: "never publish" } as typeof receipt))
      .toEqual({ kind: "SBOBET_EARLY_CATALOG", ...receipt, rosterComplete: true, body: [] });
  });
});

describe("SBOBET Early bounded page fetch", () => {
  afterEach(() => vi.useRealTimers());
  const origin = "https://www.sb21.net";
  const evaluate = (expression: string, fetcher: typeof fetch, location = { origin }) => runInNewContext(expression, {
    location, fetch: fetcher, AbortController, TextDecoder, Uint8Array, setTimeout, clearTimeout
  }) as Promise<{ status: number; body?: string; retryAfterMs?: number }>;

  it("uses the exact scoped URL and only valid native headers without forwarding cookies or forbidden headers", async () => {
    const expression = buildSbobetEarlyFetchExpression({ url }, origin, {
      Authorization: "Bearer synthetic", "X-Token": "synthetic", language: "vi",
      Cookie: "private", Origin: "wrong", Host: "wrong", "Sec-Fetch-Site": "none", "Proxy-Authorization": "private",
      "Content-Length": "5", "bad name": "bad", "X-Invalid": "line\r\nbreak", "User-Agent": "fake"
    });
    expect(expression).not.toBeNull();
    const calls: { url: string; options: RequestInit }[] = [];
    const result = await evaluate(expression!, async (input, options) => {
      calls.push({ url: String(input), options: options! });
      return new Response("[]", { status: 200 });
    });
    expect(result).toEqual({ status: 200, body: "[]" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.options).toMatchObject({ method: "GET", credentials: "include", cache: "no-store", redirect: "error",
      headers: { Authorization: "Bearer synthetic", "X-Token": "synthetic", language: "vi" } });
    expect(Object.keys(calls[0]!.options.headers!)).toHaveLength(3);
    expect(calls[0]!.options.signal?.aborted).toBe(false);
  });

  it("rejects unsafe execution origins and current-origin changes before or after fetching", async () => {
    expect(buildSbobetEarlyFetchExpression({ url }, "https://user:secret@www.sb21.net", {})).toBeNull();
    expect(buildSbobetEarlyFetchExpression({ url: url + "&eventId=1" }, origin, {})).toBeNull();
    const expression = buildSbobetEarlyFetchExpression({ url }, origin, {})!;
    let calls = 0;
    expect(await evaluate(expression, async () => { calls++; return new Response("[]"); }, { origin: "https://other.example" }))
      .toEqual({ status: 0 });
    expect(calls).toBe(0);
    const location = { origin };
    expect(await evaluate(expression, async () => { location.origin = "https://other.example"; return new Response("[]"); }, location))
      .toEqual({ status: 0 });
  });

  it("aborts a stalled request at 7500ms and settles without publishing a body", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null = null;
    const result = evaluate(buildSbobetEarlyFetchExpression({ url }, origin, {})!, async (_input, options) => {
      signal = options!.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    await vi.advanceTimersByTimeAsync(7499);
    expect((signal as AbortSignal | null)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: 0 });
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects oversized streamed or declared bodies and does not return HTTP error bodies", async () => {
    const expression = buildSbobetEarlyFetchExpression({ url }, origin, {})!;
    expect(await evaluate(expression, async () => new Response("[]", { headers: { "content-length": "12000001" } })))
      .toEqual({ status: 0 });
    expect(await evaluate(expression, async () => new Response("é".repeat(6_000_001))))
      .toEqual({ status: 0 });
    expect(await evaluate(expression, async () => new Response("private error", { status: 429, headers: { "retry-after": "999" } })))
      .toEqual({ status: 429, retryAfterMs: 999000 });
  });
});
