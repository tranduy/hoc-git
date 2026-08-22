# Football compact dashboard

## Scope

The primary UI is Football-only. Remove the permanent left navigation from the application shell and route the root page to `/football-live`. Existing secondary routes remain directly addressable for diagnostics but are not shown in the primary screen.

## Layout

- Use the full viewport width without horizontal page scrolling.
- Use a compact single-line header for provider selection, base stake, alert threshold, refresh action, and source health.
- Below the header, use a 58/42 master-detail grid. The ranked match list scrolls independently on the left and the selected match detail remains sticky/independently scrollable on the right.
- On narrow viewports, stack list and detail vertically.

## Match cards

Each card is one compact clickable row containing competition, participants, provider badges, market and line, opposing best odds, ROI, estimated profit, live/start status, and freshness. The whole row opens its detail. Remove the separate `View & compare`/`Click for details` control. Preserve ROI-first ordering and existing negative/positive/live color states.

## Provider ticket navigation

When enabled by `ENABLE_OPEN_PROVIDER_TICKET=true` (default), detail odds expose `Mở kèo tại sàn`. The action must focus the exact attached provider tab and scroll/highlight the exact provider selection by its opaque provider IDs. It must not click the odds, add a betslip item, or submit a wager. Missing exact identity fails closed with a visible message. Setting the environment variable to `false` removes the action.

## Verification

Add regressions for the no-sidebar shell, full-card selection, compact information, responsive no-overflow behavior, env-gated ticket navigation, strict exact-identity navigation, and absence of betslip clicks. Run web/API/extension focused suites, typechecks, builds, and relevant full suites.
