# CMD Chunked Catalog Design

## Goal

Read the complete CMD football catalog from the attached authenticated Chrome tab without exceeding the bridge's 256 KiB per-message safety limit. Preserve every supported two-outcome market and exclude exact-score and three-outcome markets from arbitrage comparison.

## Scope

- Source: the already attached CMD Chrome tab.
- Included: full-time Asian handicap and full-time totals at every available line.
- Excluded: exact score, 1X2/draw markets, unsupported or locked prices.
- Read-only: no bet placement or interaction with the sportsbook UI.

## Wire Format

Each `DOM_SNAPSHOT` payload is a strict version-2 JSON envelope:

```ts
interface CmdSnapshotChunk {
  schemaVersion: 2;
  snapshotId: string;
  chunkIndex: number;
  chunkCount: number;
  records: CmdCatalogInputRecord[];
}
```

The extension partitions records so every serialized payload is at most 240,000 bytes. It sends chunks in index order. `snapshotId` is unique per complete observation cycle.

## Receiver Semantics

The CMD adapter buffers chunks by `sourceId + snapshotId`. It rejects inconsistent `chunkCount`, duplicate indices with different content, invalid indices, oversized assemblies, and expired incomplete snapshots. It emits one catalog update only after every chunk is present. The assembled catalog replaces the previous catalog atomically; incomplete snapshots never clear or partially replace accepted data.

## Update Strategy

The initial implementation sends complete chunked snapshots and suppresses byte-identical observations. The extension evaluates the current DOM without clicks and does not read cookies, storage, credentials, URLs, or form values. A later network-price decoder may replace repeated DOM price transfer, but it is not required for correctness of the complete catalog.

## Safety and Performance

- Maximum 240,000 serialized bytes per chunk.
- Maximum 64 chunks and 20 MiB buffered per source snapshot.
- Incomplete assembly TTL: 10 seconds.
- At most one in-flight CMD DOM read per tab.
- Exact score and three-outcome 1X2 never enter the comparison catalog.
- Existing accepted catalog remains visible but stale if a new snapshot cannot be completed.

## Verification

- Contract tests cover strict chunk schema and bounds.
- Extension tests cover deterministic chunking, all-record preservation, and per-message byte limits.
- API tests cover out-of-order assembly, duplicate replay, conflicting chunks, timeout, and atomic publication.
- Live verification proves CMD bridge `LIVE`, more than zero events/markets, and no payload over the bridge limit.
