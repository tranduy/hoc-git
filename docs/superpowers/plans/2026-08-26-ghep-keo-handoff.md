# Bàn giao — Ghép trận & so kèo (đo ngày 2026-08-26)

> Người nhận: phiên làm việc riêng về **ghép kèo**.
> Song song có một phiên khác đang làm **socket realtime SABA/SBOBET** — không đụng
> vào `*-ws-adapter.ts`, `network-observer.ts`, `ksport-recovery-generation.ts`.

---

## 1. Thước đo duy nhất được chấp nhận

**Không** dùng "số trận ghép được" (`matchedEvents`) làm thành tích. Trận ghép được
mà không có vé nào so được thì vô giá trị — đã xảy ra: SABA ghép 19 trận với CMD,
đẻ ra **0** dòng kèo.

Chỉ số phải báo là **`crossBookRows`** — số dòng có vé của từ 2 sàn trở lên.

Phép thử bắt buộc trước khi tuyên bố bất cứ điều gì: **bỏ tick IM và CMD trên
dashboard**, xem còn lại bao nhiêu dòng kèo. Đây là phép thử do chủ sản phẩm đặt ra.

Script đo (tạo tạm trong `apps/web/src/catalog/`, xoá sau khi dùng):

```ts
import { buildComparisonEvents } from "./comparison.js";
// nạp /api/catalog/accounts/catalog-source:<P>:FOOTBALL cho 6 sàn
const multi = buildComparisonEvents(catalogs).filter((e) => e.providers.length > 1);
const rows = multi.reduce((n, e) => n + e.rows.filter((r) => r.crossBook).length, 0);
```

## 2. Hiện trạng đo được

```
CẢ 6 SÀN         74 trận ghép    144 dòng kèo
BỎ IM+CMD         2 trận ghép      0 dòng kèo
SABA+CMD         16 trận ghép      0 dòng kèo
```

Phân rã theo cặp sàn:

```
CMD+IM 67 · CMD+SABA 16 · IM+SABA 10 · BTI+CMD 5 · BTI+IM 5 · BTI+SABA 2
```

Nguồn dữ liệu mỗi sàn:

```
CMD  116 trận  FRESH   HTTP        IM   168 trận  FRESH   HTTP
SABA 270 trận  FRESH   WS + DOM    BTI   34 trận  FRESH   HTTP
APSPORT  dao động, có lúc 0-6 trận
SBOBET   chưa chạy (socket không mang catalog)
```

## 3. Đã sửa — đừng làm lại

| Việc | File | Kết quả đo |
|---|---|---|
| CMD phát trùng mỗi trận 2 `providerEventId`, guard `ambiguous` loại 72/161 trận | `catalog-part-merge.ts` `collapseDuplicates` | CMD 161→116 trận, 0 trùng |
| Tên giải mỗi sàn một kiểu, chặn ghép trận live | `comparison.ts` `learnCompetitionLinks` | liên kết 34 cặp giải từ ≥2 trận chung |
| Vé lệch pha với trận sở hữu nó → bộ so kèo vứt sạch vé | `catalog-part-merge.ts` `withAlignedQuotePhase` | SABA lệch pha 1036→0, vé dùng được 984→2834 |

### `learnCompetitionLinks` — cơ chế và ranh giới

Hai giải ở hai sàn khác nhau được coi là một **khi và chỉ khi** chúng có **≥2 trận
trùng khớp chính xác** (cùng cặp đội sau chuẩn hoá). Bằng chứng quan sát được, không
phụ thuộc ngôn ngữ, tự bảo trì.

```
CMD:japan emperor cup   <->  SABA:cup thien hoang nhat ban   (8 trận chung)
CMD:english league cup  <->  IM:england league cup           (4 trận chung)
```

**Không hạ ngưỡng xuống 1 trận chung.** 41 cặp giải hiện chỉ có 1 trận chung và cố ý
để không liên kết (fail-closed).

## 4. Bốn cái bẫy đã trả giá — đọc trước khi sửa

**Bẫy 1 — Đừng gộp hai bản ghi cùng cặp đội trong một sàn.**
SABA phát hai bản ghi cho cùng cặp đội, **không phải cùng một trận**:

```
132738359  "CÚP THIÊN HOÀNG NHẬT BẢN"                                  isLive=true   CÓ kèo
133254857  "JAPAN EMPEROR CUP - WHICH TEAM WILL ADVANCE TO NEXT ROUND"  isLive=false  KHÔNG kèo
```

Cái thứ hai là kèo phụ *"đội nào đi tiếp"*. Gộp lại là ghép nhầm hai sản phẩm cược.
Đã thử và đã gỡ bỏ. `collapseDuplicateEvents` chỉ bật cho **CMD**, và định danh của
nó **có** tính cả `competition` và `isLive` — giữ nguyên như vậy.

**Bẫy 2 — `isLive` của trận và của vé phải luôn bằng nhau.**
`comparison.ts` lọc `quote.isLive === group.event.isLive`. Lệch một cái là mất toàn
bộ vé của trận đó mà không có lỗi nào hiện ra. Mọi đường ghép catalog phải đi qua
`withAlignedQuotePhase`.

**Bẫy 3 — Trộn live với pre-match là cấm.**
Bẫy số 6 trong `HUONG-DAN-KY-THUAT.md`. Đừng nới `compatibleEventOrientation` để cho
`isLive` khác nhau vẫn ghép. Giá pre-match và giá live tính trên hai bối cảnh khác hẳn.

**Bẫy 4 — Nhãn "TRỰC TIẾP" trên trang không phải bằng chứng trận đang đá.**
SABA gắn nhãn đó cho cả mục cược live, kể cả trận còn 6 tiếng nữa mới đá. Bằng chứng
thật là `liveState.period` hoặc `clockMs`. Xem `cmd-normalizer.ts` `eventTime()` —
nhánh `TRỰC TIẾP`/`LIVE` trả `isLive: true, period: null, clockMs: null`.

## 5. Việc còn lại cho phiên ghép kèo

### 5.1 Kèo ẩn (ưu tiên cao — chủ sản phẩm yêu cầu)

Hiện chỉ thu được vé hiện trên màn hình. Phải mở rộng nhóm giải/trận trong DOM rồi
thu tiếp. Đã có sẵn `CmdHiddenMarketProbeCoordinator` cho CMD; các sàn khác chưa có.

Lưu ý từ `HUONG-DAN-KY-THUAT.md` mục 4:
- Handler nằm ở **hàng tiêu đề giải**, không phải icon mũi tên
- Click hàng loạt chỉ ăn vài cái vì trang vẽ lại DOM → phải lặp **trong trang**, cách nhau 400ms
- Chỉ **mở**, không bao giờ đóng
- Dùng `element.click()` đúng phần tử, **không click theo toạ độ** (tránh chạm nhầm ô odds)

### 5.2 Soi lại "kèo âm"

Chủ sản phẩm phản ánh hầu hết dòng kèo có ROI âm. Phần lớn cặp âm là bình thường —
arbitrage vốn hiếm — nhưng **chưa ai kiểm tra**. Cần xác minh:

- Quy đổi odds Malay/HK/Decimal trong `packages/core/src/odds/convert.ts`
- Ghép đúng cửa đối nghịch: **chủ@L với khách@(−L)**, không gom theo line rồi lấy hai phần tử đầu (bẫy 2 trong `HUONG-DAN-KY-THUAT.md`)
- Dấu chấp: **dương = chủ nhà chấp**, thống nhất mọi sàn
- Liệt kê **mọi** kết quả thanh toán rồi lấy min (line nguyên có 3 kết quả, line lẻ ¼ có 4)

Công cụ kiểm chứng độc lập mạnh nhất: so odds **cùng một line** giữa các sàn. Lệch
trung vị 1–3% là ánh xạ đúng; 30–100% là sai ở đâu đó.

### 5.3 APSPORT dao động

`LIVE ↔ SOFT_RECOVERY`, có lúc catalog về 0 trận trong khi vẫn forward hàng nghìn WS
frame. Vấn đề nằm ở bằng chứng DOM proof của `tsport-ws-adapter.ts`
(`expectedEventIds`, `proofReady`) — **thuộc phiên socket, không phải phiên ghép kèo.**

## 6. Ranh giới file

| Phiên ghép kèo được sửa | Phiên socket giữ |
|---|---|
| `apps/web/src/catalog/comparison.ts` | `apps/api/src/chrome-bridge/*-ws-adapter.ts` |
| `apps/web/src/pages/live-catalog-page.tsx` | `apps/chrome-extension/src/network-observer.ts` |
| `apps/api/src/chrome-bridge/catalog-part-merge.ts` | `apps/chrome-extension/src/ksport-recovery-generation.ts` |
| `packages/core/src/odds/`, `packages/core/src/arbitrage/` | `apps/api/src/chrome-bridge/provider-feed-*.ts` |

## 7. Quy trình deploy

Extension **tự nạp lại** sau mỗi lần deploy — không cần người bấm reload nữa.

```powershell
npm run build
node scripts/five-provider-coordinator.mjs claim-deploy <PROVIDER> <worker>
$env:TOOL_CHENH_DEPLOYMENT_LEASE_TOKEN = "<token>"
node scripts/exact-v2-stack-handoff.mjs
node scripts/five-provider-coordinator.mjs release-deploy <token>
```

Gặp `STACK_INSTANCE_DISCOVERY_UNAVAILABLE` thì dùng `exact-v2-stack-handoff.mjs`
thay cho `restart-live-stack.mjs`. Trang web chạy Vite dev — đổi `comparison.ts` thì
phải **hard-reload** trình duyệt vì code so kèo nằm trong Web Worker, HMR không nạp lại nó.

## 8. Cổng nghiệm thu

Không ghi `DONE` khi chưa có:

1. `crossBookRows` **tăng** so với mốc 144 hiện tại
2. Phép thử **bỏ IM+CMD** cho ra `crossBookRows > 0`
3. Không sàn nào tụt `quoteChanges60s` về 0 (`node scripts/diag-pipeline.mjs`)
4. `npm run typecheck` và `npm test` xanh toàn bộ 6 workspace
