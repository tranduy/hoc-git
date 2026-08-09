# Fixture-mode operator guide

Fixture mode is a local, read-only demonstration. It binds the API to `127.0.0.1:4310` and the web app to `127.0.0.1:4311`, reads only the four JSON fixtures under `fixtures/`, and does not read or forward account credentials, cookies, tokens, or browser profiles.

## Start on Windows

From the repository root in PowerShell:

```powershell
npm.cmd install
npm.cmd run verify
npm.cmd run dev:fixture
```

Wait for `[fixture-stack] ready`, which is printed only after both observe-only API health and the web root return successfully, then open `http://127.0.0.1:4311`. Stop the complete stack with `Ctrl+C`. The supervisor forwards the termination signal to both child processes; a readiness timeout or API/web child failure makes the command exit nonzero.

For browser-level verification, install the pinned browser once with `npm.cmd exec playwright install chromium`, then run `npm.cmd run test:e2e`.

## What to inspect

- **Dashboard** shows the four local SABA/IM fixture feeds, per-category counts, mapping totals, opportunity count, and maximum quote age.
- **Football** contains Football events and markets only. Use Timing, Competition, Market, and Mapping filters; `FULL_TIME` scopes must not appear on the LoL page. Timing comes from the mapped provider lifecycle, never from comparing kickoff time with the local clock. Conflicting or missing lifecycle evidence is labelled **Unknown** and does not pass either the Live or Pre-match filter.
- **LoL** contains League of Legends events and markets only, including Series and `MAP_3` scope. Football scopes must not appear here.
- **Opportunities** shows only fresh, eligible opportunities produced from `VERIFIED` mappings. Each card exposes raw, decimal, and effective odds; exact stake and payout strings; quote/source time; worst-case profit; ROI; settlement profile; and `READ ONLY` status.
- **Mapping Review** exposes the server-supplied gate, expected value, actual value, result, and reason. Rows may be inspected and filtered, but they cannot be approved or edited.

On a narrow screen the primary navigation becomes a horizontally scrollable bottom bar. The same five destinations remain available.

Fixture mode explicitly declares USD as both providers' native and base currency, a 1:1 FX rate with zero spread, and a 1% profit fee. These are synthetic demonstration assumptions, not inferred defaults. Every emitted opportunity carries its fee, FX timestamp/rate/spread, native stake, base-currency stake cost, and base-currency payout. Missing or stale financial policy removes the opportunity.

## Replay controls and deterministic state

`npm.cmd run dev:fixture` rebuilds the workspaces, replays the checked-in records at the fixed `FIXTURE_REPLAY_SPEED=1`, and stops each fixture at its 90 ms inspectable boundary. That boundary deliberately leaves one Football and one LoL opportunity visible. The later 100 ms suspend records remain in the repository as adapter/unit-test vectors; they are not the operator landing state.

Fixture time continues to advance after replay. The inspectable quotes use a deterministic five-minute TTL, and the server reevaluates them four times per second. This keeps a fresh local stack stable long enough to inspect while still exercising production stale-data behavior: after five minutes without a new replay record, the server removes the opportunities and publishes `QUOTE_STALE` diagnostics. Restart `dev:fixture` to begin a new five-minute inspection window.

There are no hidden runtime or browser controls. To replay from the beginning, press `Ctrl+C` and run `npm.cmd run dev:fixture` again. Do not point this command at a downloaded capture or an external URL.

## Disconnected and stale safety

If the realtime socket closes, Opportunities immediately hides every card and displays **Connection disconnected**. Mapping evidence becomes last-known and non-actionable. The client retries the local socket with bounded backoff; cards return only after that socket delivers a validated full snapshot. A same-revision full snapshot can revalidate the cache after reconnect; merely opening the socket cannot. Stale, suspended, sequence-gap, schema-unknown, and non-verified data remain ineligible.

## Why there is no bet action

This foundation is observe-only. It contains no arm, place, submit, credential, session, or account control and no request path that can prepare or place a wager. PAPER, ASSISTED, and AUTO execution require a separate approved plan with preflight, receipts, reconciliation, limits, and kill switches. A displayed opportunity is evidence for inspection, never execution authorization.
