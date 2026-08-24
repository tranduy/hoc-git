# APSPORT/TSPORT Worker Task

Priority: 1

Report: `docs/superpowers/reports/five-provider/apsport.md`

## Required Reading

Read `common.md`, `ownership.md`, and the parallel runtime design before touching code. Follow the APSPORT whitelist exactly.

## Proven Root Cause

Candidate recovery currently yields a TSPORT DOM capture, but candidate DOM authority is intentionally forbidden. Existing WS updates do not provide a complete new-stream baseline generation/provenance, so they cannot promote APSPORT to active authority.

DOM values must not become the authoritative quote catalog. DOM may provide an expected event-ID set that proves whether a fresh event-socket replay is complete.

## Required Invariant

- A complete current-document DOM sweep records expected event identities only; it never establishes WS authority and its prices never enter a WS baseline.
- A strictly fresh TSPORT event stream has a new generation scoped by source epoch and stream ID.
- Fresh WS event frames stage provider-native quotes until their event IDs cover the expected DOM event-ID set.
- Partial coverage emits no authoritative baseline.
- Full coverage emits exactly one WS-only `BASELINE` with `authoritativeBaseline: true`, `provenance: "WS"`, and the fresh generation.
- Later current-stream frames emit `DELTA` against the same generation.
- New streams start with empty coverage; stale-stream frames cannot complete them.
- If the provider does not replay every expected event, APSPORT remains fail-closed.

Use a separate `tsport-authority-assembler` only if it makes these rules explicit and bounded. Do not invent a timeout quorum or import DOM odds.

## TDD Cases

1. Complete DOM capture alone produces no authoritative WS update.
2. Fresh WS coverage missing one expected event produces no baseline.
3. The final covering WS frame emits one WS-only baseline.
4. Every baseline quote value is from the WS frame set, even when DOM values differ.
5. A later same-stream price/status update emits a same-generation delta.
6. A new stream cannot reuse prior-stream coverage.
7. Retired/stale stream frames cannot complete or mutate the current generation.
8. Complete authoritative empty handling is accepted only when an explicit complete empty expected set and fresh stream protocol prove it; an absent/partial set is not empty authority.

## Focused Commands

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/tsport-ws-adapter.test.ts src/chrome-bridge/tsport-authority-assembler.test.ts
npm.cmd run typecheck --workspace @tool-chenh/api -- --pretty false
git diff --check -- apps/api/src/chrome-bridge/tsport-ws-adapter.ts apps/api/src/chrome-bridge/tsport-ws-adapter.test.ts apps/api/src/chrome-bridge/tsport-authority-assembler.ts apps/api/src/chrome-bridge/tsport-authority-assembler.test.ts
```

If the optional assembler files are unnecessary, do not create them and omit them from the command.

## Required Shared Integration Request

The report must describe exact extension/data-plane wiring that:

- routes TSPORT recovery through observer catalog refresh rather than CMD capture;
- captures the current DOM expected-ID set;
- closes/reconnects only the matching TSPORT football event socket in the same tab;
- discovers that socket after a source-epoch reset cleared cached socket metadata;
- never reloads, navigates, or replaces the tab;
- passes expected identities and stream metadata to the adapter without granting DOM authority;
- proves candidate DOM remains unpromoted and complete fresh WS coverage performs one atomic promotion.

Shared socket wiring belongs to the common base. If runtime proves it defective, send the exact failing test/symbol to the root while continuing provider-local work.

## Phase A — LOCAL_GREEN

After focused GREEN, API typecheck, scoped diff check, and redacted secret scan,
update only the APSPORT report to `LOCAL_GREEN` while the edit lease remains
live. Release it in `finally`, notify root with `LOCAL_GREEN APSPORT`, and wait
without editing, building, restarting, reloading, recovering, or beginning
acceptance. APSPORT never claims a deployment lease.

## Phase C — End-to-End Realtime Gate

Only after root publishes `ACCEPTANCE_ROUND <ROUND_ID> <BUILD_IDENTITY>`, resolve
the exact current TSPORT source and begin the acceptance lease with
`begin-acceptance APSPORT <worker> chrome:TSPORT:<exact-tab-id>`. Always call
`end-acceptance` in `finally`:

Run the provider sampler without building:

```powershell
node scripts/verify-apsport-runtime.mjs 120000 .run/five-provider/apsport-runtime-evidence.json
```

1. Require candidate DOM capture alone to remain non-authoritative.
2. Require a fresh current TSPORT event stream to cover the current expected event IDs and emit one WS-only authoritative baseline.
3. Require APSPORT to become `ACTIVE` and `LIVE/FRESH`; inspect the resulting catalog to ensure authoritative quote values came from WS rather than DOM.
4. Sample for at least 120 seconds and record at least three current WS evidence advances plus a semantic delta when emitted.
5. Trigger one APSPORT-targeted recovery, require only the exact football event socket to reconnect in the same tab, and prove all other provider sources remain unchanged.
6. If every gate passes, end acceptance and report
   `ACCEPTANCE_PASS <ROUND_ID> APSPORT`; do not edit the report to `DONE` yet.
7. On any failure, end acceptance, report
   `ACCEPTANCE_FAIL <ROUND_ID> APSPORT <REDACTED_REASON>`, and obey root's
   `STOP_ACCEPTANCE`. Wait for all leases to end before returning to
   `IN_PROGRESS` and provider-local TDD.
8. Only after root announces `ROUND_ACCEPTED` for this round may APSPORT acquire
   a new edit lease and update its report to `DONE`. `BLOCKED` is legal only for
   a proven external provider/auth failure.

Do not attach DevTools/CDP, use active-tab fallback, or touch another provider. Unit tests without this live gate are not completion.
