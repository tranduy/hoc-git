# Fixed Notification Bell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the system notification bell fixed in the top-right corner without shifting the football comparison toolbar.

**Architecture:** Split the maintenance controls into a normal-flow refresh action and a fixed notification layer. Preserve the existing API polling and popover behavior while using stable CSS positioning and viewport constraints.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library.

## Global Constraints

- Preserve the existing refresh action, confirmation, polling, notification badge, and popover content.
- The bell must not consume toolbar width or shift comparison controls.
- The popover must remain inside narrow viewports.

---

### Task 1: Fixed notification layer

**Files:**
- Modify: `apps/web/src/components/maintenance-controls.tsx`
- Modify: `apps/web/src/components/maintenance-controls.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `MaintenanceControls` props and `MaintenanceApiLike`.
- Produces: `.maintenance-actions` in normal flow and `.maintenance-notification-layer` fixed to the viewport.

- [ ] **Step 1: Add a failing component assertion** requiring a fixed notification layer separate from the refresh action.
- [ ] **Step 2: Run `npm.cmd test --workspace @tool-chenh/web -- --run src/components/maintenance-controls.test.tsx` and confirm RED because the layer is absent.**
- [ ] **Step 3: Split the component markup and add stable top-right/popover CSS with a narrow-screen rule.**
- [ ] **Step 4: Re-run the focused test and confirm GREEN.**
- [ ] **Step 5: Run the full web test suite, typecheck, production build, and `git diff --check`.**

