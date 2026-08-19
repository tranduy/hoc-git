import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { ImHttpCatalogAdapter } from "./im-http-adapter.js";

const event = { eid: 112516390, htn: "Monterrey Rayados", atn: "Nashville SC", cn: "Leagues Cup",
  edt: "2026-08-16T20:00:00-04:00", isrbt: false, iscyb: false, mls: [{ mi: 10, bti: 1, gp: 1, ws: [
    { wsi: 101, si: 1, hdp: -0.5, dih: "+0.5", o: 0.67, ot: 1 },
    { wsi: 102, si: 2, hdp: -0.5, dih: "-0.5", o: -0.79, ot: 1 }
  ] }] };

function envelope(body: unknown, sequence = 1, path = "/api/EventV6/GetSE",
  providerPartition?: "IM_MARKET_1" | "IM_MARKET_2"): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "IM", sourceId: "chrome:IM:8", tabId: 8, sequence,
    observedAtMs: 1_000 + sequence, receivedMonotonicMs: 50 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "imsports.directsb.net", pathnameClass: path, resourceType: "XHR",
      ...(providerPartition === undefined ? {} : { providerPartition }) },
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

  it("replaces only the refreshed IM partition and preserves clocks in the untouched partition", () => {
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
    const catalog = adapter.decode(envelope({ StatusCode: 100, sel: [replacement] }, 3, undefined,
      "IM_MARKET_1"))[0]!.value as { events: Array<{ providerEventId: string }>;
        quotes: Array<{ providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["202", "303"]);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "202"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 52, sequence: 2 })]));
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "303"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 53, sequence: 3 })]));
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
