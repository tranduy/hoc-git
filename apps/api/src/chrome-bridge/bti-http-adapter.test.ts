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

describe("BtiHttpCatalogAdapter", () => {
  it("decodes the live football event-list response", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.fingerprint(envelope())).toBe(true);
    const catalog = adapter.decode(envelope())[0]!.value as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(catalog).toMatchObject({ accountId: "catalog-source:BTI:FOOTBALL", provider: "BTI" });
    expect(catalog.events).toHaveLength(1);
    expect(catalog.markets).toHaveLength(1);
    expect(catalog.quotes).toHaveLength(2);
  });

  it("accepts prematch event-list responses and retains live plus prematch catalogs", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const live = adapter.decode(envelope())[0]!.value as { events: { providerEventId: string }[] };
    expect(live.events.map(({ providerEventId }) => providerEventId)).toEqual(["event"]);

    const prematchPayload = { serializedData: [["league-p", "Prematch League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [[
        "hc-p", "Prematch", "Prematch", ["HC0", "full time", 1], "event-p", "league-p", "1",
        [selection("home-p", 1, -0.5, "0.82"), selection("away-p", 3, 0.5, "-0.92")]
      ]]]
    ]]]]} ;
    const prematchEnvelope = { ...envelope(JSON.stringify(prematchPayload)), sequence: 10,
      request: { ...envelope().request, pathnameClass: "/api/eventlist/asia/leagues/v2/1/prematch/initial" } };
    expect(adapter.fingerprint(prematchEnvelope)).toBe(true);
    const combined = adapter.decode(prematchEnvelope)[0]!.value as { events: { providerEventId: string; isLive: boolean }[] };
    expect(combined.events.map(({ providerEventId, isLive }) => [providerEventId, isLive])).toEqual([
      ["event", true], ["event-p", false]
    ]);
  });

  it("keeps market and quote identities isolated when BTI reuses ids across events", () => {
    const adapter = new BtiHttpCatalogAdapter();
    adapter.decode(envelope());
    const reusedIds = { serializedData: [["league-p", "Prematch League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [[
        "hc", "Prematch", "Prematch", ["HC0", "full time", 1], "event-p", "league-p", "1",
        [selection("home", 1, -0.5, "0.82"), selection("away", 3, 0.5, "-0.92")]
      ]]]
    ]]]]} ;
    const update = adapter.decode({ ...envelope(JSON.stringify(reusedIds)), sequence: 10,
      request: { ...envelope().request, pathnameClass: "/api/eventlist/asia/leagues/v2/1/prematch/initial" } })[0]!.value as {
        events: unknown[]; markets: unknown[]; quotes: unknown[];
      };
    expect(update.events).toHaveLength(2);
    expect(update.markets).toHaveLength(2);
    expect(update.quotes).toHaveLength(4);
  });

  it("rejects unrelated paths and malformed bodies", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.decode({ ...envelope(), request: { ...envelope().request, pathnameClass: "/api/profile" } })).toEqual([]);
    expect(adapter.decode(envelope("not-json"))).toEqual([]);
  });
});
