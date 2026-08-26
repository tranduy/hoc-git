# Ground truth đo được từ provider — 2026-08-25

> Đây là **dữ liệu đo thật**, không phải giả định. Mọi worker phải đọc file này
> trước khi viết một dòng code. Nếu quan sát của bạn mâu thuẫn với file này, ghi
> lại bằng chứng mới rồi cập nhật file — không được im lặng làm theo phỏng đoán.

## Cách thu thập

```powershell
node scripts/recon-provider-realtime.mjs 150000 .run/recon/provider-realtime.json
```

Chrome sạch, profile riêng `.run/recon/profile`, CDP port 9333, mở đồng thời cả 6
sàn từ `sảnh.md`, bật `Emulation.setFocusEmulationEnabled` +
`Page.setWebLifecycleState=active` cho mọi tab (đúng cách extension làm), quan sát
**154.6 giây**, chia bucket 15 giây.

Recon **không** chạy extension. Nó đo **cadence tự nhiên của chính trang provider**
— tức là sàn nhà (floor) khi không có ai kích thích. Con số này quan trọng vì nó
quyết định policy timeout được phép đặt bao nhiêu.

## Bảng tổng hợp — cadence thật vs policy hiện tại

| Provider | Transport mang UPDATE | Cadence tự nhiên đo được | `expectedEvidenceCadenceMs` | `maxBaselineAgeMs` | Kết luận |
|---|---|---|---|---|---|
| CMD | HTTP polling (không có WS) | **~30 s**; `DataOdds.ashx` có khoảng trống **60 s** | 20 000 | 20 000 | **Policy chặt hơn thực tế → chết chắc** |
| SABA | Socket.IO `42["m",...]` | ~4–7 frame / 15 s sau burst đầu | 10 000 | 60 000 | Đủ rộng |
| SBOBET/KSPORT | STOMP trên SockJS | ~2.8 frame / s, liên tục | 10 000 | 60 000 | Đủ rộng |
| APSPORT/TSPORT | WebSocket JSON | ~2.3 frame / s, liên tục | 5 000 | 30 000 | Đủ rộng |
| IM | HTTP | **0 request sau 15 giây đầu** | 20 000 | 25 000 | **Provider không tự poll → chết chắc** |
| BTI | HTTP polling | ~15 s, có khoảng trống **30 s** | 10 000 | 30 000 | **Policy chặt hơn thực tế → chết chắc** |

`ProviderFeedController.#livePrerequisitesSatisfied()` đòi **đồng thời**
`now - lastCompleteBaselineAtMs <= maxBaselineAgeMs` **và**
`now - lastAuthoritativeEvidenceAtMs <= expectedEvidenceCadenceMs`.
Với CMD, IM và BTI thì hai điều kiện này **không thể** duy trì bằng cadence tự
nhiên của provider. Feed chỉ sống được nhờ extension bơm refresh nhân tạo nhanh
hơn timeout. Đó là kiến trúc **treadmill**: ngừng đạp một nhịp là chết, và chết
là chết vĩnh viễn vì không có ai đo được là nó đã ngừng đạp.

Đây là lời giải cho triệu chứng *"chỉ lấy được lúc load đầu tiên"*.

---

## Chi tiết từng provider

### CMD — `cgnew.fts368.com`

- **Không có WebSocket nào.** Toàn bộ là HTTP polling do chính trang thực hiện.
- Endpoint quan sát được trong 150 s:

| Path | Số lần | Bucket (giây) |
|---|---:|---|
| `/GetSportItems/Highlight` | 6 | 0, 0, 30, 60, 90, 120 |
| `/Member/BetsView/Data.asmx/GetSportItems` | 5 | 0, 30, 60, 90, 120 |
| `/member/betsview/leaguefilter.aspx` | 5 | 0, 30, 60, 90, 120 |
| **`/Member/BetsView/BetLight/DataOdds.ashx`** | **4** | **0, 60, 90, 120** |

- `DataOdds.ashx` là endpoint odds mà adapter đang đọc. Nó chạy **thưa hơn** các
  endpoint khác và có một khoảng trống 60 giây ngay đầu phiên.
- Có request `cdn-cgi/challenge-platform/...` → CMD nằm sau Cloudflare. Một
  challenge giữa phiên sẽ làm gián đoạn polling.
- **Hệ quả:** `maxBaselineAgeMs = 20_000` không thể thỏa mãn bằng cadence tự
  nhiên. Extension đang refresh CMD mỗi **15 s** (`cmd-snapshot-poller.ts:189`)
  — biên an toàn chỉ 5 giây, mà `CMD_RECOVERY_DEADLINE_MS` lại là 10 s. Một lần
  recovery chậm là vượt ngưỡng.

### SABA — trang `c0z0oa.bpd3a3fn.com`, socket `3qvsm5.bpd3a3fn.com`

- **Socket.IO** tại `wss://3qvsm5.bpd3a3fn.com/socket.io/`.
  Lưu ý: host của socket **khác** host của trang, cùng base domain.
- 118 frame / 150 s, **2.25 MB**, 111 frame dạng `SOCKETIO_EVENT`.
- Phân bố bucket: `{0:18, 15:56, 30:4, 45:7, 60:6, 75:5, 90:5, 105:4, 120:4, 135:7, 150:2}`
  → burst 74 frame trong 30 giây đầu (catalog ban đầu), sau đó ~4–7 frame / 15 s.
- Cấu trúc bản tin:

```text
0{"sid":"...","pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
42["m","b872",[["c","c0","...","..."],["f",0,[<tên field>]],[0,"reset"],...,[0,"done"]],"CrRG"]
42["m","b14",[[0,"o",3,<oddsid>,2,<matchid>,1,2,4,2,5,"running",6,0,...]]]
```

- **Partition quan trọng là `b14`** — frame 82–95 KB chứa cập nhật odds
  (`[0,"o",...]` = odds row). `b21` và `b872` là partition khác.
- **Schema theo chỉ số field, khai báo động:** `["f",0,["type","bettype","matchid","oddsid","parenttypeid","oddsstatus",...]]`.
  Thứ tự field do server gửi kèm và **có thể đổi giữa các phiên**. Tuyệt đối
  không hard-code chỉ số cột; phải đọc bảng khai báo `f`.
- `pingInterval` 25 s, `pingTimeout` 20 s → heartbeat Socket.IO 25 giây.

### SBOBET/KSPORT — trang `zenandfe.com`, socket `*.sb21.net`

- Feed thật: **SockJS + STOMP**, quan sát thấy **hai** socket sportsbook chạy
  song song:
  - `wss://d43.sb21.net/sport/396/5usiwmpp/websocket` — 420 frame, **4.9 MB**
  - `wss://two.sb21.net/sport/306/vmamejlu/websocket` — 290 frame, 218 KB
- Hai destination STOMP xác nhận được:
  - `/topic/sports/1_11/today/ma/event/vi`, subscription `subSportHotMatch`
  - `/topic/sports/1_1/live/ma/event/vi`, subscription `subSportBookLive`
- **Nhiễu cần loại bỏ:** `novoga.sb21.net/` và `novoba.sb21.net/` (Volta). Chúng
  không có path `/sport/`. `novoga` bùng nổ **871 frame trong một bucket 15 s** —
  nếu lọc sai, đây là nguồn gây storm và ăn hết ngân sách bộ nhớ.
- Predicate `isKsportCatalogSocket` (`network-observer.ts:34`) yêu cầu
  `wss:` + host `*.sb21.net` + path bắt đầu `/sport/`. **Predicate này đúng** với
  cả hai socket thật và loại đúng Volta.
- **Vấn đề chưa giải quyết:** có hai socket `/sport/` cùng lúc trên hai host khác
  nhau. Adapter phải quyết định socket nào là authority, hoặc gộp cả hai. Đây là
  điều cần điều tra, không được đoán.
- Frame là **full snapshot lặp lại**, không phải delta: quan sát 5 bản tin liên
  tiếp có cùng `content-length:6316` và cùng phần đầu body, chỉ khác `message-id`
  (`45441743`, `45441745`, `45441746`, `45441749`, `45441752`). Logic dedupe phải
  so sánh **nội dung**, không so `message-id`.

### APSPORT/TSPORT — trang `pacific.agenate.com`, socket `spws.agenate.com`

- **Một WebSocket riêng cho mỗi môn thể thao.** Quan sát 6 socket đồng thời:

| Socket path | `s` | Frame / 150 s | Payload phân biệt |
|---|---:|---:|---:|
| `/ln/en/p/1/u/<hash>/s/6/mg/0/tr/0` | 6 | 557 | 389 |
| `/ln/en/p/1/u/<hash>/s/1/mg/0/tr/0` | **1** | **346** | 244 |
| `/ln/en/p/1/u/<hash>/s/97/mg/0/tr/0` | 97 | 316 | 301 |
| `/ln/en/p/1/u/<hash>/s/2/mg/0/tr/0` | 2 | 289 | 214 |
| `/ln/en/p/1/u/<hash>/s/4/mg/0/tr/0` | 4 | 46 | 37 |
| `/ln/en/p/1/u/<hash>/s/5/mg/0/tr/0` | 5 | 35 | 34 |

- Bản tin: `{"s":<sportId>,"t":"eu","tmrg":"0","d":"<JSON chuỗi hóa>"}`.
  Trường `d` là JSON **được escape trong chuỗi**, bên trong dùng khóa số:
  `{"0":sportId,"1":leagueId,"2":eventId,"4":homeId,"5":homeName,...,"10":"Active","11":kickoffISO,"21":awayId,"22":awayName}`.
- **`s:1` là bóng đá** (mẫu chứa `Manchester City Fc`). `s:2` bóng rổ,
  `s:97` là giải ảo (`Chelsea (V)`, `Napoli (V)`) — **phải loại**.
- Predicate `isTsportEventSocket` (`network-observer.ts:62`) chỉ nhận
  `/s/1/mg/0/tr/0`. **Đúng** — nhưng cần xác nhận nó không bỏ sót socket bóng đá
  thứ hai nếu provider mở lại kết nối với path khác.
- Socket bóng đá phát ~2.3 frame/s liên tục suốt 150 s, không hề đứt.

### IM — `imsports.directsb.net`

- **Không có WebSocket. Và không có HTTP nào sau 15 giây đầu.**
- Toàn bộ 11 request đều nằm trong bucket 0:

| Path | Số lần |
|---|---:|
| `/api/HomeV6/GetSM` | 3 |
| `/api/HomeV6/GetSP` | 1 |
| `/api/EventV6/GetFEC` | 1 |
| `/api/EventV6/GetBtgC` | 1 |
| `/api/AnnouncementV6/GetScrollingAnnouncement` | 1 |
| `/` (document) | 1 |

- **`GetSE` — endpoint mà adapter đang đọc — không hề xuất hiện.** Trang landing
  mặc định không mở view bóng đá.
- **Kết luận: IM hoàn toàn không tự cập nhật.** Feed IM chỉ tồn tại nếu extension
  chủ động ký và gửi request `GetSE` trong trang. Hiện extension làm việc đó mỗi
  15 giây (`imDiscoveryIntervalMs`), trong khi `maxBaselineAgeMs` là 25 giây.
- Đây là provider mong manh nhất: không có nguồn đẩy nào để tự phục hồi.

### BTI — `prod20091.fxf774.com`

- **Không có WebSocket.** HTTP polling do trang thực hiện.

| Path | Số lần | Bucket (giây) |
|---|---:|---|
| `/trpc/getLoginStatus` | 14 | đều, ~10 s |
| `/api/sportscenter/carousels/featured-matches/markets` | 10 | 0,15,30,45,60,75,90,120,135,150 |
| **`/api/eventlist/asia/leagues/v2/1/live`** | **9** | **0,15,30,45,60,90,105,120,135** |
| `/api/eventlist/asia/market/getMarketsAvailabilityForEvent` | 9 | 0,15,30,45,60,90,105,120,135 |
| `/api/betslip/bets/updates` | 9 | 15…135 |

- `leagues/v2/1/live` là danh sách trận bóng đá live. Cadence ~15 s **nhưng có
  khoảng trống 30 s** giữa bucket 60 và 90.
- `getLoginStatus` và `betslip/*` là nhiễu auth/phiếu cược — **không được** tính
  là bằng chứng catalog còn sống. Code hiện đã tách đúng điểm này; giữ nguyên.
- `maxBaselineAgeMs = 30_000` vừa khít với khoảng trống 30 s đo được → không có
  biên an toàn.

---

## Những điều đã xác nhận là ĐÚNG trong code hiện tại

Không được sửa những chỗ này nếu không có bằng chứng mới:

1. `isKsportCatalogSocket` lọc đúng: nhận `/sport/` trên `*.sb21.net`, loại Volta.
2. `isTsportEventSocket` lọc đúng `s/1` = bóng đá, loại `s/97` giải ảo.
3. `lobby-signatures.ts` map đúng cả 6 host trong `sảnh.md`.
4. BTI tách heartbeat/analytics khỏi bằng chứng catalog — đúng.
5. Nguyên tắc fail-closed và không reload tab provider — giữ.

## Những điều đã xác nhận là SAI hoặc thiếu

1. **Policy cadence của CMD, IM, BTI chặt hơn cadence thật của provider.**
2. **Không có công cụ nào cho biết pipeline chết ở chặng nào.** Tám chặng, mỗi
   chặng nhiều nhánh fail-closed, không có một endpoint chẩn đoán duy nhất.
3. **Mọi lỗi refresh trong extension bị nuốt bằng `.catch(() => undefined)`** —
   `cmd-snapshot-poller.ts` dòng 137, 156, 173, 211, 230. Không đếm, không log,
   không báo. Treadmill ngừng đạp mà không ai biết.
4. **Guard `#catalogRefreshInFlight` / `#maintenanceInFlight` / `#inFlight` không
   có timeout.** Chúng chỉ được xóa trong `.finally()`. Một promise treo là khóa
   vĩnh viễn provider đó — khớp chính xác với triệu chứng "chỉ chạy lúc đầu".
5. **`runtimeVerdict()` trong `provider-runtime-sampler.mjs` không yêu cầu giá
   đổi.** Nó ghi `quoteChanges[]` rồi bỏ qua. PASS bằng cờ, không bằng dữ liệu.
6. **42 MB capture thật trong `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures\`
   không được test nào sử dụng.** Toàn bộ 2555 test dùng envelope viết tay.
7. **Vòng recovery legacy Playwright/Fabet chạy 1 Hz** và spam
   `AUTH_EGRESS_UNAVAILABLE` / `FABET_AUTH_ROOT_NAVIGATION_FAILED` vô hạn.

## Trạng thái hệ thống lúc đo

- `npm test`: **2555/2555 pass**. `npm run typecheck`: 6/6 workspace pass.
- `GET /api/chrome-bridge/sources` → `{"sources":[]}` (không source nào gắn).
- `GET /api/catalog/sources` → cả 6 đều `ACTION_REQUIRED / PROVIDER_VALIDATION_FAILED`.

Test xanh tuyệt đối trong khi sản phẩm chết hoàn toàn. Đó là bằng chứng mạnh nhất
cho thấy bộ test hiện tại không đo thứ cần đo.
