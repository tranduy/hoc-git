# Result complements and six-provider normalization

**Goal:** Normalize proven native result selections for all three football periods and pair each single result with its exhaustive double-chance complement across providers without dropping existing Asian pairs.

**Architecture:** Shared result registry defines exact periods, native canonical selection names and compatible settlement profiles. Provider parsers retain native market/selection IDs and only map selections justified by source enums or labels. Comparison creates observational result-partition rows containing actual source cells; stake math evaluates complementary selections without inventing a complete binary source market. Count distinct native market pairs separately from selection routes.

**Tech stack:** TypeScript contracts/adapters/API, Vite/React comparison worker, Vitest, frozen durable catalog replay.

**Scope and constraints:** User explicitly authorized continuation. Preserve existing dirty workspace, source inventory, freshness and matching guards, bounded feed memory and compiled preview deployment. No provider bets or account mutations. Old IM data can be audited structurally but stale prices are not live profits. Few positive plans do not by themselves establish a normalization bug.

1. Freeze all six durable catalogs and before engine with hashes; preserve baseline parsers.
2. Add failing contract tests for FT/FH/SH result/DC scopes and exhaustive complementary partitions; implement shared registry and proven both-teams-score-both-halves predicate.
3. In parallel, implement proven BTI/CMD and IM/AP/SBO/SABA mappings with negative native-ID/period tests; keep every raw disposition visible.
4. Implement web result complement rows, exact source routing/counting and settlement tests; preserve Asian regression suite and observational preflight boundaries.
5. Replay identical frozen native data before/after. Report native observations, canonical markets, unmatched reasons, source-market pairs, selection routes, removed pairs and worst-case profit calculations separately.
6. Review changes, typecheck/build affected workspaces, deploy managed compiled preview and verify public dashboard/runtime plus bounded memory. Record limitations and evidence in a report.
