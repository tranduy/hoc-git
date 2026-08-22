import type { CmdSnapshotChunk } from "@tool-chenh/contracts";

// The bridge limit applies to the complete WebSocket envelope. The chunk is
// serialized once into payload.body and escaped again when the envelope is
// serialized, so its body must stay comfortably below the 256 KiB wire limit.
const DEFAULT_MAX_CHUNK_BODY_BYTES = 110_000;

const byteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

function envelope(snapshotId: string, chunkIndex: number, chunkCount: number,
  records: readonly unknown[]): CmdSnapshotChunk {
  return { schemaVersion: 2, snapshotId, chunkIndex, chunkCount, records: [...records] };
}

export function chunkCmdSnapshot(records: readonly unknown[], snapshotId: string,
  maxBytes = DEFAULT_MAX_CHUNK_BODY_BYTES): readonly CmdSnapshotChunk[] {
  if (records.length === 0) return [];
  const groups: unknown[][] = [];
  let current: unknown[] = [];
  for (const record of records) {
    if (byteLength(envelope(snapshotId, 63, 64, [record])) > maxBytes) {
      throw new Error("CMD_SNAPSHOT_RECORD_TOO_LARGE");
    }
    const candidate = [...current, record];
    if (current.length > 0 && byteLength(envelope(snapshotId, 63, 64, candidate)) > maxBytes) {
      groups.push(current);
      current = [record];
    } else current = candidate;
  }
  if (current.length > 0) groups.push(current);
  if (groups.length > 64) throw new Error("CMD_SNAPSHOT_TOO_MANY_CHUNKS");
  return groups.map((group, index) => envelope(snapshotId, index, groups.length, group));
}
