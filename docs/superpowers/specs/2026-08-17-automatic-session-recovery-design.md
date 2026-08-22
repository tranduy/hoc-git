# Automatic Session Recovery Design

## Goal

Keep the real-time Football catalog running without requiring an operator to
enter a new Fabet mirror domain or repeatedly reload provider tabs. The system
must start discovery from `https://fabet.com`, follow the current redirect,
authenticate when required, refresh the dependent provider sessions, and keep
provider catalog traffic off the authentication tunnel.

This feature only restores read-only catalog sessions. It does not submit bets.

## Providers and ownership

- CMD remains independent and continues using its existing direct/TK88 data
  paths. A Fabet failure must not restart or invalidate CMD.
- SABA, IM, SBOBET, APSPORT, and BTI may obtain fresh launch/session material
  from the authenticated Fabet lobby.
- A provider that still has a valid anonymous/direct session remains running;
  authentication is attempted only after an explicit authentication failure.
- A later third-party account source is represented as a second credential
  source with the same interface. Sessions from different account sources are
  never mixed.

## Portable authentication egress

The login workflow depends on an `AuthEgress` interface, not Cloudflare WARP:

1. `DirectAuthEgress` is always tried first and is sufficient on hosts that can
   reach `fabet.com` directly.
2. The local development machine may use `WarpSocksAuthEgress`. It places WARP
   in local SOCKS5 proxy mode, so only the temporary Fabet authentication
   browser uses the tunnel. Normal system and provider traffic stays direct.
3. Packaged/server deployments may supply an HTTP/SOCKS egress or a remote
   authentication broker through the same interface. Absence of WARP does not
   prevent startup or direct authentication.

The egress is used only for root-domain discovery and Fabet authentication.
After login, the proxy browser is closed. A direct browser reopens the verified
final Fabet mirror with the persisted encrypted browser state and launches the
provider pages without VPN/proxy routing.

The WARP adapter records the original client mode and connection state, owns a
bounded lease while authenticating, and restores only state that it changed.
Crashes are recovered from a small non-secret lease record on next startup.

If no configured egress can reach the root domain, the system reports
`AUTH_EGRESS_UNAVAILABLE`, retains last verified snapshots as stale/display
only, and retries with bounded backoff. It must not guess a mirror or send
credentials to an unverified host.

## Domain discovery and trust

Every new authentication cycle starts at exactly `https://fabet.com/`.
Redirects are followed in a real browser because anti-bot and client-side
redirects are not reliably visible to a plain HTTP fetch.

Before credentials are entered, the final origin must satisfy all checks:

- HTTPS with no URL username/password and no IP-literal host;
- reached through the current root-domain navigation chain;
- expected Fabet login/lobby structure is present;
- expected same-origin authentication/API behavior is observed;
- the page is not an error, captive portal, or unrelated redirect.

Only then is the hostname stored as the last verified mirror. The stored mirror
is diagnostic/cache information, not operator configuration and not the entry
point for the next renewal.

## Credential storage

Credentials and exported browser authentication state are encrypted through
the existing `SecretProtector` boundary. Packaged Windows builds use DPAPI under
the current Windows user. Server builds use an operating-system secret store or
a deployment secret/KMS-backed protector; the clear credentials are never an
environment variable. They must never be written to source files, `.env`, web
storage, URLs, telemetry, screenshots, stdout, or error messages. All errors
and captured payloads pass through the existing redaction layer.

The session record stores a credential-source ID rather than exposing the
username. Reset deletes the encrypted record and browser state after an
explicit confirmation.

## Recovery state machine

Each credential source has these states:

`ACTIVE -> SUSPECT -> REFRESHING -> ACTIVE`

Failure states are `AUTH_EGRESS_UNAVAILABLE`, `ACTION_REQUIRED` (CAPTCHA/OTP),
`UNAUTHORIZED`, and `FAILED_BACKOFF`.

A refresh is triggered only by evidence such as:

- HTTP 401/403 or provider-specific expired-token response;
- provider page returning to a login/expired launch screen;
- token expiry timestamp reached;
- repeated authenticated catalog probes failing with an auth-specific reason.

An empty catalog, market suspension, schema diagnostic, or ordinary timeout is
not enough to classify a session as expired.

There is one single-flight refresh for a credential source. All dependent
providers wait for that operation rather than opening their own login browsers.
Retries use bounded exponential backoff with jitter and a circuit breaker. A
success resets the failure counter.

## Refresh transaction

1. Mark dependent sources `SUSPECT`; keep their last verified snapshots as
   stale/display-only and disable fresh signals.
2. Acquire the source-level single-flight lock.
3. Navigate the temporary authentication browser to `fabet.com` through the
   first working authentication egress.
4. Validate the redirected Fabet origin and authenticate using the encrypted
   credentials. CAPTCHA/OTP transitions to `ACTION_REQUIRED` without bypass.
5. Persist browser storage state, close the tunneled browser, and verify that
   the final mirror is reachable directly.
6. Open one direct Fabet lobby context and launch only provider pages that need
   renewal. Capture their fresh launch/session material atomically.
7. Validate each provider independently by reading a successful fresh catalog,
   not merely by observing a loaded page.
8. Publish replacement sessions only for providers that passed validation.
   One failed provider must not roll back healthy siblings.
9. Close transient pages in `finally`; reuse healthy provider pages and close
   them after the existing idle timeout.

## Resource limits

- At most one authentication browser and one launch operation per credential
  source may run concurrently.
- Provider pages are reused; no polling cycle may create a new persistent
  browser profile.
- Every temporary page/context has a deadline and closes in `finally`.
- Shutdown cancels pending refreshes and closes all owned browsers.
- Logs are bounded and contain state transitions and timings only, never page
  bodies, cookies, tokens, or credentials.

## Health and UI

The Sessions/source status surfaces the exact cause and next retry time:

- active and last successful validation time;
- refreshing;
- authentication egress unavailable;
- CAPTCHA/OTP action required;
- provider validation failed;
- stale snapshot retained/display-only.

The dashboard must continue showing healthy providers while another source is
recovering. No source is described as having zero matches unless a fresh,
authenticated catalog read succeeded with an actual zero count.

## Tests and acceptance criteria

Automated tests must prove:

- discovery always begins at `fabet.com` and accepts browser redirects only
  after origin/page attestation;
- direct egress works without WARP installed;
- local SOCKS mode routes only the authentication browser;
- provider launch/catalog requests are direct after authentication;
- credentials/tokens never appear in logs or public API responses;
- simultaneous provider expiry causes exactly one login;
- empty catalog and schema errors do not trigger login;
- 401/403 and verified expiry trigger renewal;
- CAPTCHA/OTP fails closed as `ACTION_REQUIRED`;
- partial provider recovery preserves healthy siblings;
- repeated failures back off and do not leak Chrome processes/tabs;
- shutdown leaves no owned browser process;
- a restarted application reuses the encrypted credential and browser state;
- a second credential source can be added without changing provider readers.

Live acceptance is read-only: expire or reset the development Fabet session,
observe automatic root-domain discovery/login, then verify fresh catalogs from
each dependent provider. No real-money action is authorized by this feature.
