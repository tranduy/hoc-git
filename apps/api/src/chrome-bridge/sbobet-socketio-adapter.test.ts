import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import { SbobetSocketIoCatalogAdapter } from "./sbobet-socketio-adapter.js";

function frame(rows: readonly unknown[], sequence: number, revision: unknown,
  lobby: ChromeLobbyId = "KSPORT", streamId = "sbo-1"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby, sourceId: `chrome:${lobby}:8`, tabId: 8,
    sequence, observedAtMs: Date.UTC(2026, 7, 21, 13), receivedMonotonicMs: sequence,
    transport: "WS_FRAME", sourceEpoch: "epoch-1",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/", resourceType: "WebSocket", streamId },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b52", rows, revision])}` }
  };
}

const fields = ["matchid", "sporttype", "hteamnameen", "ateamnameen", "kickofftime", "leagueid",
  "leaguenameen", "liveperiod", "oddsid", "bettype", "hdp1", "hdp2", "odds1a", "odds2a", "oddsstatus"];

function baseline(price = "0.91"): readonly unknown[] {
  return [
    ["c", "c2"],
    ["f", 1, fields],
    [0, "m", 1, 9001, 2, 1, 3, "Alpha", 4, "Beta", 5, 1787328000, 6, 77, 7, "League", 8, 0],
    [0, "o", 9, 7001, 1, 9001, 10, 1, 11, 0.25, 12, 0, 13, price, 14, "-0.97", 15, "running"]
  ];
}

describe("SbobetSocketIoCatalogAdapter", () => {
  it("replays the dynamic per-channel schema and publishes exact opposing handicap selections", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const update = adapter.decode(frame(baseline(), 1, 10))[0]!;
    const catalog = update.value as { events: Array<{ providerEventId: string }>;
      markets: Array<{ providerMarketId: string; line: string; scope: string }>;
      quotes: Array<{ providerSelectionId: string; selection: string; rawOdds: string }> };

    expect(catalog.events).toEqual(expect.arrayContaining([expect.objectContaining({ providerEventId: "9001" })]));
    expect(catalog.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "7001", line: "-0.25", scope: "FULL_TIME" })
    ]));
    expect(catalog.quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerSelectionId: "7001:HOME", selection: "HOME", rawOdds: "0.91" }),
      expect.objectContaining({ providerSelectionId: "7001:AWAY", selection: "AWAY", rawOdds: "-0.97" })
    ]));
  });

  it("merges partial odds deltas and rejects duplicate or older provider revisions", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline("0.80"), 1, 10));
    const changed = adapter.decode(frame([[0, "o", 9, 7001, 13, "0.96"]], 2, 11))[0]!.value as {
      quotes: Array<{ selection: string; rawOdds: string }> };
    expect(changed.quotes.find((quote) => quote.selection === "HOME")?.rawOdds).toBe("0.96");
    expect(adapter.decode(frame([[0, "o", 9, 7001, 13, "0.70"]], 3, 10))).toEqual([]);
  });

  it.each([null, "", true, undefined])("rejects invalid provider revision %j without changing retained prices", (revision) => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10));
    const invalid = frame([[0, "o", 9, 7001, 13, "0.70"]], 2, revision);
    const input = revision === undefined ? { ...invalid,
      payload: { encoding: "UTF8" as const, body: `42${JSON.stringify(["m", "b52", [[0, "o", 9, 7001, 13, "0.70"]]])}` }
    } : invalid;

    expect(adapter.decode(input)).toEqual([]);
    const catalog = adapter.decode(frame([[0, "o", 9, 7001, 14, "-0.80"]], 3, 11))[0]!.value as {
      quotes: Array<{ providerSelectionId: string; rawOdds: string }>;
    };
    expect(catalog.quotes).toContainEqual(expect.objectContaining({ providerSelectionId: "7001:HOME", rawOdds: "0.91" }));
  });

  it("does not retire the active stream for a replacement with an invalid revision", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10, "KSPORT", "1"));
    expect(adapter.decode(frame(baseline("0.70"), 2, null, "KSPORT", "2"))).toEqual([]);

    const catalog = adapter.decode(frame([[0, "o", 9, 7001, 14, "-0.80"]], 3, 11, "KSPORT", "1"))[0]!.value as {
      quotes: Array<{ providerSelectionId: string; rawOdds: string }>;
    };
    expect(catalog.quotes).toContainEqual(expect.objectContaining({ providerSelectionId: "7001:HOME", rawOdds: "0.91" }));
  });

  it("removes every retained native market when its authoritative event is deleted", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10));

    const removed = adapter.decode(frame([[0, "-m", 1, 9001]], 2, 11))[0]!.value as {
      events: unknown[];
      markets: unknown[];
      quotes: unknown[];
      nativeMarketObservations?: unknown[];
    };

    expect(removed.events).toEqual([]);
    expect(removed.markets).toEqual([]);
    expect(removed.quotes).toEqual([]);
    expect(removed.nativeMarketObservations ?? []).toEqual([]);
  });

  it("keeps schemas isolated by provider channel", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10));
    const unrelated = [["c", "c7"], ["f", 1, ["streamingid", "matchid"]], [0, "o", 1, 7001, 2, 9001]];
    expect(adapter.decode(frame(unrelated, 2, 11))).toEqual([]);
  });

  it("does not mistake the Volta root socket for the SBO sportsbook", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const input = frame(baseline(), 1, 10);
    expect(adapter.fingerprint({ ...input, request: { ...input.request, pathnameClass: "/" },
      payload: { encoding: "BASE64", body: "e30=" } })).toBe(false);
  });

  it("supports the sportsbook iframe classified as the SBO lobby", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("SBO");
    expect(adapter.decode(frame(baseline(), 1, 10, "SBO"))).toHaveLength(1);
  });

  it("keeps exact corner pseudo-events and accounts for unsupported native bet types", () => {
    const rows = [
      ["c", "c2"], ["f", 1, fields],
      [0, "m", 1, 9100, 2, 1, 3, "Alpha No. of Corners", 4, "Beta No. of Corners",
        5, 1787328000, 6, 77, 7, "League - Corners", 8, 0],
      [0, "o", 9, 7100, 1, 9100, 10, 3, 11, 9.5, 12, 0, 13, "0.81", 14, "-0.91", 15, "running"],
      [0, "o", 9, 7199, 1, 9100, 10, 321, 11, 0, 12, 0, 13, "0.71", 14, "-0.81", 15, "running"]
    ];
    const catalog = new SbobetSocketIoCatalogAdapter("KSPORT").decode(frame(rows, 1, 10))[0]!.value as {
      events: Array<{ participantA: string; participantB: string }>;
      markets: Array<{ marketType: string; line: string }>;
      nativeMarketObservations: Array<{ nativeType: string; disposition: string }>;
    };

    expect(catalog.events).toEqual([expect.objectContaining({ participantA: "Alpha", participantB: "Beta" })]);
    expect(catalog.markets).toEqual([expect.objectContaining({ marketType: "CORNER_FT_TOTAL", line: "9.5" })]);
    expect(catalog.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ nativeType: "3", disposition: "NORMALIZED" }),
      expect.objectContaining({ nativeType: "321", disposition: "UNMAPPED" })
    ]));
  });

  it("uses provider English identity fields to classify a localized card pseudo-event", () => {
    const bilingualFields = ["matchid", "sporttype", "hteamnamevn", "ateamnamevn", "hteamnameen",
      "ateamnameen", "kickofftime", "leagueid", "leaguenamevn", "leaguenameen", "liveperiod",
      "oddsid", "bettype", "hdp1", "hdp2", "odds1a", "odds2a", "oddsstatus"];
    const rows = [
      ["c", "c2"], ["f", 1, bilingualFields],
      [0, "m", 1, 9200, 2, 1, 3, "Alpha Tổng thẻ", 4, "Beta Tổng thẻ",
        5, "Alpha Total Bookings", 6, "Beta Total Bookings", 7, 1787328000, 8, 77,
        9, "Giải đấu - Thẻ", 10, "League - Bookings", 11, 0],
      [0, "o", 12, 7200, 1, 9200, 13, 3, 14, 2.5, 15, 0,
        16, "0.81", 17, "-0.91", 18, "running"]
    ];

    const catalog = new SbobetSocketIoCatalogAdapter("KSPORT").decode(frame(rows, 1, 10))[0]!.value as {
      events: Array<{ competition: string; participantA: string; participantB: string }>;
      markets: Array<{ marketType: string }>;
    };

    expect(catalog.events).toEqual([expect.objectContaining({ competition: "League - Bookings",
      participantA: "Alpha", participantB: "Beta" })]);
    expect(catalog.markets).toEqual([expect.objectContaining({ marketType: "CARD_FT_TOTAL" })]);
  });

  it("does not label a malformed native price as normalized inventory", () => {
    const catalog = new SbobetSocketIoCatalogAdapter("KSPORT")
      .decode(frame(baseline("0"), 1, 10))[0]!.value as {
        nativeMarketObservations: Array<{ providerMarketId: string; disposition: string; reason: string }>;
      };

    expect(catalog.nativeMarketObservations).toEqual([
      expect.objectContaining({ providerMarketId: "7001", disposition: "EXCLUDED",
        reason: "INVALID_TWO_WAY_SHAPE" })
    ]);
  });

  it("retains a native zero handicap when a line delta replaces the previous line", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10));
    const catalog = adapter.decode(frame([[0, "o", 9, 7001, 11, 0]], 2, 11))[0]!.value as {
      markets: Array<{ providerMarketId: string; line: string }>;
      quotes: Array<{ providerSelectionId: string; line: string }>;
    };

    expect(catalog.markets).toEqual([expect.objectContaining({ providerMarketId: "7001", line: "0" })]);
    expect(catalog.quotes).toEqual([
      expect.objectContaining({ providerSelectionId: "7001:HOME", line: "0" }),
      expect.objectContaining({ providerSelectionId: "7001:AWAY", line: "0" })
    ]);
  });

  it.each([null, "", true, "not-a-line"])("does not invent a valid total from invalid native line %j", (line) => {
    const rows = [...baseline(), [0, "o", 9, 7001, 10, 3, 11, line]];
    const catalog = new SbobetSocketIoCatalogAdapter("KSPORT").decode(frame(rows, 1, 10))[0]!.value as {
      markets: unknown[];
      nativeMarketObservations: Array<{ disposition: string }>;
    };

    expect(catalog.markets).toEqual([]);
    expect(catalog.nativeMarketObservations).toEqual([expect.objectContaining({ disposition: "EXCLUDED" })]);
  });

  it.each([
    ["eSoccer Battle", 1787328000, 0.25],
    ["League", undefined, 0.25],
    ["League", 1787328000, 0.3]
  ])("accounts for native rows rejected during normalization (%s, %s, %s)", (league, kickoff, line) => {
    const rows = [...baseline(), [0, "m", 1, 9001, 7, league, 5, kickoff],
      [0, "o", 9, 7001, 11, line]];
    const catalog = new SbobetSocketIoCatalogAdapter("KSPORT").decode(frame(rows, 1, 10))[0]!.value as {
      markets: unknown[];
      nativeMarketObservations: Array<{ providerMarketId: string; disposition: string }>;
    };

    expect(catalog.markets).toEqual([]);
    expect(catalog.nativeMarketObservations).toEqual([
      expect.objectContaining({ providerMarketId: "7001", disposition: "EXCLUDED" })
    ]);
  });

  it("keeps retained quote and native receipt clocks when a hidden market is discovered or updated", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const initial = frame(baseline(), 1, 10);
    adapter.decode(initial);
    const hidden = frame([
      [0, "m", 1, 9100, 2, 1, 3, "Alpha No. of Corners", 4, "Beta No. of Corners",
        5, 1787328000, 6, 77, 7, "League - Corners", 8, 0],
      [0, "o", 9, 7100, 1, 9100, 10, 3, 11, 9.5, 12, 0, 13, "0.81", 14, "-0.91", 15, "running"]
    ], 2, 11);
    adapter.decode({ ...hidden, observedAtMs: initial.observedAtMs + 3_000 });
    const delta = frame([[0, "o", 9, 7100, 11, 10.5, 13, "0.92", 15, "suspended"]], 3, 12);
    const catalog = adapter.decode({ ...delta, observedAtMs: initial.observedAtMs + 6_000 })[0]!.value as {
      markets: Array<{ providerMarketId: string; marketType: string; line: string; status: string }>;
      quotes: Array<{ providerMarketId: string; providerSelectionId: string; rawOdds: string;
        line: string; status: string; sequence: number; receivedMonotonicMs: number }>;
      nativeMarketObservations: Array<{ providerMarketId: string; observedAtMs: number }>;
    };

    expect(catalog.markets).toContainEqual(expect.objectContaining({ providerMarketId: "7100",
      marketType: "CORNER_FT_TOTAL", line: "10.5", status: "SUSPENDED" }));
    expect(catalog.quotes.filter((quote) => quote.providerMarketId === "7100")).toEqual([
      expect.objectContaining({ providerSelectionId: "7100:OVER", rawOdds: "0.92", line: "10.5",
        status: "SUSPENDED", sequence: 3, receivedMonotonicMs: 3 }),
      expect.objectContaining({ providerSelectionId: "7100:UNDER", rawOdds: "-0.91", line: "10.5",
        status: "SUSPENDED", sequence: 3, receivedMonotonicMs: 3 })
    ]);
    expect(catalog.quotes.filter((quote) => quote.providerMarketId === "7001")).toEqual([
      expect.objectContaining({ providerSelectionId: "7001:HOME", sequence: 1, receivedMonotonicMs: 1 }),
      expect.objectContaining({ providerSelectionId: "7001:AWAY", sequence: 1, receivedMonotonicMs: 1 })
    ]);
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "7001", observedAtMs: initial.observedAtMs
    }));
  });

  it("does not republish unchanged rows while advancing the provider revision fence", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 1, 10));

    expect(adapter.decode(frame([[0, "o", 9, 7001, 13, "0.91"]], 2, 12))).toEqual([]);
    expect(adapter.decode(frame([[0, "o", 9, 7001, 13, "0.80"]], 3, 11))).toEqual([]);
    const catalog = adapter.decode(frame([[0, "o", 9, 7001, 13, "0.95"]], 4, 13))[0]!.value as {
      quotes: Array<{ providerSelectionId: string; rawOdds: string }>;
    };
    expect(catalog.quotes).toContainEqual(expect.objectContaining({
      providerSelectionId: "7001:HOME", rawOdds: "0.95"
    }));
  });

  it("resets schemas, rows and revision cursors when a new source epoch reuses a stream id", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    adapter.decode(frame(baseline(), 20, 100));
    const replacement = frame([
      ["c", "c2"], ["f", 1, fields],
      [0, "m", 1, 9200, 2, 1, 3, "Gamma", 4, "Delta", 5, 1787328000, 6, 77, 7, "League", 8, 0],
      [0, "o", 9, 7200, 1, 9200, 10, 3, 11, 2.5, 12, 0, 13, "0.81", 14, "-0.91", 15, "running"]
    ], 1, 1);
    const updates = adapter.decode({ ...replacement, sourceEpoch: "epoch-2" });
    expect(updates).toHaveLength(1);
    const catalog = updates[0]!.value as { events: Array<{ providerEventId: string }> };
    expect(catalog.events).toEqual([expect.objectContaining({ providerEventId: "9200" })]);
    expect(adapter.decode(frame(baseline("0.70"), 21, 101))).toEqual([]);
  });

  it.each(["sbo-1", "1"])("rejects a retired stream %s after a replacement publishes", (oldStream) => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const newStream = oldStream === "1" ? "2" : "sbo-2";
    adapter.decode(frame(baseline(), 1, 10, "KSPORT", oldStream));
    adapter.decode(frame(baseline("0.95"), 2, 1, "KSPORT", newStream));

    expect(adapter.decode(frame(baseline("0.70"), 3, 11, "KSPORT", oldStream))).toEqual([]);
  });

  it("rejects an unseen older numeric stream and a late frame from an older source epoch", () => {
    const adapter = new SbobetSocketIoCatalogAdapter("KSPORT");
    const current = frame(baseline("0.95"), 2, 10, "KSPORT", "2");
    adapter.decode({ ...current, sourceEpoch: "observer:2" });
    const oldStream = frame(baseline("0.70"), 3, 11, "KSPORT", "1");
    expect(adapter.decode({ ...oldStream, sourceEpoch: "observer:2" })).toEqual([]);
    const oldEpoch = frame(baseline("0.70"), 4, 12, "KSPORT", "3");
    expect(adapter.decode({ ...oldEpoch, sourceEpoch: "observer:1" })).toEqual([]);
  });
});
