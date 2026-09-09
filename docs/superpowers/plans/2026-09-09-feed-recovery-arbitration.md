# Feed recovery arbitration — 2026-09-09

Repeated runtime outages after earlier deployments show interacting recovery
owners and retained failure state, not a basis for extending freshness timers.

1. Reproduce the controller latch: valid semantic deltas resume within an
   unexpired generation but STALLED/SOFT/HARD still make the registry publish stale.
2. Release that latch only when all existing live prerequisites pass at wall time.
   Preserve source, generation, real stream-gap, baseline-expiry and replay fences.
3. Stop dashboard AUTO fetch failures from invoking manual restore endpoints.
   Keep explicit manual reload and prefer the authoritative source during discovery.
4. Check current readable feed before backend recovery mutates a source after
   asynchronous confirmation/discovery. Keep baseline confirmation truthful.
5. Signal a proven faulted multipart source epoch through bridge rejection and
   the existing source resync path. A retry must not reuse the fenced epoch.
6. Expose bounded IM timeout stage/original failure time and gate status; do not
   recount cooldown evaluations as new failed requests or relax provider backoff.
7. Run focused regressions, independent review, builds and one managed handoff.
   Verify actual source transitions/baselines and the served dashboard; report any
   remaining outage explicitly rather than treating startup FRESH as stability.

Evidence: `.run/cmd-sbo-live-fix-2026-09-09/`. No betting actions.
