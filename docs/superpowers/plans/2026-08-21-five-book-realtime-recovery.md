# Five-book realtime recovery plan

**Scope:** SABA, IM, APSPORT/TSPORT, SBOBET/KSPORT, and BTI. CMD is explicitly excluded.

**Safety:** Never place bets or reload, close, navigate, or hard-reset provider tabs. Use only observed CDP traffic and lightweight same-origin reads in the already authenticated tab.

## 1. Preserve the working tree

- Re-read `git status` and `git diff` before each commit.
- Do not edit or stage the existing CMD/reset work.
- Commit each clean provider/common fix separately.

## 2. Repair BTI atomic refresh

- Add a failing observer regression proving four same-generation event-list bodies returned by the in-page request are emitted directly as `HTTP_RESPONSE` envelopes.
- Return raw event-list/detail bodies from `BTI_CATALOG_REFRESH_EXPRESSION`.
- Validate generation, path, and body before direct ingestion; reject malformed/cross-origin results.
- Preserve stream generation even when there is no IM provider partition.
- Run observer, BTI adapter, extension typecheck, and build checks.

## 3. Diagnose and repair current SABA/IM/APSPORT/SBOBET paths

- Capture source sequence, catalog status/revision, and provider-specific decoder evidence without tab mutation.
- For each reproducible software failure, add a focused failing regression first, apply the smallest fix, and rerun provider tests/typecheck.
- Fail closed when a current provider response/baseline cannot be proven; never expose cached odds as current.

## 4. Verify exact opposing-ticket matching

- Run the existing canonical event, generation, freshness, scope, line, HOME/AWAY, OVER/UNDER, reversed-participant, Coquimbo, reconnect, and no-blink regressions.
- Add a regression only if runtime evidence exposes a missing case.

## 5. Deploy and accept

- Build the affected extension/API/web artifacts without reloading provider tabs.
- Observe source sequence and catalog revision; prove a real quote change reaches the UI without F5.
- Run direct AH and TOTAL checks where the provider exposes an exact fresh read.
- Soak all five sources and report each provider PASS/FAIL with evidence; never claim 5/5 without all checks.
