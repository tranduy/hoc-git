# SBOBET Non-Destructive Recovery Design

## Goal

Keep SBOBET/KSPORT realtime recovery inside the already-open provider page and prevent automatic recovery from navigating a healthy signed session away from its working socket.

## Confirmed failure

The web recovery client first requests an in-page snapshot. When that request does not return a confirmed baseline, `AUTO` currently falls through to `/api/maintenance/refresh-provider/SBOBET`. That hard path obtains a new launch URL and navigates the existing KSPORT tab. The replacement document can have transport traffic while producing no usable catalog.

A second false-ready condition exists after the retained WebSocket cache no longer contains both full Live and Today snapshots: the live tracker still remembers that both partitions once completed, so same-tab recovery returns success without selecting the missing provider period again. Replay then has no complete baseline to send.

Current KSPORT traffic can be owned by a dedicated worker. Recovery therefore cannot assume a page `window`: socket discovery and reconnect must use the target-global `globalThis.WebSocket` so the same operation works in both iframe and worker targets.

After an MV3 extension reload the provider worker can already exist before the observer attaches. It must be rediscovered with `Target.getTargets`, attached as a worker, and tried before the slower page heap. A URL-only `/api/v2/getEvent` replay is not sufficient because the current provider session can keep request authentication inside its SPA/worker context and return 500 to a reconstructed request.

## Required behavior

- `AUTO` recovery for SBOBET may request a fresh snapshot from an attached `KSPORT` or `SBO` source, but must never call the hard provider-refresh endpoint.
- A failed SBOBET automatic snapshot remains a failed automatic attempt and follows the existing countdown/manual lifecycle.
- `MANUAL` recovery keeps the existing targeted hard-refresh behavior.
- Other providers keep their existing automatic hard-refresh fallback.
- KSPORT readiness requires a complete retained current-generation Live + Today baseline, not only historical tracker state.
- If retention lost a full partition, same-tab recovery must select the missing period again.
- A pre-existing KSPORT catalog socket in a dedicated worker must be reconnected in that worker without navigating or closing the provider tab.
- If authenticated direct replay cannot rebuild the paired catalog and no catalog socket remains, recovery selects the provider's native Today and Live controls and captures the exact two SPA-issued responses.
- Native Live/Today recovery is bounded to one attempt per eight seconds, is fenced to the current source/worker generation, and leaves the provider on Live.
- A worker result is accepted only while its exact target/session binding is still current; a replaced worker fails closed.
- Menu counters, heartbeat, pong and null envelopes remain non-catalog evidence.

## Verification

- Web unit test proves failed `AUTO` SBOBET performs only source discovery and snapshot request.
- Extension unit test proves an evicted KSPORT full partition makes the source incomplete and causes same-tab period selection.
- Extension unit test proves a dedicated-worker socket is discovered through `globalThis` and receives the bounded same-tab reconnect operation.
- Extension unit tests prove worker rediscovery, current target/session binding, replaced-worker rejection, authenticated native fallback and the eight-second retry bound.
- Web and extension tests, typechecks and production builds pass.
- Runtime diagnostics must show the same source tab, a fresh SBOBET catalog baseline, decoded catalog data and continuing semantic price changes before the fix is reported successful.
