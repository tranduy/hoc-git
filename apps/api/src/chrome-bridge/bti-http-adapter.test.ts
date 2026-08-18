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

  it("rejects unrelated paths and malformed bodies", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.decode({ ...envelope(), request: { ...envelope().request, pathnameClass: "/api/profile" } })).toEqual([]);
    expect(adapter.decode(envelope("not-json"))).toEqual([]);
  });
});
