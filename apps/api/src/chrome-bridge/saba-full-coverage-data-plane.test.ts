import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";

describe("SABA production coverage", () => {
  it.each([20, 50])("does not promote %i DOM events with unconfirmed timezone", (count) => {
    const now = Date.UTC(2026, 8, 9, 1);
    const publish = vi.fn();
    const rejected = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, publish, onIngestRejected: rejected });
    for (const sequence of [1, 2, 3]) {
      const envelope: ChromeBridgeEnvelope = {
        version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7",
        sourceEpoch: "worker-a:0", tabId: 7, sequence, observedAtMs: now,
        receivedMonotonicMs: 100 + sequence, transport: "DOM_SNAPSHOT",
        request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
        payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
          snapshotId: `saba:7:partial-viewport-${sequence}`, chunkIndex: 0, chunkCount: 1,
          records: Array.from({ length: count }, (_, index) => ({
            sportId: "1", leagueId: "1", leagueName: "League", matchId: String(index + 1),
            timeText: "1H0'", teamNames: [`Home ${index}`, `Away ${index}`],
            groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
              { marketOddsId: String(index + 100), priceText: "0.92", lineText: "0.5", status: null, greyedOut: null },
              { marketOddsId: String(index + 100), priceText: "-0.98", status: null, greyedOut: null }
            ] }]
          })) }) }
      };
      expect(plane.ingest(envelope)).toBe(false);
    }
    expect(publish).not.toHaveBeenCalled();
    expect(rejected.mock.calls.at(-1)?.[1]).toBe("ADAPTER_DECODE_EMPTY:saba-ws-catalog-v1");
  });

  it("accepts two current stable DOM captures with explicit timezone while native decoding is unavailable", () => {
    const now = Date.UTC(2026, 8, 9, 1);
    const publish = vi.fn();
    const plane = new ChromeCatalogDataPlane({ now: () => now, publish });
    const capture = (sequence: number, count = 50, sourceEpoch = "worker-a:0"): ChromeBridgeEnvelope => ({
      version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", sourceEpoch,
      tabId: 7, sequence, observedAtMs: now, receivedMonotonicMs: 100 + sequence,
      transport: "DOM_SNAPSHOT", request: { hostname: "sports.example",
        pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: JSON.stringify({ schemaVersion: 2,
        snapshotId: `saba:7:confirmed-${sequence}`, chunkIndex: 0, chunkCount: 1,
        records: Array.from({ length: count }, (_, index) => ({ sportId: "1", leagueId: "1",
          leagueName: "League", matchId: String(index + 1), timeText: "1H0'",
          providerTimezoneOffsetMinutes: 420, teamNames: [`Home ${index}`, `Away ${index}`],
          groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
            { marketOddsId: String(index + 100), priceText: sequence > 2 ? "0.82" : "0.92",
              lineText: "0.5", status: null, greyedOut: null },
            { marketOddsId: String(index + 100), priceText: "-0.98", status: null, greyedOut: null }
          ] }] })) }) }
    });
    expect(plane.ingest(capture(1))).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(plane.ingest(capture(2))).toBe(true);
    expect(plane.ingest(capture(3))).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
    // A smaller viewport cannot erase the accepted inventory in one capture.
    expect(plane.ingest(capture(4, 20))).toBe(false);
    expect(publish).toHaveBeenCalledTimes(2);
    // A new source epoch must independently establish its own DOM proof.
    expect(plane.ingest(capture(5, 50, "worker-a:1"))).toBe(false);
  });
});
