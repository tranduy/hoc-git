# Multi-lounge realtime source design

## Goal

Load every verified Fabet lounge from `sảnh.md` through one stable source per
provider/category/session, publish live odds without allowing a slow browser
reader to block other sources, and feed the approved left-list/right-detail UI.

## Source identity and routing

`AccountRegistry` resolves an account to a redacted `CatalogSourceIdentity`:
provider, category and session id. `MultiProviderCatalogReader` selects exactly
one registered reader using provider/category; it must never probe unrelated
readers. Several account aliases bound to the same session share the key
`provider|category|sessionId`.

## Read lifecycle

The catalog route keeps one in-flight read per source key. Every HTTP caller
races that shared read against a short request deadline. A timed-out caller gets
`503 CATALOG_TIMEOUT`; the underlying read remains single-flight and may update
the source cache when it completes. Later callers must not start another browser
read while it is running. A successful cached catalog is rebound to the caller's
account id without changing provider event/market/selection identity.

The last successful snapshot remains visible in the web client with explicit
age and source state. Timeout, expired session and schema error are distinct
from a successful empty catalog. No storage/logging failure may interrupt quote
ingress.

## Lounge registry

Stable display identities are K-Sports/SBOBET, I-Sports/IM, AP
Sports/APSPORT, C-Sports/SABA, SABA Esports, BTI and T-Sports/CMD (CGNEW).
Dynamic domains and launch tokens are evidence inputs, never stable ids. New
launch URLs are collected by clicking the current Fabet lobby cards.

## UI data flow

The server publishes source deltas over the existing realtime socket. The web
client updates only affected rows. The approved desktop layout uses a ranked
signal list on the left and the selected event/ticket detail on the right.
Current prices are always shown; green state, toast and sound require exact
two-outcome mapping plus fresh executable two-leg preflight.

## Safety and correctness

- Read-only OBSERVE mode remains the default.
- No guessed provider, event, market, line, orientation or settlement mapping.
- No cached snapshot may be labelled live after its freshness deadline.
- Real betting remains outside this design and requires action-time approval.
- Secrets and launch URLs are never returned, logged or committed.

## Success criteria

1. Duplicate account aliases for one source cause one provider read.
2. A hung source returns a bounded HTTP timeout while health and other sources
   continue responding.
3. Completion after a caller timeout updates cache exactly once.
4. Provider/category routing invokes only the correct reader.
5. UI retains the last snapshot and displays stale/error instead of an empty
   catalog when a refresh fails.
6. Focused tests, full API/web tests, typecheck and production builds pass.

