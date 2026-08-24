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

function withoutRecoveryGeneration(envelope: ChromeBridgeEnvelope): ChromeBridgeEnvelope {
  const { recoveryGeneration: _recoveryGeneration, ...request } = envelope.request as
    ChromeBridgeEnvelope["request"] & { readonly recoveryGeneration?: unknown };
  return { ...envelope, request };
}

function socketState(streamId: string, state: "OPEN" | "CLOSED", sequence: number,
  sourceEpoch?: string): ChromeBridgeEnvelope {
  return { ...receiptEnvelope([], "live", sequence, sequence, streamId, sourceEpoch), transport: "WS_STATE",
    payload: { encoding: "UTF8", body: JSON.stringify({ state }) } };
}

function batchedReceipts(...envelopes: readonly ChromeBridgeEnvelope[]): ChromeBridgeEnvelope {
  const frames = envelopes.flatMap((envelope) => JSON.parse(envelope.payload.body.slice(1)) as string[]);
  return { ...envelopes[0]!, payload: { encoding: "UTF8", body: `a${JSON.stringify(frames)}` } };
}

function httpEnvelope(payload: unknown, partition: "live" | "today", generation: number,
  sequence: number): ChromeBridgeEnvelope {
  return { ...envelope([]), sourceEpoch: "worker-a:0", transport: "HTTP_RESPONSE", sequence,
    request: { hostname: "zenandfe.com", pathnameClass: "/api/v2/getEvent", resourceType: "Fetch",
      streamId: `ksport-http:8:${generation}:${partition}` },
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

  it("pairs different live and today receipt orders by one explicit recovery generation", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }], "live", 10, 100)))
      .toEqual([]);
    const updates = adapter.decode(receiptEnvelope([{ "1": "Today", "2": [event(5643424)] }],
      "today", 11, 104));
    expect(updates).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      generation: "legacy:ksport-ws:ksport-stream-1:1" })]);
    const catalog = updates[0]!.value as { events: Array<{ providerEventId: string }> };

    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["5643423", "5643424"]);
  });

  it("orders replacement receipts within each partition instead of using a global fence", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 10, 200));
    adapter.decode(receiptEnvelope([], "today", 11, 100));

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 12, 101), 2)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 13, 201), 2)))
      .toEqual([expect.objectContaining({
        authoritativeBaseline: true,
        generation: "legacy:ksport-ws:ksport-stream-1:2"
      })]);
  });

  it("does not combine live and today partitions from different source epochs", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }],
      "live", 10, 10, "ksport-stream-1", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 11, 11,
      "ksport-stream-1", "worker-b:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 12, 10,
      "ksport-stream-1", "worker-a:0"))).toEqual([expect.objectContaining({
        authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
      })]);
  });

  it("treats the provider's current 1_11 hot-match channel as the today partition", () => {
    const event = (id: number) => ({ "0": "2026-08-21T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }], "live", 10));
    const currentToday = receiptEnvelope([{ "1": "Hot", "2": [event(5643424)] }], "today", 11, 10);
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
    adapter.decode(receiptEnvelope([], "today", 11, 100));
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([{ "1": "Live", "2": [event("0.95")] }],
      "live", 12, 102), 2))).toEqual([]);
    const newest = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 102), 2))[0]!.value as {
      quotes: Array<{ selection: string; rawOdds: string }> };
    expect(newest.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([{ "1": "Live", "2": [event("0.70")] }],
      "live", 14, 101), 3))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([{ "1": "Live", "2": [event("0.60")] }],
      "live", 15, 102), 3))).toEqual([]);
  });

  it("drops the previous socket epoch and waits for a complete reconnect baseline", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643423)] }], "live", 10, 200));
    adapter.decode(receiptEnvelope([], "today", 11, 200));
    const opened: ChromeBridgeEnvelope = { ...receiptEnvelope([], "live", 12, 1, "ksport-stream-2"),
      transport: "WS_STATE", payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } };
    expect(adapter.decode(opened)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SBOBET:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(5643424)] }],
      "live", 13, 201, "ksport-stream-2"))).toEqual([]);
    const catalog = adapter.decode(receiptEnvelope([], "today", 14, 201, "ksport-stream-2"))[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["5643424"]);
  });

  it("invalidates old authority when a higher stream first appears as a provider frame", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`,
      "3": `Away ${id}`, "7": {
        "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`]
      }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(2)] }],
      "live", 12, 200, "ksport-stream-2", undefined, 2))).toEqual([expect.objectContaining({
        invalidateAccountId: "catalog-source:SBOBET:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
      })]);
    expect(adapter.decode(receiptEnvelope([], "today", 13, 204,
      "ksport-stream-2", undefined, 2))).toEqual([expect.objectContaining({
        authoritativeBaseline: true, generation: "legacy:ksport-ws:ksport-stream-2:2"
      })]);
  });

  it("does not roll back to a retired socket when a late old frame arrives after reconnect", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));
    const opened: ChromeBridgeEnvelope = { ...receiptEnvelope([], "live", 12, 1, "ksport-stream-2"),
      transport: "WS_STATE", payload: { encoding: "UTF8", body: JSON.stringify({ state: "OPEN" }) } };
    adapter.decode(opened);
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(2)] }], "live", 13, 101, "ksport-stream-2"));

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 14, 102,
      "ksport-stream-1"))).toEqual([]);
    const catalog = adapter.decode(receiptEnvelope([], "today", 15, 101, "ksport-stream-2"))[0]!.value as {
      events: Array<{ providerEventId: string }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["2"]);
  });

  it("keeps an incomplete replacement baseline pending until both WS partitions match", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`,
      "7": { "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`] }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(socketState("ksport-stream-1", "OPEN", 1));
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 10, 100)))
      .toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 11, 100))).toHaveLength(1);

    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event(2)] }], "live", 12, 200), 2)))
      .toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 13, 100))).toEqual([]);
    const replacement = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 14, 200), 2))[0]!;

    expect(replacement).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      provenance: "WS" });
    expect((replacement.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "2" })]);
  });

  it("reapplies a newer delta that arrives while its replacement baseline is pending", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([{ "1": "Live", "2": [event("0.85")] }],
      "live", 12, 200), 2))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope(event("0.95"), "live", 13, 201), 2)))
      .toEqual([]);
    const committed = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 14, 200), 2))[0]!;

    expect(committed).toMatchObject({ authoritativeBaseline: true,
      generation: "legacy:ksport-ws:ksport-stream-1:2" });
    const catalog = committed.value as { quotes: Array<{ selection: string; rawOdds: string }> };
    expect(catalog.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("buffers a newer-generation delta that arrives before either full partition", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope(event("0.95"), "live", 12, 203), 2)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 204), 2))).toEqual([]);
    const committed = adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event("0.85")] }], "live", 14, 200), 2))[0]!;
    const catalog = committed.value as { quotes: Array<{ selection: string; rawOdds: string }> };

    expect(catalog.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("lets a newer-generation delta preempt an older pending baseline", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));
    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 12, 200), 2));

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope(event("0.95"), "live", 13, 303), 3)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event("0.60")] }], "live", 14, 204), 2))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 15, 304), 3))).toEqual([]);
    const committed = adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event("0.85")] }], "live", 16, 300), 3))[0]!;
    const catalog = committed.value as { quotes: Array<{ selection: string; rawOdds: string }> };

    expect(committed.generation).toBe("legacy:ksport-ws:ksport-stream-1:3");
    expect(catalog.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("rejects a delta from a retired explicit recovery generation", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));
    adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event("0.90")] }], "live", 12, 200), 2));
    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 204), 2));

    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope(event("0.60"), "live", 14, 300), 1))).toEqual([]);
  });

  it("does not let a retired full receipt poison the committed generation's deltas", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));
    adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event("0.90")] }], "live", 12, 200), 2));
    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 204), 2));

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.60")] }],
      "live", 14, 300))).toEqual([]);
    const current = adapter.decode(withRecoveryGeneration(
      receiptEnvelope(event("0.95"), "live", 15, 301), 2))[0]!.value as {
        quotes: Array<{ selection: string; rawOdds: string }> };
    expect(current.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("replays only pending deltas newer than their explicit partition baseline", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));

    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 12, 200), 2));
    adapter.decode(withRecoveryGeneration(receiptEnvelope(event("0.60"), "live", 13, 201), 2));
    const committed = adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event("0.90")] }], "live", 14, 204), 2))[0]!;
    const catalog = committed.value as { quotes: Array<{ selection: string; rawOdds: string }> };

    expect(catalog.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.90");
  });

  it("replays pending markets only when their own receipt is newer than the partition baseline", () => {
    const shell = { "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta", "8": 5643423 };
    const total = (price: string) =>
      `2.5 ${price}*56434230030002005h -0.98*56434230030002005a 5643423181025`;
    const handicap = (price: string) =>
      `-0.5 ${price}*56434230050000005h -0.97*56434230050000005a h 5643423181005`;
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));

    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope({ ...shell, "7": { "3": [total("0.60")] } }, "live", 12, 201), 2)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope({ ...shell, "7": { "5": [handicap("0.70")] } }, "live", 13, 203), 2)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 14, 204), 2)))
      .toEqual([]);
    const committed = adapter.decode(withRecoveryGeneration(receiptEnvelope([{
      "1": "Live", "2": [{ ...shell, "7": { "3": [total("0.90")], "5": [handicap("0.80")] } }]
    }], "live", 15, 202), 2))[0]!;
    const quotes = (committed.value as { quotes: Array<{
      marketType: string; selection: string; rawOdds: string }> }).quotes;

    expect(quotes.find((quote) => quote.marketType === "FT_TOTAL" &&
      quote.selection === "OVER")?.rawOdds).toBe("0.90");
    expect(quotes.find((quote) => quote.marketType === "FT_AH" &&
      quote.selection === "HOME")?.rawOdds).toBe("0.70");
  });

  it("rejects a full baseline older than an already applied delta receipt", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));
    const delta = adapter.decode(receiptEnvelope(event("0.95"), "live", 12, 201))[0]!.value as {
      quotes: Array<{ selection: string; rawOdds: string }> };
    expect(delta.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([{ "1": "Live", "2": [event("0.70")] }],
      "live", 13, 150), 2))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 14, 150), 2))).toEqual([]);
  });

  it("carries receipt evidence across a same-epoch stream handoff", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 10, 200, "1", "worker-a:0"));
    adapter.decode(receiptEnvelope([], "today", 11, 200, "1", "worker-a:0"));
    expect(adapter.decode(socketState("2", "OPEN", 12, "worker-a:0"))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SBOBET:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);

    expect(adapter.decode(receiptEnvelope([], "live", 13, 150, "2", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 14, 150, "2", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "live", 15, 201, "2", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 16, 201, "2", "worker-a:0")))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true,
        generation: "worker-a:0:ksport-ws:2:1" })]);
  });

  it("rejects a KSPORT delta without a comparable provider receipt order", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));
    const unordered = receiptEnvelope(event("0.95"), "live", 200, 201);

    expect(adapter.decode({ ...unordered, payload: { encoding: "UTF8",
      body: unordered.payload.body.replace("message-id:socket-201\\n", "") } })).toEqual([]);
  });

  it("does not advance partition receipt evidence for a malformed zero-record delta", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));

    expect(adapter.decode(receiptEnvelope({ malformed: true }, "live", 12, 900))).toEqual([]);
    const delta = adapter.decode(receiptEnvelope(event("0.95"), "live", 13, 101));
    expect(delta).toHaveLength(1);
    expect(((delta[0]!.value as { quotes: Array<{ selection: string; rawOdds: string }> }).quotes
      .find((quote) => quote.selection === "OVER")?.rawOdds)).toBe("0.95");

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 14, 200), 2))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 15, 204), 2)))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true })]);
  });

  it("fences a pending generation when its bounded delta recovery state overflows", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`,
      "3": `Away ${id}`, "7": {
        "3": [`2.5 0.95*${id}0030002005h -0.98*${id}0030002005a ${id}181025`]
      }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));
    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 12, 200), 2));

    for (let index = 0; index < 256; index += 1) {
      expect(adapter.decode(withRecoveryGeneration(
        receiptEnvelope(event(5_700_000 + index), "live", 20 + index, 201 + index), 2)))
        .toEqual([]);
    }
    const overflowWithSameFrameRecovery = batchedReceipts(
      withRecoveryGeneration(receiptEnvelope(event(5_700_256), "live", 276, 457), 2),
      withRecoveryGeneration(receiptEnvelope([], "live", 277, 500), 2),
      withRecoveryGeneration(receiptEnvelope([], "today", 278, 500), 2));
    expect(adapter.decode(overflowWithSameFrameRecovery))
      .toEqual([expect.objectContaining({
        invalidateAccountId: "catalog-source:SBOBET:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
      })]);
    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope(event(5_700_300), "live", 499, 900), 2))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 500, 200), 2))).toEqual([]);
    const heartbeat = { ...receiptEnvelope([], "today", 501, 458),
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };
    expect(adapter.decode(heartbeat)).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 502, 501), 3))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 503, 501), 3)))
      .toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      generation: "legacy:ksport-ws:ksport-stream-1:3"
    })]);
  });

  it("does not combine equal receipt orders from different explicit recovery generations", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away",
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] },
      "8": 5643423 };
    const adapter = new KsportWsCatalogAdapter();

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 10, 200)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 11, 200), 2))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "live", 12, 201))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 13, 201), 2)))
      .toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      generation: "legacy:ksport-ws:ksport-stream-1:2"
    })]);
  });

  it("does not let delayed old partitions complete a newer pending generation", () => {
    const event = (id: number) => ({ "0": "2026-08-20T16:00:00Z", "2": `Home ${id}`,
      "3": `Away ${id}`, "7": {
        "3": [`2.5 0.92*${id}0030002005h -0.98*${id}0030002005a ${id}181025`]
      }, "8": id });
    const adapter = new KsportWsCatalogAdapter();

    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event(1)] }], "live", 10, 100)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(
      receiptEnvelope([{ "1": "Live", "2": [event(2)] }], "live", 11, 200), 2))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 12, 104))).toEqual([]);
    const committed = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 204), 2))[0]!;

    expect(committed).toMatchObject({ authoritativeBaseline: true,
      generation: "legacy:ksport-ws:ksport-stream-1:2" });
    expect((committed.value as { events: Array<{ providerEventId: string }> }).events)
      .toEqual([expect.objectContaining({ providerEventId: "2" })]);
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
      streamId: "ksport-http:08:1:today" } })).toEqual([]);
    expect(adapter.decode(httpEnvelope([], "today", 1, 12))).toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      generation: "worker-a:0:ksport-http:8:1"
    })]);
  });

  it("treats duplicate current OPEN as a no-op after a completed KSPORT baseline", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(socketState("ksport-stream-1", "OPEN", 1));
    adapter.decode(receiptEnvelope([], "live", 2));
    adapter.decode(receiptEnvelope([], "today", 3, 2));

    expect(adapter.decode(socketState("ksport-stream-1", "OPEN", 4))).toEqual([]);
    const heartbeat = { ...receiptEnvelope([], "today", 5),
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };
    expect(adapter.decode(heartbeat)).toEqual([expect.objectContaining({ transportAlive: true })]);
  });

  it("ignores a delayed OPEN from a retired KSPORT stream", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(socketState("ksport-stream-1", "OPEN", 1));
    adapter.decode(socketState("ksport-stream-2", "OPEN", 2));

    expect(adapter.decode(socketState("ksport-stream-1", "OPEN", 3))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "live", 4, 4, "ksport-stream-2"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 5, 4, "ksport-stream-2")))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true })]);
  });

  it("keeps one exact monotonic stream fence across large socket churn", () => {
    const adapter = new KsportWsCatalogAdapter();
    for (let ordinal = 1; ordinal <= 1_000; ordinal += 1) {
      expect(adapter.decode(socketState(String(ordinal), "OPEN", ordinal))).toEqual([]);
    }

    expect(adapter.decode(socketState("not-a-stream-generation", "OPEN", 1_001))).toEqual([]);
    expect(adapter.decode(socketState("1", "OPEN", 1_002))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "live", 1_003, 200, "1000"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 1_004, 200, "1000")))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true,
        generation: "legacy:ksport-ws:1000:1" })]);
  });

  it("decodes the K-Sports STOMP catalog without needing DOM fallback", () => {
    const event = { "0": "2026-08-15T13:00:00Z", "2": "Home", "3": "Away", "7": {
      "5": ["0.5 0.92*55933920050000000h -0.98*55933920050000000a h 735502668161000 0 0 1 1 0"]
    }, "8": 5593392 };
    const adapter = new KsportWsCatalogAdapter();
    const input = receiptEnvelope([{ "1": "Premier Test", "2": [event] }], "live", 5);

    expect(adapter.fingerprint(input)).toBe(true);
    expect(adapter.decode(input)).toEqual([]);
    const value = adapter.decode(receiptEnvelope([], "today", 6, 5))[0]!.value as {
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
    adapter.decode(receiptEnvelope([], "today", 5, 4));
    const heartbeat = { ...receiptEnvelope([], "today", 6),
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };

    expect(adapter.decode(heartbeat)).toEqual([expect.objectContaining({
      transportAlive: true, sourceId: "chrome:KSPORT:8", sequence: 6
    })]);
  });

  it("reports heartbeat liveness only for the committed explicit recovery generation", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 4, 100));
    adapter.decode(receiptEnvelope([], "today", 5, 104));
    const heartbeat = (sequence: number, generation: number): ChromeBridgeEnvelope => ({
      ...withRecoveryGeneration(receiptEnvelope([], "today", sequence, 105), generation),
      payload: { encoding: "UTF8", body: `a${JSON.stringify(["\n"])}` }
    });

    expect(adapter.decode(heartbeat(6, 2))).toEqual([]);
    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 7, 200), 2));
    expect(adapter.decode(heartbeat(8, 1))).toEqual([]);
    expect(adapter.decode(heartbeat(9, 2))).toEqual([]);
    adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 10, 204), 2));
    expect(adapter.decode(heartbeat(11, 2)))
      .toEqual([expect.objectContaining({ transportAlive: true, sequence: 11 })]);
  });

  it("fails closed for baseline and heartbeat evidence without an explicit recovery generation", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(withoutRecoveryGeneration(receiptEnvelope([], "live", 4, 100))))
      .toEqual([]);
    expect(adapter.decode(withoutRecoveryGeneration(receiptEnvelope([], "today", 5, 104))))
      .toEqual([]);

    adapter.decode(receiptEnvelope([], "live", 6, 105));
    adapter.decode(receiptEnvelope([], "today", 7, 106));
    const heartbeat = { ...withoutRecoveryGeneration(receiptEnvelope([], "today", 8, 107)),
      payload: { encoding: "UTF8" as const, body: `a${JSON.stringify(["\n"])}` } };
    expect(adapter.decode(heartbeat)).toEqual([]);
  });

  it("ignores heartbeats from a retired sportsbook socket", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 4));
    adapter.decode(receiptEnvelope([], "today", 5, 4));
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

  it("atomically replaces a completed partition by provider event ID", () => {
    const event = (id: number, home: string) => ({ "0": "2026-08-15T13:00:00Z", "2": home, "3": `Away ${id}`, "7": {
      "5": [`0.5 0.92*${id}0050000000h -0.98*${id}0050000000a h 735502668161000 0 0 1 1 0`]
    }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    const first = receiptEnvelope([{ "1": "League", "2": [event(5593392, "Home 1"),
      event(5593393, "Home 2")] }], "live", 5);
    expect(adapter.decode(first)).toEqual([]);
    expect((adapter.decode(receiptEnvelope([], "today", 6, 5))[0]!.value as { events: unknown[] }).events)
      .toHaveLength(2);
    const replacementLive = withRecoveryGeneration(
      receiptEnvelope([{ "1": "League", "2": [event(5593392, "Home 1")] }], "live", 7, 7), 2);
    expect(adapter.decode(replacementLive)).toEqual([]);
    const catalog = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 8, 7), 2))[0]!.value as {
      events: unknown[]; quotes: Array<{
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
    adapter.decode(receiptEnvelope([], "today", 11, 100));

    const catalog = adapter.decode(receiptEnvelope(event(5643423, "0.95"), "live", 12, 102))[0]!.value as {
      events: Array<{ providerEventId: string }>; quotes: Array<{
        providerEventId: string; selection: string; rawOdds: string }> };

    expect(catalog.events.map((item) => item.providerEventId).sort()).toEqual(["5643423", "5643424"]);
    expect(catalog.quotes.find((quote) => quote.providerEventId === "5643423" &&
      quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("resolves an event present in both partitions by its newest receipt instead of fixed partition order", () => {
    const event = (price: string) => ({ "0": "2026-08-20T16:00:00Z", "2": "Alpha", "3": "Beta",
      "7": { "3": [`2.5 ${price}*56434230030002005h -0.98*56434230030002005a 730780068181025`] },
      "8": 5643423 });
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event("0.80")] }],
      "live", 10, 100))).toEqual([]);
    const tied = adapter.decode(receiptEnvelope([{ "1": "Today", "2": [event("0.90")] }],
      "today", 11, 100))[0]!.value as { quotes: Array<{ selection: string; rawOdds: string }> };
    expect(tied.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.80");

    const newest = adapter.decode(receiptEnvelope(event("0.95"), "today", 12, 101))[0]!.value as {
      quotes: Array<{ selection: string; rawOdds: string }> };
    expect(newest.quotes.find((quote) => quote.selection === "OVER")?.rawOdds).toBe("0.95");
  });

  it("merges a one-market event delta without erasing the event's other markets", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.80*56434230030002005h -0.98*56434230030002005a 5643423181025"],
        "5": ["0.5 0.81*56434230050000005h -0.97*56434230050000005a h 5643423181005"] } };
    const delta = { ...event,
      "7": { "3": ["2.5 0.95*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 100));

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
    adapter.decode(receiptEnvelope([], "today", 6, 5));
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([{ "1": "League", "2": [event(5593393)] }],
      "live", 7, 7), 2))).toEqual([]);
    const catalog = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 8, 7), 2))[0]!.value as {
        events: Array<{ providerEventId: string }>; quotes: Array<{
          providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(catalog.events.map((item) => item.providerEventId)).toEqual(["5593393"]);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "5593392")).toEqual([]);
  });

  it("publishes a complete authoritative empty pair to tombstone the previous catalog", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 12, 200), 2))).toEqual([]);
    const tombstone = adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 204), 2))[0]!;
    const catalog = tombstone.value as { events: unknown[]; markets: unknown[]; quotes: unknown[] };

    expect(tombstone).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      generation: "legacy:ksport-ws:ksport-stream-1:2" });
    expect(catalog).toMatchObject({ events: [], markets: [], quotes: [] });
  });

  it("does not treat a malformed nonempty full partition as authoritative empty", () => {
    const event = { "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away", "8": 5643423,
      "7": { "3": ["2.5 0.92*56434230030002005h -0.98*56434230030002005a 5643423181025"] } };
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([{ "1": "Live", "2": [event] }], "live", 10, 100));
    adapter.decode(receiptEnvelope([], "today", 11, 104));

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([
      { "1": "Live", "2": [{ "0": "2026-08-20T16:00:00Z", "2": "Home", "3": "Away",
        "7": {}, "8": 5643424 }] }
    ], "live", 12, 200), 2))).toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 13, 204), 2)))
      .toEqual([]);

    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "live", 14, 300), 3)))
      .toEqual([]);
    expect(adapter.decode(withRecoveryGeneration(receiptEnvelope([], "today", 15, 304), 3)))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true,
        generation: "legacy:ksport-ws:ksport-stream-1:3",
        value: expect.objectContaining({ events: [], markets: [], quotes: [] }) })]);
  });

  it("invalidates SBOBET immediately when its active socket closes", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 4));
    adapter.decode(receiptEnvelope([], "today", 5, 4));
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

  it("rebaselines on a strictly newer stream after close in the same source epoch", () => {
    const adapter = new KsportWsCatalogAdapter();
    adapter.decode(receiptEnvelope([], "live", 10, 100, "1", "worker-a:0"));
    adapter.decode(receiptEnvelope([], "today", 11, 104, "1", "worker-a:0"));
    expect(adapter.decode(socketState("1", "CLOSED", 12, "worker-a:0")))
      .toEqual([expect.objectContaining({ reason: "PROVIDER_STREAM_CLOSED" })]);
    expect(adapter.decode(socketState("2", "OPEN", 13, "worker-a:0"))).toEqual([]);

    expect(adapter.decode(receiptEnvelope([], "live", 14, 100, "2", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 15, 104, "2", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "live", 16, 101, "2", "worker-a:0"))).toEqual([]);
    expect(adapter.decode(receiptEnvelope([], "today", 17, 105, "2", "worker-a:0")))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true,
        generation: "worker-a:0:ksport-ws:2:1" })]);
  });
});
