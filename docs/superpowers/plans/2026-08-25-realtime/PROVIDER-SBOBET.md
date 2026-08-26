# WORKER SBOBET / KSPORT

Đọc bắt buộc theo thứ tự: `00-EVIDENCE.md` → `01-BASE.md` → file này.
Repo root `F:\0. PROJECT\tool-chenh`. Không worktree. Không build, không restart.

## Mapping

- Account: `catalog-source:SBOBET:FOOTBALL` · Lobby: **`KSPORT`** · Source: `chrome:KSPORT:<tabId>`
- Tab: `zenandfe.com`
- Transport: **STOMP trên SockJS**, chạy trong **OOPIF con** — bắt buộc phải có
  child CDP session, không thấy được từ session của trang gốc.

## Whitelist file được sửa

- `apps/api/src/chrome-bridge/ksport-ws-adapter.ts` + test
- `apps/api/src/chrome-bridge/ksport-baseline-generation.ts` + test
- `apps/api/src/providers/sbobet/sbobet-stomp.ts` + test
- `apps/api/src/providers/sbobet/sbobet-direct-catalog.ts` + test
- Report riêng: `docs/superpowers/reports/realtime/sbobet.md`
- Evidence bị ignore: `.run/realtime/sbobet/*`

## Ground truth đã đo (2026-08-25, 150 giây)

**Provider khỏe mạnh và phát rất dày. Vấn đề nằm ở phía chúng ta.**

### Socket thật (giữ)

| Socket | Frame / 150 s | Bytes | Ghi chú |
|---|---:|---:|---|
| `wss://d43.sb21.net/sport/396/5usiwmpp/websocket` | 420 | **4.9 MB** | chính |
| `wss://two.sb21.net/sport/306/vmamejlu/websocket` | 290 | 218 KB | song song |

**Có hai socket `/sport/` chạy đồng thời trên hai host khác nhau.** Đây là điều
adapter hiện chưa xử lý rõ ràng và là hạng mục điều tra số một.

### Socket nhiễu (loại)

| Socket | Frame / 150 s | Ghi chú |
|---|---:|---|
| `novoga.sb21.net/` | 1440 | Volta — **871 frame chỉ trong một bucket 15 giây** |
| `novoba.sb21.net/` | 292 | Volta |

Cả hai đều **không có** path `/sport/`. Predicate `isKsportCatalogSocket`
(`network-observer.ts:34`) đã loại đúng. **Không được nới predicate này** — nếu
lọt Volta vào, cơn bùng nổ 871 frame/15 s sẽ làm nổ ngân sách bộ nhớ và tạo storm.

### Destination STOMP đã xác nhận

```text
/topic/sports/1_11/today/ma/event/vi   subscription: subSportHotMatch   (prematch)
/topic/sports/1_1/live/ma/event/vi     subscription: subSportBookLive   (live)
```

### Cấu trúc frame

```text
a["MESSAGE\ndestination:/topic/sports/1_11/today/ma/event/vi\ncontent-type:application/json\n
subscription:subSportHotMatch\nmessage-id:5usiwmpp-45441743\ncontent-length:6316\n\n
{\"headers\":{},\"body\":\"[{\\\"0\\\":312,\\\"1\\\":\\\"Cúp Quốc gia Úc\\\",\\\"2\\\":[...]}]\"}"]
```

- SockJS bọc ngoài (`a[...]`), STOMP bên trong, body là JSON **escape hai lớp**.
- Khóa số: `0` = leagueId, `1` = tên giải, `2` = mảng trận.

**Phát hiện quan trọng — provider gửi lại full snapshot, không phải delta.**
Quan sát 5 bản tin liên tiếp có **cùng `content-length:6316`** và cùng phần đầu
body, chỉ khác `message-id` (`45441743`, `45441745`, `45441746`, `45441749`,
`45441752`). Nghĩa là:

- Logic khử trùng lặp **phải so nội dung**, không được so `message-id`.
- Nếu đang dùng `message-id` hoặc thứ tự receipt để suy ra "có thay đổi", hệ thống
  sẽ báo realtime giả trong khi giá đứng im. Đây là vi phạm trực tiếp tiêu chí
  "không dùng dữ liệu cũ giả làm realtime".

## Trạng thái live đo lúc 20:35 ngày 2026-08-25

- `sources`: `chrome:KSPORT:2105815583`, `state: LIVE`, `authorityDisposition: CANDIDATE`.
- `HOP3.byTransport`: `WS_FRAME: 0`, `DOM_SNAPSHOT: 0`, `TAB_STATE: 134`.
  **Không một frame WebSocket nào tới bridge** dù tab đã gắn.
- `HOP5.authorityDisposition: NONE`, `HOP8.quoteChanges60s: 0`.
- `HOP1_TAB` null là bẫy telemetry (xem `01-BASE.md`), không phải chặng hỏng.

Chặng hỏng thật là **HOP3**. Đây là H4 (child session OOPIF không được gắn). Nếu
xác nhận được điều đó, fix nằm ở extension — **ngoài whitelist** → ghi
`SHARED_REQUEST` kèm bằng chứng và DỪNG, không tự sửa.

## Giả thuyết xếp theo mức khả tín

**H1 — Hai socket `/sport/` đồng thời, adapter không biết chọn cái nào.**
Adapter có khái niệm `authority: NONE | WS | HTTP` và `streamId`. Với hai socket
cùng hợp lệ, một `OPEN` mới của socket thứ hai có thể làm "về hưu" socket thứ nhất
đang khỏe mạnh, xóa authority, rồi lặp vô hạn. Điều tra trước tiên: hai socket
phục vụ cái gì, có phải một cho live một cho today không, và authority nên là
per-socket hay per-partition.

**H2 — Chờ đủ cả hai partition mà một partition không bao giờ tới.**
Adapter chỉ đặt `authority = "WS"` sau khi **cả** live và today hoàn tất baseline.
Nếu tab đang ở một tab thời gian không phát `today`, baseline không bao giờ đủ.
Đo tỉ lệ baseline hoàn tất trên mỗi partition riêng.

**H3 — Khử trùng lặp sai vì full snapshot lặp lại.** Xem phát hiện ở trên.

**H4 — Child session OOPIF không được gắn.**
Feed nằm trong OOPIF. Nếu `Target.setAutoAttach` với `flatten` không được áp cho
đúng child, sẽ không thấy một frame nào dù trang chạy hoàn hảo. Xác nhận bằng
chặng 3 của trace: `WS_FRAME` có về không.

**H5 — Tab bị từ chối vì title.**
`recognizeLobbyTab` loại KSPORT nếu title chứa `volta` hoặc
`something went wrong`; `isReadyKsportSportsbookTab` lại đòi title chứa
`sportsbook`. Xác nhận title thật của tab `zenandfe.com` sau khi vào bóng đá —
nếu không chứa `sportsbook`, các đường phụ thuộc nó sẽ chết lặng.

## Bước điều tra bắt buộc

0. **GATE 0 — `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`.**
   Không có source `chrome:KSPORT:*` → ghi `BLOCKED_ENV` + output rồi DỪNG. Cấm
   diag dài, cấm RED, cấm sửa code. Xem mục GATE 0 trong `01-BASE.md`.

1. **INVESTIGATED — không mở Chrome mới.**
   CẤM `scripts/recon-provider-realtime.mjs`. Dùng `00-EVIDENCE.md` (2 socket
   `/sport/`, Volta nhiễu, full snapshot lặp) + capture có sẵn. Chỉ
   `record-capture.mjs --provider SBOBET` nếu CDP `9333` đã sẵn (attach, không
   launch). Ghi từ evidence: số socket `/sport/`, destination, title tab.

2. `node scripts/diag-pipeline.mjs SBOBET 180`.

3. Một RED tái hiện chặng hỏng đầu tiên qua `replay-capture.mjs` với capture thật.
   Nếu là H3, RED phải chứng minh hệ thống hiện **báo có cập nhật** khi năm frame
   trùng nội dung đi qua.

4. Fix tối thiểu → test focused → typecheck → replay
   `--assert-semantic-changes 5`.

5. Báo `LOCAL_GREEN SBOBET` và dừng.

## Nghiệm thu riêng của SBOBET

- SLA đề xuất dựa trên cadence ~2.8 frame/s: **p95 <= 8 giây**.
- Bắt buộc chứng minh **frame trùng nội dung không sinh revision mới**. Đây là
  điểm dễ tạo realtime giả nhất trong cả sáu sàn.
- Bắt buộc chứng minh Volta (`novoga`/`novoba`) không hề ảnh hưởng: trong cửa sổ
  có burst 871 frame của Volta, catalog KSPORT không được đổi revision.
- Chứng minh một lần OOPIF bị thay thế mà feed tự gắn lại, **không reload tab**.
