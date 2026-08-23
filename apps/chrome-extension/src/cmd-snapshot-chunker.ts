import type { CmdSnapshotChunk } from "@tool-chenh/contracts";
import { utf8ByteLength } from "./utf8-length.js";

// The bridge limit applies to the complete WebSocket envelope. The chunk is
// serialized once into payload.body and escaped again when the envelope is
// serialized, so its body must stay comfortably below the 256 KiB wire limit.
const DEFAULT_MAX_CHUNK_BODY_BYTES = 110_000;

type CmdSweepBinding = {
  readonly sweepId: string;
  readonly sweepComplete: boolean;
  readonly sweepFrameKey: string;
  readonly sweepDocumentKey: string;
};

function envelope(snapshotId: string, chunkIndex: number, chunkCount: number,
  records: readonly unknown[], sweep?: CmdSweepBinding): CmdSnapshotChunk {
  return { schemaVersion: 2, snapshotId, chunkIndex, chunkCount, records: [...records], ...sweep };
}

export function chunkCmdSnapshot(records: readonly unknown[], snapshotId: string,
  maxBytes = DEFAULT_MAX_CHUNK_BODY_BYTES,
  sweep?: CmdSweepBinding): readonly CmdSnapshotChunk[] {
  if (records.length === 0) return sweep?.sweepComplete === true
    ? [envelope(snapshotId, 0, 1, [], sweep)] : [];
  // Serialize each record exactly once. A chunk body is the fixed envelope
  // wrapper (measured with an empty records array, using the widest index
  // labels) plus the records joined by commas, so the byte size of a group
  // can be tracked incrementally instead of re-serializing the growing group
  // for every record.
  const wrapperBytes = utf8ByteLength(JSON.stringify(envelope(snapshotId, 63, 64, [], sweep)));
  const groups: unknown[][] = [];
  let current: unknown[] = [];
  let currentBytes = 0;
  for (const record of records) {
    const serialized = JSON.stringify(record);
    if (serialized === undefined) throw new Error("CMD_SNAPSHOT_RECORD_TOO_LARGE");
    const recordBytes = utf8ByteLength(serialized);
    if (wrapperBytes + recordBytes > maxBytes) throw new Error("CMD_SNAPSHOT_RECORD_TOO_LARGE");
    const separator = current.length > 0 ? 1 : 0;
    if (current.length > 0 && wrapperBytes + currentBytes + separator + recordBytes > maxBytes) {
      groups.push(current);
      current = [record];
      currentBytes = recordBytes;
    } else {
      current.push(record);
      currentBytes += separator + recordBytes;
    }
  }
  if (current.length > 0) groups.push(current);
  if (groups.length > 64) throw new Error("CMD_SNAPSHOT_TOO_MANY_CHUNKS");
  return groups.map((group, index) => envelope(snapshotId, index, groups.length, group, sweep));
}
