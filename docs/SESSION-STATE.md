# Trạng thái làm việc — 2026-08-28

Đọc file này thay cho việc đọc lại lịch sử hội thoại. Mọi số trong đây đều là số đo
thật, không phải ước lượng.

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
