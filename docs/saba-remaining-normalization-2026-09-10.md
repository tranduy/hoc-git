# SABA remaining normalization — 2026-09-10

The frozen SABA catalog gains **79 canonical markets and 231 quotes**: 40 full-time 1X2, 33 first-half 1X2, three home-team totals and three away-team totals. The implementation uses the existing DOM collector path and adds no fabricated prices or observation clocks.

| Frozen catalog | Before | After |
| --- | ---: | ---: |
| Events | 45 | 45 |
| Canonical markets | 280 | 359 |
| Quotes | 560 | 791 |
| Native observations | 477 | 477 |
| NORMALIZED | 280 | 359 |
| EXCLUDED | 188 | 115 |
| UNMAPPED | 9 | 3 |

## Provider evidence

The public SABA entry `/EntryIndex/OpenSports?webskintype=3&act=sports` identifies these assets, retrieved by read-only HTTP GET:

- [Desktop renderer](https://i.laner220.com/MS2L/Js/dt/main.js?v202609091166291), SHA-256 `85cfee418f3b63665791f7d2bb6eefa58d531b7864fd1bd1e749f83ec1d70d02`. Its main `data-bt=5` and `data-bt=15` columns render selection keys **1, 2, x**, proving the unlabeled DOM order HOME, AWAY, DRAW. Types 461/462 render **o, u**, with the total line followed by the Under label.
- [Provider foundation](https://i.laner220.com/MS2L/Js/foundation.js?v202609091166291), SHA-256 `ee393dc6d3b8c537ce5792db9fec284fac90745302c19f51b5cbd789567921bd`. These four types are absent from `pairOdds`; the provider fixes their format to `1`, explicitly named `Decimal_Odds`. The 1X2 selection decoder binds `1` to `com1`, `2` to `com2`, and `x` to `comx`.
- [SABA selection taxonomy](https://github.com/Saba-sports/OddsDirectAPI/wiki/BetType-Selection-Information) independently names 5/15 as FT/FH 1X2, 461/462 as home/away team totals, and 22 as Next Goal.

The helper only admits the exact evidenced group shapes. It rejects ambiguous labels, mixed native types, conflicting formats, unsupported lines and lost selection slots. It leaves the original native label and raw selection values intact. When one retained slot has an unavailable price, only the valid quote is emitted, with its original outcome index. CLOSED/SUSPENDED selections retain their state.

## Reproduction and limits

Run `node .run/three-remaining-2026-09-10/SABA-replay.mjs`. The script freezes the old normalizer through `SABA-shared-normalizer.before.ts`, bundles both versions offline and reconstructs only the candidate groups from `SABA-baseline.json` (SHA-256 `c8a49db16e2bf63adcf97f17e767c34a63f654d8d3a4d1c2a4e4426ad430d351`).

Outputs: `SABA-after.json`, `SABA-replay-metadata.json`, `SABA-added-evidence.json`, and `SABA-provider-evidence.json` in that directory. Original events, canonical markets and quotes are retained exactly. Every native row, price, status and original observation receipt is accounted for. Added quotes use receipt **0**, sequence **0** and null source timestamp. This replay measures structural coverage; it does not establish fresh executable prices or profit.

Remaining: **115 EVENT_NOT_COMPARABLE** observations and **three type-22 Next Goal** observations. Next Goal needs an exact goal-state or ordinal settlement identity and cannot be substituted with First Goal, Last Goal or a binary complement. No runtime restart, deployment, browser reload or commit was performed for this SABA change.

## Validation

The initial regression run failed on all five new positive behavior checks before implementation. Final focused verification passed **56 adapter tests** and **115 SABA API tests**, including a collector regression that withdraws an unavailable Over quote on the next accepted roster while retaining the correctly indexed Under quote. Existing clock, socket, collector and realtime regressions passed.
