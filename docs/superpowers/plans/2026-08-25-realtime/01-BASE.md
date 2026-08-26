# BASE — hạ tầng bắt buộc trước khi mở worker song song

> **Một phiên Codex duy nhất làm file này. Không mở worker provider nào cho tới
> khi Opus review và ghi `BASE_APPROVED`.**
>
> Đọc trước: `docs/superpowers/plans/2026-08-25-realtime/00-EVIDENCE.md`.

Repo root bắt buộc: `F:\0. PROJECT\tool-chenh`. Không dùng worktree.
API `127.0.0.1:4310`, Web `127.0.0.1:4311`.

## Vì sao cần BASE

Tuần vừa rồi năm worker viết ra hàng nghìn dòng state machine và 2555 test xanh,
trong khi sản phẩm chạy 0/6. Nguyên nhân không phải năng lực mà là **không có
thước đo**: pipeline có 8 chặng, mỗi chặng nhiều nhánh fail-closed, và khi nó
chết thì không ai biết chết ở chặng nào. Mọi người đoán, sửa chặng 6, rồi lặp lại.

BASE tồn tại để chấm dứt việc đoán. Sau BASE, mỗi worker phải trả lời được câu
"provider của tôi chết ở chặng nào, vì lý do gì" trong dưới 10 giây, bằng một
lệnh, không cần đọc code.

## Nguyên tắc bất di bất dịch cho phiên BASE

- Không sửa bất kỳ file adapter provider nào (`*-ws-adapter.ts`,
  `*-http-adapter.ts`). BASE chỉ làm hạ tầng đo và khung thử.
- Không đổi logic quyết định của `ProviderFeedController` ngoài phần cấu hình
  cadence ở Task B4.
- Mọi thứ thêm vào phải **không đổi hành vi runtime khi tắt**. Telemetry là
  quan sát, không phải điều khiển.
- Không log token, cookie, launch URL, header auth, hay raw body provider.
  Chỉ log host, path, độ dài, digest, phân loại.
- Không chạy Git mutation. Không commit.

---

## Task B1 — Endpoint chẩn đoán 8 chặng

**Đây là hạng mục quan trọng nhất của toàn bộ dự án. Làm đúng cái này thì mọi
thứ còn lại trở nên dễ.**

**Tạo:**
- `apps/api/src/diagnostics/pipeline-telemetry.ts` + test
- `apps/api/src/routes/diagnostics.ts` + test
- Đăng ký route trong `apps/api/src/app.ts`

**Hợp đồng:**

```
GET /api/diag/pipeline            → tất cả 6 account
GET /api/diag/pipeline/:accountId → một account
```

Trả về cho mỗi account đúng 8 chặng, mỗi chặng có `ok: boolean` và `detail`:

```jsonc
{
  "accountId": "catalog-source:CMD:FOOTBALL",
  "lobby": "CMD",
  "nowMs": 0,
  "firstFailingHop": "HOP4_ADAPTER_DECODE",   // null nếu tất cả xanh
  "hops": [
    { "hop": "HOP1_TAB",       "ok": true,  "detail": { "sourceId": "chrome:CMD:123", "tabId": 123 } },
    { "hop": "HOP2_ATTACH",    "ok": true,  "detail": { "sourceEpoch": "...", "attachedForMs": 0 } },
    { "hop": "HOP3_ENVELOPE",  "ok": true,  "detail": {
        "lastEnvelopeAgeMs": 0, "lastSequence": 0,
        "byTransport": { "HTTP_RESPONSE": 0, "WS_FRAME": 0, "DOM_SNAPSHOT": 0, "TAB_STATE": 0 },
        "rejected": { "SEQUENCE_GAP": 0, "RETIRED_EPOCH": 0, "TOO_OLD": 0 } } },
    { "hop": "HOP4_ADAPTER",   "ok": false, "detail": {
        "decoded": 0, "ignored": 0,
        "rejectReasons": { "PROVIDER_STREAM_GAP": 0, "SCHEMA_CHANGED": 0, "PRE_BASELINE": 0 },
        "lastDecodedAgeMs": 0 } },
    { "hop": "HOP5_AUTHORITY", "ok": true,  "detail": { "authorityDisposition": "ACTIVE" } },
    { "hop": "HOP6_FEED",      "ok": false, "detail": {
        "state": "STALLED", "reason": "BASELINE_EXPIRED",
        "activeGeneration": null,
        "baselineAgeMs": 41200, "maxBaselineAgeMs": 20000,
        "evidenceAgeMs": 33100, "expectedEvidenceCadenceMs": 20000,
        "observedEvidenceCadenceMs": { "p50": 30100, "p95": 61000, "samples": 12 },
        "recoveryStage": "SOFT", "recoveryAttempt": 7 } },
    { "hop": "HOP7_CATALOG",   "ok": false, "detail": {
        "sessionState": "ACTION_REQUIRED", "reason": "PROVIDER_VALIDATION_FAILED",
        "snapshotState": "STALE", "revision": "...", "catalogAgeMs": 0,
        "events": 0, "markets": 0, "quotes": 0 } },
    { "hop": "HOP8_SEMANTIC",  "ok": false, "detail": {
        "quoteChanges60s": 0, "quoteChanges300s": 0,
        "lastSemanticChangeAgeMs": null,
        "sampleChange": { "selectionKey": "...", "before": "0.83", "after": "0.75", "atMs": 0 } } }
  ]
}
```

**Yêu cầu bắt buộc:**

- `firstFailingHop` là chặng đầu tiên có `ok:false`. Đây là trường mà mọi worker
  sẽ đọc đầu tiên; nó phải luôn chính xác.
- Chặng 8 (`HOP8_SEMANTIC`) phải đếm số lần **`rawOdds` hoặc `status` của một
  selection thay đổi giá trị**. Heartbeat, revision bump, ACK, hay cùng một giá
  được gửi lại **không được tính**. Đây là định nghĩa duy nhất của "realtime".
- `observedEvidenceCadenceMs` là p50/p95 khoảng cách giữa các lần bằng chứng
  authoritative liên tiếp, tính trên cửa sổ trượt 5 phút. Nó đứng cạnh
  `expectedEvidenceCadenceMs` để chênh lệch policy hiện ra ngay.
- Telemetry lưu trong ring buffer 5 phút, bucket 10 giây. Bộ nhớ có trần cứng,
  không được phình. Ghi rõ trần trong test.
- Endpoint là read-only tuyệt đối. Không được kích hoạt recovery, không đổi state.

**Thêm CLI để worker dùng nhanh:**

```powershell
node scripts/diag-pipeline.mjs           # bảng 6 provider, mỗi dòng 1 provider
node scripts/diag-pipeline.mjs CMD       # chi tiết 8 chặng của một provider
node scripts/diag-pipeline.mjs CMD 60    # theo dõi liên tục 60 giây
```

Dòng tóm tắt phải có dạng đọc được ngay:

```text
CMD      HOP6_FEED    STALLED/BASELINE_EXPIRED   baseline=41.2s>20.0s  evid=33.1s>20.0s  quotes=0  Δ60s=0
SABA     OK           LIVE                       baseline=3.1s         evid=1.8s         quotes=1406  Δ60s=37
```

**Gate B1:** chạy `node scripts/diag-pipeline.mjs` trên stack đang chạy và dán
kết quả thật của cả 6 provider vào report. Không được dán output giả lập.

---

## Task B2 — Telemetry và watchdog cho treadmill của extension

**Bối cảnh:** `00-EVIDENCE.md` chứng minh CMD, IM, BTI không tự cập nhật đủ nhanh;
feed sống được là nhờ extension bơm refresh định kỳ. Nhưng mọi lỗi refresh đang bị
nuốt bởi `.catch(() => undefined)` tại `cmd-snapshot-poller.ts` dòng 137, 156,
173, 211, 230 — và các guard in-flight không có timeout nên một promise treo sẽ
khóa provider đó **vĩnh viễn**.

**Sửa:**
- `apps/chrome-extension/src/cmd-snapshot-poller.ts` + test
- `apps/chrome-extension/src/network-observer.ts` (chỉ phần phát diagnostic)

**Bắt buộc:**

1. Mỗi lần chạy một work item định kỳ (`maintain`, `refreshCatalog`,
   `recoverCmdCatalog`, `pollSabaDomChanges`, `capture`) phải ghi kết quả:
   `OK` | `ERROR` | `TIMEOUT` | `SKIPPED_INFLIGHT`, kèm `durationMs` và mã lỗi đã
   khử nhạy cảm. Không được nuốt lỗi im lặng nữa.
2. Gửi định kỳ (không quá 1 lần / 5 giây / source) một envelope `TAB_STATE`
   `{kind:"WORK_HEALTH", counters, lastOutcome, lastErrorCode, inFlightAgeMs}`
   để API dựng được chặng 3 và chặng 4 của trace.
3. **Watchdog:** nếu một guard in-flight bị giữ lâu hơn `max(3 × interval, 30s)`
   thì cưỡng bức giải phóng, đếm vào `forcedUnlocks`, và ghi log. Đây là sửa lỗi
   chết vĩnh viễn, không phải tính năng phụ.
4. Bọc mọi work item bằng timeout cứng. Không được có await nào không có trần.

**RED bắt buộc trước khi sửa:** viết test dựng một `refreshCatalog` trả về promise
không bao giờ settle, chạy poller qua 20 tick, và chứng minh **hiện tại** không có
lần refresh thứ hai nào được lên lịch. Sau khi sửa, test phải chứng minh watchdog
giải phóng và refresh tiếp tục.

**Gate B2:** test RED được ghi lại, test GREEN pass, và `forcedUnlocks` xuất hiện
trong output của `diag-pipeline`.

---

## Task B3 — Khung replay dùng capture thật

**Bối cảnh:** có sẵn 42 MB traffic thật trong
`%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures\*.jsonl` mà không test nào dùng.
Toàn bộ 2555 test hiện tại nạp envelope viết tay — đó là lý do chúng xanh trong
khi sản phẩm chết.

**Tạo:**
- `scripts/replay-capture.mjs` + test
- `apps/api/src/chrome-bridge/replay-harness.ts` + test

**Hợp đồng:**

```powershell
node scripts/replay-capture.mjs --capture <file.jsonl> --provider CMD
node scripts/replay-capture.mjs --capture <file.jsonl> --provider CMD --assert-semantic-changes 3
```

Nạp envelope thật theo đúng thứ tự và timestamp gốc vào **đúng adapter production**
(không dùng bản mô phỏng), rồi báo cáo: số baseline lập được, số delta áp dụng
được, số envelope bị từ chối kèm lý do, và **số lần giá thật đổi**.

Thoát mã 1 nếu số lần đổi giá nhỏ hơn `--assert-semantic-changes`.

**Bắt buộc:** thêm ít nhất một test cho mỗi provider dùng capture thật thay vì
envelope viết tay. Nếu chưa có capture cho provider nào thì ghi rõ trong report;
worker của provider đó sẽ tự ghi ở Task riêng.

**Gate B3:** chạy replay trên ít nhất một capture thật và dán kết quả vào report.

---

## Task B4 — Cadence policy phải suy ra từ đo đạc

**Sửa:** `apps/api/src/chrome-bridge/provider-feed-policies.ts` + test.

Theo `00-EVIDENCE.md`, ba provider đang có policy chặt hơn cadence thật:

| Provider | Cadence tự nhiên đo được | Policy hiện tại | Vấn đề |
|---|---|---|---|
| CMD | ~30 s, có gap 60 s | 20 s / 20 s | Không thể thỏa mãn |
| IM | không tự poll | 20 s / 25 s | Không thể thỏa mãn |
| BTI | ~15 s, có gap 30 s | 10 s / 30 s | Không có biên |

**Quy tắc mới, phải viết thành hằng số có chú thích nguồn:**

- `expectedEvidenceCadenceMs >= 3 × p95 cadence đo được` của provider đó.
- `maxBaselineAgeMs >= 2 × expectedEvidenceCadenceMs`.
- Mỗi giá trị phải có comment ghi rõ số đo và ngày đo.

**Không được** nới policy để che lỗi. Nếu nới rồi mà provider vẫn không có
`HOP8` đổi giá, thì đó là lỗi thật ở chặng khác và phải để lộ ra.

Phơi `observedEvidenceCadenceMs` ra trace (đã yêu cầu ở B1) để lần sau chỉnh
policy dựa trên số liệu chứ không dựa trên cảm giác.

**Gate B4:** sau khi đổi, chạy `diag-pipeline` và chứng minh không provider nào
còn `BASELINE_EXPIRED` hay `EVIDENCE_CADENCE_EXCEEDED` **chỉ vì policy**.

---

## Task B5 — Nghiệm thu phải đòi giá đổi thật

**Sửa:** `scripts/provider-runtime-sampler.mjs` + test.

`runtimeVerdict()` hiện ghi `quoteChanges[]` rồi bỏ qua. Thêm điều kiện FAIL:

- `SEMANTIC_CHANGE_NOT_OBSERVED` khi `quoteChanges.length === 0`.
- `SEMANTIC_CHANGE_TOO_SPARSE` khi số lần đổi giá thấp hơn ngưỡng tối thiểu của
  provider (worker tự đề xuất, Opus duyệt, ghi vào report).

Đồng thời **gỡ ràng buộc lease** khỏi đường chạy chẩn đoán: sampler phải chạy
được ở chế độ `--no-lease` để worker đo tự do trong lúc phát triển. Chế độ
nghiệm thu chính thức vẫn giữ nguyên ràng buộc.

**Gate B5:** chứng minh bằng test rằng một phiên có đủ mọi cờ xanh nhưng không có
lần đổi giá nào thì FAIL.

---

## Task B6 — Dập vòng lặp recovery của pipeline cũ

**Bối cảnh:** log `.run/root-live-stack.final.stderr.log` cho thấy vòng recovery
1 Hz spam `AUTH_EGRESS_UNAVAILABLE` và `FABET_AUTH_ROOT_NAVIGATION_FAILED` liên
tục hàng trăm dòng. Nó đốt CPU, làm nhiễu log, và vi phạm tiêu chí "không tạo
recovery storm".

**Sửa:** `apps/api/src/chrome-bridge/automatic-source-recovery.ts` + test,
và điểm gọi `startProviderRecoverySweep` trong `apps/api/src/server.ts`.

**Bắt buộc:**

1. Backoff lũy thừa theo từng account khi recovery thất bại liên tiếp:
   1 s → 2 s → 4 s → … → trần 5 phút. Reset về 1 s khi có một lần thành công.
2. Gộp log: một dòng mỗi lần đổi trạng thái, kèm số lần lặp lại. Không in lại
   cùng một lỗi mỗi giây.
3. Đưa `consecutiveFailures`, `nextAttemptInMs`, `lastFailureCode` vào chặng 6
   của trace.

**Gate B6:** chạy stack 5 phút với provider chết và chứng minh số dòng log của
một mã lỗi không vượt quá 10, đồng thời CPU của tiến trình API ổn định.

---

## GATE 0 — bắt buộc chạy trước mọi thứ

```powershell
curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources
```

Đây là **nguồn sự thật duy nhất** về việc tab đã gắn hay chưa.

- Trả `{"sources":[]}` **hoặc** không có lobby của mình → **môi trường hỏng**, không
  phải lỗi code. Ghi `BLOCKED_ENV` rồi **DỪNG NGAY**. Cấm diag dài, cấm RED, cấm sửa.
- Có lobby của mình (kể cả `authorityDisposition: "CANDIDATE"`) → **đi tiếp**.

### Bẫy đã biết — `HOP1_TAB` báo sai (đo 2026-08-25)

`server.ts` nạp diagnostics bằng `chromeBridgeRegistry.listActiveSources()`, tức là
**chỉ thấy slot ACTIVE**. Source đang ở slot `CANDIDATE` sẽ khiến
`HOP1_TAB.detail.sourceId === null` **dù tab đã gắn và envelope đang chảy**.

Quy tắc bắt buộc:

- `sources` **có** lobby mình + `HOP1_TAB` null → **KHÔNG phải `BLOCKED_ENV`**, cũng
  không phải chặng hỏng đầu tiên. Bỏ qua HOP1, lấy chặng hỏng thật đầu tiên trong
  `HOP3_ENVELOPE` → `HOP4_ADAPTER` → `HOP5_AUTHORITY` → `HOP6_FEED`. Nguyên nhân gốc
  thường là **authority không được thăng từ CANDIDATE lên ACTIVE**.
- `sources` **rỗng** + `HOP1_TAB` null + `byTransport` toàn 0 + `lastEnvelopeAgeMs`
  hàng trăm giây → `BLOCKED_ENV` thật.

Việc sửa `listActiveSources()` → `listSources()` là **shared, của Opus**, không worker
nào được đụng `server.ts`.

## Replay harness — KHÔNG dùng làm cổng nghiệm thu

Đo 2026-08-25: toàn bộ capture trong `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures`
bị data-plane từ chối với `NETWORK_BODY_INCOMPLETE` (capture không có body). Mọi
`replay-capture.mjs --assert-semantic-changes` vì thế **luôn ra `semanticChanges: 0`**
với mọi provider. Đây là khiếm khuyết của BASE Task B3, **không phải lỗi provider**.

Do đó:

- **Cấm** dùng replay làm điều kiện chặn `LOCAL_GREEN`.
- Bằng chứng thay thế, bắt buộc: **live `HOP8.quoteChanges60s > 0`** trên
  `scripts/diag-pipeline.mjs` cùng `sampleChange` có giá trước/sau.
- Nếu vẫn muốn chạy replay: chỉ ghi kết quả vào report như thông tin, không kết luận.

## Định nghĩa dùng chung cho mọi provider worker

Trạng thái hợp lệ, không dùng phần trăm, không ghi `DONE`:

- **`INVESTIGATED`** — đã ghi được capture thật của provider mình và mô tả đúng
  transport, cadence, schema. Có file bằng chứng đã khử nhạy cảm.
- **`BLOCKED_ENV`** — trúng GATE 0 ở trên. Ghi số liệu chứng minh rồi DỪNG.
  Không phải lỗi của worker, không được biến thành RED giả.
- **`SHARED_REQUEST`** — chặng hỏng nằm ngoài whitelist (`network-observer.ts`,
  `background.ts`, `tab-registry.ts`, `lobby-signatures.ts`, contracts, data-plane,
  `server.ts`). Ghi: file cần sửa + lý do + hop/bằng chứng, rồi DỪNG chờ Opus.
  Chỉ dùng khi **đã qua GATE 0** (tức là có source thật mà vẫn hỏng).
- **`LOCAL_GREEN`** — có RED tái hiện lỗi thật, có fix tối thiểu, test pass,
  typecheck pass, và **live `HOP8.quoteChanges60s > 0`** sau khi sửa.
- **`LOCAL_GREEN <X> — NO_CODE_CHANGE`** — live đã xanh sẵn: chặng hỏng thật là
  `null` (bỏ qua bẫy HOP1) **và** `HOP8.quoteChanges60s > 0` ở **>= 3 lần đo cách
  nhau >= 60 giây**, kèm `sampleChange` giá trước/sau. Trường hợp này **cấm** bịa RED
  hay sửa code cho có; ghi số liệu rồi DỪNG.
- **`PROVISIONAL_ACCEPTANCE`** — trên build đang chạy thật, đủ **tất cả**:

  1. `diag-pipeline <PROVIDER>` cho `firstFailingHop: null` liên tục 10 phút.
  2. `HOP8.quoteChanges60s > 0` ở **ít nhất 8 trong 10** cửa sổ 60 giây liên tiếp.
  3. Đối chiếu tay: mở tab provider, chọn 3 kèo bất kỳ (1 AH, 1 O/U, 1 live),
     so giá hiển thị trong tool với giá trên trang. Sai lệch phải là 0.
  4. Quan sát ít nhất 3 lần provider tự đổi giá và tool cập nhật theo, ghi lại
     giá trước/sau và độ trễ.
  5. Một lần gián đoạn mô phỏng an toàn (ngắt bridge WebSocket, hoặc kill service
     worker của extension — **không reload tab provider**) và feed tự phục hồi
     trong SLA mà worker tự đề xuất.
  6. Trong suốt quá trình, 5 provider còn lại không đổi `sourceId` và không rớt
     khỏi trạng thái của chúng.
  7. Không false-zero: không có mẫu nào catalog rỗng trong khi provider vẫn có
     trận trên trang.

`DONE` **không** thuộc quyền worker. Chỉ Opus ghi `DONE` sau soak 24 giờ toàn hệ
thống. Trước đó, mức cao nhất được ghi là `READY_FOR_24H_SOAK`.

## Điều tuyệt đối cấm với mọi worker

- Không sửa file của provider khác.
- Không build, restart stack, reload extension. Chỉ Opus làm.
- Không reload, navigate, focus, đóng tab provider.
- Không đọc/in/lưu token, cookie, launch URL, header auth, raw body.
- Không chạy Git mutation.
- Không refactor ngoài phạm vi lỗi đang mở.
- Không báo thành công bằng cờ trạng thái. Chỉ `HOP8` đổi giá mới là bằng chứng.
- Không viết lại `00-EVIDENCE.md` trừ khi có phép đo mới mâu thuẫn, và phải kèm
  lệnh tái lập.
