import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string) =>
  [id, { VI: "team" }, { VI: "team line" }, false, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = ["hc", "Live", "Live", ["HC39", "full time", 1], "event", "league", "1", [
  selection("home", 1, -0.5, "0.82"), selection("away", 3, 0.5, "-0.92")]];
const payload = { serializedData: [["league", "Champions League", 0, "", false, "", "", "", "", "", "1", "Football", [[
  "event", [["h", { VI: "Home" }], ["a", { VI: "Away" }]], "Home vs Away", "", ["1", "0"], true, false, [],
  ["event", 0, [], [market]]
]]]] };

function envelope(body = JSON.stringify(payload)): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "BTI", sourceId: "chrome:BTI:1", tabId: 1,
    sequence: 9, observedAtMs: 1_786_805_000_000, receivedMonotonicMs: 20, transport: "HTTP_RESPONSE",
    request: { hostname: "prod.example.com", pathnameClass: "/api/eventlist/asia/leagues/v2/1/live", resourceType: "Fetch" },
    payload: { encoding: "UTF8", body } };
}

const listPaths = [
  "/api/eventlist/asia/leagues/v2/1/live",
  "/api/eventlist/asia/leagues/v2/1/live/initial",
  "/api/eventlist/asia/leagues/v2/1/prematch",
  "/api/eventlist/asia/leagues/v2/1/prematch/initial"
] as const;

function generationEnvelope(path: typeof listPaths[number], generation: string, sequence: number,
  body = JSON.stringify(payload)): ChromeBridgeEnvelope {
  return { ...envelope(body), sequence, request: { ...envelope().request, pathnameClass: path, streamId: generation } };
}

function completeGeneration(adapter: BtiHttpCatalogAdapter, generation: string, firstSequence: number,
  body = JSON.stringify(payload)) {
  return listPaths.map((path, index) => adapter.decode(generationEnvelope(path, generation,
    firstSequence + index, body)));
}

function committedCatalog(adapter: BtiHttpCatalogAdapter, generation = "bti:1000:1",
  firstSequence = 1, body = JSON.stringify(payload)) {
  return completeGeneration(adapter, generation, firstSequence, body)[3]![0]!.value;
}

function detailPayload(): unknown {
  const detailSelection = (id: string, side: 1 | 3, points: number, malay: string) => {
    const value = Array<unknown>(30).fill(null);
    value[0] = id; value[2] = id.includes("over") ? { VI: "Over" } : id.includes("under") ? { VI: "Under" } :
      side === 1 ? { VI: "Home" } : { VI: "Away" };
    value[5] = false; value[8] = ["", "1.90", "", "", "", malay];
    value[9] = side; value[13] = false; value[16] = points;
    return value;
  };
  const detailMarket = Array<unknown>(30).fill(null);
  detailMarket[0] = "detail-ou"; detailMarket[1] = "OU1"; detailMarket[5] = ["OU1", "OU1"];
  detailMarket[6] = "event"; detailMarket[13] = [
    detailSelection("detail-over", 1, 2.75, "0.90"), detailSelection("detail-under", 3, 2.75, "-0.99")
  ];
  const detailEvent = Array<unknown>(39).fill(null);
  detailEvent[0] = "event"; detailEvent[1] = "league"; detailEvent[2] = "Champions League";
  detailEvent[3] = "1"; detailEvent[8] = [["h", { VI: "Home" }, "Home"], ["a", { VI: "Away" }, "Away"]];
  detailEvent[11] = "2026-08-19T00:15:00.000Z"; detailEvent[13] = true; detailEvent[20] = [detailMarket];
  return { data: [detailEvent] };
}

function detailEnvelope(body: unknown = detailPayload(), observedAtMs = envelope().observedAtMs,
  generation: string | null = "bti:1000:1"): ChromeBridgeEnvelope {
  return { ...envelope(JSON.stringify(body)), sequence: 10, observedAtMs,
    request: { ...envelope().request, pathnameClass: "/api/eventpage/events/event",
      ...(generation === null ? {} : { streamId: generation }) } };
}

describe("BtiHttpCatalogAdapter", () => {
  it("publishes one BTI event-list generation only after every partition is complete", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const updates = completeGeneration(adapter, "bti:2000:1", 20);

    expect(updates.slice(0, 3)).toEqual([[], [], []]);
    expect(updates[3]).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      sequence: 23, value: expect.objectContaining({ events: [expect.objectContaining({
        providerEventId: "event" })] }) })]);
  });

  it("publishes an atomic generation when the provider rejects the optional non-initial prematch route", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const required = [listPaths[0], listPaths[1], listPaths[3]] as const;

    const updates = required.map((path, index) =>
      adapter.decode(generationEnvelope(path, "bti:2100:1", 30 + index)));

    expect(updates.slice(0, 2)).toEqual([[], []]);
    expect(updates[2]).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      value: expect.objectContaining({ events: expect.any(Array), quotes: expect.any(Array) }) })]);
  });

  it("does not roll back when an older generation completes after a newer snapshot", () => {
    const adapter = new BtiHttpCatalogAdapter();
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:1000:9", index + 1))).toEqual([]);
    }
    const newestPayload = JSON.stringify({ ...payload, serializedData: payload.serializedData.map((league) =>
      league.map((value, index) => index === 12 ? (value as unknown[]).map((event) => {
        const copy = [...event as unknown[]]; copy[0] = "new-event"; return copy;
      }) : value)) });
    const newest = completeGeneration(adapter, "bti:2000:1", 10, newestPayload)[3]!;
    expect((newest[0]!.value as { events: Array<{ providerEventId: string }> }).events
      .map(({ providerEventId }) => providerEventId)).toEqual(["new-event"]);

    expect(adapter.decode(generationEnvelope(listPaths[3], "bti:1000:9", 30))).toEqual([]);
  });

  it("retires an incomplete generation as soon as any response from a newer generation arrives", () => {
    const adapter = new BtiHttpCatalogAdapter();
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:1000:1", index + 1))).toEqual([]);
    }
    expect(adapter.decode(generationEnvelope(listPaths[0], "bti:2000:1", 10))).toEqual([]);
    expect(adapter.decode(generationEnvelope(listPaths[3], "bti:1000:1", 11))).toEqual([]);
  });

  it("keeps the last good catalog when a newer refresh times out after empty partial responses", () => {
    const adapter = new BtiHttpCatalogAdapter();
    completeGeneration(adapter, "bti:1000:1", 1);
    const empty = JSON.stringify({ serializedData: [] });
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:2000:1", 10 + index, empty))).toEqual([]);
    }

    const detail = adapter.decode(detailEnvelope());
    expect((detail[0]!.value as { events: Array<{ providerEventId: string }> }).events
      .map(({ providerEventId }) => providerEventId)).toContain("event");
  });

  it("does not let an uncorrelated or older detail response overlay the current generation", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter, "bti:1000:1");
    expect(adapter.decode(detailEnvelope(detailPayload(), envelope().observedAtMs, null))).toEqual([]);
    committedCatalog(adapter, "bti:2000:1", 20);
    expect(adapter.decode(detailEnvelope(detailPayload(), envelope().observedAtMs + 1, "bti:1000:1"))).toEqual([]);
  });
  it("merges bounded event-page detail markets into the current BTI catalog", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    expect(adapter.fingerprint(detailEnvelope())).toBe(true);
    const combined = adapter.decode(detailEnvelope())[0]!.value as {
      events: unknown[]; markets: { marketType: string }[]; quotes: unknown[];
    };
    expect(combined.events).toHaveLength(1);
    expect(combined.markets.map(({ marketType }) => marketType)).toEqual(
      expect.arrayContaining(["FT_AH", "FH_TOTAL"]));
    expect(combined.quotes).toHaveLength(4);
  });

  it("evicts expired detail markets and removes a valid empty event detail", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const withDetail = adapter.decode(detailEnvelope())[0]!.value as { markets: { marketType: string }[] };
    expect(withDetail.markets.some(({ marketType }) => marketType === "FH_TOTAL")).toBe(true);

    const expiredAt = envelope().observedAtMs + 10_001;
    const expired = adapter.decode(detailEnvelope({ data: [] }, expiredAt))[0]!.value as {
      markets: { marketType: string }[];
    };
    expect(expired.markets.some(({ marketType }) => marketType === "FH_TOTAL")).toBe(false);

    adapter.decode(detailEnvelope(detailPayload(), expiredAt + 1));
    expect(adapter.decode(detailEnvelope({ data: [] }, expiredAt + 2))).toHaveLength(1);
    const afterEmpty = adapter.decode(detailEnvelope({ data: [] }, expiredAt + 3))[0]!.value as {
      markets: { marketType: string }[];
    };
    expect(afterEmpty.markets.some(({ marketType }) => marketType === "FH_TOTAL")).toBe(false);
  });

  it("publishes removal immediately when a valid event detail becomes empty", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(detailEnvelope());
    const removed = adapter.decode(detailEnvelope({ data: [] }, envelope().observedAtMs + 1));
    expect(removed).toHaveLength(1);
    expect((removed[0]!.value as { markets: Array<{ marketType: string }> }).markets
      .some(({ marketType }) => marketType === "FH_TOTAL")).toBe(false);
  });

  it("replaces a valid empty BTI list generation instead of retaining stale events", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const empty = committedCatalog(adapter, "bti:2000:1", 10,
      JSON.stringify({ serializedData: [] })) as {
      events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(empty).toMatchObject({ events: [], markets: [], quotes: [] });
  });

  it("decodes the live football event-list response", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.fingerprint(envelope())).toBe(true);
    const catalog = committedCatalog(adapter) as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(catalog).toMatchObject({ accountId: "catalog-source:BTI:FOOTBALL", provider: "BTI" });
    expect(catalog.events).toHaveLength(1);
    expect(catalog.markets).toHaveLength(1);
    expect(catalog.quotes).toHaveLength(2);
  });

  it("accepts prematch event-list responses and retains live plus prematch catalogs", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const prematchPayload = { serializedData: [["league-p", "Prematch League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [[
        "hc-p", "Prematch", "Prematch", ["HC0", "full time", 1], "event-p", "league-p", "1",
        [selection("home-p", 1, -0.5, "0.82"), selection("away-p", 3, 0.5, "-0.92")]
      ]]]
    ]]]]} ;
    const prematchEnvelope = generationEnvelope("/api/eventlist/asia/leagues/v2/1/prematch/initial",
      "bti:1000:1", 4, JSON.stringify(prematchPayload));
    expect(adapter.fingerprint(prematchEnvelope)).toBe(true);
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:1000:1", index + 1))).toEqual([]);
    }
    const combined = adapter.decode(prematchEnvelope)[0]!.value as { events: { providerEventId: string; isLive: boolean }[] };
    expect(combined.events.map(({ providerEventId, isLive }) => [providerEventId, isLive])).toEqual([
      ["event", true], ["event-p", false]
    ]);
  });

  it("keeps market and quote identities isolated when BTI reuses ids across events", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const reusedIds = { serializedData: [["league-p", "Prematch League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [[
        "hc", "Prematch", "Prematch", ["HC0", "full time", 1], "event-p", "league-p", "1",
        [selection("home", 1, -0.5, "0.82"), selection("away", 3, 0.5, "-0.92")]
      ]]]
    ]]]]} ;
    let update: unknown;
    for (const [index, path] of listPaths.entries()) {
      const body = path.includes("prematch") ? JSON.stringify(reusedIds) : JSON.stringify(payload);
      const result = adapter.decode(generationEnvelope(path, "bti:1000:1", index + 1, body));
      if (result.length > 0) update = result[0]!.value;
    }
    const catalog = update as {
        events: unknown[]; markets: unknown[]; quotes: unknown[];
      };
    expect(catalog.events).toHaveLength(2);
    expect(catalog.markets).toHaveLength(2);
    expect(catalog.quotes).toHaveLength(4);
  });

  it("rejects unrelated paths and malformed bodies", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.decode({ ...envelope(), request: { ...envelope().request, pathnameClass: "/api/profile" } })).toEqual([]);
    expect(adapter.decode(envelope("not-json"))).toEqual([]);
  });
});
