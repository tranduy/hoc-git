import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";

const event = { eid: 112516390, htn: "Monterrey Rayados", atn: "Nashville SC", cn: "Leagues Cup",
  edt: "2026-08-16T20:00:00-04:00", isrbt: false, iscyb: false, mls: [{ mi: 10, bti: 1, gp: 1, ws: [
    { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67, ot: 1 },
    { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79, ot: 1 }
  ] }] };

function envelope(body: unknown, sequence = 1, path = "/api/EventV6/GetSE",
  providerPartition?: "IM_MARKET_1" | "IM_MARKET_2", generation = "im:8:generation-1",
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

  it("applies GetSEDelta only after a baseline and keeps provider IDs stable", () => {
    const adapter = new ImHttpCatalogAdapter();
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ mi: 10, bti: 1, gp: 1, ws: [
      { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.8, ot: 1 },
      { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.9, ot: 1 }
    ] }] }] };
    expect(adapter.decode(envelope(delta, 1, "/api/EventV6/GetSEDelta"))).toEqual([]);
    seedBothPartitions(adapter);
    const update = adapter.decode(envelope(delta, 3, "/api/EventV6/GetSEDelta"))[0]?.value as {
      quotes: readonly { providerSelectionId: string; rawOdds: string }[];
    };
    expect(update.quotes.map((quote) => [quote.providerSelectionId, quote.rawOdds]))
      .toEqual([["101", "0.8"], ["102", "-0.9"]]);
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
      "IM_MARKET_1", "im:8:generation-2"))).toEqual([]);
    const catalog = adapter.decode(envelope({ StatusCode: 100, sel: [marketTwo] }, 4, undefined,
      "IM_MARKET_2", "im:8:generation-2"))[0]!.value as { events: Array<{ providerEventId: string }>;
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
      undefined, "IM_MARKET_1", "im:8:old"));
    const oldCatalog = adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(202, 22, "Old Two")] }, 2,
      undefined, "IM_MARKET_2", "im:8:old"));
    expect(oldCatalog).toHaveLength(1);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(303, 33, "New One")] }, 3,
      undefined, "IM_MARKET_1", "im:8:new"))).toEqual([]);
    const current = adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(404, 44, "New Two")] }, 4,
      undefined, "IM_MARKET_2", "im:8:new"))[0]!.value as {
        events: Array<{ providerEventId: string }> };
    expect(current.events.map((item) => item.providerEventId).sort()).toEqual(["303", "404"]);
  });

  it("publishes one atomic generation when Market 2 arrives before Market 1", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 1, undefined,
      "IM_MARKET_2", "im:8:reverse"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:reverse"))[0]?.value).toMatchObject({
      events: [{ providerEventId: "112516390" }]
    });
  });

  it("does not roll back when both partitions of an older completed generation arrive late", () => {
    const makeEvent = (eventId: number) => ({ ...event, eid: eventId, htn: `Home ${eventId}`,
      atn: `Away ${eventId}` });
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(101)] }, 1, undefined,
      "IM_MARKET_1", "im:8:old"));
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(102)] }, 2, undefined,
      "IM_MARKET_2", "im:8:old"));
    adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(201)] }, 3, undefined,
      "IM_MARKET_1", "im:8:new"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(202)] }, 4, undefined,
      "IM_MARKET_2", "im:8:new"))).toHaveLength(1);

    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(101)] }, 5, undefined,
      "IM_MARKET_1", "im:8:old"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [makeEvent(102)] }, 6, undefined,
      "IM_MARKET_2", "im:8:old"))).toEqual([]);
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

  it("reapplies a newer delta after a two-part baseline commits", () => {
    const adapter = new ImHttpCatalogAdapter();
    seedBothPartitions(adapter);
    const replacement = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [replacement] }, 10, undefined,
      "IM_MARKET_1", "im:8:generation-2"))).toEqual([]);
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection, o: selection.wsi === 101 ? 0.84 : -0.91 })) }] }] };
    adapter.decode(envelope(delta, 11, "/api/EventV6/GetSEDelta"));
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:generation-2")).at(-1)?.value as {
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
      "IM_MARKET_1", "im:8:generation-2", "observer-im:0", 9))).toEqual([]);
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:generation-2", "observer-im:0", 9)).at(-1)?.value as {
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
      "IM_MARKET_1", "im:8:first", "observer-im:0", 9))).toEqual([]);
    const committed = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:first", "observer-im:0", 9)).at(-1)?.value as {
        quotes: Array<{ providerSelectionId: string; rawOdds: string }> };
    expect(committed.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "101", rawOdds: "0.84" })
    ]));
  });

  it("does not replay a pre-cutoff delta or a delta from a retired source epoch", () => {
    const delta = { StatusCode: 100, dc: [{ eid: 112516390, a: 3, v: [{ ...event.mls[0],
      ws: event.mls[0]!.ws.map((selection) => ({ ...selection, o: 0.84 })) }] }] };
    const signedBaseline = { ...structuredClone(event), mls: event.mls.map((market) => ({ ...market,
      ws: market.ws.map((selection) => ({ ...selection, o: 0.60 })) })) };
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope(delta, 8, "/api/EventV6/GetSEDelta"));
    adapter.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 11, undefined,
      "IM_MARKET_1", "im:8:first", "observer-im:0", 9));
    const preCutoff = adapter.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:first", "observer-im:0", 9)).at(-1)?.value as {
        quotes: Array<{ rawOdds: string }> };
    expect(preCutoff.quotes.map((quote) => quote.rawOdds)).toEqual(["0.6", "0.6"]);

    const replacement = new ImHttpCatalogAdapter();
    replacement.decode(envelope(delta, 10, "/api/EventV6/GetSEDelta", undefined,
      "im:8:first", "observer-im:0"));
    replacement.resetSource("chrome:IM:8");
    replacement.decode(envelope({ StatusCode: 100, sel: [signedBaseline] }, 11, undefined,
      "IM_MARKET_1", "im:8:first", "observer-im:1", 9));
    const nextEpoch = replacement.decode(envelope({ StatusCode: 100, sel: [] }, 12, undefined,
      "IM_MARKET_2", "im:8:first", "observer-im:1", 9)).at(-1)?.value as {
        quotes: Array<{ rawOdds: string }> };
    expect(nextEpoch.quotes.map((quote) => quote.rawOdds)).toEqual(["0.6", "0.6"]);
  });

  it("annotates atomic baselines and natural deltas with the current evidence generation", () => {
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 1, undefined,
      "IM_MARKET_1", "im:8:generation-1"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 2, undefined,
      "IM_MARKET_2", "im:8:generation-1")).at(-1)).toMatchObject({
      authoritativeBaseline: true, evidenceMode: "BASELINE", generation: "im:8:generation-1",
      provenance: "AUTHENTICATED_HTTP"
    });
  });

  it("accepts a lower sequence only after the source epoch resets adapter state", () => {
    const adapter = new ImHttpCatalogAdapter();
    adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 900, undefined,
      "IM_MARKET_1", "im:8:before", "observer-im:0"));
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 901, undefined,
      "IM_MARKET_2", "im:8:before", "observer-im:0"))).toHaveLength(1);

    adapter.resetSource("chrome:IM:8");
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [] }, 1, undefined,
      "IM_MARKET_2", "im:8:after", "observer-im:1"))).toEqual([]);
    expect(adapter.decode(envelope({ StatusCode: 100, sel: [event] }, 2, undefined,
      "IM_MARKET_1", "im:8:after", "observer-im:1"))).toHaveLength(1);
  });

  it("rejects an unpartitioned GetSE snapshot instead of ambiguously merging it", () => {
    const adapter = new ImHttpCatalogAdapter();
    const unpartitioned = envelope({ StatusCode: 100, sel: [event] });
    expect(adapter.fingerprint(unpartitioned)).toBe(false);
    expect(adapter.decode(unpartitioned)).toEqual([]);
  });

  it("rejects lookalike hosts, paths, and failed provider envelopes", () => {
    const adapter = new ImHttpCatalogAdapter();
    expect(adapter.fingerprint({ ...envelope({ StatusCode: 100, sel: [event] }),
      request: { hostname: "evil.example", pathnameClass: "/api/EventV6/GetSE", resourceType: "XHR" } })).toBe(false);
    expect(adapter.fingerprint(envelope({ StatusCode: 500, sel: [event] }))).toBe(false);
    expect(adapter.fingerprint(envelope({ StatusCode: 100, sel: [event] }, 1, "/api/EventV6/GetESI"))).toBe(false);
  });
});
