# WORKER APSPORT / TSPORT

Đọc bắt buộc theo thứ tự: `00-EVIDENCE.md` → `01-BASE.md` → file này.
Repo root `F:\0. PROJECT\tool-chenh`. Không worktree. Không build, không restart.

## Mapping

- Account: `catalog-source:APSPORT:FOOTBALL` · Lobby: **`TSPORT`** · Source: `chrome:TSPORT:<tabId>`
- Tab: `pacific.agenate.com`
- Transport: **WebSocket JSON**, `wss://spws.agenate.com/...`

## Whitelist file được sửa

- `apps/api/src/chrome-bridge/tsport-ws-adapter.ts` + test
- `apps/api/src/chrome-bridge/tsport-authority-assembler.ts` + test
- `apps/chrome-extension/src/tsport-dom-snapshot.ts` + test
- Report riêng: `docs/superpowers/reports/realtime/apsport.md`
- Evidence bị ignore: `.run/realtime/apsport/*`

## Ground truth đã đo (2026-08-25, 150 giây)

**Provider khỏe mạnh, phát liên tục không đứt. Vấn đề nằm ở phía chúng ta.**

### Một WebSocket riêng cho mỗi môn thể thao

| Socket path | `s` | Frame / 150 s | Payload phân biệt | Môn |
|---|---:|---:|---:|---|
| `/ln/en/p/1/u/<hash>/s/6/mg/0/tr/0` | 6 | 557 | 389 | — |
| **`/ln/en/p/1/u/<hash>/s/1/mg/0/tr/0`** | **1** | **346** | **244** | **Bóng đá** |
| `/ln/en/p/1/u/<hash>/s/97/mg/0/tr/0` | 97 | 316 | 301 | **Giải ảo — phải loại** |
| `/ln/en/p/1/u/<hash>/s/2/mg/0/tr/0` | 2 | 289 | 214 | Bóng rổ |
| `/ln/en/p/1/u/<hash>/s/4/mg/0/tr/0` | 4 | 46 | 37 | — |
| `/ln/en/p/1/u/<hash>/s/5/mg/0/tr/0` | 5 | 35 | 34 | — |

Socket bóng đá phát ~2.3 frame/s **liên tục suốt 150 giây, không hề đứt**.

### Cấu trúc bản tin

```json
{"s":1,"t":"eu","tmrg":"0","d":"{\"0\":1,\"1\":1204,\"2\":5669909,\"4\":117105,
 \"5\":\"Manchester City Fc (jose)\",\"6\":true,\"7\":true,\"8\":false,\"9\":false,
 \"10\":\"Active\",\"11\":\"2026-08-25T08:28:00Z\",\"14\":3,\"15\":2,\"19\":60000,
 \"20\":8,\"21\":74993,\"22\":\"Bournemouth ...\"}"}
```

- `s` = sportId, khớp với `/s/<n>/` trong URL socket.
- `d` là **JSON được chuỗi hóa lồng trong JSON** — phải parse hai lần.
- Khóa số bên trong: `0` sportId, `1` leagueId, `2` eventId, `4` homeId,
  `5` homeName, `10` trạng thái (`"Active"`), `11` giờ bắt đầu ISO,
  `21` awayId, `22` awayName.
- Nhận diện giải ảo: mẫu `s:97` có tên đội `"Chelsea (V)"`, `"Napoli (V)"`.
  **Không được để lọt vào catalog bóng đá.**

### Predicate hiện tại là ĐÚNG

`isTsportEventSocket` (`network-observer.ts:62`) khớp
`wss://spws.(agenate|racern).com` + path `/ln/<lang>/(p/1/u/<hash>/)?s/1/mg/0/tr/0`.
Đã kiểm chứng: nhận đúng socket bóng đá, loại đúng `s/97`. **Không sửa** trừ khi
có bằng chứng provider mở socket bóng đá với path khác.

## Trạng thái live đo lúc 20:35 ngày 2026-08-25

- `sources`: `chrome:TSPORT:2105815593`, `state: LIVE`, `authorityDisposition: CANDIDATE`.
- `HOP3.byTransport`: `WS_FRAME: 0`, `DOM_SNAPSHOT: 25`, `TAB_STATE: 61`.
  **DOM sweep có chạy, nhưng không frame WebSocket nào tới bridge.**
- `HOP6`: `HARD_RECOVERY`, `HOP8.quoteChanges60s: 0`.
- `HOP1_TAB` null là bẫy telemetry (xem `01-BASE.md`), không phải chặng hỏng.

Chặng hỏng thật là **HOP3**, không phải H1. Trước khi động tới tập DOM mong đợi,
phải giải thích được vì sao socket `s/1` không sinh envelope nào. Nếu nguyên nhân
nằm ở observer/attach thì đó là **ngoài whitelist** → `SHARED_REQUEST`, DỪNG.

## Giả thuyết xếp theo mức khả tín

**H1 — Authority kẹt ở `CANDIDATE` vì đòi DOM sweep phủ đủ.**
Đây là lỗi đã ghi nhận: "bridge LIVE nhưng authority vẫn CANDIDATE, catalog stale".
Adapter chỉ phát `BASELINE` khi WS phủ **toàn bộ** tập event mà DOM sweep nói là
mong đợi. Nếu DOM sweep liệt kê cả trận mà socket bóng đá không phát (ví dụ trận
ở tab thời gian khác, hoặc trận giải ảo lọt vào DOM), điều kiện phủ đủ **không
bao giờ** đạt và authority kẹt vĩnh viễn. Đây là giả thuyết mạnh nhất.

**H2 — DOM sweep bơm bootstrap chỉ chạy 3 lần rồi thôi.**
`cmd-snapshot-poller.ts` cho TSPORT một cửa sổ bootstrap `TSPORT_BOOTSTRAP_REFRESH_ATTEMPTS = 3`
cách nhau 10 giây, sau đó `catalogRefreshIntervalMs` trả `null` — **không còn
refresh định kỳ nào nữa**. Nếu ba lần đó rơi vào lúc trang chưa render xong thì
TSPORT không bao giờ có sweep hợp lệ. Kiểm tra tỉ lệ sweep thành công.

**H3 — Sáu socket cùng lúc, epoch bị lẫn.**
Provider mở 6 socket đồng thời. Nếu logic epoch/stream không phân biệt theo
sportId, một `OPEN` của socket bóng rổ có thể làm mất hiệu lực authority của socket
bóng đá. Xác nhận adapter chỉ nhận frame từ socket đã lọc `s/1`.

**H4 — Giải ảo lọt vào qua DOM.**
Predicate socket lọc `s/97` rất tốt, nhưng DOM sweep quét trang có thể vẫn nhặt
trận ảo. Nếu tập mong đợi chứa trận ảo mà WS bóng đá không bao giờ phát, quay lại
đúng H1. Kiểm tra bộ lọc virtual trong `tsport-dom-snapshot.ts`.

## Bước điều tra bắt buộc

0. **GATE 0 — `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`.**
   Không có source `chrome:TSPORT:*` → ghi `BLOCKED_ENV` + output rồi DỪNG. Cấm
   diag dài, cấm RED, cấm sửa code. Xem mục GATE 0 trong `01-BASE.md`.

1. **INVESTIGATED — không mở Chrome mới.**
   CẤM `scripts/recon-provider-realtime.mjs`. Dùng `00-EVIDENCE.md` (6 socket,
   bóng đá `s/1`, loại `s/97`) + capture có sẵn. Chỉ
   `record-capture.mjs --provider APSPORT` nếu CDP `9333` đã sẵn (attach, không
   launch).

2. `node scripts/diag-pipeline.mjs APSPORT 180` — ghi `firstFailingHop` và detail.
   **Không** coi số bước trong file này mâu thuẫn với prompt tab: diag chạy trước.

3. **So sánh tập hợp — phép đo quyết định cho H1**, sau khi có diag (hoặc song song
   từ capture có sẵn / code path, không spawn Chrome): tập eventId DOM mong đợi vs
   tập `s/1` thực phát. Nếu mong đợi lớn hơn thật → H1; fix cách dựng tập mong đợi,
   **không** nới điều kiện phủ. Không reload tab.

4. Một RED tái hiện đúng chặng hỏng, dùng `replay-capture.mjs` với capture thật.

5. Fix tối thiểu → test focused → typecheck → replay
   `--assert-semantic-changes 10` (cadence rất dày, 10 là hợp lý).

6. Báo `LOCAL_GREEN APSPORT` và dừng. Nếu diag xanh + HOP8 đổi giá + replay pass
   mà không cần sửa code: `LOCAL_GREEN APSPORT — NO_CODE_CHANGE`.

## Nghiệm thu riêng của APSPORT

- SLA đề xuất dựa trên cadence ~2.3 frame/s: **p95 <= 5 giây**.
- Bắt buộc chứng minh **không có trận giải ảo nào** trong catalog bóng đá. Liệt kê
  tên đội và xác nhận không có hậu tố `(V)`.
- Bắt buộc chứng minh authority chuyển từ `CANDIDATE` sang `ACTIVE` và **giữ**
  `ACTIVE` liên tục 10 phút, kèm số liệu tập mong đợi so với tập thực phát.
- Chứng minh một lần socket bóng đá đóng và mở lại mà authority phục hồi,
  **không reload tab**.
