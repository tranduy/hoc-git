import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { TsportWsCatalogAdapter, extractTsportFootballRecord, observeTsportNativeMarkets } from "./tsport-ws-adapter.js";

const SOURCE_ID = "chrome:TSPORT:7";
const DEFAULT_STREAM_ID = "tsport-stream-1";
const DEFAULT_SOURCE_EPOCH = "observer-a:1";

describe("AP own result schema", () => {
  it.each(["DETAIL", "ROSTER"] as const)("clears an older offer pause using its own receipt despite newer unrelated WS prices (%s)", phase => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home");
    adapter.decode(apiEnvelope([raw]));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    adapter.decode({ ...envelope({ ...partial, "50": [{ ...raw["50"][0], "6": true, "9": [] }] }, 2), receivedMonotonicMs: 1050 });
    adapter.decode({ ...envelope({ ...partial, "50": [raw["50"][1]] }, 3), receivedMonotonicMs: 3050 });
    const fresh = adapter.decode({ ...apiEnvelope([raw], 4, phase, true, phase === "ROSTER" ? "apsport:7:2" : "apsport:7:1"),
      receivedMonotonicMs: 2050 })[0] as AuthorityUpdate;
    expect(fresh.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: "OPEN", receivedMonotonicMs: 2050 })]));
    expect(fresh.value.quotes.filter(q => q.providerMarketId === "tsport:4:120-fh-total"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 3050 })]));
  });

  it.each(["price", "pause"])("keeps a newer WS %s receipt when an older HTTP body finishes assembling later", kind => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home");
    adapter.decode(apiEnvelope([raw]));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    const ws = { ...envelope(kind === "pause" ? { ...partial, "10": "Suspended", "50": [] }
      : { ...partial, "50": [event(120, "Home", "0.71")["50"][0]] }, 3),
      receivedMonotonicMs: 2050, observedAtMs: Date.UTC(2026, 7, 16, 3) + 2000 };
    const fresh = adapter.decode(ws)[0] as AuthorityUpdate;
    const late = { ...apiEnvelope([raw], 4, "DETAIL"), receivedMonotonicMs: 1050,
      observedAtMs: Date.UTC(2026, 7, 16, 3) + 1000 };
    const published = adapter.decode(late)[0] as AuthorityUpdate;
    if (kind === "price") expect(published.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"))
      .toEqual(fresh.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"));
    else expect(published.value.quotes.every(q => q.status === "SUSPENDED")).toBe(true);
    expect(published.value).toMatchObject({ observedAtMs: ws.observedAtMs, observedMonotonicMs: ws.receivedMonotonicMs });
  });

  it("drops bound partial offers when a new roster reuses the event ID for another identity", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home A");
    adapter.decode(apiEnvelope([raw]));
    adapter.decode(apiEnvelope([raw], 2, "DETAIL"));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    adapter.decode(envelope({ ...partial, "50": [raw["50"][0]] }, 3));
    const next = adapter.decode(apiEnvelope([{ ...raw, "5": "Home B", "50": [raw["50"][1]] }],
      4, "ROSTER", true, "apsport:7:2"))[0] as AuthorityUpdate;
    expect(next.value.quotes.some(q => q.providerMarketId === "tsport:3:120-total")).toBe(false);
    const updated = adapter.decode(envelope({ ...partial, "50": [raw["50"][1]] }, 5))[0] as AuthorityUpdate;
    expect(updated.value.events).toEqual([expect.objectContaining({ participantA: "Home B" })]);
  });

  it("reopens only reobserved offers after an event pause", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home");
    adapter.decode(apiEnvelope([raw]));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    adapter.decode(envelope({ ...partial, "10": "Suspended", "50": [] }, 2));
    const reopened = adapter.decode(envelope({ ...partial, "50": [raw["50"][0]] }, 3))[0] as AuthorityUpdate;
    expect(reopened.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total").every(q => q.status === "OPEN")).toBe(true);
    expect(reopened.value.quotes.filter(q => q.providerMarketId !== "tsport:3:120-total"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: "SUSPENDED", receivedMonotonicMs: 50 })]));
    expect(reopened.value.quotes.filter(q => q.providerMarketId !== "tsport:3:120-total").every(q => q.status === "SUSPENDED")).toBe(true);
  });

  it.each(["event", "group", "group-flag", "missing-price"])("masks retained OPEN prices after partial %s evidence without refreshing omitted quotes", kind => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home");
    adapter.decode(apiEnvelope([raw]));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    const first = adapter.decode(envelope({ ...partial, "50": [raw["50"][0]] }, 2))[0] as AuthorityUpdate;
    const group = raw["50"][0]!;
    const patch = kind === "event" ? { ...partial, "10": "Suspended", "50": [] }
      : kind === "group" ? { ...partial, "50": [{ ...group, "10": "Suspended", "9": [] }] }
      : kind === "group-flag" ? { ...partial, "50": [{ ...group, "6": true, "9": [] }] }
      : { ...partial, "50": [{ ...group, "9": [{ ...group["9"][0], "8": null }] }] };
    const next = adapter.decode(envelope(patch, 3))[0] as AuthorityUpdate;
    const affected = next.value.quotes.filter(q => kind === "event" || q.providerMarketId === "tsport:3:120-total");
    expect(affected.length).toBeGreaterThan(0);
    expect(affected.every(q => q.status === "SUSPENDED")).toBe(true);
    if (kind !== "missing-price") expect(affected.map(q => q.receivedMonotonicMs))
      .toEqual(first.value.quotes.filter(q => kind === "event" || q.providerMarketId === "tsport:3:120-total")
        .map(q => q.receivedMonotonicMs));
  });

  it("keeps an omitted offer suspended across shallow roster refreshes until that offer is reobserved", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home");
    adapter.decode(apiEnvelope([raw]));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    adapter.decode(envelope({ ...partial, "50": [raw["50"][0]] }, 2));
    adapter.decode(envelope({ ...partial, "50": [{ ...raw["50"][0], "6": true, "9": [] }] }, 3));
    const shallow = adapter.decode(apiEnvelope([{ ...raw, "50": [raw["50"][1]] }], 4, "ROSTER", true, "apsport:7:2"))[0] as AuthorityUpdate;
    expect(shallow.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total")).toHaveLength(2);
    expect(shallow.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total").every(q => q.status === "SUSPENDED"))
      .toBe(true);
    const fresh = adapter.decode(envelope({ ...partial, "50": [raw["50"][0]] }, 5))[0] as AuthorityUpdate;
    expect(fresh.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ status: "OPEN", receivedMonotonicMs: 90 })]));
  });

  it("retires omitted partial socket offers on authoritative event detail", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(120, "Home");
    adapter.decode(apiEnvelope([raw]));
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    adapter.decode(envelope({ ...partial, "50": [raw["50"][0]] }, 2));
    const next = adapter.decode(apiEnvelope([{ ...raw, "50": [raw["50"][1]] }], 3, "DETAIL"))[0] as AuthorityUpdate;
    expect(next.value.quotes.every(q => q.providerMarketId === "tsport:4:120-fh-total")).toBe(true);
  });

  it("binds native price-only updates to the current roster without refreshing omitted prices", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = { ...event(120, "Home"), "1": 77 };
    const baseline = adapter.decode(apiEnvelope([raw]))[0] as AuthorityUpdate;
    const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
    const first = envelope({ ...partial, "50": [event(120, "Home", "0.71")["50"][0]] }, 2);
    expect(adapter.fingerprint(first)).toBe(true);
    const updated = adapter.decode(first)[0] as AuthorityUpdate;
    expect(updated.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rawOdds: "0.71", receivedMonotonicMs: 60 })]));
    const second = envelope({ ...partial, "50": [event(120, "Home", "0.62")["50"][1]] }, 3);
    const next = adapter.decode(second)[0] as AuthorityUpdate;
    expect(next.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"))
      .toEqual(updated.value.quotes.filter(q => q.providerMarketId === "tsport:3:120-total"));
    expect(next.value.quotes.filter(q => q.providerMarketId === "tsport:5:120-ah"))
      .toEqual(baseline.value.quotes.filter(q => q.providerMarketId === "tsport:5:120-ah"));
  });

  it.each(["unknown", "epoch", "league", "group-event", "group-league", "teams", "phase", "string-phase", "kickoff", "no-markets", "status-wrapper"])(
    "refuses unbound or conflicting native partial update: %s", kind => {
      const adapter = new TsportWsCatalogAdapter();
      const raw = { ...event(120, "Home"), "1": 77 };
      adapter.decode(apiEnvelope([raw]));
      const { "5": _home, "22": _away, "53": _league, ...partial } = raw;
      const patch: Record<string, unknown> = { ...partial };
      if (kind === "unknown") patch["2"] = 999;
      if (kind === "league") patch["1"] = 78;
      if (kind === "group-event") patch["50"] = [{ ...raw["50"][0], "2": 999 }];
      if (kind === "group-league") patch["50"] = [{ ...raw["50"][0], "1": 78 }];
      if (kind === "teams") patch["5"] = "Different team";
      if (kind === "phase") patch["6"] = false;
      if (kind === "string-phase") patch["6"] = "true";
      if (kind === "kickoff") patch["11"] = "2026-08-17T02:00:00Z";
      if (kind === "no-markets") delete patch["50"];
      const input = envelope(kind === "status-wrapper" ? { "1": patch } : patch, 2,
        DEFAULT_STREAM_ID, kind === "epoch" ? "observer-a:2" : DEFAULT_SOURCE_EPOCH);
      expect(adapter.fingerprint(input)).toBe(false);
      expect(adapter.decode(input)).toEqual([]);
    });

  it("retains one explicitly identified double-chance outcome without borrowing another slot's price", () => {
    const input = { "2": 5648440, "5": "Home", "22": "Away", "53": "League", "6": false,
      "11": "2026-09-11T02:00:00Z", "50": [{ "3": 12, "10": "Active", "9": [{
        "3": "56484400120000000d", "6": "733990848101000", "10": { "0": "1.393" } }] }] };
    expect(extractTsportFootballRecord(input)?.markets[0]?.selections).toEqual([
      expect.objectContaining({ selectionId: "56484400120000000d", selection: "HOME_AWAY", priceText: "1.393" })]);
    expect(observeTsportNativeMarkets(input, 1)[0]?.outcomeLabels).toEqual(["HOME_AWAY"]);
  });
  it.each([[12, "FT_DOUBLE_CHANCE"], [13, "FH_DOUBLE_CHANCE"], [89, "SH_1X2"]] as const)(
    "maps native group%s through its own named slots and preserves a suspended offer", (groupId, marketType) => {
      const input = { "2": 5648440, "5": "Home", "22": "Away", "53": "League", "6": false,
        "11": "2026-09-11T02:00:00Z", "50": [{ "3": groupId, "10": "Active", "9": [{
          "0": "56484400120000000h", "2": "56484400120000000a", "3": "56484400120000000d", "6": "733990848101000",
          "7": "0.0", "8": { "0": "1.161608171513049" }, "9": { "0": "1.609562894475658" },
          "10": { "0": "1.3930590972073238" }, "13": true }] }] };
      const result = extractTsportFootballRecord(input);
      expect(result?.markets).toEqual([expect.objectContaining({ marketId: `tsport:${groupId}:733990848101000`, marketType, lineText: null })]);
      expect(result?.markets[0]?.selections.map((selection) => [selection.selection, selection.priceText, selection.locked])).toEqual(
        (groupId === 89 ? ["HOME", "AWAY", "DRAW"] : ["HOME_DRAW", "DRAW_AWAY", "HOME_AWAY"])
          .map((selection, index) => [selection, ["1.161608171513049", "1.609562894475658", "1.3930590972073238"][index], true]));
      expect(observeTsportNativeMarkets(input, 1)[0]).toMatchObject({ disposition: "NORMALIZED", status: "SUSPENDED",
        nativeScope: groupId === 12 ? "FULL_TIME" : groupId === 13 ? "FIRST_HALF" : "SECOND_HALF" });
    });
  it("keeps a native combination without its outcome code unmapped", () => {
    const input = { "2": 1, "50": [{ "3": 98, "10": "Active", "9": [{ "0": "1h", "6": "offer", "8": { "0": "2.5" } }] }] };
    expect(observeTsportNativeMarkets(input, 1)[0]).toMatchObject({ disposition: "UNMAPPED", reason: "INVALID_OR_UNPROVEN_CATEGORICAL_TERMS" });
  });
});

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
  "2": id, "5": home, "6": true, "10": "Active", "11": "2026-08-16T02:00:00Z", "19": 1_399_000,
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

describe("APSPORT real soccer competition boundaries", () => {
  it.each([true, false])("keeps MLS roster and exact detail with its full competition name (empty=%s)", (empty) => {
    const adapter = new TsportWsCatalogAdapter();
    const mls = { ...event(4352803, "DC United"), "22": "Atlanta United", "6": false,
      "11": "2026-09-12T23:30:00Z", "53": "USA Major League Soccer",
      "50": empty ? [] : event(4352803, "DC United")["50"] };
    const baseline = adapter.decode(apiEnvelope([mls]))[0] as AuthorityUpdate;
    expect(baseline.value.events).toEqual([expect.objectContaining({ providerEventId: "4352803", isLive: false })]);
    const detail = adapter.decode(apiEnvelope([mls], 2, "DETAIL", true, "apsport:7:1", 24, "EVENT_CHANGE"))[0] as AuthorityUpdate;
    expect(detail.value.events).toEqual([expect.objectContaining({ providerEventId: "4352803", isLive: false })]);
    expect(detail.value.markets.length).toBe(empty ? 0 : 4);
  });

  it.each(["eSoccer", "e-Soccer", "e Soccer"])("still excludes explicit %s competitions from the API baseline", (label) => {
    const adapter = new TsportWsCatalogAdapter();
    const virtual = { ...event(900, "Home"), "53": `World ${label} Battle` };
    const baseline = adapter.decode(apiEnvelope([virtual]))[0] as AuthorityUpdate;
    expect(baseline.value.events).toEqual([]);
  });
});

function apiEnvelope(
  records: readonly unknown[],
  sequence = 1,
  phase: "ROSTER" | "DETAIL" = "ROSTER",
  complete = true,
  generation = "apsport:7:1",
  prematchWindowHours = 24,
  trigger?: "SWEEP" | "EVENT_CHANGE",
  verifiedEmpty = records.length === 0
): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: SOURCE_ID, tabId: 7,
    sourceEpoch: DEFAULT_SOURCE_EPOCH,
    sequence, observedAtMs: Date.UTC(2026, 7, 16, 3), receivedMonotonicMs: sequence * 10 + 40,
    transport: "HTTP_RESPONSE",
    request: { hostname: "pacific.agenate.com",
      pathnameClass: "/__fieldline_apsport_catalog_refresh__", resourceType: "Fetch" },
    payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 1, generation, phase, complete,
      ...(trigger === undefined ? {} : { trigger }), ...(verifiedEmpty ? { verifiedEmpty: true } : {}),
      prematchWindowHours, records }) }
  };
}

type AuthorityUpdate = {
  readonly authoritativeBaseline?: true;
  readonly evidenceMode?: "BASELINE" | "DELTA";
  readonly provenance?: "WS" | "AUTHENTICATED_HTTP";
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
      readonly isLive: boolean;
      readonly status: string;
      readonly receivedMonotonicMs: number;
      readonly sequence: number | null;
    }>;
    readonly nativeMarketObservations?: ReadonlyArray<{
      readonly providerEventId: string;
      readonly providerMarketId: string;
      readonly nativeType: string;
      readonly disposition: "NORMALIZED" | "EXCLUDED" | "UNMAPPED";
      readonly reason: string;
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
  it.each([
    [5, "FT_AH"], [6, "FH_AH"], [19, "CORNER_FT_AH"], [20, "CORNER_FH_AH"],
    [33, "CARD_FT_AH"], [34, "CARD_FH_AH"], [85, "SH_AH"]
  ] as const)("retains AP native signed and zero lines for group %s (%s)", (groupId, marketType) => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = { ...event(131, "Signed Home"), "6": false, "11": "2026-08-17T03:00:00Z",
      "50": [{ "3": groupId, "10": "Active", "9": ["0.5", "0.75", "1.0", "0", "-0.5"].map((line, index) => ({
        "0": `signed-${index}-home`, "2": `signed-${index}-away`, "6": `signed-${index}`, "7": line,
        "8": { "2": "0.84" }, "9": { "2": "-0.94" }
      })) }] };
    const update = adapter.decode(apiEnvelope([raw]))[0] as AuthorityUpdate;
    expect(update.value.markets).toEqual([
      expect.objectContaining({ marketType, providerMarketId: `tsport:${groupId}:signed-0`, line: "0.5" }),
      expect.objectContaining({ marketType, providerMarketId: `tsport:${groupId}:signed-1`, line: "0.75" }),
      expect.objectContaining({ marketType, providerMarketId: `tsport:${groupId}:signed-2`, line: "1" }),
      expect.objectContaining({ marketType, providerMarketId: `tsport:${groupId}:signed-3`, line: "0" }),
      expect.objectContaining({ marketType, providerMarketId: `tsport:${groupId}:signed-4`, line: "-0.5" })
    ]);
    expect(update.value.quotes).toHaveLength(10);
    expect(update.value.nativeMarketObservations?.filter((item) => item.disposition === "NORMALIZED"))
      .toHaveLength(5);
  });

  it("refuses an unverified empty API roster instead of erasing the last good catalog", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.decode(apiEnvelope([event(101, "API Home")], 1))).toHaveLength(1);

    expect(adapter.decode(apiEnvelope([], 2, "ROSTER", true, "apsport:7:2", 24, undefined, false)))
      .toEqual([]);
  });

  it("adopts live socket fixtures when the roster established empty", () => {
    // Measured 2026-08-31: with the provider tab on its live view the page never
    // issues the list request the roster is captured from, so the roster arrives
    // complete and empty and every socket frame was refused while the book sat
    // dark. Those frames carry the whole record, so an empty roster adopts them.
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.decode(apiEnvelope([], 1))).toHaveLength(1);

    // The empty baseline covers no fixtures, so a delta that adds one is
    // rightly refused by the coverage guard: this lane offers the accumulated
    // set as the baseline it actually is.
    const update = adapter.decode(envelope(event(301, "Live Home"), 2))[0] as AuthorityUpdate;
    expect(update).toMatchObject({ evidenceMode: "BASELINE", provenance: "WS" });
    expect(update.value.events).toHaveLength(1);
    expect(update.value.quotes.length).toBeGreaterThan(0);

    const second = adapter.decode(envelope(event(302, "Live Home 2"), 3))[0] as AuthorityUpdate;
    expect(second.value.events).toHaveLength(2);
  });

  it("still refuses an unknown fixture once a real roster exists", () => {
    const adapter = new TsportWsCatalogAdapter();
    expect(adapter.decode(apiEnvelope([event(101, "API Home")], 1))).toHaveLength(1);

    // A populated roster that matches nothing is a socket numbering its
    // fixtures another way, and adopting those would invent a second book.
    expect(adapter.decode(envelope(event(999, "Stranger"), 2))).toEqual([]);
  });

  it("uses a complete APSPORT API roster as authority without any DOM proof", () => {
    const adapter = new TsportWsCatalogAdapter();

    const update = adapter.decode(apiEnvelope([event(101, "API Home")]))[0] as AuthorityUpdate;

    expect(update).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      generation: "apsport:7:1", provenance: "AUTHENTICATED_HTTP" });
    expect(update.value).toMatchObject({ accountId: "catalog-source:APSPORT:FOOTBALL",
      provider: "APSPORT", events: [expect.objectContaining({ providerEventId: "101", isLive: true })] });
    expect(update.value.markets).toHaveLength(4);
    expect(update.value.quotes).toHaveLength(8);
  });

  it("adds supported hidden markets from event-detail batches without treating collapsed UI state as locked", () => {
    const adapter = new TsportWsCatalogAdapter();
    const roster = event(102, "Hidden Home");
    const detail = event(102, "Hidden Home");
    detail["50"].push({ "3": 80, "9": [{
      "0": "102-sh-over", "2": "102-sh-under", "6": "102-sh-total", "7": "1.5",
      "8": { "2": "0.75" }, "9": { "2": "-0.85" }
    }], "10": "Active" });
    adapter.decode(apiEnvelope([roster]));

    const update = adapter.decode(apiEnvelope([detail], 2, "DETAIL"))[0] as AuthorityUpdate;

    expect(update).toMatchObject({ evidenceMode: "DELTA", generation: "apsport:7:1",
      provenance: "AUTHENTICATED_HTTP" });
    expect(update.value.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "102", providerMarketId: "tsport:80:102-sh-total",
        marketType: "SH_TOTAL" })
    ]));
    expect(update.value.quotes.filter((quote) => quote.providerMarketId === "tsport:80:102-sh-total"))
      .toEqual([expect.objectContaining({ status: "OPEN" }), expect.objectContaining({ status: "OPEN" })]);
  });

  it("keeps API prematch events and quotes in prematch phase inside the configured window", () => {
    const adapter = new TsportWsCatalogAdapter();
    const prematch = { ...event(103, "Prematch Home"), "6": false, "11": "2026-08-16T04:00:00Z" };

    const update = adapter.decode(apiEnvelope([prematch]))[0] as AuthorityUpdate;

    expect(update.value.events).toEqual([
      expect.objectContaining({ providerEventId: "103", isLive: false, liveState: null })
    ]);
    expect(update.value.quotes.every((quote) => quote.isLive === false)).toBe(true);
  });

  it("accepts APSPORT's status-sparse prematch records when open market groups prove activity", () => {
    const adapter = new TsportWsCatalogAdapter();
    const statusSparse = { ...event(107, "Sparse Home"), "6": false,
      "10": undefined, "11": "2026-08-16T04:00:00Z" };

    const update = adapter.decode(apiEnvelope([statusSparse]))[0] as AuthorityUpdate;

    expect(update.value.events).toEqual([
      expect.objectContaining({ providerEventId: "107", isLive: false })
    ]);
    expect(update.value.markets).toHaveLength(4);
  });

  it("keeps a future API prematch event beyond the legacy window at the adapter boundary", () => {
    const adapter = new TsportWsCatalogAdapter();
    const outside = { ...event(104, "Outside Home"), "6": false, "11": "2026-09-17T04:00:01Z" };

    const update = adapter.decode(apiEnvelope([outside]))[0] as AuthorityUpdate;

    expect(update).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE" });
    expect(update.value.events).toEqual([
      expect.objectContaining({ providerEventId: "104", isLive: false })
    ]);
    expect(update.value.markets).toHaveLength(4);
    expect(update.value.quotes).toHaveLength(8);
  });

  it("accounts for every native market without interpreting an unverified odds format", () => {
    const adapter = new TsportWsCatalogAdapter();
    const detailed: Record<string, unknown> = {
      ...event(130, "Complete Home"), "6": false, "11": "2026-08-16T04:00:00Z"
    };
    detailed["50"] = [
      { "3": 8, "9": [{ "0": "130-odd", "2": "130-even", "6": "130-odd-even", "7": "0.0",
        "8": { "0": "1.91", "1": "1.91" }, "9": { "0": "1.77", "1": "1.77" } }], "10": "Active" },
      { "3": 31, "9": [{ "0": "130-card-over", "2": "130-card-under", "6": "130-card-total", "7": "2.5",
        "8": { "0": "2.49", "1": "2.49" }, "9": { "0": "1.49", "1": "1.49" } }], "10": "Active" },
      { "3": 36, "9": [{ "0": "130-btts-yes", "2": "130-btts-no", "6": "130-btts",
        "8": { "0": "1.87", "1": "1.87" }, "9": { "0": "1.93", "1": "1.93" } }], "10": "Active" },
      { "3": 87, "9": [{ "0": "130-home", "2": "130-away", "3": "130-draw", "6": "130-three-way", "7": "0.0",
        "8": { "1": "3.27" }, "9": { "1": "2.41" }, "10": { "1": "2.57" } }], "10": "Active" },
      { "3": 999, "9": [{ "0": "130-x", "2": "130-y", "6": "130-unknown", "7": "0.0",
        "8": { "1": "1.9" }, "9": { "1": "1.9" } }], "10": "Active" }
    ];

    const update = adapter.decode(apiEnvelope([detailed]))[0] as AuthorityUpdate;

    expect(update.value.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "tsport:8:130-odd-even", marketType: "FT_ODD_EVEN", line: null }),
      expect.objectContaining({ providerMarketId: "tsport:31:130-card-total", marketType: "CARD_FT_TOTAL", line: "2.5" }),
      expect.objectContaining({ providerMarketId: "tsport:36:130-btts", marketType: "FT_BTTS", line: null })
    ]));
    expect(update.value.quotes.filter((quote) => quote.providerMarketId === "tsport:8:130-odd-even"))
      .toEqual([expect.objectContaining({ rawOdds: "1.91" }), expect.objectContaining({ rawOdds: "1.77" })]);
    expect(update.value.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "tsport:8:130-odd-even", nativeType: "8", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "tsport:31:130-card-total", nativeType: "31", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "tsport:36:130-btts", nativeType: "36", disposition: "NORMALIZED" }),
      expect.objectContaining({ providerMarketId: "tsport:87:130-three-way", nativeType: "87", disposition: "UNMAPPED",
        reason: "INVALID_OR_UNPROVEN_CATEGORICAL_TERMS" }),
      expect.objectContaining({ providerMarketId: "tsport:999:130-unknown", nativeType: "999", disposition: "UNMAPPED",
        reason: "NATIVE_TYPE_UNMAPPED" })
    ]));
    expect(update.value.nativeMarketObservations).toHaveLength(5);
  });

  it("keeps multiple proven APSPORT football sockets alive and invalidates only after the last one closes", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(apiEnvelope([event(105, "Socket Home")]));
    adapter.decode(stateEnvelope("OPEN", "football-a", 2));
    adapter.decode(stateEnvelope("OPEN", "football-b", 3));
    expect(adapter.decode(envelope(event(105, "Socket Home", "0.71"), 4, "football-a"))).toHaveLength(1);
    expect(adapter.decode(envelope(event(105, "Socket Home", "0.72"), 5, "football-b"))).toHaveLength(1);

    expect(adapter.decode(stateEnvelope("CLOSED", "football-a", 6))).toEqual([]);
    expect(adapter.decode(stateEnvelope("CLOSED", "football-b", 7))).toEqual([
      expect.objectContaining({ invalidateAccountId: "catalog-source:APSPORT:FOOTBALL",
        reason: "PROVIDER_STREAM_CLOSED" })
    ]);
  });

  it("suppresses duplicate socket events but retains hidden detail markets on a real price delta", () => {
    const adapter = new TsportWsCatalogAdapter();
    const roster = event(106, "Realtime Home");
    const detail = event(106, "Realtime Home");
    detail["50"].push({ "3": 80, "9": [{
      "0": "106-sh-over", "2": "106-sh-under", "6": "106-sh-total", "7": "1.5",
      "8": { "2": "0.75" }, "9": { "2": "-0.85" }
    }], "10": "Active" });
    adapter.decode(apiEnvelope([roster]));
    adapter.decode(apiEnvelope([detail], 2, "DETAIL"));
    adapter.decode(stateEnvelope("OPEN", "football-a", 3));
    const realtime = event(106, "Realtime Home", "0.66", "-0.76");
    realtime["50"] = [realtime["50"][0]!];

    const changed = adapter.decode(envelope(realtime, 4, "football-a"))[0] as AuthorityUpdate;

    expect(changed).toMatchObject({ evidenceMode: "DELTA", generation: "apsport:7:1", provenance: "WS" });
    expect(changed.value.markets).toHaveLength(5);
    expect(changed.value.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "tsport:80:106-sh-total" })
    ]));
    expect(adapter.decode(envelope(realtime, 5, "football-a"))).toEqual([
      expect.objectContaining({ transportAlive: true, sourceId: "chrome:TSPORT:7", sequence: 5 })
    ]);
  });

  it("uses event-change detail as an exact event replacement and removes a closed hidden market", () => {
    const adapter = new TsportWsCatalogAdapter();
    const roster = event(108, "Realtime Home");
    const withHidden = event(108, "Realtime Home");
    withHidden["50"].push({ "3": 80, "9": [{
      "0": "108-sh-over", "2": "108-sh-under", "6": "108-sh-total", "7": "1.5",
      "8": { "2": "0.75" }, "9": { "2": "-0.85" }
    }], "10": "Active" });
    adapter.decode(apiEnvelope([roster]));
    adapter.decode(apiEnvelope([withHidden], 2, "DETAIL"));
    adapter.decode(stateEnvelope("OPEN", "football-a", 3));
    const partialSocket = event(108, "Realtime Home", "0.66", "-0.76");
    partialSocket["50"] = [partialSocket["50"][0]!];
    adapter.decode(envelope(partialSocket, 4, "football-a"));
    const currentDetail = event(108, "Realtime Home", "0.66", "-0.76");

    const update = adapter.decode(apiEnvelope(
      [currentDetail], 5, "DETAIL", false, "apsport:7:1", 24, "EVENT_CHANGE"
    ))[0] as AuthorityUpdate;

    expect((update.value.markets as readonly { readonly providerMarketId?: string }[])
      .some((market) => market.providerMarketId === "tsport:80:108-sh-total")).toBe(false);
    expect(update.value.quotes.filter((quote) => quote.providerEventId === "108")
      .every((quote) => quote.sequence === 5 && quote.receivedMonotonicMs === 90)).toBe(true);
  });

  it("publishes a receipt-only event-change detail confirmation", () => {
    const adapter = new TsportWsCatalogAdapter();
    const current = event(109, "Confirmed Home");
    adapter.decode(apiEnvelope([current]));
    adapter.decode(apiEnvelope([current], 2, "DETAIL"));

    const update = adapter.decode(apiEnvelope(
      [current], 3, "DETAIL", false, "apsport:7:1", 24, "EVENT_CHANGE"
    ))[0] as AuthorityUpdate;

    expect(update).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP" });
    expect(update.value.quotes.every((quote) => quote.sequence === 3 && quote.receivedMonotonicMs === 70)).toBe(true);
  });

  it("reuses untouched normalized offers while renewing only the re-observed event", () => {
    const adapter = new TsportWsCatalogAdapter();
    const first = event(190, "First"), other = event(191, "Other");
    adapter.decode(apiEnvelope([first, other]));
    const initial = adapter.decode(apiEnvelope([first, other], 2, "DETAIL"))[0] as AuthorityUpdate;
    const next = adapter.decode(apiEnvelope([first], 3, "DETAIL", false, "apsport:7:1", 24,
      "EVENT_CHANGE"))[0] as AuthorityUpdate;
    const untouched = initial.value.quotes.filter(quote => quote.providerEventId === "191");
    expect(untouched.length).toBeGreaterThan(0);
    expect(next.value.quotes.filter(quote => quote.providerEventId === "191")).toEqual(untouched);
    for (const quote of untouched) expect(next.value.quotes).toContain(quote);
    expect(next.value.quotes.filter(quote => quote.providerEventId === "190")
      .every(quote => quote.sequence === 3 && quote.receivedMonotonicMs === 70)).toBe(true);
  });

  it.each(["SWEEP", "WS"] as const)("publishes bounded %s re-observations without renewing unrelated quote clocks", (kind) => {
    const adapter = new TsportWsCatalogAdapter();
    const first = event(180, "Confirmed First"), other = event(181, "Unchanged Other");
    const at = (input: ChromeBridgeEnvelope, elapsedMs: number): ChromeBridgeEnvelope => ({ ...input,
      observedAtMs: Date.UTC(2026, 7, 16, 3) + elapsedMs, receivedMonotonicMs: 50 + elapsedMs });
    const observation = (record: ReturnType<typeof event>, sequence: number, elapsedMs: number) => at(kind === "SWEEP"
      ? apiEnvelope([record], sequence, "DETAIL", false, "apsport:7:1", 24, "SWEEP")
      : envelope(record, sequence), elapsedMs);
    adapter.decode(at(apiEnvelope([first, other]), 0));
    const initial = adapter.decode(observation(first, 2, 100))[0] as AuthorityUpdate;
    expect(initial.value.quotes.filter(quote => quote.providerEventId === "180")
      .every(quote => quote.sequence === 2 && quote.receivedMonotonicMs === 150)).toBe(true);

    const confirmed = adapter.decode(observation(first, 3, 1_100))[0] as AuthorityUpdate;
    expect(confirmed?.value).toBeDefined();
    expect(confirmed.value.quotes.filter(quote => quote.providerEventId === "180")
      .every(quote => quote.sequence === 3 && quote.receivedMonotonicMs === 1_150)).toBe(true);
    expect(confirmed.value.quotes.filter(quote => quote.providerEventId === "181")
      .every(quote => quote.sequence === 1 && quote.receivedMonotonicMs === 50)).toBe(true);

    // A second real confirmation is retained, but a whole catalog need not be
    // rebuilt for every duplicate socket record in a subsecond burst.
    expect(adapter.decode(observation(first, 4, 1_200)).some(update => "value" in update)).toBe(false);
    // A semantic price change still publishes immediately and carries only
    // the genuinely refreshed first-event receipt from the coalesced record.
    const changed = adapter.decode(observation(event(181, "Unchanged Other", "0.67"), 5, 1_250))[0] as AuthorityUpdate;
    expect(changed.value.quotes.filter(quote => quote.providerEventId === "180")
      .every(quote => quote.sequence === 4 && quote.receivedMonotonicMs === 1_250)).toBe(true);
    expect(changed.value.quotes.filter(quote => quote.providerEventId === "181")
      .every(quote => quote.sequence === 5 && quote.receivedMonotonicMs === 1_300)).toBe(true);
  });

  it.each(["SWEEP", "WS"] as const)("does not publish pending %s receipts on heartbeat, empty, malformed or retired traffic", (kind) => {
    const adapter = new TsportWsCatalogAdapter(), current = event(182, "Confirmed Only");
    const at = (input: ChromeBridgeEnvelope, elapsedMs: number): ChromeBridgeEnvelope => ({ ...input,
      observedAtMs: Date.UTC(2026, 7, 16, 3) + elapsedMs, receivedMonotonicMs: 50 + elapsedMs });
    const observation = (sequence: number, elapsedMs: number) => at(kind === "SWEEP"
      ? apiEnvelope([current], sequence, "DETAIL", false, "apsport:7:1", 24, "SWEEP")
      : envelope(current, sequence), elapsedMs);
    adapter.decode(at(apiEnvelope([current]), 0));
    adapter.decode(observation(2, 100));
    adapter.decode(observation(3, 200));
    const invalid = [at(envelope({}, 4), 1_200),
      at(apiEnvelope([], 5, "DETAIL", false), 1_300),
      { ...observation(6, 1_400), payload: { encoding: "UTF8" as const, body: "{" } },
      { ...observation(7, 1_500), sourceEpoch: "observer-a:0" },
      { ...observation(8, 1_600), request: { ...observation(8, 1_600).request, replayed: true } }];
    for (const input of invalid) expect(adapter.decode(input).some(update => "value" in update)).toBe(false);
    const genuine = adapter.decode(observation(9, 1_700))[0] as AuthorityUpdate;
    expect(genuine?.value).toBeDefined();
    expect(genuine.value.quotes.every(quote => quote.sequence === 9 && quote.receivedMonotonicMs === 1_750)).toBe(true);
  });

  it("renews only the native markets present in an identical partial socket observation", () => {
    const adapter = new TsportWsCatalogAdapter(), current = event(183, "Partial Confirmation");
    const at = (input: ChromeBridgeEnvelope, elapsedMs: number): ChromeBridgeEnvelope => ({ ...input,
      observedAtMs: Date.UTC(2026, 7, 16, 3) + elapsedMs, receivedMonotonicMs: 50 + elapsedMs });
    adapter.decode(at(apiEnvelope([current]), 0));
    const partial = { ...current, "50": [current["50"][0]!] };
    adapter.decode(at(envelope(partial, 2), 100));
    const confirmed = adapter.decode(at(envelope(partial, 3), 1_100))[0] as AuthorityUpdate;

    expect(confirmed.value.quotes.filter(quote => quote.providerMarketId === "tsport:3:183-total"))
      .toEqual([expect.objectContaining({ sequence: 3, receivedMonotonicMs: 1_150 }),
        expect.objectContaining({ sequence: 3, receivedMonotonicMs: 1_150 })]);
    const untouched = confirmed.value.quotes.filter(quote => quote.providerMarketId !== "tsport:3:183-total");
    expect(untouched.length).toBeGreaterThan(0);
    expect(untouched.every(quote => quote.sequence === 1 && quote.receivedMonotonicMs === 50)).toBe(true);
  });

  it("pairs a membership-only publication clock with its receipt without renewing surviving quotes", () => {
    const adapter = new TsportWsCatalogAdapter();
    const surviving = event(184, "Retained Quote"), removed = event(185, "Removed Event");
    const baseline = adapter.decode(apiEnvelope([surviving, removed]))[0] as AuthorityUpdate;
    const originalQuotes = baseline.value.quotes.filter(quote => quote.providerEventId === "184");
    const removal = apiEnvelope([{ ...removed, "10": "Suspended" }], 2, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE");
    const observedAtMs = removal.observedAtMs + 20_000;
    const observedMonotonicMs = removal.receivedMonotonicMs + 20_000.25;
    const update = adapter.decode({ ...removal, observedAtMs, receivedMonotonicMs: observedMonotonicMs })[0] as AuthorityUpdate;

    expect(update.value).toMatchObject({ observedAtMs, observedMonotonicMs });
    expect(update.value.events).toHaveLength(1);
    expect(update.value.quotes).toEqual(originalQuotes);
    expect(Math.max(...update.value.quotes.map(quote => quote.receivedMonotonicMs)))
      .toBeLessThan(observedMonotonicMs);
  });

  it("does not resurrect a roster main market omitted by authoritative event detail", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(132, "Partition Home");
    adapter.decode(apiEnvelope([raw]));
    const detailed = { ...raw, "50": [raw["50"][0]!] };
    const update = adapter.decode(apiEnvelope([detailed], 2, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE"))[0] as AuthorityUpdate;
    expect(update.value.markets).toEqual([expect.objectContaining({ providerMarketId: "tsport:3:132-total" })]);
    expect(update.value.nativeMarketObservations).toHaveLength(1);
    const repricedRoster = event(132, "Partition Home", "0.64");
    const renewed = adapter.decode(apiEnvelope([repricedRoster], 3, "ROSTER", true, "apsport:7:2"))[0] as AuthorityUpdate;
    expect(renewed.value.markets).toHaveLength(1);
    expect(renewed.value.quotes[0]).toMatchObject({ providerMarketId: "tsport:3:132-total", rawOdds: "0.64", sequence: 3 });
  });

  it("ignores malformed active exact detail instead of deleting its event", () => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = event(133, "Malformed Home");
    adapter.decode(apiEnvelope([raw]));
    expect(adapter.decode(apiEnvelope([{ ...raw, "50": null }], 2, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE"))).toEqual([]);
    const update = adapter.decode(apiEnvelope([raw], 3, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE"))[0] as AuthorityUpdate;
    expect(update.value.events).toHaveLength(1);
    expect(update.value.markets).toHaveLength(4);
  });

  it.each([[null], [{ "3": 3, "9": null }], [{ "3": 3, "9": [null] }]])(
    "does not turn malformed detail groups into authoritative empty markets (%j)", (...groups) => {
      const adapter = new TsportWsCatalogAdapter();
      const raw = event(136, "Malformed Group Home");
      adapter.decode(apiEnvelope([raw]));
      expect(adapter.decode(apiEnvelope([{ ...raw, "50": groups }], 2, "DETAIL", false,
        "apsport:7:1", 24, "EVENT_CHANGE"))).toEqual([]);
      const updated = adapter.decode(apiEnvelope([raw], 3, "DETAIL", false,
        "apsport:7:1", 24, "EVENT_CHANGE"))[0] as AuthorityUpdate;
      expect(updated.value.markets).toHaveLength(4);
    });

  it.each([undefined, "invalid-date"])("ignores invalid prematch kickoff %s without authorizing deletion", (start) => {
    const adapter = new TsportWsCatalogAdapter();
    const raw = { ...event(137, "Kickoff Home"), "6": false, "11": "2026-08-17T03:00:00Z" };
    adapter.decode(apiEnvelope([raw]));
    expect(adapter.decode(apiEnvelope([{ ...raw, "11": start }], 2, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE"))).toEqual([]);
    const next = adapter.decode(apiEnvelope([raw], 3, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE"))[0] as AuthorityUpdate;
    expect(next.value.events).toHaveLength(1);
  });

  it("refuses a multi-event batch mislabeled as one exact event response", () => {
    const adapter = new TsportWsCatalogAdapter();
    const first = event(134, "First Home");
    const second = event(135, "Second Home");
    adapter.decode(apiEnvelope([first, second]));
    expect(adapter.decode(apiEnvelope([{ ...first, "10": "Suspended" },
      { ...second, "10": "Suspended" }], 2, "DETAIL", false,
    "apsport:7:1", 24, "EVENT_CHANGE"))).toEqual([]);
    const next = adapter.decode(apiEnvelope([first], 3, "DETAIL", false,
      "apsport:7:1", 24, "EVENT_CHANGE"))[0] as AuthorityUpdate;
    expect(next.value.events).toHaveLength(2);
  });

  it("stops pricing an APSPORT fixture the socket says the book has paused", () => {
    // A book pauses a market the moment it repositions, and the frame saying so
    // was refused as unreadable - so the price it had went on being published
    // as current. Measured 2026-08-29: 129 of APSPORT's refused frames were
    // this, each one a price the book had already withdrawn.
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(apiEnvelope([event(120, "Paused Home")]));
    const priced = adapter.decode(envelope(event(120, "Paused Home", "0.71"), 2))[0] as AuthorityUpdate;

    const paused = adapter.decode(envelope(
      { ...event(120, "Paused Home", "0.71"), "10": "Suspended" }, 3))[0] as AuthorityUpdate;

    const marketsOf = (update: AuthorityUpdate) => update.value.markets as readonly { readonly providerEventId?: string; readonly status?: string }[];
    expect(marketsOf(priced).every((market) => market.status === "OPEN")).toBe(true);
    expect(marketsOf(paused).filter((market) => market.providerEventId === "120").length)
      .toBeGreaterThan(0);
    expect(marketsOf(paused).filter((market) => market.providerEventId === "120")
      .every((market) => market.status === "SUSPENDED")).toBe(true);
  });

  it("removes the whole APSPORT event when its exact changed detail is no longer active", () => {
    const adapter = new TsportWsCatalogAdapter();
    const current = event(110, "Closed Home");
    adapter.decode(apiEnvelope([current]));
    adapter.decode(apiEnvelope([current], 2, "DETAIL"));

    const update = adapter.decode(apiEnvelope(
      [{ ...current, "10": "Suspended" }], 3, "DETAIL", false, "apsport:7:1", 24, "EVENT_CHANGE"
    ))[0] as AuthorityUpdate;

    expect((update.value.events as readonly { readonly providerEventId?: string }[])
      .some((candidate) => candidate.providerEventId === "110")).toBe(false);
    expect(update.value.quotes.some((quote) => quote.providerEventId === "110")).toBe(false);
  });

  it("does not let a delayed sweep overwrite a newer exact APSPORT event refresh", () => {
    const adapter = new TsportWsCatalogAdapter();
    const old = event(111, "Ordered Home", "0.83", "-0.91");
    const current = event(111, "Ordered Home", "0.66", "-0.76");
    adapter.decode(apiEnvelope([old]));
    const exact = adapter.decode(apiEnvelope(
      [current], 2, "DETAIL", false, "apsport:7:1", 24, "EVENT_CHANGE"
    ))[0] as AuthorityUpdate;

    const delayed = adapter.decode(apiEnvelope([old], 3, "DETAIL", false));

    expect(exact.value.quotes.find((quote) => quote.providerMarketId === "tsport:3:111-total")?.rawOdds).toBe("0.66");
    expect(delayed).toEqual([]);
  });

  it("adds a newly-live APSPORT event from its exact authenticated detail", () => {
    const adapter = new TsportWsCatalogAdapter();
    adapter.decode(apiEnvelope([event(111, "Existing Home")]));
    const newlyLive = event(112, "New Live Home", "0.55", "-0.65");

    const update = adapter.decode(apiEnvelope(
      [newlyLive], 2, "DETAIL", false, "apsport:7:1", 24, "EVENT_CHANGE"
    ))[0] as AuthorityUpdate;

    expect((update.value.events as readonly { readonly providerEventId?: string }[])
      .some((candidate) => candidate.providerEventId === "112")).toBe(true);
    expect(update.value.quotes.some((quote) => quote.providerEventId === "112" && quote.rawOdds === "0.55"))
      .toBe(true);
  });

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
        authoritativeBaseline: true, evidenceMode: "BASELINE", provenance: "WS",
        value: expect.objectContaining({ observedAtMs: Date.UTC(2026, 7, 16, 3), observedMonotonicMs: 70,
          quotes: expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 60, sequence: 2 })]) })
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
