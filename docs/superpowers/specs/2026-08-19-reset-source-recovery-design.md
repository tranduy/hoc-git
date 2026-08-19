# Reset Source Recovery Design

## Goal

`Reset sàn` must recover every configured football source, including a source whose Chrome tab was closed. A reset is successful only after CMD, IM, SABA, SBOBET, APSPORT, and BTI publish catalogs acquired after the reset began.

## Design

The API keeps one installation-level Chrome bridge socket in addition to its per-source routing. A new strict `ENSURE_SOURCE` command carries a lobby identifier and a newly acquired credential-free HTTPS launch URL. The extension handles the command by navigating an attached tab, adopting an existing recognized tab, or creating and attaching a background tab when none exists. `RESTORE_SOURCE` recovers CMD from Chrome's recently closed session or a URL retained only for the lifetime of the Chrome process.

Fabet maintenance renews the parent session before resolving launch URLs. The five normal Fabet-derived launches come from the captured launch vault. CMD restoration does not require the Fabet lobby to expose a CMD card: Chrome restores the recently closed source, with `chrome.storage.session` as the in-process fallback. URLs are never written to logs, local extension storage, or tab preferences.

The frontend starts reset directly on the first click and immediately displays the existing full-screen progress state. The final API status remains authoritative.

## Safety and success rules

- Only credential-free HTTPS URLs recognized for the requested lobby may be opened.
- Created tabs are inactive and are attached to the existing read-only observer.
- Reset does not close unrelated tabs.
- The last recognized source URL may exist only in Chrome session storage and is cleared when Chrome exits.
- Missing installation bridge, undelivered ensure commands, unavailable launches, or stale/missing catalogs make reset fail with provider-specific diagnostics.
- All six configured football providers are required for success.
