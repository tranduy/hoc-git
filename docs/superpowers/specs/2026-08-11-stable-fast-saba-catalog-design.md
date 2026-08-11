# Stable Fast SABA Catalog Design

## Goal

Read the currently rendered Football handicap catalog from the SABA/CMD-style provider UI quickly and consistently without clearing a valid table by clicking the category on every sample.

## Design

The reader first probes the existing Football DOM. A usable snapshot contains at least one event with a supported full-time handicap group. Two structurally identical probes confirm that the SPA is not between render phases; price text may change between probes and the newest prices win. When no usable snapshot exists, the reader clicks Football once with no fixed delay and polls every 75 ms until two structurally identical usable snapshots arrive or a 3-second deadline expires. Recovery/reload remains the last resort.

Only bet type `1` (full-time Asian handicap) crosses the browser boundary. The observed catalog publishes only exact half-goal lines ending in `.5`, because those are the two-outcome tickets used by the comparison UI. The web refresh loop runs every 250 ms and retains its existing in-flight guard, so requests never overlap.

## Safety and correctness

- A structural fingerprint includes event, team, league, time, market, label and selection identifiers but excludes price text; live price changes therefore do not prevent completion.
- Empty or structurally changing DOM never replaces the last verified catalog.
- Stale snapshots remain display-only and cannot create a profit signal.
- No wager controls are clicked and no execution capability is added.

## Success criteria

- A valid open Football table is not clicked again.
- A partially rendered table is not accepted before its structure stabilizes.
- A stable steady-state read completes without the former 1.5-second fixed wait.
- Only full-time half-goal handicap markets are returned.
- The focused tests, full workspace verification and live repeated-sample probe pass.
