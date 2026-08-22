# Direct Football Data Plane Design

Date: 2026-08-14

## Goal

Collect read-only Football event, market, selection, price, status and provider IDs from provider-owned realtime endpoints without keeping Fabet or TK88 in the realtime hot path. Execution remains disabled and LoL collection remains disabled.

## Source classification

Every provider is classified from a credential-free probe and verified protocol evidence:

- `PUBLIC_DIRECT`: the provider endpoint accepts a direct HTTP/WebSocket request without portal cookies. The connector may run entirely outside a browser.
- `AUTH_DIRECT`: the provider endpoint is direct, but it rejects requests without provider-issued authentication. A browser/portal may only bootstrap or renew an encrypted read-only transport lease; it is not used for each catalog read.
- `PENDING_PROTOCOL`: an exact endpoint/request/handshake has not been verified. The source stays unavailable and cannot contribute stale or synthetic prices.

Observed on 2026-08-14:

- IM snapshot/delta endpoints return HTTP JSON without cookies, but the provider envelope is `StatusCode=500`; a browser-issued provider auth context changes it to the accepted `StatusCode=100`. IM is therefore the first `AUTH_DIRECT` implementation target, not a public source.
- BTI catalog endpoint returns HTTP 403 without provider authentication: `AUTH_DIRECT`.
- SBOBET requires its verified `/api/v2/getEvent` request template and authenticated origin: `AUTH_DIRECT`.
- SABA uses Socket.IO push frames, but the browser currently creates the authenticated handshake: `AUTH_DIRECT` until the handshake lease is reproduced outside Playwright.
- APSPORT is `AUTH_DIRECT`: an authenticated launch exposes a snapshot endpoint at `/be-ui/pac/api/v3/events` and live WebSocket frames on `spws.agenate.com`. The adapter still reads DOM until snapshot and frame IDs are correlated to exact provider event/market/selection IDs.
- CMD has no current verified launcher or protocol: `PENDING_PROTOCOL`.

## Architecture

Each provider reader has two separate layers:

1. `bootstrap`: optional and infrequent. It discovers a validated endpoint/request template and, only when required, stores short-lived provider auth in the encrypted vault.
2. `data plane`: a long-lived Node HTTP/WebSocket connector. It performs bounded, single-flight snapshot/delta reads, preserves provider IDs, and emits freshness/health without reading the portal DOM.

The data plane never logs URL query secrets, cookies, authorization headers, request bodies containing tokens, or payload bodies. Diagnostics contain only provider, transport class, status code, content type, payload byte count, latency and freshness.

## Failure behavior

- Timeout, non-success status, invalid schema, category mismatch or stale data fail closed.
- A failed refresh does not become an empty catalog and does not erase the last verified snapshot; retained data is marked stale and cannot generate an alert.
- Delta sequence gaps force a new full snapshot.
- No provider is marked direct until repeated reads return validated Football records with stable provider IDs.

## Acceptance

- Fabet/TK88 processes can be closed after a valid provider transport lease has been captured; the direct connector continues until that provider lease expires.
- At least three consecutive source reads pass schema validation and retain provider event/market/selection IDs.
- The connector is single-flight, has timeout/backoff, and does not leak secrets.
- Existing Football normalization/mapping receives the same observed-catalog contract.
- Execution and LoL remain disabled.
