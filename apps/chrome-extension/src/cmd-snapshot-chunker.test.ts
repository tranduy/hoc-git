import { describe, expect, it } from "vitest";
import { chunkCmdSnapshot } from "./cmd-snapshot-chunker.js";
import { redactNetworkEnvelope } from "./redactor.js";

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("chunkCmdSnapshot", () => {
  it("preserves all 783 records while keeping every serialized chunk within the byte limit", () => {
    const records = Array.from({ length: 783 }, (_, index) => ({
      matchId: `match-${index}`,
      leagueName: `League ${index}`,
      teamNames: [`Home ${index}`, `Away ${index}`],
      groups: [{ betTypeIds: ["1"], labels: ["0.5"], odds: [
        { marketOddsId: `m-${index}`, priceText: "0.91", status: null, greyedOut: null, lineText: "0.5" },
        { marketOddsId: `m-${index}`, priceText: "-0.99", status: null, greyedOut: null }
      ] }],
      padding: "x".repeat(500)
    }));

    const chunks = chunkCmdSnapshot(records, "cmd-1786776000000-abcdef", 20_000);

    expect(chunks.flatMap((chunk) => chunk.records)).toEqual(records);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => bytes(chunk) <= 20_000)).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.chunkCount === chunks.length)).toBe(true);
  });

  it("rejects a single oversized record and more than 64 chunks", () => {
    expect(() => chunkCmdSnapshot([{ body: "x".repeat(500) }], "cmd-1786776000000-abcdef", 100))
      .toThrow("CMD_SNAPSHOT_RECORD_TOO_LARGE");
    expect(() => chunkCmdSnapshot(Array.from({ length: 65 }, (_, id) => ({ id, body: "x".repeat(60) })),
      "cmd-1786776000000-abcdef", 220)).toThrow("CMD_SNAPSHOT_TOO_MANY_CHUNKS");
  });

  it("emits one explicit completed chunk for an empty same-document sweep", () => {
    expect(chunkCmdSnapshot([], "cmd:9:empty-complete-0001", undefined, {
      sweepId: "cmd:sweep:empty", sweepComplete: true, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1"
    })).toEqual([{
      schemaVersion: 2, snapshotId: "cmd:9:empty-complete-0001", chunkIndex: 0, chunkCount: 1,
      records: [], sweepId: "cmd:sweep:empty", sweepComplete: true, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1"
    }]);
    expect(chunkCmdSnapshot([], "cmd:9:empty-partial-0001", undefined, {
      sweepId: "cmd:sweep:partial", sweepComplete: false, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1"
    })).toEqual([]);
  });

  it("keeps the complete quote-dense WebSocket envelope below 256 KiB", () => {
    const records = Array.from({ length: 300 }, (_, index) => ({
      sportId: "1", leagueId: `league-${index}`, leagueName: `League ${index}`,
      matchId: `match-${index}`, timeText: "22:00Live", teamNames: [`Home ${index}`, `Away ${index}`],
      groups: Array.from({ length: 6 }, (_, group) => ({
        betTypeIds: [group % 2 === 0 ? "1" : "3"], labels: ["0.5"], odds: [
          { marketOddsId: `market-${index}-${group}`, priceText: "0.91", status: null, greyedOut: null, lineText: "0.5" },
          { marketOddsId: `market-${index}-${group}`, priceText: "-0.99", status: null, greyedOut: null }
        ]
      }))
    }));
    const chunks = chunkCmdSnapshot(records, "cmd:9:quote-dense-0001");
    expect(chunks.flatMap((chunk) => chunk.records)).toEqual(records);
    for (const [sequence, chunk] of chunks.entries()) {
      expect(() => redactNetworkEnvelope({
        version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, sequence,
        observedAtMs: 1, receivedMonotonicMs: 1, transport: "DOM_SNAPSHOT",
        request: { url: "https://cmd.example/__fieldline_dom_snapshot__", resourceType: "DOM" },
        payload: { encoding: "UTF8", body: JSON.stringify(chunk) }
      })).not.toThrow();
    }
  });
});
