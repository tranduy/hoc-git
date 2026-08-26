# WORKER SABA

Đọc bắt buộc theo thứ tự: `00-EVIDENCE.md` → `01-BASE.md` → file này.
Repo root `F:\0. PROJECT\tool-chenh`. Không worktree. Không build, không restart.

## Mapping

- Account: `catalog-source:SABA:FOOTBALL` · Lobby: `SABA` · Source: `chrome:SABA:<tabId>`
- Tab: `c0z0oa.bpd3a3fn.com`
- Transport: **Socket.IO** tại `wss://3qvsm5.bpd3a3fn.com/socket.io/`

## Whitelist file được sửa

- `apps/api/src/chrome-bridge/saba-ws-adapter.ts` + test
- `apps/api/src/providers/saba/saba-push-decoder.ts` + test
- `apps/api/src/providers/saba/saba-socket-frame.ts` + test
- `packages/adapters/src/saba/saba-football-normalizer.ts` + test
- Report riêng: `docs/superpowers/reports/realtime/saba.md`
- Evidence bị ignore: `.run/realtime/saba/*`

## Ground truth đã đo (2026-08-25, 150 giây)

**Provider hoàn toàn khỏe mạnh. Vấn đề nằm ở phía chúng ta.**

- 118 frame / 150 giây, **2.25 MB**, 111 frame `SOCKETIO_EVENT`.
- Phân bố: `{0:18, 15:56, 30:4, 45:7, 60:6, 75:5, 90:5, 105:4, 120:4, 135:7, 150:2}`
  → burst 74 frame trong 30 giây đầu, sau đó ổn định 4–7 frame mỗi 15 giây.
- `pingInterval` 25 000 ms, `pingTimeout` 20 000 ms, `maxPayload` 1 000 000.

**Lưu ý quan trọng: host của socket khác host của trang.**
Trang `c0z0oa.bpd3a3fn.com`, socket `3qvsm5.bpd3a3fn.com`. Cùng base domain.

### Cấu trúc bản tin đã xác nhận

```text
0{"sid":"...","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}

42["m","b872",[ ["c","c0","43a7de36-r162","..."],
                ["f",0,["type","siteid","$","isPeakHour","applydepspread"]],
                [0,"reset"],
                [0,15,1,"4267300",4,1],
                [0,"done"] ],"CrRG"]

42["m","b14",[ ["c","c3","43a7de36-r30","..."],
               ["f",0,["type","bettype","matchid","oddsid","parenttypeid","oddsstatus",
                       "liveindicator","depspread","cs90","oddsspreada","maxbet",...]],
               ... ]]

42["m","b14",[[0,"o",3,1052014590,2,132921468,1,2,4,2,5,"running",6,0,19,0,...]]]
```

- Envelope: `42["m","<partition>",[<ops>],"<ack>"]`.
- **`b14` là partition odds** — các frame 82–95 KB chứa `[0,"o",...]` là dòng odds.
  `b21` và `b872` là partition khác.
- **Schema khai báo động theo chỉ số:** phần tử `["f",0,[<danh sách tên field>]]`
  định nghĩa thứ tự cột cho các dòng theo sau. **Thứ tự này do server quyết định
  và có thể đổi giữa các phiên.** Tuyệt đối không hard-code chỉ số cột. Nếu
  decoder đang giả định vị trí cố định, đó là lỗi nghiêm trọng cần RED ngay.
- Giao thức baseline: `[0,"reset"]` … `[0,"done"]`.

## Trạng thái live đo lúc 20:35 ngày 2026-08-25

- `sources`: `chrome:SABA:2105815586`, `state: LIVE`, `authorityDisposition: CANDIDATE`.
- `HOP3.byTransport`: `WS_FRAME: 403`, `DOM_SNAPSHOT: 90`, `lastEnvelopeAgeMs: 446`.
  **Frame đang chảy bình thường.**
- `HOP6`: `HARD_RECOVERY`, `HOP7`: `ACTION_REQUIRED`, `HOP8.quoteChanges60s: 0`.
- `HOP1_TAB` null là bẫy telemetry (xem `01-BASE.md`), không phải chặng hỏng.

Kết luận đã chốt: frame về đủ nhưng **authority không thăng CANDIDATE → ACTIVE**,
nên không có baseline và không có đổi giá. Bắt đầu từ H1/H3 bên dưới.

## Giả thuyết xếp theo mức khả tín

**H1 — Điều kiện lập authority quá hẹp so với hành vi thật.**
Adapter chỉ nhận baseline khi có `OPEN → reset → data → done` trên stream hiện tại
với cờ `authorizing === true`. Đo thật cho thấy burst đầu là 74 frame trong 30
giây — nhiều partition đan xen. Phải xác nhận trình tự thật khớp với máy trạng
thái, và đặc biệt: khi extension gắn vào một tab **đã mở từ trước**, CDP không
thấy `webSocketCreated` nên **không bao giờ có `OPEN`** → không bao giờ có
baseline. Đây là kịch bản vận hành bình thường, không phải ngoại lệ.

**H2 — Chỉ số field bị hard-code.**
Xem mục schema ở trên. Kiểm tra `saba-push-decoder.ts` xem nó đọc bảng `f` hay
giả định vị trí. Nếu giả định, mọi thứ sẽ đúng hôm nay và sai vào phiên sau —
đúng cảnh báo đã ghi trong `HUONG-DAN-KY-THUAT.md` mục 11.

**H3 — Fail-closed đóng rồi không mở lại được.**
`PROVIDER_STREAM_GAP` và `PROVIDER_STREAM_CLOSED` xóa authority. Sau đó SABA chỉ
lấy lại được authority bằng một `OPEN` mới **thật sự mới hơn**. Nếu socket không
tự đóng mở lại (nó chạy liên tục 141 giây trong phép đo), thì sau một lần gap là
chết vĩnh viễn. Cần một đường phục hồi không phụ thuộc `OPEN` mới.

**H4 — DOM fallback không bao giờ đủ điều kiện.**
Fallback đòi hai generation atomic liên tiếp với độ phủ ổn định 95%. Đo xem điều
kiện này có bao giờ đạt trong thực tế không, hay nó chỉ là code chết.

## Bước điều tra bắt buộc

0. **GATE 0 — `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`.**
   Không có source `chrome:SABA:*` → ghi `BLOCKED_ENV` + output rồi DỪNG. Cấm diag
   dài, cấm RED, cấm sửa code. Xem mục GATE 0 trong `01-BASE.md`.

1. **INVESTIGATED — không mở Chrome mới.**
   CẤM `scripts/recon-provider-realtime.mjs`. Dùng `00-EVIDENCE.md` (Socket.IO,
   schema `f` động, partition `b14`) + capture có sẵn. Chỉ
   `record-capture.mjs --provider SABA` nếu CDP `9333` đã sẵn (attach, không launch).

2. **Thử nghiệm quyết định — gắn muộn:** trên tab SABA **đã mở sẵn**, quan sát
   qua `diag-pipeline` / capture có sẵn: gắn muộn có lập được baseline không,
   **không reload tab**, không spawn Chrome.

3. `node scripts/diag-pipeline.mjs SABA 180`.

4. Một RED tái hiện chặng hỏng đầu tiên, dùng `replay-capture.mjs` với capture
   thật.

5. Fix tối thiểu → test focused → typecheck → replay
   `--assert-semantic-changes 5` (SABA có cadence dày, 5 là hợp lý).

6. Báo `LOCAL_GREEN SABA` và dừng.

## Nghiệm thu riêng của SABA

- SLA đề xuất dựa trên cadence 4–7 frame / 15 giây: **p95 <= 10 giây**.
- Bắt buộc chứng minh kịch bản **gắn muộn**: observer gắn vào socket đã chạy sẵn
  và vẫn lập được baseline, **không reload tab**.
- Chứng minh decoder đọc bảng `f` động: dựng một capture có thứ tự field khác và
  chứng minh vẫn giải mã đúng.
