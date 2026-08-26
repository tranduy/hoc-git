# WORKER IM

Đọc bắt buộc theo thứ tự: `00-EVIDENCE.md` → `01-BASE.md` → file này.
Repo root `F:\0. PROJECT\tool-chenh`. Không worktree. Không build, không restart.

## Mapping

- Account: `catalog-source:IM:FOOTBALL` · Lobby: `IM` · Source: `chrome:IM:<tabId>`
- Tab: `imsports.directsb.net`
- Transport: **HTTP, và provider KHÔNG tự cập nhật**

## Whitelist file được sửa

- `apps/api/src/chrome-bridge/im-http-adapter.ts` + test
- `apps/api/src/providers/im/im-football-catalog-source.ts` + test
- `apps/chrome-extension/src/im-bootstrap-refresh.ts` + test
- Report riêng: `docs/superpowers/reports/realtime/im.md`
- Evidence bị ignore: `.run/realtime/im/*`

## Ground truth đã đo (2026-08-25, 150 giây)

Đây là provider mong manh nhất trong sáu sàn.

- **Không có WebSocket.**
- **Toàn bộ 11 HTTP request đều nằm trong 15 giây đầu. Sau đó im lặng tuyệt đối
  suốt 135 giây còn lại.**

| Path | Số lần | Bucket |
|---|---:|---|
| `/api/HomeV6/GetSM` | 3 | 0 |
| `/api/HomeV6/GetSP` | 1 | 0 |
| `/api/EventV6/GetFEC` | 1 | 0 |
| `/api/EventV6/GetBtgC` | 1 | 0 |
| `/api/AnnouncementV6/GetScrollingAnnouncement` | 1 | 0 |

- **`GetSE` — endpoint mà adapter đang đọc — không hề xuất hiện.** Trang landing
  mặc định không mở view bóng đá, nên nó không bao giờ gọi `GetSE`.

## Hệ quả kiến trúc

IM không có nguồn đẩy nào. Nó **không thể** tự phục hồi. Feed IM tồn tại **chỉ**
nhờ extension chủ động ký và gửi `GetSE` trong trang, hiện mỗi 15 giây
(`imDiscoveryIntervalMs`), trong khi `maxBaselineAgeMs` là 25 giây. Biên an toàn
10 giây cho một request ký trong trang qua CDP — quá mỏng.

Điều này có nghĩa: với IM, **treadmill chính là kiến trúc**, không phải giải pháp
tạm. Vậy nó phải được thiết kế cho đúng: có timeout, có watchdog, có retry có
backoff, có telemetry, và policy phải rộng gấp bội chu kỳ bơm.

## Giả thuyết xếp theo mức khả tín

**H1 — Treadmill dừng và không ai biết (gần như chắc chắn).**
`#evaluateImCatalogMainWorlds` chạy qua `Runtime.evaluate` trong main world. Khi
frame detach, context bị hủy, hoặc SPA điều hướng nội bộ, eval ném lỗi và bị nuốt
bởi `.catch(() => undefined)`. Không có refresh nào nữa → 25 giây sau baseline hết
hạn → chết vĩnh viễn. BASE Task B2 đã thêm telemetry + watchdog; việc của bạn là
xác nhận nó bắt được đúng lỗi này và đếm ra con số.

**H2 — Cần điều hướng nội bộ để `GetSE` khả dụng.**
Recon cho thấy trang landing chỉ gọi `GetSM`/`GetSP`/`GetFEC`/`GetBtgC`. Phải xác
định chính xác điều kiện nào làm `GetSE` khả dụng, và đảm bảo extension thiết lập
được điều kiện đó **mà không reload hay điều hướng tab**. Nếu bắt buộc phải có
tương tác trong trang thì mô tả rõ, đó là yêu cầu shared gửi Opus.

**H3 — Hai partition không cùng generation.**
Adapter chỉ commit khi cả `IM_MARKET_1` và `IM_MARKET_2` cùng generation. Nếu một
partition thất bại lặng lẽ thì generation không bao giờ hoàn tất và không baseline
nào được lập, dù request có chạy. Đo tỉ lệ generation hoàn tất / khởi tạo.

**H4 — Chuẩn hóa odds Hong Kong.**
Report cũ nói đã sửa, nhưng chưa từng chạy thật. Xác nhận lại bằng replay trên
capture thật rằng odds HK hữu hạn `> 1` được giữ và `0`/không hữu hạn/malformed bị
loại.

## Bước điều tra bắt buộc

0. **GATE 0 — `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`.**
   Không có source `chrome:IM:*` → ghi `BLOCKED_ENV` + output rồi DỪNG. Cấm diag
   dài, cấm RED, cấm sửa code. Xem mục GATE 0 trong `01-BASE.md`.

1. **INVESTIGATED — không mở Chrome mới.**
   CẤM `scripts/recon-provider-realtime.mjs`. Dùng `00-EVIDENCE.md` (IM im lặng
   sau 15s; `GetSE` không xuất hiện trên landing) + capture có sẵn. Chỉ
   `record-capture.mjs --provider IM` nếu CDP `9333` đã sẵn (attach, không launch).

2. `node scripts/diag-pipeline.mjs IM 180` — ghi `firstFailingHop` và detail.

3. Một RED tái hiện đúng chặng hỏng. Nếu là H1, RED phải chứng minh treadmill
   dừng mà trace **không** báo — rồi fix để trace báo được.

4. Fix tối thiểu → test focused → typecheck → replay với capture thật.

5. Báo `LOCAL_GREEN IM` và dừng.

## Nghiệm thu riêng của IM

- SLA đề xuất phải tính từ **chu kỳ bơm của extension**, không phải cadence
  provider (vì provider bằng 0). Với chu kỳ 15 giây, đề xuất hợp lý là
  **p95 <= 30 giây**. Phải chứng minh bằng số đo.
- Bắt buộc chứng minh một lần **service worker của extension bị kill rồi sống
  lại** mà IM vẫn tự lập lại baseline, **không reload tab**. Đây là kịch bản chết
  người nhất của IM và phải có bằng chứng.
- Chứng minh không false-zero: khi `GetSE` thất bại, catalog phải giữ dữ liệu cũ
  và báo `STALE` đúng, tuyệt đối không publish catalog rỗng.
