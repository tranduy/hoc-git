import { describe, expect, it } from "vitest";
import { normalizeSabaFootballRecords } from "@tool-chenh/adapters";
import { SabaPushDecoder } from "./saba-push-decoder.js";

const fields = [
  "type", "matchid", "oddsid", "bettype", "marketid", "eventstatus", "odds", "enable"
] as const;

describe("SabaPushDecoder", () => {
  it.each([
    { name: "frame envelope", frame: { bridgeId: "invalid", revision: "r1", rows: [] },
      reason: "FRAME_INVALID" },
    { name: "empty row", frame: { bridgeId: "b1", revision: "r1", rows: [[]] },
      reason: "ROW_INVALID" },
    { name: "field table", frame: { bridgeId: "b1", revision: "r1", rows: [["f", -1, []]] },
      reason: "FIELD_TABLE_INVALID" },
    { name: "field name", frame: { bridgeId: "b1", revision: "r1", rows: [["f", 0, [null]]] },
      reason: "FIELD_NAME_INVALID" },
    { name: "row width", frame: { bridgeId: "b1", revision: "r1", rows: [[0, "reset", 1]] },
      reason: "ROW_WIDTH_ODD" },
    { name: "field index", frame: { bridgeId: "b1", revision: "r1", rows: [["zero", "reset"]] },
      reason: "FIELD_INDEX_INVALID" },
    { name: "unmapped field", frame: { bridgeId: "b1", revision: "r1", rows: [[1, "reset"]] },
      reason: "FIELD_INDEX_UNMAPPED" }
  ])("names a malformed SABA $name without exposing provider values", ({ frame, reason }) => {
    expect(() => new SabaPushDecoder().apply(frame))
      .toThrow(`SABA_PUSH_SCHEMA_CHANGED:${reason}`);
  });

  it("reports only bounded field-table shape when a SABA index is unmapped", () => {
    expect(() => new SabaPushDecoder().apply({ bridgeId: "b1", revision: "r1",
      rows: [[7, "provider-secret-must-not-appear"]] }))
      .toThrow("SABA_PUSH_SCHEMA_CHANGED:FIELD_INDEX_UNMAPPED:I7:F0:D0:C0:A0:M0");
  });

  it("decodes an atomic full snapshot from the provider field table", () => {
    const decoder = new SabaPushDecoder();
    const result = decoder.apply({
      bridgeId: "b1",
      revision: "r0001",
      rows: [
        ["c", "c2", "broker", "push"],
        ["f", 0, fields],
        [0, "reset"],
        [0, "m", 1, 41385687, 4, "T", 5, "running"],
        [0, "o", 2, 90001, 1, 41385687, 3, 1, 6, 2.2, 7, 1],
        [0, "done"]
      ]
    });

    expect(result).toMatchObject({ duplicate: false, fullSnapshot: true, revision: "r0001" });
    expect(result.records).toEqual([
      expect.objectContaining({ type: "m", matchid: 41385687, marketid: "T", eventstatus: "running" }),
      expect.objectContaining({ type: "o", oddsid: 90001, matchid: 41385687, bettype: 1, odds: 2.2, enable: 1 })
    ]);
  });

  it("merges a delta, deletes an odds row, and ignores an exact duplicate revision", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b5", revision: "a0001", rows: [
      ["f", 0, fields], [0, "reset"], [0, "o", 2, 7, 1, 10, 3, 1, 6, 1.8], [0, "done"]
    ] });

    const changed = decoder.apply({ bridgeId: "b5", revision: "a0002", rows: [[0, "o", 2, 7, 6, 2.35]] });
    expect(changed.records).toEqual([expect.objectContaining({ oddsid: 7, matchid: 10, odds: 2.35 })]);
    expect(decoder.apply({ bridgeId: "b5", revision: "a0002", rows: [[0, "o", 2, 7, 6, 9.99]] }))
      .toMatchObject({ duplicate: true, changes: [] });

    const deleted = decoder.apply({ bridgeId: "b5", revision: "a0003", rows: [[0, "-o", 2, 7]] });
    expect(deleted.records).toEqual([]);
    expect(deleted.changes).toEqual([expect.objectContaining({ operation: "DELETE", key: "o:7" })]);
  });

  it("retains all type 13 clean-sheet fields while a sparse delta updates home yes and status", () => {
    const decoder = new SabaPushDecoder();
    const cleanSheetFields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid",
      "hteamnameen", "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype",
      "parenttypeid", "oddsstatus", "enable", "cs10", "cs11", "cs20", "cs21"] as const;
    const observedAtMs = 1_788_816_065_105;
    decoder.apply({ bridgeId: "b13", revision: "cs-1", rows: [
      ["f", 0, cleanSheetFields],
      [0, "reset"],
      [0, "l", 1, 1, 2, "League", 3, 1],
      [0, "m", 1, 1, 3, 1, 4, 133152892, 5, "Home", 6, "Away",
        7, Math.floor(observedAtMs / 1_000) + 3_600, 8, "T"],
      [0, "o", 4, 133152892, 9, 1054290306, 10, 13, 11, 13, 12, "running", 13, 1,
        14, 1.36, 15, 2.72, 16, 1.22, 17, 3.60],
      [0, "done"]
    ] });

    const changed = decoder.apply({ bridgeId: "b13", revision: "cs-2", rows: [
      [0, "o", 9, 1054290306, 12, "suspended", 15, 2.95]
    ] });
    expect(changed.records).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "o", oddsid: 1054290306, cs10: 1.36, cs11: 2.95, cs20: 1.22, cs21: 3.60,
      oddsstatus: "suspended"
    })]));

    const normalized = normalizeSabaFootballRecords(changed.records, {
      observedAtMs: observedAtMs + 1_000, receivedMonotonicMs: 123.5, sequence: 4
    });
    expect(normalized.markets).toHaveLength(2);
    expect(normalized.markets.every(({ status }) => status === "SUSPENDED")).toBe(true);
    expect(normalized.quotes.map(({ providerMarketId, selection, rawOdds, rawFormat, status,
      receivedMonotonicMs, sequence }) => [providerMarketId, selection, rawOdds, rawFormat, status,
        receivedMonotonicMs, sequence])).toEqual([
      ["1054290306:home-clean-sheet", "YES", "2.95", "DECIMAL", "SUSPENDED", 123.5, 4],
      ["1054290306:home-clean-sheet", "NO", "1.36", "DECIMAL", "SUSPENDED", 123.5, 4],
      ["1054290306:away-clean-sheet", "YES", "3.6", "DECIMAL", "SUSPENDED", 123.5, 4],
      ["1054290306:away-clean-sheet", "NO", "1.22", "DECIMAL", "SUSPENDED", 123.5, 4]
    ]);
  });

  it("inherits compressed field names exactly like the live v2 protocol", () => {
    const decoder = new SabaPushDecoder();
    const result = decoder.apply({ bridgeId: "b9", revision: "z0001", rows: [
      ["f", 0, ["type", "matchid", "oddsid", "odds"]],
      ["f", 4, [7]],
      [0, "reset"], [0, "o", 2, 88, 4, 1.91], [0, "done"]
    ] });
    expect(result.records).toEqual([expect.objectContaining({ type: "o", oddsid: 88, odds: 1.91 })]);
  });

  it("shares the provider field table across rotating bridge ids for the same channel", () => {
    const decoder = new SabaPushDecoder();
    const schema = decoder.apply({ bridgeId: "b100", revision: "schema-1", rows: [
      ["c", "c2", "subscription", "hash"], ["f", 0, fields]
    ] });
    expect(schema.records).toEqual([]);

    const snapshot = decoder.apply({ bridgeId: "b101", revision: "data-1", rows: [
      ["c", "c2", "subscription-2", "hash-2"],
      [0, "reset"],
      [0, "m", 1, 41385687, 4, "T", 5, "running"],
      [0, "o", 2, 90001, 1, 41385687, 3, 1, 6, 2.2, 7, 1],
      [0, "done"]
    ] });

    expect(snapshot).toMatchObject({ fullSnapshot: true, duplicate: false });
    expect(snapshot.records).toEqual([
      expect.objectContaining({ type: "m", matchid: 41385687, marketid: "T" }),
      expect.objectContaining({ type: "o", oddsid: 90001, matchid: 41385687, odds: 2.2 })
    ]);
  });

  it("inherits the sole verified field table when a rotated bridge omits its channel row", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b100", revision: "schema-1", rows: [
      ["c", "c2", "subscription", "hash"], ["f", 0, fields]
    ] });

    const snapshot = decoder.apply({ bridgeId: "b101", revision: "data-1", rows: [
      [0, "reset"],
      [0, "m", 1, 41385687, 4, "T", 5, "running"],
      [0, "o", 2, 90001, 1, 41385687, 3, 1, 6, 2.2, 7, 1],
      [0, "done"]
    ] });

    expect(snapshot).toMatchObject({ fullSnapshot: true, duplicate: false });
    expect(snapshot.records).toEqual([
      expect.objectContaining({ type: "m", matchid: 41385687, marketid: "T" }),
      expect.objectContaining({ type: "o", oddsid: 90001, matchid: 41385687, odds: 2.2 })
    ]);
  });

  it("inherits identical verified catalog tables announced by multiple logical channels", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b100", revision: "schema-1", rows: [
      ["c", "c1"], ["f", 0, fields]
    ] });
    decoder.apply({ bridgeId: "b101", revision: "schema-2", rows: [
      ["c", "c2"], ["f", 0, fields]
    ] });

    const snapshot = decoder.apply({ bridgeId: "b102", revision: "data-1", rows: [
      [0, "reset"], [0, "m", 1, 77, 4, "T"], [0, "done"]
    ] });

    expect(snapshot).toMatchObject({ fullSnapshot: true });
    expect(snapshot.records).toEqual([expect.objectContaining({ type: "m", matchid: 77 })]);
  });

  it("refuses to guess a rotated bridge field table when multiple channels exist", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b100", revision: "schema-1", rows: [
      ["c", "c1"], ["f", 0, ["type", "matchid"]]
    ] });
    decoder.apply({ bridgeId: "b101", revision: "schema-2", rows: [
      ["c", "c2"], ["f", 0, fields]
    ] });

    expect(() => decoder.apply({ bridgeId: "b102", revision: "data-1", rows: [
      [0, "reset"], [0, "done"]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:FIELD_INDEX_UNMAPPED");
  });

  it("fails closed without mutating accepted state on malformed field indexes or incomplete snapshots", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b1", revision: "r1", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, 5], [0, "done"]
    ] });
    expect(() => decoder.apply({ bridgeId: "b1", revision: "r2", rows: [[999, "o", 2, 1]] }))
      .toThrow("SABA_PUSH_SCHEMA_CHANGED");
    expect(decoder.apply({ bridgeId: "b1", revision: "r3", rows: [[0, "reset"]] })).toMatchObject({
      fullSnapshot: false,
      records: [expect.objectContaining({ matchid: 5 })]
    });
    expect(() => decoder.apply({ bridgeId: "b1", revision: "r4", rows: [[999, "m"]] }))
      .toThrow("SABA_PUSH_SCHEMA_CHANGED");
    expect(decoder.apply({ bridgeId: "b1", revision: "r5", rows: [[0, "m", 1, 6], [0, "done"]] })).toMatchObject({
      fullSnapshot: true,
      records: [expect.objectContaining({ matchid: 6 })]
    });
    expect(decoder.apply({ bridgeId: "b1", revision: "r6", rows: [[0, "m", 1, 6, 5, "running"]] }).records)
      .toEqual([expect.objectContaining({ matchid: 6, eventstatus: "running" })]);
  });

  it("publishes a provider snapshot atomically when reset and done arrive in separate frames", () => {
    const decoder = new SabaPushDecoder();
    const opening = decoder.apply({ bridgeId: "b4", revision: "batch-1", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, 5]
    ] });
    expect(opening).toMatchObject({ fullSnapshot: false, records: [], changes: [] });

    const middle = decoder.apply({ bridgeId: "b4", revision: "batch-1", rows: [
      [0, "o", 2, 7, 1, 5, 6, 1.8]
    ] });
    expect(middle.records).toEqual([]);

    const committed = decoder.apply({ bridgeId: "b4", revision: "batch-1", rows: [[0, "done"]] });
    expect(committed).toMatchObject({ fullSnapshot: true, duplicate: false });
    expect(committed.records).toEqual([
      expect.objectContaining({ type: "m", matchid: 5 }),
      expect.objectContaining({ type: "o", oddsid: 7, matchid: 5, odds: 1.8 })
    ]);
    expect(decoder.apply({ bridgeId: "b4", revision: "batch-1", rows: [[0, "done"]] }))
      .toMatchObject({ duplicate: true, changes: [] });
  });

  it("ignores multiplexed non-catalog rows without quarantining catalog state", () => {
    const decoder = new SabaPushDecoder();
    const result = decoder.apply({ bridgeId: "b7", revision: "r1", rows: [
      ["f", 0, ["type", "siteid", "isPeakHour"]],
      [0, "reset"], [0, 88, 1, 12, 2, true], [0, "future-control", 1, 12], [0, "done"]
    ] });
    expect(result).toMatchObject({ fullSnapshot: true, records: [], duplicate: false });
  });

  it("rejects a sequence gap without mutating state and accepts a replacement full snapshot", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b8", revision: "r0001", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, 5], [0, "done"]
    ] });
    expect(() => decoder.apply({ bridgeId: "b8", revision: "r0003", rows: [
      [0, "m", 1, 6]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:SEQUENCE_GAP");
    expect(decoder.apply({ bridgeId: "b8", revision: "r0004", rows: [
      [0, "reset"], [0, "m", 1, 9], [0, "done"]
    ] }).records).toEqual([expect.objectContaining({ matchid: 9 })]);
  });

  it("rejects sparse field offsets synchronously without poisoning a later valid snapshot", () => {
    const decoder = new SabaPushDecoder();
    const startedAt = performance.now();

    expect(() => decoder.apply({ bridgeId: "b1", revision: "r1", rows: [
      ["f", 4_294_967_294, ["type"]]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:BOUND_EXCEEDED");
    expect(performance.now() - startedAt).toBeLessThan(100);

    expect(decoder.apply({ bridgeId: "b1", revision: "r2", rows: [
      ["f", 0, fields], [0, "reset"], [0, "m", 1, 5], [0, "done"]
    ] }).records).toEqual([expect.objectContaining({ matchid: 5 })]);
  });

  it("bounds bridge ids, logical channels, and dense field columns", () => {
    const decoder = new SabaPushDecoder();
    for (let index = 1; index <= 64; index += 1) {
      expect(decoder.apply({ bridgeId: `b${index}`, revision: "r1", rows: [
        ["c", `c${index}`], ["f", 0, ["type"]]
      ] })).toMatchObject({ duplicate: false });
    }
    expect(() => decoder.apply({ bridgeId: "b65", revision: "r1", rows: [
      ["c", "c65"], ["f", 0, ["type"]]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:BOUND_EXCEEDED");

    const rotatingChannels = new SabaPushDecoder();
    for (let index = 1; index <= 64; index += 1) {
      expect(rotatingChannels.apply({ bridgeId: "b1", revision: `schema-${index}`, rows: [
        ["c", `c${index}`], ["f", 0, ["type"]]
      ] })).toMatchObject({ duplicate: false });
    }
    expect(() => rotatingChannels.apply({ bridgeId: "b1", revision: "schema-65", rows: [
      ["c", "c65"], ["f", 0, ["type"]]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:BOUND_EXCEEDED");

    const wide = new SabaPushDecoder();
    expect(() => wide.apply({ bridgeId: "b1", revision: "r1", rows: [
      ["f", 0, Array.from({ length: 513 }, (_, index) => `field${index}`)]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:BOUND_EXCEEDED");
  });

  it("seeds only a field-table context and lets a later genuine reset/done establish the snapshot", () => {
    const decoder = new SabaPushDecoder();
    decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c2"], ["f", 0, fields]
    ] });

    const snapshot = decoder.apply({ bridgeId: "b41", revision: "fresh-1", rows: [
      [0, "reset"],
      [0, "m", 1, 41385687, 4, "T", 5, "running"],
      [0, "o", 2, 90001, 1, 41385687, 3, 1, 6, 2.2, 7, 1],
      [0, "done"]
    ] });

    expect(snapshot).toMatchObject({ fullSnapshot: true, duplicate: false, revision: "fresh-1" });
    expect(snapshot.records).toEqual([
      expect.objectContaining({ type: "m", matchid: 41385687 }),
      expect.objectContaining({ type: "o", oddsid: 90001, matchid: 41385687 })
    ]);
  });

  it("seeds a bridge that already committed a channel-only fresh frame", () => {
    const decoder = new SabaPushDecoder();
    expect(decoder.apply({ bridgeId: "b41", revision: null, rows: [["c", "c2"]] }))
      .toMatchObject({ fullSnapshot: false, records: [] });

    decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c2"], ["f", 0, fields]
    ] });
    expect(decoder.apply({ bridgeId: "b41", revision: "fresh-1", rows: [
      [0, "reset"], [0, "m", 1, 55], [0, "done"]
    ] })).toMatchObject({ fullSnapshot: true,
      records: [expect.objectContaining({ type: "m", matchid: 55 })] });
  });

  it("adds schema fields without closing or replacing an in-progress reset snapshot", () => {
    const decoder = new SabaPushDecoder();
    decoder.apply({ bridgeId: "b41", revision: "batch-1", rows: [
      ["c", "c2"], ["f", 0, ["type"]], [0, "reset"]
    ] });
    decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c2"], ["f", 0, fields]
    ] });

    expect(decoder.apply({ bridgeId: "b41", revision: "batch-1", rows: [
      [0, "m", 1, 55], [0, "done"]
    ] })).toMatchObject({ fullSnapshot: true, revision: "batch-1",
      records: [expect.objectContaining({ type: "m", matchid: 55 })] });
  });

  it("rejects non-schema rows and conflicting schema seeds atomically", () => {
    const decoder = new SabaPushDecoder();
    decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c2"], ["f", 0, fields]
    ] });

    expect(() => decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c2"], [0, "reset"]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:SCHEMA_CONTEXT_ROW_INVALID");
    expect(() => decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c9"], ["f", 0, ["type", "matchid"]]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:SCHEMA_CONTEXT_CHANNEL_CONFLICT");
    expect(() => decoder.seedSchemaContext({ bridgeId: "b41", revision: null, rows: [
      ["c", "c2"], ["f", 0, ["different", "matchid"]]
    ] })).toThrow("SABA_PUSH_SCHEMA_CHANGED:SCHEMA_CONTEXT_FIELD_CONFLICT");

    expect(decoder.apply({ bridgeId: "b41", revision: "fresh-1", rows: [
      [0, "reset"], [0, "m", 1, 5], [0, "done"]
    ] })).toMatchObject({ fullSnapshot: true,
      records: [expect.objectContaining({ type: "m", matchid: 5 })] });
  });

  it.each([
    { name: "revision", frame: { bridgeId: "b1", revision: "old", rows: [["f", 0, fields]] },
      reason: "SCHEMA_CONTEXT_FRAME_INVALID" },
    { name: "missing field row", frame: { bridgeId: "b1", revision: null, rows: [["c", "c1"]] },
      reason: "SCHEMA_CONTEXT_EMPTY" },
    { name: "non-catalog table", frame: { bridgeId: "b1", revision: null,
      rows: [["c", "c1"], ["f", 0, ["type", "siteid"]]] }, reason: "SCHEMA_CONTEXT_NON_CATALOG" },
    { name: "wide table", frame: { bridgeId: "b1", revision: null,
      rows: [["c", "c1"], ["f", 0, Array.from({ length: 513 }, (_, index) => `f${index}`)]] },
      reason: "BOUND_EXCEEDED" },
    { name: "oversized bridge id", frame: { bridgeId: `b${"1".repeat(64)}`, revision: null,
      rows: [["f", 0, ["type", "matchid"]]] }, reason: "SCHEMA_CONTEXT_FRAME_INVALID" }
  ])("strictly bounds a $name schema context", ({ frame, reason }) => {
    expect(() => new SabaPushDecoder().seedSchemaContext(frame))
      .toThrow(`SABA_PUSH_SCHEMA_CHANGED:${reason}`);
  });
});
