import { describe, expect, it } from "vitest";
import { BTI_SOURCE_INVENTORY_EXPRESSION } from "./bti-source-inventory.js";

function inspect(root: object) {
  return new Function("document", `return ${BTI_SOURCE_INVENTORY_EXPRESSION}`)({ documentElement: root });
}

describe("BTI existing source inventory", () => {
  it("counts native rows, empty detail and conflicting live membership without exposing private data", () => {
    const event = Array(34).fill(null);
    const market = Array(24).fill(null);
    market[0] = 456; market[5] = ["OU39"]; market[13] = [[789], ["under"], null];
    event[0] = 123; event[20] = [market];
    const league = Array(13).fill(null);
    league[12] = [["a", null, null, null, null, false], ["b", null, null, null, null, false]];
    const liveLeague = [...league]; liveLeague[12] = [["b", null, null, null, null, true]];
    const root = {
      __fieldlineBtiRosterWorkerV10: { result: { responses: [
        { url: "/api/eventlist/asia/leagues/v2/1/prematch/initial", body: JSON.stringify({ serializedData: [league] }) },
        { url: "/api/eventlist/asia/leagues/v2/1/live", body: JSON.stringify({ serializedData: [liveLeague] }) },
        { url: "/api/eventlist/asia/leagues/v2/1/live/initial", body: '{"serializedData":[]}' }
      ] } },
      __fieldlineBtiDetailBodiesV10: [
        { eventId: "123", body: JSON.stringify({ data: [event], secret: "never-copy-this" }) },
        { eventId: "empty", body: '{"data":[]}' }
      ],
      get authorization(): never { throw new Error("must not access credentials"); }
    };
    const result = inspect(root);
    expect(result).toMatchObject({ nativeRosterEvents: 2, nativePrematchEvents: 1,
      nativeLiveEvents: 1, nativeDetailEvents: 2, nativeMarketRows: 1, nativeSelectionRows: 3,
      nativeNumericIds: 3, nativeMalformedRows: 1, nativeTypeCounts: "OU39:1", nativeInventoryTruncated: false });
    expect(JSON.stringify(result)).not.toContain("never-copy-this");
    expect(root.__fieldlineBtiDetailBodiesV10).toHaveLength(2);
  });

  it("marks an oversized source body incomplete without parsing or copying it", () => {
    expect(inspect({ __fieldlineBtiDetailBodiesV10: [{ body: "x".repeat(2 * 1024 * 1024 + 1) }] }))
      .toMatchObject({ nativeInventoryTruncated: true, nativeDetailEvents: 0, nativeMarketRows: 0 });
  });

  it("bounds unknown native groups and never copies arbitrary labels as a native code", () => {
    const event = Array(34).fill(null); event[0] = "event";
    event[20] = Array.from({ length: 34 }, (_, index) => {
      const market = Array(24).fill(null); market[0] = `m${index}`;
      market[5] = [index === 0 ? "private token abc" : `NATIVE${index}`]; market[13] = [];
      return market;
    });
    const result = inspect({ __fieldlineBtiDetailBodiesV10: [{ eventId: "event", body: JSON.stringify({ data: [event] }) }] });
    expect(result.nativeInventoryTruncated).toBe(false);
    expect(result.nativeMarketRows).toBe(34);
    expect(result.nativeTypeCountsTruncated).toBe(true);
    expect(result.nativeTypeCounts.split(",")).toHaveLength(32);
    expect(JSON.stringify(result)).not.toContain("private token");
  });
});
