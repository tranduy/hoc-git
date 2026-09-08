import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";

// Evaluate the standalone constant without importing extension sources into the API tsconfig.
const source = readFileSync(new URL("../../../chrome-extension/src/bti-catalog-refresh.ts", import.meta.url), "utf8");
const expression = new Function(source.replace("export const BTI_CATALOG_REFRESH_EXPRESSION =", "return"))() as string;
const START = 1_800_000_000_000;
type Row = unknown[];
interface CollectorResult {
  readonly status: string;
  readonly generation: string;
  readonly responses: readonly { readonly url: string; readonly body: string }[];
}

function roster() {
  const selection = (id: string, side: number, line: number) => [id, { EN: "team" }, { EN: "team" },
    false, false, 1.9, ["", "1.90", "", "", "", "0.82"], side, 2, {}, "", "event", "main", line];
  const market = ["main", "Handicap", "Handicap", ["HC0", "Handicap", 1], "event", "league", "1",
    [selection("main-home", 1, -0.5), selection("main-away", 3, 0.5)]];
  const event: Row = ["event", [["a", { EN: "Alpha" }], ["b", { EN: "Beta" }]], "Alpha vs Beta",
    new Date(START + 3_600_000).toISOString(), null, false, false, [], ["event", 0, [], [market]]];
  const league: Row = Array(13).fill(null);
  league[0] = "league"; league[1] = "League"; league[12] = [event];
  return { serializedData: [league] };
}

function detail(price: string) {
  const selection = (id: string, side: number, name: string): Row => {
    const value: Row = Array(30).fill(null);
    value[0] = id; value[2] = { EN: name }; value[5] = false;
    value[8] = ["", "1.90", "", "", "", price]; value[9] = side;
    value[13] = false; value[16] = 2.5;
    return value;
  };
  const hidden: Row = Array(30).fill(null);
  hidden[0] = "hidden"; hidden[1] = "First half total"; hidden[5] = ["OU1", "First half total"];
  hidden[6] = "event"; hidden[13] = [selection("hidden-over", 1, "Over"), selection("hidden-under", 3, "Under")];
  const unknown: Row = Array(30).fill(null);
  unknown[0] = "unknown"; unknown[1] = "Unverified prop"; unknown[5] = ["QA99999", "Unverified prop"];
  unknown[6] = "event"; unknown[13] = [selection("unknown-selection", 1, "First")];
  const unnamed: Row = Array(30).fill(null);
  unnamed[13] = [["unnamed-selection"]];
  const event: Row = Array(39).fill(null);
  event[0] = "event"; event[1] = "league"; event[2] = "League"; event[3] = "1";
  event[8] = [["a", { EN: "Alpha" }], ["b", { EN: "Beta" }]];
  event[11] = new Date(START + 3_600_000).toISOString(); event[13] = false; event[20] = [hidden, unknown, unnamed];
  return { data: [event] };
}

function harness() {
  const root = { dataset: {} as Record<string, string> };
  let detailFetches = 0;
  const fetcher = async (path: string) => {
    if (path.startsWith("/api/eventpage/")) {
      detailFetches += 1;
      return { ok: detailFetches <= 2,
        text: async () => detailFetches <= 2 ? JSON.stringify(detail(detailFetches === 1 ? "0.90" : "0.75")) : "unavailable" };
    }
    return { ok: true, text: async () => JSON.stringify(path.includes("prematch") ? roster() : { serializedData: [] }) };
  };
  const evaluate = new Function("document", "location", "fetch", "localStorage", `return ${expression}`);
  return {
    refresh: () => evaluate({ documentElement: root },
      { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" }, fetcher,
      { getItem: () => null }) as Promise<CollectorResult>,
    detailFetches: () => detailFetches
  };
}

function decode(adapter: BtiHttpCatalogAdapter, result: CollectorResult, sourceId = "chrome:BTI:1") {
  expect(result.status).toBe("catalog-requested");
  expect(result.responses.filter((item) => item.url.startsWith("/api/eventlist/")).map((item) => item.url)).toEqual([
    "/api/eventlist/asia/leagues/v2/1/live",
    "/api/eventlist/asia/leagues/v2/1/live/initial",
    "/api/eventlist/asia/leagues/v2/1/prematch/initial"
  ]);
  const updates = result.responses.map((response, index) => {
    const envelope: ChromeBridgeEnvelope = {
      version: 1, kind: "NETWORK", lobby: "BTI", sourceId, tabId: 1, sequence: index + 1,
      observedAtMs: Date.now(), receivedMonotonicMs: Date.now() - START + 100, transport: "HTTP_RESPONSE",
      request: { hostname: "bti.test", pathnameClass: response.url, resourceType: "Fetch", streamId: result.generation },
      payload: { encoding: "UTF8", body: response.body }
    };
    return adapter.decode(envelope);
  });
  // Cached detail primes the adapter before the complete three-part roster commits.
  expect(updates.slice(0, -1).every((update) => update.length === 0)).toBe(true);
  expect(updates.at(-1)).toHaveLength(1);
  return updates.at(-1)![0]!.value as ObservedProviderCatalog;
}

function quote(catalog: ObservedProviderCatalog, id: string) {
  const found = catalog.quotes.find((item) => item.providerSelectionId === id);
  expect(found).toBeDefined();
  return found!;
}

describe("BTI private collector to HTTP adapter", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("publishes hidden price changes from a second detail fetch and retains source age on reconnect", async () => {
    const h = harness();
    const adapter = new BtiHttpCatalogAdapter();
    const initialResult = await h.refresh();
    const bootstrapGeneration = initialResult.generation;
    const bootstrap = decode(adapter, initialResult);
    expect(quote(bootstrap, "main-home")).toMatchObject({ rawOdds: "0.82", receivedMonotonicMs: 100 });
    await vi.advanceTimersByTimeAsync(13_000);

    const firstHiddenResult = await h.refresh();
    const firstHidden = decode(adapter, firstHiddenResult);
    expect(quote(firstHidden, "hidden-over")).toMatchObject({ rawOdds: "0.75", receivedMonotonicMs: 13_100 });
    expect(quote(firstHidden, "main-home")).toMatchObject({ rawOdds: "0.82", receivedMonotonicMs: 13_100 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.detailFetches()).toBe(2);
    await vi.advanceTimersByTimeAsync(12_000);

    const changedResult = await h.refresh();
    const changed = decode(adapter, changedResult);
    expect(quote(changed, "hidden-over")).toMatchObject({ rawOdds: "0.75", receivedMonotonicMs: 13_100,
      marketType: "FH_TOTAL", providerMarketId: "hidden:2.5" });
    expect(quote(changed, "main-home")).toMatchObject({ rawOdds: "0.82", receivedMonotonicMs: 26_100 });
    expect(changed.nativeMarketObservations).toContainEqual(expect.objectContaining({
      nativeType: "QA99999", disposition: "UNMAPPED", observedAtMs: START + 13_000
    }));
    expect(changed.nativeMarketObservations).toContainEqual(expect.objectContaining({
      nativeType: "UNKNOWN", disposition: "UNMAPPED", observedAtMs: START + 13_000
    }));
    const batch = changedResult.responses.find((response) => response.url.includes("__fieldline_batch_"));
    expect(batch).toBeDefined();
    expect(JSON.parse(batch!.body).fieldlineBtiDetails).toEqual([{
      eventId: "event", requestedAtMs: START + 13_000, observedAtMs: START + 13_000,
      generation: bootstrapGeneration
    }]);

    await vi.advanceTimersByTimeAsync(2_000);
    const cached = await h.refresh();
    expect(cached).toEqual(changedResult);
    const reconnected = decode(new BtiHttpCatalogAdapter(), cached, "chrome:BTI:2");
    expect(quote(reconnected, "hidden-over")).toMatchObject({ rawOdds: "0.75", receivedMonotonicMs: 13_100 });
    expect(quote(reconnected, "main-home")).toMatchObject({ rawOdds: "0.82", receivedMonotonicMs: 26_100 });
    expect(reconnected.nativeMarketObservations?.find((item) => item.nativeType === "QA99999")?.observedAtMs)
      .toBe(START + 13_000);
  });
});
