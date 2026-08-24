# IM Provider Work Log

Status: `IN_PROGRESS` — rerun provider-local checks, report `LOCAL_GREEN`, wait
for root's combined deployment, then the IM worker must run its own live
acceptance. Only the accepted round permits `DONE`.

Historical checkpoint only: all coordination/path/build/runtime ownership text
below is superseded by the current `common.md`; technical evidence remains
reference material.

## Worker and base

- Worker/provider: IM
- Starting coordination-base commit: `f6e25d4`
- Branch observed at start: `feat/six-provider-realtime-feed`
- Scope: deterministic provider-local implementation and focused Vitest coverage only

## Exact changed files

- `apps/api/src/chrome-bridge/im-http-adapter.ts`
- `apps/api/src/chrome-bridge/im-http-adapter.test.ts`
- `apps/api/src/providers/im/im-football-catalog-source.ts`
- `apps/api/src/providers/im/im-football-catalog-source.test.ts`
- `docs/superpowers/reports/five-provider/im.md`

## Proven root cause

The GetSE classifier in `isClassifiedImMarket()` rejected every odds value with
an absolute value greater than 1. The catalog decoder's `selection()` repeated
the same Malay-only guard. Consequently, a structurally complete authenticated
GetSE partition containing valid positive Hong Kong odds could not join the
other partition and could never produce an authoritative baseline. The same
decoder guard also removed a market updated by a valid Hong Kong GetSEDelta.

The provider-local boundary now has one contract, `normalizeImOdds()`: finite
Malay odds from -1 through 1 remain unchanged except zero, and finite positive
Hong Kong odds greater than 1 become `-1 / value`. The classifier calls that
contract only to validate a partition; normalization is materialized when raw
IM selections are decoded into catalog `priceText`.

## RED evidence

Command used for both RED cycles:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/im-http-adapter.test.ts src/providers/im/im-football-catalog-source.test.ts
```

- RED cycle 1: 2 failing assertions in 2 tests; 48 tests passed. The catalog
  boundary returned `undefined` for inputs `1.25` and `3` instead of `-0.8`
  and `-0.3333333333333333`; the ordered delta produced empty event/market
  collections instead of retaining the exact identities.
- RED cycle 2: 1 failing assertion in 1 test; 57 tests passed. After the first
  valid Hong Kong GetSE partition and the matching second partition, the
  expected authoritative baseline was `undefined` because the classifier had
  poisoned the generation.

## GREEN evidence

Command:

```powershell
npm.cmd test --workspace @tool-chenh/api -- src/chrome-bridge/im-http-adapter.test.ts src/providers/im/im-football-catalog-source.test.ts
```

Result: 2 test files passed; 58 tests passed; 0 failed.

## Covered invariants

- Representative positive and negative Malay odds remain byte-for-byte numeric
  equivalents in `priceText`.
- Positive Hong Kong values `1.25`, `2`, and `3` normalize to exact unrounded
  Malay values `-0.8`, `-0.5`, and `-0.3333333333333333`.
- Zero, NaN, both infinities, malformed strings, nested odds objects, and
  negative values below -1 fail closed.
- An invalid GetSE partition poisons its generation; later parts cannot repair
  it, while a strictly newer valid generation can recover.
- One authoritative HTTP baseline is emitted only after both GetSE partitions
  have the same exact cutoff and generation. Existing mixed-cutoff and stale
  generation tests remain green.
- A later ordered Hong Kong delta updates the exact provider selection IDs
  while preserving the event and market identities.
- Event, market, and selection identity validation is unchanged.

Shared integration request: none

## Concerns and external blockers

No historical provider-local blocker remained. Root owns the combined deployment;
the IM worker owns fresh exact-provider live acceptance after root publishes the
round.

## Safety confirmation

No Git mutation, build, runtime process operation, browser automation,
DevTools/debugger action, `.auth` access, or edit to another provider/shared
file was performed. No live runtime success is claimed.
