# WORKER CMD

Đọc bắt buộc theo thứ tự: `00-EVIDENCE.md` → `01-BASE.md` → file này.
Repo root `F:\0. PROJECT\tool-chenh`. Không worktree. Không build, không restart.

## Mapping

- Account: `catalog-source:CMD:FOOTBALL` · Lobby: `CMD` · Source: `chrome:CMD:<tabId>`
- Tab: `cgnew.fts368.com/DomainNames/cgnew/home.aspx`
- Transport: **HTTP thuần, không có WebSocket**

## Whitelist file được sửa

- `apps/api/src/chrome-bridge/cmd-http-adapter.ts` + test
- `apps/chrome-extension/src/cmd-snapshot-poller.ts` + test
- `apps/chrome-extension/src/cmd-recovery-state.ts` + test
- `apps/api/src/providers/cmd/cmd-observed-catalog.ts` + test
- Report riêng: `docs/superpowers/reports/realtime/cmd.md`
- Evidence bị ignore: `.run/realtime/cmd/*`

Cần sửa ngoài whitelist thì gửi yêu cầu cho Opus, ghi rõ file + lý do + bằng chứng.
Không tự sửa `network-observer.ts`, `background.ts`, contracts, data-plane.

## Ground truth đã đo (2026-08-25, 150 giây)

Không có WebSocket. Trang tự poll các endpoint sau:

| Path | Số lần / 150 s | Bucket (giây) |
|---|---:|---|
| `/GetSportItems/Highlight` | 6 | 0, 0, 30, 60, 90, 120 |
| `/Member/BetsView/Data.asmx/GetSportItems` | 5 | 0, 30, 60, 90, 120 |
| `/member/betsview/leaguefilter.aspx` | 5 | 0, 30, 60, 90, 120 |
| **`/Member/BetsView/BetLight/DataOdds.ashx`** | **4** | **0, 60, 90, 120** |

Cadence tự nhiên ~30 giây. `DataOdds.ashx` có khoảng trống 60 giây.
CMD nằm sau Cloudflare (thấy request `cdn-cgi/challenge-platform/`).

## Giả thuyết xếp theo mức khả tín

Điều tra theo thứ tự này. **Một giả thuyết, một RED, một fix.** Không sửa hai chỗ
cùng lúc.

**H1 — Policy chặt hơn cadence thật (gần như chắc chắn).**
`maxBaselineAgeMs = 20_000` trong khi baseline tự nhiên tới mỗi ~30–60 giây. Feed
vào `LIVE` ở baseline đầu, rồi 20 giây sau `#baselineExpired()` trả true →
`STALLED / BASELINE_EXPIRED` → catalog `PROVIDER_VALIDATION_FAILED`. Khớp chính
xác triệu chứng "chỉ có dữ liệu lúc load đầu". BASE Task B4 đã nới policy — xác
nhận lại bằng `diag-pipeline CMD` trước khi làm gì thêm.

**H2 — Không phải refresh nào cũng sinh baseline `fc=1`.**
Adapter chỉ coi `providerFunctionCode === 1` kèm `today`+`f` là authoritative
baseline. Nếu refresh 15 giây của extension chỉ tạo delta (fc 3/5/7) thì
`lastCompleteBaselineAtMs` không bao giờ được làm mới, và không policy nào cứu
được. Đo: đếm phân bố function code thực tế trong 5 phút.

**H3 — Guard in-flight treo vĩnh viễn.**
`recoverCmdCatalog` có `CMD_RECOVERY_DEADLINE_MS = 10_000` và tối đa 6 lần thử.
Nếu chuỗi này vượt quá interval 15 giây thì `#catalogRefreshInFlight` chưa được
giải phóng đã tới tick sau → refresh bị bỏ. Lặp lại đủ nhiều là chết hẳn.
BASE Task B2 đã thêm watchdog — xác nhận `forcedUnlocks` của CMD bằng 0.

**H4 — Cloudflare challenge cắt polling giữa phiên.**
Nếu challenge trả về HTML thay vì JSON, adapter phải fail-closed rõ ràng với mã
riêng chứ không được im lặng bỏ qua. Kiểm tra bằng cách theo dõi status code của
`DataOdds.ashx` trong 10 phút.

## Bước điều tra bắt buộc

0. **GATE 0 — `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`.**
   Không có source `chrome:CMD:*` → ghi `BLOCKED_ENV` + output rồi DỪNG. Cấm diag
   dài, cấm RED, cấm sửa code. Xem mục GATE 0 trong `01-BASE.md`.

1. **INVESTIGATED — không mở Chrome mới.**
   CẤM `scripts/recon-provider-realtime.mjs` (spawn Chrome → duplicate khi worker
   song song). Chrome user + extension đã chạy. Dùng ground truth CMD trong
   `00-EVIDENCE.md` + capture có sẵn `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures\`.
   Chỉ `record-capture.mjs --provider CMD` nếu CDP `http://127.0.0.1:9333` đã sẵn
   (attach, không launch). Ghi vào report: cadence / function code từ evidence.

2. **Đọc trace, không đoán:**

   ```powershell
   node scripts/diag-pipeline.mjs CMD 120
   ```

   Ghi lại `firstFailingHop` và toàn bộ `detail` của chặng đó.

3. **Viết đúng một RED** tái hiện chặng hỏng đầu tiên. Nếu chặng hỏng là HOP4 thì
   RED phải là test adapter dùng **capture thật** qua `replay-capture.mjs`, không
   phải envelope viết tay.

4. **Fix tối thiểu**, chạy test focused + typecheck workspace bị ảnh hưởng, rồi
   `node scripts/replay-capture.mjs --capture <cmd capture> --provider CMD --assert-semantic-changes 3`.

5. Báo `LOCAL_GREEN CMD` và **dừng lại**. Chờ Opus deploy.

## Timebox

15 phút để gọi tên chặng hỏng đầu tiên. Không gọi được thì thêm đúng một bộ đếm
tại ranh giới nghi ngờ rồi báo cáo — cấm đoán. Hai giả thuyết sai liên tiếp thì
quay lại bước 2, không thử giả thuyết thứ ba.

## Nghiệm thu riêng của CMD

Theo mục "Định nghĩa dùng chung" trong `01-BASE.md`, cộng thêm:

- SLA độ trễ tự đề xuất dựa trên cadence đo được. Với cadence tự nhiên 30 giây,
  một đề xuất hợp lý là **p95 <= 45 giây** từ lúc CMD đổi giá tới lúc tool hiện.
  Phải chứng minh bằng số đo, không được đặt bừa để dễ pass.
- Ba kèo đối chiếu tay phải gồm ít nhất một trận đang đá.
- Chứng minh sau một Cloudflare challenge (hoặc mô phỏng bằng cách chặn một lần
  request) feed vẫn tự phục hồi.
