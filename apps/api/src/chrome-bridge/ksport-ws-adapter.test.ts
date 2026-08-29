import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
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
  });

  it("rejects a provider error object inside an HTTP partition pair", () => {
    const adapter = new KsportWsCatalogAdapter();
    const error = { status: "error", errorCode: 500, message: "request failed", values: null };

    expect(adapter.decode(httpEnvelope(error, "live", 1, 10))).toEqual([]);
    expect(adapter.decode(httpEnvelope([[{ "1": "Today", "2": [] }]],
      "today", 1, 11))).toEqual([]);
  });

  it("does not promote a nonempty HTTP partition whose event markets decode to zero", () => {
    const adapter = new KsportWsCatalogAdapter();
    const undecodable = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away",
      "7": {}, "8": 5643423 };

    expect(adapter.decode(httpEnvelope([{ "1": "Live", "2": [undecodable] }], "live", 1, 10)))
      .toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 11))).toEqual([]);
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
