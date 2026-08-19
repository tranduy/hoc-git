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

describe("KsportWsCatalogAdapter", () => {
  it("decodes the K-Sports STOMP catalog without needing DOM fallback", () => {
    const event = { "0": "2026-08-15T13:00:00Z", "2": "Home", "3": "Away", "7": {
      "5": ["0.5 0.92*55933920050000000h -0.98*55933920050000000a h 735502668161000 0 0 1 1 0"]
    }, "8": 5593392 };
    const adapter = new KsportWsCatalogAdapter();
    const input = envelope([{ "1": "Premier Test", "2": [event] }]);

    expect(adapter.fingerprint(input)).toBe(true);
    const value = adapter.decode(input)[0]!.value as { accountId: string; events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(value.accountId).toBe("catalog-source:SBOBET:FOOTBALL");
    expect(value.events).toHaveLength(1);
    expect(value.markets).toHaveLength(1);
    expect(value.quotes).toHaveLength(2);
  });

  it("ignores jackpot and pong frames", () => {
    const adapter = new KsportWsCatalogAdapter();
    expect(adapter.fingerprint(envelope({ pong: 1 }, "/topic/jackpot/ws"))).toBe(false);
  });

  it("retains unchanged events when the socket sends a one-event delta", () => {
    const event = (id: number, home: string) => ({ "0": "2026-08-15T13:00:00Z", "2": home, "3": `Away ${id}`, "7": {
      "5": [`0.5 0.92*${id}0050000000h -0.98*${id}0050000000a h 735502668161000 0 0 1 1 0`]
    }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    const first = envelope([{ "1": "League", "2": [event(5593392, "Home 1"), event(5593393, "Home 2")] }]);
    expect((adapter.decode(first)[0]!.value as { events: unknown[] }).events).toHaveLength(2);
    const delta = envelope([{ "1": "League", "2": [event(5593392, "Home 1")] }], undefined,
      { sequence: 6, observedAtMs: first.observedAtMs + 1_000, receivedMonotonicMs: 90 });
    const catalog = adapter.decode(delta)[0]!.value as { events: unknown[]; quotes: Array<{
      providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(catalog.events).toHaveLength(2);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "5593393"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 60, sequence: 5 })]));
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "5593392"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 90, sequence: 6 })]));
  });

  it("expires untouched socket deltas after fifteen seconds", () => {
    const event = (id: number) => ({ "0": "2026-08-15T13:00:00Z", "2": `Home ${id}`, "3": `Away ${id}`, "7": {
      "5": [`0.5 0.92*${id}0050000000h -0.98*${id}0050000000a h 735502668161000 0 0 1 1 0`]
    }, "8": id });
    const adapter = new KsportWsCatalogAdapter();
    const startedAtMs = Date.UTC(2026, 7, 15, 13);
    adapter.decode(envelope([{ "1": "League", "2": [event(5593392)] }], undefined,
      { observedAtMs: startedAtMs }));
    const catalog = adapter.decode(envelope([{ "1": "League", "2": [event(5593393)] }], undefined,
      { sequence: 6, observedAtMs: startedAtMs + 15_001, receivedMonotonicMs: 90 }))[0]!.value as {
        events: Array<{ providerEventId: string }> };
    expect(catalog.events).toEqual([expect.objectContaining({ providerEventId: "5593393" })]);
  });

  it("invalidates SBOBET immediately when its active socket closes", () => {
    const adapter = new KsportWsCatalogAdapter();
    const closed: ChromeBridgeEnvelope = { ...envelope([]), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: "CLOSED" } };
    expect(adapter.fingerprint(closed)).toBe(true);
    expect(adapter.decode(closed)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:SBOBET:FOOTBALL", reason: "PROVIDER_STREAM_CLOSED"
    })]);
  });
});
