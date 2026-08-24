# APSPORT/TSPORT Worker Task

Priority: 3

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

Do not edit shared extension/data-plane files or use the live APSPORT page.
