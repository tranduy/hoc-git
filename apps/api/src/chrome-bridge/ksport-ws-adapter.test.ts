import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { KsportWsCatalogAdapter } from "./ksport-ws-adapter.js";

function envelope(payload: unknown, destination = "/topic/sports/1_1/live/ma/event/vi",
  overrides: Partial<Pick<ChromeBridgeEnvelope, "sequence" | "observedAtMs" | "receivedMonotonicMs">> = {}): ChromeBridgeEnvelope {
  const message = `MESSAGE\ndestination:${destination}\ncontent-type:application/json\n\n${JSON.stringify({
    headers: {}, body: JSON.stringify(payload)
  })}\0`;
  return { version: 1, kind: "NETWORK", lobby: "KSPORT", sourceId: "chrome:KSPORT:8", tabId: 8,
    sequence: overrides.sequence ?? 5, observedAtMs: overrides.observedAtMs ?? Date.UTC(2026, 7, 15, 13),
    receivedMonotonicMs: overrides.receivedMonotonicMs ?? 60, transport: "WS_FRAME",
    request: { hostname: "d42.sb21.net", pathnameClass: "/sport/433/session/websocket", resourceType: "WebSocket",
      streamId: "ksport-stream-1" },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}

function receiptEnvelope(payload: unknown, partition: "live" | "today", sequence: number,
  receiptSequence = sequence, streamId = "ksport-stream-1",
  sourceEpoch?: string, recoveryGeneration = 1): ChromeBridgeEnvelope {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const message = `MESSAGE\ndestination:/topic/sports/1_1/${partition}/ma/event/vi\n` +
    `content-type:application/json\nsubscription:${subscription}\nmessage-id:socket-${receiptSequence}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify(payload) })}\0`;
  return { ...envelope(payload), ...(sourceEpoch === undefined ? {} : { sourceEpoch }), sequence,
    request: { ...envelope(payload).request, streamId, recoveryGeneration } as
      ChromeBridgeEnvelope["request"] & { readonly recoveryGeneration: number },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}

function withRecoveryGeneration(envelope: ChromeBridgeEnvelope,
  recoveryGeneration: number): ChromeBridgeEnvelope {
  return { ...envelope, request: { ...envelope.request, recoveryGeneration } as
    ChromeBridgeEnvelope["request"] & { readonly recoveryGeneration: number } };
}

function socketState(streamId: string, state: "OPEN" | "CLOSED", sequence: number,
  sourceEpoch?: string): ChromeBridgeEnvelope {
  return { ...receiptEnvelope([], "live", sequence, sequence, streamId, sourceEpoch), transport: "WS_STATE",
    payload: { encoding: "UTF8", body: JSON.stringify({ state }) } };
}

function httpEnvelope(payload: unknown, partition: "live" | "today", generation: number,
  sequence: number, requestStartSequence = 0): ChromeBridgeEnvelope {
  return { ...envelope([]), sourceEpoch: "worker-a:0", transport: "HTTP_RESPONSE", sequence,
    request: { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch",
      streamId: `ksport-http:8:${generation}`,
      providerPartition: partition === "live" ? "KSPORT_LIVE" : "KSPORT_TODAY",
      providerContentIntent: "FOOTBALL_FULL_CATALOG", requestStartSequence },
    payload: { encoding: "UTF8", body: JSON.stringify(payload) } };
}

describe("KsportWsCatalogAdapter", () => {
  it("reuses untouched event normalization while replacing changed prices and receipt clocks", () => {
    const event = (id: number, odds = "0.92") => ({ "0": "2026-08-20T16:00:00Z",
      "2": `Home ${id}`, "3": `Away ${id}`, "7": {
        "3": [`2.5 ${odds}*${id}0030002005h -0.98*${id}0030002005a ${id}181025`]
      }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(httpEnvelope([{ "1": "Live", "2": [event(5643423), event(5643424)] }], "live", 1, 10));
    const before = adapter.decode(httpEnvelope([], "today", 1, 11))[0]!.value as ObservedProviderCatalog;
    const after = adapter.decode({ ...receiptEnvelope(event(5643423, "0.75"), "live", 12, 101,
      "ksport-stream-1", "worker-a:0"), receivedMonotonicMs: 120 })[0]!.value as ObservedProviderCatalog;
    const untouched = before.quotes.find(quote => quote.providerEventId === "5643424")!;
    expect(untouched).toBeDefined();
    expect(after.quotes.find(quote => quote.providerSelectionId === untouched.providerSelectionId)).toBe(untouched);
    const changed = after.quotes.filter(quote => quote.providerEventId === "5643423");
    expect(changed).toContainEqual(expect.objectContaining({ rawOdds: "0.75", receivedMonotonicMs: 120, sequence: 12 }));
    expect(before.quotes.filter(quote => quote.providerEventId === "5643423"))
      .toContainEqual(expect.objectContaining({ rawOdds: "0.92", receivedMonotonicMs: 60 }));
  });

  it("rejects the auxiliary Volta root socket even when it shares an sb21 host", () => {
    const adapter = new KsportWsCatalogAdapter();
    const input = envelope([]);
    expect(adapter.fingerprint({ ...input, request: {
      ...input.request, hostname: "novoga.sb21.net", pathnameClass: "/"
    } })).toBe(false);
  });

  it("rejects an exact sport path from outside the verified sb21 socket hosts", () => {
    const adapter = new KsportWsCatalogAdapter();
    const input = envelope([]);

    expect(adapter.fingerprint({ ...input, request: {
      ...input.request, hostname: "sb21.net.evil.test"
    } })).toBe(false);
  });

  it("keeps an incomplete canonical HTTP generation separate from the committed baseline", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(httpEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 1, 10))).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 11))).toHaveLength(1);

    expect(adapter.decode(httpEnvelope([{ "1": "Live", "2": [event(2)] }], "live", 2, 12))).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 13))).toEqual([]);
    const replacement = adapter.decode(httpEnvelope([], "today", 2, 14))[0]!;

    expect(replacement.generation).toBe("worker-a:0:ksport-http:8:2");
    expect((replacement.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "2" })]);
  });

  it("accepts the provider's date-group wrapper around complete HTTP league lists", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Wrapped Home", "3": "Wrapped Away",
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] },
      "8": 5643423 };
    const adapter = new KsportWsCatalogAdapter();

    expect(adapter.decode(httpEnvelope([[{ "1": "Live", "2": [event] }]],
      "live", 1, 10))).toEqual([]);
    const committed = adapter.decode(httpEnvelope([[{ "1": "Today", "2": [] }]],
      "today", 1, 11));

    expect(committed).toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      provenance: "AUTHENTICATED_HTTP",
      generation: "worker-a:0:ksport-http:8:1"
    })]);
    expect((committed[0]!.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "5643423" })]);
    expect((committed[0]!.value as { nativeMarketObservations: Array<{ disposition: string }> })
      .nativeMarketObservations).toEqual([
        expect.objectContaining({ providerMarketId: "5643423181025", disposition: "NORMALIZED" })
      ]);
  });

  it("accounts disjoint duplicate event containers against all final published markets", () => {
    const adapter = new KsportWsCatalogAdapter();
    const identity = { "0": "2026-09-08T12:00:00Z", "2": "Home", "3": "Away", "8": 778899 };
    const cornerFirst = { ...identity, "7": {
      "21": ["9.5 0.91*7788992101h -0.97*7788992102a 778899210001"]
    } };
    const goalSecond = { ...identity, "7": {
      "3": ["2.5 0.91*7788990301h -0.97*7788990302a 778899030001"],
      "4": ["1.5 0.91*7788990401h -0.97*7788990402a 778899040001"],
      "777": ["opaque native row"], "17": ["unsupported corner three-way row"]
    } };

    expect(adapter.decode(httpEnvelope([], "live", 1, 10))).toEqual([]);
    const committed = adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [cornerFirst, goalSecond] }],
      "today", 1, 11))[0]!.value as ObservedProviderCatalog;

    expect(committed.markets).toEqual([expect.objectContaining({
      providerEventId: "778899", providerMarketId: "778899210001", marketType: "CORNER_FT_TOTAL"
    }), expect.objectContaining({
      providerEventId: "778899", providerMarketId: "778899030001", marketType: "FT_TOTAL"
    }), expect.objectContaining({
      providerEventId: "778899", providerMarketId: "778899040001", marketType: "FH_TOTAL"
    })]);
    expect(committed.nativeMarketObservations).toHaveLength(5);
    expect(committed.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "778899210001", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "778899030001", disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" }),
      expect.objectContaining({ providerMarketId: "778899040001", disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED" }),
      expect.objectContaining({ nativeType: "777", disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" }),
      expect.objectContaining({ nativeType: "17", disposition: "EXCLUDED", reason: "INVALID_CATEGORICAL_SHAPE" })
    ]));

    const delta = adapter.decode(receiptEnvelope({ ...identity, "7": { "3": goalSecond["7"]["3"] } },
      "today", 12, 100, "ksport-stream-1", "worker-a:0"))[0]!.value as ObservedProviderCatalog;
    expect(delta.markets.map((market) => market.providerMarketId).sort()).toEqual([
      "778899030001", "778899040001", "778899210001"
    ]);
    expect(delta.nativeMarketObservations).toHaveLength(5);
    expect(delta.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "778899030001", disposition: "NORMALIZED", reason: "CANONICAL_MARKET_MAPPED"
    }));
  });

  it("rejects a provider error object inside an HTTP partition pair", () => {
    const adapter = new KsportWsCatalogAdapter();
    const error = { status: "error", errorCode: 500, message: "request failed", values: null };

    expect(adapter.decode(httpEnvelope(error, "live", 1, 10))).toEqual([]);
    expect(adapter.decode(httpEnvelope([[{ "1": "Today", "2": [] }]],
      "today", 1, 11))).toEqual([]);
  });

  it("accepts an explicit empty market container in a complete HTTP partition", () => {
    const adapter = new KsportWsCatalogAdapter();
    const undecodable = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away",
      "7": {}, "8": 5643423 };

    expect(adapter.decode(httpEnvelope([{ "1": "Live", "2": [undecodable] }], "live", 1, 10)))
      .toEqual([]);
    const committed = adapter.decode(httpEnvelope([], "today", 1, 11));
    expect(committed).toHaveLength(1);
    expect(committed[0]!.value).toMatchObject({ markets: [], quotes: [] });
  });

  it("publishes an unmapped native market instead of silently dropping its prematch event", () => {
    const adapter = new KsportWsCatalogAdapter();
    const unknown = { "0": "2026-09-08T12:00:00Z", "2": "Hidden Home", "3": "Hidden Away",
      "7": { "777": ["0.5 0.91*77889901h -0.97*77889902a 778899777001"] }, "8": 778899 };

    expect(adapter.decode(httpEnvelope([], "live", 1, 10))).toEqual([]);
    const committed = adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [unknown] }],
      "today", 1, 11));

    expect(committed).toHaveLength(1);
    expect((committed[0]!.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "778899" })]);
    expect((committed[0]!.value as { nativeMarketObservations: Array<Record<string, unknown>> })
      .nativeMarketObservations).toEqual([expect.objectContaining({
        providerEventId: "778899", nativeType: "777", disposition: "UNMAPPED",
        reason: "NATIVE_TYPE_UNMAPPED"
      })]);
  });

  it("rejects a leading-zero HTTP tab ID instead of pairing a different generation string", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(httpEnvelope([], "live", 1, 10))).toEqual([]);
    const noncanonical = httpEnvelope([], "today", 1, 11);

    expect(adapter.decode({ ...noncanonical, request: { ...noncanonical.request,
      streamId: "ksport-http:08:1" } })).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 12))).toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      generation: "worker-a:0:ksport-http:8:1"
    })]);
  });

  it("requires exact canonical KSPORT HTTP pair metadata instead of encoding the partition in streamId", () => {
    const adapter = new KsportWsCatalogAdapter();
    const valid = httpEnvelope([], "live", 1, 10, 9);
    expect(adapter.fingerprint(valid)).toBe(true);

    const invalidRequests: readonly ChromeBridgeEnvelope["request"][] = [
      { ...valid.request, streamId: "ksport-http:8:1:live" },
      { ...valid.request, providerPartition: "IM_MARKET_1" },
      { ...valid.request, providerContentIntent: "ALL_SPORTS" } as ChromeBridgeEnvelope["request"],
      { ...valid.request, requestStartSequence: -1 } as ChromeBridgeEnvelope["request"]
    ];
    const { providerContentIntent: _intent, ...missingIntent } = valid.request as
      ChromeBridgeEnvelope["request"] & { readonly providerContentIntent?: unknown };

    for (const request of [...invalidRequests, missingIntent as ChromeBridgeEnvelope["request"]]) {
      expect(adapter.fingerprint({ ...valid, request })).toBe(false);
    }
  });

  it("does not let current-socket heartbeats starve a canonical HTTP recovery pair", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(socketState("ksport-stream-1", "OPEN", 1, "worker-a:0"));

    expect(adapter.decode(httpEnvelope([], "live", 1, 20, 10))).toEqual([]);
    const heartbeat = { ...receiptEnvelope([], "today", 21, 104,
      "ksport-stream-1", "worker-a:0"),
    payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };
    expect(adapter.decode(heartbeat)).toEqual([]);

    expect(adapter.decode(httpEnvelope([], "today", 1, 22, 10))).toEqual([
      expect.objectContaining({
        authoritativeBaseline: true,
        provenance: "AUTHENTICATED_HTTP",
        generation: "worker-a:0:ksport-http:8:1"
      })
    ]);
  });

  it("does not let a duplicate pending WS delta fence a canonical HTTP recovery pair", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    const delta = receiptEnvelope(event, "live", 2, 100,
      "ksport-stream-1", "worker-a:0");
    expect(adapter.decode(delta)).toEqual([]);

    expect(adapter.decode(httpEnvelope([], "live", 1, 20, 2))).toEqual([]);
    expect(adapter.decode({ ...delta, sequence: 21 })).toEqual([]);

    expect(adapter.decode(httpEnvelope([], "today", 1, 22, 2))).toEqual([
      expect.objectContaining({
        authoritativeBaseline: true,
        provenance: "AUTHENTICATED_HTTP",
        generation: "worker-a:0:ksport-http:8:1"
      })
    ]);
  });

  it("folds WS deltas into the committed HTTP baseline until a fresh full WS pair completes", () => {
    const event = (id: number, odds = "0.92") => ({ "0": "2026-08-20T16:00:00Z",
      "2": `Home ${id}`, "3": `Away ${id}`, "7": {
        "3": [`2.5 ${odds}*${id}0030002005h -0.98*${id}0030002005a ${id}181025`]
      }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }],
      "live", 1, 100, "ksport-stream-1", "worker-a:0"));
    adapter.decode(receiptEnvelope([], "today", 2, 104,
      "ksport-stream-1", "worker-a:0"));

    expect(adapter.decode(httpEnvelope([{ "1": "Live", "2": [event(5643424)] }],
      "live", 1, 3, 2))).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 4, 2))).toEqual([expect.objectContaining({
      authoritativeBaseline: true, provenance: "AUTHENTICATED_HTTP"
    })]);

    // A delta at or before the baseline's request fence may predate the
    // snapshot and stays refused.
    expect(adapter.decode(receiptEnvelope(event(5643423, "0.60"), "live", 2, 99,
      "ksport-stream-1", "worker-a:0"))).toEqual([]);
    const deltaUpdates = adapter.decode(receiptEnvelope(event(5643423, "0.75"), "live", 5, 101,
      "ksport-stream-1", "worker-a:0"));
    expect(deltaUpdates).toEqual([expect.objectContaining({
      evidenceMode: "DELTA", provenance: "WS", generation: "worker-a:0:ksport-http:8:1"
    })]);
    const deltaCatalog = deltaUpdates[0]!.value as { events: Array<{ providerEventId: string }> };
    expect(deltaCatalog.events.map((item) => item.providerEventId).sort())
      .toEqual(["5643423", "5643424"]);
    expect(adapter.decode(socketState("ksport-stream-2", "OPEN", 6, "worker-a:0"))).toEqual([]);
    expect(adapter.decode(socketState("ksport-stream-2", "CLOSED", 7, "worker-a:0"))).toEqual([]);
    expect(adapter.decode(socketState("ksport-stream-3", "OPEN", 8, "worker-a:0"))).toEqual([]);
    // A league-shaped fragment on a fresh stream is an upsert, not a socket
    // authority handover: promoting it would shrink the partition to the few
    // events it happens to carry.
    const foldUpdates = adapter.decode(withRecoveryGeneration(receiptEnvelope(
      [{ "1": "Live", "2": [event(5643425)] }], "live", 9, 200,
      "ksport-stream-3", "worker-a:0"), 2));
    expect(foldUpdates).toEqual([expect.objectContaining({
      evidenceMode: "DELTA", provenance: "WS", generation: "worker-a:0:ksport-http:8:1"
    })]);
    const folded = foldUpdates[0]!.value as { events: Array<{ providerEventId: string }> };
    expect(folded.events.map((item) => item.providerEventId).sort())
      .toEqual(["5643423", "5643424", "5643425"]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 10, 204,
      "ksport-stream-3", "worker-a:0"), 2))).toEqual([]);
    // The socket never owned the committed catalog, so its close cannot
    // invalidate it.
    expect(adapter.decode(socketState("ksport-stream-3", "CLOSED", 11, "worker-a:0"))).toEqual([]);
  });

  it("never grants a WS receipt catalog authority, even a complete-looking pair", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(socketState("ksport-stream-1", "OPEN", 1));

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 2, 100)))
      .toEqual([]);
    expect(adapter.decode(receiptEnvelope([{ "1": "Today", "2": [] }], "today", 3, 101)))
      .toEqual([]);
  });

  it("ignores a delayed OPEN from a retired KSPORT stream", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(socketState("ksport-stream-1", "OPEN", 1));
    adapter.decode(socketState("ksport-stream-2", "OPEN", 2));

    expect(adapter.decode(socketState("ksport-stream-1", "OPEN", 3))).toEqual([]);
  });

  it("folds the provider's 1_11 hot-match channel into the today partition", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Hot Home", "3": "Hot Away", "8": 5643430,
      "7": { "3": ["2.5 0.92*56434300030002005h -0.98*56434300030002005a 5643430181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(httpEnvelope([], "live", 1, 10, 2))).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 11, 2))).toHaveLength(1);

    const message = "MESSAGE\ndestination:/topic/sports/1_11/today/ma/event/vi\n" +
      "content-type:application/json\nsubscription:subSportHotMatch\nmessage-id:socket-300\n\n" +
      `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify(event) })}\0`;
    const base = receiptEnvelope([], "today", 12, 300, "ksport-stream-1", "worker-a:0");
    const updates = adapter.decode({ ...base,
      payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } });

    expect(updates).toEqual([expect.objectContaining({
      evidenceMode: "DELTA", generation: "worker-a:0:ksport-http:8:1"
    })]);
    expect((updates[0]!.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "5643430" })]);
  });

  it("does not fold a delta from a different source epoch into the committed baseline", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(httpEnvelope([], "live", 1, 10, 2))).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 11, 2))).toHaveLength(1);

    expect(adapter.decode(receiptEnvelope(event, "live", 12, 100,
      "ksport-stream-1", "worker-b:0"))).toEqual([]);
  });

  it("ignores jackpot and pong frames", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.fingerprint(envelope({ pong: 1 }, "/topic/jackpot/ws"))).toBe(false);
  });

  it("does not use the direct-price HTTP response as catalog authority", () => {
    const adapter = new KsportWsCatalogAdapter();
    const input: ChromeBridgeEnvelope = {
      ...envelope([]), transport: "HTTP_RESPONSE",
      request: { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch" },
      payload: { encoding: "UTF8", body: JSON.stringify([{ "8": 5643423 }]) }
    };
    expect(adapter.fingerprint(input)).toBe(false);
    expect(adapter.decode(input)).toEqual([]);
  });

  it("publishes current page getEvent only after live and today form one HTTP baseline", () => {
    const event = { "0": "2026-08-21T16:00:00Z", "2": "Kashiwa", "3": "V Varen Nagasaki", "8": 5643423,
      "7": { "5": ["0.5 0.92*56434230050000005h -0.98*56434230050000005a h 735502668161000 0 0 1 1 0"] } };
    const adapter = new KsportWsCatalogAdapter();
    const input = httpEnvelope([], "today", 1, 20);
    expect(adapter.fingerprint(input)).toBe(true);
    expect(adapter.decode(input)).toEqual([]);
    const update = adapter.decode(httpEnvelope([{ "1": "J League", "2": [event] }], "live", 1, 21))[0]!;
    const catalog = update.value as { events: unknown[]; quotes: unknown[] };
    expect(catalog.events).toHaveLength(1);
    expect(catalog.quotes).toHaveLength(2);
    expect(update).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      provenance: "AUTHENTICATED_HTTP" });
  });

});

describe("KSPORT hidden-market receipt provenance", () => {
  const eventId = 778899;
  const event = (groups: Record<string, string[]>) => ({
    "0": "2026-09-08T12:00:00Z", "2": "Hidden Home", "3": "Hidden Away", "8": eventId, "7": groups
  });
  const goal = (odds = "0.92") => `2.5 ${odds}*778899301h -0.98*778899302a 7788993001`;
  const corner = (odds = "0.91", line = "9.5") => `${line} ${odds}*778899211h -0.97*778899212a 7788992101`;
  const initialGroups = { "3": [goal()], "21": [corner()] };
  const baseline = (adapter: KsportWsCatalogAdapter) => {
    adapter.decode(httpEnvelope([], "live", 1, 10));
    adapter.decode({ ...httpEnvelope([{ "1": "Prematch", "2": [event(initialGroups)] }], "today", 1, 11),
      receivedMonotonicMs: 100 });
  };
  const delta = (groups: Record<string, string[]>, sequence: number, clock: number) => ({
    ...receiptEnvelope(event(groups), "today", sequence, sequence, "ksport-stream-1", "worker-a:0"),
    receivedMonotonicMs: clock
  });
  const quotes = (update: ReturnType<KsportWsCatalogAdapter["decode"]>[number]) =>
    (update.value as { quotes: Array<{ providerMarketId: string; rawOdds: string;
      receivedMonotonicMs: number; sequence: number; line: string }> }).quotes;
  const detail = (groups: Record<string, string[]>, ordinal: number, sequence: number, requestStartSequence: number) => {
    const base = httpEnvelope([], "today", 1, sequence);
    return { ...base, receivedMonotonicMs: sequence * 100,
      request: { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch",
        method: "GET", observerRequestId: `detail-${sequence}`, streamId: `sbobet-detail:8:${ordinal}`,
        reconcileCutoffSequence: requestStartSequence },
      payload: { encoding: "UTF8" as const, body: JSON.stringify({ kind: "SBOBET_EVENT_DETAIL",
        generation: "worker-a:0", eventId: String(eventId), requestStartSequence,
        observedAtMs: base.observedAtMs, marketContainerComplete: true, event: event(groups) }) } };
  };

  it("hydrates separate detail membership and keeps it across shallow roster refreshes", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(httpEnvelope([], "live", 1, 10));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal()] })] }], "today", 1, 11));
    const hydrated = adapter.decode(detail(initialGroups, 1, 12, 11));
    expect(hydrated).toHaveLength(1);
    expect(quotes(hydrated[0]!)).toHaveLength(4);
    adapter.decode(httpEnvelope([], "live", 2, 13, 12));
    const shallow = adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal("0.70")] })] }],
      "today", 2, 14, 12));
    expect(quotes(shallow[0]!).find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ receivedMonotonicMs: 1200, sequence: 12 });
    const hidden = adapter.decode(delta({ "21": [corner("0.63")] }, 15, 1500));
    expect(quotes(hidden[0]!).find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ rawOdds: "0.63", receivedMonotonicMs: 1500 });
    const removed = adapter.decode(detail({ "3": [goal()] }, 2, 16, 15));
    expect(quotes(removed[0]!).map((quote) => quote.providerMarketId))
      .toEqual(["7788993001", "7788993001"]);
  });

  it("does not overwrite newer main prices with an older in-flight detail response", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(delta({ "3": [goal("0.60")] }, 12, 1200));
    const hydrated = adapter.decode(detail(initialGroups, 1, 13, 11));
    expect(hydrated).toHaveLength(1);
    expect(quotes(hydrated[0]!).find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ rawOdds: "0.60", sequence: 12, receivedMonotonicMs: 1200 });
  });

  it.each(["HTTP", "WS"] as const)("rejects detail from a removed membership after same-ID %s readmission", (readmission) => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    expect(adapter.decode(detail(initialGroups, 5, 12, 11))).toHaveLength(1);
    adapter.decode(httpEnvelope([], "live", 2, 13, 12));
    adapter.decode(httpEnvelope([], "today", 2, 14, 12));
    expect(adapter.decode(detail(initialGroups, 6, 15, 12))).toEqual([]);
    if (readmission === "HTTP") {
      adapter.decode(httpEnvelope([], "live", 3, 16, 15));
      adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal("0.70")] })] }],
        "today", 3, 17, 15));
    } else {
      expect(adapter.decode(delta({ "3": [goal("0.70")] }, 17, 1700))).toHaveLength(1);
    }
    expect(adapter.decode(detail(initialGroups, 6, 18, 12))).toEqual([]);
    // Ordinals belong to the current membership; an old membership's retained
    // ordinal must not block a request proven to start after readmission.
    const fresh = adapter.decode(detail(initialGroups, 1, 19, 17));
    expect(fresh).toHaveLength(1);
    expect(quotes(fresh[0]!).map((quote) => quote.providerMarketId)).toContain("7788992101");
  });

  it("keeps the membership admission fence across an ordinary HTTP refresh and newer socket prices", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(httpEnvelope([], "live", 1, 10));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal()] })] }], "today", 1, 11));
    adapter.decode(httpEnvelope([], "live", 2, 12, 11));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal("0.70")] })] }], "today", 2, 13, 11));
    adapter.decode(receiptEnvelope(event({ "3": [goal("0.60")] }), "today", 14, 100,
      "ksport-stream-1", "worker-a:0"));
    const pending = adapter.decode(detail(initialGroups, 1, 15, 11));
    expect(pending).toHaveLength(1);
    expect(quotes(pending[0]!).find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ rawOdds: "0.60", sequence: 14 });
    expect(quotes(pending[0]!).map((quote) => quote.providerMarketId)).toContain("7788992101");
    expect(adapter.decode(receiptEnvelope(event({ "3": [goal("0")] }), "today", 16, 99,
      "ksport-stream-1", "worker-a:0"))).toEqual([]);
  });

  it("retires detail admission on an accepted live transition until a fresh prematch membership", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(detail(initialGroups, 5, 12, 11));
    adapter.decode(receiptEnvelope(event({ "3": [goal()] }), "live", 13, 100,
      "ksport-stream-1", "worker-a:0"));
    adapter.decode(httpEnvelope([], "live", 2, 14, 13));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal()] })] }], "today", 2, 15, 13));
    expect(adapter.decode(detail(initialGroups, 6, 16, 12))).toEqual([]);
    expect(adapter.decode(detail(initialGroups, 1, 17, 15))).toHaveLength(1);
  });

  it("rejects stale generation, wrong identity, unverified or out-of-order detail", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const valid = detail(initialGroups, 2, 12, 11);
    for (const invalid of [{ generation: "worker-old:0" }, { eventId: "999" },
      { marketContainerComplete: false }, { event: { "8": eventId, "7": { error: "failed" } } }]) {
      expect(adapter.decode({ ...valid, payload: { ...valid.payload,
        body: JSON.stringify({ ...JSON.parse(valid.payload.body), ...invalid }) } })).toEqual([]);
    }
    expect(adapter.decode(valid)).toHaveLength(1);
    expect(adapter.decode(detail({}, 1, 13, 12))).toEqual([]);
    expect(adapter.decode(detail({}, 2, 14, 13))).toEqual([]);
  });

  it("retires detail when a roster event leaves prematch and rejects its delayed detail", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(detail(initialGroups, 1, 12, 11));
    adapter.decode(httpEnvelope([{ "1": "Live", "2": [event({ "3": [goal()] })] }], "live", 2, 13, 12));
    const live = adapter.decode(httpEnvelope([], "today", 2, 14, 12));
    expect(quotes(live[0]!).map((quote) => quote.providerMarketId))
      .toEqual(["7788993001", "7788993001"]);
    expect(adapter.decode(detail(initialGroups, 2, 15, 12))).toEqual([]);
  });

  it("withdraws stale main membership on a verified empty full detail and fences pending HTTP", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(httpEnvelope([], "live", 2, 12, 11));
    const empty = adapter.decode(detail({}, 1, 13, 11));
    expect(empty).toHaveLength(1);
    expect(quotes(empty[0]!)).toEqual([]);
    const stale = adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event(initialGroups)] }], "today", 2, 14, 11));
    expect(quotes(stale[0]!)).toEqual([]);
    const reopened = adapter.decode(delta({ "21": [corner("0.60")] }, 15, 1500));
    expect(quotes(reopened[0]!)).toHaveLength(2);
    expect(quotes(reopened[0]!)[0]).toMatchObject({ rawOdds: "0.60" });
  });

  it("applies both same-event receipts batched in one SockJS envelope", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const first = delta({ "3": [goal("0.60")] }, 12, 1200);
    const second = delta({ "21": [corner("0.65")] }, 13, 1200);
    const messages = [...JSON.parse(first.payload.body.slice(1)), ...JSON.parse(second.payload.body.slice(1))];
    const updated = adapter.decode({ ...first, payload: { encoding: "UTF8", body: `a${JSON.stringify(messages)}` } });
    expect(quotes(updated[0]!).filter((quote) => ["0.60", "0.65"].includes(quote.rawOdds))).toHaveLength(2);
    expect(adapter.decode(first)).toEqual([]);
  });

  it.each([99, 100])("rejects stale or duplicate provider receipt %s despite increasing envelope sequence", (order) => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    expect(adapter.decode(receiptEnvelope(event({ "3": [goal("0.60")] }), "today", 12, 100,
      "ksport-stream-1", "worker-a:0"))).toHaveLength(1);
    expect(adapter.decode(receiptEnvelope(event({ "3": [goal("0")] }), "today", 13, order,
      "ksport-stream-1", "worker-a:0"))).toEqual([]);
    const next = adapter.decode(receiptEnvelope(event({ "21": [corner("0.65")] }), "today", 14, 101,
      "ksport-stream-1", "worker-a:0"));
    expect(quotes(next[0]!).find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ rawOdds: "0.60", sequence: 12 });
  });

  it("rejects receipts without a usable provider order before changing prices", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const valid = delta({ "3": [goal("0")] }, 12, 1200);
    for (const messageId of ["", "message-id:opaque\\n", "message-id:socket-9007199254740992\\n"]) {
      expect(adapter.decode({ ...valid, sequence: 12 + messageId.length, payload: { encoding: "UTF8",
        body: valid.payload.body.replace(/message-id:socket-12\\n/u, messageId) } })).toEqual([]);
    }
  });

  it("isolates provider receipt ordering by partition and resets it only for a newer stream", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    expect(adapter.decode(receiptEnvelope(event({ "3": [goal("0.60")] }), "today", 12, 100,
      "ksport-stream-1", "worker-a:0"))).toHaveLength(1);
    const liveEvent = (price: string) => ({ ...event({ "3": [goal(price)] }), "8": 778900 });
    expect(adapter.decode(receiptEnvelope(liveEvent("0.65"), "live", 13, 1,
      "ksport-stream-1", "worker-a:0"))).toHaveLength(1);
    expect(adapter.decode(socketState("ksport-stream-2", "OPEN", 14, "worker-a:0"))).toEqual([]);
    const updated = adapter.decode(receiptEnvelope(liveEvent("0.70"), "live", 15, 1,
      "ksport-stream-2", "worker-a:0"));
    expect(quotes(updated[0]!).some((quote) => quote.rawOdds === "0.70")).toBe(true);
    expect(adapter.decode(receiptEnvelope(liveEvent("0"), "live", 16, 101,
      "ksport-stream-1", "worker-a:0"))).toEqual([]);
  });

  it("retains lower-order distinct markets while filtering stale rows in a mixed receipt", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const first = receiptEnvelope(event({ "3": [goal("0.60")] }), "today", 12, 100,
      "ksport-stream-1", "worker-a:0");
    const second = receiptEnvelope(event({ "21": [corner("0.65")] }), "today", 12, 90,
      "ksport-stream-1", "worker-a:0");
    const messages = [...JSON.parse(first.payload.body.slice(1)), ...JSON.parse(second.payload.body.slice(1))];
    const batch = adapter.decode({ ...first, payload: { encoding: "UTF8", body: `a${JSON.stringify(messages)}` } });
    expect(quotes(batch[0]!).filter((quote) => ["0.60", "0.65"].includes(quote.rawOdds))).toHaveLength(2);
    const mixed = adapter.decode(receiptEnvelope({ ...event({ "3": [goal("0")], "21": [corner("0.66")] }),
      "2": "Old Home" },
      "today", 13, 95, "ksport-stream-1", "worker-a:0"));
    expect(quotes(mixed[0]!).find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ rawOdds: "0.60", sequence: 12 });
    expect(quotes(mixed[0]!).find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ rawOdds: "0.66", sequence: 13 });
    expect(mixed[0]!.value).toMatchObject({ events: [expect.objectContaining({ participantA: "Hidden Home" })] });
  });

  it("rejects old event metadata that would transition a newer prematch event to live", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(receiptEnvelope(event({ "3": [goal("0.60")] }), "today", 12, 100,
      "ksport-stream-1", "worker-a:0"));
    adapter.decode(detail(initialGroups, 1, 13, 12));
    expect(adapter.decode(receiptEnvelope({ "8": eventId, "7": {} }, "live", 14, 99,
      "ksport-stream-1", "worker-a:0"))).toEqual([]);
    const retained = adapter.decode(receiptEnvelope(event({ "3": [goal("0.65")] }), "today", 15, 101,
      "ksport-stream-1", "worker-a:0"));
    expect(retained[0]!.value).toMatchObject({ events: [expect.objectContaining({ isLive: false })] });
    expect(quotes(retained[0]!).map((quote) => quote.providerMarketId)).toContain("7788992101");
  });

  it("rejects prematch detail while the complete live partition still contains its event", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(httpEnvelope([{ "1": "Live", "2": [event(initialGroups)] }], "live", 1, 10));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event(initialGroups)] }], "today", 1, 11));
    expect(adapter.decode(detail({}, 1, 12, 11))).toEqual([]);
    adapter.decode(httpEnvelope([], "live", 2, 13, 12));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event(initialGroups)] }], "today", 2, 14, 12));
    expect(adapter.decode(detail({}, 2, 15, 14))).toHaveLength(1);
  });

  it("resolves an identity-only live transition from the prematch roster", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(detail(initialGroups, 1, 12, 11));
    const updated = adapter.decode(receiptEnvelope({ "8": eventId, "7": { "3": [goal()] } },
      "live", 13, 13, "ksport-stream-1", "worker-a:0"));
    expect(updated).toHaveLength(1);
    expect(updated[0]!.value).toMatchObject({ events: [expect.objectContaining({ isLive: true })] });
    expect(quotes(updated[0]!)).toHaveLength(2);
    expect(adapter.decode(detail(initialGroups, 2, 14, 12))).toEqual([]);
  });

  it("keeps a newer valid main row when the in-flight detail contains an old invalid row", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(delta({ "3": [goal("0.60")] }, 12, 1200));
    const updated = adapter.decode(detail({ "3": [goal("0")] }, 1, 13, 11));
    expect(quotes(updated[0]!).find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ rawOdds: "0.60", receivedMonotonicMs: 1200 });
  });

  it("keeps a hidden socket update newer than an in-flight detail omission", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(httpEnvelope([], "live", 1, 10));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal()] })] }], "today", 1, 11));
    adapter.decode(detail(initialGroups, 1, 12, 11));
    adapter.decode(delta({ "21": [corner("0.65")] }, 13, 1300));
    const updated = adapter.decode(detail({ "3": [goal()] }, 2, 14, 12));
    expect(quotes(updated[0]!).find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ rawOdds: "0.65", receivedMonotonicMs: 1300 });
  });

  it("keeps hidden quote clocks old until their own prices arrive", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const main = quotes(adapter.decode(delta({ "3": [goal("0.75")] }, 12, 200))[0]!);
    expect(main.filter((quote) => quote.providerMarketId === "7788992101"))
      .toEqual([expect.objectContaining({ receivedMonotonicMs: 100, sequence: 11 }),
        expect.objectContaining({ receivedMonotonicMs: 100, sequence: 11 })]);
    const hidden = quotes(adapter.decode(delta({ "21": [corner("0.65", "10.5")] }, 13, 300))[0]!);
    expect(hidden.find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ rawOdds: "0.65", receivedMonotonicMs: 300, sequence: 13, line: "10.5" });
    expect(hidden.find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ rawOdds: "0.75", receivedMonotonicMs: 200, sequence: 12 });
  });

  it("refuses delayed and duplicate envelopes for the same event", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    expect(adapter.decode(delta({ "21": [corner("0.65")] }, 14, 300))).toHaveLength(1);
    expect(adapter.decode(delta({ "21": [corner("0.80")] }, 13, 250))).toEqual([]);
    expect(adapter.decode(delta({ "21": [corner("0.80")] }, 14, 400))).toEqual([]);
  });

  it("updates identity-only hidden deltas while preserving roster competition and main quote clocks", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const input = { ...receiptEnvelope({ "8": eventId, "7": { "21": [corner("0.64")] } },
      "today", 12, 12, "ksport-stream-1", "worker-a:0"), receivedMonotonicMs: 200 };
    const updates = adapter.decode(input);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.value).toMatchObject({ events: [expect.objectContaining({ competition: "Prematch" })] });
    expect(quotes(updates[0]!).find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ rawOdds: "0.64", receivedMonotonicMs: 200 });
    expect(quotes(updates[0]!).find((quote) => quote.providerMarketId === "7788993001"))
      .toMatchObject({ receivedMonotonicMs: 100 });
  });

  it("withdraws old comparable quotes when the same native hidden row becomes invalid", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    const updates = adapter.decode(delta({ "21": [corner("0")] }, 12, 200));
    expect(updates).toHaveLength(1);
    expect(quotes(updates[0]!).map((quote) => quote.providerMarketId))
      .toEqual(["7788993001", "7788993001"]);
    expect(updates[0]!.value).toMatchObject({ nativeMarketObservations: expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "7788992101", disposition: "EXCLUDED" })
    ]) });
  });

  it("does not replay a retired socket stream or captured response as fresh hidden prices", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(delta({ "21": [corner("0.65")] }, 12, 200));
    adapter.decode(socketState("ksport-stream-2", "OPEN", 13, "worker-a:0"));
    expect(adapter.decode(delta({ "21": [corner("0.80")] }, 14, 300))).toEqual([]);
    const replay = delta({ "21": [corner("0.80")] }, 15, 400);
    expect(adapter.decode({ ...replay, request: { ...replay.request, streamId: "ksport-stream-2", replayed: true } }))
      .toEqual([]);
  });

  it("preserves socket prices received while the next HTTP pair is in flight", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(httpEnvelope([], "live", 2, 12, 11));
    adapter.decode(delta({ "21": [corner("0.65")] }, 13, 300));
    const committed = adapter.decode({ ...httpEnvelope([{ "1": "Prematch", "2": [event(initialGroups)] }],
      "today", 2, 14, 11), receivedMonotonicMs: 400 });
    expect(quotes(committed[0]!).find((quote) => quote.providerMarketId === "7788992101"))
      .toMatchObject({ rawOdds: "0.65", receivedMonotonicMs: 300, sequence: 13 });
  });

  it("uses the authoritative HTTP membership to remove a missing hidden market", () => {
    const adapter = new KsportWsCatalogAdapter();
    baseline(adapter);
    adapter.decode(httpEnvelope([], "live", 2, 12, 11));
    const committed = adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "3": [goal()] })] }],
      "today", 2, 13, 11));
    expect(quotes(committed[0]!).map((quote) => quote.providerMarketId))
      .toEqual(["7788993001", "7788993001"]);
  });

  it("publishes changes to a native-only event without requiring comparable quotes", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(httpEnvelope([], "live", 1, 10));
    adapter.decode(httpEnvelope([{ "1": "Prematch", "2": [event({ "777": [goal()] })] }], "today", 1, 11));
    const changed = adapter.decode(delta({ "777": [goal("0.75")] }, 12, 200));
    expect(changed).toHaveLength(1);
    expect(changed[0]!.value).toMatchObject({ quotes: [], nativeMarketObservations: [
      expect.objectContaining({ nativeType: "777", disposition: "UNMAPPED" })
    ] });
  });
});
