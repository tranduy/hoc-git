# FIX — KSPORT và TSPORT không nhận được frame WebSocket

> Opus chẩn đoán từ code + số đo live lúc 01:24 ngày 2026-08-26.
> Một worker duy nhất làm file này. Repo root `F:\0. PROJECT\tool-chenh`, không worktree.

## Số đo live — đây là sự thật, không đo lại để tranh cãi

| Lobby | HOP3 byTransport | HOP4 | HOP5 | quoteChanges60s |
|---|---|---|---|---|
| KSPORT | `WS_FRAME: 0`, `TAB_STATE: 134` | `decoded 0`, `ignored 0` | `NONE` | 0 |
| TSPORT | `WS_FRAME: 0`, `DOM_SNAPSHOT: 22`, `TAB_STATE: 60` | `decoded 0`, `ignored 22` | `ACTIVE` | 0 |

Bốn sàn còn lại đang chạy thật: CMD 418, IM 149, SABA 333, BTI 481.

**Kết luận: đây KHÔNG phải lỗi giải mã adapter.** `HOP4` bị đổ lỗi oan vì
`decoded = 0`, nhưng nguyên nhân là **không có frame nào để giải mã**.

Lưu ý chẩn đoán sai lệch: `HOP3` vẫn báo `ok` vì nó chỉ nhìn `lastEnvelopeAgeMs`,
mà `TAB_STATE` thì vẫn chảy đều. Envelope `TAB_STATE` không mang odds.

## Nguyên nhân gốc

Chrome **không phát lại** `Network.webSocketCreated` cho socket đã mở **trước khi**
`Network.enable` được gọi. Extension gắn `chrome.debugger` vào tab đã đăng nhập sẵn,
nên mọi socket có từ trước là vô hình vĩnh viễn — không có `OPEN`, không có frame.

Bằng chứng trong code:

```1133:1136:apps/chrome-extension/src/network-observer.ts
    if (source.lobby === "KSPORT") {
      await this.#discoverExistingKsportChildTargets(source);
    }
```

- Việc dò target/socket đã tồn tại **chỉ chạy cho KSPORT**. `TSPORT` và `SABA`
  không có nhánh nào tương đương.
- Cơ chế `#scheduleKsportPreexistingSocketReconnect` (dòng 2135-2146) chỉ được kích
  hoạt từ `#observeChildTarget` khi `watchPreexistingSocket === true` **và**
  `targetId !== undefined` **và** `source.lobby === "KSPORT"` (dòng 2103-2108).
- Nhánh phục hồi `#requestFreshSocketBaseline` tìm socket trong `#webSockets`
  (dòng 2190-2195). Với socket có từ trước, map đó **rỗng**, nên nó không có gì để
  thao tác.

Vì sao SABA vẫn sống: socket.io tự reconnect theo `pingTimeout`, sinh socket **mới**
sau khi đã gắn. TSPORT trước đó có 7167 frame cũng vì tab lúc ấy mở sau khi gắn.
Tab hiện tại là tab mới (`chrome:KSPORT:2105816097`, `chrome:TSPORT:2105816103`)
gắn muộn, nên cả hai về 0.

## Cách sửa — dùng CDP ép socket tái lập, KHÔNG reload tab

Cách đáng tin nhất là bắt chính Chrome ngắt kết nối của target đó trong chốc lát,
để ứng dụng trong trang tự reconnect và sinh `webSocketCreated` mà CDP theo dõi được:

```
Network.emulateNetworkConditions { offline: true,  latency: 0, downloadThroughput: 0, uploadThroughput: 0 }
   ... chờ ~1200 ms ...
Network.emulateNetworkConditions { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
```

Áp trên **đúng session sở hữu socket**: session con của OOPIF với KSPORT, session
gốc của tab với TSPORT. Không reload, không điều hướng, không đóng tab, không đụng
tới 4 sàn đang chạy.

## Task bắt buộc, làm đúng thứ tự

### T1 — Đo trước, cấm đoán

Thêm bộ đếm tạm (xoá sau khi xong, hoặc giữ dưới dạng telemetry gọn) trả lời bằng số:

1. Sau khi gắn, có nhận được `Network.webSocketCreated` nào cho KSPORT / TSPORT không?
2. `Target.getTargets` với KSPORT có trả về iframe `*.sb21.net` không? Bao nhiêu cái,
   `Target.attachToTarget` có ra `sessionId` không?
3. `#webSockets` có bao nhiêu entry cho mỗi source sau 60 giây?

Ghi vào `docs/superpowers/reports/realtime/fix-ws-attach.md`.

### T2 — RED

Test phải đỏ **đúng lý do**: observer gắn vào tab đã có socket từ trước
(không có event `webSocketCreated` nào được phát) thì hiện tại không bao giờ
sinh envelope `WS_FRAME`, và cũng không có cơ chế nào ép socket tái lập cho TSPORT.

Viết cho cả hai lobby: `KSPORT` và `TSPORT`.

### T3 — Fix

Tổng quát hoá cơ chế hiện có, không viết lại kiến trúc:

1. Đổi tên khái niệm `ksportPreexistingSocketReconnect` thành dạng dùng chung theo
   lobby, giữ nguyên hành vi cũ của KSPORT.
2. Kích hoạt watchdog cho **KSPORT, TSPORT, SABA** ngay trong `start()` sau
   `Network.enable`, không phụ thuộc vào việc có child target hay không.
3. Điều kiện kích hoạt: sau `PREEXISTING_SOCKET_GRACE_MS` (đề xuất 8000 ms) mà
   **chưa có envelope `WS_FRAME` nào** được forward cho source đó thì chạy chu trình
   `emulateNetworkConditions` offline → online ở trên.
4. Áp trên session đúng: KSPORT dùng session con OOPIF nếu đã gắn được, không có thì
   dùng session gốc; TSPORT và SABA dùng session gốc.
5. Có backoff: lần 1 sau 8 giây, sau đó 30 giây, 60 giây, tối đa 5 lần cho mỗi
   `sourceGeneration`. Reset bộ đếm ngay khi có frame `WS_FRAME` đầu tiên.
6. Bắt buộc dừng khi đã có frame: gọi `#clearPreexistingSocketReconnect` trong đúng
   chỗ đang đặt cho KSPORT (dòng 3800 và 2870).

### T4 — Sửa chẩn đoán gây hiểu nhầm

`HOP3` không được coi là `ok` khi chỉ có `TAB_STATE`. Với provider dùng WebSocket
(SABA, SBOBET/KSPORT, APSPORT/TSPORT), `HOP3.ok` phải đòi có `WS_FRAME` trong cửa sổ;
với provider HTTP (CMD, IM, BTI) phải đòi `HTTP_RESPONSE`. File:
`apps/api/src/diagnostics/pipeline-telemetry.ts` quanh dòng 274-278. Có test đi kèm.

### T5 — Ngõ cụt của adapter TSPORT, làm sau khi frame đã về

Khi frame WS quay lại, TSPORT sẽ đệm chờ proof DOM. Nếu vượt
`MAX_PENDING_PRE_PROOF_RECORDS = 5_000` thì stream bị xoá:

```542:546:apps/api/src/chrome-bridge/tsport-ws-adapter.ts
    if (!current.proofReady && !current.records.has(incoming.eventId) &&
      current.records.size >= MAX_PENDING_PRE_PROOF_RECORDS) {
      this.#currentStreams.delete(envelope.sourceId);
      return [];
    }
```

Nhưng `streamId` vẫn nằm trong `#seenStreamIds`, nên frame kế tiếp bị chặn vĩnh viễn:

```507:508:apps/api/src/chrome-bridge/tsport-ws-adapter.ts
      const seenStreamIds = this.#seenStreamIds.get(lifecycleKey) ?? new Set<string>();
      if (seenStreamIds.has(streamId)) return [];
```

Fix: khi xoá stream vì tràn bộ đệm, phải xoá luôn `streamId` khỏi `#seenStreamIds`
(và `#lastOpenSequences` tương ứng) để frame sau dựng lại được stream. Hoặc thay bằng
evict bản ghi cũ nhất. Cách nào cũng phải có test chứng minh không rò rỉ bộ nhớ.

## Nghiệm thu

Sau mỗi lần deploy, dán bảng 6 sàn từ `/api/diag/pipeline`.

- **Bắt buộc không hồi quy:** CMD, IM, SABA, BTI phải giữ `quoteChanges60s > 0`.
  Sàn nào tụt thì revert ngay.
- KSPORT và TSPORT phải có `WS_FRAME > 0` trước, rồi mới tới `decoded > 0`,
  rồi mới tới `quoteChanges60s > 0`.
- Đạt rồi thì chạy `diag-pipeline <X> 600`, cần `>= 8/10` cửa sổ 60 giây có
  `quoteChanges60s > 0`, ghi `PROVISIONAL_ACCEPTANCE`, rồi `diag-pipeline <X> 1800`
  và ghi `READY_FOR_24H_SOAK`.

## Quy trình deploy

```powershell
npm.cmd run build
node scripts/restart-live-stack.mjs
```

Lease bận thì chờ 60 giây thử lại. Gặp `STACK_INSTANCE_DISCOVERY_UNAVAILABLE` thì chạy
`node scripts/exact-v2-stack-handoff.mjs` rồi thử lại. Fix nằm ở extension thì phải
reload extension. Sau restart, `curl.exe -s http://127.0.0.1:4310/api/chrome-bridge/sources`
phải trả đủ 6 lobby.

## Cấm

Reload / điều hướng / focus / đóng tab sàn. Spawn Chrome hoặc Playwright. Chạy
`scripts/recon-provider-realtime.mjs`. Nới predicate `isKsportCatalogSocket` để lọt
Volta (`novoga`, `novoba`). Sửa adapter của CMD, IM, BTI, SABA. Git commit hoặc push.
Ghi `DONE`. Dán output bịa.
