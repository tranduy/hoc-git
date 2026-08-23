import { describe, expect, it } from "vitest";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";

const chunk = (snapshotId: string, chunkIndex: number, chunkCount: number, records: unknown[], sweep?: {
  readonly sweepId: string; readonly sweepComplete: boolean; readonly sweepFrameKey: string;
  readonly sweepDocumentKey: string;
}) => ({
  schemaVersion: 2 as const,
  snapshotId,
  chunkIndex,
  chunkCount,
  records,
  ...sweep
});

describe("CmdSnapshotAssembler", () => {
  it("publishes once only after every out-of-order chunk is present", () => {
    const assembler = new CmdSnapshotAssembler();
    const id = "cmd:9:complete-0001";
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 1, 3, ["b"]), 1, 10)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 0, 3, ["a"]), 2, 10)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 2, 3, ["c"]), 3, 10)).toEqual(["a", "b", "c"]);
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 2, 3, ["c"]), 4, 10)).toBeNull();
  });

  it("never completes an older generation after a newer snapshot has started", () => {
    const assembler = new CmdSnapshotAssembler();
    const source = "chrome:CMD:9";
    expect(assembler.ingest(source, chunk("cmd:9:old-generation", 0, 2, ["old-a"]), 1, 100)).toBeNull();
    expect(assembler.ingest(source, chunk("cmd:9:new-generation", 0, 1, ["new"]), 2, 200)).toEqual(["new"]);
    expect(assembler.ingest(source, chunk("cmd:9:old-generation", 1, 2, ["old-b"]), 3, 100)).toBeNull();
  });

  it("invalidates conflicting chunks and never mixes sources", () => {
    const assembler = new CmdSnapshotAssembler();
    const id = "cmd:9:conflict-0001";
    expect(assembler.ingest("source-a", chunk(id, 0, 2, ["a"]), 1, 10)).toBeNull();
    expect(assembler.ingest("source-a", chunk(id, 0, 2, ["changed"]), 2, 10)).toBeNull();
    expect(assembler.ingest("source-a", chunk(id, 1, 2, ["b"]), 3, 10)).toBeNull();
    expect(assembler.ingest("source-b", chunk(id, 0, 2, ["x"]), 4, 10)).toBeNull();
    expect(assembler.ingest("source-b", chunk(id, 1, 2, ["y"]), 5, 10)).toEqual(["x", "y"]);
  });

  it("rejects conflicting sweep document metadata across chunks", () => {
    const assembler = new CmdSnapshotAssembler();
    const id = "cmd:9:sweep-conflict-0001";
    const base = { sweepId: "cmd:sweep:1", sweepComplete: false, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1" };
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 0, 2, ["a"], base), 1, 10)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 1, 2, ["b"], {
      ...base, sweepDocumentKey: "worker-b:9:odds-frame:document-2"
    }), 2, 10)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 1, 2, ["b"], base), 3, 10)).toBeNull();
  });

  it("assembles a normal multi-chunk sweep only when every binding matches", () => {
    const assembler = new CmdSnapshotAssembler();
    const id = "cmd:9:sweep-complete-0001";
    const sweep = { sweepId: "cmd:sweep:1", sweepComplete: false, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1" };
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 1, 2, ["b"], sweep), 1, 10)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 0, 2, ["a"], sweep), 2, 10)).toEqual(["a", "b"]);
  });

  it("expires incomplete snapshots and rejects oversized assemblies", () => {
    const assembler = new CmdSnapshotAssembler({ ttlMs: 10, maxBufferedBytes: 40 });
    const expired = "cmd:9:expired-0001";
    expect(assembler.ingest("source", chunk(expired, 0, 2, ["a"]), 0, 10)).toBeNull();
    expect(assembler.ingest("source", chunk(expired, 1, 2, ["b"]), 11, 10)).toBeNull();

    const oversized = "cmd:9:oversized-001";
    expect(assembler.ingest("source", chunk(oversized, 0, 2, ["x".repeat(30)]), 20, 20)).toBeNull();
    expect(assembler.ingest("source", chunk(oversized, 1, 2, ["y".repeat(30)]), 21, 20)).toBeNull();
  });
});
