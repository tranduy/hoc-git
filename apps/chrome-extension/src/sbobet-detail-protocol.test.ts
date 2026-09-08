import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildSbobetDetailFetchExpression, extractSbobetPrematchRoster, parseSbobetDetailEvent,
  sbobetDetailTemplateFromObserved, type SbobetDetailBinding } from "./sbobet-detail-protocol.js";

const binding: SbobetDetailBinding = { sourceGeneration: 4, tabGeneration: 8,
  executionOrigin: "https://be.sb21.net", frameId: "frame-1", loaderId: "loader-1", sessionId: "session-1" };
const observed = { url: "https://api.sb21.net/api/v2/getEvent?timeRange=Today&eventId=101&sportId=1&flag=a%20b",
  method: "GET", headers: { Accept: "application/json", "X-Request-Context": "test-context",
    Cookie: "test-cookie", Host: "elsewhere.invalid", Origin: "https://elsewhere.invalid",
    "Sec-Fetch-Site": "same-site", "Content-Length": "0" }, binding };
const native = (id: string | number = "101") => ({ "0": "2026-09-08T12:00:00Z", "8": id,
  "2": "Alpha", "3": "Beta", "7": { "31": ["3.5 0.91*101h -0.97*101a 31001"],
    "777": [{ outcome: "unmapped", value: 7 }] } });
const leagues = (events: readonly unknown[]) => [{ "1": "League", "2": events }];

describe("observed SBOBET detail protocol", () => {
  it("captures only the exact observed detail URL, browser-safe headers and document binding", () => {
    const template = sbobetDetailTemplateFromObserved(observed);
    expect(template).toEqual({ url: observed.url, observedEventId: "101",
      headers: { Accept: "application/json", "X-Request-Context": "test-context" }, binding });
    expect(template?.binding).not.toBe(binding);
  });

  it.each([
    { url: "https://api.sb21.net/api/v2/getEvent?timeRange=Today" },
    { url: "https://api.sb21.net/api/v2/getEvent?eventId=not-numeric" },
    { url: "https://api.sb21.net/api/v2/getEvent?eventId=101&eventId=102" },
    { url: "https://api.sb21.net/api/v2/getEvent?eventId=101&%65ventId=102" },
    { url: "https://api.sb21.net/api/v2/getEvent?eventId=101#fragment" },
    { url: "http://api.sb21.net/api/v2/getEvent?eventId=101" },
    { url: "https://elsewhere.invalid/api/v2/getEvent?eventId=101" },
    { method: "POST" },
    { binding: { ...binding, loaderId: "" } },
    { binding: { ...binding, sourceGeneration: -1 } },
    { binding: { ...binding, executionOrigin: "https://elsewhere.invalid" } }
  ])("rejects an unproven or unbound request %j", (override) => {
    expect(sbobetDetailTemplateFromObserved({ ...observed, ...override })).toBeNull();
  });

  it("accepts an already verified worker target without inventing a document binding", () => {
    const worker: SbobetDetailBinding = { sourceGeneration: 4, tabGeneration: 8,
      executionOrigin: "https://be.sb21.net", verifiedWorker: true, targetId: "worker-1", sessionId: "session-2" };
    expect(sbobetDetailTemplateFromObserved({ ...observed, binding: worker })?.binding).toEqual(worker);
    expect(sbobetDetailTemplateFromObserved({ ...observed, binding: { ...worker, sessionId: "" } })).toBeNull();
  });

  it("fetches by replacing only the observed eventId value and returns every exact native group", async () => {
    const template = sbobetDetailTemplateFromObserved(observed)!;
    const expression = buildSbobetDetailFetchExpression(template, "202", {
      timeoutMs: 500, marketContainerCompletenessVerified: true })!;
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const result = await runInNewContext(expression, {
      location: { origin: binding.executionOrigin }, AbortController, setTimeout, clearTimeout,
      fetch: async (url: string, init: RequestInit) => {
        requests.push({ url, init });
        return { status: 200, text: async () => JSON.stringify(leagues([native("202")])) };
      }
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.sb21.net/api/v2/getEvent?timeRange=Today&eventId=202&sportId=1&flag=a%20b");
    expect(requests[0]?.init).toMatchObject({ method: "GET", credentials: "include", cache: "no-store",
      headers: { Accept: "application/json", "X-Request-Context": "test-context" } });
    expect(result).toEqual({ status: 200, marketContainerComplete: true, event: native("202") });
  });

  it("executes serialized parser dependencies after an in-memory minified production-style bundle", async () => {
    const bundled = await build({ entryPoints: [fileURLToPath(new URL("./sbobet-detail-protocol.ts", import.meta.url))],
      bundle: true, minify: true, write: false, format: "iife", globalName: "Protocol", platform: "browser", target: "chrome120" });
    const protocol = runInNewContext(`${bundled.outputFiles[0]!.text}; Protocol`, { URL }) as {
      buildSbobetDetailFetchExpression: typeof buildSbobetDetailFetchExpression;
      sbobetDetailTemplateFromObserved: typeof sbobetDetailTemplateFromObserved;
    };
    const captured = protocol.sbobetDetailTemplateFromObserved(observed)!;
    for (const proof of [false, true]) {
      const expression = protocol.buildSbobetDetailFetchExpression(captured, "202", {
        marketContainerCompletenessVerified: proof })!;
      const result = await runInNewContext(expression, {
        location: { origin: binding.executionOrigin }, AbortController, setTimeout, clearTimeout,
        fetch: async () => ({ status: 200, text: async () => JSON.stringify(leagues([native("202")])) })
      });
      expect(result).toEqual({ status: 200, marketContainerComplete: proof, event: native("202") });
    }
  });

  it("rejects redirects instead of accepting detail from an unobserved endpoint", async () => {
    const expression = buildSbobetDetailFetchExpression(sbobetDetailTemplateFromObserved(observed)!, "202", {
      marketContainerCompletenessVerified: true })!;
    let followedRedirect = false;
    const result = await runInNewContext(expression, {
      location: { origin: binding.executionOrigin }, AbortController, setTimeout, clearTimeout,
      fetch: async (_url: string, init: RequestInit) => {
        if (init.redirect === "error") throw new TypeError("redirect refused");
        followedRedirect = true;
        return { status: 200, text: async () => JSON.stringify(native("202")) };
      }
    });
    expect(followedRedirect).toBe(false);
    expect(result).toEqual({ status: 0, marketContainerComplete: false });
  });

  it.each([undefined, false])("retains a valid native response without claiming unverified completeness (%j)", async (proof) => {
    const expression = buildSbobetDetailFetchExpression(sbobetDetailTemplateFromObserved(observed)!, "101",
      proof === undefined ? {} : { marketContainerCompletenessVerified: proof })!;
    const result = await runInNewContext(expression, {
      location: { origin: binding.executionOrigin }, AbortController, setTimeout, clearTimeout,
      fetch: async () => ({ status: 200, text: async () => JSON.stringify(native()) })
    });
    expect(result).toEqual({ status: 200, marketContainerComplete: false, event: native() });
  });

  it("requires structural validation even with verified endpoint completeness", async () => {
    const expression = buildSbobetDetailFetchExpression(sbobetDetailTemplateFromObserved(observed)!, "101", {
      marketContainerCompletenessVerified: true })!;
    const result = await runInNewContext(expression, {
      location: { origin: binding.executionOrigin }, AbortController, setTimeout, clearTimeout,
      fetch: async () => ({ status: 200, text: async () => JSON.stringify(native("102")) })
    });
    expect(result).toEqual({ status: 200, marketContainerComplete: false });
  });

  it("does not create a request without a captured template or from a changed execution origin", async () => {
    expect(buildSbobetDetailFetchExpression(null, "202")).toBeNull();
    const expression = buildSbobetDetailFetchExpression(sbobetDetailTemplateFromObserved(observed)!, "202")!;
    let requests = 0;
    const result = await runInNewContext(expression, {
      location: { origin: "https://other.sb21.net" }, AbortController, setTimeout, clearTimeout,
      fetch: async () => { requests += 1; throw new Error("must not fetch"); }
    });
    expect(requests).toBe(0);
    expect(result.marketContainerComplete).not.toBe(true);
  });

  it("aborts a timed-out fetch and never marks its body complete", async () => {
    const expression = buildSbobetDetailFetchExpression(sbobetDetailTemplateFromObserved(observed)!, "202", { timeoutMs: 50 })!;
    let timeoutCallback: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const pending = runInNewContext(expression, {
      location: { origin: binding.executionOrigin }, AbortController,
      setTimeout: (callback: () => void) => { timeoutCallback = callback; return 1; }, clearTimeout: () => {},
      fetch: async (_url: string, init: RequestInit) => {
        signal = init.signal!;
        return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted"))));
      }
    });
    timeoutCallback!();
    expect(signal?.aborted).toBe(true);
    expect((await pending).marketContainerComplete).not.toBe(true);
  });

  it.each([native(), [native()], leagues([native()]), [leagues([native()])]].map((body) => [body]))(
    "reads exactly one event from the native direct, league or date shape", (body) => {
      expect(parseSbobetDetailEvent(body, "101")).toEqual(native());
    });

  it.each([{}, [], { error: "failed", data: native() }, native("102"), [native(), native()],
    leagues([native(), native("102")]), { ...native(), "7": { "3": null, "21": [] } }].map((body) => [body]))(
    "rejects incomplete, erroneous or ambiguous detail body %j", (body) => {
      expect(parseSbobetDetailEvent(body, "101")).toBeNull();
    });

  it("preserves explicit complete empty groups and clones native evidence", () => {
    const body = { ...native(), "7": {} };
    const parsed = parseSbobetDetailEvent(body, "101");
    expect(parsed).toEqual(body);
    expect(parsed).not.toBe(body);
    expect(parseSbobetDetailEvent({ ...native(), "8": 101 }, "101")).toEqual({ ...native(), "8": 101 });
  });

  it("extracts every prematch ID and actual kickoff without requiring a mapped market", () => {
    expect(extractSbobetPrematchRoster([leagues([native(), { ...native("102"), "7": {} }])], { phase: "PREMATCH" }))
      .toEqual([{ eventId: "101", startAtUtcMs: Date.parse("2026-09-08T12:00:00Z"), phase: "PREMATCH" },
        { eventId: "102", startAtUtcMs: Date.parse("2026-09-08T12:00:00Z"), phase: "PREMATCH" }]);
    expect(extractSbobetPrematchRoster(leagues([native()]), { phase: "LIVE" })).toEqual([]);
    expect(extractSbobetPrematchRoster([], { phase: "PREMATCH" })).toEqual([]);
  });

  it.each([leagues([{ ...native(), "0": "unparseable" }]), leagues([{ ...native(), "0": undefined }]),
    leagues([native(), native()]), { error: "failed" }, [leagues([native()]), ...leagues([native("102")])]].map((body) => [body]))(
    "rejects an invalid or partial roster atomically", (body) => {
      expect(extractSbobetPrematchRoster(body, { phase: "PREMATCH" })).toBeNull();
    });

  it("rejects an oversized roster without truncating its membership", () => {
    expect(extractSbobetPrematchRoster(leagues([native(), native("102")]), { phase: "PREMATCH", maxEvents: 1 })).toBeNull();
  });
});
