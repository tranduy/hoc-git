# Shared MAIN branch handoff ? 2026-09-08

The consolidated working branch is **`feat/realtime-hardening`**, checked out at **`F:\0. PROJECT\tool-chenh`**. Start the next provider task from this branch. No new integration branch or runtime was created for this handoff.

## Integrated work

- The earlier shared checkpoint `82df066` already contains the BTI worker package, the initial SBOBET package and the other work then present in MAIN. Its [integration record](2026-09-08-integrated-worktree-checkpoint.md) preserves verification results and limitations.
- The current SBOBET implementation is included through `31ef4eb`, `7f9a815`, `f46e3ce`, `dc9669e`, `b3e0029` and `30e1bea`. Deployment and native evidence are recorded in [the SBOBET production report](2026-09-08-sbobet-main-production.md).
- The two remaining SBOBET investigation reports have now been preserved in this shared branch with historical-status notices.
- CMD and IM worktrees have no changes beyond baseline `1710d64`. The completed BTI and SBOBET worktrees were removed at the user's request after comparison against MAIN and verified backup. All 22 BTI and 40 SBOBET dirty/new paths were already integrated or superseded by newer MAIN code.
- The two removed working copies are preserved in `.run/worktree-archives/20260908-165435-bti-sbo/`: verified ZIPs hold all 3,255 non-dependency files, including ignored investigation evidence and nested Git histories; the manifest records per-file SHA-256 hashes. A verified Git bundle, patches and index listings preserve their original branch/index state. Only regenerable dependencies and the top-level worktree linkage were excluded. The worker branch refs remain available; current implementation belongs to MAIN.

## Accepted scope and next step

The user has now accepted the current BTI collection as sufficient for this phase and requested consolidation before the next action. All completed SBOBET and BTI implementation commits are already contained in `feat/realtime-hardening`. Continue from the main checkout above. The old worker branches still retain their separate historical WIP baseline; their implemented changes were integrated through the checkpoints listed above. The archived historical working copies must not be reapplied over the newer integrated implementation.

The user accepted the current SBOBET hidden-market collection with a tolerance of one or two missing markets. Current evidence covers More for 491/491 prematch owners, with actual automatic hidden-price changes and automatic recovery of the two delayed owners. This is acceptance of the current collection scope, not a claim that every provider has passed live hidden-market acceptance.

The user explicitly deferred continuous operation, session maintenance and 24/7 hardening to a later phase. Preserve the deployed SBOBET functionality; do not begin another maintenance audit or provider implementation until the user supplies the next provider plan. SABA is not an active task in this handoff.

## Runtime and verification boundary

### BTI follow-up completed

The subsequent user-authorized BTI task is integrated on this same branch in `665dc88` and `6eabfd0`. Current runtime is extension **0.2.75** and managed stack `sha256:b98e008181348abe1a356870f86f274d7fd04ad32b695bb3382d4d61a6920e97`. Current evidence verifies detail for all 1,466 prematch owners and 26,760 supported markets added beyond the roster, with actual automatic hidden-price updates. See [the BTI production report](2026-09-08-bti-all-early-production.md). Deployment leases are released; continuous/session/24-hour work remains deferred by the user.

The paragraph below records the earlier SBOBET-only consolidation boundary and is historical.

The managed runtime remains on extension **0.2.73**, implementation `30e1bea`. This consolidation only preserves documentation and records the accepted handoff; it does not change application code, build output, source tabs or processes. Earlier focused implementation tests and live evidence remain the applicable checks; no test/build/live window was repeated for these documentation changes. Git diff checks and branch ancestry were verified for this handoff.
