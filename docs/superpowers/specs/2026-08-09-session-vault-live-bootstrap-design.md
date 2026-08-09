# Session Vault and Live Provider Bootstrap Design

## 1. Goal and scope

Build a local, Windows-first session subsystem that can:

- accept either Fabet username/password or a provider token/launch URL supplied directly;
- persist secrets across browser refreshes and application restarts without committing or logging them;
- validate each provider session, reuse it while healthy, and renew it after 24 hours or when the provider rejects it;
- discover the current Fabet login domain without assuming that `fabet.com` is reachable without a VPN;
- use the authenticated sports and esports lobbies to discover launch sessions and later feed real read-only provider adapters;
- let the operator reset all locally stored Fabet credentials, tokens, and browser state after an explicit confirmation.

This design covers authentication, session health, and read-only bootstrap. It does not submit bets. Any future wager submission must require a fresh, explicit operator confirmation immediately before every external submission, including test wagers and each leg of a multi-book hedge.

## 2. Decisions

### 2.1 Local Windows vault

The API process owns all secrets. It encrypts secret payloads with Windows DPAPI scoped to the current Windows user and stores only the encrypted envelope in an ignored local application-data directory. The React client never receives a password or complete token after submission.

The encrypted payload may contain:

- Fabet username and password;
- manually supplied provider token, cookie bundle, or launch URL;
- provider-specific refresh material;
- trusted browser storage captured by the isolated local browser profile.

Plain metadata may contain provider, source type, trusted hostname, creation time, last validation time, next forced renewal time, and redacted token fingerprint. Plain metadata must never contain account identifiers, cookies, query tokens, authorization headers, or full launch URLs.

### 2.2 Source-agnostic sessions

A session record has one of two sources:

- `FABET_LOGIN`: login through a trusted current Fabet domain, then capture provider launch sessions from its lobbies.
- `MANUAL_PROVIDER_SESSION`: accept a token, cookie bundle, or launch URL for a named provider without requiring Fabet.

Manual sessions are first-class. Validation and renewal are provider-specific and must not assume that the token originated at Fabet. If a manual session has no supported refresh mechanism and no saved login credential, expiry moves it to `ACTION_REQUIRED` instead of attempting a guessed login.

### 2.3 Domain discovery and trust

`fabet.com` is a discovery hint, not a guaranteed endpoint. The operator can enter the currently reachable Fabet URL directly when VPN or Cloudflare WARP is required.

The resolver performs an unauthenticated navigation first and records the final HTTPS hostname. Credentials are never sent during discovery. Before the first credential submission to any new hostname, the UI displays the exact hostname and requires one-time trust approval. Trusted hostnames are stored locally; TLS errors, downgrade to HTTP, cross-origin credential forwarding, and unexpected redirects fail closed.

If discovery is unreachable, the UI keeps manual provider-session entry available. A Fabet outage must not invalidate otherwise healthy direct provider sessions.

## 3. Components

### 3.1 `SecretVault`

Provides `save`, `load`, `delete`, and `exists` operations over versioned DPAPI-encrypted records. It uses atomic replacement, restrictive local file permissions where Windows supports them, and a schema version for safe migration. Errors never include secret material.

### 3.2 `TrustedDomainStore`

Stores approved HTTPS hostnames and the time of approval. It does not wildcard sibling domains. A new redirect target requires separate approval. Reset removes Fabet-related trusted hosts.

### 3.3 `SessionManager`

Owns session state and serializes login/refresh attempts so concurrent health checks cannot create multiple sessions. Its states are:

- `UNCONFIGURED`
- `VALIDATING`
- `ACTIVE`
- `RENEWING`
- `ACTION_REQUIRED`
- `INVALID`

Every record contains `acquiredAt`, `lastValidatedAt`, `renewAfter`, redacted fingerprint, source type, provider, and health reason. `renewAfter` is set to `acquiredAt + 24 hours`. Provider rejection can force renewal earlier.

### 3.4 `FabetBootstrapper`

Uses an isolated persistent browser profile owned by the local backend. It discovers or accepts the current trusted domain, performs login, and opens:

- `/lobby-the-thao?type=livesports`
- `/lobby-the-thao?type=esports`

It records only redacted provider identity and launch metadata. It does not infer that a logo equals a particular betting API. A provider becomes supported only after its authenticated launch session and read-only data protocol pass validation.

### 3.5 Provider session validators

Each supported provider implements a small validator that performs an authenticated, read-only request with a strict timeout. A successful HTML shell alone is insufficient. The validator must prove access to a provider identity or read-only event endpoint and classify failures as expired, unauthorized, unreachable, schema-changed, or unknown.

### 3.6 API and UI

The local API exposes write-only secret commands and redacted status responses:

- configure Fabet login;
- configure a manual provider session;
- approve a discovered hostname;
- validate or renew a session;
- reset Fabet configuration;
- list redacted provider/session health.

The web application adds a `Sessions` page with two entry modes, current domain/trust status, last validation, forced-renewal time, provider health, and actions for validate, renew, and reset. Password/token inputs are cleared immediately after submission and never repopulated.

Reset opens a confirmation dialog stating that local Fabet credential, tokens, trusted Fabet domains, and its isolated browser profile will be deleted. Cancellation changes nothing. Confirmation invalidates in-memory sessions before deleting persisted state and returns the UI to `UNCONFIGURED`.

## 4. Data flow

### 4.1 Fabet login

1. Operator enters a reachable Fabet URL and username/password.
2. Backend performs credential-free domain discovery.
3. If the final hostname is not trusted, configuration pauses and returns `DOMAIN_APPROVAL_REQUIRED`.
4. After approval, the backend stores the credentials encrypted and logs in through the isolated profile.
5. The bootstrapper visits both lobby categories, captures provider launch sessions, redacts captures, and validates each recognized provider.
6. Valid provider sessions become `ACTIVE`; unsupported or ambiguous launchers remain diagnostic entries and cannot produce comparison data.

### 4.2 Direct session

1. Operator selects a provider and submits its token, cookie material, or launch URL.
2. Backend parses it without logging the raw value, stores it encrypted, and runs the matching read-only validator.
3. A valid session becomes `ACTIVE`; invalid or unknown material is retained only when the operator explicitly chooses to save it for correction.
4. Real adapters may consume only `ACTIVE` sessions through an in-process secret handle; they never receive a serializable vault dump.

### 4.3 Renewal

The manager validates sessions at startup, before adapter connection, periodically with jitter, and when a provider rejects a request. At 24 hours it forces renewal even if the previous health check passed.

- Fabet-backed provider session: relaunch from the active Fabet login; re-login first if necessary.
- Refresh-capable manual session: use the provider-specific refresh flow and validate the result.
- Non-refreshable manual session: set `ACTION_REQUIRED` and stop the affected adapter.

During validation or renewal, existing quotes from that source become ineligible. No stale opportunity remains visible as executable.

## 5. Security and operational rules

- Bind credential endpoints to loopback and enforce the existing exact local-origin policy.
- Use `Cache-Control: no-store`, reject secrets in query strings, cap request size, and apply login/validation rate limits.
- Redact authorization, cookies, tokens, launch URLs, account identifiers, request bodies, and browser captures.
- Never commit production captures, browser profiles, encrypted vault files, or token fingerprints derived with a reversible scheme.
- Do not disable TLS checks, bypass CAPTCHA, or guess anti-bot signatures.
- Do not auto-trust redirect domains, even when their name resembles Fabet.
- Do not place or simulate a wager against the funded development account in this implementation.
- A future execution feature must show provider, event, market, selection, odds, stake, and maximum loss, then require a new confirmation immediately before each submission. Prior blanket approval is not sufficient.

## 6. Failure handling

- Fabet unreachable without VPN: show `UNREACHABLE`, retain encrypted configuration, and allow direct provider-session entry.
- New redirect hostname: pause before credential transmission and request hostname approval.
- Invalid credentials: clear active browser state, retain encrypted credentials only for operator correction, and rate-limit retries.
- Token expired or unauthorized: quarantine the provider session and attempt only its declared renewal path.
- Provider schema change: mark `SCHEMA_CHANGED`; do not interpret a generic page as successful validation.
- Vault decryption failure under another Windows user or machine: report `VAULT_UNAVAILABLE` and offer reset; never fall back to plaintext.
- Reset partial failure: keep adapters stopped and report which local artifacts could not be deleted without exposing their contents.

## 7. Testing and acceptance

### Unit tests

- DPAPI adapter contract, encrypted-record versioning, atomic save, delete, and redacted errors.
- Domain discovery never sends credentials; new hosts require exact approval; HTTP downgrade fails.
- 24-hour renewal boundary uses an injected clock and cannot double-refresh concurrently.
- Direct session remains independent of Fabet availability.
- Reset requires confirmation at UI level and deletes vault metadata, trusted domains, in-memory handles, and profile state.

### Integration tests

- Configure Fabet against a local fake login/redirect/launcher service, capture two redacted provider sessions, restart the app, and reconnect without re-entry.
- Configure a direct provider token while Fabet is unreachable and connect its read-only adapter.
- Expire sessions and verify refresh, re-login, or `ACTION_REQUIRED` according to declared capability.
- Reject a token and verify all quotes from that provider become ineligible immediately.
- Scan logs, API responses, fixtures, and git diff for submitted secret canaries.

### Live validation gate

Live validation uses the operator-supplied development account only for login and read-only launch/data capture. It must not click a final bet button or call a wager endpoint. Success requires:

- persisted login survives application and browser refresh;
- current trusted domain is visible;
- at least one provider launch session is captured and validated without secret leakage;
- session age and next forced renewal are displayed;
- reset confirmation deletes the local session and returns the page to `UNCONFIGURED`;
- real event/market/odds ingestion remains a separate provider-adapter milestone and is never represented by fixture data as live.
