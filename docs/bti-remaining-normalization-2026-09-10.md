# BTI remaining native markets — 10 September 2026

This change decodes BTI's remaining player, statistic, time-window, sequence and combined-result offers from corroborated native codes, selection IDs, labels, team sides and lines. It preserves every original native selection, odds value and status. An available selection that cannot be decoded stays visibly UNMAPPED even when other selections in its container have been normalized.

The fixed input captured at 02:55 local contains 1,600 events, 140,100 native observations, 97,657 canonical contracts and 320,229 quotes. Before this change, the native observations comprise 97,657 NORMALIZED, 25,138 EXCLUDED and 17,305 UNMAPPED. Another 11,174 EXCLUDED rows contain available offers whose now-supported settlement or outcome domain previously prevented normalization.

One player table can contain dozens of independently priced player contracts. Splitting that table by player, predicate and threshold raises the canonical market count without creating new source quotes. Canonical contracts, original source containers, available selections and opposing source-market pairs are different counting units.

## Controlled final result

| Measurement on identical input | Before | After | Change |
|---|---:|---:|---:|
| BTI canonical contracts | 97,657 | 291,411 | +193,754 |
| Wholly unresolved original UNMAPPED rows | 17,305 | 501 | −16,804 |
| Distinct opposing source-market pairs involving BTI | 32,133 | 37,487 | +5,354 |
| All five-book opposing source-market pairs | 58,339 | 64,500 | +6,161 |

An additional 61 handled containers still have 92 unresolved available selections; these are reported separately, not counted as fully normalized. The four whole-row gaps are QA5193/QA5195/QA5202 with 136 each and QA6020 with 93. Both whole and partial leftovers remain visible in native inventory.

The 193,754 new canonical contracts comprise 144,182 player contracts and 49,572 other contracts (170,924 binary and 22,830 categorical overall). Of these additions, 2,449 source markets actually find an opposing book in the fixed capture. No player opposing row is established by those peer snapshots. Normalization growth is therefore much larger than actual pairing growth.

BTI gains by peer: APSPORT 15,038 → 17,929 (+2,891), SBOBET 11,267 → 12,936 (+1,669), CMD 5,582 → 6,330 (+748), SABA 246 → 292 (+46). The all-book gain also includes equivalents between unchanged peer catalogs, so it is not the BTI-only gain. No previous pair is lost.

All 323,454 candidate native selection entries are conserved exactly, with zero missing, changed or invented entries and zero normalization diagnostics. The original 97,657 canonical markets and 320,229 quotes are unchanged. Final replay bundle SHA256: `44467b5117b3667af186aded828fca37b3e51875ac4b1c3b04ed7f9611c4ac39`. Evidence: `after-r3-ap-latest-result.json`, `after-r3-ap-latest-partial-available.json`, `final-evidence-summary.json`.

## Semantics and matching

- Native player ID, full name and known team side are retained on each player market and quote. Comparison requires a full-name/team candidate within an already-matched event; initials, unknown teams, contradictory identities and duplicate names with distinct native IDs cannot establish a route. Core execution still requires independent player resolution. Reversed fixtures swap the player side while preserving the original source identity.
- The public BTI renderer proves QA1337 parameter 1/2/3 means first/last/anytime scorer. Its public enum separately proves QA5401 is shots and QA5402 is shots on target. Exact no-scorer sentinels are distinct categorical contracts; they are not invented player identities or assumed under-0.5 quotes.
- Time predicates retain exact seconds and interval boundaries. A YES/NO condition at 600 seconds does not acquire an Asian-line PUSH settlement. First versus last, either versus both halves, goal versus corner/card and each team subject remain distinct.
- Three-way totals yield only mathematically equivalent strict over/under boundaries and exact ranges. European handicap HOME and AWAY offers have different equivalent Asian thresholds; only prematch comparisons use these projections. Explicit final-score handicaps are also projected only before kickoff. Source market IDs, selections, prices and receipts remain unchanged.
- Result plus BTTS HOME_NO/AWAY_NO can compare with the same team's win-to-nil YES. DNB is retained separately because the available provider descriptions did not establish all terms needed for a new DNB/AH0 projection. Two unrelated correct scores, two YES player offers and two positive team propositions are never treated as opposites.
- Native close, removal, empty replacement and event closure remove all derived variants. Wrong player/type/period bindings are rejected and their native evidence remains visible. A reused quote ID cannot renew a different player's receipt or stake plan.

## Remaining evidence gaps

QA5193, QA5195 and QA5202 expose `Home Or O 2.5`, `Away Or O 2.5` and `Home Or Any Clean Sheet`, without an explicit win-versus-score predicate. QA6020 exposes `Two Penalties Awarded`, without proving exactly two versus at least two. Authenticated, read-only requests to BTI's exact description API returned description-not-found for these codes. These native offers remain UNMAPPED rather than receiving guessed settlement semantics.

Some player containers retain club placeholders, slash-combined names, team-scoped no-scorer entries under a different native entity ID, or malformed outcome sentences. Valid names including Or Blorian, Cengiz Ünder/Under and Over Mandanda are retained. Unresolved entries stay in the native inventory with their exact labels and prices.

## Payload and verification limits

The page continues requesting native counts instead of raw native observations. The worker retains complete source catalogs but avoids building player comparison rows when only one provider offers that player market type, and omits unmatched player rows from repeated UI messages. A later provider update can create a valid route without resending the first provider. Default direct event detail remains complete; the worker-driven comparison table contains only matched player rows. Source market/quote counts and all admitted pairs are preserved.

The controlled replay uses the same older peer snapshots on both sides, with AP normalization held fixed. IM is unavailable in that capture and AP is STALE. New reconstructed quotes deliberately have receipt/sequence zero. Pair counts prove structural matching, not current positive profit, freshness or executable stake limits. This change does not establish six-provider uptime.

Audit artifacts are under `.run/bti-remaining-2026-09-10/`. The original BTI input SHA256 is `e155cd09e85a1b0d000d88d9f41bd015870482b80828daddbc6c73cdec99d5e6`. The replay reconstructs native detail tuples from retained source fields; original network tuples were not retained.

The final backend/contract/adapter set passed 833 tests and the web comparison/stake set passed 501 tests. The last surname correction additionally passed 127 focused player schema/decoder/comparison tests. Contracts, adapters, core, API and web builds/typechecks passed. The r2 worker audit preserved all default matcher pairs; its JSON size measurement repeats shared object references and must not be described as actual structured-clone transfer size. Final r3 changes only five player contracts/quotes and leaves all pair counts unchanged.

One coordinated deployment completed at 03:44:35 local, instance `04747496-3e44-480a-a578-33b979a8aec3`, API build `sha256:f0b5d8d4d9afee6c941b7e39f7707909e85212a88e837c0a9e178f490c8455d4`. Local and public web both return `index-C4wz23d4.js`; worker asset is `comparison.worker-9lUTM009.js`. The deployment lease was released without a provider reload. At 03:45:40, BTI returned HTTP 200/FRESH, 1,537 events, 136,221 canonical markets, 281,501 quotes and 260 unmapped native observations. This changing runtime snapshot is not the fixed audit input.

A bounded headless Chrome check at 03:47 loaded 232,147 BTI canonical markets and 430 unmapped observations with no page error or crash; main-page JS heap was about 390 MiB. It displayed 176 SABA/CMD pairs while BTI's displayed age reached 31 seconds and IM/AP/SBO were unavailable or recovering. This is evidence that the new page loads, not proof of healthy six-provider live matching. The in-app browser tool failed during setup; headless Chrome provided the UI check.

That check prompted a further worker correction: unresolved player identity or a contradictory quote binding must not create a modified display catalog, trigger a second full comparison, or revive old player offers. Such current source entries are retained and remain unpairable under the existing matcher checks. Valid same-player display fallback is unchanged. The targeted worker/client/receipt/player suites passed 79 tests and web typecheck passed. Updated web assets were published at 03:53:21 under a deployment lease with no API restart; local/public HTTP 200 both serve `index-CmMLGhBF.js`. The main normalization change is commit `3305379`.
