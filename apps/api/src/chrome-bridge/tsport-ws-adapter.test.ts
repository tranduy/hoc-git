import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { TsportWsCatalogAdapter } from "./tsport-ws-adapter.js";

const SOURCE_ID = "chrome:TSPORT:7";
const DEFAULT_STREAM_ID = "tsport-stream-1";
const DEFAULT_SOURCE_EPOCH = "observer-a:1";

function envelope(
  event: unknown,
  sequence = 1,
  streamId = DEFAULT_STREAM_ID,
  sourceEpoch = DEFAULT_SOURCE_EPOCH
): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: SOURCE_ID, tabId: 7,
    sourceEpoch,
    sequence, observedAtMs: Date.UTC(2026, 7, 16, 3), receivedMonotonicMs: sequence * 10 + 40,
    transport: "WS_FRAME",
    request: { hostname: "spws.agenate.com", pathnameClass: "/ln/en/p/1/u/redacted/session-part/s/1/mg/0/tr/0",
      resourceType: "WebSocket", streamId },
    payload: { encoding: "UTF8", body: JSON.stringify({ s: 1, t: "eu", tmrg: "0", d: JSON.stringify(event) }) }
  };
}

function stateEnvelope(
  state: "OPEN" | "CLOSED",
  streamId = DEFAULT_STREAM_ID,
  sequence = 1,
  sourceEpoch = DEFAULT_SOURCE_EPOCH
): ChromeBridgeEnvelope {
  return {
    ...envelope({}, sequence, streamId, sourceEpoch),
    transport: "WS_STATE",
    payload: { encoding: "UTF8", body: JSON.stringify({ state }) }
  };
}

function domEnvelope(
  records: readonly unknown[],
  sequence = 1,
  chunkIndex = 0,
  chunkCount = 1,
  sweepMode: "COMPLETE" | "INCOMPLETE" | "ABSENT" = "COMPLETE",
  sourceEpoch = DEFAULT_SOURCE_EPOCH,
  snapshotKey = sequence.toString().padStart(8, "0"),
  sweepKey = snapshotKey
): ChromeBridgeEnvelope {
  const sweep = sweepMode === "ABSENT" ? {} : {
    sweepId: `tsport-sweep-${sweepKey}`,
    sweepComplete: sweepMode === "COMPLETE",
    sweepFrameKey: "tsport-football-frame",
    sweepDocumentKey: `${sourceEpoch}:tsport-football-frame:document-1`
  };
  return {
    version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: SOURCE_ID, tabId: 7,
    sourceEpoch,
    sequence, observedAtMs: Date.UTC(2026, 7, 16, 3), receivedMonotonicMs: sequence * 10 + 40,
    transport: "DOM_SNAPSHOT",
    request: { hostname: "pacific.agenate.com", pathnameClass: "/__fieldline_dom_snapshot__",
      resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
      snapshotId: `tsport-dom-${snapshotKey}-baseline`,
      chunkIndex, chunkCount, records, ...sweep }) }
  };
}

function expectedRecord(id: number, firstPrice = "0.11", secondPrice = "-0.22") {
  return {
    eventId: String(id), sportId: "1", leagueName: "DOM League", timeText: "LIVE", scoreText: "0 - 0",
    teamNames: ["DOM Home " + id, "DOM Away " + id], markets: [{
      marketId: id + "-total", marketType: "FT_TOTAL", lineText: "2.5", selections: [
        { selectionId: id + "-over", selection: "OVER", priceText: firstPrice, locked: false },
        { selectionId: id + "-under", selection: "UNDER", priceText: secondPrice, locked: false }
      ]
    }]
  };
}

const event = (id: number, home: string, firstPrice = "0.83", secondPrice = "-0.91") => ({
  "2": id, "5": home, "10": "Active", "11": "2026-08-16T02:00:00Z", "19": 1_399_000,
  "22": "Away " + id, "25": 1, "26": 2, "53": "League",
  "50": [
    { "3": 3, "9": [{ "0": id + "-over", "2": id + "-under", "6": id + "-total", "7": "2.5",
      "8": { "2": firstPrice }, "9": { "2": secondPrice } }], "10": "Active" },
    { "3": 4, "9": [{ "0": id + "-fh-over", "2": id + "-fh-under", "6": id + "-fh-total", "7": "1.75",
      "8": { "2": firstPrice }, "9": { "2": secondPrice } }], "10": "Active" },
    { "3": 5, "9": [{ "0": id + "-home", "2": id + "-away", "6": id + "-ah", "7": "-0.5",
      "8": { "2": firstPrice }, "9": { "2": secondPrice } }], "10": "Active" },
    { "3": 6, "9": [{ "0": id + "-fh-home", "2": id + "-fh-away", "6": id + "-fh-ah", "7": "-0.25",
      "8": { "2": firstPrice }, "9": { "2": secondPrice } }], "10": "Active" }
  ]
});

type AuthorityUpdate = {
  readonly authoritativeBaseline?: true;
  readonly evidenceMode?: "BASELINE" | "DELTA";
  readonly provenance?: "WS";
  readonly generation?: string;
  readonly value: {
    readonly accountId: string;
    readonly provider: string;
    readonly events: readonly unknown[];
    readonly markets: readonly unknown[];
    readonly quotes: ReadonlyArray<{
      readonly providerEventId: string;
      readonly providerMarketId: string;
      readonly rawOdds: string;
      readonly receivedMonotonicMs: number;
      readonly sequence: number | null;
    }>;
  };
};

function beginFreshStream(
  adapter: TsportWsCatalogAdapter,
  expectedIds: readonly number[],
  streamId = DEFAULT_STREAM_ID,
  sequence = 1,
  sourceEpoch = DEFAULT_SOURCE_EPOCH
): void {
  adapter.decode(domEnvelope(expectedIds.map((id) => expectedRecord(id)), sequence, 0, 1, "COMPLETE", sourceEpoch));
  adapter.decode(stateEnvelope("OPEN", streamId, sequence + 1, sourceEpoch));
}

describe("TsportWsCatalogAdapter", () => {
  it("does not publish a complete DOM capture as an authoritative catalog", () => {
    const adapter = new TsportWsCatalogAdapter();

    expect(adapter.decode(domEnvelope([expectedRecord(1)]))).toEqual([]);
  });

  it("withholds a baseline while fresh WS coverage is missing one expected event", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1, 2]);

    expect(adapter.decode(envelope(event(1, "WS Home 1"), 3))).toEqual([]);
  });

  it("emits exactly one WS baseline on the final covering frame", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1, 2]);
    expect(adapter.decode(envelope(event(1, "WS Home 1"), 3))).toEqual([]);

    const updates = adapter.decode(envelope(event(2, "WS Home 2"), 4)) as readonly AuthorityUpdate[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      generation: expect.any(String),
      value: {
        accountId: "catalog-source:APSPORT:FOOTBALL",
        provider: "APSPORT",
        events: expect.any(Array),
        markets: expect.any(Array),
        quotes: expect.any(Array)
      }
    });
  });

  it("bootstraps the current s/1 generation when capture has no WS_STATE OPEN", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1)], 1));

    const updates = adapter.decode(envelope(event(1, "WS Home 1"), 2)) as readonly AuthorityUpdate[];

    expect(updates).toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      generation: expect.any(String)
    })]);
  });

  it("does not require WS coverage for a complete DOM event with zero supported markets", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([
      expectedRecord(1),
      { ...expectedRecord(2), markets: [] }
    ], 1));
    adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 2));

    const updates = adapter.decode(envelope(event(1, "WS Home 1"), 3)) as readonly AuthorityUpdate[];

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      value: {
        events: [expect.objectContaining({ providerEventId: "1" })],
        markets: expect.any(Array),
        quotes: expect.arrayContaining([expect.objectContaining({ providerEventId: "1" })])
      }
    });
  });

  it("excludes a DOM-visible virtual event from fresh WS coverage", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([
      expectedRecord(1),
      { ...expectedRecord(2), leagueName: "E Soccer Synthetic League",
        teamNames: ["Arsenal (player_one)", "Chelsea (player_two)"] }
    ], 1));
    adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 2));
    const virtual = {
      ...event(2, "Arsenal (player_one)"),
      "22": "Chelsea (player_two)",
      "53": "E Soccer Synthetic League"
    };

    expect(adapter.decode(envelope(virtual, 3))).toEqual([]);
    const updates = adapter.decode(envelope(event(1, "Real Home"), 4)) as readonly AuthorityUpdate[];

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      value: {
        events: [expect.objectContaining({ providerEventId: "1" })],
        markets: expect.arrayContaining([expect.objectContaining({ providerEventId: "1" })]),
        quotes: expect.arrayContaining([expect.objectContaining({ providerEventId: "1" })])
      }
    });
    expect(updates[0]!.value.events).toHaveLength(1);
    expect(updates[0]!.value.markets.every((market) =>
      (market as { readonly providerEventId?: string }).providerEventId === "1")).toBe(true);
    expect(updates[0]!.value.quotes.every((quote) => quote.providerEventId === "1")).toBe(true);
  });

  it("does not require s/1 coverage for sport 97 or a DOM event marked by a (V) team", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([
      expectedRecord(1),
      { ...expectedRecord(97), sportId: 97, leagueName: "Synthetic League",
        teamNames: ["Synthetic Home", "Synthetic Away"] },
      { ...expectedRecord(98), leagueName: "Synthetic League",
        teamNames: ["Chelsea (V)", "Napoli"] },
      { ...expectedRecord(99), sportId: undefined, leagueName: "UTR Pro Tennis Series Women",
        teamNames: ["Player One", "Player Two"] },
      { ...expectedRecord(100), sportId: undefined, leagueName: "International UPVL Nations League W",
        teamNames: ["Spain Pro W", "USA Pro W"] }
    ], 1));
    adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 2));

    const updates = adapter.decode(envelope(event(1, "Real Home"), 3)) as readonly AuthorityUpdate[];

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      value: { events: [expect.objectContaining({ providerEventId: "1" })] }
    });
  });

  it("does not let an s/1 virtual frame block an explicit empty real-football baseline", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([{
      ...expectedRecord(97), sportId: 97, leagueName: "GS Club Friendlies (Virtual)",
      teamNames: ["Chelsea (V)", "Napoli (V)"]
    }], 1));
    const virtual = { ...event(97, "Chelsea (V)"), "22": "Napoli (V)",
      "53": "E Soccer Battle 8 mins" };

    const updates = adapter.decode(envelope(virtual, 2)) as readonly AuthorityUpdate[];

    expect(updates).toEqual([expect.objectContaining({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      value: expect.objectContaining({ events: [], markets: [], quotes: [] })
    })]);
  });

  it("does not turn an all-zero-market DOM sweep into authoritative empty authority", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([{ ...expectedRecord(1), markets: [] }], 1));

    expect(adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 2))).toEqual([]);
    expect(adapter.decode(envelope(event(99, "Unproven Home"), 3))).toEqual([]);
  });

  it("uses only fresh WS quote values in the baseline when DOM prices differ", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1, "0.11", "-0.22"), expectedRecord(2, "0.12", "-0.23")]));
    adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 2));
    adapter.decode(envelope(event(1, "WS Home 1"), 3));

    const baseline = adapter.decode(envelope(event(2, "WS Home 2"), 4))[0] as AuthorityUpdate;
    expect([...new Set(baseline.value.quotes.map(({ rawOdds }) => rawOdds))].sort())
      .toEqual(["-0.91", "0.83"]);
  });

  it("emits later current-stream changes as same-generation deltas", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1, 2]);
    adapter.decode(envelope(event(1, "WS Home 1"), 3));
    const baseline = adapter.decode(envelope(event(2, "WS Home 2"), 4))[0] as AuthorityUpdate;

    const delta = adapter.decode(envelope(event(2, "WS Home 2", "0.44", "-0.55"), 5))[0] as AuthorityUpdate;
    expect(delta).toMatchObject({
      evidenceMode: "DELTA",
      provenance: "WS",
      generation: baseline.generation
    });
    expect(delta.authoritativeBaseline).toBeUndefined();
    expect(delta.value.events).toHaveLength(2);
    expect(delta.value.quotes.filter(({ providerEventId }) => providerEventId === "1"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 70, sequence: 3 })]));
    expect(delta.value.quotes.filter(({ providerEventId }) => providerEventId === "2"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rawOdds: "0.44", receivedMonotonicMs: 90, sequence: 5 }),
        expect.objectContaining({ rawOdds: "-0.55", receivedMonotonicMs: 90, sequence: 5 })
      ]));
  });

  it("refreshes a complete authoritative baseline before the 30 second feed SLA", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1]);
    const baseline = adapter.decode(envelope(event(1, "WS Home 1"), 3))[0] as AuthorityUpdate;
    const later = envelope(event(1, "WS Home 1", "0.44", "-0.55"), 4);

    const refreshed = adapter.decode({ ...later, observedAtMs: later.observedAtMs + 20_000 })[0] as AuthorityUpdate;

    expect(refreshed).toMatchObject({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      generation: baseline.generation
    });
  });

  it("starts a new stream with empty coverage and a new generation", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1, 2], "stream-a");
    adapter.decode(envelope(event(1, "A Home 1"), 3, "stream-a"));
    const first = adapter.decode(envelope(event(2, "A Home 2"), 4, "stream-a"))[0] as AuthorityUpdate;

    expect(adapter.decode(stateEnvelope("OPEN", "stream-b", 5))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:APSPORT:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
    expect(adapter.decode(envelope(event(2, "B Home 2"), 6, "stream-b"))).toEqual([]);
    const second = adapter.decode(envelope(event(1, "B Home 1"), 7, "stream-b"))[0] as AuthorityUpdate;
    expect(second).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS" });
    expect(second.generation).not.toBe(first.generation);
  });

  it("does not reset an authoritative generation on a duplicate OPEN", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1, 2]);
    adapter.decode(envelope(event(1, "WS Home 1"), 3));
    const baseline = adapter.decode(envelope(event(2, "WS Home 2"), 4))[0] as AuthorityUpdate;

    expect(adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 5))).toEqual([]);
    const updates = adapter.decode(
      envelope(event(2, "WS Home 2", "0.44", "-0.55"), 6)
    ) as readonly AuthorityUpdate[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      evidenceMode: "DELTA",
      generation: baseline.generation,
      provenance: "WS"
    });
  });

  it("retains a fresh OPEN until its complete DOM proof arrives", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.decode(stateEnvelope("OPEN", "proof-race", 1))).toEqual([]);
    expect(adapter.decode(domEnvelope([expectedRecord(1)], 2))).toEqual([]);

    expect(adapter.decode(envelope(event(1, "Recovered Home"), 3, "proof-race")))
      .toEqual([expect.objectContaining({
        authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
      })]);
  });

  it("publishes buffered current-stream coverage when the DOM proof completes", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.decode(stateEnvelope("OPEN", "proof-race", 1))).toEqual([]);
    expect(adapter.decode(envelope(event(1, "Recovered Home"), 2, "proof-race"))).toEqual([]);

    expect(adapter.decode(domEnvelope([expectedRecord(1)], 3)))
      .toEqual([expect.objectContaining({
        authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
      })]);
  });

  it("does not let a replayed frame satisfy a pending stream's fresh coverage", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.decode(stateEnvelope("OPEN", "proof-race", 1))).toEqual([]);
    const replayed = envelope(event(1, "Retired Home"), 2, "proof-race");
    expect(adapter.decode({ ...replayed, request: { ...replayed.request, replayed: true } })).toEqual([]);
    expect(adapter.decode(domEnvelope([expectedRecord(1)], 3))).toEqual([]);

    expect(adapter.decode(envelope(event(1, "Fresh Home"), 4, "proof-race")))
      .toEqual([expect.objectContaining({
        authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
      })]);
  });

  it("drops pre-proof records outside the completed DOM coverage set", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(stateEnvelope("OPEN", "proof-race", 1));
    adapter.decode(envelope(event(1, "Current Home"), 2, "proof-race"));
    adapter.decode(envelope(event(2, "Retired Home"), 3, "proof-race"));

    const baseline = adapter.decode(domEnvelope([expectedRecord(1)], 4))[0] as AuthorityUpdate;
    expect(baseline.value.events).toEqual([expect.objectContaining({ providerEventId: "1" })]);
    expect(baseline.value.markets.every((market) =>
      (market as { readonly providerEventId?: string }).providerEventId === "1")).toBe(true);
    expect(baseline.value.quotes.every((quote) => quote.providerEventId === "1")).toBe(true);
  });

  it("rebuilds an overflowed pending generation without retaining its stream identity", () => {
    const adapter = new TsportWsCatalogAdapter();
    const streamId = "proof-overflow";
    adapter.decode(stateEnvelope("OPEN", streamId, 1));
    for (let eventId = 1; eventId <= 5_001; eventId += 1) {
      expect(adapter.decode(envelope(event(eventId, `Home ${eventId}`), eventId + 1, streamId)))
        .toEqual([]);
    }

    expect(adapter.decode(domEnvelope([expectedRecord(1)], 5_003))).toEqual([]);
    expect(adapter.decode(envelope(event(1, "Recovered After Overflow"), 5_004, streamId)))
      .toEqual([expect.objectContaining({
        authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
      })]);
    expect(adapter.decode(stateEnvelope("OPEN", streamId, 5_005))).toEqual([]);
  });

  it("invalidates existing authority when a replacement OPEN races an incomplete DOM proof", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1], "stream-a");
    adapter.decode(envelope(event(1, "Current Home"), 3, "stream-a"));
    adapter.decode(domEnvelope([expectedRecord(2)], 4, 0, 1, "INCOMPLETE",
      DEFAULT_SOURCE_EPOCH, "replacement-part", "replacement-sweep"));

    expect(adapter.decode(stateEnvelope("OPEN", "stream-b", 5))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:APSPORT:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
    expect(adapter.decode(envelope(event(1, "Retired Home", "0.44", "-0.55"), 6, "stream-a")))
      .toEqual([]);
  });

  it("does not let a delayed older OPEN retire the current stream", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1)], 1));
    adapter.decode(stateEnvelope("OPEN", "current-stream", 5));

    expect(adapter.decode(stateEnvelope("OPEN", "delayed-stream", 4))).toEqual([]);
    const updates = adapter.decode(
      envelope(event(1, "Current Home"), 6, "current-stream")
    ) as readonly AuthorityUpdate[];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE" });
  });

  it("ignores retired stream frames before and after current generation promotion", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1, 2], "stream-a");
    adapter.decode(envelope(event(1, "A Home 1"), 3, "stream-a"));
    expect(adapter.decode(stateEnvelope("OPEN", "stream-b", 4))).toEqual([]);

    expect(adapter.decode(envelope(event(2, "Stale Home 2"), 5, "stream-a"))).toEqual([]);
    expect(adapter.decode(envelope(event(1, "B Home 1"), 6, "stream-b"))).toEqual([]);
    adapter.decode(envelope(event(2, "B Home 2"), 7, "stream-b"));
    expect(adapter.decode(envelope(event(1, "Stale Home 1", "0.01", "-0.02"), 8, "stream-a"))).toEqual([]);

    const current = adapter.decode(
      envelope(event(2, "B Home 2", "0.44", "-0.55"), 9, "stream-b")
    )[0] as AuthorityUpdate;
    expect(current.value.quotes.some(({ rawOdds }) => rawOdds === "0.01" || rawOdds === "-0.02")).toBe(false);
  });

  it("does not treat an absent or partial expected set as empty authority", () => {
    const adapter = new TsportWsCatalogAdapter();

    expect(adapter.decode(stateEnvelope("OPEN", "absent-set", 1))).toEqual([]);
    expect(adapter.decode(domEnvelope([], 2, 0, 2))).toEqual([]);
    expect(adapter.decode(stateEnvelope("OPEN", "partial-set", 3))).toEqual([]);
  });

  it("requires a bound complete DOM sweep before accepting expected event IDs", () => {
    const absent = new TsportWsCatalogAdapter();
    absent.decode(domEnvelope([expectedRecord(1)], 1, 0, 1, "ABSENT"));
    absent.decode(stateEnvelope("OPEN", "absent-proof", 2));
    expect(absent.decode(envelope(event(1, "Absent Proof"), 3, "absent-proof"))).toEqual([]);

    const incomplete = new TsportWsCatalogAdapter();
    incomplete.decode(domEnvelope([expectedRecord(1)], 1, 0, 1, "INCOMPLETE"));
    incomplete.decode(stateEnvelope("OPEN", "incomplete-proof", 2));
    expect(incomplete.decode(envelope(event(1, "Incomplete Proof"), 3, "incomplete-proof"))).toEqual([]);
  });

  it("invalidates complete DOM proof when an event markets field is malformed", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([{ ...expectedRecord(1), markets: "hidden" }], 1));
    adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 2));

    expect(adapter.decode(envelope(event(1, "Malformed Proof"), 3))).toEqual([]);
  });

  it("does not reuse same-epoch expected IDs after a malformed replacement DOM proof", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1], "stream-a");
    adapter.decode(envelope(event(1, "Current Home"), 3, "stream-a"));
    adapter.decode(domEnvelope([{ ...expectedRecord(1), markets: "hidden" }],
      4, 0, 1, "COMPLETE", DEFAULT_SOURCE_EPOCH, "malformed-replacement"));

    expect(adapter.decode(stateEnvelope("OPEN", "stream-b", 5))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:APSPORT:FOOTBALL",
      reason: "PROVIDER_STREAM_GAP"
    })]);
    expect(adapter.decode(envelope(event(1, "Stale Proof"), 6, "stream-b"))).toEqual([]);
  });

  it("requires WS coverage for IDs from every snapshot in one completed DOM sweep", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1)], 1, 0, 1, "INCOMPLETE",
      DEFAULT_SOURCE_EPOCH, "part-a", "shared"));
    adapter.decode(domEnvelope([expectedRecord(2)], 2, 0, 1, "COMPLETE",
      DEFAULT_SOURCE_EPOCH, "part-b", "shared"));
    adapter.decode(stateEnvelope("OPEN", "multi-snapshot-sweep", 3));

    expect(adapter.decode(envelope(event(2, "Second Snapshot"), 4, "multi-snapshot-sweep")))
      .toEqual([]);
    const baseline = adapter.decode(
      envelope(event(1, "First Snapshot"), 5, "multi-snapshot-sweep")
    ) as readonly AuthorityUpdate[];
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      provenance: "WS", value: { events: expect.arrayContaining([
        expect.objectContaining({ providerEventId: "1" }),
        expect.objectContaining({ providerEventId: "2" })
      ]) } });
  });

  it("keeps current WS delta continuity when a same-epoch DOM sweep is incomplete", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1]);
    const baseline = adapter.decode(envelope(event(1, "Current Home"), 3))[0] as AuthorityUpdate;

    expect(adapter.decode(domEnvelope([expectedRecord(2)], 4, 0, 1, "INCOMPLETE"))).toEqual([]);
    const delta = adapter.decode(
      envelope(event(1, "Current Home", "0.44", "-0.55"), 5)
    ) as readonly AuthorityUpdate[];
    expect(delta).toHaveLength(1);
    expect(delta[0]).toMatchObject({ evidenceMode: "DELTA", provenance: "WS",
      generation: baseline.generation });
  });

  it("does not let delayed chunks from a retired DOM sweep replace a newer sweep", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(9)], 1, 0, 2, "COMPLETE", DEFAULT_SOURCE_EPOCH, "old"));
    adapter.decode(domEnvelope([expectedRecord(1)], 2, 0, 2, "COMPLETE", DEFAULT_SOURCE_EPOCH, "new"));
    adapter.decode(domEnvelope([expectedRecord(10)], 3, 1, 2, "COMPLETE", DEFAULT_SOURCE_EPOCH, "old"));
    adapter.decode(domEnvelope([expectedRecord(2)], 4, 1, 2, "COMPLETE", DEFAULT_SOURCE_EPOCH, "new"));
    adapter.decode(stateEnvelope("OPEN", "interleaved-sweeps", 5));
    expect(adapter.decode(envelope(event(1, "Fresh One"), 6, "interleaved-sweeps"))).toEqual([]);

    const baseline = adapter.decode(envelope(event(2, "Fresh Two"), 7, "interleaved-sweeps"))[0] as AuthorityUpdate;
    expect(baseline).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS" });
  });

  it("accepts empty authority from an explicit complete empty set and fresh stream", () => {
    const adapter = new TsportWsCatalogAdapter();

    expect(adapter.decode(domEnvelope([], 1))).toEqual([]);
    const empty = adapter.decode(stateEnvelope("OPEN", "explicit-empty", 2)) as readonly AuthorityUpdate[];
    expect(empty).toHaveLength(1);
    expect(empty[0]).toMatchObject({
      authoritativeBaseline: true,
      evidenceMode: "BASELINE",
      provenance: "WS",
      generation: expect.any(String),
      value: { events: [], markets: [], quotes: [] }
    });
  });

  it("requires new DOM evidence and a new generation after a source reset", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1]);
    const first = adapter.decode(envelope(event(1, "First Home"), 3))[0] as AuthorityUpdate;

    adapter.resetSource(SOURCE_ID);
    expect(adapter.decode(envelope(event(1, "Stale Home"), 4))).toEqual([]);
    expect(adapter.decode(stateEnvelope("OPEN", DEFAULT_STREAM_ID, 5))).toEqual([]);

    const replacementStreamId = "tsport-stream-after-reset";
    beginFreshStream(adapter, [1], replacementStreamId, 6);
    const second = adapter.decode(envelope(event(1, "Second Home"), 8, replacementStreamId))[0] as AuthorityUpdate;
    expect(second.generation).not.toBe(first.generation);
  });

  it("does not reuse expected DOM evidence across source epochs", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1)], 1, 0, 1, "COMPLETE", "observer-a:1"));

    expect(adapter.decode(stateEnvelope("OPEN", "epoch-b-stream", 2, "observer-a:2"))).toEqual([]);
    expect(adapter.decode(envelope(event(1, "Wrong Epoch"), 3, "epoch-b-stream", "observer-a:2"))).toEqual([]);
  });

  it("does not authorize an older epoch OPEN after a newer incomplete DOM sweep starts", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1)], 1, 0, 1, "COMPLETE",
      "observer-a:1", "epoch-1-complete"));
    adapter.decode(domEnvelope([expectedRecord(1)], 2, 0, 1, "INCOMPLETE",
      "observer-a:2", "epoch-2-incomplete"));

    expect(adapter.decode(stateEnvelope("OPEN", "epoch-1-stale", 3, "observer-a:1"))).toEqual([]);
    expect(adapter.decode(envelope(event(1, "Stale Epoch"), 4, "epoch-1-stale", "observer-a:1")))
      .toEqual([]);
  });

  it("retains a strictly newer epoch OPEN until its matching DOM proof arrives", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(domEnvelope([expectedRecord(1)], 1, 0, 1, "COMPLETE",
      "observer-a:1", "epoch-1-complete"));
    expect(adapter.decode(stateEnvelope("OPEN", "epoch-2-current", 2, "observer-a:2"))).toEqual([]);
    expect(adapter.decode(envelope(event(1, "Current Epoch"), 3, "epoch-2-current", "observer-a:2")))
      .toEqual([]);

    expect(adapter.decode(domEnvelope([expectedRecord(1)], 4, 0, 1, "COMPLETE",
      "observer-a:2", "epoch-2-complete"))).toEqual([expect.objectContaining({
      authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS"
    })]);
  });

  it("does not let an OPEN from another source epoch retire the current generation", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1], "epoch-b-current", 1, "observer-a:2");
    const baseline = adapter.decode(
      envelope(event(1, "Current Epoch"), 3, "epoch-b-current", "observer-a:2")
    )[0] as AuthorityUpdate;

    expect(adapter.decode(stateEnvelope("OPEN", "stale-epoch-a", 4, "observer-a:1"))).toEqual([]);
    const delta = adapter.decode(
      envelope(event(1, "Current Epoch", "0.44", "-0.55"), 5, "epoch-b-current", "observer-a:2")
    )[0] as AuthorityUpdate;
    expect(delta).toMatchObject({ evidenceMode: "DELTA", generation: baseline.generation, provenance: "WS" });
  });

  it("does not let a lower canonical source epoch replace an authoritative generation", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1], "epoch-b-current", 1, "observer-a:2");
    const baseline = adapter.decode(
      envelope(event(1, "Current Epoch"), 3, "epoch-b-current", "observer-a:2")
    )[0] as AuthorityUpdate;

    adapter.decode(domEnvelope([expectedRecord(1)], 4, 0, 1, "COMPLETE", "observer-a:1", "rollback"));
    adapter.decode(stateEnvelope("OPEN", "epoch-a-stale", 5, "observer-a:1"));
    expect(adapter.decode(envelope(event(1, "Stale Epoch"), 6, "epoch-a-stale", "observer-a:1"))).toEqual([]);

    const delta = adapter.decode(
      envelope(event(1, "Current Epoch", "0.44", "-0.55"), 7, "epoch-b-current", "observer-a:2")
    )[0] as AuthorityUpdate;
    expect(delta).toMatchObject({ evidenceMode: "DELTA", generation: baseline.generation, provenance: "WS" });
  });

  it("fails closed instead of evicting source-lineage retirement evidence", () => {
    const adapter = new TsportWsCatalogAdapter();
    for (let index = 0; index < 16; index += 1) {
      adapter.decode(domEnvelope([expectedRecord(1)], index + 1, 0, 1, "COMPLETE",
        `observer-${index}:0`, `lineage-${index}`));
    }
    adapter.decode(stateEnvelope("OPEN", "lineage-current", 17, "observer-15:0"));
    const baseline = adapter.decode(
      envelope(event(1, "Current Lineage"), 18, "lineage-current", "observer-15:0")
    )[0] as AuthorityUpdate;

    adapter.decode(domEnvelope([expectedRecord(1)], 19, 0, 1, "COMPLETE",
      "observer-overflow:0", "lineage-overflow"));
    adapter.decode(stateEnvelope("OPEN", "lineage-overflow", 20, "observer-overflow:0"));
    expect(adapter.decode(
      envelope(event(1, "Overflow Lineage"), 21, "lineage-overflow", "observer-overflow:0")
    )).toEqual([]);

    const delta = adapter.decode(
      envelope(event(1, "Current Lineage", "0.33", "-0.44"), 22, "lineage-current", "observer-15:0")
    )[0] as AuthorityUpdate;
    expect(delta).toMatchObject({ evidenceMode: "DELTA", generation: baseline.generation, provenance: "WS" });
  });

  it("scopes generation identity to the source epoch and fresh stream", () => {
    const baseline = (sourceEpoch: string, streamId: string, sequence: number): AuthorityUpdate => {
      const adapter = new TsportWsCatalogAdapter();
      beginFreshStream(adapter, [1], streamId, sequence, sourceEpoch);
      return adapter.decode(envelope(event(1, "Fresh Home"), sequence + 2, streamId, sourceEpoch))[0] as AuthorityUpdate;
    };

    const generations = [
      baseline("observer-a:1", "stream-1", 1).generation,
      baseline("observer-a:2", "stream-1", 1).generation,
      baseline("observer-a:1", "stream-2", 11).generation
    ];
    expect(new Set(generations).size).toBe(3);
  });

  it("decodes provider-defined second-half, corner, and card groups without mixing their identities", () => {
    const expanded = event(5557171, "Expanded Home");
    const group = (code: number, id: string, line: string) => ({ "3": code, "9": [{
      "0": id + "-first", "2": id + "-second", "6": id, "7": line,
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
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [5557171]);
    const catalog = (adapter.decode(envelope(expanded, 3))[0] as AuthorityUpdate).value as {
      readonly markets: ReadonlyArray<{
        readonly marketType: string;
        readonly scope: string;
        readonly settlementProfile: string;
      }>;
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
    beginFreshStream(adapter, [5557169]);
    const input = envelope(event(5557169, "Current Home"), 3);
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
    beginFreshStream(adapter, [5557172]);
    const input = envelope(event(5557172, "Live Path Home"), 3);
    const livePath: ChromeBridgeEnvelope = {
      ...input,
      request: {
        ...input.request,
        pathnameClass: "/ln/en/p/1/u/opaque-user-token/s/1/mg/0/tr/0"
      }
    };

    expect(adapter.fingerprint(livePath)).toBe(true);
    expect(adapter.decode(livePath)[0]?.value).toMatchObject({
      accountId: "catalog-source:APSPORT:FOOTBALL", provider: "APSPORT"
    });
  });

  it("does not turn a nonempty expected set into authority when WS normalizes to empty", () => {
    const adapter = new TsportWsCatalogAdapter();
    const virtual = {
      ...event(5557173, "Arsenal (player_one)"),
      "22": "Chelsea (player_two)",
      "53": "E Soccer H2H GG League 8 Mins Play"
    };
    beginFreshStream(adapter, [5557173]);

    expect(adapter.decode(envelope(virtual, 3))).toEqual([]);
  });

  it("withholds a baseline when normalized WS output omits one expected event", () => {
    const adapter = new TsportWsCatalogAdapter();
    const virtual = {
      ...event(2, "Arsenal (player_one)"),
      "22": "Chelsea (player_two)",
      "53": "E Soccer H2H GG League 8 Mins Play"
    };
    beginFreshStream(adapter, [1, 2]);
    expect(adapter.decode(envelope(event(1, "Real Home"), 3))).toEqual([]);

    expect(adapter.decode(envelope(virtual, 4))).toEqual([]);
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

  it("invalidates APSPORT when its current socket closes", () => {
    const adapter = new TsportWsCatalogAdapter();
    beginFreshStream(adapter, [1]);

    expect(adapter.decode(stateEnvelope("CLOSED", DEFAULT_STREAM_ID, 3))).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:APSPORT:FOOTBALL", reason: "PROVIDER_STREAM_CLOSED"
    })]);
  });

  it("rejects other sports, hosts, unscoped streams, and non-event frames", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.fingerprint({ ...envelope(event(1, "Home")),
      request: { hostname: "evil.example", pathnameClass: "/ln/en/p/1/u/x/s/1/mg/0/tr/0", resourceType: "WebSocket" }
    })).toBe(false);
    expect(adapter.fingerprint({ ...envelope(event(1, "Home")),
      request: { ...envelope(event(1, "Home")).request, streamId: undefined }
    })).toBe(false);
    expect(adapter.fingerprint({ ...envelope(event(1, "Home")),
      payload: { encoding: "UTF8", body: JSON.stringify({ s: 2, t: "eu", d: "{}" }) }
    })).toBe(false);
  });
});

describe("TSPORT socket path", () => {
  it("accepts the stream path the provider moved to", () => {
    // Measured 2026-08-27: all 4389 of APSPORT's socket frames arrived on
    // /ln/en/lm and were refused for not being /ln/{lang}/.../s/1/mg/0/tr/0.
    const adapter = new TsportWsCatalogAdapter();
    const base = envelope(event(1, "Home", "0.44", "-0.55"));
    const moved = { ...base, request: { ...base.request, pathnameClass: "/ln/en/lm" } };

    expect(adapter.fingerprint(moved)).toBe(true);
  });

  it("still refuses a stream that is not on the provider's host", () => {
    const adapter = new TsportWsCatalogAdapter();
    const base = envelope(event(1, "Home", "0.44", "-0.55"));
    const elsewhere = { ...base,
      request: { ...base.request, hostname: "spws.example.com", pathnameClass: "/ln/en/lm" } };

    expect(adapter.fingerprint(elsewhere)).toBe(false);
  });
});
