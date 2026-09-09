# IM request guard, six-provider normalization and top 20

The user authorized implementation and deployment without another confirmation.
The later CPU and missing-positive-pair reports remain part of this task.

## IM traffic finding

The previous production collector continuously refilled two GetEBI detail slots
across hundreds of events, in addition to two GetSE roster requests every eight
seconds per document. There was no origin-wide request budget. This is a credible
excessive-traffic risk; neither logs nor native status 501 prove account blocking
or prove that this collector caused it. Historical native login succeeded while
catalog requests returned 501, but no healthy provider-only baseline was captured.

Production now uses an origin WebLock and durable localStorage admission gate:
30-second initial grace, at least 20 seconds between two-request roster rounds,
and no automatic GetEBI detail sweep. The lock lasts until both physical requests
settle. Native 501 and HTTP 401/403 immediately persist a hard stop across document
and extension generations. Other failures pause at least 30 seconds; three failed
rounds pause 15 minutes, with Retry-After honored. Missing storage/locks fails
closed. Legacy manual pause remains honored. Native website requests are not
controlled by this gate; passive provider errors do not currently set its breaker.

Removed redundant IM bootstrap retries and disabled automatic IM navigation,
portal restore and tab replacement. Existing open IM tabs can be observed and
refreshed only through the guarded collector. Deep detail coverage is intentionally
unavailable until a provider-supported request budget can be established.

## Matching and UI

Shared canonical matching applies to BTI, CMD, SBOBET, APSPORT, SABA and IM.
Fixes preserve settlement rules when home/away orientation changes, apply league
aliases after stripping corners/cards product suffixes, and reject malformed or
non-equivalent split lines. Three localized league aliases were confirmed from
local catalogs: Colombia Primera B, USA MLS Next Pro, and UAE Pro League.

A local fresh-source audit excluded the approximately 49-hour-old IM snapshot.
It found 8,045 matched rows and four raw theoretical positive rows at one instant;
the real top-20 selector included Hungary vs Ukraine FT total 2.5 at approximately
0.581468% for BTI/SBOBET. Prices can change; this is a calculation audit, not an
executable quote guarantee. The ROI formula was correct. A separate UI issue
excluded whole event groups when one source was stale, suppressing valid pairs
between the remaining fresh sources; the page regression covers this case.

The list now shows the top 20 tickets. Worker backpressure now coalesces the latest
changes by account into BATCH_DELTA instead of copying every catalog and resetting
all provider caches after each busy interval. Explicit reset and worker restart
still rebuild the full current selection; removals and freshness remain fenced.

## Validation and runtime

Focused adapter tests: 138 passed. Comparison tests after exact aliases: 103
passed. Safe IM and legacy collector tests: 34 passed; scope/suspension/recovery:
52 passed; poller: 25 passed. The 371-test observer suite passed all behavior tests;
two obsolete source-string assertions were corrected and the affected test rerun.
Worker batching regressions passed; the final page suite passed 79 tests with four
pre-existing skips. Web/extension typechecks and adapter/API/extension/web builds
passed. Independent reviews found no blocking issue in the request gate or batch
queue. No unverified native market IDs were promoted into canonical markets.

Deployed at 03:32:57 UTC+7 on 2026-09-09: instance
`101d5de0-1030-439b-bbd8-4f50fbf14913`, stack identity
`sha256:04498b27b472125873ac566e3d6d810b4bd03f9140c27d723e10ab5262e28c69`.
Extension artifact is 0.2.97,
`sha256:1968b546a88b95b0bd0b098122256deeea71fb342c580e22e787bad72ad705bc`.
Deployment lease was released. Reloaded the local dashboard once; provider pages
were not manually reloaded or reopened. Nine observations across about two minutes
showed all five non-IM feeds LIVE/FRESH after startup recovery.

IM remained unattached in every observation: no recognized IM source ID or epoch,
no IM refresh outcomes and no new collector requests. Therefore live IM collection
is **not accepted**: safe code is installed but an open authenticated IM document
was not available to the collector. Its old snapshot stays excluded. No claim is
made that the account block was diagnosed conclusively or resolved.

After deployment, a 30-second OS sample measured 32.13% total CPU, 22.8% Chrome,
7.42% API; the hottest Chrome renderer was 9.88% of this 16-logical-CPU machine.
This is a bounded sample, not proof that intermittent 100% spikes disappeared.
The Fieldline renderer still retained several GB, so total browser memory and
long-term CPU behavior remain limitations.

The actual dashboard screenshot confirmed current provider counts and the visible
Hungary/Ukraine BTI-SBOBET pair at approximately +0.58%. Chrome accessibility names
were stale (reporting initial zero counts) despite the current rendered pixels;
do not use those cached names as evidence of a catalog load failure. A bounded
check with the real bundled web parser also accepted current SABA/APSPORT/BTI
responses, all HTTP 200/FRESH, without schema errors. No parser change was needed.

Artifacts are under `.run/im-safe-2026-09-09/`, with the local matching audit in
`.run/normalization-live-audit-2026-09-09.json`. No bets, account rotations or
repeated manual provider probes were performed.
