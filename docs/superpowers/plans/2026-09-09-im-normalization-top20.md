# IM, market normalization and top 20 implementation plan

> **For agentic workers:** Apply the independent tasks in parallel with focused
> verification. The user explicitly authorized implementation and deployment
> without further confirmation; do not add approval gates.

**Goal:** Check IM account-block/traffic causes without request storms, complete
> safe collection where demonstrable, standardize matching and show top 20.

**Architecture:** Reuse existing provider adapters and canonical comparison
rules. Diagnose IM passively first; fix proven request/retry faults before any
active IM request. Keep unsupported/blocked IM states explicit.

**Tech Stack:** TypeScript, Chrome extension, Node API, React, Vitest.

**Spec:** User's three explicit tasks in this chat on 2026-09-09.

- [x] IM: read prior native-status evidence and actual request scheduler; inspect
  the user-opened tab without repeated provider fetch/reload. Initial diagnosis
  bounded to about 10 minutes. Persist block/rate-limit guards across generations
  if active collection is enabled. Stop on recurring block and report the limit.
- [x] Normalize: inspect existing canonical types/scope/line/side/settlement;
  implement high-confidence supported corrections with failing/passing examples.
  Preserve ambiguity, live/prematch and product separation.
- [x] UI: replace top-50 rendering limit with top 20; preserve ranking and detail
  selection, update its existing regression.
- [x] Integrate: review independent changes, run focused checks/typechecks,
  coordinate one final build/handoff where possible; finite observation, no bets,
  no unsolicited account/profile probes, no repeated external recovery loop.
- [x] Report each task's actual result, including IM block/coverage limitations.

Ownership: root IM/live/deployment; im_request_audit read-only IM audit;
normalize_markets comparison/contract code; top20_ui page and its UI test.
Preserve all pre-existing dirty maintenance and CPU changes. No commits/resets.

Later user steering also completed: fix coalesced worker traffic under load;
audit real missed matches and theoretical ROI; repair stale-third-provider
suppression of fresh pairs. IM live collection remains unaccepted because no
recognized IM tab attached during the finite observation; no new provider probe
was forced. See the corresponding 2026-09-09 report for measured limits.
