# Trạng thái làm việc — 2026-08-28

Đọc file này thay cho việc đọc lại lịch sử hội thoại. Mọi số trong đây đều là số đo
thật, không phải ước lượng.

## SBOBET realtime — ĐÃ SỬA (2026-08-30 rạng sáng, nhánh feat/realtime-hardening)

**Triệu chứng:** UI sàn (`zenandfe.com`, socket `*.sb21.net`) nhảy giá liên tục nhưng
catalog chỉ cập nhật theo đợt ~2 phút. Đo qua `/api/diag/pipeline`: tuổi catalog ==
tuổi baseline chính xác từng ms, `quoteChanges60s=0` giữa hai baseline, dù 1.396
frame WS về trong 60s.

**Chuỗi nguyên nhân (đo, không đoán):**
1. Sàn chỉ trả full snapshot khi có SUBSCRIBE mới; topic `today` đi qua
   `subSportHotMatch` — **không bao giờ** full-snapshot. Adapter yêu cầu cặp full
   live+today để chuyển authority HTTP→WS, nên không bao giờ chuyển.
2. Dưới authority HTTP, mọi delta WS bị bỏ qua (gate cũ ở `decode()`), catalog
   đóng băng cho tới baseline HTTP kế tiếp.
3. Bẫy thứ hai: 102/102 receipt kèo trong capture là bản cập nhật 1–2 trận nhưng
   mang **đúng hình dạng mảng league của full snapshot** — không thể phân biệt
   full/delta bằng hình dạng. Nếu để máy handover WS nhận cặp "full" này, nó sẽ
   thay cả partition bằng vài trận.

**Sửa (2 commit trong `ksport-ws-adapter.ts`):** khi đang có baseline HTTP, mọi
receipt WS qua fence `envelope.sequence > httpAuthorityCutoff` được **fold làm
upsert vào chính baseline HTTP** và phát `evidenceMode: DELTA` với generation HTTP
(khớp `activeGeneration` nên controller nhận). Không đụng `wsSequenceHighWatermark`
— đẩy nó sẽ vứt mọi baseline HTTP sau qua fence pending-baseline.

**Kết quả đo 3 phút liên tục:** tuổi catalog giữ 100–200ms trong khi baseline già
tới 120s; 765–1.182 đổi giá/60s (trước: 0). Chu kỳ còn lại: lease baseline 120s hết
~10s trước khi cặp getEvent trong trang về → HOP6 chớm SOFT_RECOVERY vài giây mỗi
~2 phút, catalog vẫn tươi suốt — ngưỡng giữ nguyên, không nới.

**Diễn biến tiếp (02:27, test sống với người dùng):** trong lúc đổi epoch, trước
khi baseline HTTP đầu tiên kịp về, một "cặp full" giả (fragment đội lốt) đã chiếm
quyền WS → **catalog sập 142 → 62 trận rồi đóng băng**. Kết luận cuối: với sàn này
**không receipt WS nào đáng tin làm baseline**. Đã gỡ toàn bộ máy socket-authority
khỏi `ksport-ws-adapter.ts` (~1.000 dòng kèm test cũ): chỉ cặp getEvent HTTP làm
baseline; WS chỉ fold upsert qua fence sequence; socket đóng không invalidate
catalog nó chưa từng sở hữu. Test adapter viết lại (18), data-plane chuyển sang
cặp HTTP (53/53).

**Nốt cuối cùng của chuỗi:** baseline chỉ được làm mới khi stall → recovery, mà
backoff recovery lớn dần (128s → 256s) → mỗi ~2 phút đứng 30–60s. Extension giờ
**chủ động gia hạn lease mỗi 75s** khi socket khỏe (`#renewKsportBaselineLease`,
bundle `2390eb51`) — template fetch trước, native period request khi template hỏng.

**Việc còn mở:** (a) delta chỉ upsert — trận bị gỡ và trận MỚI chỉ vào/ra ở
baseline kế tiếp (coverage guard chặn delta thêm event mới), trễ tối đa ~75s;
(b) `expectedEvidenceCadenceMs=60_000` của SBOBET chỉnh hồi thế giới còn hỏng —
giờ evidence p50 ~300ms, có thể siết sau soak; (c) extension vẫn bơm SUBSCRIBE
lặp vô ích — vô hại nhưng ồn, dọn sau; (d) APSPORT view "Trực tiếp" (mg/1) vẫn
là gánh nợ cũ: tab trôi sang đó là roster chết (`record-no-usable-markets`,
`delta-generation-mismatch`) — workaround giữ tab ở "Hôm nay", fix thật ~1-2h.

**IM đêm nay không phải bug:** hai lần "mất data" đều là tab không còn attach
(0 envelope tới bridge); mở lại tab là tự hồi ~1 phút. Snapshot GetSE bị chunk
110KB nên trong capture nhìn như thiếu `StatusCode` — bản ráp nằm ở tầng sau.

## SABA — đặt tên xong, và cái tên nói đầu vào sai chứ không phải bộ giải mã

Đã đặt tên 9 lối thoát câm của `saba-ws-adapter.ts` (commit `f4ae6da`) và tách
năm kết cục mà `decodePublicDomRecords` gộp chung thành một `null` (commit `7b72752`).

Kết quả sau khi triển khai:

```
4 /ignored/dom-no-record-of-1-matched-schema
```

Ảnh chụp DOM của SABA chỉ có **1 bản ghi**, và bản ghi đó không khớp lược đồ nào.
Một trang sổ thể thao đang chạy phải cho ra hàng chục bản ghi. **Một bản ghi lạ là
hình dạng của trang lỗi hoặc trang đăng nhập**, khớp với ghi chép cũ:
`ErrorPage?Game=DepositLogin&ErrCode=SPA-1008`.

**Kết luận: SABA không phải lỗi bộ giải mã — tab của nó không ở trang sổ thể thao.**
Cần người dùng mở lại. Khi tab về đúng trang, đo lại bằng `do-go-keo.mts`; nếu
vẫn hỏng thì bây giờ báo cáo đã biết nói cửa nào.

---

## Trạng thái mới nhất — 2026-08-29 tối

**5/6 sàn LIVE.** Đo bằng `npx tsx .run/do-go-keo.mts 60000`, chỉ tính trận đang đá:

| sàn | cửa live | GỠ | đổi giá | tình trạng |
|---|---|---|---|---|
| CMD | 750 | 90 (12%) | 528 | ✅ vừa sửa xong |
| BTI | 868 | 80 (9,2%) | 561 | ✅ |
| APSPORT | 120 | 120 (100%) | 0 | ✅ LIVE, roster vừa thay toàn bộ |
| SBOBET | 0 | – | – | LIVE, chưa có trận đang đá để đo |
| IM | 0 | – | – | LIVE, chưa có trận đang đá để đo |
| **SABA** | 1294 | **0** | **0** | ❌ HARD_RECOVERY, đứng hoàn toàn |

### CMD — một dòng hỏng vuứt cả baseline (ĐÃ XONG, commit `4eafdb4`)

CMD nằm HARD_RECOVERY với danh mục cũ **84 phút** trong khi 630 phản hồi HTTP
vẫn về mỗi kỳ đo. Nguyên nhân: mỗi baseline khoảng 1.690 dòng bị vứt sạch chỉ vì
**một** dòng không giải mã được. Không có baseline thì nguồn không bao giờ được
nâng từ CANDIDATE lên ACTIVE — `authorityDisposition: NONE` — nên danh mục đứng.

Tìm ra bằng đúng bước 4 của spec: adapter CMD có **13 lối thoát `return []` trần**,
không cái nào khai lý do. Sau khi đặt tên (commit `43ef281`), báo cáo hiện ngay:

```
6 /ignored/baseline-row-unusable-of-1690
6 /ignored/baseline-row-unusable-of-1694
2 /ignored/baseline-row-unusable-of-1696
```

Con số kèm theo là thứ quyết định cách sửa: **một** dòng hỏng trên 1.690, không
phải đổi lược đồ (đổi lược đồ thì cả 1.690 đều hỏng). Nên: bỏ riêng dòng đó, giữ
ngưỡng một phần hai mươi để vẫn từ chối khi lược đồ thật sự đổi.

Sau khi triển khai: LIVE/FRESH 1s, authority ACTIVE, giải mã 168 (trước 5).

### Bẫy mới mắc 2026-08-29

**`start-live-stack.mjs` báo "already running" thì KHÔNG nạp bản dựng mới.** Đã
mất 25 phút đo một hệ thống đang chạy đúng code vừa gỡ bỏ. Cách dừng êm đúng:

```bash
node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('.auth/run/live-stack.json','utf8'));fs.writeFileSync('.auth/run/live-stack.shutdown.json',JSON.stringify({version:1,instanceId:s.instanceId,shutdownToken:s.shutdownToken}))"
```

Kiểm chứng bằng `buildIdentity` trong `.auth/run/live-stack.json` — nó phải đổi.

**`contentRefusals` trong `/api/diag/pipeline` là bộ đếm DÙNG CHUNG**, in y hệt cho
cả sáu sàn (nó là biến cấp module trong adapter APSPORT). Đừng gán cho sàn đang xem.
Các trường RIÊNG từng sàn: `decoded`, `ignored`, `rejectReasons`, `lastDecodedAgeMs`,
`ignoredEndpoints`.

---

## Mục tiêu

6 sàn chạy realtime, ghép trận giữa các sàn để tìm chênh lệch giá. Thước đo duy nhất
có nghĩa là **số dòng ghép chéo giữa các sàn**, không phải số trận của một sàn.

## Tình trạng 6 sàn (đo 2026-08-28)

| sàn | trạng thái | ghi chú |
|---|---|---|
| CMD | chạy tốt | tuổi dữ liệu ~0s, FRESH |
| BTI | chạy tốt | ~0s, FRESH |
| IM | chạy tốt | ~13s, FRESH. Đăng lịch 2 ngày, đã lọc còn 24h |
| APSPORT | chạy một phần | ~94s, STALE. Codex đang làm đường lấy qua API |
| SABA | **hỏng** | 50 phút cũ. Tab rơi sang `ErrorPage?Game=DepositLogin&ErrCode=SPA-1008` → **phiên đăng nhập hỏng, cần đăng nhập lại** |
| SBOBET | **hỏng** | 62 phút cũ, `decoded=0`. Khung CÓ về trên `/sport/{id}/{token}/websocket` nhưng không giải mã được |

## Lỗi đã tìm ra 2026-08-28 chiều — một sàn im giết cả sáu

Đây là lý do các sàn "rụng vào ra" suốt hai ngày, và là lý do mọi con số "5/6 sàn
chạy" đều sụp ngay sau khi đo.

Sáu sàn quan sát qua **một socket chung**. Trong `chrome-bridge-registry.ts`,
`#retireSources` xử lý một sàn im quá `retireAfterMs` (5 phút) bằng cách ném **cả
socket** vào `#revokedConnections`. `ingestDetailed` từ chối mọi khung tới trên một
socket đã thu hồi, và `WeakSet` đó không bao giờ được xoá. Nên một sàn chết là cả
sáu chết vĩnh viễn — trong khi socket vẫn mở, nên extension không thấy gì hỏng để
sửa, và API không còn source nào để gửi lobby snapshot.

Số đo lúc 17:58:11 ngày 2026-08-28: SABA (phiên đăng nhập đã hỏng) gửi khung cuối
lúc 17:29:05; CMD, IM, SBOBET, APSPORT, BTI đều dừng trong khoảng 17:34:02–17:34:05
— cách đúng 297–300 giây, bằng `retireAfterMs = 300_000`. 24 phút sau mọi số thứ tự
khung vẫn đứng im, `listSources` rỗng, còn kết nối Chrome thì mở liên tục từ
17:25:26 và chưa từng đứt.

**Đã sửa** (commit `b835cd9`): thu hồi theo **(socket, tài khoản)** thay vì theo
socket. Một sàn bị thu hồi vẫn phải chứng minh connection mới mới giành lại được
quyền — giữ nguyên ý đồ cũ — nhưng không nói thay cho sàn nó không sở hữu.
`releaseConnection` vẫn thu hồi tất cả, vì ở đó socket đứt thật.

Bài học chung: **extension khoẻ không có nghĩa dữ liệu đang chảy.** Trước khi nghi
extension, đo `listSources` và tuổi khung của từng sàn; nếu mọi sàn dừng trong cùng
vài giây thì lỗi nằm ở chỗ dùng chung, không phải ở từng sàn.

## CMD — dấu mức chấp hiệp 1 (ĐÃ XONG, commit `4e2b528`)

**Mỗi hiệp có trường riêng chỉ bên cho chấp.** `row[24]` là của kèo cả trận,
`row[64]` là của kèo hiệp 1. Adapter trước đây đọc `row[24]` cho cả hai.

Đo trên 732 hàng bắt được 2026-08-28: hai trường lệch nhau ở 54 hàng, và ở đúng
**4 hàng** có kèo chấp hiệp 1 thật — Atlante v Club Leon, Eintracht Braunschweig
v Hertha Berlin, FC Voluntari v Otelul Galati, ZKS Kluczevia v SKS Unia
Swarzedz. `row[64]` đúng cả 4. Chấm theo thang giá của chính từng trận (giá chủ
nhà phải giảm khi mức chấp chủ nhà tăng): `row[64]` đúng 44/44 cho hiệp 1,
`row[24]` đúng 40/44; ngược lại cả trận thì `row[24]` đúng 87/94 còn `row[64]`
74/94.

Cách bắt được: bật `CHROME_BRIDGE_CAPTURE=1 CHROME_BRIDGE_CAPTURE_LOBBIES=CMD`,
payload ghi vào `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures`. **Nhớ đọc cả
`data` lẫn `today`** khi ghép mảnh — bỏ `today` là mất phần lớn trận.

## Ghi chú cũ về CMD (giữ để tra cứu)

Nguồn thật của danh mục CMD **không phải DOM** mà là
`/Member/BetsView/BetLight/DataOdds.ashx`, giải mã ở
`apps/api/src/chrome-bridge/cmd-http-adapter.ts`. Mỗi hàng dài 91 trường, `-999`
nghĩa là không có kèo.

```
row[10] mức chấp cả trận   row[40]/[41] giá chủ/khách
row[14] mức chấp hiệp 1    row[44]/[45] giá chủ/khách
row[24] BÊN CHO CHẤP  ← dùng chung cho cả hai loại kèo
```

Mức chấp luôn là **trị tuyệt đối** (`0.25`, không bao giờ `-0.25`); dấu hoàn toàn
do `row[24]` quyết định. Trận nào hiệp 1 và cả trận nằm ở hai bên khác nhau thì
một trong hai chắc chắn sai, và nửa sai được phát ra như **ảnh gương** của mức
chấp thật.

Đo 2026-08-28: CMD ra `Atlante v Club Leon` hiệp 1 là `1.54/2.52` trong khi
SBOBET `2.54/1.51`, IM `2.47/1.56` cùng mức chấp — và kèo cả trận của chính CMD
đồng ý với họ. Ghép chéo, nửa bị gương đọc thành **ROI 16,46%**, hai chân vé
cùng đặt một cửa. 3/348 phép so chấp hiệp 1 giữa các sàn lệch; mọi loại kèo khác
đúng 1260/1260.

**Đã làm** (`32269b8`, `8c7c962`): giữ lại kèo khi một trận có hai kèo cùng loại
cùng mức chấp mà **giá khác nhau** — bằng chứng chắc chắn có bên bị gán sai,
nhưng không biết bên nào nên không phát cái nào. Trùng lặp **cùng giá** thì giữ
(SABA phát trùng y hệt rất nhiều).

**Chưa xong:** trận chỉ có duy nhất một kèo hiệp 1 thì không có gì để đối chiếu.
Muốn tìm trường mang bên cho chấp của hiệp 1 phải có payload của **trận chưa đá**
— mọi payload bắt được tới giờ chỉ có trận đang đá, và ở đó `row[24]` đúng cả
11/11 hiệp 1 lẫn 14/15 cả trận.

Bật ghi payload: `CHROME_BRIDGE_CAPTURE=1 CHROME_BRIDGE_CAPTURE_LOBBIES=CMD`,
ghi vào `%LOCALAPPDATA%\tool-chenh\chrome-bridge-captures`. Ghi cho cả 6 sàn sẽ
làm `replay-harness.test.ts` hết lỗi (hiện thiếu payload 5 sàn).

## Mức chấp nguyên bị loại là CỐ Ý

`isSupportedFootballTwoWayLine` có `quarterUnits % 4 !== 0` — loại mọi mức chấp
nguyên (0, 1, 2…). Khoảng một phần ba kèo chấp của CMD rơi vào đây. **Đừng
"sửa"**: kèo chấp nguyên có thể hoà vốn hoàn tiền, mà bộ tính ROI chưa mô hình
hoá hoàn tiền — tính vào là ra ROI sai.

## Nối tên giải — tích luỹ qua nhiều ngày (commit `38421d5`)

Luật vẫn là **2 trận khác nhau** mới nối hai tên giải — đó là thứ giữ cho một
cúp không gộp vào một giải khi chúng chung đúng một trận. Chỗ sửa: hai trận đó
**không cần cùng có mặt một lúc**.

Đo 2026-08-29: 104/124 cặp giải có trận chung chỉ có **đúng một** trận, vì cửa
sổ 24 giờ thường chỉ chứa một trận mỗi giải còn vòng sau cách vài ngày.

- Bằng chứng đếm theo **trận khác nhau**, không phải số lần thấy. Một giải xuất
  hiện nghìn lần với cùng một trận vẫn là một trận, vẫn không nối (có test chạy
  50 lần chụp liên tiếp).
- Chỉ nhớ **trận chưa đá** — trận đang đá báo thời điểm quan sát chứ không phải
  giờ bóng nên không tự định danh lại được, và nó cũng không cần vì trận live
  ghép được mà không cần nối tên giải.
- Cặp đã chứng minh **sống qua lần tải lại trang**, lưu ở `localStorage`
  (`comparisonCompetitionLinksV1`), nạp lại qua lệnh `RESET` của worker.

**Kỳ vọng thực tế:** nạp lại 4,5 giờ ảnh chụp của một tối chỉ thêm **4 dòng** —
vì trong một buổi chiều các trận trên bảng gần như không đổi. Lợi ích cộng dồn
theo **ngày**, khi các giải đá vòng tiếp theo. Không có lưu trữ bền thì cơ chế
này vô dụng, nên hai phần phải đi cùng nhau.

## Giá không cập nhật khi sàn đổi giá — CMD đã xong

**Mô-típ: một dòng hỏng vứt cả lô.** `cmd-http-adapter.ts` áp delta theo lô; chỉ
một dòng trả `INVALID` là `return []` — toàn bộ thay đổi giá của các trận khác
trong cùng phản hồi mất sạch, `state.rows` giữ nguyên giá cũ. Sàn đã đổi giá, danh
mục thì không.

Hai dòng gây ra chuyện đó liên tục:

- **`-999` là mã CMD dùng khi khoá kèo.** `finiteOdd` từ chối mọi `|x| > 1` nên
  mỗi lần CMD khoá một kèo (mỗi bàn thắng, mỗi lần dời mức chấp) là vứt cả lô.
- **Delta cho trận mình không giữ** (trang có nhiều môn khác) cũng thành `INVALID`.

Đã sửa (`b0a5f6e`): `-999` **ghi thẳng vào hàng** để `decodeRecord` bỏ kèo đó đi
(kèo biến mất thay vì giữ giá cũ); delta cho trận không giữ thì bỏ qua riêng nó.
Lỗi cấu trúc thật vẫn vứt cả lô.

**Đo sau khi sửa — giá đổi trong 30 giây:**

| sàn | giá đổi | giữ nguyên | % |
|---|---|---|---|
| CMD | 149 | 343 | **30,3%** ✅ |
| BTI | 195 | 451 | 30,2% ✅ |
| SBOBET | 81 | 375 | 17,8% ✅ |
| IM | 19 | 8.653 | **0,2%** ⚠ |
| APSPORT | 0 | 2.828 | **0,0%** ❌ (vẫn báo FRESH) |
| SABA | 0 | 1.660 | 0% (báo STALE, đúng) |

## Cách đo lại nhanh

`.run/dem-bti-thehe.mts` — chụp hai lần cách 30 giây, đếm `rawOdds` đổi theo
`providerSelectionId`. Đây là phép đo trực tiếp nhất cho câu "sàn có cập nhật
không".

`%LOCALAPPDATA%\tool-chenh\logs\realtime-ticket-checks.jsonl` — mọi lần bấm
"Kiểm tra giá thật", có `verificationStatus` (MATCH / MISMATCH / NOT_FOUND) kèm
`directMethod`. **Lưu ý:** `NOT_FOUND` của APSPORT/SABA phần lớn là **đầu đọc
DOM không thấy dòng** (trang chỉ dựng phần đang nhìn), không phải giá sai. Chỉ
`NOT_FOUND` của sàn dùng `IN_PAGE_FETCH` mới là bằng chứng kèo đã biến mất thật.

## APSPORT đứng giá — ĐÃ XONG (2026-08-29)

**Mẫu yêu cầu kẹt thế hệ.** Danh mục APSPORT làm mới qua một request template lấy
từ trang; template thuộc về thế hệ nguồn/tab lúc lấy, mà **cả hai nhảy sau mỗi
lần nối lại**. `#refreshApsportCatalog` dùng lại template trong bộ đệm, thấy nó
cũ hơn thế hệ hiện tại thì **thoát im lặng** — và không gì dọn bộ đệm, nên nó
thoát mãi mãi. Cả vòng đời tab chỉ có **một lần roster**.

Số đo lúc hỏng:

```
wsAttach.sourceGeneration = 20      nhung activeGeneration = apsport:...:1
baselineAgeMs = 281187              tran maxBaselineAgeMs = 120000  -> HARD_RECOVERY
observedEvidenceCadenceMs p50 = 199ms, 405 mau   <- socket VAN gui deu
observedAtMs khong doi sau 60 giay  <- 852 tran / 8132 gia dong bang nguyen khoi
```

Feed đòi baseline mới trong 2 phút; không có thì **ngừng phát danh mục** dù dữ
liệu vẫn về 5 lần/giây. Đó chính là "nguồn ổn định mà không realtime".

Đã sửa: template lệch thế hệ thì **dựng lại**; lối thoát còn lại khai tên
`APSPORT_TEMPLATE_GENERATION_STALE`. Sau khi reload extension: baseline không
quá 23s, 130–300 giá đổi mỗi phút.

**Đây là thay đổi trong extension** — phải `npm run build` ở `apps/chrome-extension`
rồi **reload extension** ở `chrome://extensions` mới có hiệu lực.

## Hai lỗi cùng họ đã sửa trong ngày

- **CMD**: một dòng delta hỏng vứt cả lô (`-999` là mã khoá kèo mà `finiteOdd` từ
  chối). Sửa: ghi `-999` xuyên qua để kèo biến mất; delta cho trận không giữ thì
  bỏ riêng nó.
- **APSPORT**: khung báo khoá kèo bị vứt, để lại giá cũ. Sửa: khoá đi xuyên qua
  thành `SUSPENDED`, tầng so sánh và tầng cược đều không định giá.

Mô-típ chung: **một tín hiệu "không có hàng" bị đọc là "lỗi", rồi vứt luôn cả
thứ đi kèm.** Gặp "sàn đứng giá" thì tìm mô-típ này trước.

## VIỆC GẤP NHẤT — chưa làm

**Bảng đang xếp vé ROI dương dựng từ dữ liệu cũ lên đầu.** Đo được: 4 vé dương
(2,66% / 1,60% / 0,56% / 0,23%) đều dựa vào SABA với dữ liệu 50 phút. Đó là chênh
lệch ảo — SABA đứng giá trong khi CMD/IM/BTI vẫn chạy.

API **đã** đánh dấu đúng (`snapshotState=STALE`), nhưng lớp so sánh vẫn nhận cả danh
mục STALE rồi mới phân biệt, nên vé sai leo lên chỗ dễ tin nhất.

Cần: không xếp vé dựng từ dữ liệu STALE chung bảng với vé tươi — hoặc loại, hoặc tách
khu và ghi rõ tuổi. `comparison-worker-engine.ts` đã tính sẵn cả `displayEvents` và
`freshEvents`, nên phần lớn cơ chế đã có.

## Việc còn lại, theo thứ tự

1. Chặn vé STALE khỏi bảng xếp hạng (trên)
2. SABA: đăng nhập lại, rồi kiểm tra `decoded` có tăng không
3. SBOBET: khung về trên `/sport/{id}/{token}/websocket` mà không giải mã được —
   cùng họ lỗi với APSPORT hôm qua (vân tay khớp đường dẫn cứng)
4. "Kiểm tra giá thật" của SABA chỉ đọc DOM nên trận không hiển thị là hỏng
   (`VISIBLE_PRICE_NOT_FOUND`). BTI/KSPORT/TSPORT có đường gọi API trong trang nên
   luôn khớp. Cần cho SABA một đường tương tự, hoặc mở trận trước khi đọc.
5. Chuyển phép ghép trận từ client sang server (xem "Kiến trúc" bên dưới)

## Cách đo — dùng lệnh, đừng đoán

```bash
# trạng thái 6 sàn, mọi cửa lỗi im lặng đều khai tên
curl -s http://127.0.0.1:4310/api/diag/pipeline

# tuổi dữ liệu + snapshotState từng sàn
curl -s http://127.0.0.1:4310/api/catalog/accounts/catalog-source:SABA:FOOTBALL
```

`.run/realtime/stability.jsonl` — soak liên tục, `up%` và số lần lật theo từng sàn.

**Đừng đo trong 10 phút sau một lần deploy.** Restart làm mọi sàn tụt; đo lúc đó là vô
nghĩa. Đây là lỗi lặp lại nhiều lần trong phiên trước.

## Chẩn đoán đã cài sẵn (dùng đi, đừng viết lại)

Trước đây mọi thất bại đều im lặng giống hệt nhau. Nay mỗi cửa đều khai tên:

- `HOP4_ADAPTER.ignoredEndpoints` — tiền tố `/route-…` (bộ định tuyến từ chối, kèm
  đường dẫn thật) và `/ignored/…` (bộ điều hợp tự bỏ, kèm lý do)
- `HOP4_ADAPTER.contentRefusals` — vì sao khung không phải bản ghi bóng đá
- `wsAttach.catalogShape` — hình dạng trang APSPORT thấy được, kèm danh sách socket
- `wsAttach.snapshotRejections` — vì sao ảnh chụp nền bị loại

Tất cả chỉ ghi **hình dạng**: tên trường, tên loại, số đếm. Không ghi giá trị, đích,
header, token.

## Ràng buộc bắt buộc

- **Chỉ đọc.** Không bao giờ đặt cược.
- Không navigate/reload tab nhà cái như một phần của deploy.
- Chẩn đoán chỉ ghi hình dạng, không ghi giá trị.
- `sảnh.md` chứa URL sảnh thật — trong `.gitignore`, không commit. Token trong URL là
  bí mật; token đã gửi qua chat cần đổi.

## Những cái bẫy đã mắc — đừng lặp lại

1. **Đo một khoảnh khắc rồi kết luận.** Đã nhiều lần báo "5/6 sàn chạy" dựa trên đúng
   lúc chúng đang lên. Số thật qua 6 giờ khác hẳn. Luôn dùng soak.
2. **Nâng ngưỡng để làm đẹp số.** Nâng cadence SABA 75s → 180s làm nó *trông* 90%,
   nhưng cũng nâng cửa sổ tươi lên 3 phút — giá cũ 3 phút hiện như giá hiện tại, tức
   chế ra ROI ảo. **Đã hoàn tác.**
3. **Chọn phần tử theo nhãn mà không giới hạn khu.** Bộ chọn mục thời gian bấm nhầm
   dải tab của "Á Vận Hội", đẩy trang SABA sang mục trống → socket không có gì để gửi.
   Đã gỡ; module còn đó, chưa nối, có ghi cảnh báo.
4. **Deploy liên tục rồi đo ngay.** ~20 lần deploy trong hai ngày, mỗi lần đánh sập
   mọi sàn vài phút.
5. **Dùng con số trên menu sàn làm số trận.** `bóng đá 604` là counter tổng của sàn,
   không phải số trận đủ điều kiện.
6. **Tin cách chuẩn hoá của mình thay vì của code.** Từng kết luận "26 trận mất vì tên
   giải" nhưng vài cặp trong đó đã được ánh xạ sẵn — bộ đo dùng hàm gấp chữ riêng,
   không phải `competitionIdentity`.

## Mô-típ lỗi lặp đi lặp lại trong kho này

**Hỏng một lần là chết vĩnh viễn.** Rất nhiều lỗi hai ngày qua đều cùng hình dạng:
một chốt không được thả, một danh sách "mong đợi" đòi đủ mới chịu phát, một cửa thoát
im lặng. Khi gặp "sàn im hẳn", tìm chốt trước khi tìm lỗi giao thức.

Ví dụ đã sửa: chốt chụp DOM không bao giờ thả; quét đòi *mọi* dòng đọc được; phục hồi
cứng tải lại tab 19 lần vì một nhịp thành công xoá sạch bộ đếm giãn nhịp; adapter vứt
mọi khung khi chờ dữ liệu nền.

## Kiến trúc — điều cần biết

**Phép ghép trận đang chạy ở client, không phải server.** `buildComparisonEvents` chỉ
có trong `apps/web`. Mỗi client tải ~6,5 MB rồi tự tính 134 ms. 5 người xem = 5 lần
tải và 5 lần tính.

Chuyển sang server thì **không làm chậm realtime, còn nhanh hơn ở client**, nhưng ba
điều kiện bắt buộc:
- Chạy trong **worker thread** ở API (API hiện không dùng worker nào; 134 ms chặn
  event loop sẽ làm hại chính luồng nhận dữ liệu)
- Client **lọc trên kết quả** khi tích/bỏ tích sàn (không thể tính sẵn 64 tổ hợp)
- Kết quả phải **mang theo tuổi dữ liệu của từng sàn**, không gộp thành một mốc chung

## Tài liệu liên quan

- `docs/apsport-handoff-codex.md` — nguyên nhân gốc APSPORT (adapter xoá record socket
  không nằm trong danh sách DOM, mà AP dùng danh sách ảo hoá) + luồng lấy đúng
- Lịch sử: mỗi commit trên `feat/six-provider-realtime-feed` ghi rõ đo được gì và vì
  sao sửa. Đọc `git log` rẻ hơn đọc lại hội thoại rất nhiều.
