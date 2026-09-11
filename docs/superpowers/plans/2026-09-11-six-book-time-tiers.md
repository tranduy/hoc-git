# Six-book time tiers implementation plan

> For agentic workers: execute inline with superpowers:executing-plans and test-driven-development. User approved implementation on 2026-09-11.

**Goal:** Spend acquisition and comparison work according to kickoff proximity across all six football books, without renewing old prices or restarting Chrome.

**Architecture:** A shared, pure policy defines refresh intervals and observation lifetimes. The existing fixture matcher selects up to five distinct paired fixtures within three hours; a bounded bridge plan carries native event IDs to collectors. Source health remains independent of scheduled detail waits. Manual refresh schedules data acquisition rather than source navigation.

**Tech stack:** TypeScript, contracts, Fastify, Chrome extension page collectors, React, Vitest.

**Spec:** Approved conversation: live retains its strict policy; nearest five paired prematches within 3h refresh at 5–10s with 15s observations; other 0–3h 20–30s/60s; 3–6h 30–60s/120s; 6–13h 1–2m/5m; 13–24h 10m/15m; 24–72h 60m/75m; beyond72h passive roster. Accept incoming source updates immediately. Retained ROI is observational, never renewed verification.

## Constraints

- Never restart/close Chrome or manipulate unrelated tabs/processes. No wagers.
- No permission escalation. Preserve existing unrelated untracked documents.
- Source retry/backoff, suspension, identity and receipt-clock validation stay authoritative.
- A subset refresh is never authoritative deletion of omitted fixtures or markets.
- Missing kickoff must not be guessed or classified as distant; use bounded metadata reconciliation.
- Tier promotion and rescheduling trigger re-evaluation without resetting receipt age.

## Tasks

- [x] Shared policy and tests: create contracts football-refresh-policy.ts; test exact 3/6/13/24/72h boundaries, live, unknown timing, urgent eligibility and unchanged receipt age.
- [x] Observation policy and tests: replace AP-only fixed quote-age filtering in ranked-tickets.ts with source-aware receipt deadlines for all football books, global urgent fixture set and scheduled boundary invalidation. Preserve historical display and independent verified-ticket expiry.
- [x] Acquisition bridge and tests: validated bounded collection plan, exact-source control-plane delivery, extension ownership checks, coalesced manual refresh. Production fixture matcher supplies urgent native IDs; normal timing continues when no urgent plan is available.
- [x] Collector integration and tests: AP split periodic roster from bounded due-detail batches; SBOBET due policy; BTI due policy and queue priority; CMD owner due policy; SABA bounded owner visits; IM use only supported native request scopes and preserve shared admission/backoff. Do not invent a date filter upstream.
- [x] Dashboard hydration and tests: keep lightweight broad roster; hydrate due fixture subsets, merge sparse views without erasing other tiers, retain receipt clocks and avoid copying unchanged far catalogs on near updates.
- [x] Verification: run focused policy, collector, bridge, ranking and UI tests; typecheck/build affected workspaces; review diff and actual six-source diagnostics. Deploy only through a path that preserves Chrome and unrelated processes. Commit and push authorized changes with explicit runtime limitations if any remain.

## Acceptance cases

1. Five paired fixtures shared by multiple books are five urgent fixtures, not five per provider/market.
2. A 6h-away quote observed 90s ago remains an observation; the same receipt after promotion to urgent is expired.
3. A 25h fixture gets no repeated detail request during its one-hour interval; a manual refresh admits one job, respects source backoff, and does not reload its tab.
4. Distant scheduled waits never trigger source recovery; missing near receipts can still be reported accurately.
5. Incoming suspension removes eligibility immediately in every tier. A clock tick, plan message or cache read never renews quotes.
6. Repeated manual clicks and plan delivery cannot overlap physical requests or grow unbounded queues.

## Verified outcome

Implementation, builds and runtime publication completed. See `../reports/2026-09-11-six-book-time-tiers.md` for test evidence and explicit CMD/IM/realtime-hydration limits. CMD runtime acceptance remains blocked by its missing native frame; no CGNEW parent reload was performed.
