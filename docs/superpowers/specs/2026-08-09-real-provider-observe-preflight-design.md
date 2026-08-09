# Real Provider Observe and Two-Leg Preflight Design

## Outcome

Replace the misleading fixture-only operator flow with an explicitly sourced live pipeline that can authenticate two accounts, show each account's profile and balance, prioritize upcoming Football and LoL events, compare only settlement-equivalent markets, and prepare a two-leg arbitrage ticket. This milestone does not submit a real wager. Provider-specific submission remains disabled until both providers have separately verified execution adapters and the operator confirms each opportunity.

## Non-negotiable safety rules

- Raw tokens, cookies, launch URLs, passwords, and authorization headers never appear in the API, UI, logs, diagnostics, test snapshots, or source control.
- Every account has a stable local alias and an identified provider before profile, balance, odds, or execution capabilities may be used. Unknown-source tokens remain `ACTION_REQUIRED`.
- Fixture and live records can never share a runtime or UI state. Every snapshot declares `dataMode: LIVE | FIXTURE`; production defaults to `LIVE`, while fixtures require `FIXTURE_MODE=1`.
- A market is comparable only after exact event, scope, line, selection domain, settlement profile, currency, fee, and quote-freshness validation.
- No leg may be submitted from this milestone. The only allowed output is a short-lived, server-signed preflight ticket describing two proposed legs.
- Future execution must require explicit confirmation for each ticket. It must revalidate both sessions, balances, market availability, odds tolerance, stake constraints, and ticket expiry immediately before attempting either leg.
- Two independent bookmakers do not offer an atomic transaction. Even with parallel submission, one-sided exposure cannot be eliminated. The UI must state this and never use language such as “guaranteed” or “risk-free.”

## Architecture

### Provider capabilities

Each provider adapter exposes independent read-only capabilities:

- `validateSession(secret)` identifies whether the session is currently usable.
- `readProfile(secret)` returns a redacted account identifier, display name, currency, balance, and provider timestamp.
- `streamCatalog(secret, sink)` emits events, markets, quotes, and connection status.
- `quoteBet(request)` is reserved for a later execution milestone and is absent from read-only adapters.

CMD is the first real vertical slice because the successful Fabet bootstrap captured CMD-labelled launch sessions. SABA, SBOBET, APSPORT, and BTI follow only after their launch identity and protocol are independently proven. Domain heuristics alone cannot activate an adapter.

### Account registry

Session records gain a user-controlled `accountAlias` and a verified provider identity. The public account model contains only:

- account ID and alias;
- provider and source;
- redacted account label;
- currency and balance as plain decimals;
- profile/session states and redacted reason;
- profile and balance timestamps;
- capabilities (`PROFILE`, `CATALOG`, `PREFLIGHT`, later `EXECUTION`).

Direct token entry requires selecting a provider. Launch URLs may suggest a provider, but remain unverified until that provider's session validator succeeds. Multiple accounts for the same provider are supported.

### Live catalog and prioritization

Live adapters normalize data into the existing event, market, quote, mapping, and opportunity pipeline. Upcoming events are sorted by:

1. live events;
2. nearest non-negative start time;
3. verified opportunity net margin;
4. quote freshness.

Football and LoL remain separate categories. The UI shows all observed markets, but only exact verified mappings may produce an opportunity. Price history is maintained as bounded server-side samples so the UI can show direction, last change, and short-window volatility without inventing predictions.

### Two-account pairing and preflight

The operator selects Account A and Account B. They must be distinct active accounts with profile and balance data in compatible currencies. For a verified opportunity the server computes native-currency stakes using the existing exact-decimal optimizer, then performs a fail-closed preflight:

1. capture a single server wall/monotonic time boundary;
2. validate both sessions concurrently;
3. refresh both profiles/balances concurrently;
4. refresh both market quotes concurrently;
5. verify identical canonical event/market/selection semantics;
6. verify quote age, odds tolerance, market status, stake step/min/max, and available balance;
7. recompute realized base-currency worst-case profit after fee and FX assumptions;
8. issue a signed, single-use ticket with a maximum lifetime of 3 seconds.

Any missing, stale, inconsistent, or failed check returns a typed rejection and no ticket. A preflight ticket is not a wager and provides no execution endpoint in this milestone.

### User interface

The Sessions page becomes Accounts & Sessions and adds profile/balance cards. Tokens remain write-only inputs. The category pages add explicit `LIVE DATA` or `FIXTURE DATA` badges, upcoming/live grouping, start countdown derived only from server timestamps, and market movement columns. The Opportunities page adds Account A/B selectors and a `Prepare two-leg ticket` action. The resulting dialog shows both proposed legs, balances, odds, stakes, quote ages, expiry countdown, fees, FX, and the non-atomic execution warning. There is no submit-bet control.

## Failure handling

- Authentication, schema, or profile errors quarantine only the affected account/provider adapter and immediately remove dependent opportunities.
- Sequence gaps, clock regressions, invalid full snapshots, or stale quotes fail closed through the existing QuoteBook quarantine.
- Balance and profile data expire after 30 seconds; quotes retain provider-specific sub-second/second TTLs.
- Provider redirects and network endpoints are treated as untrusted until exact identity validation succeeds.
- Restarts reload encrypted sessions but require fresh validation/profile/catalog snapshots before showing live opportunities.

## Verification

Tests cover schema redaction, two accounts on one provider, unknown token rejection, balance freshness, no fixture/live mixing, deterministic upcoming sorting, exact market mapping, price-history bounds, concurrent preflight checks, ticket signing/expiry/single use, and every fail-closed rejection. Integration tests use protocol fixtures with canary secrets. E2E proves the operator can see balances and upcoming markets and can prepare—but cannot submit—a two-leg ticket. A live smoke tool may inspect CMD metadata but must never print secrets or place a wager.
