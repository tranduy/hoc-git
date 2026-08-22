# SBOBET/KSPORT realtime implementation plan

**Scope:** KSPORT CDP traffic, SBOBET catalog normalization, exact direct-price probing, and provider-specific runtime evidence only.

1. Decode fragmented SockJS/STOMP frames into typed `MESSAGE` receipts carrying destination, subscription, message ID, status, and body. Ignore late `RECEIPT` control frames and reject invalid/non-200 provider receipts.
2. Keep one KSPORT epoch per source/stream. Build the initial catalog only after authoritative `live` and `today` partitions both arrive. Replace each partition atomically by provider event ID; ignore hot-match duplicates and non-increasing message IDs.
3. Clear all epoch state on WebSocket lifecycle/reconnect. Keep the last published catalog in the data plane until the new epoch has a complete baseline.
4. Tighten KSPORT tab identity so Volta/error pages cannot be registered as the sportsbook.
5. Make the direct-price expression issue a fresh authenticated `getEvent` request and validate exactly one event, market, scope, line, outcome, market ID, and selection ID. Return NOT_FOUND/AMBIGUOUS otherwise; never return catalog odds.
6. Verify focused tests and typechecks, rebuild only required app artifacts, then collect non-invasive runtime evidence for frame/sequence/revision/UI, direct AH/TOTAL prices, and a ten-minute soak.
7. Update `docs/realtime-6-books-handoff.md`, stage only SBOBET/KSPORT hunks, and commit separately.
