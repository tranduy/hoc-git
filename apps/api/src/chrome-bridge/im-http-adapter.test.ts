import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";

const event = { eid: 112516390, htn: "Monterrey Rayados", atn: "Nashville SC", cn: "Leagues Cup",
  edt: "2026-08-16T20:00:00-04:00", isrbt: false, iscyb: false, mls: [{ mi: 10, bti: 1, gp: 1, ws: [
    { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67, ot: 1 },
    { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79, ot: 1 }
  ] }] };

function envelope(body: unknown, sequence = 1, path = "/api/EventV6/GetSE",
  providerPartition?: "IM_MARKET_1" | "IM_MARKET_2", generation = "im:8:1",
  sourceEpoch = "observer-im:0", reconcileCutoffSequence = 0): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8, sequence,
    sourceEpoch,
    observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + sequence,
    receivedMonotonicMs: 50 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "imsports.directsb.net", pathnameClass: path, resourceType: "XHR",
      ...(providerPartition === undefined ? {} : { providerPartition, streamId: generation,
        reconcileCutoffSequence }) },
    payload: { encoding: "UTF8", body: JSON.stringify(body) } };
}

describe("ImHttpCatalogAdapter", () => {
  const seedBothPartitions = (adapter: ImHttpCatalogAdapter): void => {
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined, "IM_MARKET_1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined, "IM_MARKET_2"))).toHaveLength(1);
  };

  it("publishes only after strict GetSE snapshots establish both IM partitions", () => {
    const adapter = new ImHttpCatalogAdapter();
    const first = envelope({ StatusCode: 100, sel: [event] }, 1, undefined, "IM_MARKET_1");
    expect(adapter.fingerprint(first)).toBe(true);
    expect(adapter.decode(first)).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined, "IM_MARKET_2"))[0]?.value)
      .toMatchObject({
      accountId: "catalog-source:IM:FOOTBALL", provider: "IM",
      events: [{ providerEventId: "112516390" }],
      markets: [{ providerMarketId: "10", marketType: "FT_AH", line: "0.5" }]
    });
  });

  it("keeps a future prematch fixture beyond the legacy 48-hour horizon", () => {
    const adapter = new ImHttpCatalogAdapter();
    const farFuture = { ...event, eid: 112516391, edt: "2026-09-16T20:00:00-04:00" };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [farFuture] }, 1, undefined,
      "IM_MARKET_1"))).toEqual([]);
    const update = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2"))[0];

    expect(update?.value).toMatchObject({
      events: [expect.objectContaining({ providerEventId: "112516391", isLive: false })]
    });
  });

  it("emits transport continuity for a valid incomplete newer GetSE generation after a baseline", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 3, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([{
      sourceId: "chrome:IM:8",
      sequence: 3,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 3,
      transportAlive: true
    }]);
  });

  it("commits Hong Kong odds only after both partitions share one cutoff and generation", () => {
    const adapter = new ImHttpCatalogAdapter();
    const hongKongEvent = { ...event, mls: [{ ...event.mls[0], ws: [
      { ...event.mls[0]!.ws[0], o: 1.25 },
      { ...event.mls[0]!.ws[1], o: 3 }
    ] }] };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [hongKongEvent] }, 11, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 10))).toEqual([]);
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 10))[0];
    expect(committed).toMatchObject({
      authoritativeBaseline: true, evidenceMode: "BASELINE", generation: "im:8:1"
    });
    const catalog = committed!.value as {
      quotes: readonly { providerSelectionId: string; rawOdds: string }[];
    };
    expect(catalog.quotes.map((quote) => [quote.providerSelectionId, quote.rawOdds]))
      .toEqual([["101", "-0.8"], ["102", "-0.3333333333333333"]]);
  });

  it.each([
    ["zero", 0],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["a malformed string", "1.25"],
    ["unsupported nested odds", { value: 1.25 }],
    ["an out-of-contract negative value", -1.01]
  ])("poisons a generation when a GetSE partition contains %s", (_label, odds) => {
    const adapter = new ImHttpCatalogAdapter();
    const malformed = { ...event, mls: [{ ...event.mls[0], ws: event.mls[0]!.ws
      .map((item, index) => index === 0 ? { ...item, o: odds } : item) }] };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [malformed] }, 1, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 3, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 4, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 5, undefined,
      "IM_MARKET_2", "im:8:2"))).toHaveLength(1);
  });

  it("applies GetSEDelta only after a baseline and keeps provider IDs stable", () => {
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ mi: 10, bti: 1, gp: 1, ws: [
      { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
      { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
    ] }] }] };
    expect(new ImHttpCatalogAdapter().decode(envelope(delta, 1, "/api/EventV6/GetSEDelta"))).toEqual([]);
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const update = adapter.decode(envelope(delta, 3, "/api/EventV6/GetSEDelta"))[0]?.value as {
      quotes: readonly { providerSelectionId: string; rawOdds: string }[];
    };
    expect(update.quotes.map((quote) => [quote.providerSelectionId, quote.rawOdds]))
      .toEqual([["101", "0.8"], ["102", "-0.9"]]);
  });

  it("emits authenticated transport continuity for a valid ordered quiet delta after the baseline", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);

    expect(adapter.decode(envelope({ StatusCode: 100, dc: [] }, 3,
      "/api/EventV6/GetSEDelta"))).toEqual([{
      sourceId: "chrome:IM:8",
      sequence: 3,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 3,
      transportAlive: true
    }]);
  });

  it("emits only transport continuity when an ordered market delta repeats the current values", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const sameMarket = structuredClone(event.mls[0]);

    expect(adapter.decode(envelope({ StatusCode: 100,
      dc: [{ eid: event.eid, a: 3, v: [sameMarket] }] }, 3,
    "/api/EventV6/GetSEDelta"))).toEqual([{
      sourceId: "chrome:IM:8",
      sequence: 3,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 3,
      transportAlive: true
    }]);
  });

  it("does not treat a delta with non-IM partition metadata as transport continuity", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const quiet = envelope({ StatusCode: 100, dc: [] }, 3, "/api/EventV6/GetSEDelta");

    expect(adapter.decode({ ...quiet,
      request: { ...quiet.request, providerPartition: "KSPORT_LIVE",
        providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence: 0 } })).toEqual([]);
  });

  it("normalizes a later ordered Hong Kong delta without changing exact identities", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0], ws: [
      { ...event.mls[0]!.ws[0], o: 1.25 },
      { ...event.mls[0]!.ws[1], o: 2 }
    ] }] }] };

    const update = adapter.decode(envelope(delta, 3, "/api/EventV6/GetSEDelta"))[0]?.value as {
      events: readonly { providerEventId: string }[];
      markets: readonly { providerMarketId: string }[];
      quotes: readonly { providerSelectionId: string; rawOdds: string }[];
    };
    expect(update).toMatchObject({
      events: [{ providerEventId: "112516390" }],
      markets: [{ providerMarketId: "10" }]
    });
    expect(update.quotes.map((quote) => [quote.providerSelectionId, quote.rawOdds]))
      .toEqual([["101", "-0.8"], ["102", "-0.5"]]);
  });

  it("rejects a delayed delta at or before the committed reconciliation cutoff", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 101, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 100))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 102, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 100))).toHaveLength(1);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0], ws: [
      { ...event.mls[0]!.ws[0], o: 0.11 }, { ...event.mls[0]!.ws[1], o: -0.12 }
    ] }] }] };

    expect(adapter.decode(envelope(delta, 90, "/api/EventV6/GetSEDelta"))).toEqual([]);
    expect(adapter.decode(envelope(delta, 103, "/api/EventV6/GetSEDelta"))).toHaveLength(1);
  });

  it("does not advance delta ordering or delete identities for malformed odds", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const malformed = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{
      ...event.mls[0], ws: event.mls[0]!.ws.map((item, index) => index === 0
        ? { ...item, o: 0 } : item)
    }] }] };
    const valid = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{
      ...event.mls[0], ws: event.mls[0]!.ws.map((item, index) => index === 0
        ? { ...item, o: 0.84 } : item)
    }] }] };

    expect(adapter.decode(envelope(malformed, 200, "/api/EventV6/GetSEDelta"))).toEqual([]);
    const accepted = adapter.decode(envelope(valid, 150, "/api/EventV6/GetSEDelta"))[0]?.value as {
      events: readonly unknown[]; markets: readonly unknown[];
      quotes: readonly { providerSelectionId: string; rawOdds: string }[];
    };
    expect(accepted.events).toHaveLength(1);
    expect(accepted.markets).toHaveLength(1);
    expect(accepted.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "101", rawOdds: "0.84" }),
      expect.objectContaining({ providerSelectionId: "102", rawOdds: "-0.79" })
    ]));
  });

  it("publishes exact second-half tickets from provider game period 3 deltas", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{
      mi: 30, bti: 1, gp: 3, ws: [
        { wsi: 301, si: 1, hdp: -0.75, dih: "+0.75", o: 0.82, ot: 1 },
        { wsi: 302, si: 2, hdp: -0.75, dih: "-0.75", o: -0.94, ot: 1 }
      ]
    }, {
      mi: 31, bti: 2, gp: 3, ws: [
        { wsi: 311, si: 3, hdp: 1.75, dih: "1.5/2", o: 0.81, ot: 1 },
        { wsi: 312, si: 4, hdp: 1.75, dih: "1.5/2", o: -0.93, ot: 1 }
      ]
    }] }] };
    const update = adapter.decode(envelope(delta, 2, "/api/EventV6/GetSEDelta"))[0]?.value as {
      markets: readonly { providerMarketId: string; marketType: string; scope: string }[];
    };
    expect(update.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "30", marketType: "SH_AH", scope: "SECOND_HALF" }),
      expect.objectContaining({ providerMarketId: "31", marketType: "SH_TOTAL", scope: "SECOND_HALF" })
    ]));
  });

  it("replaces both partitions together and gives the completed generation its own clocks", () => {
    const makeEvent = (eventId: number, marketId: number, home: string) => ({ ...event, eid: eventId,
      htn: home, atn: `Away ${eventId}`, mls: event.mls.map((market) => ({ ...market, mi: marketId,
        ws: market.ws.map((selection, index) => ({ ...selection, wsi: marketId * 10 + index })) })) });
    const adapter = new ImHttpCatalogAdapter();
    const marketOne = makeEvent(101, 11, "Market One");
    const marketTwo = makeEvent(202, 22, "Market Two");
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [marketOne] }, 1, undefined, "IM_MARKET_1")))
      .toEqual([]);
    adapter.decode(envelope({ StatusCode: 100, sel: [marketTwo] }, 2, undefined, "IM_MARKET_2"));

    const replacement = makeEvent(303, 33, "Replacement");
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [replacement] }, 3, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([{
      sourceId: "chrome:IM:8", sequence: 3,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 3, transportAlive: true
    }]);
    const catalog = adapter.decode(envelope({ StatusCode: 100, sel: [marketTwo] }, 4, undefined,
      "IM_MARKET_2", "im:8:2"))[0]!.value as { events: Array<{ providerEventId: string }>;
        quotes: Array<{ providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["202", "303"]);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "202"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 54, sequence: 4 })]));
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "303"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 53, sequence: 3 })]));
  });

  it("does not combine Market 1 from a new generation with Market 2 from the old generation", () => {
    const makeEvent = (eventId: number, marketId: number, home: string) => ({ ...event, eid: eventId,
      htn: home, atn: `Away ${eventId}`, mls: event.mls.map((market) => ({ ...market, mi: marketId,
        ws: market.ws.map((selection, index) => ({ ...selection, wsi: marketId * 10 + index })) })) });
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(101, 11, "Old One")] }, 1,
      undefined, "IM_MARKET_1", "im:8:1"));
    const oldCatalog = adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(202, 22, "Old Two")] }, 2,
      undefined, "IM_MARKET_2", "im:8:1"));
    expect(oldCatalog).toHaveLength(1);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(303, 33, "New One")] }, 3,
      undefined, "IM_MARKET_1", "im:8:2"))).toEqual([{
      sourceId: "chrome:IM:8", sequence: 3,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 3, transportAlive: true
    }]);
    const current = adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(404, 44, "New Two")] }, 4,
      undefined, "IM_MARKET_2", "im:8:2"))[0]!.value as {
        events: Array<{ providerEventId: string }> };
    expect(current.events.map((item) => item.providerEventId).sort()).toEqual(["303", "404"]);
  });

  it("publishes one atomic generation when Market 2 arrives before Market 1", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 1, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:1"))[0]?.value).toMatchObject({
      events: [{ providerEventId: "112516390" }]
    });
  });

  it("does not roll back when both partitions of an older completed generation arrive late", () => {
    const makeEvent = (eventId: number) => ({ ...event, eid: eventId, htn: `Home ${eventId}`,
      atn: `Away ${eventId}` });
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(101)] }, 1, undefined,
      "IM_MARKET_1", "im:8:1"));
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(102)] }, 2, undefined,
      "IM_MARKET_2", "im:8:1"));
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(201)] }, 3, undefined,
      "IM_MARKET_1", "im:8:2"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(202)] }, 4, undefined,
      "IM_MARKET_2", "im:8:2"))).toHaveLength(1);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(101)] }, 5, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(102)] }, 6, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
  });

  it("rejects an unseen lower signed reconciliation ordinal after a newer generation commits", () => {
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined, "IM_MARKET_1", "im:8:2"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:2"))).toHaveLength(1);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 3, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 4, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["a missing selection array", JSON.stringify({ StatusCode: 100 })],
    ["a failed provider status", JSON.stringify({ StatusCode: 500, sel: [event] })]
  ])("poisons a routed generation after %s", (_label, body) => {
    const adapter = new ImHttpCatalogAdapter();
    const failed = envelope({ StatusCode: 100, sel: [event] }, 1, undefined, "IM_MARKET_1", "im:8:1");
    const routedFailure = { ...failed, payload: { encoding: "UTF8" as const, body } };

    expect(adapter.fingerprint(routedFailure)).toBe(true);
    expect(adapter.decode(routedFailure)).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 3, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
  });

  it("poisons a declared generation when its partition metadata is missing", () => {
    const adapter = new ImHttpCatalogAdapter();
    const candidate = envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:1");
    const { providerPartition: _providerPartition, ...request } = candidate.request;
    const missingPartition = { ...candidate, request };

    expect(adapter.fingerprint(missingPartition)).toBe(true);
    expect(adapter.decode(missingPartition)).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 3, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
  });

  it("poisons a declared generation when its cutoff is missing", () => {
    const adapter = new ImHttpCatalogAdapter();
    const candidate = envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:1");
    const { reconcileCutoffSequence: _reconcileCutoffSequence, ...request } = candidate.request;
    const missingCutoff = { ...candidate, request };

    expect(adapter.fingerprint(missingCutoff)).toBe(true);
    expect(adapter.decode(missingCutoff)).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 3, undefined,
      "IM_MARKET_2", "im:8:1"))).toEqual([]);
  });

  it("poisons both partitions after their reconciliation cutoffs disagree", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 11, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 10))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 11))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 13, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 10))).toEqual([]);
  });

  it.each(["im:8:generation", "im:8:01", "im:08:1", "im:8:0", "other:8:1"])(
    "rejects noncanonical reconciliation generation %s", (generation) => {
      const adapter = new ImHttpCatalogAdapter();
      expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
        "IM_MARKET_1", generation))).toEqual([]);
      expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
        "IM_MARKET_2", generation))).toEqual([]);
    });

  it("rejects a different generation ID that reuses the committed ordinal", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:3"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:3"))).toHaveLength(1);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 3, undefined,
      "IM_MARKET_1", "im:999:3"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 4, undefined,
      "IM_MARKET_2", "im:999:3"))).toEqual([]);
  });

  it("permanently rejects a generation when its second partition is malformed", () => {
    const adapter = new ImHttpCatalogAdapter();
    const malformed = { ...event, htn: "" };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [malformed] }, 2, undefined,
      "IM_MARKET_2", "im:8:2"))).toEqual([]);
    expect(adapter.takeIgnoreReason()).toBe("snapshot-classification-invalid");
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 3, undefined,
      "IM_MARKET_2", "im:8:2"))).toEqual([]);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 4, undefined,
      "IM_MARKET_1", "im:8:3"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 5, undefined,
      "IM_MARKET_2", "im:8:3"))).toHaveLength(1);
  });

  it("keeps a generation whose in-domain market has no published line yet, dropping only that market", () => {
    // Measured 2026-09-01: IM Market 2 carried 11 markets whose selections had
    // every field except `hdp`. One such market used to reject the whole
    // generation and IM never established a baseline for the session.
    const adapter = new ImHttpCatalogAdapter();
    const lineless = { ...event, eid: 112516391, mls: [{ mi: 20, bti: 2, gp: 1, ws: [
      { wsi: 201, si: 3, dih: "2.5", o: 0.9, ot: 1 },
      { wsi: 202, si: 4, dih: "2.5", o: -0.98, ot: 1 }
    ] }] };
    const mixed = { ...event, eid: 112516392, mls: [
      { mi: 30, bti: 1, gp: 1, ws: [
        { wsi: 301, si: 1, dih: "+0.5", o: 0.67, ot: 1 },
        { wsi: 302, si: 2, dih: "-0.5", o: -0.79, ot: 1 }
      ] },
      { mi: 31, bti: 2, gp: 1, ws: [
        { wsi: 311, si: 3, hdp: 2.5, dih: "2.5", o: 0.9, ot: 1 },
        { wsi: 312, si: 4, hdp: 2.5, dih: "2.5", o: -0.98, ot: 1 }
      ] }
    ] };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined, "IM_MARKET_1"))).toEqual([]);
    const published = adapter.decode(envelope({ StatusCode: 100, sel: [lineless, mixed] }, 2, undefined,
      "IM_MARKET_2"));
    expect(published).toHaveLength(1);
    const catalog = published[0]!.value as {
      events: readonly { providerEventId: string }[]; markets: readonly { providerMarketId: string }[];
    };
    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["112516390", "112516392"]);
    expect(catalog.markets.map((item) => item.providerMarketId).sort()).toEqual(["10", "31"]);
  });

  it("still rejects a generation whose in-domain market carries a malformed line", () => {
    const adapter = new ImHttpCatalogAdapter();
    const malformed = { ...event, mls: [{ ...event.mls[0]!, ws: [
      { ...event.mls[0]!.ws[0]!, hdp: "0.5" }, event.mls[0]!.ws[1]!
    ] }] };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [malformed] }, 1, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:2"))).toEqual([]);
  });

  it("rejects every later partition after a malformed first partition until the source resets", () => {
    const adapter = new ImHttpCatalogAdapter();
    const malformed = { ...event, mls: [{ ...event.mls[0], ws: [] }] };

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [malformed] }, 1, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:2"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 3, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([]);

    adapter.resetSource("chrome:IM:8");
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:1"))).toHaveLength(1);
  });

  it("reapplies a newer delta after a two-part baseline commits", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const replacement = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [replacement] }, 10, undefined,
      "IM_MARKET_1", "im:8:2"))).toEqual([{
      sourceId: "chrome:IM:8", sequence: 10,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 10, transportAlive: true
    }]);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection, o: selection.wsi === 101 ? 0.84 : -0.91 })) }] }] };
    adapter.decode(envelope(delta, 11, "/api/EventV6/GetSEDelta"));
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:2")).at(-1)?.value as {
        quotes: Array<{ providerSelectionId: string; rawOdds: string }> };
    expect(committed.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "101", rawOdds: "0.84" })
    ]));
  });

  it("reapplies a delta that arrives after the signed cutoff but before the first partition", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection,
        o: selection.wsi === 101 ? 0.84 : -0.91 })) }] }] };
    expect(adapter.decode(envelope(delta, 10, "/api/EventV6/GetSEDelta"))).toHaveLength(1);
    const replacement = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [replacement] }, 11, undefined,
      "IM_MARKET_1", "im:8:2", "observer-im:0", 9))).toEqual([{
      sourceId: "chrome:IM:8", sequence: 11,
      observedAtMs: Date.parse("2026-08-16T00:00:00.000Z") + 11, transportAlive: true
    }]);
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:2", "observer-im:0", 9)).at(-1)?.value as {
        quotes: Array<{ providerSelectionId: string; rawOdds: string }> };
    expect(committed.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "101", rawOdds: "0.84" })
    ]));
  });

  it("replays a delta received during the first-ever signed reconciliation", () => {
    const adapter = new ImHttpCatalogAdapter();
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection,
        o: selection.wsi === 101 ? 0.84 : -0.91 })) }] }] };
    expect(adapter.decode(envelope(delta, 10, "/api/EventV6/GetSEDelta"))).toEqual([]);
    const signedBaseline = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 11, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 9))).toEqual([]);
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 9)).at(-1)?.value as {
        quotes: Array<{ providerSelectionId: string; rawOdds: string }> };
    expect(committed.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "101", rawOdds: "0.84" })
    ]));
  });

  it("replays a delta received between the first and second initial partitions", () => {
    const adapter = new ImHttpCatalogAdapter();
    const signedBaseline = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 10, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 9))).toEqual([]);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection,
        o: selection.wsi === 101 ? 0.84 : -0.91 })) }] }] };
    expect(adapter.decode(envelope(delta, 11, "/api/EventV6/GetSEDelta"))).toEqual([]);
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 9)).at(-1)?.value as {
        quotes: Array<{ providerSelectionId: string; rawOdds: string }> };
    expect(committed.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "101", rawOdds: "0.84" })
    ]));
  });

  it("rejects initial reconciliation when the bounded replay would drop a post-cutoff delta", () => {
    const adapter = new ImHttpCatalogAdapter();
    const signedBaseline = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    adapter.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 10, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 9));
    adapter.decode(envelope({ StatusCode: 100, dc: [{ eid: 112516390, a: 1 }] }, 11,
      "/api/EventV6/GetSEDelta"));
    for (let offset = 0; offset < 128; offset += 1) {
      const homePrice = 0.7 + offset / 10_000;
      const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
        ws: event.mls[0]!.ws.map((selection) => ({ ...selection,
          o: selection.wsi === 101 ? homePrice : -0.9 })) }] }] };
      adapter.decode(envelope(delta, 12 + offset, "/api/EventV6/GetSEDelta"));
    }
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 140, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 9))).toEqual([]);
  });

  it("rejects a late reconciliation whose required delta was discarded before its first partition", () => {
    const adapter = new ImHttpCatalogAdapter();
    const signedBaseline = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    adapter.decode(envelope({ StatusCode: 100, dc: [{ eid: 112516390, a: 1 }] }, 11,
      "/api/EventV6/GetSEDelta"));
    for (let offset = 0; offset < 128; offset += 1) {
      const homePrice = 0.7 + offset / 10_000;
      const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
        ws: event.mls[0]!.ws.map((selection) => ({ ...selection,
          o: selection.wsi === 101 ? homePrice : -0.9 })) }] }] };
      adapter.decode(envelope(delta, 12 + offset, "/api/EventV6/GetSEDelta"));
    }

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 140, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 9))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 141, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 9))).toEqual([]);
  });

  it("does not replay a pre-cutoff delta or a delta from a retired source epoch", () => {
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection, o: 0.84 })) }] }] };
    const signedBaseline = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope(delta, 8, "/api/EventV6/GetSEDelta"));
    adapter.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 11, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0", 9));
    const preCutoff = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0", 9)).at(-1)?.value as {
        quotes: Array<{ rawOdds: string }> };
    expect(preCutoff.quotes.map((quote) => quote.rawOdds)).toEqual(["0.6", "0.6"]);

    const replacement = new ImHttpCatalogAdapter();
    replacement.decode(envelope(delta, 10, "/api/EventV6/GetSEDelta", undefined,
      "im:8:1", "observer-im:0"));
    replacement.resetSource("chrome:IM:8");
    replacement.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 11, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:1", 9));
    const nextEpoch = replacement.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:1", 9)).at(-1)?.value as {
        quotes: Array<{ rawOdds: string }> };
    expect(nextEpoch.quotes.map((quote) => quote.rawOdds)).toEqual(["0.6", "0.6"]);
  });

  it("annotates atomic baselines and natural deltas with the current evidence generation", () => {
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:1"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:1")).at(-1)).toMatchObject({
      authoritativeBaseline: true, evidenceMode: "BASELINE", generation: "im:8:1",
      provenance: "AUTHENTICATED_HTTP"
    });
  });

  it("accepts a lower sequence only after the source epoch resets adapter state", () => {
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 900, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:0"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 901, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:0"))).toHaveLength(1);

    adapter.resetSource("chrome:IM:8");
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 1, undefined,
      "IM_MARKET_2", "im:8:1", "observer-im:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:1", "observer-im:1"))).toHaveLength(1);
  });

  it("rejects an unpartitioned GetSE snapshot instead of ambiguously merging it", () => {
    const adapter = new ImHttpCatalogAdapter();
    const unpartitioned = envelope({ StatusCode: 100, sel: [event] });
    expect(adapter.fingerprint(unpartitioned)).toBe(true);
    expect(adapter.decode(unpartitioned)).toEqual([]);
  });

  it("routes exact IM candidates independently from response validation and rejects lookalike routes", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.fingerprint({ ...envelope({ StatusCode: 100, sel: [event] }),
      request: { hostname: "evil.example", pathnameClass: "/api/EventV6/GetSE", resourceType: "XHR" } })).toBe(false);
    expect(adapter.fingerprint(envelope({ StatusCode: 500, sel: [event] }))).toBe(true);
    expect(adapter.decode(envelope({ StatusCode: 500, sel: [event] }))).toEqual([]);
    expect(adapter.fingerprint(envelope({ StatusCode: 100, sel: [event] }, 1, "/api/EventV6/GetESI"))).toBe(false);
  });
});
