# APSPORT — bàn giao cho Codex

## 1. Nguyên nhân gốc (đã xác nhận)

`apps/api/src/chrome-bridge/tsport-ws-adapter.ts` quanh dòng 493:

```js
for (const eventId of pending.records.keys()) {
  if (!pending.expectedEventIds.has(eventId)) pending.records.delete(eventId);
}
if ([...pending.expectedEventIds].every((eventId) => pending.records.has(eventId))) { ... }
```

Hai lỗi nằm chồng lên nhau:

1. **Xoá theo danh sách DOM** — `expectedEventIds` lấy từ các trận DOM render được. AP dùng
   danh sách ảo hoá (lazy/virtualized), DOM chỉ giữ một phần rất nhỏ, nên mọi record socket
   ngoài phần đó bị xoá.
2. **Đòi đủ mới phát** — chỉ phát baseline khi *mọi* id mong đợi đều có record. Một id thiếu
   là không phát gì cả.

Hệ quả đo được: danh mục 3–6 trận trong khi phiên thu của Codex có 263 trận / 2.608 market.

**DOM không thể làm bằng chứng cho một danh sách ảo hoá.** Bằng chứng phải chuyển sang API.

## 2. Luồng lấy đúng (Codex đã xác định, giữ nguyên)

1. `/events` — top leagues
2. `/other-leagues` — danh sách league lazy
3. `/leagues/tops` — tải hàng loạt league; trường `in` phải là `"17"`, **không phải** `"7"`
4. `/events/{eventId}` — toàn bộ detail của trận (**đây là nguồn kèo ẩn**)
5. WebSocket `eu` — merge realtime vào baseline API

Con số `615` / `604` trên menu là **counter tổng của sàn**, không phải số trận đủ điều kiện ở
`mg=1`. Đừng dùng nó làm expected count — đó là cái bẫy tôi đã mắc.

## 3. Những gì tôi đã sửa — đừng revert

| chỗ | sửa gì | vì sao |
|---|---|---|
| `tsport-ws-adapter.ts` fingerprint | nới đường dẫn socket | đường mã hoá periodId: `/ln/{lang}/p/{periodId}/u/{token}/s/1/mg/0/tr/0`. Mẫu gốc chỉ nhận `p/1`, nên bấm sang "Đang diễn ra" (`p/2`) hay "Hôm nay" (`p/4`) là mất socket. Kiểm tra nội dung vẫn giữ nguyên. |
| `tsport-dom-snapshot.ts` | dòng không có tên đội không còn làm hỏng cả lượt quét | quét đòi *mọi* dòng đọc được; 3 dòng rác làm sweep không bao giờ hoàn tất → không có generation → kẹt hard recovery |
| `network-observer.ts` | quét DOM chạy theo nhịp tim | trước đó chỉ chạy trong cửa sổ bootstrap ngắn rồi ngưng vĩnh viễn |
| `automatic-source-recovery.ts` | sàn 5 phút giữa hai lần tải lại tab | phục hồi cứng tải lại tab 19 lần, mỗi lần giết trang trước khi nó kịp đăng ký kênh. Giãn nhịp không chặn được vì một nhịp thành công là xoá bộ đếm |

## 4. Một cửa nữa còn chặn, chưa xong

Khung dữ liệu thật **đã tới** (bộ khoá `d, s, t, tmrg` — đúng envelope mong đợi) nhưng bị
`parseOuter` loại vì đòi `outer.s === 1`. Giá trị `s` thật khác 1 — chưa bắt được giá trị đó.

Chẩn đoán đã cài sẵn: `/api/diag/pipeline` → `HOP4_ADAPTER.contentRefusals` sẽ in
`outer-s-is-<giá trị>-t-<giá trị>` khi bắt được khung kèo thật. Cần trang bóng đá mở vài phút.

## 5. Ràng buộc bắt buộc

- **Chỉ đọc.** Không bao giờ đặt cược. Không navigate/reload tab nhà cái như một phần của deploy.
- **Chẩn đoán chỉ ghi hình dạng** — tên trường, tên loại, số đếm. Không ghi giá trị từ khung
  dữ liệu, không ghi destination, header, body, token.
- **Token trong URL là bí mật.** Token đã gửi trong chat cần đổi sau khi debug xong.
- `sảnh.md` chứa URL sảnh thật — đã trong `.gitignore`, không commit.

## 6. Kèo ẩn — yêu cầu cụ thể

`/events/{eventId}` là nguồn kèo ẩn: phiên thu được **2.608 market / 5.216 cửa cược cho 263
trận** (~10 market/trận). Hiện đường ống chỉ có ~2,5 market/trận.

Khi đưa vào danh mục:

- **Giữ riêng từng họ kèo.** Kèo chính, phạt góc, thẻ phải là **sản phẩm khác nhau** — đừng
  gộp về cùng một tên giải. SABA từng gộp và hậu quả là trận chính bị coi là "nhập nhằng" rồi
  **bị loại khỏi mọi phép ghép**. Lớp so sánh nay nối tên giải theo họ kèo, nên một sổ phạt
  góc chỉ nối với sổ phạt góc.
- **`isLive` của quote phải bằng `isLive` của event.** Lệch là dòng đó bị ẩn hoàn toàn.
- Market phải ánh xạ vào taxonomy sẵn có: `FT_AH`, `FT_TOTAL`, `FH_*`, `CORNER_*`, `CARD_*`.

## 7. Đo bằng gì

Thước đo duy nhất có nghĩa là **số dòng ghép chéo giữa các sàn**, không phải số trận của một sàn.

- `/api/diag/pipeline` — mọi cửa thất bại im lặng nay đều khai tên (`contentRefusals`,
  `ignoredEndpoints` có tiền tố `/route-…` và `/ignored/…`).
- `.run/realtime/stability.jsonl` — soak liên tục, `up%` và số lần lật theo từng sàn.
- **Đừng đo trong 10 phút sau một lần deploy** — restart làm mọi sàn tụt, đo lúc đó là vô nghĩa.
  Đây là lỗi tôi lặp lại nhiều lần.
