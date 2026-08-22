# Hide Football Live Navigation

## Goal

Remove the fixed primary navigation rail from `/football-live` and let the live football workspace use the full viewport width. Keep navigation and layout unchanged on every other route.

## Design

`App` derives a route-specific shell modifier for `/football-live`. On that route it does not render the primary navigation element. The main content receives a full-width layout modifier that removes the desktop `224px` width and left margin, and removes the mobile bottom padding previously reserved for bottom navigation.

Route handling, page content, browser history, skip navigation, and the visually hidden route announcement remain unchanged. `/lol-live` and all other routes continue rendering the existing navigation.

## Verification

- Component test: loading `/football-live` does not expose `Primary navigation`, and the shell/main use the full-width modifier.
- Component test: loading another route still exposes `Primary navigation`.
- Existing web tests remain green.
- Browser verification: `/football-live` has no left rail and its content fills the released space at desktop width.

## Scope

Only the web shell, its related styles, and focused navigation tests are changed. No catalog, API, provider, or betting behavior is modified.
