# SABA admission correction — 2026-09-09

The source was sending traffic. Production incorrectly required a complete dedicated
collector before publishing native snapshots, and rejected all ordinary DOM snapshots
until a usable socket baseline existed. The live socket decoder reported
`FIELD_INDEX_UNMAPPED`; the collector had finished without its main-roster proof.
This left valid current page prices behind `dom-awaiting-socket-baseline`.

Native reset/done can now authorize its own partition without claiming collector
completion. Native-only deployment was observed for eleven samples and did **not**
recover this source, so it is not the acceptance result.

Production now also permits a DOM fallback after two stable assembled snapshots,
with explicit valid provider timezone, at least twenty usable events, and nonempty
normalized events/markets/quotes. Incomplete chunks, unknown timezone, changed
viewport and a new epoch cannot immediately establish authority. Existing socket
or collector authority still takes precedence; collector coverage is not fabricated.
The unavailable UI label now describes missing usable comparison data instead of
declaring the provider page inactive.

The captured live input contained 123 records across three chunks. Replaying two
generations admitted 106 events, 638 markets and 1,276 quotes. Root verification:
197 tests in nine SABA API suites passed; API TypeScript build and web build passed.

Deployed stack `sha256:1f8b75948396291eb8cc8f2ceed4e54ca5c92860ba55b8e811e53e5eb6ea2349`,
instance `f297338f-4157-4a20-8f7a-40fcd1085939`. Extension remains 0.2.101.
The managed handoff encountered a port-ownership race during an API child restart;
after ownership stabilized the normal guarded handoff succeeded. Deployment lease
was released, and only the localhost dashboard was manually reloaded.

Initial post-deploy live evidence: SABA FRESH with 107 events, 645 markets and 1,290
quotes, then 82–104 semantic quote changes per minute. Native decoding and complete
collector coverage remain unresolved; this is usable current page coverage, not
proof of all SABA markets or 24-hour availability. IM, wider matching coverage and
whole-machine CPU are not claimed fixed by this change.

Final finite observation: 11/11 SABA samples were FRESH over 164 seconds. Final
sample had 107 events, 646 markets, age 8.4 seconds and 50 semantic quote changes
in the preceding minute. The observer exited successfully. CMD/AP/BTI were fresh;
SBO recovered in the final two samples and IM remained stale. No provider page
reload or new IM probe was issued by this debugging run.

Artifacts: `.run/saba-feed-unblock-2026-09-09/` (`live.json`, `saba-catalog.json`,
`dom-capture.json`, `replay-dom.json`, deployment identity and dashboard screenshot).
