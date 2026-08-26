# Bridge deadlock — vì sao cả 6 sàn chết qua đêm

> Chẩn đoán + fix ngày 2026-08-26, phiên Opus. Đo trên runtime thật.

## Triệu chứng

Chạy đêm, sáng dậy `quoteChanges60s = 0` trên mọi sàn. `/api/chrome-bridge/sources`
trả về `[]` hoặc toàn bộ source `STALE` với `lastAcceptedAtMs` dừng **cùng một
thời điểm trong vòng 3 giây**. API vẫn sống, `/api/health` vẫn trả lời.

Sáu source dừng đồng thời ⇒ không phải lỗi từng provider. Cầu nối
extension → API đứt, và **không bao giờ tự nối lại**.

## Nguyên nhân 1 — `BridgeWakeup.wakeNow()` latch vĩnh viễn

`wakeNow()` giữ `#wakeInFlight` để chống chạy chồng. Latch chỉ được xoá trong
`.finally()` của chính operation đó:

```ts
if (this.#wakeInFlight !== null) return this.#wakeInFlight;
```

Operation gọi `ensureAttached()` → `reattachPreferredTabs()` →
`sourceTabKeepAlive.pulse()` → `chrome.debugger.sendCommand()`. Lệnh debugger
gửi vào một tab **không phản hồi thì không bao giờ settle** — không timeout,
không reject.

Hệ quả: alarm 30 giây vẫn nổ đều, nhưng mọi lần gọi `wakeNow()` chỉ trả lại
đúng cái promise đang treo. `ensureBridgeConnected()` không bao giờ được gọi
lần nữa. Service worker còn sống nhưng **câm vĩnh viễn** cho tới khi có người
bấm reload extension.

Đây là lời giải cho "chạy được rồi sáng ra chết sạch".

**Fix:** `wakeNow()` chạy đua operation với deadline 20 giây (ngắn hơn chu kỳ
alarm 30 giây) và xoá latch khi bên nào xong trước. Công việc treo vẫn treo —
CDP không huỷ được — nhưng alarm kế tiếp lại thử được.

Test: `keeps waking on later alarms after a wake hangs forever`.
RED đúng lý do — `ensureConnected` gọi 1 lần thay vì 2.

## Nguyên nhân 2 — `HARD_RECOVERY` là absorbing state

`ProviderFeedController.sweep()`:

```ts
if (["STARTING", "SYNCING", "STALLED", "LIVE"].includes(this.#state)) { ...SOFT... }
if (this.#state !== "SOFT_RECOVERY" || ...) return null;   // ← HARD_RECOVERY rơi vào đây
```

`HARD_RECOVERY` không nằm trong danh sách đầu, và nhánh sau đòi đúng
`SOFT_RECOVERY`. Vào `HARD_RECOVERY` mà lần recovery đó hỏng thì **không bao giờ
xin recovery lần nữa** — đứng đó tới khi restart API.

Bằng chứng live trước fix: SBOBET và APSPORT có `recoveryAttempt` đứng im ở `2`,
`nextAttemptInMs: 0`, suốt nhiều giờ.

**Fix:** cho `HARD_RECOVERY` xin lại mỗi `recoveryCooldownMs`. Rate-limit đã có
sẵn hai lớp: cooldown 30 giây của controller và exponential backoff
1 s → 300 s của `AutomaticSourceRecovery`.

Test: `keeps retrying the hard stage once each cooldown while the source stays dead`
và `leaves the hard stage as soon as a fresh baseline arrives`.

## Nguyên nhân 3 — SBOBET không có đường recovery nào

`AutomaticSourceRecovery.#hardRecover()` gate nhánh `reloadSource` /
`reloadRecoverySource` bằng:

```ts
if ((source.provider === "SABA" || source.provider === "APSPORT") && ...)
```

Đây là nhánh **duy nhất** không cần `browserRefreshEnabled`. Live stack ép
`SESSION_MAINTENANCE_ENABLED=0` (`scripts/live-stack-config.mjs`), nên
`browserRefreshEnabled = false` và mọi nhánh còn lại trả về ngay
`ACTION_REQUIRED / BROWSER_REFRESH_DISABLED`.

SBOBET không nằm trong allowlist ⇒ không có hành động recovery nào cả.

**Fix:** đổi thành `WEBSOCKET_PROVIDERS = {SABA, SBOBET, APSPORT}` — đúng nhóm
provider có bệnh pre-existing socket. CMD/IM/BTI là HTTP, không đụng tới.

Test: thêm SBOBET vào bảng `it.each` sẵn có, cộng
`still rebuilds the %s tab when browser refresh is disabled` cho cả ba.

## Đo trên runtime thật, build `sha256:056034e8`

| Lobby | trước | t+45s | t+90s | t+135s |
|---|---|---|---|---|
| CMD | source mất, catalog cũ 5.5 h | LIVE d60=32 | LIVE d60=90 | LIVE d60=44 |
| IM | LIVE d60=23 | LIVE d60=8 | LIVE d60=36 | LIVE d60=26 |
| SABA | LIVE d60=50 | LIVE d60=24 | LIVE d60=48 | LIVE d60=40 |
| SBOBET | HARD att=2 đứng im | att=2 | att=3 | att=5 |
| APSPORT | HARD att=2, WS=0, 5.8 h cũ | WS=131 | WS=780 dec=1 | **WS=1388 dec=35 d60=44** |
| BTI | LIVE d60=234 | LIVE d60=131 | LIVE d60=185 | LIVE d60=215 |

CMD sống lại, APSPORT sống lại từ WS 0. SBOBET `recoveryAttempt` chạy tiếp
thay vì đóng băng — chứng minh fix 2 và 3 có tác dụng.

Sau đó bridge sập (nguyên nhân 1) và kéo cả 6 xuống. Fix 1 chỉ có hiệu lực sau
khi **build lại extension và reload nó trong Chrome**.

## Còn lại — SBOBET/KSPORT vẫn 0 WS frame

Khác hẳn hai lỗi trên, đây là vấn đề riêng và chưa giải được:

```
wsAttach: { webSocketCreated: 0, webSockets: 0, ksportTargets: 0, attachedTargets: 0 }
```

Socket catalog nằm trong OOPIF `*.sb21.net`. `Target.getTargets` **không trả về
iframe đó**, nên `Target.attachToTarget` không có gì để gắn. Reload tab không
cứu được: epoch đã nhảy `:4 → :32` (tab reload liên tục) mà `WS_FRAME` vẫn 0.

Phiên trước đã thử 5 giả thuyết trong `fix-ws-attach.md` và dừng ở
`NO_NEW_KT_PROGRESS_60M`. Hướng chưa thử: `Target.setAutoAttach` với
`flatten: true` ở **cấp browser** thay vì cấp tab, hoặc
`Target.setDiscoverTargets` để thấy target trước khi nó tạo socket.

## Không phải nguyên nhân

- Adapter decode sai — `decoded` tăng bình thường khi có frame.
- Policy quá chặt — đã nới theo số đo `00-EVIDENCE.md`, CMD/IM/BTI giữ LIVE ổn định.
- `emulateNetworkConditions` — đã bị gỡ khỏi source và test đảo lại thành
  `.toBe(false)`; cơ chế hiện hành là `Runtime.evaluate` trên prototype socket.
  TSPORT có nhánh `return` sớm nên soft recovery của nó là no-op, phải dựa hoàn
  toàn vào `reloadSource` ở API.
