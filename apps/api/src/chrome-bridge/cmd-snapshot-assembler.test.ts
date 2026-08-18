import { describe, expect, it } from "vitest";
import { CmdSnapshotAssembler } from "./cmd-snapshot-assembler.js";

const chunk = (snapshotId: string, chunkIndex: number, chunkCount: number, records: unknown[]) => ({
  schemaVersion: 2 as const,
  snapshotId,
  chunkIndex,
  chunkCount,
  records
});

describe("CmdSnapshotAssembler", () => {
  it("publishes once only after every out-of-order chunk is present", () => {
    const assembler = new CmdSnapshotAssembler();
    const id = "cmd:9:complete-0001";
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 1, 3, ["b"]), 1)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 0, 3, ["a"]), 2)).toBeNull();
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 2, 3, ["c"]), 3)).toEqual(["a", "b", "c"]);
    expect(assembler.ingest("chrome:CMD:9", chunk(id, 2, 3, ["c"]), 4)).toBeNull();
  });

  it("invalidates conflicting chunks and never mixes sources", () => {
    const assembler = new CmdSnapshotAssembler();
    const id = "cmd:9:conflict-0001";
    expect(assembler.ingest("source-a", chunk(id, 0, 2, ["a"]), 1)).toBeNull();
    expect(assembler.ingest("source-a", chunk(id, 0, 2, ["changed"]), 2)).toBeNull();
    expect(assembler.ingest("source-a", chunk(id, 1, 2, ["b"]), 3)).toBeNull();
    expect(assembler.ingest("source-b", chunk(id, 0, 2, ["x"]), 4)).toBeNull();
    expect(assembler.ingest("source-b", chunk(id, 1, 2, ["y"]), 5)).toEqual(["x", "y"]);
  });

  it("expires incomplete snapshots and rejects oversized assemblies", () => {
    const assembler = new CmdSnapshotAssembler({ ttlMs: 10, maxBufferedBytes: 40 });
    const expired = "cmd:9:expired-0001";
    expect(assembler.ingest("source", chunk(expired, 0, 2, ["a"]), 0)).toBeNull();
    expect(assembler.ingest("source", chunk(expired, 1, 2, ["b"]), 11)).toBeNull();

    const oversized = "cmd:9:oversized-001";
    expect(assembler.ingest("source", chunk(oversized, 0, 2, ["x".repeat(30)]), 20)).toBeNull();
    expect(assembler.ingest("source", chunk(oversized, 1, 2, ["y".repeat(30)]), 21)).toBeNull();
  });
});
