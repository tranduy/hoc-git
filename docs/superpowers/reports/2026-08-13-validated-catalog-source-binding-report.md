# Validated catalog source binding report — 2026-08-13

## Outcome

The live UI now reads odds through stable logical identities such as
`catalog-source:SABA:FOOTBALL`. A Fabet launcher/session can rotate without changing the
identity selected by the UI. Betting accounts are resolved separately and must have a fresh
profile plus `PREFLIGHT`; a catalog-only session can never be promoted to an executable leg.

The service remains `OBSERVE` with `executionReady=false`. No slip was opened and no bet,
preflight, dry-run execution, receipt, or submit endpoint was called during this rollout smoke.

## Verification

- `npm.cmd run verify`: PASS (all workspace typechecks and tests, two integration tests,
  fixture-stack readiness and watch smoke).
- `npm.cmd run build`: PASS for API, web, adapters, contracts and core.
- Web focused gate: 217/217 PASS; live catalog page: 34/34 PASS.
- Contract gate: 60/60 PASS; core: 217/217 PASS; adapters: 64/64 PASS.
- `git diff --check`: PASS (line-ending warnings only for unrelated dirty files).
- Production web roots `/football-live` and `/lol-live`: HTTP 200.

## Live read-only source evidence

Counts are point-in-time evidence and can change with the provider feed.

| Logical source | State | Latest successful evidence | Latest lifecycle observation |
|---|---|---|---|
| SABA Football | ACTIVE | 14 events / 18 markets / 36 quotes / 43 rejected | one subsequent read unavailable after 28.7 s; last success remains display-only after freshness expiry |
| SABA LoL | ACTIVE | 84 / 157 / 314 / 146 rejected | recovered after two failures; successful read took 35.4 s |
| SBOBET Football | ACTIVE | 39 / 98 / 196 / 0 rejected | healthy, latest read about 1.34 s |
| APSPORT Football | ACTIVE | 18 / 20 / 40 / 1 rejected | healthy, latest read about 0.97 s |
| BTI Football | ACTIVE | 11 / 16 / 32 / 0 rejected | healthy, latest read about 1.39 s |
| IM LoL | ACTIVE | 6 / 6 / 12 / 0 rejected | healthy, latest read about 1.02 s |
| CMD Football | ACTION_REQUIRED / SCHEMA_CHANGED | none | no current verified launcher; not represented as an empty catalog |

The first bounded client loop used a 15-second request deadline. Some browser-backed reads
completed on the server after that client deadline; telemetry was used only to record those
completed results, not to claim that the client received them within its budget. SABA remains
the material latency/reliability risk and is not execution-ready.

## Security and identity checks

`GET /api/catalog/sources` returned only ID, alias, provider, category, session state/source,
acquisition time and health reason. It did not expose launcher URL, hostname, token, cookie,
credentials, browser handle or backing session ID. Registry regressions prove that a newer
validated ACTIVE launcher replaces the backing session while the logical ID is unchanged;
no live rotation was manufactured during this smoke window.

## Remaining coverage

IM Football, CMD Football and BTI LoL are not enabled as catalog sources until their current
launcher and reader schema are verified. The existing SABA Football/LoL readers need a bounded
latency/recovery improvement before any execution gate can depend on them. All real-money
testing remains deferred and requires separate confirmation.

Commits delivered by this rollout: `66c993c`, `e0d6bda`, `5c23d47`.
