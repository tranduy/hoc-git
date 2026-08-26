# APSPORT realtime report

Trạng thái hiện tại: `DEPLOYMENT_WAIT_EXHAUSTED APSPORT`.

Không ghi `PROVISIONAL_ACCEPTANCE`, `READY_FOR_24H_SOAK` hoặc `DONE` vì nghiệm thu 600 giây chưa đạt và bản refresh baseline mới nhất chưa lấy được deployment lease.

`USER_CHECK_PENDING`

## INVESTIGATED

- Evidence nền: TSPORT có 6 socket; bóng đá phát trên `s/1`, giải ảo riêng trên `s/97`.
- Không chạy recon, không spawn Chrome, không reload/navigate/đóng tab.
- Capture dùng: `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures\capture-1787551154126.jsonl`.
- CDP `127.0.0.1:9333` không sẵn; không tạo capture mới.

## Diag ban đầu — 120 giây

Full output: `.run/realtime/apsport/diag-pre-h1-120.txt` — 24 mẫu.

### Mẫu đầu

```json
{
  "HOP2_ATTACH": {
    "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:0",
    "attachedForMs": 3431812
  },
  "HOP3_ENVELOPE": {
    "lastEnvelopeAgeMs": 1786,
    "lastSequence": 994,
    "byTransport": { "HTTP_RESPONSE": 0, "WS_FRAME": 0, "DOM_SNAPSHOT": 26, "TAB_STATE": 61 },
    "rejected": { "SEQUENCE_GAP": 0, "RETIRED_EPOCH": 0, "TOO_OLD": 0 }
  },
  "HOP5_AUTHORITY": { "authorityDisposition": "ACTIVE" },
  "HOP6_FEED": {
    "state": "HARD_RECOVERY",
    "reason": "RECOVERY_HARD",
    "baselineAgeMs": 4891652,
    "maxBaselineAgeMs": 30000,
    "evidenceAgeMs": 4862440,
    "expectedEvidenceCadenceMs": 5000,
    "observedEvidenceCadenceMs": { "p50": null, "p95": null, "samples": 0 },
    "recoveryStage": "HARD",
    "recoveryAttempt": 2,
    "consecutiveFailures": 7,
    "nextAttemptInMs": 0,
    "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
  }
}
```

### Mẫu cuối

```json
{
  "HOP2_ATTACH": {
    "sourceEpoch": "77f00c4a-a65b-4108-927c-a86bf9a8dacd:0",
    "attachedForMs": 3547037
  },
  "HOP3_ENVELOPE": {
    "lastEnvelopeAgeMs": 985,
    "lastSequence": 1029,
    "byTransport": { "HTTP_RESPONSE": 0, "WS_FRAME": 0, "DOM_SNAPSHOT": 26, "TAB_STATE": 63 },
    "rejected": { "SEQUENCE_GAP": 0, "RETIRED_EPOCH": 0, "TOO_OLD": 0 }
  },
  "HOP5_AUTHORITY": { "authorityDisposition": "ACTIVE" },
  "HOP6_FEED": {
    "state": "HARD_RECOVERY",
    "reason": "RECOVERY_HARD",
    "baselineAgeMs": 5006877,
    "maxBaselineAgeMs": 30000,
    "evidenceAgeMs": 4977665,
    "expectedEvidenceCadenceMs": 5000,
    "observedEvidenceCadenceMs": { "p50": null, "p95": null, "samples": 0 },
    "recoveryStage": "HARD",
    "recoveryAttempt": 2,
    "consecutiveFailures": 7,
    "nextAttemptInMs": 0,
    "lastFailureCode": "AUTH_EGRESS_UNAVAILABLE"
  }
}
```

HOP8 đầu/cuối: `quoteChanges60s=0`, `quoteChanges300s=0`, `sampleChange=null`.

## So tập DOM và socket từ capture

| Tập | Số eventId |
|---|---:|
| DOM trước lọc | 15 |
| DOM giải ảo | 9 |
| DOM sau lọc giải ảo | 6 |
| WS `s/1` | 6 |
| WS `s/97` | 4 |
| Giao DOM-sau-lọc ∩ WS-`s/1` | 0 |
| Chỉ DOM-sau-lọc | 6 |
| Chỉ WS-`s/1` | 6 |

Đối chiếu eventId trực tiếp cho 13 event khớp DOM/WS:

| Socket | Số khớp | Phân loại |
|---|---:|---|
| `s/1` | 4 | đều e-soccer, bị lọc giải ảo |
| `s/4` | 2 | UTR tennis |
| `s/5` | 1 | UPVL |
| `s/6` | 2 | TT Elite |
| `s/97` | 4 | giải ảo hậu tố `(V)`/`(S)` |

Record DOM capture không có `sportId`. Sáu ID còn lại sau lọc giải ảo là tennis/UPVL/table tennis/basketball, không thuộc socket bóng đá `s/1`.

Capture có `WS_FRAME=30`, `DOM_SNAPSHOT=2`, `WS_STATE=0`.

## RED và fix trong whitelist

### H1 — expected-set sai phạm vi

RED chính: expected-set có football thật, `sportId=97`, hậu tố `(V)`, UTR và UPVL legacy thiếu sportId; socket `s/1` chỉ phát event thật. Trước fix mong một baseline nhưng nhận `[]`.

Fix tại `apps/api/src/chrome-bridge/tsport-ws-adapter.ts`:

- Lọc `sportId != 1` khi trường này có mặt.
- Với snapshot legacy thiếu sportId, lọc các identity đã được capture map sang `s/4`, `s/5`, `s/6`: UTR/tennis, UPVL/đội `Pro W`, TT Elite/table tennis, basketball/CDBL.
- Lọc e-soccer/virtual/simulated/PES và hậu tố `(V)`.
- Chỉ event trong phạm vi football thật mới tham gia expected-set; không đổi điều kiện phủ.
- Frame virtual chỉ chứng minh socket còn sống, không được giữ trong catalog và không chặn explicit-empty baseline football thật.

Vị trí: classifier dòng 72, dựng expected-set dòng 403, lọc frame virtual dòng 540.

### H2 — capture thật không có WS_STATE OPEN

RED: complete DOM proof + frame `s/1` đầu tiên nhưng không có OPEN phải dựng generation và phát baseline. Trước fix nhận `[]`.

Fix: frame `s/1` hợp lệ đầu tiên được phép dựng current generation khi chưa có state, nhưng vẫn phải qua sourceEpoch fence, streamId fence và DOM proof. Không chấp nhận replay/stale/retired stream.

RED bắt đầu ở `tsport-ws-adapter.test.ts` dòng 162.

### HOP6 — baseline vượt SLA 30 giây

Hai acceptance live cho thấy authority ACTIVE liên tục và evidence p95 khoảng 0.55–1.01 giây, nhưng HOP6 fail khi authoritative baseline già hơn 30 giây.

RED: catalog đầy đủ cùng generation sau 20 giây phải refresh `BASELINE`; trước fix vẫn là `DELTA`.

Fix local mới nhất: catalog chỉ re-baseline ở 20 giây sau khi expected-set đã phủ đủ; generation không đổi và coverage không nới. Constant ở dòng 13, logic refresh ở dòng 544 và 570. RED ở test dòng 320.

## Xác minh local mới nhất

- API focused: `46/46` pass.
- Extension focused/runtime: `20/20` pass.
- Typecheck API: pass.
- Typecheck extension: pass ở vòng extension bị ảnh hưởng.
- `npm.cmd run build`: pass toàn workspace.

## Deploy và live proof

Các lần deploy đều theo deployment lease; khi wrapper trả `STACK_INSTANCE_DISCOVERY_UNAVAILABLE` đã chạy exact handoff rồi retry. Sau mỗi deploy được tính, sources đủ 6 lobby.

Build live đã chứng minh HOP8: `sha256:cc3281b4b2b94d64c6addc96afc3a7bc9753d2df3a584fafc863879ab1943b0a`.

Full output: `.run/realtime/apsport/diag-active-final-120.txt` — 24 mẫu.

- `firstFailingHop=null` ở mẫu live đạt.
- HOP4 đầu/cuối: `decoded=58` → `decoded=148`.
- HOP5: `ACTIVE`.
- HOP8 cuối: `quoteChanges60s=177`, `quoteChanges300s=341`.
- Selection thật: `APSPORT:5524492:730195128181025:55244920030002005h`, giá `0.93` → `0.94`.

## Nghiệm thu 600 giây

### Lần 1

Full output: `.run/realtime/apsport/acceptance-600.txt` — 120 mẫu. Build trước/sau cùng identity.

- HOP5 ACTIVE: `120/120`.
- firstFailingHop null: `24/120`.
- Mẫu có `quoteChanges60s>0`: `63/120`.
- Cửa sổ phút có `quoteChanges60s>0`: `5/10`.
- `quoteChanges60s` max: `261`; `quoteChanges300s` max: `898`.
- Cadence p95 ở các cửa sổ có evidence: khoảng `0.75–0.86s`.
- Không đạt.

### Lần 2

Full output: `.run/realtime/apsport/acceptance2-600.txt` — 120 mẫu. Build trước/sau: `sha256:c8a326ecac113e8079c5b20c830a7390b9150de7d0f8b97d54d471b5e58cf0cf`.

- HOP5 ACTIVE: `120/120`.
- firstFailingHop null: `32/120`.
- Mẫu có `quoteChanges60s>0`: `73/120`.
- Cửa sổ phút có `quoteChanges60s>0`: `6/10`.
- `quoteChanges60s` max: `336`; `quoteChanges300s` max: `1129`.
- Cadence p95: khoảng `0.55–1.01s`.
- Selection thật: `APSPORT:5672196:1989629848361015:56721960040001005h`, giá `-0.77` → `-0.75`.
- Không đạt yêu cầu null suốt 10 phút và `>=8/10` cửa sổ.

## Catalog không có giải ảo

Snapshot catalog kiểm tra sau acceptance: `36` event, `0` event có `isVirtual=true`, `sportVariant!=FOOTBALL` hoặc đội hậu tố `(V)`.

- Varnsdorf — Usti Nad Labem
- Zakho — Diyala
- Vukovar 91 — Radnicki Dalj
- Kustosija — HNK Zadar
- Visnove — MSK Namestovo
- Unicov — Fastav Zlin
- Namungo — Singida Fountain Gate
- Vaxjo Norra — Solvesborgs GoIF
- Abha — Al Khaleej
- Horni Redice — Dukla Prague
- Al Taawoun Buraidah — Al Fayha
- Al Kuwait — Al Arabi Kuwait
- Ilirija Ljubljana — Dren Vrhnika
- Academico Viseu U23 — Vizela U23
- Sokol Zapy — Bohemians 1905
- Unirea Slobozia — Metaloglobus
- Dinamo Samarqand — Pakhtakor Tashkent
- Hapoel Ironi Ramat Hasharon U19 — Maccabi Haifa U19
- Leixoes U23 — Uniao Leiria U23
- Petah Tikva U19 — Hapoel Tel Aviv U19
- Tartu Kalev — Tallinna Kalev II
- Beitar Jerusalem U19 — Hapoel Haifa U19
- Brann W — Austria Wien W
- Al Karkh — Erbil
- OKS — Middelfart
- Al Julan — Al Shorta
- Hapoel Raanana U19 — Hapoel Hadera U19
- Motorlet Praha — Vysocina Jihlava
- CSKA Sofia II — Ludogorets II
- Beroe — Spartak Pleven
- AS Nordia Jerusalem — Hapoel Hadera
- Maccabi Netanya U19 — Bnei Yehuda Tel Aviv U19
- Allerod — Vanlose
- FK Auda — Liepaja
- Maccabi Tel Aviv U19 — Hapoel Kiryat Shmona U19
- BEA Mountain — LISCR

## Bảng 6 sàn tại lần đọc cuối

| Sàn | firstFailingHop | Authority | quoteChanges60s |
|---|---|---|---:|
| CMD | null | ACTIVE | 317 |
| IM | null | ACTIVE | 178 |
| SABA | null | ACTIVE | 436 |
| SBOBET | HOP4_ADAPTER | NONE | 0 |
| APSPORT | HOP4_ADAPTER | ACTIVE | 0 |
| BTI | null | ACTIVE | 432 |

## Deployment wait đã hết giới hạn

Bản local có refresh baseline 20 giây đã build/test/typecheck pass nhưng chưa deploy được:

- Thử claim deployment lease `10/10` lần.
- Mỗi lần cách `60` giây.
- Coordinator sau lần 10: deployment free, một acceptance lease của SABA còn active.
- Không vượt giới hạn, không cướp/release lease của provider khác.

Vì bản fix HOP6 chưa live, chưa được chạy acceptance lần 3. Không đủ điều kiện ghi `PROVISIONAL_ACCEPTANCE APSPORT`; do đó cũng chưa bắt đầu mốc 30 phút và không ghi `READY_FOR_24H_SOAK APSPORT`.
