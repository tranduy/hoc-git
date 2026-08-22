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
    request: { hostname: "push.example", pathnameClass: "/sport/433/session/websocket", resourceType: "WebSocket",
      streamId: "ksport-stream-1" },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}

function receiptEnvelope(payload: unknown, partition: "live" | "today", sequence: number,
  receiptSequence = sequence, streamId = "ksport-stream-1"): ChromeBridgeEnvelope {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const message = `MESSAGE\ndestination:/topic/sports/1_1/${partition}/ma/event/vi\n` +
    `content-type:application/json\nsubscription:${subscription}\nmessage-id:socket-${receiptSequence}\n\n` +
    `${JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: JSON.stringify(payload) })}\0`;
  return { ...envelope(payload), sequence, request: { ...envelope(payload).request, streamId },
    payload: { encoding: "UTF8", body: `a${JSON.stringify([message])}` } };
}

describe("KsportWsCatalogAdapter", () => {
  it("rejects the auxiliary Volta root socket even when it shares an sb21 host", () => {
    const adapter = new KsportWsCatalogAdapter();
    const input = envelope([]);
    expect(adapter.fingerprint({ ...input, request: {
      ...input.request, hostname: "novoga.sb21.net", pathnameClass: "/"
    } })).toBe(false);
  });

  it("does not publish a partial epoch before both live and today receipts form the baseline", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }], "live", 10)))
      .toEqual([]);
    const catalog = adapter.decode(receiptEnvelope([{ "1": "Today", "2": [event(5643424)] }],
      "today", 11))[0]!.value as { events: Array<{ providerEventId: string }> };

    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["5643423", "5643424"]);
  });

  it("treats the provider's current 1_11 hot-match channel as the today partition", () => {
    const event = (id: number) => ({ "0": "2026-08-21T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }], "live", 10));
    const currentToday = receiptEnvelope([{ "1": "Hot", "2": [event(5643424)] }], "today", 11);
    const body = currentToday.payload.body
      .replace("/sports/1_1/today/", "/sports/1_11/today/")
      .replace("subSportBookToday", "subSportHotMatch");
    const catalog = adapter.decode({ ...currentToday, payload: { encoding: "UTF8", body } })[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["5643423", "5643424"]);
  });

  it("ignores duplicate and out-of-order provider receipts without rolling odds backward", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 101));
    const newest = adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.95")] }],
      "live", 12, 102))[0]!.value as { quotes: Array<{ selection: string; rawOdds: string }> };
    expect(newest.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.70")] }],
      "live", 13, 101))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.60")] }],
      "live", 14, 102))).toEqual([]);
  });

  it("drops the previous socket epoch and waits for a complete reconnect baseline", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }], "live", 10, 200));
    adapter.decode(receiptEnvelope([], "today", 11, 201));
    const opened: ChromeBridgeEnvelope = { ...receiptEnvelope([], "live", 12, 1, "ksport-stream-2"),
      transport: "WS_STATE", payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } };
    expect(adapter.decode(opened)).toEqual([]);
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643424)] }],
      "live", 13, 1, "ksport-stream-2"))).toEqual([]);
    const catalog = adapter.decode(receiptEnvelope([], "today", 14, 2, "ksport-stream-2"))[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["5643424"]);
  });

  it("does not roll back to a retired socket when a late old frame arrives after reconnect", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 101));
    const opened: ChromeBridgeEnvelope = { ...receiptEnvelope([], "live", 12, 1, "ksport-stream-2"),
      transport: "WS_STATE", payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } };
    adapter.decode(opened);
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(2)] }], "live", 13, 1, "ksport-stream-2"));

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 14, 102,
      "ksport-stream-1"))).toEqual([]);
    const catalog = adapter.decode(receiptEnvelope([], "today", 15, 2, "ksport-stream-2"))[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["2"]);
  });

  it("keeps the sportsbook socket when an auxiliary jackpot socket opens after it", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    const open = (streamId: string, sequence: number): ChromeBridgeEnvelope => ({
      ...receiptEnvelope([], "live", sequence, 1, streamId), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } });
    adapter.decode(open("sportsbook", 1));
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 2, 10, "sportsbook"));
    expect(adapter.decode(receiptEnvelope([], "today", 3, 11, "sportsbook"))).toHaveLength(1);

    // Jackpot/menu socket opens later and only ever carries non-sportsbook frames.
    adapter.decode(open("jackpot", 4));
    expect(adapter.decode({ ...envelope({ pong: 1 }, "/topic/menu/live/count"),
      request: { ...envelope([]).request, streamId: "jackpot" }, sequence: 5 })).toEqual([]);

    // The real feed keeps publishing.
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 6, 12, "sportsbook")))
      .toEqual([]);
    const catalog = adapter.decode(receiptEnvelope([], "today", 7, 13, "sportsbook"))[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["1"]);

    // A genuinely newer sportsbook socket still supersedes it.
    adapter.decode(open("sportsbook-2", 8));
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(2)] }], "live", 9, 1, "sportsbook-2"));
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 10, 14, "sportsbook")))
      .toEqual([]);
    const next = adapter.decode(receiptEnvelope([], "today", 11, 2, "sportsbook-2"))[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(next.events.map((item) => item.providerEventId)).toEqual(["2"]);
  });

  it("decodes the K-Sports STOMP catalog without needing DOM fallback", () => {
    const event = { "0": "2026-08-15T13:00:00Z", "2": "Home", "3": "Away", "7": {
      "5": ["0.5 0.92*55933920050000000h -0.98*55933920050000000a h 735502668161000 0 0 1 1 0"]
    }, "8": 5593392 };
    const adapter = new KsportWsCatalogAdapter();
    const input = receiptEnvelope([{ "1": "Premier Test", "2": [event] }], "live", 5);

    expect(adapter.fingerprint(input)).toBe(true);
    expect(adapter.decode(input)).toEqual([]);
    const value = adapter.decode(receiptEnvelope([], "today", 6))[0]!.value as {
      accountId: string; events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(value.accountId).toBe("catalog-source:SBOBET:FOOTBALL");
    expect(value.events).toHaveLength(1);
    expect(value.markets).toHaveLength(1);
    expect(value.quotes).toHaveLength(2);
  });

  it("ignores jackpot and pong frames", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.fingerprint(envelope({ pong: 1 }, "/topic/jackpot/ws"))).toBe(false);
  });

  it("reports transport liveness for a heartbeat on the current completed sportsbook socket", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 4));
    adapter.decode(receiptEnvelope([], "today", 5));
    const heartbeat = { ...receiptEnvelope([], "today", 6),
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };

    expect(adapter.decode(heartbeat)).toEqual([expect.objectContaining({
      transportAlive: true, sourceId: "chrome:KSPORT:8", sequence: 6
    })]);
  });

  it("ignores heartbeats from a retired sportsbook socket", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 4));
    adapter.decode(receiptEnvelope([], "today", 5));
    const opened: ChromeBridgeEnvelope = { ...receiptEnvelope([], "live", 6, 1, "ksport-stream-2"),
      transport: "WS_STATE", payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } };
    adapter.decode(opened);
    const oldHeartbeat = { ...receiptEnvelope([], "today", 7, 7, "ksport-stream-1"),
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };

    expect(adapter.decode(oldHeartbeat)).toEqual([]);
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

  it("publishes the current page getEvent snapshot while ignoring untagged direct probes", () => {
    const event = { "0": "2026-08-21T16:00:00Z", "2": "Kashiwa", "3": "V Varen Nagasaki", "8": 5643423,
      "7": { "5": ["0.5 0.92*56434230050000005h -0.98*56434230050000005a h 735502668161000 0 0 1 1 0"] } };
    const adapter = new KsportWsCatalogAdapter();
    const input: ChromeBridgeEnvelope = {
      ...envelope([]), transport: "HTTP_RESPONSE", sequence: 20,
      request: { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch",
        streamId: "ksport-http:today" },
      payload: { encoding: "UTF8", body: JSON.stringify([{ "1": "J League", "2": [event] }]) }
    };
    const catalog = adapter.decode(input)[0]?.value as { events: unknown[]; quotes: unknown[] };
    expect(adapter.fingerprint(input)).toBe(true);
    expect(catalog.events).toHaveLength(1);
    expect(catalog.quotes).toHaveLength(2);
  });

  it("atomically replaces a completed partition by provider event ID", () => {
    const event = (id: number, home: string) => ({ "0": "2026-08-15T13:00:00Z", "2": home, "3": `Away ${id}`, "7": {
      "5": [`0.5 0.92*${id}0050000000h -0.98*${id}0050000000a h 735502668161000 0 0 1 1 0`]
    }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    const first = receiptEnvelope([{ "1": "League", "2": [event(5593392, "Home 1"),
      event(5593393, "Home 2")] }], "live", 5);
    expect(adapter.decode(first)).toEqual([]);
    expect((adapter.decode(receiptEnvelope([], "today", 6))[0]!.value as { events: unknown[] }).events)
      .toHaveLength(2);
    const delta = receiptEnvelope([{ "1": "League", "2": [event(5593392, "Home 1")] }], "live", 7, 7);
    const catalog = adapter.decode(delta)[0]!.value as { events: unknown[]; quotes: Array<{
      providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(catalog.events).toHaveLength(1);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "5593393")).toEqual([]);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "5593392"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 60, sequence: 7 })]));
  });

  it("applies an event delta by provider ID without erasing the completed partition baseline", () => {
    const event = (id: number, price: string) => ({ "0": "2026-08-20T16:00:00Z",
      "2": `Home ${id}`, "3": `Away ${id}`, "8": id,
      "7": { "3": [`2.5 ${price}*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] } });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423, "0.80"),
      event(5643424, "0.81")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 101));

    const catalog = adapter.decode(receiptEnvelope(event(5643423, "0.95"), "live", 12, 102))[0]!.value as {
      events: Array<{ providerEventId: string }>; quotes: Array<{
        providerEventId: string; selection: string; rawOdds: string }> };

    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["5643423", "5643424"]);
    expect(catalog.quotes.find((quote) => quote.providerEventId === "5643423" &&
      quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("merges a one-market event delta without erasing the event's other markets", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.80*56434230030002005h -0.98*56434230030002005a 5643423181025"],
        "5": ["0.5 0.81*56434230050000005h -0.97*56434230050000005a h 5643423181005"] } };
    const delta = { ...event,
      "7": { "3": ["2.5 0.95*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 101));

    const catalog = adapter.decode(receiptEnvelope(delta, "live", 12, 102))[0]!.value as {
      markets: Array<{ marketType: string }>; quotes: Array<{ marketType: string; rawOdds: string }> };
    expect(catalog.markets.map((market) => market.marketType).sort()).toEqual(["FT_AH", "FT_TOTAL"]);
    expect(catalog.quotes.find((quote) => quote.marketType === "FT_TOTAL")?.rawOdds).toBe("0.95");
  });

  it("does not accumulate removed events across repeated full partition receipts", () => {
    const event = (id: number) => ({ "0": "2026-08-15T13:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`, "7": {
      "5": [`0.5 0.92*${id}0050000000h -0.98*${id}0050000000a h 735502668161000 0 0 1 1 0`]
    }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "League", "2": [event(5593392)] }], "live", 5));
    adapter.decode(receiptEnvelope([], "today", 6));
    const catalog = adapter.decode(receiptEnvelope([{ "1": "League", "2": [event(5593393)] }],
      "live", 7, 7))[0]!.value as {
        events: Array<{ providerEventId: string }>; quotes: Array<{
          providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["5593393"]);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "5593392")).toEqual([]);
  });

  it("invalidates SBOBET immediately when its active socket closes", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 4));
    adapter.decode(receiptEnvelope([], "today", 5));
    const closed: ChromeBridgeEnvelope = { ...receiptEnvelope([], "live", 6), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } };
    expect(adapter.fingerprint(closed)).toBe(true);
    expect(adapter.decode(closed)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SBOBET:FOOTBALL", reason: "PROVIDER_STREAM_CLOSED"
    })]);
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [{ "0": "2026-08-20T16:00:00Z",
      "2": "Late", "3": "Old", "7": {}, "8": 99 }] }], "live", 7))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 8))).toEqual([]);
  });
});
