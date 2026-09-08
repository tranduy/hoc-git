# Complete binary prematch market coverage — verification report

Date: 2026-09-07 (Asia/Bangkok)

Branch: `feat/realtime-hardening`

## Result

The implementation and repository verification gates pass. Five live sources satisfy the lossless accounting invariant. IM does not currently satisfy the live acceptance gate because its existing tab has no current authenticated HTTP authority and recovery reports `IM_MANUAL_TOKEN_REQUIRED`. Therefore this report does **not** claim six-provider live completion.

No odds selection was clicked and no wager or write action was sent to a provider.

## Deployment and capture evidence

- Chrome extension manifest: `0.2.27`.
- Extension artifact: `sha256:088b284ac8fd508779a11125079a6329f23b08b26d3627496fbe6dbeffd9001a`.
- Running combined artifact: `sha256:207890db2e4d3c18f4b104694413a8c2ba52eaf166403ea904bcf1d381ce5ef7`.
- API health and stack state reported the same combined identity after exact-v2 handoff.
- Extension deployment convergence uses the bridge `RELOAD_EXTENSION` message. It restarts the service worker only; provider tabs are not navigated, reloaded, or closed.
- The final rotating capture set contained 551 redacted envelopes in five JSONL files, 56,234,849 bytes, and zero parse errors: BTI 456, APSPORT/TSPORT 58, CMD 14, SBOBET/KSPORT 11, SABA 8, IM 4.
- The real-capture replay harness passed all six production adapters, 6/6.

## Live catalog snapshot

Snapshot taken from the running build above. Counts are volatile provider data, not fixtures.

| Provider | Session/catalog | Events | Markets | Quotes | Periods | Families | Native accounting |
|---|---:|---:|---:|---:|---|---|---|
| CMD | ACTIVE / FRESH | 97 | 575 | 1,150 | FH 215; FT 360 | handicap 198; total 295; corner 57; card 25 | 860 = 585 normalized + 275 excluded + 0 unmapped |
| SABA | ACTIVE / FRESH | 87 | 572 | 1,144 | FH 228; FT 344 | handicap 212; total 275; odd/even 85 | 865 = 572 normalized + 214 excluded + 79 unmapped |
| SBOBET | ACTIVE / FRESH | 80 | 648 | 1,296 | FH 312; FT 336 | handicap 272; total 329; corner 47 | 1,721 = 877 normalized + 286 excluded + 558 unmapped |
| APSPORT | ACTIVE / FRESH | 443 | 7,211 | 14,422 | FH 1,614; FT 5,147; SH 450 | total 2,611; odd/even 1,189; win props 1,103; handicap 800; BTTS 481; other 463; clean sheet 461; corner 103 | 29,379 = 7,867 normalized + 21,512 excluded + 0 unmapped |
| BTI | ACTIVE / FRESH | 185 | 3,460 | 6,920 | FH 1,003; FT 2,233; SH 224 | total 1,954; odd/even 465; handicap 448; BTTS 254; corner 229; card 48; clean sheet 42; win props 20 | 8,911 = 3,592 normalized + 1,943 excluded + 3,376 unmapped |
| IM | ACTION_REQUIRED / STALE | 351 | 2,548 | 5,096 | FH 698; FT 1,162; SH 688 | handicap 1,257; total 1,291 | unavailable on current authority; last catalog is preserved |

BTI completed the bounded detail sweep before its final measurement: 175 detail events cached, 0 pending, approximately 18.5 MB, feed `LIVE`, and all eight diagnostic hops green.

IM's last retained catalog is from `observedAtMs=1788720455739`. The current tab is only a candidate and has produced TAB_STATE but no HTTP response. Automatic recovery recorded `IM_MANUAL_TOKEN_REQUIRED`; it correctly retained the last complete partition rather than publishing an authoritative empty catalog.

## Stable unmapped signature classes

Format is `nativeType/outcome-count=occurrences`. Every row below has reason `NATIVE_TYPE_UNMAPPED`. Event IDs and market IDs are intentionally omitted because they are volatile instances, not stable signature classes.

- SABA: `15/3=79`.
- SBOBET: `14/1=294`, `15/1=264`.
- CMD and APSPORT: none in this snapshot.
- IM: cannot be audited until current authority is restored.
- BTI: 3,376 occurrences in 202 stable classes:

```text
OU22/14=5, OU52/2=45, OU121/2=5, OU257/16=100, OU1967/10=9, OU1967/14=4, OU1968/10=9, OU1968/14=4, OU1969/2=5, OU1970/2=5, OU1971/2=5, OU1972/2=5, OU1973/2=5, OU1974/2=5, OU2078/2=5, OU2079/2=5, OU2083/2=5, OU2086/2=5, OU4330/2=5, OU4620/2=39, OU4997/2=5, OU5083/16=10, OU5107/16=10, OU5115/2=1, OU5116/2=2, OU5119/2=1, OU5120/2=2, OU5518/10=1, OU5519/2=1, OU5520/2=1, OU5539/16=8, OU6031/2=5, OU6032/2=5, OU6033/2=5, OU6034/2=5, OU6305/2=5, OU6306/2=5, OU6311/2=5, OU6312/2=5,
QA60/32=172, QA61/3=173, QA62/9=77, QA65/9=17, QA89/3=49, QA93/10=49, QA119/7=147, QA120/4=146, QA144/32=76, QA145/3=146, QA154/10=49, QA155/10=49, QA276/2=10, QA277/2=98, QA278/2=10, QA291/8=77, QA696/2=147, QA697/2=37, QA698/2=5, QA701/2=31, QA1334/1=59, QA1334/2=18, QA1337/32=25, QA1447/6=5, QA1473/3=17, QA1474/3=17, QA1475/3=17, QA1476/3=17, QA1572/32=10, QA1610/32=10, QA2144/32=4,
QA3580/22=3, QA3580/23=7, QA3580/24=24, QA3580/25=4, QA3580/26=7, QA3580/27=4, QA3580/28=9, QA3580/29=10, QA3580/30=4, QA3580/31=2, QA3580/32=3, QA3583/6=49, QA4030/32=43, QA4031/32=17, QA4200/2=13, QA4261/3=77, QA4273/2=40, QA4274/2=40, QA4280/6=1, QA4300/5=29, QA4302/4=17, QA4303/10=48, QA4405/2=5, QA4448/3=17, QA4450/3=34, QA4451/3=34, QA4452/3=147, QA4460/3=31, QA4461/3=31, QA4462/2=5, QA4462/3=26, QA4463/2=16, QA4463/3=1, QA4464/2=17, QA4879/32=25, QA4880/32=25, QA4977/2=5,
QA5017/23=1, QA5017/32=4, QA5018/32=5, QA5019/32=14, QA5081/2=5, QA5088/7=5, QA5089/2=4, QA5089/3=1, QA5090/3=5, QA5091/3=5, QA5100/6=5, QA5103/4=5, QA5104/2=5, QA5105/2=5, QA5108/2=5, QA5150/29=1, QA5150/30=1, QA5150/31=2, QA5150/32=1, QA5151/2=4, QA5152/1=5, QA5165/9=19, QA5170/32=5, QA5172/22=1, QA5172/24=1, QA5172/26=1, QA5172/30=1, QA5172/32=1, QA5173/22=1, QA5173/24=1, QA5173/30=1, QA5173/32=2, QA5193/2=5, QA5194/2=5, QA5195/2=5, QA5197/2=5, QA5200/2=5, QA5202/2=5, QA5212/27=1, QA5212/32=4, QA5213/32=5, QA5373/2=5, QA5374/2=5,
QA5401/32=5, QA5402/32=4, QA5403/32=4, QA5404/32=5, QA5405/32=5, QA5406/32=5, QA5407/10=4, QA5407/11=2, QA5407/12=1, QA5407/15=1, QA5407/20=1, QA5407/21=1, QA5505/2=5, QA5508/32=5, QA5509/32=5, QA5510/32=5, QA5516/2=4, QA5517/7=5, QA5521/2=5, QA5522/2=5, QA5528/9=5, QA5534/24=1, QA5534/26=1, QA5534/27=1, QA5534/28=1, QA5534/32=1, QA5536/2=2, QA5537/2=5, QA5540/2=5, QA5614/16=5, QA5617/16=5, QA6012/2=5, QA6015/2=5, QA6016/2=5, QA6017/9=5, QA6018/9=5, QA6020/1=5, QA6024/2=5, QA6029/2=5, QA6030/2=5, QA6035/7=5, QA6036/16=5, QA6037/6=5, QA6038/2=4, QA6053/9=5, QA6096/6=5, QA6097/6=5, QA6098/6=5, QA6099/6=5, QA6113/19=5, QA6136/19=5, QA6137/19=5
```

## Per-provider verification

- APSPORT: extension refresh/observer 324/324; API adapter/browser/observed catalog 71/71. Covers all prematch detail modes, bounded single-flight/retry/cancel behavior, unknown-group retention, and authoritative per-event removal.
- SABA: adapter 19/19; API 60/60; extension SABA subset 60/60. Covers base/corner/card pseudo-event linkage, native retention, stream replacement, and authoritative deletion.
- BTI: API 30/30; extension BTI subset 30/30. Covers uncapped league/event traversal, maximum three concurrent detail requests, prematch-only collection, unknown inventory, and empty detail/list deletion.
- SBOBET: adapter 10/10; relevant API 21/21; extension subset 4/4. A new regression proves event deletion cascades to every child native market and still publishes an authoritative empty baseline.
- CMD: adapter 20/20; relevant API 44/44 before the final HTTP-accounting regression; final HTTP adapter file 26/26. Extension CMD subset 33/33. Covers fixed-point hidden-control traversal, multi-chunk 783-record assembly, pseudo corner/card linkage, complete-sweep tombstones, and HTTP native accounting.
- IM: API 85/85; extension subset 24/24. Covers all observed `bti/gp/si` combinations, hidden batches, token recovery, unmapped retention, and replay of the last complete partition. Current live authentication remains unavailable.

## Full verification

Final `npm.cmd run verify`: **3,139 passed, 4 skipped, 0 failed**.

- Typecheck: API, extension, web, adapters, contracts, core — all passed.
- Unit: API 1,448; extension 784; web 450 (+4 skipped); adapters 95; contracts 130; core 224.
- Integration: 2/2.
- Fixture-stack readiness: 4/4.
- Watch smoke: 2/2.
- Full workspace build: passed.
- Lint: the repository does not define a `lint` script; no separate lint command was available.

The integration command now uses `vitest run --dir tests/integration`, preventing operational backups under `.run/worktree-backups` from being collected as source tests. Those backups were not deleted or modified.

Exact matching and current-price safety are covered by tests that reject cross-statistic, cross-period, cross-line, reversed orientation, cross-settlement, stale generation, integer-line, quarter-line, duplicate, hidden, and obsolete-selection evidence. Authoritative deletion tests cover all six adapters. A fresh six-provider live exact-pair sample is still withheld because IM has no current authority; claiming it from the stale IM partition would violate the plan's acceptance rule.

## Rollout file and drive C

The old rollout file was not read. The requested file still exists at 847,934,310 bytes and remains exclusively locked, so it was not deleted.

- Before deletion attempt: C used 297,715,683,328; free 3,998,990,336 bytes.
- Immediately after the lock-safe attempt: C used 297,721,991,168; free 3,992,682,496 bytes.
- Reclaimed: 0 bytes. The free-space delta was -6,307,840 bytes from unrelated system activity.
- Final recheck: the same file was still locked and unchanged.

## Remaining acceptance blocker

Restore a fresh authenticated IM launch/token in the existing provider session. The automatic source recovery can then produce a current IM HTTP baseline; rerun the live snapshot and exact-pair sample. Only after IM reports ACTIVE/FRESH with non-empty native accounting can the plan's six-source completion box be checked.
