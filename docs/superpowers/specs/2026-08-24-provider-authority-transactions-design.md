# Provider Authority Transactions Design

**Status:** Approved prerequisite amendment after the Task 6 breaker review

**Goal:** Make provider ownership, catalog completeness, provenance, ordering, and liveness one atomic authority transaction so syntactically valid but unproven evidence can never replace or refresh an executable feed.

## Why this amendment exists

Task 6 established provider-specific collectors and bounded recovery, but the final breaker review proved that authority was still decided independently by the bridge registry, control plane, adapters, coverage guard, and feed controller. That split allowed replayed candidates to steal routing, configuration-only resets to become empty catalogs, DOM prices to be relabelled as WS prices, and unordered KSPORT HTTP recovery to overwrite newer WS evidence.

This amendment is a prerequisite to APSPORT/BTI work. Task 7 must not change the shared adapter, controller, data-plane, observer, or bridge contracts until this design is implemented and independently approved.

## Non-negotiable invariants

1. Each provider account owns at most one active authority lane and one candidate lane.
2. Registry ACK, tab reachability, OPEN, heartbeat, replay, partial data, or syntactically valid non-catalog data never promotes a candidate.
3. Promotion is an API-internal compare-and-swap after a complete catalog proof is prepared. It atomically changes feed, coverage, registry ownership, and control routing before publishing.
4. Network authority contains only records proven by that network lineage. DOM-only events, markets, selections, prices, or statuses never enter a WS/HTTP-authoritative catalog.
5. An empty decoded record list is not proof that a football catalog is empty.
6. KSPORT WS lifecycle, WS data, and generated HTTP recovery share one ordering ledger. Evidence that cannot be ordered is rejected, never guessed.
7. Replacement OPEN immediately stalls the WS authority it supersedes; only a strictly newer complete baseline restores it.
8. Replay is diagnostic only. It cannot create, refresh, invalidate, supersede, or promote authority and cannot mutate a live decoder lane.
9. All long-lived maps, sets, assemblers, candidates, coverage history, decoder fields, and control routes have exact fixed bounds. Bound exhaustion fails closed and requires a newer recovery generation; eviction must never make old evidence admissible.
10. A fault or promotion for one provider leaves the other five providers' source identity, catalog revision, status, control target, and recovery counters unchanged.

## Authority model

`ProviderAuthorityCoordinator` is the only component allowed to change account ownership:

```ts
export interface AuthorityIdentity {
  readonly accountId: string;
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly connectionGeneration: number;
}

export interface AuthorityCandidateToken {
  readonly accountId: string;
  readonly nonce: number;
}

export interface AuthoritySlotSnapshot {
  readonly active: AuthorityIdentity | null;
  readonly candidate: AuthorityIdentity | null;
}
```

The coordinator owns a fixed six-account map. `observe()` may keep the current lane, create/replace the one candidate lane, or reject evidence. It does not change the active registry/control target. `promote()` accepts only the current candidate token and a prepared `CatalogCommitProof`, then atomically swaps the active lane. A late candidate token or retired connection is rejected.

The registry authenticates and sequence-checks transport connections but reports candidates to the coordinator. The control plane has one active target and at most one explicitly addressed candidate bootstrap target per account. Routine recovery, focus, and snapshot commands use the active target.

## Catalog proof

Adapters return an internal proof rather than relying on `authoritativeBaseline: true` alone:

```ts
export type CatalogEmptyProof = "NONEMPTY" | "PROVIDER_CONFIRMED_EMPTY";

export interface CatalogCommitProof {
  readonly authorityCursor: bigint;
  readonly provenance: "WS" | "AUTHENTICATED_HTTP";
  readonly contentClass: "FOOTBALL";
  readonly completeness: "COMPLETE";
  readonly scope: "ACCOUNT" | "PROVIDER_PARTITION" | "SABA_CHANNEL";
  readonly completedPartitions: readonly string[];
  readonly emptyProof: CatalogEmptyProof;
  readonly catalog: ObservedProviderCatalog;
}
```

The API derives proof from the exact endpoint or socket destination, strict decoded schema, source/document/request identity, and adapter state. Browser-supplied intent is necessary routing evidence but is never sufficient authority by itself.

### Empty catalog rules

- SABA reset/done proves only completion of a characterized logical channel. Configuration/control-only content is `NON_CATALOG`.
- A proven empty SABA channel may tombstone only that previously proven football channel. SABA cannot emit an account-wide empty catalog until a complete football-channel manifest is characterized.
- KSPORT may commit an empty account only when exact football `LIVE` and `TODAY` partitions share one generation/cutoff and each response matches a characterized football-empty root or a strict complete football response.
- Shallow league/configuration objects and unsupported rows that normalize to zero events are not empty proof.

## Provenance planes

Each lane stores network and DOM catalogs separately. WS/HTTP commits operate only on the network catalog. DOM may be published as explicit `DOM_FALLBACK` diagnostic state, but cannot introduce executable identity or prices into a network catalog. Descriptive DOM augmentation is excluded until field-level provenance exists.

## KSPORT unified ordering

Generated HTTP recovery adds exact all-or-none metadata:

```ts
requestStartSequence: number;
providerPartition: "KSPORT_LIVE" | "KSPORT_TODAY";
providerContentIntent: "FOOTBALL_FULL_CATALOG";
```

Both parts use the same request generation, cutoff, intent, source, epoch, tab, frame, and document. Any current-source WS frame or OPEN/CLOSE with envelope sequence greater than `requestStartSequence` permanently fences the HTTP pair. After HTTP authority commits, old WS deltas are rejected; returning to WS authority requires a new complete live+today WS pair. WS receipt and lifecycle high-watermarks survive close and replacement open for the source epoch.

## SABA liveness and bounds

Only exact characterized Engine.IO ping/pong on the current non-replayed stream emits `transportAlive`. It works only after a complete baseline for the same active lane and never extends authority beyond `maxBaselineAgeMs`.

Per SABA lane bounds are 64 bridge IDs, 64 logical channels, and 512 field columns. Field-table offsets and alias ranges are checked before indexed assignment. Bound or schema failure faults that stream, clears its authority, and requires a strictly higher OPEN plus baseline. No silent eviction is allowed.

## Coverage and restored state

Coverage belongs to its authority lane and is swapped on promotion. It stores the current comparable authority cursor and bounded accepted event identities, not every historical opaque generation. A discarded candidate discards its coverage. Restored legacy catalogs remain stale/display-only until a fresh proof commits.

## Acceptance

- No account-wide empty commit lacks football completeness and safe-empty proof.
- No network-authoritative catalog contains a DOM-only executable identity or quote.
- Registry, coordinator, control plane, data plane, feed controller, and diagnostics agree on the active source.
- The full KSPORT HTTP/WS/lifecycle race table is green.
- SABA heartbeat, decoder bounds, and huge sparse offset probes fail safely.
- State remains fixed-size under 50,000 malformed/generation inputs and 1,000 source turnovers.
- Faulting or promoting each provider in turn leaves the other five byte-for-byte invariant.
- Contracts, API, extension, all provider regressions, typechecks, and builds pass.
- An independent breaker review reports zero Critical and zero Important findings.
