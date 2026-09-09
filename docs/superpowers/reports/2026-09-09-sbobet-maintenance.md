# SBOBET continuous maintenance — 2026-09-09

Extension **0.2.94** adds coordinated failure handling to the existing SBOBET/KSPORT Main, More and All Dates collection. The user requested SBO next, deferred new hard reload/replacement work, and does not require a 24-hour acceptance run. IM remains outside extension production scope.

## Resulting behavior

- Extension-owned requests share a 30-second initial failure pause, doubling on successive failed retries to five minutes. HTTP 401/403 pauses for 15 minutes. Longer `Retry-After` seconds or HTTP dates are honored. Successful requests admitted before a failure cannot erase its pause.
- Cooldown is stored as four numeric fields in `chrome.storage.local`, preserving the deadline through worker/source changes and extension reloads. Initial admission waits for the stored state. Local storage is intentional: Chrome clears session storage when an extension reloads or updates ([Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage/)).
- Main requests Live and Today separately, checking shared admission between them. Each page fetch aborts after 12 seconds. Plain HTTP 400 permits at most three already attached execution contexts, spaced 500 ms apart, before pausing; a valid page owner can therefore succeed after an auxiliary context rejects the same request. Authentication/rate/server failures, CDP failures and any positive Retry-After pause immediately. A newly accepted, validated pair resets previous failure escalation.
- After a 400 cooldown expires, an expired Main template gets one bounded native reacquisition on the existing page. Failure increases the quiet window; retirement cancels the attempt without penalizing a replacement generation. HTTP refusals observed during that owned native recovery retain their actual status and Retry-After, so 401/403 and 429 cannot be mistaken for another generic 400.
- More retains its existing two physical request slots and pacing. More/Early logical timeouts start the shared pause even if a CDP operation remains pending. Those operations retain physical capacity until actual settlement. The independently proven detail lane follows the same admission/failure policy; this change grants no new completeness proof.
- Existing restore/ensure/renew actions recheck admission immediately before navigation, including after asynchronous bootstrap. Runtime `ENSURE_KSPORT` follows the same rule. Healthy KSPORT periodic navigation remains disabled. No new hard recovery stage or account/session rotation was added.
- Passive provider traffic remains observable during cooldown. Receipts retain their original ordering and timestamps. Freshness thresholds, supported market scope and the existing adapter semantics are unchanged.

## Verification

- **549 passed** across 20 SBOBET, generation, source recovery and page lease test files in the final scoped run.
- **83 passed** in the KSPORT subset of the shared observer suite (288 unrelated cases unselected).
- **83 passed** in API More/Early data-plane and source-revision integration tests.
- Extension TypeScript check, build and whitespace checks passed.
- Regression cases cover HTTP refusal, failed CDP, long/date Retry-After, persisted restart admission, shared cooldown after epoch changes, timeout with occupied physical slots, late success, pause during Live preventing Today, and pause during bootstrap preventing navigation. The timeout and navigation regressions were observed failing before their fixes.
- Independent review found recovery and inter-partition admission races plus unresolved-CDP timeout gaps. Production startup then exposed the expired-400-template path; its delayed native recovery, failure escalation, native refusal handling and cancellation fences were tested and re-reviewed. The final review reported no remaining findings.

A broader exploratory observer run also encountered an unrelated IM assertion rejecting the words `odds/price/stake` anywhere in its existing read-only expression. That assertion was not changed. Three older KSPORT fixtures were updated to assert serialized evaluation and preservation of a healthy HTTP baseline instead of counting unrelated setup commands or expecting unnecessary socket recovery. The scoped tests above are the final verification boundary, not a claim that the entire repository suite passed.

## Deployment and observation

- Extension build: `sha256:092e64ec46ebbe351acdd13ccc830a08ed5b202ca972916575429c28e129de93`.
- Managed stack: `sha256:8fc6d24e7160a64f006a2e00c1aba17183abf3663c71d5d82d0a2c50a54405ae`.
- Stack instance: `8b1c2a42-95e1-4ea6-840d-6f40a3ba1397`.
- Handoff completed at `1788891896889` (01:24:56 UTC+7).
- Extension-only rebuild; existing API maintenance fixes remain in the managed stack. No manual provider-tab reload was used as a deployment step.

The hidden read-only observer in `.run/sbo-maintenance/` records counts, receipt-order advancement and consumer revision notifications for 12 minutes. Prices are compared in memory and never written. It checks all SBO quotes; these counters must not be presented as More-only coverage or latency. Comparison resets when the source epoch changes, since monotonic clocks and sequence counters belong to that epoch. It generates `acceptance.json` automatically at completion, separating the first ten minutes from eligible post-startup samples. `monitor.json` records its process and duration. The earlier 0.2.90 startup is retained separately in `startup-0.2.90/`; its cross-epoch clock comparisons are not acceptance evidence.

The intermediate 0.2.91 observations are separately retained in `startup-0.2.91/`. They show repeated plain-400 pauses despite successful native reacquisition; the final build restores bounded context fallback for this case. Native recovery ownership is captured when each request starts, so late native 403/429 still applies the real quiet window after the selector wait ends.

The 0.2.92 observations are retained in `startup-0.2.92/`. They exposed a false completion signal: native recovery watched the allocated snapshot ordinal, which advances before both partition publications finish. A delayed-forward regression reproduced the extra synthetic 400. Version 0.2.93 keeps a separate publication promise, waits for the actual current validated pair, and retains pending publication ownership through a logical timeout. Source/tab/bridge retirement cancels it. A native pair still takes precedence when the selector's CDP acknowledgement is missing. The diagnostic adds only a fixed lane label, status and remaining pause milliseconds.

The 0.2.93 run is retained in `startup-0.2.93/`. Main recovery also depended on the optional Detail roster accepting every kickoff. Version 0.2.94 records Main completion independently, using the existing full-partition validator after all fragments actually forward. Live and Today must match the source/tab/bridge identity, request document, stream ordinal and cutoff. Older completion cannot replace a newer pair; the receipt keeps the older original part timestamp. Detail eligibility and proof remain unchanged. A naive-kickoff regression failed before this fix; malformed/mismatched/retired/older pairs remain rejected. Independent review found no further issues in this change.

The checkpoint at `1788892584967` (01:36:24 UTC+7), saved as `.run/sbo-maintenance/checkpoint.json`, passed the short operational check. After the ten-minute cutoff (`1788892496889`), **4/4 samples were LIVE/FRESH and changing**, on one source epoch, with no recovery attempts or local diagnostic errors. Maximum catalog/evidence age was **4,813 ms**. The latest sampled catalog contained **521 events, 13,248 markets and 26,496 quotes**.

One quote comparison collected after the cutoff recorded 599 changed prices and 10,344 advancing clocks/sequences, with zero changed prices whose clocks failed to advance. These compare against the previous snapshot and are all-SBO counters, not More-only coverage. Consumer observation remained connected with zero disconnections/errors and 533 revision notifications across the whole monitored run. Build identities matched; source registry contained one each of CMD/SABA/KSPORT/TSPORT/BTI and no IM.

The preceding 37 startup samples were also fresh but remain separate from acceptance. The new extension worker cleared the inherited pause and no new failure appeared in the stored backoff state during its observation. Earlier failed builds remain archived. The finite observer exits automatically after 12 minutes; the application and extension maintenance continue normally. This is a short operational check, not a 24-hour availability guarantee; the user explicitly waived waiting for a 24-hour run.
