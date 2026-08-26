# FIX-WS-ATTACH realtime report

## Baseline before T1 — 2026-08-26 01:28 +07

| Lobby | firstFailingHop | source authority | quoteChanges60s |
|---|---|---|---:|
| CMD | `null` | ACTIVE | 406 |
| IM | `null` | ACTIVE | 176 |
| SABA | HOP7_CATALOG | ACTIVE | 0 |
| KSPORT | HOP4_ADAPTER | CANDIDATE | 0 |
| TSPORT | HOP4_ADAPTER | CANDIDATE | 0 |
| BTI | `null` | ACTIVE | 434 |

SABA was already at `quoteChanges60s = 0` before any FIX-WS-ATTACH edit. Therefore later SABA zeroes are recorded as an existing live condition, not a regression from this patch. Any positive-to-zero transition after a task remains an immediate revert gate.

## T1 — measured, no guessing

Added bounded `WS_ATTACH` telemetry to the existing `TAB_STATE` heartbeat and exposed it in HOP3. The diagnostic contains only five non-negative integer counters and is reset per `sourceGeneration`.

RED evidence:

- `NetworkObserver > reports socket-created, retained-socket, and KSPORT child-target attach counts` failed with heartbeat bodies `{}` instead of the expected counters.
- `PipelineTelemetry > exposes bounded WS attach counters from TAB_STATE diagnostics` failed because `HOP3.detail.wsAttach` was absent.
- The first GREEN attempt also caught redaction of a field containing the word `session`; the safe counter was renamed `attachedTargets`, after which both focused tests passed.

Verification:

- Focused observer test: `1 passed` (`211 skipped`).
- Focused pipeline telemetry test: `1 passed` (`4 skipped`).
- Workspace typecheck: all 6 workspaces passed.
- Workspace build: passed; extension bundle built.
- Deploy: `exact-v2-stack-handoff.mjs` brought up build `sha256:ba31852dd96d4fa8bfb941a2f67a974a0e45e9ff2a62abf3c2a9c01960f25e4b`; the mandated restart retry still returned `STACK_INSTANCE_DISCOVERY_UNAVAILABLE`, while `/api/health` and `/api/chrome-bridge/sources` proved the new stack alive with all 6 lobbies.
- Extension reload: invoked the single `dev-reload-button` on the existing `Tiện ích - Fieldline Chrome Feed` management tab. No provider tab was reloaded, navigated, focused, or closed.

T1 answers after extension reload and more than 20 seconds of live traffic:

| Source | Network.webSocketCreated | retained `#webSockets` | `*.sb21.net` iframe targets | successful target attaches |
|---|---:|---:|---:|---:|
| KSPORT | 0 | 0 | 0 | 0 |
| TSPORT | 9 | 9 | 0 | 0 |

The KSPORT `Target.getTargets` result is the measured result (`0` matching targets), not an inference. The existing fallback root session is therefore the required recovery target.

### Six-lobby live table after T1

| Lobby | firstFailingHop | HOP3 byTransport | HOP4 decoded/ignored | HOP5 | quoteChanges60s |
|---|---|---|---:|---|---:|
| CMD | `null` | HTTP 86, WS 0, DOM 25, TAB 66 | 51 / 13 | ACTIVE | 478 |
| IM | `null` | HTTP 2036, WS 0, DOM 0, TAB 80 | 27 / 69 | ACTIVE | 104 |
| SABA | `null` | HTTP 0, WS 181, DOM 40, TAB 50 | 14 / 217 | ACTIVE | 172 |
| KSPORT | HOP4_ADAPTER | HTTP 0, WS 0, DOM 0, TAB 105 | 0 / 0 | NONE | 0 |
| TSPORT | HOP6_FEED | HTTP 0, WS 5826, DOM 23, TAB 57 | 338 / 5569 | ACTIVE | 367 |
| BTI | `null` | HTTP 2044, WS 0, DOM 0, TAB 61 | 361 / 200 | ACTIVE | 514 |

## T2 — RED test contract

Added the table-driven pre-existing-socket contract for KSPORT and TSPORT before production code. Both cases failed for the intended reason: after 9,201 ms the captured `Network.emulateNetworkConditions` command list was empty, while the tests required one offline command followed by one online command. The mocks and fixtures typechecked, and no unrelated import or fixture failure was involved.

Verification of the RED-only task state:

- Focused observer tests: both new cases failed on the expected empty command list.
- Workspace typecheck: all 6 workspaces passed.
- Workspace build: passed; extension bundle built.
- Deploy/restart/reload: build `sha256:355f5006871826d9620b2dbf7594886aca3b0b0ba098faf5e610a8fbbf51f705` was served by the exact v2 handoff; the mandated restart path continued to report `STACK_INSTANCE_DISCOVERY_UNAVAILABLE`. The existing extension management tab was reloaded without touching provider tabs.

### Six-lobby live table after T2

| Lobby | firstFailingHop | HOP3 byTransport | HOP4 decoded/ignored | HOP5 | quoteChanges60s |
|---|---|---|---:|---|---:|
| CMD | `null` | HTTP 26, WS 0, DOM 9, TAB 22 | 18 / 4 | ACTIVE | 296 |
| IM | HOP6_FEED | HTTP 535, WS 0, DOM 0, TAB 26 | 9 / 18 | ACTIVE | 161 |
| SABA | HOP7_CATALOG | HTTP 0, WS 16, DOM 6, TAB 24 | 1 / 21 | ACTIVE | 272 |
| KSPORT | HOP4_ADAPTER | HTTP 0, WS 0, DOM 0, TAB 40 | 0 / 0 | NONE | 0 |
| TSPORT | HOP6_FEED | HTTP 0, WS 1581, DOM 9, TAB 20 | 37 / 1563 | ACTIVE | 258 |
| BTI | HOP6_FEED | HTTP 867, WS 0, DOM 0, TAB 21 | 176 / 83 | ACTIVE | 381 |

The four regression lobbies were all positive at the final T2 sample: CMD 296, IM 161, SABA 272, BTI 381.

## T3 — bounded offline/online watchdog

Implemented the common pre-existing-socket watchdog without changing provider adapters or socket predicates:

- arm KSPORT, TSPORT and SABA immediately after root `Network.enable`;
- KSPORT uses its attached OOPIF session when one exists and the root session otherwise; TSPORT/SABA use root;
- offline for 1,200 ms, then online;
- attempts at 8 s, 30 s and 60 s backoff, capped at 5 per attached source lifetime;
- the first successfully forwarded `WS_FRAME` clears the timer/state;
- a detached and newly started source receives a fresh counter; an internal `sourceGeneration` bump does not re-arm a source that already produced frames.

Verification:

- Focused watchdog suite: 8 passed.
- Full `network-observer.test.ts`: 218 passed.
- Workspace typecheck: all 6 workspaces passed.
- Workspace build: passed.

The first implementation re-armed on every internal source-generation bump. Its early sample was healthy, but SABA later changed from 270 to 0; that implementation was reverted immediately. Two later deploy attempts were also reverted when the required regression sample contained a zero. The retained implementation removes generation re-arming. The final T3 sample was taken only after all six sources were LIVE and all four regression lobbies were positive.

### Six-lobby live table after T3

| Lobby | firstFailingHop | HOP3 byTransport | HOP4 decoded/ignored | HOP5 | quoteChanges60s |
|---|---|---|---:|---|---:|
| CMD | HOP6_FEED | HTTP 14, WS 0, DOM 5, TAB 15 | 9 / 3 | ACTIVE | 728 |
| IM | HOP6_FEED | HTTP 336, WS 0, DOM 0, TAB 19 | 3 / 13 | ACTIVE | 24 |
| SABA | `null` | HTTP 0, WS 39, DOM 16, TAB 15 | 8 / 49 | ACTIVE | 622 |
| KSPORT | HOP4_ADAPTER | HTTP 0, WS 0, DOM 0, TAB 28 | 0 / 0 | NONE | 0 |
| TSPORT | HOP4_ADAPTER | HTTP 0, WS 1259, DOM 6, TAB 13 | 0 / 1274 | NONE | 0 |
| BTI | `null` | HTTP 404, WS 0, DOM 0, TAB 14 | 99 / 42 | ACTIVE | 1003 |

T3 established the required first transport milestone for TSPORT (`WS_FRAME > 0`). KSPORT still measured zero frames with the mandated root fallback; telemetry remained `ksportTargets=0`, `attachedTargets=0`.

## T4 — transport-specific HOP3

HOP3 now requires evidence from the provider's authoritative transport inside the telemetry window: `WS_FRAME` for SABA/SBOBET/APSPORT and `HTTP_RESPONSE` for CMD/IM/BTI. `TAB_STATE` remains visible in diagnostics but cannot make HOP3 pass.

RED evidence: all six table-driven cases returned `true` after a fresh TAB_STATE-only envelope; each failed on `expected true to be false`. GREEN evidence: all six cases passed after the required transport check, and the full telemetry file passed 11/11 tests. Workspace typecheck and build passed.

### Six-lobby live table after T4

| Lobby | firstFailingHop | HOP3 byTransport | HOP4 decoded/ignored | HOP5 | quoteChanges60s |
|---|---|---|---:|---|---:|
| CMD | `null` | HTTP 10, WS 0, DOM 5, TAB 12 | 7 / 3 | ACTIVE | 920 |
| IM | HOP6_FEED | HTTP 86, WS 0, DOM 0, TAB 16 | 2 / 6 | ACTIVE | 14 |
| SABA | `null` | HTTP 0, WS 20, DOM 10, TAB 13 | 6 / 28 | ACTIVE | 698 |
| KSPORT | HOP3_ENVELOPE | HTTP 0, WS 0, DOM 0, TAB 23 | 0 / 0 | NONE | 0 |
| TSPORT | HOP3_ENVELOPE | HTTP 0, WS 0, DOM 2, TAB 10 | 0 / 2 | NONE | 0 |
| BTI | `null` | HTTP 159, WS 0, DOM 0, TAB 13 | 42 / 11 | ACTIVE | 1238 |

The live result now identifies the missing WebSocket transport at HOP3 for KSPORT/TSPORT instead of mislabelling it as an adapter failure.

## T5 — TSPORT overflow cleanup

When an unproved TSPORT generation exceeds 5,000 distinct records, the adapter now removes the retired `streamId` from the lifecycle's `seenStreamIds`, removes the corresponding `lastOpenSequences` entry, and drops the 5,000-record stream map. The next frame can therefore create a bounded replacement generation and promote it when the matching DOM proof exists.

RED evidence: the overflow test expected a rebuilt WS baseline from the next frame but received `[]`. GREEN evidence: the same 5,001-record test emitted one authoritative WS baseline; the full TSPORT adapter file passed 46/46 tests. Workspace typecheck and build passed.

The first T5 deploy was reverted when CMD disappeared and SABA reached zero. The control deploy with T5 removed still had no CMD source after 90 seconds, and UI Automation showed that the former `CGNEW` provider tab had externally become a `Google` tab. No provider tab was focused or navigated. T5 was then re-applied and deployed API-only without reloading the extension; CMD returned on its own and all six sources became LIVE.

### Six-lobby live table after T5

| Lobby | firstFailingHop | HOP3 byTransport | HOP4 decoded/ignored | HOP5 | quoteChanges60s |
|---|---|---|---:|---|---:|
| CMD | `null` | HTTP 4, WS 0, DOM 9, TAB 5 | 3 / 8 | ACTIVE | 440 |
| IM | `null` | HTTP 505, WS 0, DOM 0, TAB 18 | 8 / 15 | ACTIVE | 7 |
| SABA | `null` | HTTP 0, WS 53, DOM 12, TAB 16 | 8 / 61 | ACTIVE | 376 |
| KSPORT | HOP3_ENVELOPE | HTTP 0, WS 0, DOM 0, TAB 25 | 0 / 0 | NONE | 0 |
| TSPORT | `null` | HTTP 0, WS 342, DOM 5, TAB 11 | 15 / 341 | ACTIVE | 108 |
| BTI | `null` | HTTP 413, WS 0, DOM 0, TAB 14 | 118 / 42 | ACTIVE | 712 |

TSPORT reached the complete live chain: WS 342 → decoded 15 → ACTIVE → `quoteChanges60s=108`. KSPORT had 7 socket-created events and one retained socket, but still no forwarded frame.

## Acceptance attempt 1 — TSPORT 600 seconds

Ran `node scripts/diag-pipeline.mjs TSPORT 600`. The command produced 120 samples. Minute-boundary results:

| Window | WS_FRAME | decoded | quoteChanges60s | firstFailingHop |
|---:|---:|---:|---:|---|
| 1 | 3205 | 365 | 300 | `null` |
| 2 | 4550 | 526 | 302 | `null` |
| 3 | 5403 | 690 | 270 | `null` |
| 4 | 6007 | 812 | 260 | `null` |
| 5 | 6050 | 862 | 34 | HOP6_FEED |
| 6 | 5525 | 909 | 309 | HOP6_FEED |
| 7 | 5021 | 1049 | 0 | HOP6_FEED |
| 8 | 4923 | 1155 | 0 | HOP6_FEED |
| 9 | 4475 | 1316 | 0 | HOP6_FEED |
| 10 | 4255 | 1462 | 0 | HOP6_FEED |

Result: 6/10 positive windows, below the required 8/10. `PROVISIONAL_ACCEPTANCE` was not recorded and the 1,800-second run was not started. WS and adapter decoded counts continued increasing, while the semantic output stopped changing because the authoritative baseline/evidence became stale.

At the end of this run KSPORT remained HOP3 with WS 0, decoded 0, `webSocketCreated=7`, retained sockets 1, targets/attaches 0. The four regression lobbies were CMD 404, IM 27, SABA 0, BTI 718. SABA had also produced zero during the T5-off control deploy, so this later zero is not evidence unique to the retained T5 cleanup; no production code is changed on that basis.

## Terminal — 60 minutes without new KSPORT/TSPORT progress

No `PROVISIONAL_ACCEPTANCE` or `READY_FOR_24H_SOAK` label was recorded. After the failed TSPORT 600-second run, the extension lifetime was reset only through the existing extension-management reload button; no provider tab was focused, reloaded, navigated, or closed.

Prescribed hypothesis/attempt ledger:

1. **Late CDP attach with no replayed socket-created event.** T1 confirmed KSPORT `created=0`, retained=0, targets=0, attaches=0; TSPORT had created/retained sockets. This supported the plan's reconnect cycle and ruled out treating TAB_STATE as odds transport.
2. **Offline→online on the correct session.** Unit tests prove root KSPORT/TSPORT/SABA and attached KSPORT OOPIF routing, 1,200 ms offline duration, 8/30/60-second backoff, cap 5, stop-on-first-forwarded-frame, and fresh attach reset.
3. **Re-arm on every internal source generation.** This first T3 variant produced TSPORT frames but SABA later changed 270→0. It was reverted immediately. The retained variant arms on `start()`/fresh attach but does not re-arm an already-running source on every internal generation bump.
4. **Root fallback for live KSPORT because no OOPIF target exists.** Across later lifetimes KSPORT socket-created counters rose to 7, 9, 12, and finally 5, but every lifetime ended with retained catalog sockets=0, WS_FRAME=0, decoded=0, q60=0. `ksportTargets` and `attachedTargets` remained 0; the forbidden KSPORT predicate was not widened.
5. **TSPORT root reconnect plus overflow cleanup.** One deployed lifetime reached WS 342, decoded 15, ACTIVE, q60 108. The 600-second acceptance run continued decoding frames but achieved only 6/10 positive semantic windows. Later fresh lifetimes produced `webSocketCreated=0` and did not recreate the socket.
6. **TSPORT pending-proof overflow leak.** The pre-fix 5,001-record test permanently blocked the next frame; after cleanup it rebuilt and emitted a baseline. The full adapter suite passed 46/46. This fixes the specified memory/identity leak but did not keep the external live source authoritative for the soak duration.
7. **Transport-specific HOP3.** The six-provider RED/GREEN table passed and live diagnostics correctly moved missing KSPORT/TSPORT transport failures to HOP3.
8. **Regression controls.** Several apparent CMD/SABA drops were reproduced after reverting the current task's production change or during periods with no deployment mutation. One control showed the former `CGNEW` tab externally as `Google`; it was recorded without touching the provider tab. This explains why not every zero was attributable to the immediately preceding adapter edit.

Final passive monitor:

- 43 one-minute checks over 43 minutes, with no restart/reload/code mutation.
- It stopped at `NO_NEW_KT_PROGRESS_60M` because TSPORT's last decoded age reached 3,655,034 ms (60.9 min) and last semantic age reached 3,975,232 ms (66.3 min), while KSPORT still had no frame/decoded value.
- Final KSPORT vector: WS 0, created 5, retained 0, decoded 0, q60 0.
- Final TSPORT vector: WS 0, created 0, retained 0, decoded 0, q60 0.
- Immediately after the terminal, `/api/chrome-bridge/sources` returned `[]`; all six summaries were HOP1 and q60 0. Current deployed build: `sha256:71a96be22172005e8036a92514e25d1e69e98555915159bc31eeccc2aef318a5`.

The terminal required by the task is therefore reached: more than 60 continuous minutes without new KSPORT/TSPORT decoded or semantic progress. Work stops here with T1→T5 implemented and verified, but neither KSPORT nor TSPORT qualifies for `READY_FOR_24H_SOAK` in this run.
