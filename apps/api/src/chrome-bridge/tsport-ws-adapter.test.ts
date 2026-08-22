import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { TsportWsCatalogAdapter } from "./tsport-ws-adapter.js";

function envelope(event: unknown, sequence = 1): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
    sequence, observedAtMs: Date.UTC(2026, 7, 16, 3), receivedMonotonicMs: 50,
    transport: "WS_FRAME",
    request: { hostname: "spws.agenate.com", pathnameClass: "/ln/en/p/1/u/redacted/session-part/s/1/mg/0/tr/0",
      resourceType: "WebSocket", streamId: "tsport-stream-1" },
    payload: { encoding: "UTF8", body: JSON.stringify({ s: 1, t: "eu", tmrg: "0", d: JSON.stringify(event) }) }
  };
}

function domEnvelope(records: readonly unknown[], sequence = 1): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7,
    sequence, observedAtMs: Date.UTC(2026, 7, 16, 3), receivedMonotonicMs: 50,
    transport: "DOM_SNAPSHOT",
    request: { hostname: "pacific.agenate.com", pathnameClass: "/__fieldline_dom_snapshot__",
      resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
      snapshotId: `tsport-dom-${sequence}-baseline`,
      chunkIndex: 0, chunkCount: 1, records }) }
  };
}

const event = (id: number, home: string) => ({
  "2": id, "5": home, "10": "Active", "11": "2026-08-16T02:00:00Z", "19": 1_399_000,
  "22": `Away ${id}`, "25": 1, "26": 2, "53": "League",
  "50": [
    { "3": 3, "9": [{ "0": `${id}-over`, "2": `${id}-under`, "6": `${id}-total`, "7": "2.5",
      "8": { "2": "0.83" }, "9": { "2": "-0.91" } }], "10": "Active" },
    { "3": 4, "9": [{ "0": `${id}-fh-over`, "2": `${id}-fh-under`, "6": `${id}-fh-total`, "7": "1.75",
      "8": { "2": "0.72" }, "9": { "2": "-0.82" } }], "10": "Active" },
    { "3": 5, "9": [{ "0": `${id}-home`, "2": `${id}-away`, "6": `${id}-ah`, "7": "-0.5",
      "8": { "2": "0.79" }, "9": { "2": "-0.87" } }], "10": "Active" },
    { "3": 6, "9": [{ "0": `${id}-fh-home`, "2": `${id}-fh-away`, "6": `${id}-fh-ah`, "7": "-0.25",
      "8": { "2": "0.67" }, "9": { "2": "-0.77" } }], "10": "Active" }
  ]
});

describe("TsportWsCatalogAdapter", () => {
  it("publishes the authenticated T-Sports football socket as APSPORT", () => {
    const adapter = new TsportWsCatalogAdapter();
    const input = envelope(event(5557168, "Perugia"));
    expect(adapter.fingerprint(input)).toBe(true);
    const catalog = adapter.decode(input)[0]!.value as {
      accountId: string; provider: string; events: unknown[];
      markets: Array<{ marketType: string; line: string }>; quotes: unknown[];
    };
    expect(catalog).toMatchObject({ accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT" });
    expect(catalog.events).toHaveLength(1);
    expect(catalog.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ marketType: "FT_TOTAL", line: "2.5" }),
      expect.objectContaining({ marketType: "FH_TOTAL", scope: "FIRST_HALF", line: "1.75",
        settlementProfile: "football-first-half-including-added-time" }),
      expect.objectContaining({ marketType: "FT_AH", line: "-0.5" }),
      expect.objectContaining({ marketType: "FH_AH", scope: "FIRST_HALF", line: "-0.25",
        settlementProfile: "football-first-half-including-added-time" })
    ]));
    expect(catalog.quotes).toHaveLength(8);
  });

  it("decodes provider-defined second-half, corner, and card groups without mixing their identities", () => {
    const expanded = event(5557171, "Expanded Home");
    const group = (code: number, id: string, line: string) => ({ "3": code, "9": [{
      "0": `${id}-first`, "2": `${id}-second`, "6": id, "7": line,
      "8": { "2": "0.72" }, "9": { "2": "-0.82" }
    }], "10": "Active" });
    expanded["50"].push(
      group(19, "corner-ft-ah", "-0.5"), group(20, "corner-fh-ah", "-0.5"),
      group(21, "corner-ft-total", "2.5"), group(22, "corner-fh-total", "2.5"),
      group(31, "card-ft-total", "2.5"), group(32, "card-fh-total", "2.5"),
      group(33, "card-ft-ah", "-0.5"), group(34, "card-fh-ah", "-0.5"),
      group(80, "sh-total", "2.5"), group(85, "sh-ah", "-0.5"),
      group(10, "exact-score", "1.5"), group(17, "corner-1x2", "1.5")
    );
    const catalog = new TsportWsCatalogAdapter().decode(envelope(expanded))[0]!.value as {
      markets: Array<{ marketType: string; scope: string; settlementProfile: string }>;
    };
    expect(catalog.markets.slice(4).map(({ marketType, scope, settlementProfile }) =>
      [marketType, scope, settlementProfile])).toEqual([
      ["CORNER_FT_AH", "FULL_TIME", "football-corners-regulation"],
      ["CORNER_FH_AH", "FIRST_HALF", "football-corners-first-half"],
      ["CORNER_FT_TOTAL", "FULL_TIME", "football-corners-regulation"],
      ["CORNER_FH_TOTAL", "FIRST_HALF", "football-corners-first-half"],
      ["CARD_FT_TOTAL", "FULL_TIME", "football-cards-regulation"],
      ["CARD_FH_TOTAL", "FIRST_HALF", "football-cards-first-half"],
      ["CARD_FT_AH", "FULL_TIME", "football-cards-regulation"],
      ["CARD_FH_AH", "FIRST_HALF", "football-cards-first-half"],
      ["SH_TOTAL", "SECOND_HALF", "football-second-half-including-added-time"],
      ["SH_AH", "SECOND_HALF", "football-second-half-including-added-time"]
    ]);
  });

  it("accepts the current public football socket path without the legacy user segment", () => {
    const adapter = new TsportWsCatalogAdapter();
    const input = envelope(event(5557169, "Current Home"));
    const currentPath: ChromeBridgeEnvelope = {
      ...input,
      request: { ...input.request, pathnameClass: "/ln/en/s/1/mg/0/tr/0" }
    };

    expect(adapter.fingerprint(currentPath)).toBe(true);
    expect(adapter.decode(currentPath)[0]?.value).toMatchObject({
      accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT"
    });
  });

  it("accepts the live authenticated football socket path with one user token segment", () => {
    const adapter = new TsportWsCatalogAdapter();
    const input = envelope(event(5557172, "Live Path Home"));
    const livePath: ChromeBridgeEnvelope = {
      ...input,
      request: {
        ...input.request,
        pathnameClass: "/ln/en/p/1/u/4kEO1vmEBrINaqa90fO6eA==/s/1/mg/0/tr/0"
      }
    };

    expect(adapter.fingerprint(livePath)).toBe(true);
    expect(adapter.decode(livePath)[0]?.value).toMatchObject({
      accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT"
    });
  });

  it("publishes a healthy empty football catalog when the live socket contains only virtual events", () => {
    const adapter = new TsportWsCatalogAdapter();
    const virtual = {
      ...event(5557173, "Arsenal (player_one)"),
      "22": "Chelsea (player_two)",
      "53": "E Soccer H2H GG League 8 Mins Play"
    };

    expect(adapter.fingerprint(envelope(virtual))).toBe(true);
    expect(adapter.decode(envelope(virtual))).toEqual([expect.objectContaining({
      value: expect.objectContaining({
        accountId: "catalog-source:APSPORT:FOOTBALL",
        provider: "APSPORT",
        events: [], markets: [], quotes: [], rejectedMarketCount: 1
      })
    })]);
  });

  it("accepts the rotated racern.com football socket without accepting suffix lookalikes", () => {
    const adapter = new TsportWsCatalogAdapter();
    const input = envelope(event(5557170, "Rotated Home"));
    const rotated: ChromeBridgeEnvelope = {
      ...input,
      request: { ...input.request, hostname: "spws.racern.com" }
    };
    expect(adapter.fingerprint(rotated)).toBe(true);
    expect(adapter.fingerprint({ ...rotated,
      request: { ...rotated.request, hostname: "spws.racern.com.evil.test" }
    })).toBe(false);
  });

  it("retains unchanged events across one-event socket deltas", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(envelope(event(1, "Home 1")));
    const next = { ...envelope(event(2, "Home 2"), 2), observedAtMs: Date.UTC(2026, 7, 16, 3, 0, 1),
      receivedMonotonicMs: 80 };
    const second = adapter.decode(next)[0]!.value as { events: unknown[]; quotes: Array<{
      providerEventId: string; receivedMonotonicMs: number; sequence: number | null }> };
    expect(second.events).toHaveLength(2);
    expect(second.quotes.filter((quote) => quote.providerEventId === "1"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 50, sequence: 1 })]));
    expect(second.quotes.filter((quote) => quote.providerEventId === "2"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 80, sequence: 2 })]));
  });

  it("seeds the complete catalog from a DOM baseline before merging one-event socket deltas", () => {
    const adapter = new TsportWsCatalogAdapter();
    const baseline = [1, 2, 3].map((id) => ({
      eventId: String(id), leagueName: "League", timeText: "LIVE", scoreText: "0 - 0",
      teamNames: [`Home ${id}`, `Away ${id}`], markets: [{ marketId: `${id}-ah`, marketType: "FT_AH",
        lineText: "-0.5", selections: [
          { selectionId: `${id}-home`, selection: "HOME", priceText: "0.8", locked: false, lineText: "-0.5" },
          { selectionId: `${id}-away`, selection: "AWAY", priceText: "-0.9", locked: false, lineText: "+0.5" }
        ] }]
    }));

    const seeded = adapter.decode(domEnvelope(baseline))[0]!.value as { events: unknown[] };
    expect(seeded.events).toHaveLength(3);
    const merged = adapter.decode(envelope(event(2, "Updated Home 2"), 2))[0]!.value as { events: unknown[] };
    expect(merged.events).toHaveLength(3);
  });

  it("marks a completed DOM generation as an authoritative baseline", () => {
    const adapter = new TsportWsCatalogAdapter();
    const baseline = [{
      eventId: "current-1", leagueName: "Current league", timeText: "LIVE", scoreText: "0 - 0",
      teamNames: ["Current home", "Current away"], markets: [{
        marketId: "current-total", marketType: "FT_TOTAL", lineText: "2.5", selections: [
          { selectionId: "current-over", selection: "OVER", priceText: "0.8", locked: false },
          { selectionId: "current-under", selection: "UNDER", priceText: "-0.9", locked: false }
        ]
      }]
    }];

    expect(adapter.decode(domEnvelope(baseline))[0]).toMatchObject({
      authoritativeBaseline: true,
      value: { accountId: "catalog-source:APSPORT:FOOTBALL" }
    });
  });

  it("uses a newer DOM price without erasing socket-only APSPORT markets", () => {
    const adapter = new TsportWsCatalogAdapter();
    const socketCatalog = adapter.decode(envelope(event(2, "Socket Home")))[0]!.value as { markets: unknown[] };
    expect(socketCatalog.markets).toHaveLength(4);
    const partialDom = [{ eventId: "2", leagueName: "League", timeText: "LIVE", scoreText: "0 - 0",
      teamNames: ["DOM Home", "Away 2"], markets: [{ marketId: "2-ah", marketType: "FT_AH",
        lineText: "-0.5", selections: [
          { selectionId: "2-home", selection: "HOME", priceText: "0.1", locked: false, lineText: "-0.5" },
          { selectionId: "2-away", selection: "AWAY", priceText: "0.1", locked: false, lineText: "+0.5" }
        ] }] }];
    const laterDom = { ...domEnvelope(partialDom, 2), observedAtMs: Date.UTC(2026, 7, 16, 3, 0, 1),
      receivedMonotonicMs: 80 };
    const merged = adapter.decode(laterDom)[0]!.value as { events: Array<{ participantA: string }>;
      markets: unknown[]; quotes: Array<{ providerMarketId: string; rawOdds: string }> };
    expect(merged.markets).toHaveLength(4);
    expect(merged.events[0]).toMatchObject({ participantA: "DOM Home" });
    expect(merged.quotes.filter((quote) => quote.providerMarketId === "2-ah"))
      .toEqual([expect.objectContaining({ rawOdds: "0.1" }), expect.objectContaining({ rawOdds: "0.1" })]);
    expect(merged.quotes.some((quote) => quote.providerMarketId === "2-total")).toBe(true);
  });

  it("atomically replaces an older DOM generation and removes its obsolete selection IDs", () => {
    const adapter = new TsportWsCatalogAdapter();
    const record = (eventId: string, selectionSuffix: string, priceText: string) => [{
      eventId, leagueName: "League", timeText: "LIVE", scoreText: "0 - 0",
      teamNames: [`Home ${eventId}`, `Away ${eventId}`], markets: [{ marketId: `${eventId}-ah-${selectionSuffix}`,
        marketType: "FT_AH", lineText: "-0.5", selections: [
          { selectionId: `${eventId}-home-${selectionSuffix}`, selection: "HOME", priceText,
            locked: false, lineText: "-0.5" },
          { selectionId: `${eventId}-away-${selectionSuffix}`, selection: "AWAY", priceText,
            locked: false, lineText: "+0.5" }
        ] }]
    }];

    adapter.decode(domEnvelope(record("old-event", "old", "0.1"), 10));
    const latest = adapter.decode({ ...domEnvelope(record("new-event", "new", "0.2"), 11),
      observedAtMs: Date.UTC(2026, 7, 16, 3, 0, 1), receivedMonotonicMs: 80 })[0]!.value as {
        quotes: Array<{ providerSelectionId: string; rawOdds: string }>;
      };

    expect(latest.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "new-event-home-new", rawOdds: "0.2" }),
      expect.objectContaining({ providerSelectionId: "new-event-away-new", rawOdds: "0.2" })
    ]));
    expect(latest.quotes.some(({ providerSelectionId }) => providerSelectionId.startsWith("old-event-"))).toBe(false);
  });

  it("invalidates APSPORT immediately when its active socket closes", () => {
    const adapter = new TsportWsCatalogAdapter();
    const closed: ChromeBridgeEnvelope = { ...envelope(event(1, "Home")), transport: "WS_STATE",
      payload: { encoding: "UTF8", body: JSON.stringify({ state: "CLOSED" }) } };
    expect(adapter.fingerprint(closed)).toBe(true);
    expect(adapter.decode(closed)).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:APSPORT:FOOTBALL", reason: "PROVIDER_STREAM_CLOSED"
    })]);
  });

  it("rejects other sports, hosts and non-event frames", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.fingerprint({ ...envelope(event(1, "Home")),
      request: { hostname: "evil.example", pathnameClass: "/ln/en/p/1/u/x/s/1/mg/0/tr/0", resourceType: "WebSocket" }
    })).toBe(false);
    expect(adapter.fingerprint({ ...envelope(event(1, "Home")),
      payload: { encoding: "UTF8", body: JSON.stringify({ s: 2, t: "eu", d: "{}" }) }
    })).toBe(false);
  });
});
