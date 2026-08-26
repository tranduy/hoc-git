# WORKER BTI

Đọc bắt buộc theo thứ tự: `00-EVIDENCE.md` → `01-BASE.md` → file này.
Repo root `F:\0. PROJECT\tool-chenh`. Không worktree. Không build, không restart.

## Mapping

- Account: `catalog-source:BTI:FOOTBALL` · Lobby: `BTI` · Source: `chrome:BTI:<tabId>`
- Tab: `prod20091.fxf774.com`
- Transport: **HTTP polling, không có WebSocket**

## Whitelist file được sửa

- `apps/api/src/chrome-bridge/bti-http-adapter.ts` + test
- `apps/api/src/providers/bti/bti-direct-catalog.ts` + test
- Report riêng: `docs/superpowers/reports/realtime/bti.md` (tạo mới nếu chưa có)
- Evidence bị ignore: `.run/realtime/bti/*`

## Vai trò đặc biệt

BTI là **guard hồi quy** của cả hệ thống: mọi worker khác phải chứng minh BTI vẫn
`ACTIVE` trong suốt nghiệm thu của họ. Vì vậy BTI phải ổn định trước, và mọi thay
đổi ở đây đều có rủi ro lan rộng. Fix nhỏ, không refactor.

## Ground truth đã đo (2026-08-25, 150 giây)

| Path | Số lần | Bucket (giây) | Vai trò |
|---|---:|---|---|
| `/trpc/getLoginStatus` | 14 | đều ~10 s | **nhiễu auth, không phải catalog** |
| `/api/sportscenter/carousels/featured-matches/markets` | 10 | 0,15,30,45,60,75,90,120,135,150 | carousel |
| **`/api/eventlist/asia/leagues/v2/1/live`** | **9** | **0,15,30,45,60,90,105,120,135** | **danh sách trận live** |
| `/api/eventlist/asia/market/getMarketsAvailabilityForEvent` | 9 | 0,15,30,45,60,90,105,120,135 | market |
| `/api/betslip/bets/updates` | 9 | 15…135 | **nhiễu phiếu cược** |
| `/api/master/bonuses/free-bets/open` | 8 | — | nhiễu |

Cadence catalog ~15 giây, **nhưng có khoảng trống 30 giây** giữa bucket 60 và 90.
`maxBaselineAgeMs = 30_000` vừa khít khoảng trống đó — không còn biên nào.

## Giả thuyết xếp theo mức khả tín

**H1 — Không có biên cho khoảng trống 30 giây.**
Một gap 30 giây trong `leagues/v2/1/live` là đủ để `#baselineExpired()` bật đúng
lúc, đẩy BTI ra khỏi `LIVE` ngay cả khi provider hoàn toàn khỏe mạnh. Vì BTI là
guard, một lần rớt như vậy làm hỏng vòng nghiệm thu của **cả bốn worker khác**.
BASE Task B4 đã nới; xác nhận lại bằng `diag-pipeline BTI` chạy 10 phút.

**H2 — Generation bốn phần không hoàn tất.**
Adapter chỉ publish sau khi thu đủ toàn bộ nhóm request live/prematch của cùng một
generation. Recon cho thấy các endpoint **không đồng pha** (`leagues` có mặt ở
bucket 105, `carousels` thì không). Nếu một phần của generation không bao giờ tới,
generation treo và không baseline nào được commit. Đo: tỉ lệ generation hoàn tất.

**H3 — Nhiễu auth/betslip bị tính nhầm là bằng chứng.**
Code hiện đã tách đúng (`getLoginStatus`, `betslip/*` không làm mới catalog
liveness). Xác nhận lại rằng điều này **vẫn đúng** sau các thay đổi shared, vì
`getLoginStatus` chạy đều 10 giây và nếu bị tính nhầm sẽ tạo ảo giác feed sống
trong khi odds đã đứng im hàng phút.

**H4 — TTL của detail 10 giây so với cadence list 15 giây.**
`DETAIL_TTL_MS = 10_000` ngắn hơn chu kỳ list 15 giây, nên detail luôn hết hạn
trước khi list kế tiếp tới. Kiểm tra xem điều này có tạo ra khoảng mù nào không.

## Bước điều tra bắt buộc

0. **GATE 0 — `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`.**
   Không có source `chrome:BTI:*` → ghi `BLOCKED_ENV` + output rồi DỪNG. Cấm diag
   dài, cấm RED, cấm sửa code. Xem mục GATE 0 trong `01-BASE.md`.

1. **INVESTIGATED — không mở Chrome mới.**
   CẤM `scripts/recon-provider-realtime.mjs`. Dùng `00-EVIDENCE.md` (cadence ~15s,
   gap 30s) + capture có sẵn. Chỉ `record-capture.mjs --provider BTI` nếu CDP
   `9333` đã sẵn (attach, không launch). Ghi gap lớn nhất / đồng pha generation
   từ evidence hoặc capture cũ.

2. `node scripts/diag-pipeline.mjs BTI 300` — chạy dài vì lỗi của BTI là lỗi
   khoảng trống, không lộ ra trong cửa sổ ngắn.

3. Một RED tái hiện đúng chặng hỏng đầu tiên, ưu tiên dùng `replay-capture.mjs`
   với capture thật.

4. Fix tối thiểu → test focused → typecheck → replay.

5. Báo `LOCAL_GREEN BTI` và dừng.

## Nghiệm thu riêng của BTI

- Vì là guard, BTI phải chứng minh **`firstFailingHop: null` liên tục 30 phút**,
  không phải 10 phút như các provider khác.
- SLA đề xuất dựa trên cadence 15 giây với gap 30 giây: đề xuất hợp lý là
  **p95 <= 40 giây**. Chứng minh bằng số đo.
- Chứng minh nhiễu `getLoginStatus`/`betslip` **không** làm mới catalog liveness:
  dựng một cửa sổ chỉ có nhiễu và chứng minh trace báo `STALE` đúng lúc.
