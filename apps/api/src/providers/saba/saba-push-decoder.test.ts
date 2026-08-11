import { describe, expect, it } from "vitest";
import { SabaPushDecoder } from "./saba-push-decoder.js";

const fields = [
  "type", "matchid", "oddsid", "bettype", "marketid", "eventstatus", "odds", "enable"
] as const;

describe("SabaPushDecoder", () => {
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

  it("inherits compressed field names exactly like the live v2 protocol", () => {
    const decoder = new SabaPushDecoder();
    const result = decoder.apply({ bridgeId: "b9", revision: "z0001", rows: [
      ["f", 0, ["type", "matchid", "oddsid", "odds"]],
      ["f", 4, [7]],
      [0, "reset"], [0, "o", 2, 88, 4, 1.91], [0, "done"]
    ] });
    expect(result.records).toEqual([expect.objectContaining({ type: "o", oddsid: 88, odds: 1.91 })]);
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
});
