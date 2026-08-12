# Validated Catalog Source Binding Design

## Goal

Keep every supported Fabet lounge attached to its newest validated launch after a
domain or one-time token rotation, without changing bettor-account identity and
without trusting a new hostname automatically.

This is the next bounded step toward the fixed project goal: ingest all lounges
listed in `sảnh.md`, normalize their real events and exact two-outcome markets,
then compare only identical tickets across at least two providers.

## Scope

The binding layer covers only provider/category pairs for which a catalog reader
exists in the running application:

- SABA Football and LoL
- SBOBET Football
- APSPORT Football
- BTI Football
- IM LoL
- CMD Football only after a current launcher and reader schema validate
- IM Football and BTI LoL only after their catalog adapters validate

It does not enable betting, submit a slip, infer an unsupported provider, or
promote an unvalidated session.

## Chosen Architecture

Create a stable logical catalog source for each supported `provider + category`.
The logical source is separate from bettor accounts used for profile, balance,
preflight, receipts, and future execution.

The binding resolver selects a backing session only when all of these are true:

1. The session state is `ACTIVE`.
2. Provider and category exactly equal the logical source.
3. The pair has a registered catalog reader.
4. The session came through the existing trust and validation pipeline.
5. The candidate is newer than the currently bound session, ordered by captured
   time with a deterministic ID tie-break.

Unknown providers, category-null legacy sessions, expired sessions, schema
errors, and newly observed untrusted hostnames are never eligible.

## Data Flow

1. Fabet login or manual token capture stores launches in the encrypted vault.
2. Existing validators establish provider, category, hostname trust, and session
   health.
3. The binding resolver reads redacted session metadata and chooses the newest
   eligible session for each supported pair.
4. The accounts/catalog API exposes one stable catalog source per pair.
5. A catalog request resolves that stable source to its current backing session.
6. Existing source-key single-flight, timeout, five-second bounded last-success
   cache, telemetry, normalizer, exact mapping, ranking, and preflight gates run
   unchanged.

The UI therefore stops depending on manually created account IDs after launch
rotation. It can retain provider selection across refreshes because the logical
catalog source ID remains stable.

## Separation From Betting Accounts

A logical catalog source has catalog capability only. It cannot satisfy profile,
balance, preflight, receipt, prepare, commit, or execution checks.

When a ticket is evaluated, catalog legs identify provider prices while a
separate eligible bettor account for the same provider/category must independently
pass profile freshness and ticket preflight. Rebinding a catalog source must not
rebind or mutate a bettor account.

## Persistence And Failure Handling

Logical bindings are recoverable derived state. Persistence is best-effort and
must be wrapped in `try/catch`; a write failure cannot block health, an existing
catalog read, or another provider.

If no eligible session exists, the source reports unavailable with an explicit
reason. The application may show a bounded last-success snapshot as stale, but
stale data cannot create a green ticket, profit toast, or executable preflight.

Old sessions and manual accounts are not deleted because they are audit evidence.
Secrets, launch URLs, cookies, tokens, usernames, and passwords are never emitted
through catalog-source DTOs, logs, or UI.

## User Interface

Football and LoL remain separate screens. Each provider appears once per screen:

- connected when the logical source has an eligible backing session;
- source expired, schema error, or not configured when it does not;
- stale when only the bounded last-success catalog is visible.

Provider checkboxes continue controlling comparison. Existing side-by-side exact
ticket rows, countdown/live clock, top-five profit ranking, green eligibility,
five-second toast, and sound behavior are unchanged.

## Testing

Implementation follows red-green TDD and must cover:

- newest exact provider/category ACTIVE session wins;
- an unvalidated newer session cannot replace a validated session;
- category-null and wrong-category sessions cannot bind;
- unsupported pairs cannot acquire a logical source;
- tie-breaking is deterministic;
- persistence failure leaves existing reads operational;
- UI retains selection when the backing launcher changes;
- catalog-only sources cannot be used for preflight or execution;
- source expiration disables signals while preserving an explicitly stale view;
- full workspace verify and production build pass with live browser processes
  stopped to avoid Playwright resource contention.

## Completion Criterion

After a validated Fabet launcher rotates, the corresponding Football or LoL page
uses the new session without manual account registration or checkbox repair. No
new host is trusted automatically, no unsupported lounge is presented as healthy,
and no betting path becomes enabled by this feature.
