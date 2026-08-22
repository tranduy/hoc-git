# Fixed Notification Bell Design

## Goal

Move the maintenance notification bell to the top-right viewport corner without shifting the football comparison controls or match workspace.

## Design

- Render the maintenance action separately from the notification bell.
- Keep the maintenance action in the existing control flow.
- Render the bell in a fixed top-right layer with a stable 42px footprint and a notification-count badge.
- Anchor the notification popover below and to the right of the bell, constrained to the viewport.
- Preserve the existing polling, refresh action, notification content, and accessibility labels.
- On narrow screens, keep the bell inside the viewport and constrain the popover width.

## Verification

- Component test proves the refresh action remains in normal flow and the bell is rendered in the fixed notification layer.
- Web tests, typecheck, and production build must pass.

