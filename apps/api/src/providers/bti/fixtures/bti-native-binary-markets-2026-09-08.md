# BTI captured market evidence

The adjacent JSON is a sanitized positional extract from the saved BTI detail
response for event `881536429434703872` (Como / RB Leipzig). It is historical
provider data, not a synthetic price fixture or evidence of current availability.

Source: `.run/parallel-hidden-markets-2026-09-08/bti/native-cache-1788860177471.json`.
The archive contains 3 roster responses and 1,466 detail responses; its SHA-256 is
`5bbe7e56b2a17a3044ce4dc9b813d7cdaa1676b2704fda6ab71485d01a46b88f`.
Archive capture time: `1788860177471` milliseconds since the Unix epoch.

Only event identity, participants, league, start time, live/closed flags and the
selected market rows were retained. Within these market rows, the native market
ID, label, type metadata, selections and closed flags retain their original array
positions. Selection IDs, names, lock/deletion flags, price-format arrays, side
codes and numeric lines also retain their original positions and values.
Unused metadata positions are `null`; no IDs or prices were invented.

| Native code | Captured meaning | Canonical meaning |
|---|---|---|
| `QA5373` | Cả hai hiệp đều Tài 0.5; Có / Không | Both halves over 0.5, YES / NO |
| `QA5374` | Cả hai hiệp đều Tài 1.5; Có / Không | Both halves over 1.5, YES / NO |
| `QA6024` | Cả hai hiệp đều dưới 1.5 bàn; Có / Không | Both halves under 1.5, YES / NO |
| `OU6305`, `OU6306` | Named participant's Asian team total goals | HOME / AWAY full-time team total, preserving numeric line |
| `OU257` | Named participant's first-half team total goals | HOME / AWAY first-half team total, preserving numeric line |
| `ML0` | Toàn trận 1X2 | Full-time HOME / DRAW / AWAY |
| `ML1` | Cược 1X2 Hiệp 1 | First-half HOME / DRAW / AWAY |

The three QA codes have `null` native numeric lines; the code and native market
label carry their fixed threshold. The native prices come from the Malay slot
at selection `[8][5]`; side codes are selection `[9]`, IDs `[0]`, names `[2]`,
numeric lines `[16]`, lock flags `[5]` and deletion flags `[13]`.

`OU0` is an existing mapped control. `QA60` is an unmapped correct-score control
with all 121 selections, including original zero prices and closed selections.
Its full native evidence is retained without inventing two-way quotes.

Mutations used in the adjacent test file (missing draw, third binary outcome,
wrong participant, conflicting line, missing ID and zero price) are explicitly
synthetic rejection cases derived from this captured fixture.
